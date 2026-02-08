import { signal } from '@angular/core';
import { FeedService, FeedItem } from './feed.service';
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

  function makeEvent(id: string, createdAt: number, kind = 1): Event {
    return {
      id,
      kind,
      created_at: createdAt,
      pubkey: 'pubkey',
      content: '',
      tags: [],
      sig: 'sig',
    } as unknown as Event;
  }

  function createServiceForNewEventsTests(): FeedService {
    const service = Object.create(FeedService.prototype) as FeedService;

    (service as any).accountState = {
      muted: () => false,
    };

    const dataMap = new Map<string, FeedItem>();
    (service as any).data = dataMap;
    (service as any)._feedData = signal(new Map<string, FeedItem>());
    (service as any)._activeFeedId = signal<string | null>(null);
    (service as any)._feedsPageActive = signal(true);

    (service as any).logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    return service;
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

  describe('checkForNewEvents', () => {
    it('should not skip feeds without a persistent subscription', async () => {
      const service = createServiceForNewEventsTests();

      const feedData: any = {
        feed: { id: 'custom-feed', kinds: [0], source: 'custom', customUsers: ['pubkey1'] },
        events: signal<Event[]>([makeEvent('e1', 100)]),
        pendingEvents: signal<Event[]>([]),
        subscription: null, // Custom feeds don't have persistent subscriptions
        lastCheckTimestamp: 100,
        initialLoadComplete: true,
        isCheckingForNewEvents: signal(false),
      };

      (service as any).data.set('custom-feed', feedData);
      (service as any)._activeFeedId.set('custom-feed');

      // Mock checkColumnForNewEvents to track if it's called
      let checkColumnCalled = false;
      (service as any).checkColumnForNewEvents = jasmine.createSpy('checkColumnForNewEvents')
        .and.callFake(async () => { checkColumnCalled = true; });

      await (service as any).checkForNewEvents();

      expect(checkColumnCalled).toBeTrue();
    });

    it('should skip feeds where initial load is not complete', async () => {
      const service = createServiceForNewEventsTests();

      const feedData: any = {
        feed: { id: 'custom-feed', kinds: [0], source: 'custom' },
        events: signal<Event[]>([]),
        pendingEvents: signal<Event[]>([]),
        subscription: null,
        lastCheckTimestamp: 100,
        initialLoadComplete: false, // Still loading
        isCheckingForNewEvents: signal(false),
      };

      (service as any).data.set('custom-feed', feedData);
      (service as any)._activeFeedId.set('custom-feed');

      (service as any).checkColumnForNewEvents = jasmine.createSpy('checkColumnForNewEvents');

      await (service as any).checkForNewEvents();

      expect((service as any).checkColumnForNewEvents).not.toHaveBeenCalled();
    });
  });

  describe('checkColumnForNewEvents', () => {
    it('should use lastCheckTimestamp as sinceTimestamp, not currentTime', async () => {
      const service = createServiceForNewEventsTests();

      const lastCheck = Math.floor(Date.now() / 1000) - 60; // 60 seconds ago
      const feedData: any = {
        feed: { id: 'custom-feed', kinds: [0], source: 'custom', customUsers: ['pubkey1'] },
        events: signal<Event[]>([makeEvent('e1', lastCheck - 10)]),
        pendingEvents: signal<Event[]>([]),
        lastCheckTimestamp: lastCheck,
        initialLoadComplete: true,
      };

      (service as any).data.set('custom-feed', feedData);

      // Track which sinceTimestamp is passed to fetchNewEventsForCustom
      let capturedSinceTimestamp: number | undefined;
      (service as any).fetchNewEventsForCustom = jasmine.createSpy('fetchNewEventsForCustom')
        .and.callFake(async (_fd: unknown, since: number) => {
          capturedSinceTimestamp = since;
          return [];
        });

      await (service as any).checkColumnForNewEvents('custom-feed');

      expect((service as any).fetchNewEventsForCustom).toHaveBeenCalled();
      expect(capturedSinceTimestamp).toBe(lastCheck);
    });

    it('should route for-you feeds to fetchNewEventsForFollowing', async () => {
      const service = createServiceForNewEventsTests();

      const lastCheck = Math.floor(Date.now() / 1000) - 30;
      const feedData: any = {
        feed: { id: 'for-you-feed', kinds: [1], source: 'for-you' },
        events: signal<Event[]>([makeEvent('e1', lastCheck - 10)]),
        pendingEvents: signal<Event[]>([]),
        lastCheckTimestamp: lastCheck,
        initialLoadComplete: true,
      };

      (service as any).data.set('for-you-feed', feedData);

      (service as any).fetchNewEventsForFollowing = jasmine.createSpy('fetchNewEventsForFollowing')
        .and.returnValue(Promise.resolve([]));

      await (service as any).checkColumnForNewEvents('for-you-feed');

      expect((service as any).fetchNewEventsForFollowing).toHaveBeenCalledWith(feedData, lastCheck);
    });

    it('should filter out events already in the feed from pending', async () => {
      const service = createServiceForNewEventsTests();

      const lastCheck = Math.floor(Date.now() / 1000) - 30;
      const existingEvent = makeEvent('existing-1', lastCheck + 5);
      const newEvent = makeEvent('new-1', lastCheck + 10);
      const feedData: any = {
        feed: { id: 'custom-feed', kinds: [1], source: 'custom', customUsers: ['pubkey1'] },
        events: signal<Event[]>([existingEvent]),
        pendingEvents: signal<Event[]>([]),
        lastCheckTimestamp: lastCheck,
        initialLoadComplete: true,
      };

      (service as any).data.set('custom-feed', feedData);

      // Return both an existing event and a new one
      (service as any).fetchNewEventsForCustom = jasmine.createSpy('fetchNewEventsForCustom')
        .and.returnValue(Promise.resolve([existingEvent, newEvent]));

      await (service as any).checkColumnForNewEvents('custom-feed');

      // Only the new event should be in pending, not the existing one
      const pending = feedData.pendingEvents();
      expect(pending.length).toBe(1);
      expect(pending[0].id).toBe('new-1');
    });
  });
});
