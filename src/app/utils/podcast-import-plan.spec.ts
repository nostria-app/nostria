import { AUTHORED_PODCASTS_KIND, PODCAST_EPISODE_KIND, PODCAST_METADATA_KIND } from './podcast';
import { importEventSigner, readProfileLightningAddress, uniqueRelayUrls } from './podcast-import-plan';

describe('podcast import plan', () => {
  it('dedupes relay URLs ignoring trailing slashes', () => {
    expect(uniqueRelayUrls([
      'wss://relay.example.com/',
      'wss://relay.example.com',
      '  wss://podcast.example.com/  ',
      '',
    ])).toEqual([
      'wss://relay.example.com/',
      'wss://podcast.example.com/',
    ]);
  });

  it('signs podcast events with the generated identity and 10064 with the account', () => {
    expect(importEventSigner(0, true)).toBe('identity');
    expect(importEventSigner(10002, true)).toBe('identity');
    expect(importEventSigner(PODCAST_METADATA_KIND, true)).toBe('identity');
    expect(importEventSigner(PODCAST_EPISODE_KIND, true)).toBe('identity');
    expect(importEventSigner(AUTHORED_PODCASTS_KIND, true)).toBe('account');
    expect(importEventSigner(PODCAST_EPISODE_KIND, false)).toBe('account');
  });

  it('reads the logged-in user lightning address from profile data', () => {
    expect(readProfileLightningAddress({
      data: { lud16: 'me@getalby.com' },
      event: { content: '{"lud16":"other@wallet.com"}' },
    })).toBe('me@getalby.com');
    expect(readProfileLightningAddress({
      event: { content: '{"lud16":"fallback@wallet.com"}' },
    })).toBe('fallback@wallet.com');
    expect(readProfileLightningAddress(undefined)).toBe('');
  });
});
