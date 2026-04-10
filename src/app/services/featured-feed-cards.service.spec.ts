import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Event, kinds } from 'nostr-tools';
import { FeaturedFeedCardsService } from './featured-feed-cards.service';
import { AccountStateService } from './account-state.service';
import { AccountLocalStateService, FeaturedFeedCardsState } from './account-local-state.service';
import { DatabaseService } from './database.service';
import { LoggerService } from './logger.service';
import { UtilitiesService } from './utilities.service';
import { FeedConfig } from './feed.service';
import { RelayPoolService } from './relays/relay-pool';
import { RelaysService } from './relays/relays';

describe('FeaturedFeedCardsService', () => {
  let service: FeaturedFeedCardsService;
  let storedState: FeaturedFeedCardsState | undefined;

  const makeEvent = (id: string, pubkey: string, createdAt: number, tags: string[][] = []): Event => ({
    id,
    pubkey,
    created_at: createdAt,
    kind: kinds.ShortTextNote,
    tags,
    content: 'test content',
    sig: 'sig',
  });

  beforeEach(async () => {
    const pubkeySignal = signal('viewer');
    const followingSignal = signal<string[]>([]);
    const subscriptionSignal = signal(false);
    const accountLocalStateStub = {
      getFeaturedFeedCards: () => storedState,
      setFeaturedFeedCards: (_: string, state: FeaturedFeedCardsState) => {
        storedState = state;
      },
    };
    const databaseStub = {
      init: async () => undefined,
      getEventsByKind: async (kind: number) => {
        if (kind === kinds.ShortTextNote) {
          return [
            makeEvent('root-1', 'author-a', 120),
            makeEvent('root-2', 'author-b', 119),
            makeEvent('reply-1', 'replier', 121, [['e', 'root-1']]),
          ];
        }

        if (kind === 7) {
          return [
            {
              ...makeEvent('reaction-1', 'fan', 122, [['e', 'root-1']]),
              kind: 7,
              content: '+',
            },
          ];
        }

        if (kind === kinds.Repost) {
          return [
            {
              ...makeEvent('repost-1', 'fan-two', 123, [['e', 'root-1']]),
              kind: kinds.Repost,
            },
          ];
        }

        if (kind === 30023) {
          return [
            {
              ...makeEvent('article-1', 'author-a', 130, [['d', 'article-d'], ['title', 'Cached article']]),
              kind: 30023,
              content: 'Cached summary for the article body',
            },
          ];
        }

        return [];
      },
    };

    await TestBed.configureTestingModule({
      providers: [
        FeaturedFeedCardsService,
        {
          provide: AccountStateService,
          useValue: {
            pubkey: pubkeySignal,
            followingList: followingSignal,
            hasActiveSubscription: subscriptionSignal,
          },
        },
        {
          provide: AccountLocalStateService,
          useValue: accountLocalStateStub,
        },
        {
          provide: DatabaseService,
          useValue: databaseStub,
        },
        {
          provide: LoggerService,
          useValue: {
            warn: () => undefined,
          },
        },
        {
          provide: RelayPoolService,
          useValue: {
            query: async () => [],
          },
        },
        {
          provide: RelaysService,
          useValue: {
            getConnectedRelays: () => [],
          },
        },
        {
          provide: UtilitiesService,
          useValue: {
            safeGetHexPubkey: (pubkey: string) => pubkey,
            isRootPost: (event: Event) => !event.tags.some(tag => tag[0] === 'e'),
            getTagValue: (event: Event, tagName: string) => event.tags.find(tag => tag[0] === tagName)?.[1],
            getTitleTag: (event: Event) => event.tags.find(tag => tag[0] === 'title')?.[1],
            getImageTag: () => undefined,
            getThumbTag: () => undefined,
            preferredRelays: [],
            getMusicAudioUrl: () => 'https://example.com/song.mp3',
            getMusicTitle: (event: Event) => event.tags.find(tag => tag[0] === 'title')?.[1],
            getMusicArtist: () => 'Test artist',
            getMusicImage: () => undefined,
          },
        },
      ],
    }).compileComponents();

    service = TestBed.inject(FeaturedFeedCardsService);

    await (service as unknown as { refreshRecommendations: () => Promise<void> }).refreshRecommendations();
  });

  it('should insert featured cards at regular note intervals', () => {
    const events = Array.from({ length: 18 }, (_, index) => makeEvent(`event-${index}`, `author-${index}`, 200 - index));
    const feed: FeedConfig = {
      id: 'default-feed-for-you',
      label: 'For You',
      icon: 'for_you',
      type: 'notes',
      kinds: [kinds.ShortTextNote],
      source: 'for-you',
      relayConfig: 'account',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const placements = service.getPlacements(feed, events);

    expect(placements.length).toBe(2);
    expect(placements[0].afterEventId).toBe('event-4');
    expect(placements[1].afterEventId).toBe('event-15');
  });

  it('should persist impressions and clicks for future prioritization', () => {
    service.markImpression('feed:popular:root-1', 'popular-profiles');
    service.markClick('popular-profiles');

    expect(storedState?.cards['popular-profiles']?.impressions).toBe(1);
    expect(storedState?.cards['popular-profiles']?.clicks).toBe(1);
    expect(storedState?.history?.slice(-2).map(entry => entry.action)).toEqual(['shown', 'clicked']);
  });
});