import { UtilitiesService } from './utilities.service';
import { nip19 } from 'nostr-tools';

describe('UtilitiesService nprofile handling', () => {
  let service: UtilitiesService;

  // A known valid hex pubkey for testing
  const testHexPubkey = '7460e57a4d77fc2e2e2e3e071a80f14745c3c3e98db0b16995a5e9a0bc104b27';
  const testRelays = ['wss://relay.damus.io', 'wss://relay.nostr.band', 'wss://nos.lol'];

  beforeEach(() => {
    service = new UtilitiesService();
  });

  describe('isValidPubkey', () => {
    it('should accept a valid hex pubkey', () => {
      expect(service.isValidPubkey(testHexPubkey)).toBe(true);
    });

    it('should accept a valid npub', () => {
      const npub = nip19.npubEncode(testHexPubkey);
      expect(service.isValidPubkey(npub)).toBe(true);
    });

    it('should accept a valid nprofile', () => {
      const nprofile = nip19.nprofileEncode({
        pubkey: testHexPubkey,
        relays: testRelays,
      });
      expect(service.isValidPubkey(nprofile)).toBe(true);
    });

    it('should accept an nprofile with no relays', () => {
      const nprofile = nip19.nprofileEncode({
        pubkey: testHexPubkey,
        relays: [],
      });
      expect(service.isValidPubkey(nprofile)).toBe(true);
    });

    it('should reject an invalid string', () => {
      expect(service.isValidPubkey('invalid')).toBe(false);
    });

    it('should reject an empty string', () => {
      expect(service.isValidPubkey('')).toBe(false);
    });
  });

  describe('safeGetHexPubkey', () => {
    it('should return hex pubkey from a valid hex string', () => {
      expect(service.safeGetHexPubkey(testHexPubkey)).toBe(testHexPubkey);
    });

    it('should return hex pubkey from a valid npub', () => {
      const npub = nip19.npubEncode(testHexPubkey);
      expect(service.safeGetHexPubkey(npub)).toBe(testHexPubkey);
    });

    it('should return hex pubkey from an nprofile with relays', () => {
      const nprofile = nip19.nprofileEncode({
        pubkey: testHexPubkey,
        relays: testRelays,
      });
      expect(service.safeGetHexPubkey(nprofile)).toBe(testHexPubkey);
    });

    it('should return hex pubkey from an nprofile with no relays', () => {
      const nprofile = nip19.nprofileEncode({
        pubkey: testHexPubkey,
        relays: [],
      });
      expect(service.safeGetHexPubkey(nprofile)).toBe(testHexPubkey);
    });

    it('should return hex pubkey from an nprofile with many relays', () => {
      const manyRelays = [
        'wss://relay1.example.com',
        'wss://relay2.example.com',
        'wss://relay3.example.com',
        'wss://relay4.example.com',
        'wss://relay5.example.com',
      ];
      const nprofile = nip19.nprofileEncode({
        pubkey: testHexPubkey,
        relays: manyRelays,
      });
      expect(service.safeGetHexPubkey(nprofile)).toBe(testHexPubkey);
    });

    it('should return null for an invalid nprofile', () => {
      expect(service.safeGetHexPubkey('nprofile1invalid')).toBeNull();
    });

    it('should return null for an invalid string', () => {
      expect(service.safeGetHexPubkey('invalid')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(service.safeGetHexPubkey('')).toBeNull();
    });
  });

  describe('getNpubFromPubkey', () => {
    it('should convert a valid hex pubkey to npub', () => {
      const npub = service.getNpubFromPubkey(testHexPubkey);
      expect(npub).toBeTruthy();
      expect(npub.startsWith('npub1')).toBe(true);

      // Verify round-trip
      const decoded = nip19.decode(npub);
      expect(decoded.data).toBe(testHexPubkey);
    });

    it('should throw for an nprofile string (not a hex pubkey)', () => {
      const nprofile = nip19.nprofileEncode({
        pubkey: testHexPubkey,
        relays: testRelays,
      });

      // This is the bug scenario - passing nprofile to getNpubFromPubkey should throw
      expect(() => service.getNpubFromPubkey(nprofile)).toThrow();
    });
  });

  describe('nprofile encoding/decoding round-trip', () => {
    it('should produce a shorter nprofile with 1 relay vs 3 relays', () => {
      const nprofile1 = nip19.nprofileEncode({
        pubkey: testHexPubkey,
        relays: testRelays.slice(0, 1),
      });
      const nprofile3 = nip19.nprofileEncode({
        pubkey: testHexPubkey,
        relays: testRelays,
      });
      expect(nprofile1.length).toBeLessThan(nprofile3.length);
    });

    it('should extract pubkey from nprofile regardless of relay count', () => {
      for (let i = 0; i <= testRelays.length; i++) {
        const nprofile = nip19.nprofileEncode({
          pubkey: testHexPubkey,
          relays: testRelays.slice(0, i),
        });
        const decoded = nip19.decode(nprofile);
        expect(decoded.type).toBe('nprofile');
        if (decoded.type === 'nprofile') {
          expect(decoded.data.pubkey).toBe(testHexPubkey);
        }
      }
    });

    it('should preserve relay hints in decoded nprofile', () => {
      const relay = 'wss://relay.damus.io';
      const nprofile = nip19.nprofileEncode({
        pubkey: testHexPubkey,
        relays: [relay],
      });
      const decoded = nip19.decode(nprofile);
      if (decoded.type === 'nprofile') {
        expect(decoded.data.relays).toContain(relay);
      }
    });
  });
});
