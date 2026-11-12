import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { NostrService } from './nostr.service';
import { SIGNER_RESPONSE_TIMEOUT_MS } from '../utils/mute-list';

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
    expect(captured.filter['kinds']).not.toContain(10000);

    const muteList = subscribe.mock.results[1].value as CapturedSubscribe;
    expect(muteList.filter['kinds']).toEqual([10000]);
    expect(muteList.filter['since']).toBeUndefined();
  });

  it('uses since when the cached following list is already loaded', async () => {
    const { service, subscribe } = createService(true);

    await service.subscribeToAccountMetadata('0'.repeat(64));

    const captured = subscribe.mock.results[0].value as CapturedSubscribe;
    expect(typeof captured.filter['since']).toBe('number');
    expect(captured.filter['kinds']).not.toContain(10000);
  });

  it('loads kind 10000 without the metadata since filter', async () => {
    const pubkey = '0'.repeat(64);
    const { service, subscribe } = createService(true);

    await service.subscribeToAccountMetadata(pubkey);

    const muteList = subscribe.mock.results[1].value as CapturedSubscribe;
    expect(muteList.filter).toEqual({
      kinds: [10000],
      authors: [pubkey],
    });
  });
});

describe('NostrService extension signing queue', () => {
  it('rejects a hung extension sign and signs the next request', async () => {
    vi.useFakeTimers();
    try {
      const service = Object.create(NostrService.prototype) as {
        logger: { debug: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
        extensionSigningQueue: unknown[];
        isExtensionSigning: boolean;
        performExtensionSigning: () => Promise<{ id: string }>;
        queueExtensionSigning: (event: { kind: number; created_at: number; tags: string[][]; content: string }) => Promise<{ id: string }>;
      };
      service.logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      service.extensionSigningQueue = [];
      service.isExtensionSigning = false;
      let calls = 0;
      service.performExtensionSigning = () => {
        calls += 1;
        if (calls === 1) return new Promise(() => undefined);
        return Promise.resolve({ id: 'second' });
      };

      const first = service['queueExtensionSigning']({ kind: 1, created_at: 1, tags: [], content: 'first' });
      const second = service['queueExtensionSigning']({ kind: 1, created_at: 2, tags: [], content: 'second' });
      const firstResult = first.then(
        () => 'resolved',
        () => 'rejected',
      );
      await vi.advanceTimersByTimeAsync(SIGNER_RESPONSE_TIMEOUT_MS);

      await expect(firstResult).resolves.toBe('rejected');
      await expect(second).resolves.toEqual({ id: 'second' });
    } finally {
      vi.useRealTimers();
    }
  });
});
