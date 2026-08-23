import type { Express, Request, Response, NextFunction } from 'express';
import express from 'express';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalUrlFor, isMarkdownExcludedPath, markdownForPath, prefersMarkdown } from './agent-discovery.util';

export { canonicalUrlFor, isMarkdownExcludedPath, markdownForPath, prefersMarkdown };

const ORIGIN = 'https://nostria.app';
const API_ORIGIN = 'https://api.nostria.app';
const DISCOVERY_CACHE = 'public, max-age=300, s-maxage=3600';

const HOMEPAGE_LINK_VALUES = [
  '</.well-known/api-catalog>; rel="api-catalog"',
  '</.well-known/oauth-protected-resource>; rel="describedby"; type="application/json"',
  '</.well-known/ai-catalog.json>; rel="ai-catalog"',
  '</auth.md>; rel="service-doc"; type="text/markdown"',
  '</.well-known/mcp/server-card.json>; rel="service-desc"; type="application/json"',
  '</openapi.json>; rel="service-desc"; type="application/openapi+json"',
  '</.well-known/agent-skills/index.json>; rel="describedby"; type="application/json"',
];

export function homepageLinkHeader(): string {
  return HOMEPAGE_LINK_VALUES.join(', ');
}

const TYPED_DISCOVERY_FILES: Array<{ path: string; file: string; type: string }> = [
  { path: '/robots.txt', file: 'robots.txt', type: 'text/plain; charset=utf-8' },
  { path: '/sitemap.xml', file: 'sitemap.xml', type: 'application/xml; charset=utf-8' },
  { path: '/auth.md', file: 'auth.md', type: 'text/markdown; charset=utf-8' },
  { path: '/llms.txt', file: 'llms.txt', type: 'text/plain; charset=utf-8' },
  { path: '/openapi.json', file: 'openapi.json', type: 'application/openapi+json; charset=utf-8' },
  {
    path: '/.well-known/api-catalog',
    file: '.well-known/api-catalog',
    type: 'application/linkset+json; charset=utf-8',
  },
  {
    path: '/.well-known/oauth-protected-resource',
    file: '.well-known/oauth-protected-resource',
    type: 'application/json; charset=utf-8',
  },
  {
    path: '/.well-known/oauth-authorization-server',
    file: '.well-known/oauth-authorization-server',
    type: 'application/json; charset=utf-8',
  },
  {
    path: '/.well-known/openid-configuration',
    file: '.well-known/openid-configuration',
    type: 'application/json; charset=utf-8',
  },
  {
    path: '/.well-known/jwks.json',
    file: '.well-known/jwks.json',
    type: 'application/json; charset=utf-8',
  },
  {
    path: '/.well-known/ai-catalog.json',
    file: '.well-known/ai-catalog.json',
    type: 'application/json; charset=utf-8',
  },
  {
    path: '/.well-known/mcp.json',
    file: '.well-known/mcp.json',
    type: 'application/json; charset=utf-8',
  },
  {
    path: '/.well-known/mcp/server-card.json',
    file: '.well-known/mcp/server-card.json',
    type: 'application/json; charset=utf-8',
  },
];

const NIP98_UNSUPPORTED = {
  error: 'nip98_required',
  error_description:
    'Nostria HTTP APIs authenticate with NIP-98 (Authorization: Nostr <base64-event>), not OAuth access tokens. See https://nostria.app/auth.md',
  documentation: `${ORIGIN}/auth.md`,
};

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

function sendDiscoveryFile(browserDistFolder: string, file: string, contentType: string, res: Response): void {
  const absolute = join(browserDistFolder, file);
  if (!existsSync(absolute)) {
    res.status(404).type('text/plain').send('Not found');
    return;
  }
  res.sendFile(absolute, {
    dotfiles: 'allow',
    headers: {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': DISCOVERY_CACHE,
    },
  }, error => {
    if (error && !res.headersSent) {
      res.status(404).type('text/plain').send('Not found');
    }
  });
}

function sendMarkdown(path: string, res: Response): void {
  const body = markdownForPath(path);
  const tokens = Math.max(1, Math.ceil(body.length / 4));
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('x-markdown-tokens', String(tokens));
  res.setHeader('Vary', 'Accept');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', DISCOVERY_CACHE);
  res.status(200).send(body);
}

function jsonRpcResult(id: JsonRpcId | undefined, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function jsonRpcError(id: JsonRpcId | undefined, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function toolText(text: string, isError = false) {
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  };
}

const HARD_CODED_NIP05: Record<string, string> = {
  support: '77c3805acd32407a693a8f8ac21a9a621a538fbbf34723729ba6d67ef90a295b',
  premium: '54f4adbd1d2b1b25b0cb690fbea35d2e0a62f38e77ca0fcd2907fb22f4a7fdbb',
  curator: '929dd94e6cc8a6665665a1e1fc043952c014c16c1735578e3436cd4510b1e829',
  payment: '3e5b8d197f4a9279278fd61d9d033058e13d62f6652e3f868dcab54fac8c9658',
  _: 'd1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b',
};

async function callMcpTool(name: string, args: Record<string, unknown>): Promise<ReturnType<typeof toolText>> {
  if (name === 'resolve_nip05') {
    const nameArg = String(args['name'] ?? args['identifier'] ?? '').trim();
    if (!nameArg) {
      return toolText('name is required', true);
    }
    const localName = nameArg.includes('@') ? nameArg.split('@')[0] : nameArg;
    if (HARD_CODED_NIP05[localName]) {
      return toolText(JSON.stringify({ names: { [localName]: HARD_CODED_NIP05[localName] } }));
    }
    try {
      const response = await fetch(`${API_ORIGIN}/api/account/${encodeURIComponent(localName)}`);
      if (!response.ok) {
        return toolText(JSON.stringify({ names: {} }), response.status !== 404);
      }
      const userData = await response.json() as { success?: boolean; result?: { pubkey?: string } };
      if (!userData.success || !userData.result?.pubkey) {
        return toolText(JSON.stringify({ names: {} }));
      }
      return toolText(JSON.stringify({ names: { [localName]: userData.result.pubkey } }));
    } catch (error) {
      return toolText(`NIP-05 lookup failed: ${error instanceof Error ? error.message : 'unknown error'}`, true);
    }
  }

  if (name === 'get_public_account') {
    const id = String(args['id'] ?? args['pubkey'] ?? args['username'] ?? '').trim();
    if (!id) {
      return toolText('id is required', true);
    }
    try {
      const response = await fetch(`${API_ORIGIN}/api/account/${encodeURIComponent(id)}`);
      const body = await response.text();
      return toolText(body, !response.ok);
    } catch (error) {
      return toolText(`Account lookup failed: ${error instanceof Error ? error.message : 'unknown error'}`, true);
    }
  }

  if (name === 'canonical_url') {
    const identifier = String(args['identifier'] ?? args['id'] ?? '').trim();
    const result = canonicalUrlFor(identifier);
    if ('error' in result) {
      return toolText(result.error, true);
    }
    return toolText(JSON.stringify(result));
  }

  if (name === 'site_info') {
    return toolText(
      JSON.stringify({
        name: 'Nostria',
        url: ORIGIN,
        description: 'Nostr client for posts, articles, music, podcasts, and streams.',
        auth: `${ORIGIN}/auth.md`,
        mcp: `${ORIGIN}/mcp`,
      }),
    );
  }

  return toolText(`Unknown tool: ${name}`, true);
}

const MCP_TOOLS = [
  {
    name: 'resolve_nip05',
    description: 'Resolve a Nostria NIP-05 name to a Nostr pubkey.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Local part, e.g. alice or alice@nostria.app' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_public_account',
    description: 'Fetch a public Nostria account record by username or hex pubkey.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Username or hex pubkey' },
      },
      required: ['id'],
    },
  },
  {
    name: 'canonical_url',
    description: 'Build the canonical Nostria URL for an npub, note, nevent, naddr, or username.',
    inputSchema: {
      type: 'object',
      properties: {
        identifier: { type: 'string', description: 'npub, nprofile, note, nevent, naddr, hex, or username' },
      },
      required: ['identifier'],
    },
  },
  {
    name: 'site_info',
    description: 'Describe Nostria and list agent discovery URLs.',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function handleMcpMessage(message: JsonRpcRequest): Promise<unknown> {
  const method = message.method;
  const id = message.id;

  if (method === 'initialize') {
    return jsonRpcResult(id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: {
        name: 'nostria',
        version: '4.1.72',
        description: 'Public Nostria discovery tools',
      },
    });
  }

  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return null;
  }

  if (method === 'ping') {
    return jsonRpcResult(id, {});
  }

  if (method === 'tools/list') {
    return jsonRpcResult(id, { tools: MCP_TOOLS });
  }

  if (method === 'resources/list') {
    return jsonRpcResult(id, { resources: [] });
  }

  if (method === 'prompts/list') {
    return jsonRpcResult(id, { prompts: [] });
  }

  if (method === 'tools/call') {
    const params = (message.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    const name = params.name ?? '';
    const args = params.arguments ?? {};
    const result = await callMcpTool(name, args);
    return jsonRpcResult(id, result);
  }

  if (id === undefined) {
    return null;
  }
  return jsonRpcError(id, -32601, `Method not found: ${method ?? 'unknown'}`);
}

function skillsIndexFromDisk(browserDistFolder: string): unknown | null {
  const skillsRoot = join(browserDistFolder, '.well-known', 'agent-skills');
  if (!existsSync(skillsRoot)) {
    return null;
  }

  const skills: Array<{
    name: string;
    type: 'skill-md';
    description: string;
    url: string;
    digest: string;
  }> = [];

  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillFile = join(skillsRoot, entry.name, 'SKILL.md');
    if (!existsSync(skillFile)) {
      continue;
    }
    const raw = readFileSync(skillFile);
    const text = raw.toString('utf8');
    const descMatch = text.match(/^description:\s*(.+)$/m);
    const description = descMatch ? descMatch[1].trim() : entry.name;
    skills.push({
      name: entry.name,
      type: 'skill-md',
      description,
      url: `/.well-known/agent-skills/${entry.name}/SKILL.md`,
      digest: `sha256:${createHash('sha256').update(raw).digest('hex')}`,
    });
  }

  if (skills.length === 0) {
    return null;
  }

  return {
    $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
    skills,
  };
}

export function registerAgentDiscovery(app: Express, browserDistFolder: string): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' && (req.path === '/' || req.path === '')) {
      const existing = res.getHeader('Link');
      const nextValue = HOMEPAGE_LINK_VALUES.join(', ');
      if (typeof existing === 'string' && existing.length > 0) {
        res.setHeader('Link', `${existing}, ${nextValue}`);
      } else {
        res.setHeader('Link', nextValue);
      }
    }
    next();
  });

  for (const entry of TYPED_DISCOVERY_FILES) {
    app.get(entry.path, (_req, res) => {
      sendDiscoveryFile(browserDistFolder, entry.file, entry.type, res);
    });
  }

  app.get('/.well-known/agent-skills/index.json', (_req, res) => {
    const generated = skillsIndexFromDisk(browserDistFolder);
    if (generated) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', DISCOVERY_CACHE);
      res.status(200).send(JSON.stringify(generated));
      return;
    }
    sendDiscoveryFile(
      browserDistFolder,
      join('.well-known', 'agent-skills', 'index.json'),
      'application/json; charset=utf-8',
      res,
    );
  });

  app.use(
    '/.well-known/agent-skills',
    express.static(join(browserDistFolder, '.well-known', 'agent-skills'), {
      dotfiles: 'allow',
      setHeaders(res, filePath) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (filePath.endsWith('.md')) {
          res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        }
      },
    }),
  );

  app.get('/status/health', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ status: 'ok' });
  });

  app.get('/agent/auth', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).json({
      register_uri: `${ORIGIN}/agent/auth`,
      documentation: `${ORIGIN}/auth.md`,
      method: 'NIP-98',
      identity_types_supported: ['anonymous'],
      credential_types_supported: ['nostr_nip98'],
    });
  });

  const nip98Body = express.json({ limit: '32kb' });
  const nip98Form = express.urlencoded({ extended: false });

  app.post('/agent/identity', nip98Body, (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(400).json(NIP98_UNSUPPORTED);
  });

  app.post('/agent/identity/claim', nip98Body, (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(400).json(NIP98_UNSUPPORTED);
  });

  app.get('/agent/identity/claim', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({
      ...NIP98_UNSUPPORTED,
      claim_uri: `${ORIGIN}/agent/identity/claim`,
    });
  });

  app.get('/oauth2/authorize', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(400).json({
      error: 'unsupported_response_type',
      error_description: NIP98_UNSUPPORTED.error_description,
      documentation: NIP98_UNSUPPORTED.documentation,
    });
  });

  app.post('/oauth2/token', nip98Form, nip98Body, (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: NIP98_UNSUPPORTED.error_description,
      documentation: NIP98_UNSUPPORTED.documentation,
    });
  });

  app.post('/oauth2/revoke', nip98Form, nip98Body, (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({ revoked: false, documentation: NIP98_UNSUPPORTED.documentation });
  });

  app.get('/mcp', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).json({
      protocolVersion: '2025-06-18',
      transport: 'streamable-http',
      endpoint: `${ORIGIN}/mcp`,
      documentation: `${ORIGIN}/.well-known/mcp/server-card.json`,
    });
  });

  app.post('/mcp', nip98Body, async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    try {
      const payload = req.body as JsonRpcRequest | JsonRpcRequest[];
      if (Array.isArray(payload)) {
        const results = [];
        for (const message of payload) {
          const handled = await handleMcpMessage(message);
          if (handled) {
            results.push(handled);
          }
        }
        res.status(200).json(results);
        return;
      }

      const handled = await handleMcpMessage(payload);
      if (handled === null) {
        res.status(202).end();
        return;
      }
      res.status(200).json(handled);
    } catch (error) {
      console.error('[MCP] Error:', error);
      res.status(200).json(jsonRpcError(null, -32603, 'Internal error'));
    }
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    if (isMarkdownExcludedPath(req.path)) {
      next();
      return;
    }
    if (!prefersMarkdown(req.headers.accept)) {
      next();
      return;
    }
    sendMarkdown(req.path, res);
  });
}
