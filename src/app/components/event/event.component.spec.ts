import { Event } from 'nostr-tools';

import { getTaggedXUrl } from './event.component';

describe('getTaggedXUrl', () => {
  const createEvent = (tags: string[][]): Event => ({
    id: 'event-id',
    pubkey: 'pubkey',
    created_at: 1,
    kind: 1,
    tags,
    content: 'hello',
    sig: 'sig',
  });

  it('returns the proxy web URL for x.com posts', () => {
    expect(getTaggedXUrl(createEvent([
      ['proxy', 'https://x.com/nostria/status/123', 'web'],
    ]))).toBe('https://x.com/nostria/status/123');
  });

  it('returns the proxy web URL for twitter.com posts', () => {
    expect(getTaggedXUrl(createEvent([
      ['proxy', 'https://twitter.com/nostria/status/123', 'web'],
    ]))).toBe('https://twitter.com/nostria/status/123');
  });

  it('ignores proxy tags for non-x domains', () => {
    expect(getTaggedXUrl(createEvent([
      ['proxy', 'https://mastodon.social/@nostria/123', 'web'],
    ]))).toBeUndefined();
  });

  it('ignores proxy tags with non-web protocol hints', () => {
    expect(getTaggedXUrl(createEvent([
      ['proxy', 'https://x.com/nostria/status/123', 'activitypub'],
    ]))).toBeUndefined();
  });

  it('ignores invalid proxy URLs', () => {
    expect(getTaggedXUrl(createEvent([
      ['proxy', 'not-a-valid-url', 'web'],
    ]))).toBeUndefined();
  });
});
