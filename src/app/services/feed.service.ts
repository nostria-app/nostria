import {
  Injectable,
  inject,
  signal,
  computed,
  Signal,
  WritableSignal,
  effect,
  untracked,
} from '@angular/core';
import { LocalStorageService } from './local-storage.service';
import { LoggerService } from './logger.service';
import { Event, kinds } from 'nostr-tools';
import { ApplicationStateService } from './application-state.service';
import { AccountStateService } from './account-state.service';
import { DataService } from './data.service';
import { UtilitiesService } from './utilities.service';
import { ApplicationService } from './application.service';
import { Algorithms } from './algorithms';
import { UserDataService } from './user-data.service';
import { OnDemandUserDataService } from './on-demand-user-data.service';
import { UserRelayService } from './relays/user-relay';
import { SharedRelayService } from './relays/shared-relay';
import { AccountRelayService } from './relays/account-relay';
import { Followset } from './followset';
import { RegionService } from './region.service';

export interface FeedItem {
  column: ColumnConfig;
  events: WritableSignal<Event[]>;
  filter: {
    kinds?: number[];
    authors?: string[];
    '#e'?: string[];
    '#p'?: string[];
    since?: number;
    until?: number;
    limit?: number;
  } | null;
  lastTimestamp?: number;
  subscription: { unsubscribe: () => void } | { close: () => void } | null;
  isLoadingMore?: WritableSignal<boolean>;
  hasMore?: WritableSignal<boolean>;
}

export interface ColumnConfig {
  id: string;
  label: string;
  icon: string;
  path?: string;
  type: 'notes' | 'articles' | 'photos' | 'videos' | 'music' | 'custom';
  kinds: number[];
  source?: 'following' | 'public' | 'custom';
  customUsers?: string[]; // Array of pubkeys for custom user selection
  customStarterPacks?: string[]; // Array of starter pack identifiers (d tags)
  relayConfig: 'account' | 'custom';
  customRelays?: string[];
  filters?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface FeedConfig {
  id: string;
  label: string;
  icon: string;
  path?: string;
  description?: string;
  columns: ColumnConfig[];
  createdAt: number;
  updatedAt: number;
}

export interface RelayConfig {
  url: string;
  read: boolean;
  write: boolean;
}

const COLUMN_TYPES = {
  notes: {
    label: 'Notes',
    icon: 'chat',
    kinds: [1], // Text notes
    description: 'Short text posts and updates',
  },
  articles: {
    label: 'Articles',
    icon: 'article',
    kinds: [30023], // Long-form content
    description: 'Long-form articles and blog posts',
  },
  photos: {
    label: 'Photos',
    icon: 'image',
    kinds: [20],
    description: 'Images',
  },
  videos: {
    label: 'Videos',
    icon: 'movie',
    kinds: [21],
    description: 'Videos',
  },
  music: {
    label: 'Music',
    icon: 'music_note',
    kinds: [32100],
    description: 'Music playlists (.m3u)',
  },
  custom: {
    label: 'Custom',
    icon: 'tune',
    kinds: [],
    description: 'Custom configuration',
  },
};

const DEFAULT_FEEDS: FeedConfig[] = [
  {
    id: 'default-feed-popular',
    label: 'Popular',
    icon: 'rocket_launch',
    description: 'Curated content from Nostr starter packs',
    columns: [
      {
        id: 'starter-pack-column',
        label: '',
        icon: 'group',
        type: 'notes',
        kinds: [kinds.ShortTextNote, kinds.Repost],
        source: 'custom',
        // Will be populated with actual starter pack dTags when available
        customStarterPacks: [],
        relayConfig: 'account',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'default-feed-following',
    label: 'Following',
    icon: 'dynamic_feed',
    description: 'Content from people you follow',
    columns: [
      {
        id: 'following-column',
        label: '',
        icon: 'people',
        type: 'notes',
        kinds: [kinds.ShortTextNote, kinds.Repost],
        source: 'following',
        relayConfig: 'account',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

@Injectable({
  providedIn: 'root',
})
export class FeedService {
  private readonly localStorageService = inject(LocalStorageService);
  private readonly logger = inject(LoggerService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly appState = inject(ApplicationStateService);
  private readonly accountState = inject(AccountStateService);
  private readonly dataService = inject(DataService);
  private readonly utilities = inject(UtilitiesService);
  private readonly app = inject(ApplicationService);
  private readonly userRelayEx = inject(UserRelayService);
  private readonly sharedRelayEx = inject(SharedRelayService);
  private readonly userDataService = inject(UserDataService);
  // On-demand access for one-shot per-user fetches to avoid lingering sockets
  private readonly onDemandUserData = inject(OnDemandUserDataService);
  private readonly followset = inject(Followset);
  private readonly regionService = inject(RegionService);

  private readonly algorithms = inject(Algorithms);

  // Signals for feeds and relays
  private readonly _feeds = signal<FeedConfig[]>([]);
  private readonly _userRelays = signal<RelayConfig[]>([]);
  private readonly _discoveryRelays = signal<RelayConfig[]>([]);

  // Active feed subscription management
  private readonly _activeFeedId = signal<string | null>(null);
  private activeFeedSubscriptions = new Set<string>(); // Track column IDs with active subscriptions

  // Public computed signals
  readonly feeds = computed(() => this._feeds());
  readonly userRelays = computed(() => this._userRelays());
  readonly discoveryRelays = computed(() => this._discoveryRelays());
  readonly activeFeedId = computed(() => this._activeFeedId());

  // Feed type definitions
  readonly feedTypes = COLUMN_TYPES;

  constructor() {
    effect(() => {
      if (this.accountState.initialized()) {
        untracked(async () => {
          await this.loadFeeds();
          this.loadRelays();
        });
      }
    });
  }

  // Use a signal to track feed data for reactivity
  private readonly _feedData = signal(new Map<string, FeedItem>());
  readonly data = new Map<string, FeedItem>();

  // Public getter to expose reactive feed data map for components
  get feedDataReactive(): Signal<Map<string, FeedItem>> {
    return this._feedData.asReadonly();
  }

  // Computed signal that provides reactive access to feed data
  readonly feedDataMap = computed(() => {
    const dataMap = this._feedData();
    const eventsMap = new Map<string, Signal<Event[]>>();
    dataMap.forEach((feedData, feedId) => {
      eventsMap.set(feedId, feedData.events);
    });
    return eventsMap;
  });

  async subscribe() {
    this.data.clear();
    this._feedData.set(new Map());

    // Only subscribe to active feed if one is set
    const activeFeedId = this._activeFeedId();
    if (activeFeedId) {
      const activeFeed = this.getFeedById(activeFeedId);
      if (activeFeed) {
        await this.subscribeToFeed(activeFeed);
        this.logger.debug('Subscribed to active feed:', activeFeedId);
      }
    }

    // Reduced logging to prevent console spam
    this.logger.debug(`Subscribed to ${this.data.size} feed columns`);
  }

  /**
   * Helper method to safely close subscriptions
   */
  private closeSubscription(
    subscription: { unsubscribe: () => void } | { close: () => void } | null
  ) {
    if (subscription) {
      if ('close' in subscription) {
        subscription.close();
      } else if ('unsubscribe' in subscription) {
        subscription.unsubscribe();
      }
    }
  }

  /**
   * Set the active feed and manage subscriptions
   */
  async setActiveFeed(feedId: string | null): Promise<void> {
    const previousActiveFeedId = this._activeFeedId();

    // Unsubscribe from previous active feed
    if (previousActiveFeedId) {
      this.unsubscribeFromFeed(previousActiveFeedId);
      this.logger.debug(`Unsubscribed from previous active feed: ${previousActiveFeedId}`);
    }

    // Set new active feed
    this._activeFeedId.set(feedId);

    // Subscribe to new active feed
    if (feedId) {
      const activeFeed = this.getFeedById(feedId);
      if (activeFeed) {
        await this.subscribeToFeed(activeFeed);
        this.logger.debug(`Subscribed to new active feed: ${feedId}`);
      } else {
        this.logger.warn(`Active feed with id ${feedId} not found`);
      }
    }
  }

  /**
   * Get the current active feed ID
   */
  getActiveFeedId(): string | null {
    return this._activeFeedId();
  }

  /**
   * Subscribe to a single feed and all its columns
   */
  private async subscribeToFeed(feed: FeedConfig): Promise<void> {
    // Subscribe to each column in the feed
    for (const column of feed.columns) {
      await this.subscribeToColumn(column);
    }
  }

  /**
   * Subscribe to a single column
   */
  private async subscribeToColumn(column: ColumnConfig): Promise<void> {
    // Don't subscribe if already subscribed
    if (this.data.has(column.id)) {
      this.logger.warn(`Column ${column.id} is already subscribed`);
      return;
    }

    const item: FeedItem = {
      column,
      filter: null,
      events: signal<Event[]>([]),
      subscription: null,
      lastTimestamp: Date.now(), // Initialize with current timestamp
      isLoadingMore: signal<boolean>(false),
      hasMore: signal<boolean>(true),
    };

    // Build filter based on column configuration
    if (column.filters) {
      item.filter = {
        limit: 6,
        kinds: column.kinds,
        ...column.filters,
      };
    } else {
      item.filter = {
        limit: 6,
        kinds: column.kinds,
      };
    }

    // If the source is following, use algorithm to get top engaged users
    if (column.source === 'following') {
      await this.loadFollowingFeed(item);
    } else if (column.source === 'custom') {
      await this.loadCustomFeed(item);
    } else {
      // Choose relay service based on column.relayConfig
      let relayService: AccountRelayService | UserRelayService;

      if (
        column.relayConfig === 'custom' &&
        column.customRelays &&
        column.customRelays.length > 0
      ) {
        // Use custom relays for this column
        this.logger.debug(`Using custom relays for column ${column.id}:`, column.customRelays);

        // Use UserRelayServiceEx and initialize it with custom relays
        relayService = this.userRelayEx;
        relayService.init(column.customRelays);
      } else {
        // Use account relays (default)
        this.logger.debug(`Using account relays for column ${column.id}`);
        relayService = this.accountRelay;
      }

      // Subscribe to relay events using the selected relay service
      let sub: { unsubscribe: () => void } | { close: () => void } | null;
      if (relayService instanceof UserRelayService) {
        // UserRelayService requires pubkey parameter
        sub = await relayService.subscribe(this.accountState.pubkey(), item.filter, (event: Event) => {
          // Filter out live events that are muted.
          if (this.accountState.muted(event)) {
            return;
          }

          // Add event and maintain chronological order (newest first)
          item.events.update((events: Event[]) => {
            const newEvents = [...events, event];
            return newEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
          });
          this.logger.debug(`Column event received for ${column.id}:`, event);
        }) as { unsubscribe: () => void } | { close: () => void } | null;
      } else {
        // AccountRelayService uses the old signature
        sub = relayService.subscribe(item.filter, (event: Event) => {
          // Filter out live events that are muted.
          if (this.accountState.muted(event)) {
            return;
          }

          // Add event and maintain chronological order (newest first)
          item.events.update((events: Event[]) => {
            const newEvents = [...events, event];
            return newEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
          });
          this.logger.debug(`Column event received for ${column.id}:`, event);
        });
      }

      item.subscription = sub;
    }

    this.data.set(column.id, item);

    // Update the reactive signal
    this._feedData.update(map => {
      const newMap = new Map(map);
      newMap.set(column.id, item);
      return newMap;
    });

    // Reduced logging to prevent console spam
    this.logger.debug(`Subscribed to column: ${column.id}`);
  }

  /**
   * Load following feed using algorithm-based approach
   *
   * This method implements an optimized feed loading strategy:
   * 1. Gets top 10 most engaged users from the algorithm
   * 2. Fetches latest 5 events from each user using the outbox model
   * 3. Filters out events older than 7 days for initial load
   * 4. Aggregates events ensuring diversity (at least one from each user)
   * 5. Sorts by creation time with newest first
   * 6. Tracks lastTimestamp for pagination
   */
  private async loadFollowingFeed(feedData: FeedItem) {
    try {
      // Check if this is an articles feed - use different algorithm
      const isArticlesFeed = feedData.filter?.kinds?.includes(30023);

      this.logger.debug(
        `Loading following feed - isArticles: ${isArticlesFeed}, kinds: ${JSON.stringify(feedData.filter?.kinds)}`
      );

      // Get recommended users based on content type
      const topEngagedUsers = isArticlesFeed
        ? await this.algorithms.getRecommendedUsersForArticles(20)
        : await this.algorithms.getRecommendedUsers(10);

      this.logger.debug(
        `Found ${topEngagedUsers.length} engaged users for ${isArticlesFeed ? 'articles' : 'notes'} feed`
      );

      if (topEngagedUsers.length === 0) {
        this.logger.warn('No engaged users found, falling back to recent following');
        // Fallback to users from following list
        const followingList = this.accountState.followingList();

        // If following list is empty, use empty array
        if (followingList.length === 0) {
          this.logger.debug('Following list is empty, no users to fetch from');
          return;
        }

        this.logger.debug(`Following list size: ${followingList.length}`);

        // For articles, use more users since articles are rarer
        const fallbackCount = isArticlesFeed ? 25 : 10;
        const fallbackUsers = [...followingList].slice(-fallbackCount).reverse();

        this.logger.debug(`Using ${fallbackUsers.length} fallback users`);
        await this.fetchEventsFromUsers(fallbackUsers, feedData);
        return;
      }

      // Extract pubkeys from top engaged users
      const topPubkeys = topEngagedUsers.map(user => user.pubkey);

      // Fetch events from these top engaged users
      await this.fetchEventsFromUsers(topPubkeys, feedData);

      this.logger.debug(
        `Loaded following feed with ${topPubkeys.length} top engaged users${isArticlesFeed ? ' (articles)' : ''}`
      );
    } catch (error) {
      this.logger.error('Error loading following feed:', error);
    }
  }

  /**
   * Load custom feed using specified users and starter packs
   *
   * This method:
   * 1. Collects pubkeys from customUsers array
   * 2. Fetches starter pack data and extracts pubkeys
   * 3. Combines all pubkeys and fetches events
   * 4. Uses the same fetchEventsFromUsers logic as following feed
   */
  private async loadCustomFeed(feedData: FeedItem) {
    try {
      const column = feedData.column;
      const allPubkeys = new Set<string>();

      // Add custom users pubkeys
      if (column.customUsers && column.customUsers.length > 0) {
        column.customUsers.forEach(pubkey => allPubkeys.add(pubkey));
        this.logger.debug(`Added ${column.customUsers.length} custom users`);
      }

      // Add pubkeys from starter packs
      if (column.customStarterPacks && column.customStarterPacks.length > 0) {
        try {
          // Fetch starter packs to get the current data
          const allStarterPacks = await this.followset.fetchStarterPacks();

          // Find the starter packs we need by matching dTag
          const selectedPacks = allStarterPacks.filter(pack =>
            column.customStarterPacks?.includes(pack.dTag)
          );

          // Extract pubkeys from selected starter packs
          selectedPacks.forEach(pack => {
            pack.pubkeys.forEach(pubkey => allPubkeys.add(pubkey));
          });

          this.logger.debug(
            `Added ${selectedPacks.length} starter packs with total ${selectedPacks.reduce((sum, pack) => sum + pack.pubkeys.length, 0)} users`
          );
        } catch (error) {
          this.logger.error('Error fetching starter pack data:', error);
        }
      }

      const pubkeysArray = Array.from(allPubkeys);

      if (pubkeysArray.length === 0) {
        this.logger.warn('No pubkeys found for custom feed, falling back to following');
        // Fallback to following if no custom users are specified
        const followingList = this.accountState.followingList();

        // If following list is empty, return early
        if (followingList.length === 0) {
          this.logger.debug('Following list is empty, no users to fetch from for custom feed');
          return;
        }

        const fallbackUsers = [...followingList].slice(-10).reverse();
        await this.fetchEventsFromUsers(fallbackUsers, feedData);
        return;
      }

      this.logger.debug(`Loading custom feed with ${pubkeysArray.length} unique users`);

      // Fetch events from all specified users
      await this.fetchEventsFromUsers(pubkeysArray, feedData);

      this.logger.debug(`Loaded custom feed with ${pubkeysArray.length} users`);
    } catch (error) {
      this.logger.error('Error loading custom feed:', error);
    }
  }

  /**
   * Fetch events from a list of users using the outbox model
   * Updates UI incrementally as events are received for better UX
   */
  private async fetchEventsFromUsers(pubkeys: string[], feedData: FeedItem) {
    const isArticlesFeed = feedData.filter?.kinds?.includes(30023);
    const eventsPerUser = isArticlesFeed ? 10 : 5; // Fetch more events per user for articles
    const now = Math.floor(Date.now() / 1000); // current timestamp in seconds
    const daysBack = isArticlesFeed ? 90 : 7; // Look further back for articles
    const timeCutoff = now - daysBack * 24 * 60 * 60; // subtract days in seconds

    const userEventsMap = new Map<string, Event[]>();
    let processedUsers = 0;
    const totalUsers = pubkeys.length;

    // Process users in parallel but update UI incrementally
    const fetchPromises = pubkeys.map(async pubkey => {
      try {
        const events = await this.sharedRelayEx.getMany(
          pubkey,
          {
            authors: [pubkey],
            kinds: feedData.filter?.kinds,
            limit: eventsPerUser,
            since: timeCutoff,
          },
          { timeout: 2500 }
        );

        // Reduced logging to prevent console spam - only log summary at debug level
        if (events.length > 0) {
          this.logger.debug(`Found ${events.length} events for user ${pubkey.slice(0, 8)}...`);
        }

        // Store events for this user
        if (events.length > 0) {
          userEventsMap.set(pubkey, events);
        }

        processedUsers++;

        // Update UI incrementally every time we get events from a user
        this.updateFeedIncremental(userEventsMap, feedData, processedUsers, totalUsers);
      } catch (error) {
        this.logger.error(`Error fetching events for user ${pubkey}:`, error);
        processedUsers++;

        // Still update UI even if this user failed
        this.updateFeedIncremental(userEventsMap, feedData, processedUsers, totalUsers);
      }
    });

    // Wait for all requests to complete
    await Promise.all(fetchPromises);

    // Final update to ensure everything is properly sorted
    this.finalizeIncrementalFeed(userEventsMap, feedData);
  }

  /**
   * Update feed incrementally as events are received
   */
  private updateFeedIncremental(
    userEventsMap: Map<string, Event[]>,
    feedData: FeedItem,
    processedUsers: number,
    totalUsers: number
  ) {
    // Update UI immediately if we have events from any user
    // if (userEventsMap.size === 0) {
    //   return;
    // }

    // Aggregate current events
    const currentEvents = this.aggregateAndSortEvents(userEventsMap);

    if (currentEvents.length > 0) {
      // Update the feed with current events
      feedData.events.set(currentEvents);

      // Update last timestamp for pagination
      feedData.lastTimestamp = Math.min(...currentEvents.map(e => (e.created_at || 0) * 1000));

      this.logger.debug(
        `Incremental update: ${processedUsers}/${totalUsers} users processed, ${currentEvents.length} events`
      );
    }
  }

  /**
   * Finalize the incremental feed with a final sort and cleanup
   */
  private finalizeIncrementalFeed(userEventsMap: Map<string, Event[]>, feedData: FeedItem) {
    // Final aggregation and sort
    const finalEvents = this.aggregateAndSortEvents(userEventsMap);

    // Update feed data with final aggregated events
    feedData.events.set(finalEvents);

    // Update last timestamp for pagination
    if (finalEvents.length > 0) {
      feedData.lastTimestamp = Math.min(...finalEvents.map(e => (e.created_at || 0) * 1000));
    }

    this.logger.debug(
      `Final update: ${finalEvents.length} total events from ${userEventsMap.size} users`
    );
  }

  /**
   * Aggregate and sort events ensuring diversity and recency
   */
  private aggregateAndSortEvents(userEventsMap: Map<string, Event[]>): Event[] {
    const result: Event[] = [];
    const usedUsers = new Set<string>();

    // First pass: Include one recent event from each user
    for (const [pubkey, events] of userEventsMap) {
      if (events.length > 0) {
        result.push(events[0]); // Most recent event from this user
        usedUsers.add(pubkey);
      }
    }

    // Second pass: Fill remaining slots with other events, maintaining diversity
    for (const [, events] of userEventsMap) {
      for (let i = 1; i < events.length; i++) {
        result.push(events[i]);
      }
    }

    // Sort by creation time (newest first)
    return result.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }

  /**
   * Load more events for pagination (called when user scrolls)
   */
  async loadMoreEvents(columnId: string) {
    const feedData = this.data.get(columnId);
    if (!feedData || !feedData.isLoadingMore || !feedData.hasMore) {
      this.logger.warn(`Cannot load more events for column ${columnId}: feedData not found or missing loading states`);
      return;
    }

    // Prevent multiple simultaneous loads
    if (feedData.isLoadingMore() || !feedData.hasMore()) {
      this.logger.debug(`Skipping load more for column ${columnId}: already loading or no more data`);
      return;
    }

    feedData.isLoadingMore.set(true);

    try {
      const column = feedData.column;

      if (column.source === 'following') {
        // Check if this is an articles feed
        const isArticlesFeed = feedData.filter?.kinds?.includes(30023);

        // Get top engaged users again (they might have changed)
        const topEngagedUsers = isArticlesFeed
          ? await this.algorithms.getRecommendedUsersForArticles(20)
          : await this.algorithms.getRecommendedUsers(10);
        const topPubkeys = topEngagedUsers.map(user => user.pubkey);

        // Fetch older events using the lastTimestamp
        await this.fetchOlderEventsFromUsers(topPubkeys, feedData);
      } else if (column.source === 'custom') {
        // For custom feeds, collect the same pubkeys used in initial load
        const allPubkeys = new Set<string>();

        // Add custom users pubkeys
        if (column.customUsers && column.customUsers.length > 0) {
          column.customUsers.forEach(pubkey => allPubkeys.add(pubkey));
        }

        // Add pubkeys from starter packs
        if (column.customStarterPacks && column.customStarterPacks.length > 0) {
          try {
            const allStarterPacks = await this.followset.fetchStarterPacks();
            const selectedPacks = allStarterPacks.filter(pack =>
              column.customStarterPacks?.includes(pack.dTag)
            );
            selectedPacks.forEach(pack => {
              pack.pubkeys.forEach(pubkey => allPubkeys.add(pubkey));
            });
          } catch (error) {
            this.logger.error('Error fetching starter pack data for pagination:', error);
          }
        }

        const pubkeysArray = Array.from(allPubkeys);

        if (pubkeysArray.length > 0) {
          // Fetch older events from the same custom users
          await this.fetchOlderEventsFromUsers(pubkeysArray, feedData);
        } else {
          // No custom users, mark as no more data
          feedData.hasMore.set(false);
        }
      } else {
        // For public feeds, implement similar pagination logic
        const currentEvents = feedData.events();
        const oldestTimestamp = currentEvents.length > 0
          ? Math.min(...currentEvents.map(e => e.created_at || 0)) - 1
          : Math.floor(Date.now() / 1000);

        const filter = {
          ...feedData.filter,
          until: oldestTimestamp,
          limit: 10,
        };

        const newEvents = await this.accountRelay.getMany(filter, { timeout: 3000 });

        // Filter out duplicates and append
        const existingEventIds = new Set(currentEvents.map(e => e.id));
        const uniqueNewEvents = newEvents.filter(e => !existingEventIds.has(e.id));

        if (uniqueNewEvents.length > 0) {
          const allEvents = [...currentEvents, ...uniqueNewEvents];
          allEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
          feedData.events.set(allEvents);
          feedData.lastTimestamp = Math.min(...allEvents.map(e => (e.created_at || 0) * 1000));
        }

        // Check if we have more data
        if (uniqueNewEvents.length < (filter.limit || 10)) {
          feedData.hasMore.set(false);
        }
      }
    } catch (error) {
      this.logger.error('Error loading more events:', error);
    } finally {
      feedData.isLoadingMore.set(false);
    }
  }

  /**
   * Fetch older events for pagination with incremental updates
   */
  private async fetchOlderEventsFromUsers(pubkeys: string[], feedData: FeedItem) {
    const eventsPerUser = 5;
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days for older content

    const userEventsMap = new Map<string, Event[]>();
    let processedUsers = 0;
    const totalUsers = pubkeys.length;
    const existingEvents = feedData.events(); // Get current events

    // Process users in parallel with incremental updates
    const fetchPromises = pubkeys.map(async pubkey => {
      try {
        // One-shot fetch via on-demand pooled instance (auto released)
        const recordResults = await this.onDemandUserData.getEventsByPubkeyAndKind(
          pubkey,
          feedData.filter?.kinds?.[0] || kinds.ShortTextNote
        );
        const events = recordResults.map(r => r.event);

        if (events.length > 0) {
          // Filter events to exclude already loaded ones and ensure they're not too old
          const olderEvents = events
            .filter((event: Event) => {
              const eventTime = (event.created_at || 0) * 1000;
              const eventAge = Date.now() - eventTime;
              return eventTime < (feedData.lastTimestamp || Date.now()) && eventAge <= maxAge;
            })
            .slice(0, eventsPerUser);

          if (olderEvents.length > 0) {
            userEventsMap.set(pubkey, olderEvents);
          }
        }

        processedUsers++;

        // Update UI incrementally for pagination
        this.updatePaginationIncremental(
          userEventsMap,
          feedData,
          existingEvents,
          processedUsers,
          totalUsers
        );
      } catch (error) {
        this.logger.error(`Error fetching older events for user ${pubkey}:`, error);
        processedUsers++;

        // Still update UI even if this user failed
        this.updatePaginationIncremental(
          userEventsMap,
          feedData,
          existingEvents,
          processedUsers,
          totalUsers
        );
      }
    });

    // Wait for all requests to complete
    await Promise.all(fetchPromises);

    // Final update for pagination
    this.finalizePaginationIncremental(userEventsMap, feedData, existingEvents);
  }

  /**
   * Update pagination incrementally as older events are received
   */
  private updatePaginationIncremental(
    userEventsMap: Map<string, Event[]>,
    feedData: FeedItem,
    existingEvents: Event[],
    processedUsers: number,
    totalUsers: number
  ) {
    // Only update UI if we have events and either:
    // 1. We've processed at least 2 users (get some initial content quickly)
    // 2. We've processed all users (final update)
    if (userEventsMap.size === 0 || (processedUsers < 2 && processedUsers < totalUsers)) {
      return;
    }

    // Aggregate current older events
    const olderEvents = this.aggregateAndSortEvents(userEventsMap);

    if (olderEvents.length > 0) {
      // Append to existing events
      const updatedEvents = [...existingEvents, ...olderEvents];
      feedData.events.set(updatedEvents);

      // Update last timestamp
      feedData.lastTimestamp = Math.min(...olderEvents.map(e => (e.created_at || 0) * 1000));

      this.logger.debug(
        `Pagination incremental update: ${processedUsers}/${totalUsers} users processed, ${olderEvents.length} older events`
      );
    }
  }

  /**
   * Finalize pagination with final sort and cleanup
   */
  private finalizePaginationIncremental(
    userEventsMap: Map<string, Event[]>,
    feedData: FeedItem,
    existingEvents: Event[]
  ) {
    // Final aggregation and sort of older events
    const finalOlderEvents = this.aggregateAndSortEvents(userEventsMap);

    // Append to existing events if we have any
    if (finalOlderEvents.length > 0) {
      const updatedEvents = [...existingEvents, ...finalOlderEvents];
      feedData.events.set(updatedEvents);

      // Update last timestamp
      feedData.lastTimestamp = Math.min(...finalOlderEvents.map(e => (e.created_at || 0) * 1000));

      this.logger.debug(
        `Final pagination update: ${finalOlderEvents.length} older events from ${userEventsMap.size} users`
      );
    }

    // Check if we should mark hasMore as false
    // If we got fewer events than expected from users, assume no more data
    const totalEventsFromUsers = Array.from(userEventsMap.values()).flat().length;
    if (totalEventsFromUsers < userEventsMap.size * 2) { // Less than 2 events per user on average
      feedData.hasMore?.set(false);
    }
  } /**
   * Unsubscribe from a single feed (unsubscribes from all its columns)
   */
  private unsubscribeFromFeed(feedId: string): void {
    const feed = this.getFeedById(feedId);
    if (feed && feed.columns) {
      // Unsubscribe from each column in the feed
      feed.columns.forEach(column => {
        this.unsubscribeFromColumn(column.id);
      });
      this.logger.debug(`Unsubscribed from all columns in feed: ${feedId}`);
    } else {
      this.logger.warn(`Cannot unsubscribe from feed ${feedId}: feed not found or has no columns`);
    }
  }
  /**
   * Unsubscribe from a single column
   */
  unsubscribeFromColumn(columnId: string): void {
    const columnData = this.data.get(columnId);
    if (columnData) {
      // Close the subscription
      if (columnData.subscription) {
        this.closeSubscription(columnData.subscription);
        this.logger.debug(`Closed subscription for column: ${columnId}`);
      }

      // Clear events
      columnData.events.set([]);

      // Remove from data map
      this.data.delete(columnId);

      // Update the reactive signal
      this._feedData.update(map => {
        const newMap = new Map(map);
        newMap.delete(columnId);
        return newMap;
      });

      this.logger.debug(`Unsubscribed from column: ${columnId}`);
    }
  }

  // Helper method to get events for a specific feed (aggregates all column events)
  getEventsForFeed(feedId: string): Signal<Event[]> {
    const feed = this.getFeedById(feedId);
    if (!feed) {
      return signal<Event[]>([]);
    }

    // Create a computed signal that aggregates events from all columns in the feed
    return computed(() => {
      const allEvents: Event[] = [];
      feed.columns.forEach(column => {
        const columnData = this.data.get(column.id);
        if (columnData) {
          allEvents.push(...columnData.events());
        }
      });

      // Sort events by timestamp (newest first)
      return allEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    });
  }

  // Helper method to get events for a specific column
  getEventsForColumn(columnId: string): Signal<Event[]> | undefined {
    return this.data.get(columnId)?.events;
  }

  // Helper methods to get loading states for columns
  getColumnLoadingState(columnId: string): Signal<boolean> | undefined {
    return this.data.get(columnId)?.isLoadingMore;
  }

  getColumnHasMore(columnId: string): Signal<boolean> | undefined {
    return this.data.get(columnId)?.hasMore;
  }

  /**
   * Public method to load more events for pagination
   * Called by components when user scrolls to bottom
   */
  async loadMoreEventsForColumn(columnId: string): Promise<void> {
    return this.loadMoreEvents(columnId);
  }

  /**
   * Get the last timestamp for a column (for debugging/monitoring)
   */
  getColumnLastTimestamp(columnId: string): number | undefined {
    const feedData = this.data.get(columnId);
    return feedData?.lastTimestamp;
  }

  /**
   * Get column information including algorithm status
   */
  getColumnInfo(
    columnId: string
  ): { column: ColumnConfig; isFollowing: boolean; lastTimestamp?: number } | undefined {
    const feedData = this.data.get(columnId);
    if (!feedData) return undefined;

    return {
      column: feedData.column,
      isFollowing: feedData.column.source === 'following',
      lastTimestamp: feedData.lastTimestamp,
    };
  }

  unsubscribe() {
    this.data.forEach(item => this.closeSubscription(item.subscription));
    this.data.clear();
    this._feedData.set(new Map());
    this.logger.debug('Unsubscribed from all feed subscriptions');
  }

  /**
   * Load feeds from local storage
   */
  private async loadFeeds(): Promise<void> {
    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.logger.warn('No pubkey found, using defaults');
        const defaultFeeds = await this.initializeDefaultFeeds();
        this._feeds.set(defaultFeeds);
        this.saveFeeds();
        return;
      }
      const feedsByAccount = this.localStorageService.getObject<Record<string, FeedConfig[]>>(
        this.appState.FEEDS_STORAGE_KEY
      );

      const storedFeeds = feedsByAccount && feedsByAccount[pubkey];
      if (storedFeeds && Array.isArray(storedFeeds) && storedFeeds.length > 0) {
        this._feeds.set(storedFeeds);
        this.logger.debug('Loaded feeds from storage for pubkey', pubkey, storedFeeds);
      } else {
        const feedsByAccount: Record<string, FeedConfig[]> = {};
        const defaultFeeds = await this.initializeDefaultFeeds();
        feedsByAccount[pubkey] = defaultFeeds;
        this._feeds.set(defaultFeeds);
        this.saveFeeds();
        this.logger.debug('No feeds found for pubkey, using defaults', pubkey);
      }
    } catch (error) {
      this.logger.error('Error loading feeds from storage:', error);
      this._feeds.set(DEFAULT_FEEDS);
      this.saveFeeds();
    }

    await this.subscribe();
  }

  /**
   * Initialize default feeds with starter pack data
   */
  private async initializeDefaultFeeds(): Promise<FeedConfig[]> {
    try {
      // Fetch available starter packs
      const starterPacks = await this.followset.fetchStarterPacks();

      // Clone default feeds
      const feeds = JSON.parse(JSON.stringify(DEFAULT_FEEDS)) as FeedConfig[];

      // Find the starter feed and populate it with the first available starter pack
      const starterFeed = feeds.find(f => f.id === 'default-feed-starter');
      if (starterFeed && starterFeed.columns.length > 0 && starterPacks.length > 0) {
        // Use the first starter pack's dTag
        starterFeed.columns[0].customStarterPacks = [starterPacks[0].dTag];
        this.logger.info('Initialized starter feed with starter pack:', starterPacks[0].dTag);
      }

      return feeds;
    } catch (error) {
      this.logger.error('Error initializing default feeds with starter packs:', error);
      // Return default feeds without starter packs if there's an error
      return JSON.parse(JSON.stringify(DEFAULT_FEEDS)) as FeedConfig[];
    }
  }

  /**
   * Save feeds to local storage
   */
  private saveFeeds(): void {
    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.logger.warn('No pubkey found, not saving feeds');
        return;
      }

      // Get all feeds by account, update this pubkey's feeds
      const feedsByAccount =
        this.localStorageService.getObject<Record<string, FeedConfig[]>>(
          this.appState.FEEDS_STORAGE_KEY
        ) || {};

      feedsByAccount[pubkey] = this._feeds();
      this.localStorageService.setObject(this.appState.FEEDS_STORAGE_KEY, feedsByAccount);
      this.logger.debug('Saved feeds to storage for pubkey', pubkey, this._feeds());
    } catch (error) {
      this.logger.error('Error saving feeds to storage:', error);
    }
  }

  /**
   * Load relay configurations from local storage
   */
  private loadRelays(): void {
    try {
      const relayData = this.localStorageService.getObject<{
        user: RelayConfig[];
        discovery: RelayConfig[];
      }>(this.appState.RELAYS_STORAGE_KEY);

      if (relayData) {
        this._userRelays.set(relayData.user || []);
        this._discoveryRelays.set(relayData.discovery || []);
      } else {
        // Set default relays
        this.setDefaultRelays();
      }
    } catch (error) {
      this.logger.error('Error loading relays from storage:', error);
      this.setDefaultRelays();
    }
  }

  /**
   * Set default relay configurations
   */
  private setDefaultRelays(): void {
    const defaultUserRelays: RelayConfig[] = [
      { url: 'wss://relay.damus.io', read: true, write: true },
      { url: 'wss://nos.lol', read: true, write: true },
      { url: 'wss://relay.snort.social', read: true, write: true },
    ];

    const defaultDiscoveryRelays: RelayConfig[] = [
      { url: 'wss://discovery.eu.nostria.app', read: true, write: false },
    ];

    this._userRelays.set(defaultUserRelays);
    this._discoveryRelays.set(defaultDiscoveryRelays);
    this.saveRelays();
  }

  /**
   * Save relay configurations to local storage
   */
  private saveRelays(): void {
    try {
      const relayData = {
        user: this._userRelays(),
        discovery: this._discoveryRelays(),
      };
      this.localStorageService.setObject(this.appState.RELAYS_STORAGE_KEY, relayData);
      this.logger.debug('Saved relays to storage', relayData);
    } catch (error) {
      this.logger.error('Error saving relays to storage:', error);
    }
  }
  /**
   * Add a new feed
   */
  async addFeed(feedData: Omit<FeedConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<FeedConfig> {
    const newFeed: FeedConfig = {
      ...feedData,
      id: `feed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this._feeds.update(feeds => [...feeds, newFeed]);
    this.saveFeeds();

    // Subscribe to the new feed immediately
    await this.subscribeToFeed(newFeed);

    this.logger.debug('Added new feed and subscribed', newFeed);
    return newFeed;
  }
  /**
   * Update an existing feed
   */
  async updateFeed(
    id: string,
    updates: Partial<Omit<FeedConfig, 'id' | 'createdAt'>>
  ): Promise<boolean> {
    const feedIndex = this._feeds().findIndex(feed => feed.id === id);
    if (feedIndex === -1) {
      this.logger.warn(`Feed with id ${id} not found`);
      return false;
    }

    const currentFeed = this._feeds()[feedIndex];

    // Handle column changes with targeted subscription management
    if (updates.columns !== undefined) {
      const currentColumns = currentFeed.columns;
      const newColumns = updates.columns;

      // Check if this is just a column reorder (same column IDs, different positions)
      const currentColumnIds = new Set(currentColumns.map(col => col.id));
      const newColumnIds = new Set(newColumns.map(col => col.id));
      const isOnlyReorder =
        currentColumnIds.size === newColumnIds.size &&
        [...currentColumnIds].every(id => newColumnIds.has(id));

      if (isOnlyReorder) {
        // This is just a reorder - update columns without touching subscriptions
        console.log(
          `🔄 FeedService: Detected column reorder for feed ${id} - preserving subscriptions`
        );
        this._feeds.update(feeds => {
          const updatedFeeds = [...feeds];
          updatedFeeds[feedIndex] = {
            ...updatedFeeds[feedIndex],
            ...updates,
            updatedAt: Date.now(),
          };
          return updatedFeeds;
        });
      } else {
        // This is actual column addition/removal - manage subscriptions
        console.log(
          `🔄 FeedService: Detected column changes for feed ${id} - managing subscriptions`
        );

        // Find columns that were removed
        const removedColumns = currentColumns.filter(
          currentCol => !newColumns.some(newCol => newCol.id === currentCol.id)
        );

        // Find columns that were added
        const addedColumns = newColumns.filter(
          newCol => !currentColumns.some(currentCol => currentCol.id === newCol.id)
        );

        // Unsubscribe only from removed columns
        removedColumns.forEach(column => {
          this.unsubscribeFromColumn(column.id);
        });

        // Update the feed configuration first
        this._feeds.update(feeds => {
          const updatedFeeds = [...feeds];
          updatedFeeds[feedIndex] = {
            ...updatedFeeds[feedIndex],
            ...updates,
            updatedAt: Date.now(),
          };
          return updatedFeeds;
        });

        // Subscribe to new columns
        for (const column of addedColumns) {
          await this.subscribeToColumn(column);
        }
      }
    } else {
      // For non-column updates, just update the configuration
      this._feeds.update(feeds => {
        const updatedFeeds = [...feeds];
        updatedFeeds[feedIndex] = {
          ...updatedFeeds[feedIndex],
          ...updates,
          updatedAt: Date.now(),
        };
        return updatedFeeds;
      });
    }
    this.saveFeeds();
    this.logger.debug(`Updated feed ${id}`, updates);
    return true;
  }
  /**
   * Update only the column order without triggering subscription changes
   * This is optimized for drag and drop operations to preserve DOM state
   */
  updateColumnOrder(id: string, columns: ColumnConfig[]): boolean {
    console.log(`🔄 FeedService: Updating column order for feed ${id}`);
    console.log(
      '📋 New column order:',
      columns.map(col => `${col.label} (${col.id})`)
    );
    const feedIndex = this._feeds().findIndex(feed => feed.id === id);
    if (feedIndex === -1) {
      this.logger.warn(`Feed with id ${id} not found`);
      console.warn(`❌ Feed ${id} not found`);
      return false;
    }

    // Update only the column order directly without triggering subscription logic
    this._feeds.update(feeds => {
      const updatedFeeds = [...feeds];
      updatedFeeds[feedIndex] = {
        ...updatedFeeds[feedIndex],
        columns: columns,
        updatedAt: Date.now(),
      };
      return updatedFeeds;
    });

    this.saveFeeds();
    this.logger.debug(
      `Updated column order for feed ${id}`,
      columns.map(col => col.id)
    );
    console.log(`✅ FeedService: Column order updated successfully without subscription changes`);
    return true;
  }

  /**
   * Remove a feed
   */
  removeFeed(id: string): boolean {
    const initialLength = this._feeds().length;

    // Unsubscribe from the feed before removing it
    this.unsubscribeFromFeed(id);

    // Remove the feed from the list
    this._feeds.update(feeds => feeds.filter(feed => feed.id !== id));

    if (this._feeds().length < initialLength) {
      this.saveFeeds();
      this.logger.debug(`Removed feed ${id} and unsubscribed`);
      return true;
    }

    this.logger.warn(`Feed with id ${id} not found`);
    return false;
  }

  /**
   * Reset all feeds to default configuration
   */
  async resetToDefaults(): Promise<void> {
    // Unsubscribe from all current feeds
    const currentFeeds = this._feeds();
    currentFeeds.forEach(feed => {
      this.unsubscribeFromFeed(feed.id);
    });

    // Clear active feed
    this._activeFeedId.set(null);

    // Reset feeds to defaults with initialized starter packs
    const defaultFeeds = await this.initializeDefaultFeeds();
    this._feeds.set(defaultFeeds);
    this.saveFeeds();

    this.logger.debug('Reset all feeds to defaults');
  }

  /**
   * Get a feed by ID
   */
  getFeedById(id: string): FeedConfig | undefined {
    return this._feeds().find(feed => feed.id === id);
  }

  /**
   * Reorder feeds
   */
  reorderFeeds(newOrder: string[]): void {
    const currentFeeds = this._feeds();
    const reorderedFeeds = newOrder
      .map(id => currentFeeds.find(feed => feed.id === id))
      .filter((feed): feed is FeedConfig => feed !== undefined);

    // Add any feeds that weren't in the newOrder array
    const missingFeeds = currentFeeds.filter(feed => !newOrder.includes(feed.id));

    this._feeds.set([...reorderedFeeds, ...missingFeeds]);
    this.saveFeeds();
    this.logger.debug('Reordered feeds', newOrder);
  }

  /**
   * Get feed type configuration
   */
  getFeedType(type: keyof typeof COLUMN_TYPES) {
    return COLUMN_TYPES[type];
  }

  /**
   * Get all available feed types
   */
  getFeedTypes() {
    return Object.entries(COLUMN_TYPES).map(([key, value]) => ({
      key: key as keyof typeof COLUMN_TYPES,
      ...value,
    }));
  }

  /**
   * Update user relays
   */
  updateUserRelays(relays: RelayConfig[]): void {
    this._userRelays.set(relays);
    this.saveRelays();
    this.logger.debug('Updated user relays', relays);
  }

  /**
   * Update discovery relays
   */
  updateDiscoveryRelays(relays: RelayConfig[]): void {
    this._discoveryRelays.set(relays);
    this.saveRelays();
    this.logger.debug('Updated discovery relays', relays);
  }

  /**
   * Add a custom relay to a feed
   */
  addCustomRelay(url: string): boolean {
    try {
      new URL(url); // Validate URL
      return true;
    } catch {
      this.logger.warn('Invalid relay URL:', url);
      return false;
    }
  }

  /**
   * Validate relay URL
   */
  validateRelayUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.protocol === 'wss:' || parsedUrl.protocol === 'ws:';
    } catch {
      return false;
    }
  }

  /**
   * Refresh a specific column by unsubscribing and resubscribing
   */
  async refreshColumn(columnId: string): Promise<void> {
    console.log(`🔄 FeedService: Refreshing column ${columnId}`);
    const columnData = this.data.get(columnId);
    if (!columnData) {
      this.logger.warn(`Cannot refresh column ${columnId}: column not found`);
      console.warn(`❌ Column ${columnId} not found in data map`);
      return;
    }

    const column = columnData.column;
    console.log(`📊 Column found: ${column.label}, unsubscribing and resubscribing...`);

    // Unsubscribe from the column
    this.unsubscribeFromColumn(columnId);

    // Resubscribe to the column
    await this.subscribeToColumn(column);

    this.logger.debug(`Refreshed column: ${columnId}`);
    console.log(`✅ FeedService: Column ${columnId} refreshed successfully`);
  }

  /**
   * Refresh all columns with 'following' source in the active feed
   * This should be called after the user's following list changes to reload content
   */
  async refreshFollowingColumns(): Promise<void> {
    console.log(`🔄 FeedService: Refreshing all following columns`);
    const activeFeedId = this._activeFeedId();
    if (!activeFeedId) {
      this.logger.warn('Cannot refresh following columns: no active feed');
      return;
    }

    const activeFeed = this.getFeedById(activeFeedId);
    if (!activeFeed) {
      this.logger.warn(`Cannot refresh following columns: active feed ${activeFeedId} not found`);
      return;
    }

    // Find all columns with 'following' source
    const followingColumns = activeFeed.columns.filter(column => column.source === 'following');

    if (followingColumns.length === 0) {
      this.logger.debug('No following columns found in active feed');
      console.log(`ℹ️ No following columns to refresh in feed: ${activeFeed.label}`);
      return;
    }

    console.log(`📊 Found ${followingColumns.length} following columns to refresh`);

    // Refresh each following column
    for (const column of followingColumns) {
      console.log(`🔄 Refreshing following column: ${column.label} (${column.id})`);
      await this.refreshColumn(column.id);
    }

    this.logger.debug(`Refreshed ${followingColumns.length} following columns`);
    console.log(
      `✅ FeedService: Refreshed ${followingColumns.length} following columns successfully`
    );
  }

  /**
   * Pause a specific column by closing subscription while preserving events
   */
  pauseColumn(columnId: string): void {
    console.log(`⏸️ FeedService: Pausing column ${columnId}`);
    const columnData = this.data.get(columnId);
    if (!columnData) {
      this.logger.warn(`Cannot pause column ${columnId}: column not found`);
      console.warn(`❌ Column ${columnId} not found in data map`);
      return;
    }

    // Close the subscription if it exists
    if (columnData.subscription) {
      this.closeSubscription(columnData.subscription);
      columnData.subscription = null;
      this.logger.debug(`Closed subscription for paused column: ${columnId}`);
      console.log(`⏸️ Subscription closed for column: ${columnData.column.label}`);

      // Update the reactive signal to trigger UI updates
      this._feedData.update(map => {
        const newMap = new Map(map);
        newMap.set(columnId, columnData);
        return newMap;
      });
    }

    // Note: Events are preserved in columnData.events signal
    this.logger.debug(`Paused column: ${columnId} (events preserved)`);
    console.log(`✅ FeedService: Column ${columnId} paused successfully`);
  }
  /**
   * Continue a specific column by restarting subscription
   */
  async continueColumn(columnId: string): Promise<void> {
    console.log(`▶️ FeedService: Continuing column ${columnId}`);
    const columnData = this.data.get(columnId);
    if (!columnData) {
      this.logger.warn(`Cannot continue column ${columnId}: column not found`);
      console.warn(`❌ Column ${columnId} not found in data map`);
      return;
    }

    // Check if already subscribed
    if (columnData.subscription) {
      this.logger.warn(`Column ${columnId} is already subscribed`);
      console.warn(`⚠️ Column ${columnData.column.label} is already active`);
      return;
    }

    const column = columnData.column;
    console.log(`📊 Restarting subscription for column: ${column.label}`);

    // Handle following feeds with algorithm
    if (column.source === 'following') {
      await this.loadFollowingFeed(columnData);
    } else {
      // Subscribe to relay events again
      const sub = this.accountRelay.subscribe(
        columnData.filter ? columnData.filter : {},
        event => {
          columnData.events.update((events: Event[]) => [event, ...events]);
          this.logger.debug(`Column event received for ${columnId}:`, event);
        }
      );

      columnData.subscription = sub;
    }

    // Update the reactive signal to trigger UI updates
    this._feedData.update(map => {
      const newMap = new Map(map);
      newMap.set(columnId, columnData);
      return newMap;
    });

    this.logger.debug(`Continued column: ${columnId}`);
    console.log(`✅ FeedService: Column ${columnId} continued successfully`);
  }
}
