import { describe, expect, it } from 'vitest';

import { getContactListProfileMap, normalizeContactListTags } from './contact-list';

describe('normalizeContactListTags', () => {
  it('merges duplicate p-tags without dropping relay hints or petnames', () => {
    const pubkey = 'a'.repeat(64);

    expect(normalizeContactListTags([
      ['client', 'nostria'],
      ['p', pubkey],
      ['p', pubkey, 'wss://relay.example.com', 'alice'],
    ])).toEqual([
      ['client', 'nostria'],
      ['p', pubkey, 'wss://relay.example.com', 'alice'],
    ]);
  });

  it('keeps petnames when relay hints are empty', () => {
    const pubkey = 'b'.repeat(64);

    expect(normalizeContactListTags([
      ['p', pubkey, '', 'bob'],
    ])).toEqual([
      ['p', pubkey, '', 'bob'],
    ]);
  });

  it('drops malformed p-tags and preserves other tags in order', () => {
    const pubkey = 'c'.repeat(64);

    expect(normalizeContactListTags([
      ['t', 'nostr'],
      ['p', 'not-a-pubkey'],
      ['p', pubkey],
      ['client', 'nostria'],
    ])).toEqual([
      ['t', 'nostr'],
      ['p', pubkey],
      ['client', 'nostria'],
    ]);
  });
});

describe('getContactListProfileMap', () => {
  it('returns merged relay hints and petnames for valid pubkeys', () => {
    const pubkey = 'd'.repeat(64);

    const metadata = getContactListProfileMap([
      ['p', pubkey],
      ['p', pubkey, 'wss://relay.example.com', 'dora'],
    ]);

    expect(metadata.get(pubkey)).toEqual({
      relayUrl: 'wss://relay.example.com',
      petname: 'dora',
    });
  });
});