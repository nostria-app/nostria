import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserRelayService } from './user-relay';
import { DiscoveryRelayService } from './discovery-relay';
import { LoggerService } from '../logger.service';
import { RelaysService } from './relays';
import { RelayPoolService } from './relay-pool';
import { UserRelaysService } from './user-relays';
import { AccountRelayService } from './account-relay';
import { UtilitiesService } from '../utilities.service';

describe('UserRelayService', () => {
  let service: UserRelayService;
  let poolGetMock: ReturnType<typeof vi.fn>;
  let poolQueryMock: ReturnType<typeof vi.fn>;
  let ensureRelaysForPubkeyMock: ReturnType<typeof vi.fn>;
  let refreshUserRelaysMock: ReturnType<typeof vi.fn>;
  let getRelaysForPubkeyMock: ReturnType<typeof vi.fn>;
  let getOptimalRelaysMock: ReturnType<typeof vi.fn>;

  TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());

  beforeEach(async () => {
    TestBed.resetTestingModule();
    poolGetMock = vi.fn();
    poolQueryMock = vi.fn().mockResolvedValue([]);
    ensureRelaysForPubkeyMock = vi.fn().mockResolvedValue(undefined);
    refreshUserRelaysMock = vi.fn().mockResolvedValue(['wss://user-relay-a', 'wss://user-relay-b']);
    getRelaysForPubkeyMock = vi.fn().mockReturnValue(['wss://user-relay-a', 'wss://user-relay-b']);
    getOptimalRelaysMock = vi.fn((relayUrls: string[], limit?: number) => relayUrls.slice(0, limit ?? relayUrls.length));

    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        UserRelayService,
        {
          provide: DiscoveryRelayService,
          useValue: {
            getRelayUrls: vi.fn().mockReturnValue(['wss://discovery-relay']),
          },
        },
        {
          provide: LoggerService,
          useValue: {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
          },
        },
        {
          provide: RelaysService,
          useValue: {
            getOptimalRelays: getOptimalRelaysMock,
          },
        },
        {
          provide: RelayPoolService,
          useValue: {
            get: poolGetMock,
            query: poolQueryMock,
            isBacklogged: vi.fn().mockReturnValue(false),
            getQueueLength: vi.fn().mockReturnValue(0),
            getActiveRequestCount: vi.fn().mockReturnValue(0),
          },
        },
        {
          provide: UserRelaysService,
          useValue: {
            ensureRelaysForPubkey: ensureRelaysForPubkeyMock,
            refreshUserRelays: refreshUserRelaysMock,
            getRelaysForPubkey: getRelaysForPubkeyMock,
            isLoadingRelaysForPubkey: vi.fn().mockReturnValue(false),
            clearUserRelaysCache: vi.fn(),
          },
        },
        {
          provide: AccountRelayService,
          useValue: {
            getRelayUrls: vi.fn().mockReturnValue(['wss://account-relay']),
          },
        },
        {
          provide: UtilitiesService,
          useValue: {
            preferredRelays: ['wss://preferred-a', 'wss://preferred-b', 'wss://preferred-c'],
          },
        },
      ],
    }).compileComponents();

    service = TestBed.inject(UserRelayService);
  });

  it('skips preferred relay fallback when relay pool is backlogged', async () => {
    const relayPool = TestBed.inject(RelayPoolService) as unknown as {
      isBacklogged: ReturnType<typeof vi.fn>;
    };

    poolGetMock.mockResolvedValue(null);
    relayPool.isBacklogged.mockReturnValue(true);

    const event = await service.getEventByPubkeyAndKindAndTag('author-pubkey', 30023, { key: 'd', value: 'article-id' });

    expect(event).toBeNull();
    expect(poolGetMock).toHaveBeenCalledTimes(1);
  });

  it('caches recent misses for getEventById to avoid repeated relay requests', async () => {
    poolGetMock.mockResolvedValue(null);

    const first = await service.getEventById('author-pubkey', 'event-id');
    const second = await service.getEventById('author-pubkey', 'event-id');

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(ensureRelaysForPubkeyMock).toHaveBeenCalledTimes(1);
    expect(poolGetMock).toHaveBeenCalledTimes(1);
  });

  it('bypasses cached misses for getEventById when requested', async () => {
    poolGetMock.mockResolvedValue(null);

    await service.getEventById('author-pubkey', 'event-id');
    await service.getEventById('author-pubkey', 'event-id', { bypassCache: true });

    expect(ensureRelaysForPubkeyMock).toHaveBeenCalledTimes(2);
    expect(poolGetMock).toHaveBeenCalledTimes(2);
  });

  it('queries the full refreshed relay set when requested', async () => {
    await service.query('author-pubkey', { authors: ['author-pubkey'], kinds: [1] }, { refreshRelays: true, useFullRelaySet: true });

    expect(refreshUserRelaysMock).toHaveBeenCalledTimes(1);
    expect(ensureRelaysForPubkeyMock).not.toHaveBeenCalled();
    expect(getOptimalRelaysMock).not.toHaveBeenCalled();
    expect(poolQueryMock).toHaveBeenCalledWith(['wss://user-relay-a', 'wss://user-relay-b'], { authors: ['author-pubkey'], kinds: [1] });
  });
});
