import { urlsToMarkdownLinks } from './utils';

describe('format utils', () => {
  describe('urlsToMarkdownLinks', () => {
    it('converts bare domains to markdown links', () => {
      const result = urlsToMarkdownLinks('Check app.social and mywebsite.com today');

      expect(result).toContain('[app.social](https://app.social)');
      expect(result).toContain('[mywebsite.com](https://mywebsite.com)');
    });

    it('converts protocol URLs to markdown links', () => {
      const result = urlsToMarkdownLinks('Visit https://nostria.app/path?tab=1');

      expect(result).toContain('[https://nostria.app/path?tab=1](https://nostria.app/path?tab=1)');
    });

    it('does not modify markdown link targets', () => {
      const result = urlsToMarkdownLinks('Use [Nostria](mywebsite.com) link syntax');

      expect(result).toBe('Use [Nostria](mywebsite.com) link syntax');
    });

    it('does not convert email domains', () => {
      const result = urlsToMarkdownLinks('Email me at hello@mywebsite.com');

      expect(result).toBe('Email me at hello@mywebsite.com');
    });

    it('keeps punctuation outside generated links', () => {
      const result = urlsToMarkdownLinks('See app.social, then mywebsite.com.');

      expect(result).toContain('[app.social](https://app.social),');
      expect(result).toContain('[mywebsite.com](https://mywebsite.com).');
    });
  });
});
