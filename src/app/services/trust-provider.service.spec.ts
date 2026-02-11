import { KNOWN_PROVIDERS } from './trust-provider.service';

describe('TrustProviderService', () => {
  describe('KNOWN_PROVIDERS', () => {
    it('should not include nostr.band relay', () => {
      const relayUrls = KNOWN_PROVIDERS.map(p => p.relayUrl);
      expect(relayUrls).not.toContain('wss://nip85.nostr.band');
    });

    it('should not include Nostr Band as a provider name', () => {
      const names = KNOWN_PROVIDERS.map(p => p.name);
      expect(names).not.toContain('Nostr Band');
    });

    it('should include Brainstorm as a known provider', () => {
      const names = KNOWN_PROVIDERS.map(p => p.name);
      expect(names).toContain('Brainstorm');
    });

    it('should have valid metadata for all providers', () => {
      for (const provider of KNOWN_PROVIDERS) {
        expect(provider.name).toBeTruthy();
        expect(provider.description).toBeTruthy();
        expect(provider.pubkey).toBeTruthy();
        expect(provider.relayUrl).toMatch(/^wss:\/\//);
        expect(provider.supportedMetrics.length).toBeGreaterThan(0);
      }
    });
  });
});
