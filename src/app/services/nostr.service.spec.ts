import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { NostrService } from './nostr.service';

interface TestableNostrService {
  subscribeToAccountMetadata(pubkey: string): Promise<void>;
}

interface CapturedSubscribe {
  filter: Record<string, unknown>;
  onEvent: (event: unknown) => void;
  onEose: () => void;
}

function createService(followingListLoaded: boolean): {
  service: TestableNostrService;
  subscribe: ReturnType<typeof vi.fn>;
} {
  const subscribe = vi.fn((filter: Record<string, unknown>, onEvent: (event: unknown) => void, onEose: () => void) => {
    return { filter, onEvent, onEose, close: vi.fn() };
  });

  const service = Object.create(NostrService.prototype) as TestableNostrService & Record<string, unknown>;
  Object.assign(service, {
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    accountLocalState: {
      getAccountMetadataLastSync: vi.fn().mockReturnValue(1_700_000_000),
      setAccountMetadataLastSync: vi.fn(),
    },
    accountState: {
      account: () => ({ pubkey: '0'.repeat(64) }),
      followingListLoaded: () => followingListLoaded,
      initialized: { set: vi.fn() },
    },
    accountRelay: { subscribe },
    database: {
      init: vi.fn(),
      saveEvent: vi.fn(),
    },
    data: {
      toRecord: vi.fn(),
    },
    discoveryRelay: {
      setDiscoveryRelays: vi.fn(),
    },
  });

  return { service, subscribe };
}

describe('NostrService account metadata subscription', () => {
  it('does not use since when the cached following list is missing', async () => {
    const { service, subscribe } = createService(false);

    await service.subscribeToAccountMetadata('0'.repeat(64));

    const captured = subscribe.mock.results[0].value as CapturedSubscribe;
    expect(captured.filter['since']).toBeUndefined();
  });

  it('uses since when the cached following list is already loaded', async () => {
    const { service, subscribe } = createService(true);

    await service.subscribeToAccountMetadata('0'.repeat(64));

    const captured = subscribe.mock.results[0].value as CapturedSubscribe;
    expect(typeof captured.filter['since']).toBe('number');
  });
});
