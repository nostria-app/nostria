import { ReportingService } from './reporting.service';

describe('ReportingService', () => {
  describe('stripNostrUrisAndUrls', () => {
    it('should strip nostr:npub URIs', () => {
      const content = 'Hello nostr:npub10jvs984jmel09egmvuxndhtjnqhtlyp3wyqdgjnmucdvvd7q5cvq7pmas8 world';
      const result = ReportingService.stripNostrUrisAndUrls(content);
      expect(result).toBe('Hello   world');
    });

    it('should strip nostr:nprofile URIs', () => {
      const content = 'Check nostr:nprofile1abc123def456ghi world';
      const result = ReportingService.stripNostrUrisAndUrls(content);
      expect(result).toBe('Check   world');
    });

    it('should strip nostr:nevent URIs', () => {
      const content = 'See nostr:nevent1qvzqqqqqqypzpa9hhag3wymekqxfcqqwsz3fplfj7yxnmpfnvmwn0qpc2k8f5ds9qy2hwumn8ghj7un9d3shjtnwdaehgu3wdp6j7qpq3atmkylmlmcqc3uemk63tp06y9wp0rc86kx4l89agpev5qdg9gusa5qfjk end';
      const result = ReportingService.stripNostrUrisAndUrls(content);
      expect(result).toBe('See   end');
    });

    it('should strip nostr:note URIs', () => {
      const content = 'Look at nostr:note1abc123 here';
      const result = ReportingService.stripNostrUrisAndUrls(content);
      expect(result).toBe('Look at   here');
    });

    it('should strip nostr:naddr URIs', () => {
      const content = 'Read nostr:naddr1abc123def please';
      const result = ReportingService.stripNostrUrisAndUrls(content);
      expect(result).toBe('Read   please');
    });

    it('should strip HTTP URLs', () => {
      const content = 'Visit http://example.com/page here';
      const result = ReportingService.stripNostrUrisAndUrls(content);
      expect(result).toBe('Visit   here');
    });

    it('should strip HTTPS URLs', () => {
      const content = 'Visit https://nostria.app/e/something here';
      const result = ReportingService.stripNostrUrisAndUrls(content);
      expect(result).toBe('Visit   here');
    });

    it('should strip multiple nostr URIs and URLs', () => {
      const content = 'Hello nostr:npub1abc123 and https://example.com world';
      const result = ReportingService.stripNostrUrisAndUrls(content);
      expect(result).toBe('Hello   and   world');
    });

    it('should handle content with no URIs', () => {
      const content = 'Just a normal message';
      const result = ReportingService.stripNostrUrisAndUrls(content);
      expect(result).toBe('Just a normal message');
    });

    it('should handle empty content', () => {
      expect(ReportingService.stripNostrUrisAndUrls('')).toBe('');
    });
  });

  describe('wordMatchesMutedWord', () => {
    it('should match exact word (case insensitive)', () => {
      expect(ReportingService.wordMatchesMutedWord('GM everyone!', 'gm')).toBeTrue();
      expect(ReportingService.wordMatchesMutedWord('gm everyone!', 'GM')).toBeTrue();
      expect(ReportingService.wordMatchesMutedWord('Gm everyone!', 'gm')).toBeTrue();
    });

    it('should match word at start of text', () => {
      expect(ReportingService.wordMatchesMutedWord('GM!', 'gm')).toBeTrue();
      expect(ReportingService.wordMatchesMutedWord('GM to all', 'gm')).toBeTrue();
    });

    it('should match word at end of text', () => {
      expect(ReportingService.wordMatchesMutedWord('Say GM', 'gm')).toBeTrue();
    });

    it('should match word that is the entire text', () => {
      expect(ReportingService.wordMatchesMutedWord('GM', 'gm')).toBeTrue();
    });

    it('should match word followed by punctuation', () => {
      expect(ReportingService.wordMatchesMutedWord('GM!', 'gm')).toBeTrue();
      expect(ReportingService.wordMatchesMutedWord('GM.', 'gm')).toBeTrue();
      expect(ReportingService.wordMatchesMutedWord('GM,', 'gm')).toBeTrue();
    });

    it('should NOT match word as substring of another word', () => {
      expect(ReportingService.wordMatchesMutedWord('programming', 'gm')).toBeFalse();
      expect(ReportingService.wordMatchesMutedWord('telegram', 'gm')).toBeFalse();
      expect(ReportingService.wordMatchesMutedWord('enigma', 'gm')).toBeFalse();
    });

    it('should NOT match word inside npub-like strings', () => {
      // After stripping, these wouldn't appear, but test the boundary matching itself
      expect(ReportingService.wordMatchesMutedWord('abc123gm456def', 'gm')).toBeFalse();
    });

    it('should match multi-word muted phrases', () => {
      expect(ReportingService.wordMatchesMutedWord('good morning friends', 'good morning')).toBeTrue();
    });

    it('should handle special regex characters in muted word', () => {
      expect(ReportingService.wordMatchesMutedWord('price is $100', '$100')).toBeTrue();
      expect(ReportingService.wordMatchesMutedWord('test (hello) world', '(hello)')).toBeTrue();
    });
  });

  describe('contentContainsMutedWord', () => {
    it('should return false for undefined content', () => {
      expect(ReportingService.contentContainsMutedWord(undefined, ['gm'])).toBeFalse();
    });

    it('should return false for empty muted words', () => {
      expect(ReportingService.contentContainsMutedWord('GM everyone', [])).toBeFalse();
    });

    it('should match GM in actual GM post', () => {
      expect(ReportingService.contentContainsMutedWord('GM ☀️', ['gm'])).toBeTrue();
    });

    it('should match GM post with emoji and text', () => {
      expect(ReportingService.contentContainsMutedWord('GM everyone! Have a great day!', ['gm'])).toBeTrue();
    });

    it('should NOT match GM inside nostr:npub URIs', () => {
      const content = 'Hello nostr:npub10jvs984jmel09egmvuxndhtjnqhtlyp3wyqdgjnmucdvvd7q5cvq7pmas8';
      expect(ReportingService.contentContainsMutedWord(content, ['gm'])).toBeFalse();
    });

    it('should NOT match GM inside nostr:nprofile URIs', () => {
      const content = 'Check nostr:nprofile1abcgmdef123';
      expect(ReportingService.contentContainsMutedWord(content, ['gm'])).toBeFalse();
    });

    it('should NOT match GM inside nostr:nevent URIs', () => {
      const content = 'See nostr:nevent1qvzqqqqqqypzpa9hhag3wymekqxfcqqwsz3fplfj7yxnmpfnvmwn0qpc2k8f5ds9qy2hwumn8ghj7un9d3shjtnwdaehgu3wdp6j7qpq3atmkylmlmcqc3uemk63tp06y9wp0rc86kx4l89agpev5qdg9gusa5qfjk';
      expect(ReportingService.contentContainsMutedWord(content, ['gm'])).toBeFalse();
    });

    it('should NOT match GM inside URLs', () => {
      const content = 'Check https://example.com/gmailhelp for info';
      expect(ReportingService.contentContainsMutedWord(content, ['gm'])).toBeFalse();
    });

    it('should match GM in content that also has npub references', () => {
      const content = 'GM nostr:npub10jvs984jmel09egmvuxndhtjnqhtlyp3wyqdgjnmucdvvd7q5cvq7pmas8';
      expect(ReportingService.contentContainsMutedWord(content, ['gm'])).toBeTrue();
    });

    it('should NOT match muted word as substring in regular text', () => {
      const content = 'I love programming and algorithms';
      expect(ReportingService.contentContainsMutedWord(content, ['gm'])).toBeFalse();
    });

    it('should match multiple muted words', () => {
      const content = 'GM everyone! Have a blessed day!';
      expect(ReportingService.contentContainsMutedWord(content, ['hello', 'gm'])).toBeTrue();
    });

    it('should not match when no muted words are in content', () => {
      const content = 'Hello everyone! Have a great day!';
      expect(ReportingService.contentContainsMutedWord(content, ['gm', 'spam'])).toBeFalse();
    });
  });

  describe('fieldsContainMutedWord', () => {
    it('should return false for empty fields', () => {
      expect(ReportingService.fieldsContainMutedWord([], ['gm'])).toBeFalse();
    });

    it('should return false for empty muted words', () => {
      expect(ReportingService.fieldsContainMutedWord(['test'], [])).toBeFalse();
    });

    it('should match muted word in profile name', () => {
      expect(ReportingService.fieldsContainMutedWord(['spammer', 'GM Bot'], ['gm'])).toBeTrue();
    });

    it('should NOT match muted word as substring in profile name', () => {
      expect(ReportingService.fieldsContainMutedWord(['programmer'], ['gm'])).toBeFalse();
    });

    it('should match case-insensitively', () => {
      expect(ReportingService.fieldsContainMutedWord(['GM Master'], ['gm'])).toBeTrue();
      expect(ReportingService.fieldsContainMutedWord(['gm lover'], ['GM'])).toBeTrue();
    });
  });
});
