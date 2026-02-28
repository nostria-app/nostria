import { KNOWN_PROVIDERS } from '../../../services/trust-provider.service';

describe('TrustSettingsComponent', () => {
  describe('known providers fallback', () => {
    it('should not include nostr.band in fallback trust relays', () => {
      const urls = KNOWN_PROVIDERS.map(provider => provider.relayUrl);
      expect(urls).not.toContain('wss://nip85.nostr.band');
    });

    it('should include Brainstorm as a fallback relay', () => {
      const urls = KNOWN_PROVIDERS.map(provider => provider.relayUrl);
      expect(urls).toContain('wss://nip85.brainstorm.world');
    });

    it('should have only one fallback relay', () => {
      expect(KNOWN_PROVIDERS.length).toBe(1);
    });
  });
});
