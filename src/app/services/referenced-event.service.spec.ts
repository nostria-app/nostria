import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Event } from 'nostr-tools';
import { type NostrRecord } from '../interfaces';
import { DataService } from './data.service';
import { DatabaseService } from './database.service';
import { RelayPoolService } from './relays/relay-pool';
import { UserRelayService } from './relays/user-relay';
import { ReferencedEventService } from './referenced-event.service';

function createEvent(id: string): Event {
  return {
    id,
    pubkey: 'f'.repeat(64),
    created_at: Math.floor(Date.now() / 1000),
    kind: 1,
    tags: [],
    content: 'hello',
    sig: 's'.repeat(128),
  };
}

function createRecord(event: Event): NostrRecord {
  return {
    event,
    data: event.content,
  };
}

describe('ReferencedEventService', () => {
  let service: ReferencedEventService;
  let databaseGetEventByIdMock: ReturnType<typeof vi.fn>;
  let dataGetEventByIdMock: ReturnType<typeof vi.fn>;
  let relayPoolGetEventByIdMock: ReturnType<typeof vi.fn>;
  let userRelayGetEventByIdMock: ReturnType<typeof vi.fn>;

  TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());

  beforeEach(async () => {
    TestBed.resetTestingModule();
    databaseGetEventByIdMock = vi.fn();
    dataGetEventByIdMock = vi.fn();
    relayPoolGetEventByIdMock = vi.fn();
    userRelayGetEventByIdMock = vi.fn();

    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ReferencedEventService,
        {
          provide: DatabaseService,
          useValue: {
            getEventById: databaseGetEventByIdMock,
          },
        },
        {
          provide: DataService,
          useValue: {
            getEventById: dataGetEventByIdMock,
            toRecord: (event: Event) => createRecord(event),
          },
        },
        {
          provide: RelayPoolService,
          useValue: {
            getEventById: relayPoolGetEventByIdMock,
          },
        },
        {
          provide: UserRelayService,
          useValue: {
            getEventById: userRelayGetEventByIdMock,
          },
        },
      ],
    }).compileComponents();

    service = TestBed.inject(ReferencedEventService);
  });

  it('returns cached database events before hitting relays', async () => {
    const cachedEvent = createEvent('cached-event');
    databaseGetEventByIdMock.mockResolvedValue(cachedEvent);

    const result = await service.getReferencedEvent('cached-event', {
      relayHints: ['wss://relay.example'],
      authorPubkey: 'a'.repeat(64),
    });

    expect(result?.event.id).toBe('cached-event');
    expect(dataGetEventByIdMock).not.toHaveBeenCalled();
    expect(relayPoolGetEventByIdMock).not.toHaveBeenCalled();
    expect(userRelayGetEventByIdMock).not.toHaveBeenCalled();
  });

  it('retries author relays with bypassed cache after the first stage misses', async () => {
    const authorEvent = createEvent('author-event');
    databaseGetEventByIdMock.mockResolvedValue(null);
    relayPoolGetEventByIdMock.mockResolvedValue(null);
    dataGetEventByIdMock.mockResolvedValue(null);
    userRelayGetEventByIdMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(authorEvent);

    const result = await service.getReferencedEvent('author-event', {
      relayHints: ['wss://hint.example'],
      authorPubkey: 'a'.repeat(64),
    });

    expect(result?.event.id).toBe('author-event');
    expect(userRelayGetEventByIdMock).toHaveBeenNthCalledWith(1, 'a'.repeat(64), 'author-event', { bypassCache: false });
    expect(userRelayGetEventByIdMock).toHaveBeenNthCalledWith(2, 'a'.repeat(64), 'author-event', { bypassCache: true });
  });
});