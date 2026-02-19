import { normalizeMarkdownLinkDestinations, urlsToMarkdownLinks } from './utils';

describe('format utils', () => {
  describe('normalizeMarkdownLinkDestinations', () => {
    it('trims whitespace around markdown link destination URLs', () => {
      const result = normalizeMarkdownLinkDestinations('Read [NIP-11]( https://github.com/nostr-protocol/nips/pull/1946 ) now');

      expect(result).toBe('Read [NIP-11](https://github.com/nostr-protocol/nips/pull/1946) now');
    });

    it('leaves normal markdown links unchanged', () => {
      const result = normalizeMarkdownLinkDestinations('Read [NIP-11](https://github.com/nostr-protocol/nips/pull/1946) now');

      expect(result).toBe('Read [NIP-11](https://github.com/nostr-protocol/nips/pull/1946) now');
    });
  });

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

    it('normalizes markdown link URLs with leading whitespace after opening parenthesis', () => {
      const result = urlsToMarkdownLinks('launches an [NWC developer sandbox]( https://sandbox.albylabs.com) today');

      expect(result).toBe('launches an [NWC developer sandbox](https://sandbox.albylabs.com) today');
    });

    it('normalizes markdown link URLs with surrounding whitespace', () => {
      const result = urlsToMarkdownLinks('see [NIP-11](   https://github.com/nostr-protocol/nips/pull/1946   ) update');

      expect(result).toBe('see [NIP-11](https://github.com/nostr-protocol/nips/pull/1946) update');
    });

    it('keeps punctuation outside generated links', () => {
      const result = urlsToMarkdownLinks('See app.social, then mywebsite.com.');

      expect(result).toContain('[app.social](https://app.social),');
      expect(result).toContain('[mywebsite.com](https://mywebsite.com).');
    });

    it('repairs malformed markdown links missing opening bracket', () => {
      const result = urlsToMarkdownLinks('See NIP-11)](https://github.com/nostr-protocol/nips/pull/1946) updates');

      expect(result).toBe('See [NIP-11](https://github.com/nostr-protocol/nips/pull/1946) updates');
    });

    it('repairs malformed markdown links with multi-word labels', () => {
      const result = urlsToMarkdownLinks('New projects include Primal Android)](https://github.com/PrimalHQ/primal-android-app) now');

      expect(result).toBe('New projects include [Primal Android](https://github.com/PrimalHQ/primal-android-app) now');
    });

    it('does not swallow preceding sentence text when repairing malformed links', () => {
      const result = urlsToMarkdownLinks('fiatjaf strips unused fields from NIP-11)](https://github.com/nostr-protocol/nips/pull/1946) quickly');

      expect(result).toBe('fiatjaf strips unused fields from [NIP-11](https://github.com/nostr-protocol/nips/pull/1946) quickly');
    });

    it('removes one extra trailing parenthesis after repaired links', () => {
      const result = urlsToMarkdownLinks('NIP-85)](https://github.com/nostr-protocol/nips/pull/2223)) merges guidance');

      expect(result).toBe('[NIP-85](https://github.com/nostr-protocol/nips/pull/2223) merges guidance');
    });

    it('does not alter already valid links with parentheses in text', () => {
      const result = urlsToMarkdownLinks('Use [NIP-11)](https://github.com/nostr-protocol/nips/pull/1946) syntax');

      expect(result).toBe('Use [NIP-11)](https://github.com/nostr-protocol/nips/pull/1946) syntax');
    });
  });
});
