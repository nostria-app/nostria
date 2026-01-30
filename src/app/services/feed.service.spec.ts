import { signal } from '@angular/core';
import { FeedService } from './feed.service';
import { Event } from 'nostr-tools';

describe('FeedService', () => {
  // FeedService has a heavy constructor with many injected deps.
  // For these unit tests, bypass the constructor and set only the fields needed
  // by handleFollowingIncrementalUpdate.
  function createServiceForIncrementalFollowingTests(): FeedService {
    const service = Object.create(FeedService.prototype) as FeedService;

    (service as any).accountState = {
      muted: () => false,
    };

    const map = new Map<string, unknown>();
    (service as any)._feedData = signal(map);

    (service as any).saveEventToDatabase = jasmine.createSpy('saveEventToDatabase');

    return service;
  }

  function makeEvent(id: string, createdAt: number): Event {
    return {
      id,
      kind: 1,
      created_at: createdAt,
      pubkey: 'pubkey',
      content: '',
      tags: [],
      sig: 'sig',
    } as unknown as Event;
  }

  describe('handleFollowingIncrementalUpdate', () => {
    it('renders events directly when initialLoadComplete=true and feed is empty', () => {
      const service = createServiceForIncrementalFollowingTests();

      const feedData: any = {
        feed: { id: 'feed-following', kinds: [1] },
        events: signal<Event[]>([]),
        pendingEvents: signal<Event[]>([]),
        initialLoadComplete: true,
      };

      const originalMap = (service as any)._feedData();
      originalMap.set(feedData.feed.id, feedData);

      (service as any).handleFollowingIncrementalUpdate(feedData, [
        makeEvent('e1', 10),
        makeEvent('e2', 20),
      ]);

      expect(feedData.events().map((e: Event) => e.id)).toEqual(['e2', 'e1']);
      expect(feedData.pendingEvents().length).toBe(0);
      expect((service as any)._feedData()).not.toBe(originalMap);
    });

    it('queues events when initialLoadComplete=true and feed already has events', () => {
      const service = createServiceForIncrementalFollowingTests();

      const feedData: any = {
        feed: { id: 'feed-following', kinds: [1] },
        events: signal<Event[]>([makeEvent('existing', 50)]),
        pendingEvents: signal<Event[]>([]),
        initialLoadComplete: true,
      };

      (service as any).handleFollowingIncrementalUpdate(feedData, [
        makeEvent('newer', 100),
        makeEvent('older', 25),
      ]);

      expect(feedData.events().map((e: Event) => e.id)).toEqual(['existing']);
      expect(feedData.pendingEvents().map((e: Event) => e.id)).toEqual(['newer', 'older']);
    });
  });
});
