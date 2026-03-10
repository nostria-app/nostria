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
        init: vi.fn().mockResolvedValue(undefined),
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
});
