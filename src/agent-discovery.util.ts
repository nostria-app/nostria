const ORIGIN = 'https://nostria.app';
const API_ORIGIN = 'https://api.nostria.app';

export function prefersMarkdown(accept: string | undefined): boolean {
  if (!accept) {
    return false;
  }

  let markdownQ = -1;
  let htmlQ = -1;

  for (const part of accept.split(',')) {
    const [rawType, ...params] = part.split(';').map(value => value.trim());
    const type = rawType.toLowerCase();
    const qParam = params.find(param => param.toLowerCase().startsWith('q='));
    const quality = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
    if (Number.isNaN(quality)) {
      continue;
    }
    if (type === 'text/markdown' || type === 'text/x-markdown') {
      markdownQ = quality;
    }
    if (type === 'text/html') {
      htmlQ = quality;
    }
  }

  if (markdownQ < 0) {
    return false;
  }
  if (htmlQ < 0) {
    return true;
  }
  return markdownQ >= htmlQ;
}

export function isMarkdownExcludedPath(path: string): boolean {
  if (
    path.startsWith('/.well-known') ||
    path.startsWith('/mcp') ||
    path.startsWith('/oauth') ||
    path.startsWith('/agent/') ||
    path.startsWith('/status/') ||
    path.startsWith('/api/')
  ) {
    return true;
  }
  return /\.(js|mjs|css|map|png|jpe?g|webp|gif|svg|ico|woff2?|ttf|otf|wasm|json|xml|txt|md|webmanifest)$/i.test(path);
}

export function markdownForPath(path: string): string {
  const canonical = `${ORIGIN}${path === '/' ? '/' : path}`;

  if (path === '/' || path === '') {
    return `# Nostria

Nostria is a Nostr client at ${ORIGIN}. It is a decentralized social network for posts, articles, music, podcasts, live streams, and encrypted messages.

## Agent resources

- Auth: ${ORIGIN}/auth.md
- robots.txt: ${ORIGIN}/robots.txt
- sitemap.xml: ${ORIGIN}/sitemap.xml
- API catalog: ${ORIGIN}/.well-known/api-catalog
- ARD catalog: ${ORIGIN}/.well-known/ai-catalog.json
- MCP: POST ${ORIGIN}/mcp
- Skills: ${ORIGIN}/.well-known/agent-skills/index.json
- OpenAPI (web): ${ORIGIN}/openapi.json
- OpenAPI (backend): ${API_ORIGIN}/openapi.json
- NIP-05: ${ORIGIN}/.well-known/nostr.json?name={name}

## Canonical URLs

- Profile: ${ORIGIN}/p/{npub|nprofile|hex}
- Username: ${ORIGIN}/u/{name}
- Post: ${ORIGIN}/e/{note|nevent|hex}
- Article: ${ORIGIN}/a/{naddr}
- Search: ${ORIGIN}/search?q={query}

HTTP APIs at ${API_ORIGIN}/api/ authenticate with NIP-98. Public profile and event pages need no credentials.

Request pages with \`Accept: text/markdown\` to receive markdown instead of HTML.
`;
  }

  if (path.startsWith('/p/')) {
    const id = decodeURIComponent(path.slice(3));
    return `# Nostria profile

Canonical URL: ${canonical}

This page is a Nostr profile for \`${id}\`. Fetch kind 0 metadata from relays, or GET \`${API_ORIGIN}/api/account/${encodeURIComponent(id)}\` for a Nostria account record when the user has one.
`;
  }

  if (path.startsWith('/u/')) {
    const name = decodeURIComponent(path.slice(3));
    return `# Nostria user

Canonical URL: ${canonical}

NIP-05 lookup: ${ORIGIN}/.well-known/nostr.json?name=${encodeURIComponent(name)}
`;
  }

  if (path.startsWith('/e/')) {
    const id = decodeURIComponent(path.slice(3));
    return `# Nostria post

Canonical URL: ${canonical}

This page renders Nostr event \`${id}\`. Fetch it from relays; Nostria does not host a canonical event API.
`;
  }

  if (path.startsWith('/a/')) {
    const id = decodeURIComponent(path.slice(3));
    return `# Nostria article

Canonical URL: ${canonical}

Long-form Nostr article \`${id}\` (NIP-23 / naddr).
`;
  }

  return `# Nostria

Canonical URL: ${canonical}

Nostria is a Nostr client. See ${ORIGIN}/llms.txt and ${ORIGIN}/auth.md for agent instructions.
`;
}

export function canonicalUrlFor(identifier: string): { url: string; kind: string } | { error: string } {
  const id = identifier.trim();
  if (!id) {
    return { error: 'identifier is required' };
  }
  if (id.toLowerCase().startsWith('nsec')) {
    return { error: 'Refusing nsec. Use npub, note, nevent, naddr, or a username.' };
  }
  if (id.startsWith('npub') || id.startsWith('nprofile')) {
    return { url: `${ORIGIN}/p/${encodeURIComponent(id)}`, kind: 'profile' };
  }
  if (id.startsWith('note') || id.startsWith('nevent')) {
    return { url: `${ORIGIN}/e/${encodeURIComponent(id)}`, kind: 'post' };
  }
  if (id.startsWith('naddr')) {
    return { url: `${ORIGIN}/a/${encodeURIComponent(id)}`, kind: 'article' };
  }
  if (/^[0-9a-f]{64}$/i.test(id)) {
    return { url: `${ORIGIN}/p/${id.toLowerCase()}`, kind: 'hex-pubkey-or-event' };
  }
  if (id.includes('@')) {
    const name = id.split('@')[0];
    return { url: `${ORIGIN}/u/${encodeURIComponent(name)}`, kind: 'nip05' };
  }
  return { url: `${ORIGIN}/u/${encodeURIComponent(id)}`, kind: 'username' };
}
