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

  beforeEach(async () => {
    poolGetMock = vi.fn();

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
            registerRequest: vi.fn()
              .mockReturnValueOnce('req-1')
              .mockReturnValueOnce('req-2'),
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
});