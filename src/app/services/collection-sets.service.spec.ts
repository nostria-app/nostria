import '@angular/compiler';
import { signal } from '@angular/core';
import { Event } from 'nostr-tools';
import { describe, expect, it, vi } from 'vitest';
import { CollectionSetsService, InterestSet } from './collection-sets.service';

describe('CollectionSetsService', () => {
  function createService(overrides?: {
    databaseEvents?: Event[];
    relayEvents?: Event[];
    deletedEvents?: Event[];
    initError?: Error;
    lastLoadedPubkey?: string | null;
    cachedInterestSets?: InterestSet[];
  }): CollectionSetsService {
    const service = Object.create(CollectionSetsService.prototype) as CollectionSetsService;
    const databaseEvents = overrides?.databaseEvents ?? [];
    const relayEvents = overrides?.relayEvents ?? [];

    Object.assign(service, {
      logger: {
        debug: vi.fn(),
        error: vi.fn(),
      },
      database: {
        init: overrides?.initError
          ? vi.fn().mockRejectedValue(overrides.initError)
          : vi.fn().mockResolvedValue(undefined),
        getEventsByPubkeyAndKind: vi.fn().mockResolvedValue(databaseEvents),
      },
      accountRelay: {
        getEventsByPubkeyAndKind: vi.fn().mockResolvedValue(relayEvents),
      },
      deletionFilter: {
        filterDeletedEventsFromDatabase: vi.fn().mockImplementation(async (events: Event[]) => overrides?.deletedEvents ?? events),
      },
      interestSets: signal(overrides?.cachedInterestSets ?? []),
      lastLoadedPubkey: overrides?.lastLoadedPubkey ?? null,
    });

    return service;
  }

  function makeInterestEvent(id: string, createdAt: number, hashtags: string[]): Event {
    return {
      id,
      kind: 30015,
      created_at: createdAt,
      pubkey: 'pubkey',
      content: '',
      sig: 'sig',
      tags: [
        ['d', 'interests'],
        ['title', 'My Interests'],
        ...hashtags.map(hashtag => ['t', hashtag]),
      ],
    } satisfies Event;
  }

  it('keeps cached custom interest sets when a reload returns no events', async () => {
    const cachedInterestSets: InterestSet[] = [{
      identifier: 'interests',
      title: 'My Interests',
      hashtags: ['nostr', 'gardening'],
      eventId: 'cached-event',
      created_at: 123,
    }];
    const service = createService({
      databaseEvents: [],
      relayEvents: [],
      lastLoadedPubkey: 'pubkey',
      cachedInterestSets,
    });

    const result = await service.getInterestSets('pubkey');

    expect(result).toEqual(cachedInterestSets);
    expect(result).not.toBe(cachedInterestSets);
    expect(result[0].hashtags).not.toBe(cachedInterestSets[0].hashtags);
  });

  it('keeps cached custom interest sets when reloading fails', async () => {
    const cachedInterestSets: InterestSet[] = [{
      identifier: 'interests',
      title: 'My Interests',
      hashtags: ['nostr', 'gardening'],
      eventId: 'cached-event',
      created_at: 123,
    }];
    const service = createService({
      initError: new Error('database unavailable'),
      lastLoadedPubkey: 'pubkey',
      cachedInterestSets,
    });

    const result = await service.getInterestSets('pubkey');

    expect(result).toEqual(cachedInterestSets);
    expect(result).not.toBe(cachedInterestSets);
  });

  it('prefers the latest event when multiple interest updates share the same second', async () => {
    const olderEvent = makeInterestEvent('older', 100, ['catstr', 'birdstr']);
    const latestEvent = makeInterestEvent('latest', 100, ['nostr', 'gardening']);
    const service = createService({
      databaseEvents: [olderEvent, latestEvent],
    });

    const result = await service.getInterestSets('pubkey');

    expect(result.length).toBe(1);
    expect(result[0].eventId).toBe('latest');
    expect(result[0].hashtags).toEqual(['nostr', 'gardening']);
  });

  it('normalizes emoji shortcodes to NIP-30 format before saving', async () => {
    const signedEvent = {
      id: 'signed-id',
      kind: 30030,
      created_at: 100,
      pubkey: 'pubkey',
      content: '',
      sig: 'sig',
      tags: [],
    } satisfies Event;
    const service = Object.create(CollectionSetsService.prototype) as CollectionSetsService;
    const saveEvent = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn().mockResolvedValue({ success: true });

    Object.assign(service, {
      logger: {
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      },
      accountState: {
        pubkey: vi.fn().mockReturnValue('pubkey'),
      },
      nostrService: {
        createEvent: vi.fn().mockReturnValue({ kind: 30030, content: '', tags: [] }),
        signEvent: vi.fn().mockResolvedValue(signedEvent),
      },
      database: {
        saveEvent,
      },
      publishService: {
        publish,
      },
    });

    const success = await service.saveEmojiSet(
      'set-id',
      'Set',
      [{ shortcode: 'party parrot-wow', url: 'https://example.com/party-parrot.webp' }],
      []
    );

    expect(success).toBe(true);
    expect(service.nostrService.createEvent).toHaveBeenCalledWith(30030, '', [
      ['d', 'set-id'],
      ['title', 'Set'],
      ['name', 'Set'],
      ['emoji', 'party_parrot_wow', 'https://example.com/party-parrot.webp'],
    ]);
    expect(saveEvent).toHaveBeenCalledWith(signedEvent);
    expect(publish).toHaveBeenCalledWith(signedEvent, {
      useOptimizedRelays: false,
    });
  });

  it('returns false when all emoji shortcodes normalize to empty values', async () => {
    const service = Object.create(CollectionSetsService.prototype) as CollectionSetsService;

    Object.assign(service, {
      logger: {
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      },
      accountState: {
        pubkey: vi.fn().mockReturnValue('pubkey'),
      },
      nostrService: {
        createEvent: vi.fn(),
        signEvent: vi.fn(),
      },
      database: {
        saveEvent: vi.fn(),
      },
      publishService: {
        publish: vi.fn(),
      },
    });

    const success = await service.saveEmojiSet(
      'set-id',
      'Set',
      [{ shortcode: '---', url: 'https://example.com/invalid.webp' }],
      []
    );

    expect(success).toBe(false);
    expect(service.nostrService.createEvent).not.toHaveBeenCalled();
  });
});
