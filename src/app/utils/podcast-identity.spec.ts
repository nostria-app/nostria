import { getPublicKey, nip19 } from 'nostr-tools';
import {
  buildPodcastLoginCredentials,
  buildPodcastProfileContent,
  deriveShortProfileName,
  emptyPodcastProfile,
  generatePodcastKeypair,
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
});
