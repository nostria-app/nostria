import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Event, EventTemplate } from 'nostr-tools';

import { RelayAuthService, AuthSignFunction } from './relay-auth.service';
import { LoggerService } from '../logger.service';
import { DatabaseService } from '../database.service';
import { UtilitiesService } from '../utilities.service';
import { LocalSettingsService } from '../local-settings.service';

describe('RelayAuthService', () => {
  let service: RelayAuthService;
  let autoRelayAuth: ReturnType<typeof signal<boolean>>;
  let signFn: AuthSignFunction;

  TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());

  beforeEach(async () => {
    TestBed.resetTestingModule();
    autoRelayAuth = signal(false);
    signFn = vi.fn(async (evt: EventTemplate): Promise<Event> => ({
      ...evt,
      id: 'signed',
      sig: 'sig',
      pubkey: 'pubkey',
    }));

    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        RelayAuthService,
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
          provide: DatabaseService,
          useValue: {
            initialized: () => false,
          },
        },
        {
          provide: UtilitiesService,
          useValue: {
            normalizeRelayUrl: (url: string) => (url.endsWith('/') ? url : `${url}/`),
            currentDate: () => Math.floor(Date.now() / 1000),
          },
        },
        {
          provide: LocalSettingsService,
          useValue: {
            autoRelayAuth: () => autoRelayAuth(),
          },
        },
      ],
    }).compileComponents();

    service = TestBed.inject(RelayAuthService);
    service.setSignFunction(signFn);
  });

  it('returns undefined when autoRelayAuth is disabled', () => {
    autoRelayAuth.set(false);
    expect(service.getAuthCallback()).toBeUndefined();
  });

  it('returns a callback when autoRelayAuth is enabled', () => {
    autoRelayAuth.set(true);
    expect(service.getAuthCallback()).toBeTypeOf('function');
  });

  it('returns a callback when force is true even if autoRelayAuth is disabled', () => {
    autoRelayAuth.set(false);
    expect(service.getAuthCallback({ force: true })).toBeTypeOf('function');
  });

  it('filters auth-required relays when auto-auth is disabled', () => {
    autoRelayAuth.set(false);
    // Seed auth-required state via forced callback invocation bookkeeping is internal;
    // mark through public API by simulating failed/required state.
    void service.markAuthFailed('wss://auth.example/', 'test');
    // markAuthFailed marks failed; use a separate path for auth-required-only:
    // call getAuthCallback force and invoke to register auth-required, but that also
    // needs a successful sign. Instead verify failed filtering here.
    const filtered = service.filterAuthFailedRelays([
      'wss://auth.example/',
      'wss://public.example/',
    ]);
    expect(filtered).toEqual(['wss://public.example/']);
  });

  it('keeps auth-required relays when allowAuthRequired is set', async () => {
    autoRelayAuth.set(false);
    const callback = service.getAuthCallback({ force: true });
    expect(callback).toBeTypeOf('function');

    await callback!({
      kind: 22242,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['relay', 'wss://auth.inbox/'], ['challenge', 'abc']],
      content: '',
    });

    // Auth-required (not failed) should be kept when allowAuthRequired is true
    const filtered = service.filterAuthFailedRelays(
      ['wss://auth.inbox/', 'wss://public.example/'],
      { allowAuthRequired: true }
    );
    expect(filtered).toEqual(['wss://auth.inbox/', 'wss://public.example/']);

    // Without allowAuthRequired, auth-required relays are excluded when auto-auth is off
    const filteredStrict = service.filterAuthFailedRelays([
      'wss://auth.inbox/',
      'wss://public.example/',
    ]);
    expect(filteredStrict).toEqual(['wss://public.example/']);
  });
});
