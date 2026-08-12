import { describe, expect, it } from 'vitest';
import { DEFAULT_DM_RELAYS } from './default-dm-relays';
import { DEFAULT_ACCOUNT_RELAYS } from './default-account-relays';

describe('DEFAULT_DM_RELAYS', () => {
  it('uses the auth-friendly inbox relays from issue #626', () => {
    expect([...DEFAULT_DM_RELAYS]).toEqual([
      'wss://auth.nostr1.com/',
      'wss://relay.ditto.pub/',
      'wss://chat.wisp.talk/',
      'wss://relay.dreamith.to/',
    ]);
  });

  it('is distinct from default account relays (kind 10002)', () => {
    const accountSet = new Set(DEFAULT_ACCOUNT_RELAYS);
    for (const relay of DEFAULT_DM_RELAYS) {
      expect(accountSet.has(relay as typeof DEFAULT_ACCOUNT_RELAYS[number])).toBe(false);
    }
  });
});
