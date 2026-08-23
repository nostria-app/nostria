/**
 * Agent discovery documents @public @smoke
 *
 * Static files in public/ must be served as documents, not the SPA shell.
 */
import { test, expect } from '../../fixtures';

test.describe('Agent discovery @public @smoke', () => {
  test('serves robots.txt with crawl and AI rules', async ({ request }) => {
    const response = await request.get('/robots.txt');
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('User-agent: *');
    expect(body).toContain('User-agent: GPTBot');
    expect(body).toContain('User-agent: OAI-SearchBot');
    expect(body).toContain('User-agent: Claude-Web');
    expect(body).toContain('User-agent: Google-Extended');
    expect(body).toContain('Content-Signal:');
    expect(body).toContain('Sitemap: https://nostria.app/sitemap.xml');
    expect(body.toLowerCase()).not.toContain('<html');
  });

  test('serves sitemap.xml with canonical URLs', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('<urlset');
    expect(body).toContain('<loc>https://nostria.app/</loc>');
    expect(body).toContain('<loc>https://nostria.app/discover</loc>');
  });

  test('serves auth.md as markdown', async ({ request }) => {
    const response = await request.get('/auth.md');
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toMatch(/^# .*auth\.md/m);
    expect(body).toContain('NIP-98');
    expect(body.toLowerCase()).not.toContain('<html');
  });

  test('serves RFC 9727 API catalog JSON', async ({ request }) => {
    const response = await request.get('/.well-known/api-catalog');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.linkset)).toBe(true);
    expect(body.linkset[0].anchor).toBeTruthy();
    expect(body.linkset[0]['service-desc']).toBeTruthy();
  });

  test('serves OAuth protected resource metadata', async ({ request }) => {
    const response = await request.get('/.well-known/oauth-protected-resource');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.resource).toBe('https://api.nostria.app/');
    expect(body.authorization_servers).toContain('https://nostria.app');
    expect(body.bearer_methods_supported).toContain('header');
  });

  test('serves OAuth authorization server metadata with agent_auth', async ({ request }) => {
    const response = await request.get('/.well-known/oauth-authorization-server');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.issuer).toBe('https://nostria.app');
    expect(body.authorization_endpoint).toBeTruthy();
    expect(body.token_endpoint).toBeTruthy();
    expect(body.jwks_uri).toBeTruthy();
    expect(body.agent_auth.skill).toContain('/auth.md');
    expect(body.agent_auth.register_uri).toBeTruthy();
  });

  test('serves MCP server card', async ({ request }) => {
    const response = await request.get('/.well-known/mcp/server-card.json');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.serverInfo.name).toBeTruthy();
    expect(body.serverInfo.version).toBeTruthy();
    expect(body.endpoint || body.transport?.endpoint || body.transport?.url).toContain('/mcp');
  });

  test('serves agent skills index', async ({ request }) => {
    const response = await request.get('/.well-known/agent-skills/index.json');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.$schema).toContain('0.2.0');
    expect(body.skills.length).toBeGreaterThan(0);
    for (const skill of body.skills) {
      expect(skill.name).toBeTruthy();
      expect(skill.type).toBe('skill-md');
      expect(skill.description).toBeTruthy();
      expect(skill.url).toBeTruthy();
      expect(skill.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });

  test('serves ARD ai-catalog.json', async ({ request }) => {
    const response = await request.get('/.well-known/ai-catalog.json');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.specVersion).toBeTruthy();
    expect(body.host.displayName).toBe('Nostria');
    expect(body.entries.length).toBeGreaterThan(0);
    for (const entry of body.entries) {
      expect(entry.identifier).toMatch(/^urn:air:nostria.app:/);
      expect(entry.displayName).toBeTruthy();
      expect(entry.type).toBeTruthy();
      expect(Boolean(entry.url) !== Boolean(entry.data)).toBe(true);
      expect(entry.representativeQueries.length).toBeGreaterThanOrEqual(2);
    }
  });

  test('registers WebMCP on homepage load', async ({ page }) => {
    await page.addInitScript(() => {
      const registered: string[] = [];
      const modelContext = {
        provideContext(input: { tools?: Array<{ name: string }> }) {
          for (const tool of input.tools ?? []) {
            registered.push(tool.name);
          }
        },
        registerTool(tool: { name: string }) {
          registered.push(tool.name);
        },
      };
      Object.defineProperty(navigator, 'modelContext', {
        configurable: true,
        get: () => modelContext,
      });
      (window as unknown as { __webmcpTools?: string[] }).__webmcpTools = registered;
    });

    await page.goto('/');
    await page.waitForFunction(() => {
      const tools = (window as unknown as { __webmcpTools?: string[] }).__webmcpTools;
      return Array.isArray(tools) && tools.length > 0;
    });
    const tools = await page.evaluate(() => (window as unknown as { __webmcpTools?: string[] }).__webmcpTools);
    expect(tools).toContain('search');
    expect(tools).toContain('open_profile');
  });
});
