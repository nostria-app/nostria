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
import { DatabaseService } from './database.service';
import { Event, kinds } from 'nostr-tools';
import { ApplicationStateService } from './application-state.service';
import { AccountStateService } from './account-state.service';
import { AccountLocalStateService } from './account-local-state.service';
import { DataService } from './data.service';
import { UtilitiesService } from './utilities.service';
import { ApplicationService } from './application.service';
import { Algorithms } from './algorithms';
import { UserDataService } from './user-data.service';
import { OnDemandUserDataService } from './on-demand-user-data.service';
import { UserRelayService } from './relays/user-relay';
import { SharedRelayService } from './relays/shared-relay';
import { AccountRelayService } from './relays/account-relay';
import { RelayPoolService } from './relays/relay-pool';
import { Followset } from './followset';
import { RegionService } from './region.service';
import { EncryptionService } from './encryption.service';
import { LocalSettingsService } from './local-settings.service';
import { FollowingDataService } from './following-data.service';

export interface FeedItem {
  column: ColumnConfig;
  events: WritableSignal<Event[]>;
  filter: {
    ids?: string[];
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
  isRefreshing?: WritableSignal<boolean>; // Track when column is actively refreshing/loading
  hasMore?: WritableSignal<boolean>;
  pendingEvents?: WritableSignal<Event[]>;
  lastCheckTimestamp?: number;
  initialLoadComplete?: boolean; // Track when initial relay loading is done
}

export interface ColumnConfig {
  id: string;
  label: string;
  icon: string;
  path?: string;
  type: 'notes' | 'articles' | 'photos' | 'videos' | 'music' | 'polls' | 'custom';
  kinds: number[];
  source?: 'following' | 'public' | 'custom' | 'for-you';
  customUsers?: string[]; // Array of pubkeys for custom user selection
  customStarterPacks?: string[]; // Array of starter pack identifiers (d tags)
  customFollowSets?: string[]; // Array of follow set identifiers (d tags from kind 30000 events)
  relayConfig: 'account' | 'custom';
  customRelays?: string[];
  filters?: Record<string, unknown>;
  showReplies?: boolean; // Whether to show replies in the feed (default: false)
  createdAt: number;
  updatedAt: number;
  lastRetrieved?: number; // Timestamp (seconds) of when data was last successfully retrieved from relays
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
    kinds: [21, 22, 34235, 34236],
    description: 'Videos (normal, short, and addressable)',
  },
  music: {
    label: 'Music',
    icon: 'music_note',
    kinds: [32100],
    description: 'Music playlists (.m3u)',
  },
  polls: {
    label: 'Polls',
    icon: 'poll',
    kinds: [1068],
    description: 'Polls and surveys',
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
    id: 'default-feed-for-you',
    label: 'For You',
    icon: 'for_you',
    description: 'Personalized content based on your interests and network',
    columns: [
      {
        id: 'for-you-column',
        label: '',
        icon: 'auto_awesome',
        type: 'notes',
        kinds: [kinds.ShortTextNote, kinds.Repost],
        source: 'for-you',
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
    icon: 'diversity_2',
    path: 'following',
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
  {
    id: 'default-feed-discover',
    label: 'Discover',
    icon: 'rocket_launch',
    path: 'discover',
    description: 'Curated content to discover Nostr accounts',
    columns: [
      {
        id: 'discover-column',
        label: '',
        icon: 'group',
        type: 'notes',
        kinds: [kinds.ShortTextNote, kinds.Repost],
        source: 'custom',
        // Use the 'popular' starter pack dynamically fetched from relays
        // Published by d1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b
        customUsers: [], // Will be populated dynamically from starter pack
        customStarterPacks: ['popular'], // Reference the 'popular' starter pack by dTag
        relayConfig: 'account',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'default-feed-articles',
    label: 'Articles',
    icon: 'newsmode',
    path: 'articles',
    description: 'Long-form articles from your network',
    columns: [
      {
        id: 'articles-column',
        label: '',
        icon: 'article',
        type: 'articles',
        kinds: [30023], // Long-form content
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
  private readonly database = inject(DatabaseService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly appState = inject(ApplicationStateService);
  private readonly accountState = inject(AccountStateService);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly dataService = inject(DataService);
  private readonly utilities = inject(UtilitiesService);
  private readonly app = inject(ApplicationService);
  private readonly userRelayEx = inject(UserRelayService);
  private readonly sharedRelayEx = inject(SharedRelayService);
  private readonly userDataService = inject(UserDataService);
  private readonly relayPool = inject(RelayPoolService);
  // On-demand access for one-shot per-user fetches to avoid lingering sockets
  private readonly onDemandUserData = inject(OnDemandUserDataService);
  private readonly followset = inject(Followset);
  private readonly regionService = inject(RegionService);
  private readonly encryption = inject(EncryptionService);
  private readonly localSettings = inject(LocalSettingsService);
  private readonly followingData = inject(FollowingDataService);

  private readonly algorithms = inject(Algorithms);

  // Signals for feeds and relays
  private readonly _feeds = signal<FeedConfig[]>([]);
  private readonly _userRelays = signal<RelayConfig[]>([]);
  private readonly _discoveryRelays = signal<RelayConfig[]>([]);
  private readonly _feedsLoaded = signal<boolean>(false);

  // Active feed subscription management
  private readonly _activeFeedId = signal<string | null>(null);
  private activeFeedSubscriptions = new Set<string>(); // Track column IDs with active subscriptions
  private subscriptionInProgress: string | null = null; // Track feed currently being subscribed to

  // Track whether the Feeds page is currently active/mounted
  private readonly _feedsPageActive = signal<boolean>(false);

  // New event checking
  private newEventCheckInterval: ReturnType<typeof setInterval> | null = null;

  // Public computed signals
  readonly feeds = computed(() => this._feeds());
  readonly userRelays = computed(() => this._userRelays());
  readonly discoveryRelays = computed(() => this._discoveryRelays());
  readonly activeFeedId = computed(() => this._activeFeedId());
  readonly feedsLoaded = computed(() => this._feedsLoaded());
  readonly feedsPageActive = computed(() => this._feedsPageActive());

  // Feed type definitions
  readonly feedTypes = COLUMN_TYPES;

  // Cache constants
  private readonly CACHE_SIZE = 200; // Cache 200 events per column

  constructor() {
    effect(() => {
      // Watch for pubkey changes to reload feeds when account switches

      const pubkey = this.accountState.pubkey();
      const initialized = this.accountState.initialized();

      if (pubkey && initialized) {
        untracked(async () => {
          // Reset feedsLoaded before loading new feeds
          this._feedsLoaded.set(false);
          await this.loadFeeds(pubkey);
          this.loadRelays();
        });
      }
    });
  }

  /**
   * Get the entire cache structure for the current account
   * NOTE: This method is deprecated - use loadCachedEvents instead
   */
  private getAccountCache(): Record<string, Event[]> {
    // This method is no longer used with IndexedDB
    // Keeping for backward compatibility during migration
    return {};
  }

  /**
   * Load cached events for a column - async operation using IndexedDB
   */
  private async loadCachedEvents(columnId: string): Promise<Event[]> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return [];

    try {
      await this.database.init();
      const cachedEvents = await this.database.loadCachedEvents(pubkey, columnId);

      if (cachedEvents.length > 0) {
        this.logger.info(`✅ Loaded ${cachedEvents.length} cached events for column ${columnId}`);
      }
      return cachedEvents;
    } catch (error) {
      this.logger.error('Error loading cached events:', error);
      return [];
    }
  }

  // Track pending cache saves to prevent duplicates
  private pendingCacheSaves = new Map<string, Promise<void>>();

  /**
   * Save events to cache for a column (debounced to prevent duplicates)
   * Also saves events to the main events store for querying by Summary page
   */
  private async saveCachedEvents(columnId: string, events: Event[]): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    // Create cache key
    const cacheKey = `${pubkey}::${columnId}`;

    // If a save is already pending for this column, wait for it instead of duplicating
    const pendingSave = this.pendingCacheSaves.get(cacheKey);
    if (pendingSave) {
      this.logger.debug(`⏭️ Skipping duplicate cache save for column ${columnId}`);
      return pendingSave;
    }

    // Create the save promise
    const savePromise = (async () => {
      try {
        await this.database.init();

        // Save to cache for instant loading
        await this.database.saveCachedEvents(pubkey, columnId, events);
        this.logger.debug(`💾 Saved ${events.length} events to cache for column ${columnId}`);

        // Also save each event to the main events store for Summary queries
        // This enables the Summary page to query events by pubkey and kind
        for (const event of events) {
          try {
            await this.database.saveEvent(event);
          } catch {
            // Ignore duplicate key errors - event already exists
          }
        }
      } catch (error) {
        this.logger.error('Error saving cached events:', error);
      } finally {
        // Clean up the pending save after a short delay
        setTimeout(() => this.pendingCacheSaves.delete(cacheKey), 100);
      }
    })();

    // Track the pending save
    this.pendingCacheSaves.set(cacheKey, savePromise);
    return savePromise;
  }

  /**
   * Save a single event to the database (for Summary page queries)
   */
  private async saveEventToDatabase(event: Event): Promise<void> {
    try {
      await this.database.init();
      await this.database.saveEvent(event);
    } catch {
      // Ignore errors - event might already exist
    }
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
    // Don't subscribe if there's no active account
    if (!this.accountState.account()) {
      this.logger.debug('No active account - skipping feed subscription');
      return;
    }

    // Don't subscribe if the Feeds page is not active
    if (!this._feedsPageActive()) {
      this.logger.debug('Feeds page not active - skipping feed subscription');
      return;
    }

    this.data.clear();
    this._feedData.set(new Map());

    // Clear any existing new event check interval
    if (this.newEventCheckInterval) {
      clearInterval(this.newEventCheckInterval);
      this.newEventCheckInterval = null;
    }

    // Only subscribe to active feed if one is set
    const activeFeedId = this._activeFeedId();
    if (activeFeedId) {
      const activeFeed = this.getFeedById(activeFeedId);
      if (activeFeed) {
        await this.subscribeToFeed(activeFeed);
        this.logger.debug('Subscribed to active feed:', activeFeedId);

        // Start checking for new events every 60 seconds
        this.newEventCheckInterval = setInterval(() => {
          this.checkForNewEvents();
        }, 60000);
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
   * Set whether the Feeds page is currently active/mounted.
   * This controls whether subscriptions should be created or maintained.
   */
  setFeedsPageActive(active: boolean): void {
    this._feedsPageActive.set(active);
    this.logger.debug(`Feeds page active state set to: ${active}`);

    if (!active) {
      // When page becomes inactive, unsubscribe from all feeds
      this.unsubscribe();
    }
  }

  /**
   * Set the active feed and manage subscriptions
   */
  async setActiveFeed(feedId: string | null): Promise<void> {
    // Don't set active feed if there's no active account
    if (!this.accountState.account()) {
      this.logger.debug('No active account - skipping setActiveFeed');
      return;
    }

    // Don't create subscriptions if the Feeds page is not active
    if (!this._feedsPageActive()) {
      this.logger.debug('Feeds page not active - skipping setActiveFeed subscription');
      // Still update the active feed ID for when the page becomes active
      this._activeFeedId.set(feedId);
      return;
    }

    // Prevent concurrent subscription attempts to the same feed
    if (this.subscriptionInProgress === feedId) {
      this.logger.debug(`Subscription to feed ${feedId} already in progress, skipping duplicate call`);
      return;
    }

    const previousActiveFeedId = this._activeFeedId();

    // If same feed is already active AND has active subscriptions, do nothing
    if (previousActiveFeedId === feedId && feedId) {
      // Check if feed actually has active subscriptions (data is loaded)
      const feed = this.getFeedById(feedId);
      const hasActiveSubscriptions = feed?.columns.every(col => this.data.has(col.id));

      if (hasActiveSubscriptions) {
        this.logger.debug(`Feed ${feedId} is already active with subscriptions, skipping resubscribe`);
        return;
      } else {
        this.logger.debug(`Feed ${feedId} is marked active but has no subscriptions, resubscribing`);
      }
    }

    // Mark subscription as in progress
    this.subscriptionInProgress = feedId;

    try {
      // Unsubscribe from previous active feed
      if (previousActiveFeedId && previousActiveFeedId !== feedId) {
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
    } finally {
      // Clear subscription in progress flag
      this.subscriptionInProgress = null;
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
    // Subscribe to all columns in parallel for faster initial load
    await Promise.all(feed.columns.map(column => this.subscribeToColumn(column)));
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

    // Check if we should start feeds on last event (queue new events instead of auto-merging)
    const startFeedsOnLastEvent = this.localSettings.startFeedsOnLastEvent();

    // Determine initial load complete state:
    // - If startFeedsOnLastEvent is ON: ALWAYS mark complete immediately (queue ALL relay events)
    // - If startFeedsOnLastEvent is OFF: mark NOT complete (merge initial relay events, then queue after)
    const initialLoadComplete = startFeedsOnLastEvent;

    // Create item with empty events FIRST to ensure feedDataReactive has entry immediately
    const item: FeedItem = {
      column,
      filter: null,
      events: signal<Event[]>([]), // Start with empty, will update with cached events
      subscription: null,
      lastTimestamp: Date.now(),
      isLoadingMore: signal<boolean>(false),
      isRefreshing: signal<boolean>(true), // Start as refreshing since we're loading content
      hasMore: signal<boolean>(true),
      pendingEvents: signal<Event[]>([]),
      lastCheckTimestamp: Math.floor(Date.now() / 1000),
      initialLoadComplete: initialLoadComplete,
    };

    // Add to data map IMMEDIATELY so UI has an entry (even if empty)
    this.data.set(column.id, item);
    this._feedData.update(map => {
      const newMap = new Map(map);
      newMap.set(column.id, item);
      return newMap;
    });

    // NOW load cached events asynchronously and update the signal
    const cachedEvents = await this.loadCachedEvents(column.id);

    if (cachedEvents.length > 0) {
      // Update the events signal with cached events
      item.events.set(cachedEvents);

      // Update lastCheckTimestamp based on most recent cached event
      const mostRecentTimestamp = Math.max(...cachedEvents.map(e => e.created_at));
      item.lastCheckTimestamp = mostRecentTimestamp;

      this.logger.info(`🚀 Rendered ${cachedEvents.length} cached events for column ${column.id}`);
    }

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

    // Add 'since' parameter based on lastRetrieved timestamp to prevent re-fetching old events
    // Use lastRetrieved instead of event.created_at since users can set arbitrary timestamps
    // IMPORTANT: Only use lastRetrieved if we have cached events to display.
    // If there are no cached events, we need to fetch historical events without the 'since' filter,
    // otherwise the feed will appear empty.
    if (column.lastRetrieved && item.filter && cachedEvents.length > 0) {
      item.filter.since = column.lastRetrieved;
      this.logger.info(`📅 Column ${column.id}: Using since=${column.lastRetrieved} (lastRetrieved) to fetch only new events`);
    } else if (column.lastRetrieved && cachedEvents.length === 0) {
      this.logger.info(`📅 Column ${column.id}: No cached events, ignoring lastRetrieved=${column.lastRetrieved} to fetch historical events`);
    }

    // Now start loading fresh events in the BACKGROUND (don't await)
    // This allows cached events to display immediately while fresh data loads
    // If the source is following, fetch from ALL following users
    if (column.source === 'following') {
      console.log(`📍 Loading FOLLOWING feed for column ${column.id}`);
      this.loadFollowingFeed(item).catch(err =>
        this.logger.error(`Error loading following feed for ${column.id}:`, err)
      );
    } else if (column.source === 'for-you') {
      console.log(`📍 Loading FOR-YOU feed for column ${column.id}`);
      this.loadForYouFeed(item).catch(err =>
        this.logger.error(`Error loading for-you feed for ${column.id}:`, err)
      );
    } else if (column.source === 'custom') {
      console.log(`📍 Loading CUSTOM feed for column ${column.id}`);
      this.loadCustomFeed(item).catch(err =>
        this.logger.error(`Error loading custom feed for ${column.id}:`, err)
      );
    } else {
      console.log(`📍 Loading GLOBAL/OTHER feed for column ${column.id}, source:`, column.source);

      // Subscribe to relay events using the appropriate relay service
      let sub: { unsubscribe: () => void } | { close: () => void } | null = null;

      if (
        column.relayConfig === 'custom' &&
        column.customRelays &&
        column.customRelays.length > 0
      ) {
        // Use custom relays for this column via RelayPoolService
        this.logger.debug(`Using custom relays for column ${column.id}:`, column.customRelays);
        console.log(`🚀 Using RelayPoolService.subscribe with custom relays:`, column.customRelays);
        console.log(`🚀 Subscribing to relay with filter:`, JSON.stringify(item.filter, null, 2));

        sub = this.relayPool.subscribe(column.customRelays, item.filter, (event: Event) => {
          console.log(`📨 Event received in callback: ${event.id.substring(0, 8)}...`);

          // Save event to database for Summary page queries
          this.saveEventToDatabase(event);

          // Filter out live events that are muted.
          if (this.accountState.muted(event)) {
            console.log(`🔇 Event muted: ${event.id.substring(0, 8)}...`);
            return;
          }

          const currentEvents = item.events();
          // Queue events if initial load is complete AND there are existing events
          // If there are zero events, show new events directly (don't force user to click "new posts" button)
          if (item.initialLoadComplete && currentEvents.length > 0) {
            console.log(`📥 Queuing relay event for column ${column.id}: ${event.id.substring(0, 8)}...`);
            item.pendingEvents?.update((pending: Event[]) => {
              // Avoid duplicates
              if (pending.some(e => e.id === event.id)) {
                return pending;
              }
              const newPending = [...pending, event];
              return newPending.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
            });
          } else {
            // Initial load not complete OR no existing events - render relay events directly
            console.log(`➕ Adding relay event to empty feed for column ${column.id}: ${event.id.substring(0, 8)}...`);
            item.events.update((events: Event[]) => {
              // Avoid duplicates
              if (events.some(e => e.id === event.id)) {
                return events;
              }
              const newEvents = [...events, event];
              const sortedEvents = newEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
              // Schedule cache save (debounced internally)
              this.saveCachedEvents(column.id, sortedEvents);
              return sortedEvents;
            });
          }

          this.logger.debug(`Column event received for ${column.id}:`, event);
        });
      } else {
        // Use account relays (default)
        this.logger.debug(`Using account relays for column ${column.id}`);
        console.log(`🚀 Using AccountRelayService.subscribe`);
        console.log(`🚀 Subscribing to relay with filter:`, JSON.stringify(item.filter, null, 2));

        sub = this.accountRelay.subscribe(item.filter, (event: Event) => {
          console.log(`📨 Event received in callback: ${event.id.substring(0, 8)}...`);

          // Save event to database for Summary page queries
          this.saveEventToDatabase(event);

          // Filter out live events that are muted.
          if (this.accountState.muted(event)) {
            console.log(`🔇 Event muted: ${event.id.substring(0, 8)}...`);
            return;
          }

          const currentEvents = item.events();
          // Queue events if initial load is complete AND there are existing events
          // If there are zero events, show new events directly (don't force user to click "new posts" button)
          if (item.initialLoadComplete && currentEvents.length > 0) {
            console.log(`📥 Queuing relay event for column ${column.id}: ${event.id.substring(0, 8)}...`);
            item.pendingEvents?.update((pending: Event[]) => {
              // Avoid duplicates
              if (pending.some(e => e.id === event.id)) {
                return pending;
              }
              const newPending = [...pending, event];
              return newPending.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
            });
          } else {
            // Initial load not complete OR no existing events - render relay events directly
            console.log(`➕ Adding relay event to empty feed for column ${column.id}: ${event.id.substring(0, 8)}...`);
            item.events.update((events: Event[]) => {
              // Avoid duplicates
              if (events.some(e => e.id === event.id)) {
                return events;
              }
              const newEvents = [...events, event];
              const sortedEvents = newEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
              // Schedule cache save (debounced internally)
              this.saveCachedEvents(column.id, sortedEvents);
              return sortedEvents;
            });
          }

          this.logger.debug(`Column event received for ${column.id}:`, event);
        });
      }

      item.subscription = sub;
      console.log(`✅ Subscription created and stored:`, sub ? 'YES' : 'NO');

      // For empty feeds, mark initial load as complete after 2 seconds
      // This allows initial burst of events to render, then subsequent events queue
      // Use the current state of events since cache was already loaded above
      const hasCachedEvents = item.events().length > 0;
      if (!hasCachedEvents) {
        setTimeout(() => {
          if (!item.initialLoadComplete) {
            item.initialLoadComplete = true;
            item.isRefreshing?.set(false);
            this.logger.info(`✅ Initial relay load complete for column ${column.id} - new events will be queued`);
          }
        }, 2000); // 2 seconds for initial events on empty feeds
      }
    }

    // Note: item was already added to data map at the beginning of this method
    // for instant rendering of cached events
  }

  /**
   * Load custom feed using specified users and starter packs
   *
   * This method:
   * 1. Collects pubkeys from customUsers array
   * 2. Fetches starter pack data and extracts pubkeys
   * 3. Fetches follow set data and extracts pubkeys
   * 4. Combines all pubkeys and fetches events
   * 5. Uses ALL pubkeys without algorithm filtering
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

      // Add pubkeys from follow sets (kind 30000)
      if (column.customFollowSets && column.customFollowSets.length > 0) {
        try {
          const pubkey = this.accountState.pubkey();
          if (!pubkey) {
            this.logger.warn('No pubkey available for fetching follow sets');
          } else {
            // Fetch kind 30000 events
            const records = await this.dataService.getEventsByPubkeyAndKind(pubkey, 30000, {
              save: true,
              cache: true,
            });

            if (records && records.length > 0) {
              for (const record of records) {
                if (!record.event) continue;

                const event = record.event;
                const dTag = event.tags.find((t: string[]) => t[0] === 'd')?.[1];

                // Check if this follow set is selected
                if (dTag && column.customFollowSets.includes(dTag)) {
                  // Extract public pubkeys from p tags
                  const publicPubkeys = event.tags
                    .filter((t: string[]) => t[0] === 'p' && t[1])
                    .map((t: string[]) => t[1]);

                  publicPubkeys.forEach((pk: string) => allPubkeys.add(pk));
                  this.logger.debug(`[loadCustomFeed] Follow set "${dTag}" has ${publicPubkeys.length} public pubkeys`);

                  // Extract private pubkeys from encrypted content
                  if (event.content && event.content.trim() !== '') {
                    try {
                      const isEncrypted = this.encryption.isContentEncrypted(event.content);
                      if (isEncrypted) {
                        const decrypted = await this.encryption.autoDecrypt(event.content, pubkey, event);
                        if (decrypted && decrypted.content) {
                          const privateData = JSON.parse(decrypted.content);
                          if (Array.isArray(privateData)) {
                            const privatePubkeys = privateData
                              .filter((tag: string[]) => tag[0] === 'p' && tag[1])
                              .map((tag: string[]) => tag[1]);
                            privatePubkeys.forEach(pk => allPubkeys.add(pk));
                          }
                        }
                      }
                    } catch (error) {
                      this.logger.error(`Failed to decrypt follow set ${dTag}:`, error);
                    }
                  }

                  this.logger.debug(`Added follow set ${dTag} with ${publicPubkeys.length} public users`);
                }
              }

              const totalPubkeysFromFollowSets = allPubkeys.size - (column.customUsers?.length || 0);
              this.logger.debug(`[loadCustomFeed] Processed ${column.customFollowSets.length} follow sets, added ${totalPubkeysFromFollowSets} pubkeys`);
            } else {
              this.logger.warn(`[loadCustomFeed] No follow set events found for selected dTags:`, column.customFollowSets);
            }
          }
        } catch (error) {
          this.logger.error('Error fetching follow set data:', error);
        }
      }

      const pubkeysArray = Array.from(allPubkeys);

      this.logger.debug(`[loadCustomFeed] Total unique pubkeys collected: ${pubkeysArray.length}`);
      this.logger.debug(`[loadCustomFeed] Breakdown - Custom users: ${column.customUsers?.length || 0}, Starter packs: ${column.customStarterPacks?.length || 0}, Follow sets: ${column.customFollowSets?.length || 0}`);

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

      this.logger.debug(`Loading custom feed with ${pubkeysArray.length} unique users (ALL will be used, no algorithm filtering)`);

      // Fetch events from ALL specified users (no algorithm filtering)
      await this.fetchEventsFromUsers(pubkeysArray, feedData);

      this.logger.debug(`Loaded custom feed with ${pubkeysArray.length} users`);
    } catch (error) {
      this.logger.error('Error loading custom feed:', error);
    }
  }

  /**
   * Load following feed - fetches events from ALL users the current user follows.
   * 
   * This method uses the FollowingDataService for efficient batched fetching:
   * 1. Groups following users by shared relay sets
   * 2. Sends batched queries to minimize relay connections
   * 3. Only fetches events since last fetch (or max 6 hours)
   * 4. Updates UI incrementally as events arrive
   * 5. Shares data with Summary page
   */
  private async loadFollowingFeed(feedData: FeedItem) {
    try {
      const followingList = this.accountState.followingList();

      // If following list is empty, return early
      if (followingList.length === 0) {
        this.logger.debug('Following list is empty, no users to fetch from');
        return;
      }

      const kinds = feedData.filter?.kinds || [1]; // Default to text notes

      this.logger.info(`📢 Loading FOLLOWING feed with ${followingList.length} users`);

      // Use the centralized FollowingDataService for efficient fetching
      const events = await this.followingData.ensureFollowingData(
        kinds,
        false, // Don't force refresh if data is fresh
        // Incremental update callback
        (newEvents: Event[]) => {
          this.handleFollowingIncrementalUpdate(feedData, newEvents);
        }
      );

      // Final update with all events
      this.handleFollowingFinalUpdate(feedData, events);

      this.logger.info(`✅ Loaded FOLLOWING feed with ${events.length} events from ${followingList.length} users`);
    } catch (error) {
      this.logger.error('Error loading following feed:', error);
    }
  }

  /**
   * Handle incremental updates for following feed as events arrive
   */
  private handleFollowingIncrementalUpdate(feedData: FeedItem, newEvents: Event[]) {
    if (newEvents.length === 0) return;

    const existingEvents = feedData.events();

    // Filter out muted events
    const filteredEvents = newEvents.filter(event => !this.accountState.muted(event));

    if (filteredEvents.length === 0) return;

    // If initial load is already complete and we have existing events, queue to pending
    if (feedData.initialLoadComplete && existingEvents.length > 0) {
      const existingIds = new Set(existingEvents.map(e => e.id));
      const pendingIds = new Set(feedData.pendingEvents?.()?.map(e => e.id) || []);

      const trulyNewEvents = filteredEvents.filter(
        e => !existingIds.has(e.id) && !pendingIds.has(e.id)
      );

      if (trulyNewEvents.length > 0) {
        feedData.pendingEvents?.update((pending: Event[]) => {
          const newPending = [...pending, ...trulyNewEvents];
          return newPending.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        });
      }
    } else {
      // Initial load - merge events directly
      const existingIds = new Set(existingEvents.map(e => e.id));
      const trulyNewEvents = filteredEvents.filter(e => !existingIds.has(e.id));

      if (trulyNewEvents.length > 0) {
        const mergedEvents = [...existingEvents, ...trulyNewEvents]
          .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

        feedData.events.set(mergedEvents);

        // Save to database for Summary page queries
        for (const event of trulyNewEvents) {
          this.saveEventToDatabase(event);
        }
      }
    }
  }

  /**
   * Finalize following feed with all fetched events
   */
  private handleFollowingFinalUpdate(feedData: FeedItem, allEvents: Event[]) {
    // Filter out muted events
    const filteredEvents = allEvents.filter(event => !this.accountState.muted(event));

    const existingEvents = feedData.events();

    if (feedData.initialLoadComplete && existingEvents.length > 0) {
      // Find the most recent event in the existing feed
      const mostRecentExistingTimestamp = Math.max(...existingEvents.map(e => e.created_at || 0));

      const existingIds = new Set(existingEvents.map(e => e.id));
      const pendingIds = new Set(feedData.pendingEvents?.()?.map(e => e.id) || []);

      // Separate events into:
      // 1. Events that should be merged (older than or equal to most recent existing, not duplicates)
      // 2. Events that should be queued (newer than most recent existing)
      const eventsToMerge: Event[] = [];
      const eventsToQueue: Event[] = [];

      for (const event of filteredEvents) {
        if (existingIds.has(event.id) || pendingIds.has(event.id)) {
          // Already exists, skip
          continue;
        }

        if (event.created_at <= mostRecentExistingTimestamp) {
          // Older or same age as existing events - merge directly (fill gaps)
          eventsToMerge.push(event);
        } else {
          // Newer than existing events - queue for "new posts" button
          eventsToQueue.push(event);
        }
      }

      // Merge older events directly into the feed
      if (eventsToMerge.length > 0) {
        const mergedEvents = [...existingEvents, ...eventsToMerge]
          .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        feedData.events.set(mergedEvents);

        this.logger.debug(`✅ Merged ${eventsToMerge.length} older events into feed`);
      }

      // Queue newer events
      if (eventsToQueue.length > 0) {
        feedData.pendingEvents?.update((pending: Event[]) => {
          const newPending = [...pending, ...eventsToQueue];
          return newPending.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        });

        // Save new events to database for Summary page queries
        for (const event of eventsToQueue) {
          this.saveEventToDatabase(event);
        }

        this.logger.debug(`📥 Queued ${eventsToQueue.length} new events to pending`);
      }

      // Save all events for cache (existing + merged + queued)
      const allEventsForCache = [...feedData.events(), ...eventsToQueue];
      this.saveCachedEvents(feedData.column.id, allEventsForCache);
    } else {
      // Merge all events
      const existingIds = new Set(existingEvents.map(e => e.id));
      const trulyNewEvents = filteredEvents.filter(e => !existingIds.has(e.id));

      const mergedEvents = [...existingEvents, ...trulyNewEvents]
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

      feedData.events.set(mergedEvents);

      // Save to cache
      this.saveCachedEvents(feedData.column.id, mergedEvents);

      // Save to database for Summary page queries
      for (const event of trulyNewEvents) {
        this.saveEventToDatabase(event);
      }
    }

    // Mark initial load as complete
    feedData.initialLoadComplete = true;
    feedData.isRefreshing?.set(false);

    // Update lastRetrieved timestamp
    this.updateColumnLastRetrieved(feedData.column.id);

    this.logger.info(`✅ Following feed finalized with ${feedData.events().length} total events`);
  }

  /**
   * Load "For You" feed - combines multiple sources for personalized content
   * 
   * This method implements a personalized feed strategy:
   * 1. Includes popular starter pack accounts (dynamically fetched)
   * 2. Includes algorithm-recommended users based on engagement
   * 3. Includes subset of following accounts (for performance)
   * 4. Deduplicates and fetches events from combined list
   */
  private async loadForYouFeed(feedData: FeedItem) {
    try {
      const allPubkeys = new Set<string>();
      const isArticlesFeed = feedData.filter?.kinds?.includes(30023);

      // 1. Add popular starter pack pubkeys (fetch from 'popular' starter pack)
      try {
        // Fetch only the 'popular' starter pack - cache-first with background refresh
        const starterPacks = await this.followset.fetchStarterPacks('popular');
        const popularPack = starterPacks.find(pack => pack.dTag === 'popular');

        if (popularPack) {
          // Limit starter pack users to first 5 for faster initial load
          const limitedStarterPackUsers = popularPack.pubkeys.slice(0, 5);
          limitedStarterPackUsers.forEach(pubkey => allPubkeys.add(pubkey));
          this.logger.debug(`Added ${limitedStarterPackUsers.length} popular starter pack users from popular pack (out of ${popularPack.pubkeys.length} total)`);
        } else {
          this.logger.warn('Popular starter pack not found');
        }
      } catch (error) {
        this.logger.error('Error fetching popular starter pack:', error);
      }      // 2. Add algorithm-recommended users
      const topEngagedUsers = isArticlesFeed
        ? await this.algorithms.getRecommendedUsersForArticles(10) // Reduced from 20 to 10
        : await this.algorithms.getRecommendedUsers(5); // Reduced from 10 to 5

      topEngagedUsers.forEach(user => allPubkeys.add(user.pubkey));
      this.logger.debug(`Added ${topEngagedUsers.length} algorithm-recommended users`);

      // 3. Add subset of following accounts (limit for performance)
      const followingList = this.accountState.followingList();
      const maxFollowingToAdd = 10; // Reduced from 30 to 10 for faster initial load
      const limitedFollowing = followingList.length > maxFollowingToAdd
        ? followingList.slice(-maxFollowingToAdd)
        : followingList;

      limitedFollowing.forEach(pubkey => allPubkeys.add(pubkey));
      this.logger.debug(`Added ${limitedFollowing.length} following users (out of ${followingList.length} total)`);

      const pubkeysArray = Array.from(allPubkeys);
      this.logger.debug(`Loading For You feed with ${pubkeysArray.length} total unique users`);

      // Fetch events from all combined users
      await this.fetchEventsFromUsers(pubkeysArray, feedData);

      this.logger.debug(`Loaded For You feed with ${pubkeysArray.length} unique users`);
    } catch (error) {
      this.logger.error('Error loading For You feed:', error);
    }
  }

  /**
   * Fetch events from a list of users using the outbox model
   * Updates UI incrementally as events are received for better UX
   */
  private async fetchEventsFromUsers(pubkeys: string[], feedData: FeedItem) {
    const isArticlesFeed = feedData.filter?.kinds?.includes(30023);
    const eventsPerUser = isArticlesFeed ? 5 : 3; // Reduced from 10/5 to 5/3 for better performance

    // Removed time cutoff to allow infinite scrolling - events are now only limited by relay availability
    // Previously: const daysBack = isArticlesFeed ? 90 : 7;
    // Previously: const timeCutoff = now - daysBack * 24 * 60 * 60;

    const userEventsMap = new Map<string, Event[]>();
    let processedUsers = 0;
    const totalUsers = pubkeys.length;

    // Process users in parallel but update UI incrementally
    const fetchPromises = pubkeys.map(async pubkey => {
      try {
        const filterConfig: {
          authors: string[];
          kinds?: number[];
          limit: number;
          since?: number;
        } = {
          authors: [pubkey],
          kinds: feedData.filter?.kinds,
          limit: eventsPerUser,
        };

        // Add 'since' parameter based on column's lastRetrieved timestamp
        // This prevents re-fetching old events when reopening the column
        // IMPORTANT: Only use lastRetrieved if we have existing events to display.
        // If there are no events, we need to fetch historical events without the 'since' filter.
        const existingEvents = feedData.events();
        if (feedData.column.lastRetrieved && existingEvents.length > 0) {
          filterConfig.since = feedData.column.lastRetrieved;
        }

        const events = await this.sharedRelayEx.getMany(
          pubkey,
          filterConfig,
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
    totalUsers: number,

  ) {
    // Aggregate current events from the user events map
    const newEvents = this.aggregateAndSortEvents(userEventsMap);

    if (newEvents.length > 0) {
      const existingEvents = feedData.events();

      // If initial load is already complete (we had cached events), queue new events instead of merging
      // EXCEPT: If there are zero existing events, show new events directly (don't force user to click "new posts" button)
      if (feedData.initialLoadComplete && existingEvents.length > 0) {
        // Filter out events that already exist in the feed
        const existingIds = new Set(existingEvents.map(e => e.id));
        const trulyNewEvents = newEvents.filter(e => !existingIds.has(e.id));

        if (trulyNewEvents.length > 0) {
          // Queue to pending events instead of direct merge
          feedData.pendingEvents?.update((pending: Event[]) => {
            const pendingIds = new Set(pending.map(e => e.id));
            const newPending = [...pending];
            for (const event of trulyNewEvents) {
              if (!pendingIds.has(event.id)) {
                newPending.push(event);
              }
            }
            return newPending.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
          });

          this.logger.debug(
            `Incremental update: ${processedUsers}/${totalUsers} users processed, ${trulyNewEvents.length} events queued to pending`
          );
        }
      } else {
        // Initial load not complete OR no existing events - merge events directly
        const mergedEvents = this.mergeEvents(existingEvents, newEvents);

        // Update the feed with merged events
        feedData.events.set(mergedEvents);

        // Update last timestamp for pagination
        feedData.lastTimestamp = Math.min(...mergedEvents.map((e: Event) => (e.created_at || 0) * 1000));

        this.logger.debug(
          `Incremental update: ${processedUsers}/${totalUsers} users processed, ${mergedEvents.length} total events (${newEvents.length} new)`
        );
      }
    }
  }

  /**
   * Finalize the incremental feed with a final sort and cleanup
   */
  private finalizeIncrementalFeed(userEventsMap: Map<string, Event[]>, feedData: FeedItem,) {
    // Final aggregation of new events
    const newEvents = this.aggregateAndSortEvents(userEventsMap);

    if (newEvents.length > 0) {
      const existingEvents = feedData.events();

      // If initial load is already complete (we had cached events), queue new events instead of merging
      // EXCEPT: If there are zero existing events, show new events directly (don't force user to click "new posts" button)
      if (feedData.initialLoadComplete && existingEvents.length > 0) {
        // Filter out events that already exist in the feed
        const existingIds = new Set(existingEvents.map(e => e.id));
        const trulyNewEvents = newEvents.filter(e => !existingIds.has(e.id));

        if (trulyNewEvents.length > 0) {
          // Queue to pending events instead of direct merge
          feedData.pendingEvents?.update((pending: Event[]) => {
            const pendingIds = new Set(pending.map(e => e.id));
            const newPending = [...pending];
            for (const event of trulyNewEvents) {
              if (!pendingIds.has(event.id)) {
                newPending.push(event);
              }
            }
            return newPending.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
          });

          // Save pending events to cache as well for persistence
          const allEventsForCache = [...existingEvents, ...trulyNewEvents];
          this.saveCachedEvents(feedData.column.id, allEventsForCache);

          this.logger.debug(
            `Final update: ${trulyNewEvents.length} events queued to pending (${existingEvents.length} cached events preserved)`
          );
        }
      } else {
        // Initial load not complete OR no existing events - merge events directly
        const mergedEvents = this.mergeEvents(existingEvents, newEvents);

        // Update feed data with merged events
        feedData.events.set(mergedEvents);

        // Save to cache after final update
        this.saveCachedEvents(feedData.column.id, mergedEvents);

        // Update last timestamp for pagination
        feedData.lastTimestamp = Math.min(...mergedEvents.map((e: Event) => (e.created_at || 0) * 1000));

        this.logger.debug(
          `Final update: ${mergedEvents.length} total events (${newEvents.length} new from ${userEventsMap.size} users)`
        );
      }

      // Update lastRetrieved timestamp (current time in seconds) and save to localStorage
      this.updateColumnLastRetrieved(feedData.column.id);
    } else {
      // No new events received, but keep existing cached events
      const existingEvents = feedData.events();
      if (existingEvents.length > 0) {
        this.logger.debug(
          `No new events received, keeping ${existingEvents.length} cached events`
        );
      }
    }

    // Mark initial load as complete - any events arriving after this will be queued
    feedData.initialLoadComplete = true;
    feedData.isRefreshing?.set(false);
    this.logger.info(`✅ Initial load complete for column ${feedData.column.id} - new events will be queued`);
  }

  /**
   * Merge new events with existing events, removing duplicates and maintaining sort order
   */
  private mergeEvents(existingEvents: Event[], newEvents: Event[]): Event[] {
    // Create a map of existing events by ID for quick lookup
    const eventMap = new Map<string, Event>();

    // Add all existing events
    for (const event of existingEvents) {
      eventMap.set(event.id, event);
    }

    // Add new events (will replace if duplicate ID exists)
    for (const event of newEvents) {
      eventMap.set(event.id, event);
    }

    // Convert back to array and sort by created_at (newest first)
    return Array.from(eventMap.values()).sort(
      (a, b) => (b.created_at || 0) - (a.created_at || 0)
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
        const event = events[0]; // Most recent event from this user
        result.push(event);
        usedUsers.add(pubkey);
      }
    }

    // Second pass: Fill remaining slots with other events, maintaining diversity
    for (const [, events] of userEventsMap) {
      for (let i = 1; i < events.length; i++) {
        const event = events[i];
        result.push(event);
      }
    }

    // Sort by creation time (newest first)
    return result.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }

  /**
   * Load more events for pagination (called when user scrolls)
   */
  async loadMoreEvents(columnId: string) {
    console.log('[FeedService] loadMoreEvents called for column:', columnId);

    const feedData = this.data.get(columnId);
    if (!feedData || !feedData.isLoadingMore || !feedData.hasMore) {
      this.logger.warn(`Cannot load more events for column ${columnId}: feedData not found or missing loading states`);
      return;
    }

    // Prevent multiple simultaneous loads
    if (feedData.isLoadingMore() || !feedData.hasMore()) {
      console.log(`[FeedService] Skipping load more: isLoading=${feedData.isLoadingMore()}, hasMore=${feedData.hasMore()}`);
      this.logger.debug(`Skipping load more for column ${columnId}: already loading or no more data`);
      return;
    }

    console.log('[FeedService] Starting pagination load...');
    feedData.isLoadingMore.set(true);

    try {
      const column = feedData.column;

      if (column.source === 'following') {
        // For following, use all following users
        const followingList = this.accountState.followingList();
        await this.fetchOlderEventsFromUsers(followingList, feedData);
      } else if (column.source === 'for-you') {
        // For "For You" feed, combine all sources like in initial load
        const allPubkeys = new Set<string>();
        const isArticlesFeed = feedData.filter?.kinds?.includes(30023);

        // Add popular starter pack pubkeys (fetch from 'popular' starter pack)
        try {
          const starterPacks = await this.followset.fetchStarterPacks();
          const popularPack = starterPacks.find(pack => pack.dTag === 'popular');

          if (popularPack) {
            // Use same limit as initial load for consistency
            const limitedStarterPackUsers = popularPack.pubkeys.slice(0, 5);
            limitedStarterPackUsers.forEach(pubkey => allPubkeys.add(pubkey));
          }
        } catch (error) {
          this.logger.error('Error fetching popular starter pack for pagination:', error);
        }        // Add algorithm-recommended users
        const topEngagedUsers = isArticlesFeed
          ? await this.algorithms.getRecommendedUsersForArticles(10) // Match initial load
          : await this.algorithms.getRecommendedUsers(5); // Match initial load
        topEngagedUsers.forEach(user => allPubkeys.add(user.pubkey));

        // Add subset of following accounts (limit for performance)
        const followingList = this.accountState.followingList();
        const maxFollowingToAdd = 10; // Match initial load
        const limitedFollowing = followingList.length > maxFollowingToAdd
          ? followingList.slice(-maxFollowingToAdd)
          : followingList;
        limitedFollowing.forEach(pubkey => allPubkeys.add(pubkey));

        const pubkeysArray = Array.from(allPubkeys);
        await this.fetchOlderEventsFromUsers(pubkeysArray, feedData);
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

        // Add pubkeys from follow sets (kind 30000)
        if (column.customFollowSets && column.customFollowSets.length > 0) {
          try {
            const pubkey = this.accountState.pubkey();
            if (pubkey) {
              const records = await this.dataService.getEventsByPubkeyAndKind(pubkey, 30000, {
                save: true,
                cache: true,
              });

              if (records && records.length > 0) {
                for (const record of records) {
                  if (!record.event) continue;

                  const event = record.event;
                  const dTag = event.tags.find((t: string[]) => t[0] === 'd')?.[1];

                  if (dTag && column.customFollowSets.includes(dTag)) {
                    // Extract public pubkeys
                    const publicPubkeys = event.tags
                      .filter((t: string[]) => t[0] === 'p' && t[1])
                      .map((t: string[]) => t[1]);
                    publicPubkeys.forEach((pk: string) => allPubkeys.add(pk));

                    // Extract private pubkeys
                    if (event.content && event.content.trim() !== '') {
                      try {
                        const isEncrypted = this.encryption.isContentEncrypted(event.content);
                        if (isEncrypted) {
                          const decrypted = await this.encryption.autoDecrypt(event.content, pubkey, event);
                          if (decrypted && decrypted.content) {
                            const privateData = JSON.parse(decrypted.content);
                            if (Array.isArray(privateData)) {
                              const privatePubkeys = privateData
                                .filter((tag: string[]) => tag[0] === 'p' && tag[1])
                                .map((tag: string[]) => tag[1]);
                              privatePubkeys.forEach((pk: string) => allPubkeys.add(pk));
                            }
                          }
                        }
                      } catch (error) {
                        this.logger.error(`Failed to decrypt follow set ${dTag} during pagination:`, error);
                      }
                    }
                  }
                }
              }
            }
          } catch (error) {
            this.logger.error('Error fetching follow set data for pagination:', error);
          }
        }

        const pubkeysArray = Array.from(allPubkeys);

        if (pubkeysArray.length > 0) {
          // Fetch older events from ALL users (no algorithm filtering)
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
    const eventsPerUser = 3; // Reduced from 5 to 3 for better performance

    // Removed maxAge limit to allow infinite scrolling
    // Previously: const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days for older content

    const userEventsMap = new Map<string, Event[]>();
    let processedUsers = 0;
    const totalUsers = pubkeys.length;
    const existingEvents = feedData.events(); // Get current events

    // Calculate the oldest timestamp from existing events (in seconds for Nostr)
    const oldestTimestamp = existingEvents.length > 0
      ? Math.floor(Math.min(...existingEvents.map(e => (e.created_at || 0))) - 1)
      : undefined;

    // Debug: Log pagination details
    if (oldestTimestamp) {
      const oldestDate = new Date(oldestTimestamp * 1000).toISOString();
      this.logger.debug(`[Feed Pagination] Loading older events for ${pubkeys.length} users, until: ${oldestDate} (${oldestTimestamp})`);
      this.logger.debug(`[Feed Pagination] Current feed has ${existingEvents.length} events`);
    } else {
      this.logger.debug(`[Feed Pagination] Initial load for ${pubkeys.length} users (no until parameter)`);
    }

    // Process users in parallel with incremental updates
    const fetchPromises = pubkeys.map(async pubkey => {
      try {
        // Use paginated fetch with 'until' parameter for infinite scroll
        // This tells relays to fetch events OLDER than the oldest timestamp
        const recordResults = await this.onDemandUserData.getEventsByPubkeyAndKindPaginated(
          pubkey,
          feedData.filter?.kinds?.[0] || kinds.ShortTextNote,
          oldestTimestamp, // Fetch events older than this
          eventsPerUser    // Limit per user
        );
        const events = recordResults.map((r: { event: Event }) => r.event);

        this.logger.debug(`[Pagination] User ${pubkey.slice(0, 8)}... returned ${events.length} events, oldest: ${events.length > 0 ? new Date(Math.min(...events.map(e => (e.created_at || 0))) * 1000).toISOString() : 'none'}`);

        if (events.length > 0) {
          // Filter events to exclude already loaded ones (just in case)
          const olderEvents = events
            .filter((event: Event) => {
              const eventTime = (event.created_at || 0) * 1000;
              const isOlder = eventTime < (feedData.lastTimestamp || Date.now());
              if (!isOlder) {
                this.logger.debug(`[Pagination] Filtering out event ${event.id?.slice(0, 8)} - not older than lastTimestamp`);
              }
              return isOlder;
            })
            .slice(0, eventsPerUser);

          if (olderEvents.length > 0) {
            this.logger.debug(`[Pagination] User ${pubkey.slice(0, 8)}... added ${olderEvents.length} events to feed`);
            userEventsMap.set(pubkey, olderEvents);
          } else {
            this.logger.debug(`[Pagination] User ${pubkey.slice(0, 8)}... - all events filtered out (not older than existing)`);
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
      // Merge with existing events (avoiding duplicates)
      const updatedEvents = this.mergeEvents(existingEvents, olderEvents);
      feedData.events.set(updatedEvents);

      // Update last timestamp
      feedData.lastTimestamp = Math.min(...olderEvents.map((e: Event) => (e.created_at || 0) * 1000));

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
    existingEvents: Event[],

  ) {
    // Final aggregation and sort of older events
    const finalOlderEvents = this.aggregateAndSortEvents(userEventsMap);

    // Merge with existing events if we have any (avoiding duplicates)
    if (finalOlderEvents.length > 0) {
      const updatedEvents = this.mergeEvents(existingEvents, finalOlderEvents);
      feedData.events.set(updatedEvents);

      // Update last timestamp
      feedData.lastTimestamp = Math.min(...finalOlderEvents.map((e: Event) => (e.created_at || 0) * 1000));

      this.logger.debug(
        `Final pagination update: ${finalOlderEvents.length} older events from ${userEventsMap.size} users`
      );
    }

    // Check if we should mark hasMore as false
    // Only stop if we got NO events at all from this pagination request
    const totalEventsFromUsers = Array.from(userEventsMap.values()).flat().length;
    if (totalEventsFromUsers === 0) {
      this.logger.debug('[Feed Pagination] No more events available, setting hasMore to false');
      feedData.hasMore?.set(false);
    } else {
      this.logger.debug(`[Feed Pagination] Got ${totalEventsFromUsers} events from ${userEventsMap.size} users, can load more`);
    }
  }

  /**
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

  getColumnRefreshingState(columnId: string): Signal<boolean> | undefined {
    return this.data.get(columnId)?.isRefreshing;
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

    // Clear the new event check interval
    if (this.newEventCheckInterval) {
      clearInterval(this.newEventCheckInterval);
      this.newEventCheckInterval = null;
    }

    this.logger.debug('Unsubscribed from all feed subscriptions');
  }

  /**
   * Check for new events across all active columns
   */
  private async checkForNewEvents(): Promise<void> {
    // Skip if feeds page is not active
    if (!this._feedsPageActive()) {
      return;
    }

    const activeFeedId = this._activeFeedId();
    if (!activeFeedId) return;

    const activeFeed = this.getFeedById(activeFeedId);
    if (!activeFeed) return;

    // Check each column for new events
    for (const column of activeFeed.columns) {
      const feedData = this.data.get(column.id);
      if (!feedData || !feedData.lastCheckTimestamp) continue;

      // Skip if column is paused (no active subscription)
      if (!feedData.subscription) continue;

      await this.checkColumnForNewEvents(column.id);
    }
  }

  /**
   * Check a specific column for new events
   */
  private async checkColumnForNewEvents(columnId: string): Promise<void> {
    const feedData = this.data.get(columnId);
    if (!feedData || !feedData.pendingEvents || !feedData.lastCheckTimestamp) return;

    const column = feedData.column;
    const currentTime = Math.floor(Date.now() / 1000);

    // Get events newer than the last check timestamp
    let newEvents: Event[] = [];

    if (column.source === 'following') {
      newEvents = await this.fetchNewEventsForFollowing(feedData, currentTime);
    } else if (column.source === 'custom') {
      newEvents = await this.fetchNewEventsForCustom(feedData, currentTime);
    } else {
      // Public feed - use standard filter with since parameter
      newEvents = await this.fetchNewEventsStandard(feedData, currentTime);
    }

    // Update pending events if we found any new ones
    if (newEvents.length > 0) {
      const currentPending = feedData.pendingEvents() || [];
      const allPending = [...newEvents, ...currentPending];

      // Remove duplicates and sort by created_at descending
      const uniquePending = Array.from(
        new Map(allPending.map(event => [event.id, event])).values()
      ).sort((a, b) => b.created_at - a.created_at);

      feedData.pendingEvents.set(uniquePending);

      // Update reactive signal
      this._feedData.update(map => new Map(map));

      this.logger.debug(`Found ${newEvents.length} new events for column ${columnId}`);
    }

    // Update last check timestamp
    feedData.lastCheckTimestamp = currentTime;
  }

  /**
   * Fetch new events for following-based feeds
   */
  private async fetchNewEventsForFollowing(feedData: FeedItem, sinceTimestamp: number): Promise<Event[]> {
    const isArticlesFeed = feedData.filter?.kinds?.includes(30023);

    const topEngagedUsers = isArticlesFeed
      ? await this.algorithms.getRecommendedUsersForArticles(10)
      : await this.algorithms.getRecommendedUsers(10);

    if (topEngagedUsers.length === 0) return [];

    // Extract pubkeys from UserMetric objects
    const pubkeys = topEngagedUsers.map(user => user.pubkey);

    return this.fetchNewEventsFromUsers(pubkeys, feedData, sinceTimestamp);
  }

  /**
   * Fetch new events for custom feeds (custom users + starter packs + follow sets)
   */
  private async fetchNewEventsForCustom(feedData: FeedItem, sinceTimestamp: number): Promise<Event[]> {
    const column = feedData.column;
    const allPubkeys = new Set<string>();

    // Add custom users
    if (column.customUsers) {
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
        this.logger.error('Error fetching starter pack data for new events:', error);
      }
    }

    // Add pubkeys from follow sets (kind 30000)
    if (column.customFollowSets && column.customFollowSets.length > 0) {
      try {
        const pubkey = this.accountState.pubkey();
        if (pubkey) {
          const records = await this.dataService.getEventsByPubkeyAndKind(pubkey, 30000, {
            save: true,
            cache: true,
          });

          if (records && records.length > 0) {
            for (const record of records) {
              if (!record.event) continue;

              const event = record.event;
              const dTag = event.tags.find((t: string[]) => t[0] === 'd')?.[1];

              if (dTag && column.customFollowSets.includes(dTag)) {
                // Extract public pubkeys
                const publicPubkeys = event.tags
                  .filter((t: string[]) => t[0] === 'p' && t[1])
                  .map((t: string[]) => t[1]);
                publicPubkeys.forEach((pk: string) => allPubkeys.add(pk));

                // Extract private pubkeys
                if (event.content && event.content.trim() !== '') {
                  try {
                    const isEncrypted = this.encryption.isContentEncrypted(event.content);
                    if (isEncrypted) {
                      const decrypted = await this.encryption.autoDecrypt(event.content, pubkey, event);
                      if (decrypted && decrypted.content) {
                        const privateData = JSON.parse(decrypted.content);
                        if (Array.isArray(privateData)) {
                          const privatePubkeys = privateData
                            .filter((tag: string[]) => tag[0] === 'p' && tag[1])
                            .map((tag: string[]) => tag[1]);
                          privatePubkeys.forEach((pk: string) => allPubkeys.add(pk));
                        }
                      }
                    }
                  } catch (error) {
                    this.logger.error(`Failed to decrypt follow set ${dTag} for new events:`, error);
                  }
                }
              }
            }
          }
        }
      } catch (error) {
        this.logger.error('Error fetching follow set data for new events:', error);
      }
    }

    const pubkeysArray = Array.from(allPubkeys);

    if (pubkeysArray.length === 0) return [];

    return this.fetchNewEventsFromUsers(pubkeysArray, feedData, sinceTimestamp);
  }

  /**
   * Fetch new events from a list of users
   */
  private async fetchNewEventsFromUsers(
    pubkeys: string[],
    feedData: FeedItem,
    sinceTimestamp: number
  ): Promise<Event[]> {
    const newEvents: Event[] = [];
    const column = feedData.column;

    // Fetch latest events from each user since the last check
    const fetchPromises = pubkeys.map(async pubkey => {
      try {
        const events = await this.sharedRelayEx.getMany(
          pubkey,
          {
            authors: [pubkey],
            kinds: column.kinds,
            limit: 2, // Only fetch 2 latest events per user for new event checks
            since: sinceTimestamp,
          },
          { timeout: 2500 }
        );

        return events;
      } catch (error) {
        this.logger.error(`Error fetching new events for user ${pubkey}:`, error);
        return [];
      }
    });

    const results = await Promise.all(fetchPromises);
    results.forEach(events => newEvents.push(...events));

    return newEvents;
  }

  /**
   * Fetch new events using standard filter
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async fetchNewEventsStandard(_feedData: FeedItem, _sinceTimestamp: number): Promise<Event[]> {
    // For public feeds, we would query relays with a since filter
    // This is a simplified implementation
    return [];
  }

  /**
   * Get pending events count for a column
   */
  getPendingEventsCount(columnId: string): number {
    const feedData = this.data.get(columnId);
    if (!feedData || !feedData.pendingEvents) return 0;
    return feedData.pendingEvents().length;
  }

  /**
   * Load pending events into the main feed for a column
   */
  loadPendingEvents(columnId: string): void {
    const feedData = this.data.get(columnId);
    if (!feedData || !feedData.pendingEvents) return;

    const pending = feedData.pendingEvents();
    if (pending.length === 0) return;

    const currentEvents = feedData.events();
    const allEvents = [...pending, ...currentEvents];

    // Remove duplicates and sort by created_at descending
    const uniqueEvents = Array.from(
      new Map(allEvents.map(event => [event.id, event])).values()
    ).sort((a, b) => b.created_at - a.created_at);

    // Update events signal
    feedData.events.set(uniqueEvents);

    // Clear pending events
    feedData.pendingEvents.set([]);

    // Update last check timestamp to the most recent event timestamp (not current time)
    // This ensures we don't keep showing old events as "new" on refresh
    if (uniqueEvents.length > 0) {
      const mostRecentTimestamp = Math.max(...uniqueEvents.map(e => e.created_at));
      feedData.lastCheckTimestamp = mostRecentTimestamp;
    } else {
      feedData.lastCheckTimestamp = Math.floor(Date.now() / 1000);
    }

    // Update reactive signal
    this._feedData.update(map => new Map(map));

    // Save merged events to cache for persistence
    this.saveCachedEvents(columnId, uniqueEvents);

    this.logger.debug(`Loaded ${pending.length} pending events for column ${columnId}, updated lastCheckTimestamp to ${feedData.lastCheckTimestamp}`);
  }

  /**
   * Get pending events signal for a column
   */
  getPendingEventsSignal(columnId: string): Signal<Event[]> | undefined {
    const feedData = this.data.get(columnId);
    return feedData?.pendingEvents;
  }

  /**
   * Get feeds configuration from localStorage for a specific pubkey.
   * Returns the stored feeds if found, otherwise returns null (not empty array).
   * This allows the caller to distinguish between "user has no feeds yet" (null)
   * and "user explicitly deleted all feeds" (empty array).
   */
  private getFeedsFromStorage(pubkey: string): FeedConfig[] | null {
    try {
      const feedsByAccount = this.localStorageService.getObject<Record<string, FeedConfig[]>>(
        this.appState.FEEDS_STORAGE_KEY
      );

      // If feedsByAccount doesn't exist at all, this is a new user
      if (!feedsByAccount) {
        return null;
      }

      // If feedsByAccount exists but this pubkey is not in it, return null
      if (!(pubkey in feedsByAccount)) {
        return null;
      }

      // Return whatever is stored for this pubkey (could be empty array if user deleted all feeds)
      return feedsByAccount[pubkey];
    } catch (error) {
      this.logger.error('Error getting feeds from storage:', error);
      return null;
    }
  }

  /**
   * Load feeds from local storage
   * 
   * Feed Initialization Behavior:
   * 1. First-time users: Default feeds are initialized and saved
   * 2. Returning users: Existing feeds are loaded from localStorage
   * 3. Users who deleted all feeds: Empty feed list is preserved (no auto-reset)
   * 4. Manual reset: User explicitly resets via menu option
   * 
   * The feedsInitialized flag ensures that:
   * - Default feeds are only created for truly new users
   * - Login method changes (browser extension, nsec, etc.) don't trigger resets
   * - Intentional feed deletions are respected
   * - Feed configurations persist across sessions
   */
  private async loadFeeds(pubkey: string): Promise<void> {
    try {
      const storedFeeds = this.getFeedsFromStorage(pubkey);

      // If storedFeeds is null, this user has never had feeds before - initialize defaults
      if (storedFeeds === null) {
        this.logger.info('No feeds found for pubkey, initializing default feeds for pubkey', pubkey);
        const defaultFeeds = await this.initializeDefaultFeeds();
        this._feeds.set(defaultFeeds);
        this._feedsLoaded.set(true);
        this.saveFeeds();
      } else {
        // storedFeeds exists (could be empty array if user deleted all feeds)
        // Use whatever is stored, even if it's an empty array
        this._feeds.set(storedFeeds);
        this._feedsLoaded.set(true);
        this.logger.debug('Loaded feeds from storage for pubkey', pubkey, storedFeeds);
      }
    } catch (error) {
      this.logger.error('Error loading feeds from storage:', error);
      this._feeds.set(DEFAULT_FEEDS);
      this._feedsLoaded.set(true);
      this.saveFeeds();
    }

    // Only subscribe if there's an active account
    if (this.accountState.account()) {
      await this.subscribe();
    }
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
   * 
   * This method persists the current feed configuration to localStorage
   * and marks feeds as initialized for the account. This ensures that:
   * - Feed configurations are preserved across sessions
   * - The system won't auto-reset to defaults on next login
   * - Custom configurations are respected
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
      // Note: Don't set feedsInitialized flag on error to allow retry
    }
  }

  /**
   * Update the lastRetrieved timestamp for a column and save to localStorage
   */
  private updateColumnLastRetrieved(columnId: string): void {
    try {
      const currentTimestamp = Math.floor(Date.now() / 1000); // Nostr uses seconds

      // Find the feed that contains this column
      const feeds = this._feeds();
      let updated = false;

      for (const feed of feeds) {
        const columnIndex = feed.columns.findIndex(col => col.id === columnId);
        if (columnIndex !== -1) {
          // Update the column's lastRetrieved timestamp
          this._feeds.update(currentFeeds => {
            return currentFeeds.map(f => {
              if (f.id === feed.id) {
                const updatedColumns = [...f.columns];
                updatedColumns[columnIndex] = {
                  ...updatedColumns[columnIndex],
                  lastRetrieved: currentTimestamp,
                };
                return {
                  ...f,
                  columns: updatedColumns,
                  updatedAt: Date.now(),
                };
              }
              return f;
            });
          });

          updated = true;
          this.logger.debug(`Updated lastRetrieved for column ${columnId} to ${currentTimestamp}`);
          break;
        }
      }

      if (updated) {
        this.saveFeeds();
      } else {
        this.logger.warn(`Column ${columnId} not found for lastRetrieved update`);
      }
    } catch (error) {
      this.logger.error('Error updating lastRetrieved:', error);
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
    console.log(`📊 Column filters BEFORE refresh:`, column.filters);

    // Unsubscribe from the column (this removes it from data map)
    this.unsubscribeFromColumn(columnId);

    // Verify the column is fully removed
    if (this.data.has(columnId)) {
      console.warn(`⚠️ Column ${columnId} still in data map after unsubscribe, forcing removal`);
      this.data.delete(columnId);
      this._feedData.update(map => {
        const newMap = new Map(map);
        newMap.delete(columnId);
        return newMap;
      });
    }

    // Resubscribe to the column (this will rebuild the filter with current settings)
    await this.subscribeToColumn(column);

    this.logger.debug(`Refreshed column: ${columnId}`);
    console.log(`✅ FeedService: Column ${columnId} refreshed successfully`);
  }

  /**
   * Refresh all columns with 'following', 'following-strict', or 'for-you' source in the active feed
   * This should be called after the user's following list changes to reload content
   */
  async refreshFollowingColumns(): Promise<void> {
    console.log(`🔄 FeedService: Refreshing all following-related columns`);
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

    // Find all columns with 'following' or 'for-you' source
    const followingRelatedColumns = activeFeed.columns.filter(
      column => column.source === 'following' || column.source === 'for-you'
    );

    if (followingRelatedColumns.length === 0) {
      this.logger.debug('No following-related columns found in active feed');
      console.log(`ℹ️ No following-related columns to refresh in feed: ${activeFeed.label}`);
      return;
    }

    console.log(`📊 Found ${followingRelatedColumns.length} following-related columns to refresh`);

    // Refresh each following-related column
    for (const column of followingRelatedColumns) {
      console.log(`🔄 Refreshing ${column.source} column: ${column.label} (${column.id})`);
      await this.refreshColumn(column.id);
    }

    this.logger.debug(`Refreshed ${followingRelatedColumns.length} following-related columns`);
    console.log(`✅ FeedService: All following-related columns refreshed successfully`);
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
