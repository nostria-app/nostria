import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RelaysService } from './relays';
import { DatabaseService } from '../database.service';
import { UtilitiesService } from '../utilities.service';
import { LocalSettingsService } from '../local-settings.service';
import { LoggerService } from '../logger.service';

describe('RelaysService COUNT support', () => {
  let service: RelaysService;
  let savedRelays: Array<Record<string, unknown>>;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    savedRelays = [];

    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        RelaysService,
        {
          provide: DatabaseService,
          useValue: {
            initialized: () => true,
            getObservedRelay: vi.fn(async (url: string) => ({ url })),
            saveObservedRelay: vi.fn(async (stats: Record<string, unknown>) => {
              savedRelays.push(stats);
            }),
            getAllObservedRelays: vi.fn(async () => []),
          },
        },
        {
          provide: UtilitiesService,
          useValue: {
            normalizeRelayUrl: (url: string) => url.endsWith('/') ? url : `${url}/`,
            getUniqueNormalizedRelayUrls: (urls: string[]) => [...new Set(urls.map(url => url.endsWith('/') ? url : `${url}/`))],
            isSecureRelayUrl: (url: string) => url.startsWith('wss://'),
            currentDate: () => 1_700_000_000,
            preferredRelays: [],
            normalizeRelayUrls: (urls: string[]) => urls,
          },
        },
        { provide: LocalSettingsService, useValue: { maxRelaysPerUser: () => 5 } },
        {
          provide: LoggerService,
          useValue: {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    service = TestBed.inject(RelaysService);
  });

  it('persists and returns live COUNT probe results', async () => {
    service.setCountSupport('wss://relay.damus.io', true, 'probe');
    service.setCountSupport('wss://relay.primal.net', false, 'probe');

    expect(service.getCountSupport('wss://relay.damus.io')).toBe(true);
    expect(service.getCountSupport('wss://relay.primal.net')).toBe(false);
    expect(service.getKnownCountCapableRelays([
      'wss://relay.damus.io',
      'wss://relay.primal.net',
      'wss://ribo.nostria.app',
    ])).toEqual(['wss://relay.damus.io/']);

    await Promise.resolve();
    expect(savedRelays.some(relay => relay['url'] === 'wss://relay.damus.io/' && relay['supportsCount'] === true)).toBe(true);
    expect(savedRelays.some(relay => relay['url'] === 'wss://relay.primal.net/' && relay['supportsCount'] === false)).toBe(true);
  });
});
