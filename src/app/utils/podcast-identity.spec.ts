import { getPublicKey, nip19 } from 'nostr-tools';
import {
  buildPodcastLoginCredentials,
  buildPodcastProfileContent,
  deriveShortProfileName,
  emptyPodcastProfile,
  generatePodcastKeypair,
  parsePodcastIdentityJson,
  parsePodcastIdentitySecret,
  profileToShowDraft,
} from './podcast-identity';

describe('podcast identity', () => {
  it('builds login-dialog compatible credentials from a generated key', () => {
    const { secretKey, pubkey, npub } = generatePodcastKeypair();
    const credentials = buildPodcastLoginCredentials(secretKey);

    expect(credentials.pubkey).toBe(pubkey);
    expect(credentials.npub).toBe(npub);
    expect(credentials.nsec.startsWith('nsec1')).toBe(true);
    expect(credentials.privkey).toMatch(/^[0-9a-f]{64}$/);
    expect(getPublicKey(secretKey)).toBe(pubkey);
    expect(nip19.decode(credentials.nsec).type).toBe('nsec');
    expect(parsePodcastIdentitySecret(credentials.nsec).pubkey).toBe(pubkey);
    expect(parsePodcastIdentitySecret(credentials.privkey).pubkey).toBe(pubkey);
    expect(parsePodcastIdentityJson(JSON.stringify(credentials)).pubkey).toBe(pubkey);
  });

  it('serializes kind 0 content and copies profile fields onto show metadata', () => {
    const profile = {
      ...emptyPodcastProfile(),
      name: 'Relay Talk',
      displayName: 'Relay Talk Show',
      about: 'Weekly notes',
      picture: 'https://cdn.example.com/show.jpg',
      website: 'https://example.com',
    };

    expect(JSON.parse(buildPodcastProfileContent({
      ...profile,
      lud16: 'show@getalby.com',
    }))).toEqual({
      name: 'Relay Talk',
      display_name: 'Relay Talk Show',
      about: 'Weekly notes',
      picture: 'https://cdn.example.com/show.jpg',
      website: 'https://example.com',
      lud16: 'show@getalby.com',
    });
    expect(profileToShowDraft(profile)).toEqual({
      title: 'Relay Talk Show',
      description: 'Weekly notes',
      imageUrl: 'https://cdn.example.com/show.jpg',
      website: 'https://example.com',
    });
    expect(deriveShortProfileName('Relay Talk Show')).toBe('relaytalkshow');
  });

  it('parses identity JSON that only has a privkey and rejects invalid secrets', () => {
    const { secretKey, pubkey } = generatePodcastKeypair();
    const credentials = buildPodcastLoginCredentials(secretKey);

    expect(parsePodcastIdentityJson(JSON.stringify({ privkey: credentials.privkey })).pubkey).toBe(pubkey);
    expect(() => parsePodcastIdentitySecret('')).toThrow('Empty identity');
    expect(() => parsePodcastIdentitySecret('npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq5sy4l2')).toThrow();
    expect(() => parsePodcastIdentityJson('{')).toThrow('Invalid credentials file format');
    expect(() => parsePodcastIdentityJson(JSON.stringify({ npub: credentials.npub }))).toThrow(
      'Invalid credentials file format',
    );
  });
});
