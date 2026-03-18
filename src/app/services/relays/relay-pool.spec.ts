import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { RelayPoolService } from './relay-pool';
import { RelaysService } from './relays';
import { SubscriptionManagerService } from './subscription-manager';
import { LoggerService } from '../logger.service';
import { RelayAuthService } from './relay-auth.service';
import { LocalSettingsService } from '../local-settings.service';
import { PoolService } from './pool.service';

describe('RelayPoolService request queue', () => {
  let service: RelayPoolService;
  let poolGetMock: ReturnType<typeof vi.fn>;
  let requestCounter = 0;

  beforeEach(async () => {
    poolGetMock = vi.fn();
    requestCounter = 0;

    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        RelayPoolService,
        {
          provide: RelaysService,
          useValue: {
            getAllRelayStats: vi.fn().mockReturnValue(new Map()),
            addRelay: vi.fn(),
            incrementEventCount: vi.fn(),
            recordConnectionRetry: vi.fn(),
          },
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
          useValue: {
            filterAuthFailedRelays: vi.fn((relayUrls: string[]) => relayUrls),
          },
        },
        { provide: LocalSettingsService, useValue: {} },
        {
          provide: PoolService,
          useValue: {
            pool: {
              get: poolGetMock,
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
});