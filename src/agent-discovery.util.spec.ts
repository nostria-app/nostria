import { canonicalUrlFor, isMarkdownExcludedPath, markdownForPath, prefersMarkdown } from './agent-discovery.util';

describe('agent discovery helpers', () => {
  describe('prefersMarkdown', () => {
    it('returns false when Accept is missing or HTML-only', () => {
      expect(prefersMarkdown(undefined)).toBe(false);
      expect(prefersMarkdown('text/html,application/xhtml+xml;q=0.9')).toBe(false);
    });

    it('returns true for explicit markdown', () => {
      expect(prefersMarkdown('text/markdown')).toBe(true);
      expect(prefersMarkdown('text/markdown, text/html;q=0.9')).toBe(true);
    });

    it('returns false when HTML is preferred over markdown', () => {
      expect(prefersMarkdown('text/html, text/markdown;q=0.8')).toBe(false);
    });
  });

  describe('isMarkdownExcludedPath', () => {
    it('excludes discovery, API, and static assets', () => {
      expect(isMarkdownExcludedPath('/.well-known/api-catalog')).toBe(true);
      expect(isMarkdownExcludedPath('/mcp')).toBe(true);
      expect(isMarkdownExcludedPath('/status/health')).toBe(true);
      expect(isMarkdownExcludedPath('/robots.txt')).toBe(true);
      expect(isMarkdownExcludedPath('/main.js')).toBe(true);
    });

    it('allows HTML app routes', () => {
      expect(isMarkdownExcludedPath('/')).toBe(false);
      expect(isMarkdownExcludedPath('/p/npub1abc')).toBe(false);
      expect(isMarkdownExcludedPath('/search')).toBe(false);
    });
  });

  describe('markdownForPath', () => {
    it('describes the homepage with discovery URLs', () => {
      const md = markdownForPath('/');
      expect(md.startsWith('# Nostria')).toBe(true);
      expect(md).toContain('https://nostria.app/auth.md');
      expect(md).toContain('Accept: text/markdown');
    });

    it('includes the canonical profile URL', () => {
      const md = markdownForPath('/p/npub1abc');
      expect(md).toContain('https://nostria.app/p/npub1abc');
    });
  });

  describe('canonicalUrlFor', () => {
    it('maps nostr identifiers to app paths', () => {
      expect(canonicalUrlFor('npub1abc')).toEqual({
        url: 'https://nostria.app/p/npub1abc',
        kind: 'profile',
      });
      expect(canonicalUrlFor('note1abc')).toEqual({
        url: 'https://nostria.app/e/note1abc',
        kind: 'post',
      });
      expect(canonicalUrlFor('naddr1abc')).toEqual({
        url: 'https://nostria.app/a/naddr1abc',
        kind: 'article',
      });
    });

    it('refuses nsec values', () => {
      const result = canonicalUrlFor('nsec1secret');
      expect('error' in result).toBe(true);
    });
  });
});
