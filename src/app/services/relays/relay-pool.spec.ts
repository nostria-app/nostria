import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RelayPoolService } from './relay-pool';
import { RelaysService } from './relays';
import { SubscriptionManagerService } from './subscription-manager';
import { LoggerService } from '../logger.service';
import { RelayAuthService } from './relay-auth.service';
import { LocalSettingsService } from '../local-settings.service';
import { PoolService } from './pool.service';
import { UtilitiesService } from '../utilities.service';

describe('RelayPoolService request queue', () => {
  let service: RelayPoolService;
  let poolGetMock: ReturnType<typeof vi.fn>;
  let poolPublishMock: ReturnType<typeof vi.fn>;
  let relaysServiceMock: {
    getAllRelayStats: ReturnType<typeof vi.fn>;
    addRelay: ReturnType<typeof vi.fn>;
    incrementEventCount: ReturnType<typeof vi.fn>;
    recordConnectionRetry: ReturnType<typeof vi.fn>;
    updateRelayConnection: ReturnType<typeof vi.fn>;
  };
  let relayAuthServiceMock: {
    filterAuthFailedRelays: ReturnType<typeof vi.fn>;
    getAuthCallback: ReturnType<typeof vi.fn>;
    markAuthFailed: ReturnType<typeof vi.fn>;
  };
  let requestCounter = 0;

  TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());

  beforeEach(async () => {
    TestBed.resetTestingModule();
    poolGetMock = vi.fn();
    poolPublishMock = vi.fn();
    requestCounter = 0;
    relaysServiceMock = {
      getAllRelayStats: vi.fn().mockReturnValue(new Map()),
      addRelay: vi.fn(),
      incrementEventCount: vi.fn(),
      recordConnectionRetry: vi.fn(),
      updateRelayConnection: vi.fn(),
    };
    relayAuthServiceMock = {
      filterAuthFailedRelays: vi.fn((relayUrls: string[]) => relayUrls),
      getAuthCallback: vi.fn(),
      markAuthFailed: vi.fn(),
    };

    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        RelayPoolService,
        {
          provide: RelaysService,
          useValue: relaysServiceMock,
        },
        {
          provide: SubscriptionManagerService,
          useValue: {
            registerRequest: vi.fn(() => `req-${++requestCounter}`),
            unregisterRequest: vi.fn(),
            updateConnectionStatus: vi.fn(),
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
          provide: RelayAuthService,
          useValue: relayAuthServiceMock,
        },
        {
          provide: UtilitiesService,
          useValue: {
            getUniqueNormalizedRelayUrls: vi.fn((relayUrls: string[]) => relayUrls.filter(url => !url.includes('relay.nostr.band'))),
          },
        },
        { provide: LocalSettingsService, useValue: {} },
        {
          provide: PoolService,
          useValue: {
            pool: {
              get: poolGetMock,
              publish: poolPublishMock,
            },
          },
        },
      ],
    }).compileComponents();

    service = TestBed.inject(RelayPoolService);
    Object.defineProperty(service, 'maxConcurrentRequests', { value: 1, configurable: true });
    Object.defineProperty(service, 'maxConcurrentRequestsPerRelay', { value: 1, configurable: true });
  });

  it('serializes overlapping get requests against the same relay set', async () => {
    let resolveFirst: ((value: null) => void) | undefined;
    let resolveSecond: ((value: null) => void) | undefined;

    poolGetMock
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveFirst = resolve;
      }))
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveSecond = resolve;
      }));

    const firstRequest = service.get(['wss://nos.lol'], { authors: ['alice'] });
    const secondRequest = service.get(['wss://nos.lol'], { authors: ['bob'] });

    await Promise.resolve();

    expect(poolGetMock).toHaveBeenCalledTimes(1);

    resolveFirst!(null);
    await firstRequest;
    await Promise.resolve();

    expect(poolGetMock).toHaveBeenCalledTimes(2);

    resolveSecond!(null);

    await expect(secondRequest).resolves.toBeNull();
  });

  it('dequeues high-priority note lookups before metadata requests', async () => {
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;
    let releaseThird: (() => void) | undefined;

    poolGetMock
      .mockImplementationOnce(() => new Promise(resolve => {
        releaseFirst = () => resolve(null);
      }))
      .mockImplementationOnce(() => new Promise(resolve => {
        releaseSecond = () => resolve(null);
      }))
      .mockImplementationOnce(() => new Promise(resolve => {
        releaseThird = () => resolve(null);
      }));

    const first = service.get(['wss://nos.lol'], { authors: ['alice'] });
    const lowPriority = service.get(['wss://nos.lol'], { kinds: [0], authors: ['alice'] });
    const highPriority = service.get(['wss://nos.lol'], { kinds: [1], authors: ['bob'] });

    await Promise.resolve();
    expect(poolGetMock).toHaveBeenCalledTimes(1);

    releaseFirst!();
    await first;
    await Promise.resolve();

    expect(poolGetMock).toHaveBeenCalledTimes(2);
    expect(poolGetMock).toHaveBeenNthCalledWith(
      2,
      ['wss://nos.lol'],
      { kinds: [1], authors: ['bob'] },
      { maxWait: 5000 }
    );

    releaseSecond!();
    await highPriority;
    await Promise.resolve();

    expect(poolGetMock).toHaveBeenCalledTimes(3);
    expect(poolGetMock).toHaveBeenNthCalledWith(
      3,
      ['wss://nos.lol'],
      { kinds: [0], authors: ['alice'] },
      { maxWait: 5000 }
    );

    releaseThird!();
    await expect(lowPriority).resolves.toBeNull();
  });

  it('never connects to ignored relay domains', async () => {
    poolGetMock.mockResolvedValueOnce(null);

    await service.get(['wss://relay.nostr.band', 'wss://nos.lol'], { kinds: [1], authors: ['alice'] });

    expect(poolGetMock).toHaveBeenCalledTimes(1);
    expect(poolGetMock).toHaveBeenCalledWith(
      ['wss://nos.lol'],
      { kinds: [1], authors: ['alice'] },
      { maxWait: 5000 }
    );
  });

  it('rejects single-relay publish failures with the relay reason', async () => {
    poolPublishMock.mockReturnValueOnce([
      Promise.reject(new Error('blocked: pubkey not in whitelist')),
    ]);

    await expect(service.publish(['wss://relay.example'], {} as never, 100)).rejects.toThrow(
      'blocked: pubkey not in whitelist'
    );

    expect(relaysServiceMock.recordConnectionRetry).toHaveBeenCalledWith('wss://relay.example');
    expect(relaysServiceMock.updateRelayConnection).toHaveBeenCalledWith('wss://relay.example', false);
  });
});
