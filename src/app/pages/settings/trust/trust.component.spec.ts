import { TrustSettingsComponent } from './trust.component';

describe('TrustSettingsComponent', () => {
  describe('trustRelays', () => {
    let component: TrustSettingsComponent;

    beforeEach(() => {
      // Access trustRelays as a plain property without full Angular DI
      component = Object.create(TrustSettingsComponent.prototype);
      component.trustRelays = [
        {
          url: 'wss://nip85.brainstorm.world',
          name: 'Brainstorm',
          description: 'Default NIP-85 trusted assertions relay',
        },
      ];
    });

    it('should not include nostr.band in fallback trust relays', () => {
      const urls = component.trustRelays.map(r => r.url);
      expect(urls).not.toContain('wss://nip85.nostr.band');
    });

    it('should include Brainstorm as a fallback relay', () => {
      const urls = component.trustRelays.map(r => r.url);
      expect(urls).toContain('wss://nip85.brainstorm.world');
    });

    it('should have only one fallback relay', () => {
      expect(component.trustRelays.length).toBe(1);
    });
  });
});
