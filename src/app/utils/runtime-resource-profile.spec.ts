import { describe, expect, it } from 'vitest';

import {
  CONSTRAINED_FEED_MEMORY_LIMITS,
  DEFAULT_FEED_MEMORY_LIMITS,
  getRuntimeResourceProfile,
} from './runtime-resource-profile';

describe('getRuntimeResourceProfile', () => {
  it('uses lower feed limits and longer idle timeout on constrained devices', () => {
    const profile = getRuntimeResourceProfile({
      deviceMemory: 4,
      hardwareConcurrency: 4,
      connection: {
        effectiveType: '4g',
      },
    });

    expect(profile.likelyConstrained).toBe(true);
    expect(profile.idleTaskTimeoutMs).toBe(5000);
    expect(profile.feedLimits).toEqual(CONSTRAINED_FEED_MEMORY_LIMITS);
  });

  it('uses constrained mode when data saver or 2g is enabled', () => {
    const profile = getRuntimeResourceProfile({
      connection: {
        effectiveType: 'slow-2g',
        saveData: true,
      },
    });

    expect(profile.likelyConstrained).toBe(true);
    expect(profile.feedLimits).toEqual(CONSTRAINED_FEED_MEMORY_LIMITS);
  });

  it('keeps default limits on capable devices', () => {
    const profile = getRuntimeResourceProfile({
      deviceMemory: 8,
      hardwareConcurrency: 8,
      connection: {
        effectiveType: '4g',
      },
    });

    expect(profile.likelyConstrained).toBe(false);
    expect(profile.idleTaskTimeoutMs).toBe(2000);
    expect(profile.feedLimits).toEqual(DEFAULT_FEED_MEMORY_LIMITS);
  });
});
