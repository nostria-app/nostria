import { describe, expect, it } from 'vitest';
import { hllEncode, newHll } from 'nostr-tools/nip45';

import {
  mergeRelayCountResponses,
  relayAdvertisesCountSupport,
  resolveDisplayedInteractionCount,
} from './relay-count';

describe('relayAdvertisesCountSupport', () => {
  it('returns true only when NIP 45 is advertised', () => {
    expect(relayAdvertisesCountSupport([1, 11, 45, 70])).toBe(true);
    expect(relayAdvertisesCountSupport([1, 11, 70, 77])).toBe(false);
    expect(relayAdvertisesCountSupport(undefined)).toBe(false);
  });
});

describe('mergeRelayCountResponses', () => {
  it('uses the maximum raw count across relays', () => {
    expect(mergeRelayCountResponses([
      { count: 3 },
      { count: 12 },
      { count: 7 },
      null,
    ])).toEqual({ count: 12, approximate: false });
  });

  it('prefers a HyperLogLog estimate when registers are present', () => {
    const hll = newHll();
    hll[0] = 4;
    hll[1] = 3;

    const merged = mergeRelayCountResponses([
      { count: 2 },
      { count: 4, hll: hllEncode(hll) },
    ]);

    expect(merged.approximate).toBe(true);
    expect(merged.count).toBeGreaterThanOrEqual(4);
  });
});

describe('resolveDisplayedInteractionCount', () => {
  it('prefers a COUNT hint when it exceeds the loaded events', () => {
    expect(resolveDisplayedInteractionCount(3, 42, false)).toBe('42');
  });

  it('keeps the limited-query overflow badge when COUNT is not higher', () => {
    expect(resolveDisplayedInteractionCount(11, 8, true)).toBe('10+');
  });

  it('returns an empty string when nothing has been counted', () => {
    expect(resolveDisplayedInteractionCount(0, 0, false)).toBe('');
  });
});
