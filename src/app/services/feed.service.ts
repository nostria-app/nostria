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
import { DiscoveryRelayService } from './relays/discovery-relay';
import { RelayPoolService } from './relays/relay-pool';
import { SearchRelayService } from './relays/search-relay';
import { Followset } from './followset';
import { RegionService } from './region.service';
import { EncryptionService } from './encryption.service';
import { LocalSettingsService } from './local-settings.service';
import { FollowingDataService } from './following-data.service';
import { SettingsService, SyncedFeedConfig } from './settings.service';

export interface FeedItem {
  feed: FeedConfig;
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
  isRefreshing?: WritableSignal<boolean>; // Track when feed is actively refreshing/loading
  hasMore?: WritableSignal<boolean>;
  pendingEvents?: WritableSignal<Event[]>;
  isCheckingForNewEvents?: WritableSignal<boolean>; // Track when actively checking relays for new events
  lastCheckTimestamp?: number;
  initialLoadComplete?: boolean; // Track when initial relay loading is done
}

export interface FeedConfig {
  id: string;
  label: string;
  icon: string;
  // Feed content configuration
  type: 'notes' | 'articles' | 'photos' | 'videos' | 'music' | 'polls' | 'custom';
  kinds: number[];
  source?: 'following' | 'public' | 'custom' | 'for-you' | 'search' | 'trending' | 'interests';
  customUsers?: string[]; // Array of pubkeys for custom user selection
  customStarterPacks?: string[]; // Array of starter pack identifiers (d tags)
  customFollowSets?: string[]; // Array of follow set identifiers (d tags from kind 30000 events)
  customInterestHashtags?: string[]; // Array of hashtags from interest list for filtering (without # prefix)
  searchQuery?: string; // Search query for search-based feeds (NIP-50)
  relayConfig: 'account' | 'custom' | 'search';
  customRelays?: string[];
  filters?: Record<string, unknown>;
  showReplies?: boolean; // Whether to show replies in the feed (default: false)
  showReposts?: boolean; // Whether to show reposts in the feed (default: true)
  createdAt: number;
  updatedAt: number;
  lastRetrieved?: number; // Timestamp (seconds) of when data was last successfully retrieved from relays
  isSystem?: boolean; // System feeds cannot be deleted
}

// Legacy type alias for backward compatibility with old components
// ColumnConfig is now the same as FeedConfig (columns were converted to individual feeds)
export type ColumnConfig = FeedConfig;

export interface RelayConfig {
  url: string;
  read: boolean;
  write: boolean;
}

const COLUMN_TYPES = {
  notes: {
    label: 'Notes',
    icon: 'chat',
    kinds: [1, 6], // Text notes and reposts
  },
  articles: {
    label: 'Articles',
    icon: 'article',
    kinds: [30023], // Long-form content
  },
  photos: {
    label: 'Photos',
    icon: 'image',
    kinds: [20],
  },
  videos: {
    label: 'Videos',
    icon: 'movie',
    kinds: [21, 22, 34235, 34236],
  },
  music: {
    label: 'Music',
    icon: 'music_note',
    kinds: [32100, 36787, 34139], // Kind 32100 (Music), Kind 36787 (Music Tracks), Kind 34139 (Playlist)
  },
  custom: {
    label: 'Custom',
    icon: 'tune',
    kinds: [],
  },
};

const DEFAULT_FEEDS: FeedConfig[] = [
  {
    id: 'default-feed-for-you',
    label: 'For You',
    icon: 'for_you',
    type: 'notes',
    kinds: [kinds.ShortTextNote, kinds.Repost],
    source: 'for-you',
    relayConfig: 'account',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'default-feed-following',
    label: 'Following',
    icon: 'diversity_2',
    type: 'notes',
    kinds: [kinds.ShortTextNote, kinds.Repost],
    source: 'following',
    relayConfig: 'account',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

// Trending feed ID constant - this feed is always appended at the end and never persisted
const TRENDING_FEED_ID = 'default-feed-trending';

// Trending feed definition - appended dynamically, not stored
const TRENDING_FEED: FeedConfig = {
  id: TRENDING_FEED_ID,
  label: 'Trending',
  icon: 'trending_up',
  isSystem: true, // Cannot be deleted
  type: 'notes',
  kinds: [kinds.ShortTextNote],
  source: 'trending',
  relayConfig: 'account',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

@Injectable({
  providedIn: 'root',
})
export class FeedService {
  private readonly localStorageService = inject(LocalStorageService);
  private readonly logger = inject(LoggerService);
  private readonly database = inject(DatabaseService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly discoveryRelay = inject(DiscoveryRelayService);
  private readonly searchRelay = inject(SearchRelayService);
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
  private readonly settingsService = inject(SettingsService);

  private readonly algorithms = inject(Algorithms);

  // Signals for feeds
  private readonly _feeds = signal<FeedConfig[]>([]);
  private readonly _feedsLoaded = signal<boolean>(false);
  private readonly _hasInitialContent = signal<boolean>(false); // Track when first feed content is ready

  // Track if sync is in progress to prevent loops
  private syncInProgress = false;

  // Active feed subscription management
  private readonly _activeFeedId = signal<string | null>(null);
  private activeFeedSubscriptions = new Set<string>(); // Track column IDs with active subscriptions
  private subscriptionInProgress: string | null = null; // Track feed currently being subscribed to

  // Track whether the Feeds page is currently active/mounted
  private readonly _feedsPageActive = signal<boolean>(false);

  // New event checking
  private newEventCheckInterval: ReturnType<typeof setInterval> | null = null;

  // Public computed signals
  // Append Trending feed at the end ONLY after feeds have been loaded from storage
  // This prevents Trending from being auto-selected during startup when it's temporarily the only feed
  readonly feeds = computed(() => {
    const feedsLoaded = this._feedsLoaded();
    const storedFeeds = this._feeds().filter(f => f.id !== TRENDING_FEED_ID);

    // Only append Trending after feeds have been loaded from storage
    // This prevents race conditions where Trending is the only available feed during startup
    if (feedsLoaded) {
      return [...storedFeeds, TRENDING_FEED];
    }
    return storedFeeds;
  });
  readonly activeFeedId = computed(() => this._activeFeedId());
  readonly feedsLoaded = computed(() => this._feedsLoaded());
  readonly feedsPageActive = computed(() => this._feedsPageActive());
  readonly hasInitialContent = computed(() => this._hasInitialContent()); // Public signal for feed content ready

  // Feed type definitions
  readonly feedTypes = COLUMN_TYPES;

  // Cache constants
  private readonly CACHE_SIZE = 200; // Cache 200 events per column

  constructor() {
    // Track if we've already started loading for the current pubkey
    let loadingForPubkey: string | null = null;

    effect(() => {
      // Watch for pubkey changes to reload feeds when account switches
      const pubkey = this.accountState.pubkey();
      const initialized = this.accountState.initialized();
      // Wait for settings to be loaded so we can check for synced feeds from kind 30078
      const settingsLoaded = this.settingsService.settingsLoaded();

      // Skip if already loading for this pubkey
      if (pubkey === loadingForPubkey) {
        return;
      }

      if (pubkey) {
        untracked(async () => {
          // Check if this is a first-time user (no stored feeds)
          const storedFeeds = this.getFeedsFromStorage(pubkey);
          const isFirstTimeUser = storedFeeds === null;

          this.logger.debug(`🔄 [FeedService] pubkey=${pubkey.slice(0, 8)}... initialized=${initialized} settingsLoaded=${settingsLoaded} isFirstTimeUser=${isFirstTimeUser}`);

          // For first-time users with local feeds: Can load immediately
          // For users with synced feeds or returning users: Wait for settings to be loaded
          // This ensures cross-device sync works by waiting for kind 30078 settings event
          if (isFirstTimeUser && !settingsLoaded) {
            // First-time user but settings not loaded yet - wait for settings
            // to check if there are synced feeds from another device
            this.logger.debug(`⏳ [FeedService] First-time user, waiting for settings to load to check for synced feeds`);
            return;
          }

          if (!isFirstTimeUser && !initialized) {
            // Returning user but not initialized yet - wait for relay data
            this.logger.debug(`⏳ [FeedService] Returning user, waiting for initialization`);
            return;
          }

          // Settings must be loaded to properly check for synced feeds
          if (!settingsLoaded) {
            this.logger.debug(`⏳ [FeedService] Waiting for settings to load before loading feeds`);
            return;
          }

          this.logger.debug(`🚀 [FeedService] Starting feed load for ${isFirstTimeUser ? 'FIRST-TIME' : 'RETURNING'} user`);
          loadingForPubkey = pubkey;
          // Reset signals before loading new feeds
          this._feedsLoaded.set(false);
          this._hasInitialContent.set(false);
          this.appState.feedHasInitialContent.set(false);
          await this.loadFeeds(pubkey);
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
   * Load cached events for a feed - async operation using IndexedDB
   * @param feedId The feed ID (or legacy column ID for backward compatibility)
   */
  private async loadCachedEvents(feedId: string): Promise<Event[]> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return [];

    try {
      await this.database.init();
      const cachedEvents = await this.database.loadCachedEvents(pubkey, feedId);

      if (cachedEvents.length > 0) {
        this.logger.info(`✅ Loaded ${cachedEvents.length} cached events for feed ${feedId}`);
      }
      return cachedEvents;
    } catch (error) {
      this.logger.error('Error loading cached events:', error);
      return [];
    }
  }

  /**
   * Prefetch profiles for a list of events.
   * This extracts unique author pubkeys and uses batch loading to populate the cache.
   * Runs in background - does not block the caller.
   * @param events Events to prefetch profiles for
   */
  private prefetchProfilesForEvents(events: Event[]): void {
    if (!events || events.length === 0) return;

    // Extract unique author pubkeys
    const authorPubkeys = new Set<string>();
    for (const event of events) {
      if (event.pubkey) {
        authorPubkeys.add(event.pubkey);
      }
      // Also extract pubkeys from repost events (kind 6) - the original author
      if (event.kind === 6 && event.tags) {
        for (const tag of event.tags) {
          if (tag[0] === 'p' && tag[1]) {
            authorPubkeys.add(tag[1]);
          }
        }
      }
    }

    const pubkeysArray = Array.from(authorPubkeys);
    if (pubkeysArray.length === 0) return;

    this.logger.debug(`[Prefetch] Prefetching ${pubkeysArray.length} profiles for ${events.length} events`);

    // Fire and forget - don't await, let it run in background
    this.dataService.batchLoadProfiles(pubkeysArray).then((results) => {
      this.logger.debug(`[Prefetch] Completed: ${results.size}/${pubkeysArray.length} profiles loaded`);
    }).catch((err) => {
      this.logger.error('[Prefetch] Error prefetching profiles:', err);
    });
  }

  // Track pending cache saves to prevent duplicates
  private pendingCacheSaves = new Map<string, Promise<void>>();

  /**
   * Save events to cache for a feed (debounced to prevent duplicates)
   * Also saves events to the main events store for querying by Summary page
   * @param feedId The feed ID (or legacy column ID for backward compatibility)
   */
  private async saveCachedEvents(feedId: string, events: Event[]): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    // Create cache key
    const cacheKey = `${pubkey}::${feedId}`;

    // If a save is already pending for this feed, wait for it instead of duplicating
    const pendingSave = this.pendingCacheSaves.get(cacheKey);
    if (pendingSave) {
      this.logger.debug(`⏭️ Skipping duplicate cache save for feed ${feedId}`);
      return pendingSave;
    }

    // Create the save promise
    const savePromise = (async () => {
      try {
        await this.database.init();

        // Save to cache for instant loading
        await this.database.saveCachedEvents(pubkey, feedId, events);
        this.logger.debug(`💾 Saved ${events.length} events to cache for feed ${feedId}`);

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

        // Start checking for new events every 30 seconds
        this.newEventCheckInterval = setInterval(() => {
          this.checkForNewEvents();
        }, 30000);
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
      const hasActiveSubscription = this.data.has(feedId);

      if (hasActiveSubscription) {
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
   * Subscribe to a single feed
   * New flat feed structure only
   */
  private async subscribeToFeed(feed: FeedConfig): Promise<void> {
    // New flat structure: Subscribe to the feed directly using feed ID
    await this.subscribeToFeedDirect(feed);
  }

  /**
   * Subscribe to a feed using the new flat structure (no columns)
   */
  private async subscribeToFeedDirect(feed: FeedConfig): Promise<void> {
    // Skip subscription for trending feeds - they use external API
    if (feed.source === 'trending') {
      this.logger.debug(`Feed ${feed.id} is a trending feed - skipping subscription`);
      return;
    }

    // Don't subscribe if already subscribed
    if (this.data.has(feed.id)) {
      this.logger.warn(`Feed ${feed.id} is already subscribed`);
      return;
    }

    // Check if we should start feeds on last event (queue new events instead of auto-merging)
    const startFeedsOnLastEvent = this.localSettings.startFeedsOnLastEvent();
    const initialLoadComplete = startFeedsOnLastEvent;

    // Create item with empty events FIRST to ensure feedDataReactive has entry immediately
    const item: FeedItem = {
      feed,  // Store feed reference instead of column
      filter: null,
      events: signal<Event[]>([]),
      subscription: null,
      lastTimestamp: Date.now(),
      isLoadingMore: signal<boolean>(false),
      isRefreshing: signal<boolean>(true),
      hasMore: signal<boolean>(true),
      pendingEvents: signal<Event[]>([]),
      isCheckingForNewEvents: signal<boolean>(false),
      lastCheckTimestamp: Math.floor(Date.now() / 1000),
      initialLoadComplete: initialLoadComplete,
    };

    // Add to data map IMMEDIATELY
    this.data.set(feed.id, item);
    this._feedData.update(map => {
      const newMap = new Map(map);
      newMap.set(feed.id, item);
      return newMap;
    });

    // Load cached events (skip for dynamic feeds - they should always fetch fresh data)
    const isDynamicFeed = feed.id === this.DYNAMIC_FEED_ID;
    let cachedEvents: Event[] = [];

    if (!isDynamicFeed) {
      cachedEvents = await this.loadCachedEvents(feed.id);

      if (cachedEvents.length > 0) {
        item.events.set(cachedEvents);
        const mostRecentTimestamp = Math.max(...cachedEvents.map(e => e.created_at));
        item.lastCheckTimestamp = mostRecentTimestamp;
        this.logger.info(`🚀 Rendered ${cachedEvents.length} cached events for feed ${feed.id}`);
        
        // Prefetch profiles for cached events in background
        this.prefetchProfilesForEvents(cachedEvents);
      }
    }

    // Build filter based on feed configuration
    if (feed.filters) {
      item.filter = {
        limit: 60,
        kinds: feed.kinds,
        ...feed.filters,
      };
    } else {
      item.filter = {
        limit: 60,
        kinds: feed.kinds,
      };
    }

    // Set since filter if we have lastRetrieved and cached events
    if (feed.lastRetrieved && item.filter && cachedEvents.length > 0) {
      item.filter.since = feed.lastRetrieved;
      this.logger.info(`📅 Feed ${feed.id}: Using since=${feed.lastRetrieved} (lastRetrieved) to fetch only new events`);
    } else if (feed.lastRetrieved && cachedEvents.length === 0) {
      this.logger.info(`📅 Feed ${feed.id}: No cached events, ignoring lastRetrieved=${feed.lastRetrieved} to fetch historical events`);
    }

    // Load feed data based on source type
    if (feed.source === 'following') {
      this.logger.debug(`📍 Loading FOLLOWING feed for ${feed.id}`);
      this.loadFollowingFeed(item).catch((err) =>
        this.logger.error(`Error loading following feed for ${feed.id}:`, err)
      );
    } else if (feed.source === 'for-you') {
      this.logger.debug(`📍 Loading FOR-YOU feed for ${feed.id}`);
      this.loadForYouFeed(item).catch((err) =>
        this.logger.error(`Error loading for-you feed for ${feed.id}:`, err)
      );
    } else if (feed.source === 'custom') {
      this.logger.debug(`📍 Loading CUSTOM feed for ${feed.id}`);
      this.loadCustomFeed(item).catch((err) =>
        this.logger.error(`Error loading custom feed for ${feed.id}:`, err)
      );
    } else if (feed.source === 'search') {
      this.logger.debug(`📍 Loading SEARCH feed for ${feed.id} with query: ${feed.searchQuery}`);
      this.loadSearchFeed(item).catch((err) =>
        this.logger.error(`Error loading search feed for ${feed.id}:`, err)
      );
    } else if (feed.source === 'interests') {
      this.logger.debug(`📍 Loading INTERESTS feed for ${feed.id} with hashtags: ${feed.customInterestHashtags?.join(', ')}`);
      this.loadInterestsFeed(item).catch((err) =>
        this.logger.error(`Error loading interests feed for ${feed.id}:`, err)
      );
    } else {
      this.logger.debug(`📍 Loading GLOBAL/OTHER feed for ${feed.id}, source:`, feed.source);

      // Subscribe to relay events using the appropriate relay service
      let sub: { unsubscribe: () => void } | { close: () => void } | null = null;

      if (
        feed.relayConfig === 'custom' &&
        feed.customRelays &&
        feed.customRelays.length > 0
      ) {
        // Use custom relays for this feed via RelayPoolService
        this.logger.debug(`Using custom relays for feed ${feed.id}:`, feed.customRelays);
        this.logger.debug(`🚀 Using RelayPoolService.subscribe with custom relays:`, feed.customRelays);
        this.logger.debug(`🚀 Subscribing to relay with filter:`, JSON.stringify(item.filter, null, 2));

        sub = this.relayPool.subscribe(feed.customRelays, item.filter, (event: Event) => {
          this.logger.debug(`📨 Event received in callback: ${event.id.substring(0, 8)}...`);

          // Save event to database
          this.saveEventToDatabase(event);

          // Filter out muted events
          if (this.accountState.muted(event)) {
            this.logger.debug(`🔇 Event muted: ${event.id.substring(0, 8)}...`);
            return;
          }

          const currentEvents = item.events();
          // Queue events if initial load is complete AND there are existing events
          if (item.initialLoadComplete && currentEvents.length > 0) {
            this.logger.debug(`📥 Queuing relay event for feed ${feed.id}: ${event.id.substring(0, 8)}...`);
            item.pendingEvents?.update((pending: Event[]) => {
              if (pending.some(e => e.id === event.id)) {
                return pending;
              }
              const newPending = [...pending, event];
              return newPending.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
            });
          } else {
            this.logger.debug(`➕ Adding relay event to feed ${feed.id}: ${event.id.substring(0, 8)}...`);
            item.events.update((events: Event[]) => {
              if (events.some(e => e.id === event.id)) {
                return events;
              }
              const newEvents = [...events, event];
              const sortedEvents = newEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
              this.saveCachedEvents(feed.id, sortedEvents);
              return sortedEvents;
            });
          }

          this.logger.debug(`Feed event received for ${feed.id}:`, event);
        });
      } else {
        // Use account relays (default)
        this.logger.debug(`Using account relays for feed ${feed.id}`);
        this.logger.debug(`🚀 Using AccountRelayService.subscribe`);
        this.logger.debug(`🚀 Subscribing to relay with filter:`, JSON.stringify(item.filter, null, 2));

        sub = this.accountRelay.subscribe(item.filter, (event: Event) => {
          this.logger.debug(`📨 Event received in callback: ${event.id.substring(0, 8)}...`);

          // Save event to database
          this.saveEventToDatabase(event);

          // Filter out muted events
          if (this.accountState.muted(event)) {
            this.logger.debug(`🔇 Event muted: ${event.id.substring(0, 8)}...`);
            return;
          }

          const currentEvents = item.events();
          // Queue events if initial load is complete AND there are existing events
          if (item.initialLoadComplete && currentEvents.length > 0) {
            this.logger.debug(`📥 Queuing relay event for feed ${feed.id}: ${event.id.substring(0, 8)}...`);
            item.pendingEvents?.update((pending: Event[]) => {
              if (pending.some(e => e.id === event.id)) {
                return pending;
              }
              const newPending = [...pending, event];
              return newPending.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
            });
          } else {
            this.logger.debug(`➕ Adding relay event to feed ${feed.id}: ${event.id.substring(0, 8)}...`);
            item.events.update((events: Event[]) => {
              if (events.some(e => e.id === event.id)) {
                return events;
              }
              const newEvents = [...events, event];
              const sortedEvents = newEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
              this.saveCachedEvents(feed.id, sortedEvents);
              return sortedEvents;
            });
          }

          this.logger.debug(`Feed event received for ${feed.id}:`, event);
        });
      }

      // Store subscription for later cleanup
      item.subscription = sub;

      // Mark initial load as complete after brief delay to allow relay events to flow in
      const hasCachedEvents = cachedEvents.length > 0;
      if (!hasCachedEvents) {
        setTimeout(() => {
          if (!item.initialLoadComplete) {
            item.initialLoadComplete = true;
            item.isRefreshing?.set(false);
            this.logger.info(`✅ Initial relay load complete for feed ${feed.id} - new events will be queued`);
          }
        }, 2000);
      } else {
        // If we have cached events, set isRefreshing to false immediately so they display
        item.isRefreshing?.set(false);
      }
    }
  }

  /**
   * Subscribe to a single feed
   */
  private async subscribeToColumn(feed: FeedConfig): Promise<void> {
    // Skip subscription for trending feeds - they use external API, not relay subscriptions
    if (feed.source === 'trending') {
      this.logger.debug(`Feed ${feed.id} is a trending feed - skipping subscription`);
      return;
    }

    // Don't subscribe if already subscribed
    if (this.data.has(feed.id)) {
      this.logger.warn(`Feed ${feed.id} is already subscribed`);
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
      feed: feed,
      filter: null,
      events: signal<Event[]>([]), // Start with empty, will update with cached events
      subscription: null,
      lastTimestamp: Date.now(),
      isLoadingMore: signal<boolean>(false),
      isRefreshing: signal<boolean>(true), // Start as refreshing since we're loading content
      hasMore: signal<boolean>(true),
      pendingEvents: signal<Event[]>([]),
      isCheckingForNewEvents: signal<boolean>(false),
      lastCheckTimestamp: Math.floor(Date.now() / 1000),
      initialLoadComplete: initialLoadComplete,
    };

    // Add to data map IMMEDIATELY so UI has an entry (even if empty)
    this.data.set(feed.id, item);
    this._feedData.update(map => {
      const newMap = new Map(map);
      newMap.set(feed.id, item);
      return newMap;
    });

    // NOW load cached events asynchronously and update the signal
    const cachedEvents = await this.loadCachedEvents(feed.id);

    if (cachedEvents.length > 0) {
      // Update the events signal with cached events
      item.events.set(cachedEvents);

      // Update lastCheckTimestamp based on most recent cached event
      const mostRecentTimestamp = Math.max(...cachedEvents.map(e => e.created_at));
      item.lastCheckTimestamp = mostRecentTimestamp;

      this.logger.info(`🚀 Rendered ${cachedEvents.length} cached events for feed ${feed.id}`);
      
      // Prefetch profiles for cached events in background
      this.prefetchProfilesForEvents(cachedEvents);
    }

    // Build filter based on feed configuration
    if (feed.filters) {
      item.filter = {
        limit: 6,
        kinds: feed.kinds,
        ...feed.filters,
      };
    } else {
      item.filter = {
        limit: 6,
        kinds: feed.kinds,
      };
    }

    // Add 'since' parameter based on lastRetrieved timestamp to prevent re-fetching old events
    // Use lastRetrieved instead of event.created_at since users can set arbitrary timestamps
    // IMPORTANT: Only use lastRetrieved if we have cached events to display.
    // If there are very few cached events (< 5), also ignore lastRetrieved to fetch more historical data.
    // This helps when a feed was created but only fetched a few recent events.
    const hasSubstantialCache = cachedEvents.length >= 5;
    if (feed.lastRetrieved && item.filter && hasSubstantialCache) {
      item.filter.since = feed.lastRetrieved;
      this.logger.info(`📅 Feed ${feed.id}: Using since=${feed.lastRetrieved} (lastRetrieved) to fetch only new events (${cachedEvents.length} cached)`);
    } else if (feed.lastRetrieved && !hasSubstantialCache) {
      this.logger.info(`📅 Feed ${feed.id}: Only ${cachedEvents.length} cached events, ignoring lastRetrieved=${feed.lastRetrieved} to fetch historical events`);
    }

    // Now start loading fresh events in the BACKGROUND (don't await)
    // This allows cached events to display immediately while fresh data loads
    // If the source is following, fetch from ALL following users
    if (feed.source === 'following') {
      this.logger.debug(`📍 Loading FOLLOWING feed for feed ${feed.id}`);
      this.loadFollowingFeed(item).catch(err =>
        this.logger.error(`Error loading following feed for ${feed.id}:`, err)
      );
    } else if (feed.source === 'for-you') {
      this.logger.debug(`📍 Loading FOR-YOU feed for feed ${feed.id}`);
      this.loadForYouFeed(item).catch(err =>
        this.logger.error(`Error loading for-you feed for ${feed.id}:`, err)
      );
    } else if (feed.source === 'custom') {
      this.logger.debug(`📍 Loading CUSTOM feed for feed ${feed.id}`);
      this.loadCustomFeed(item).catch(err =>
        this.logger.error(`Error loading custom feed for ${feed.id}:`, err)
      );
    } else if (feed.source === 'search') {
      this.logger.debug(`📍 Loading SEARCH feed for feed ${feed.id} with query: ${feed.searchQuery}`);
      this.loadSearchFeed(item).catch(err =>
        this.logger.error(`Error loading search feed for ${feed.id}:`, err)
      );
    } else if (feed.source === 'interests') {
      this.logger.debug(`📍 Loading INTERESTS feed for feed ${feed.id} with hashtags: ${feed.customInterestHashtags?.join(', ')}`);
      this.loadInterestsFeed(item).catch(err =>
        this.logger.error(`Error loading interests feed for ${feed.id}:`, err)
      );
    } else {
      this.logger.debug(`📍 Loading GLOBAL/OTHER feed for feed ${feed.id}, source:`, feed.source);

      // Subscribe to relay events using the appropriate relay service
      let sub: { unsubscribe: () => void } | { close: () => void } | null = null;

      if (
        feed.relayConfig === 'custom' &&
        feed.customRelays &&
        feed.customRelays.length > 0
      ) {
        // Use custom relays for this feed via RelayPoolService
        this.logger.debug(`Using custom relays for feed ${feed.id}:`, feed.customRelays);
        this.logger.debug(`🚀 Using RelayPoolService.subscribe with custom relays:`, feed.customRelays);
        this.logger.debug(`🚀 Subscribing to relay with filter:`, JSON.stringify(item.filter, null, 2));

        sub = this.relayPool.subscribe(feed.customRelays, item.filter, (event: Event) => {
          this.logger.debug(`📨 Event received in callback: ${event.id.substring(0, 8)}...`);

          // Save event to database for Summary page queries
          this.saveEventToDatabase(event);

          // Filter out live events that are muted.
          if (this.accountState.muted(event)) {
            this.logger.debug(`🔇 Event muted: ${event.id.substring(0, 8)}...`);
            return;
          }

          const currentEvents = item.events();
          // Queue events if initial load is complete AND there are existing events
          // If there are zero events, show new events directly (don't force user to click "new posts" button)
          if (item.initialLoadComplete && currentEvents.length > 0) {
            this.logger.debug(`📥 Queuing relay event for feed ${feed.id}: ${event.id.substring(0, 8)}...`);
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
            this.logger.debug(`➕ Adding relay event to empty feed for feed ${feed.id}: ${event.id.substring(0, 8)}...`);
            item.events.update((events: Event[]) => {
              // Avoid duplicates
              if (events.some(e => e.id === event.id)) {
                return events;
              }
              const newEvents = [...events, event];
              const sortedEvents = newEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
              // Schedule cache save (debounced internally)
              this.saveCachedEvents(feed.id, sortedEvents);
              return sortedEvents;
            });
          }

          this.logger.debug(`Feed event received for ${feed.id}:`, event);
        });
      } else {
        // Use account relays (default)
        this.logger.debug(`Using account relays for feed ${feed.id}`);
        this.logger.debug(`🚀 Using AccountRelayService.subscribe`);
        this.logger.debug(`🚀 Subscribing to relay with filter:`, JSON.stringify(item.filter, null, 2));

        sub = this.accountRelay.subscribe(item.filter, (event: Event) => {
          this.logger.debug(`📨 Event received in callback: ${event.id.substring(0, 8)}...`);

          // Save event to database for Summary page queries
          this.saveEventToDatabase(event);

          // Filter out live events that are muted.
          if (this.accountState.muted(event)) {
            this.logger.debug(`🔇 Event muted: ${event.id.substring(0, 8)}...`);
            return;
          }

          const currentEvents = item.events();
          // Queue events if initial load is complete AND there are existing events
          // If there are zero events, show new events directly (don't force user to click "new posts" button)
          if (item.initialLoadComplete && currentEvents.length > 0) {
            this.logger.debug(`📥 Queuing relay event for feed ${feed.id}: ${event.id.substring(0, 8)}...`);
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
            this.logger.debug(`➕ Adding relay event to empty feed for feed ${feed.id}: ${event.id.substring(0, 8)}...`);
            item.events.update((events: Event[]) => {
              // Avoid duplicates
              if (events.some(e => e.id === event.id)) {
                return events;
              }
              const newEvents = [...events, event];
              const sortedEvents = newEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
              // Schedule cache save (debounced internally)
              this.saveCachedEvents(feed.id, sortedEvents);
              return sortedEvents;
            });
          }

          this.logger.debug(`Column event received for ${feed.id}:`, event);
        });
      }

      item.subscription = sub;
      this.logger.debug(`✅ Subscription created and stored:`, sub ? 'YES' : 'NO');

      // For empty feeds, mark initial load as complete after 2 seconds
      // This allows initial burst of events to render, then subsequent events queue
      // Use the current state of events since cache was already loaded above
      const hasCachedEvents = item.events().length > 0;
      if (!hasCachedEvents) {
        setTimeout(() => {
          if (!item.initialLoadComplete) {
            item.initialLoadComplete = true;
            item.isRefreshing?.set(false);
            this.logger.info(`✅ Initial relay load complete for column ${feed.id} - new events will be queued`);
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
      const feed = feedData.feed;
      const allPubkeys = new Set<string>();

      // Add custom users pubkeys
      if (feed.customUsers && feed.customUsers.length > 0) {
        feed.customUsers.forEach(pubkey => allPubkeys.add(pubkey));
        this.logger.debug(`Added ${feed.customUsers.length} custom users`);
      }

      // Add pubkeys from starter packs
      if (feed.customStarterPacks && feed.customStarterPacks.length > 0) {
        try {
          // Fetch starter packs to get the current data
          const allStarterPacks = await this.followset.fetchStarterPacks();

          // Find the starter packs we need by matching dTag
          const selectedPacks = allStarterPacks.filter(pack =>
            feed.customStarterPacks?.includes(pack.dTag)
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
      if (feed.customFollowSets && feed.customFollowSets.length > 0) {
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
                if (dTag && feed.customFollowSets.includes(dTag)) {
                  // Extract public pubkeys from p tags
                  const publicPubkeys = event.tags
                    .filter((t: string[]) => t[0] === 'p' && t[1])
                    .map((t: string[]) => t[1]);

                  publicPubkeys.forEach((pk: string) => allPubkeys.add(pk));
                  this.logger.info(`[loadCustomFeed] Follow set "${dTag}" has ${publicPubkeys.length} public pubkeys`);

                  // Extract private pubkeys from encrypted content
                  let privatePubkeysCount = 0;
                  if (event.content && event.content.trim() !== '') {
                    try {
                      const isEncrypted = this.encryption.isContentEncrypted(event.content);
                      this.logger.info(`[loadCustomFeed] Follow set "${dTag}" content is encrypted: ${isEncrypted}`);

                      if (isEncrypted) {
                        const decrypted = await this.encryption.autoDecrypt(event.content, pubkey, event);
                        this.logger.info(`[loadCustomFeed] Decryption result: ${decrypted ? 'success' : 'failed'}`);

                        if (decrypted && decrypted.content) {
                          this.logger.info(`[loadCustomFeed] Decrypted content (first 200 chars): ${decrypted.content.substring(0, 200)}`);

                          try {
                            const privateData = JSON.parse(decrypted.content);
                            this.logger.info(`[loadCustomFeed] Decrypted data type: ${typeof privateData}, is array: ${Array.isArray(privateData)}, length: ${Array.isArray(privateData) ? privateData.length : 'N/A'}`);

                            if (Array.isArray(privateData)) {
                              this.logger.info(`[loadCustomFeed] First tag in privateData: ${JSON.stringify(privateData[0])}`);
                              const privatePubkeys = privateData
                                .filter((tag: string[]) => tag[0] === 'p' && tag[1])
                                .map((tag: string[]) => tag[1]);
                              privatePubkeys.forEach(pk => allPubkeys.add(pk));
                              privatePubkeysCount = privatePubkeys.length;
                              this.logger.info(`[loadCustomFeed] Follow set "${dTag}" has ${privatePubkeysCount} private (encrypted) pubkeys: ${privatePubkeys.map(pk => pk.slice(0, 8)).join(', ')}`);
                            }
                          } catch (parseError) {
                            this.logger.error(`[loadCustomFeed] Failed to parse decrypted content as JSON:`, parseError);
                          }
                        } else {
                          this.logger.warn(`[loadCustomFeed] Decryption succeeded but no content returned`);
                        }
                      }
                    } catch (error) {
                      this.logger.error(`Failed to decrypt follow set ${dTag}:`, error);
                    }
                  }

                  this.logger.info(`[loadCustomFeed] ✅ Added follow set "${dTag}" with ${publicPubkeys.length} public + ${privatePubkeysCount} private users = ${publicPubkeys.length + privatePubkeysCount} total`);
                }
              }

              const totalPubkeysFromFollowSets = allPubkeys.size - (feed.customUsers?.length || 0);
              this.logger.debug(`[loadCustomFeed] Processed ${feed.customFollowSets.length} follow sets, added ${totalPubkeysFromFollowSets} pubkeys`);
            } else {
              this.logger.warn(`[loadCustomFeed] No follow set events found for selected dTags:`, feed.customFollowSets);
            }
          }
        } catch (error) {
          this.logger.error('Error fetching follow set data:', error);
        }
      }

      const pubkeysArray = Array.from(allPubkeys);

      this.logger.info(`[loadCustomFeed] ✅ Total unique pubkeys collected: ${pubkeysArray.length}`);
      this.logger.info(`[loadCustomFeed] 📊 Breakdown - Custom users: ${feed.customUsers?.length || 0}, Starter packs: ${feed.customStarterPacks?.length || 0}, Follow sets: ${feed.customFollowSets?.length || 0}`);

      if (pubkeysArray.length > 0) {
        this.logger.info(`[loadCustomFeed] 👥 Pubkeys: ${pubkeysArray.map(pk => pk.slice(0, 8)).join(', ')}`);
      }

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

      this.logger.info(`[loadCustomFeed] Loading custom feed with ${pubkeysArray.length} unique users (ALL will be used, no algorithm filtering)`);

      // Fetch events from ALL specified users (no algorithm filtering)
      // Note: We no longer clear cached events here. Cached events provide instant display
      // while fresh data is fetched from relays. The fetchEventsFromUsers method handles
      // merging new events with existing ones (or queuing them as pending if initialLoadComplete).
      await this.fetchEventsFromUsers(pubkeysArray, feedData);

      this.logger.info(`[loadCustomFeed] ✅ Loaded custom feed with ${pubkeysArray.length} users`);
    } catch (error) {
      this.logger.error('Error loading custom feed:', error);
    }
  }

  /**
   * Load search-based feed - fetches events from search relays using NIP-50.
   * 
   * This method uses the SearchRelayService for search queries:
   * 1. Uses NIP-50 search extension on configured search relays
   * 2. Supports hashtag searches and keyword searches
   * 3. Returns events matching the search query
   */
  private async loadSearchFeed(feedData: FeedItem) {
    try {
      const feed = feedData.feed;
      const searchQuery = feed.searchQuery;

      if (!searchQuery || searchQuery.trim() === '') {
        this.logger.warn('No search query specified for search feed');
        feedData.isRefreshing?.set(false);
        feedData.initialLoadComplete = true;
        return;
      }

      const kinds = feedData.filter?.kinds || [1]; // Default to text notes

      // For NIP-50 search feeds:
      // - Initial load: Don't use 'since' filter - let search relays return most relevant results
      // - Refresh: Use 'since' filter from lastRetrieved to get new content only
      // This is different from regular feeds because NIP-50 search is based on relevance,
      // not chronological order, and we want the best results on first load.
      const since = feed.lastRetrieved ? feed.lastRetrieved : undefined;

      this.logger.info(`🔍 Loading SEARCH feed for query "${searchQuery}" with kinds: ${kinds.join(', ')}${since ? `, since: ${since}` : ' (no time filter)'}`);

      // Use SearchRelayService to perform the search
      const events = await this.searchRelay.searchForFeed(
        searchQuery.trim(),
        kinds,
        100, // limit
        since
      );

      if (events.length === 0) {
        this.logger.info(`🔍 No events found for search query: "${searchQuery}"`);
        feedData.isRefreshing?.set(false);
        feedData.initialLoadComplete = true;
        return;
      }

      this.logger.info(`🔍 Found ${events.length} events for search query: "${searchQuery}"`);

      // Add events to the feed
      const currentEvents = feedData.events();
      const existingIds = new Set(currentEvents.map(e => e.id));

      // Filter out duplicates and muted events
      const newEvents = events.filter(event => {
        if (existingIds.has(event.id)) return false;
        if (this.accountState.muted(event)) return false;
        return true;
      });

      if (newEvents.length > 0) {
        // Sort by created_at descending
        const allEvents = [...currentEvents, ...newEvents].sort(
          (a, b) => (b.created_at || 0) - (a.created_at || 0)
        );

        feedData.events.set(allEvents);

        // Save to cache
        this.saveCachedEvents(feed.id, allEvents);

        // Save events to database for offline access
        for (const event of newEvents) {
          this.saveEventToDatabase(event);
        }

        this.logger.debug(`Added ${newEvents.length} new events from search, total: ${allEvents.length}`);
      }

      // Update lastRetrieved timestamp
      this.updateColumnLastRetrieved(feed.id);

      // Mark initial load as complete and stop showing loading spinner
      feedData.isRefreshing?.set(false);
      feedData.initialLoadComplete = true;
      this.logger.info(`✅ Search feed load complete for ${feed.id} - found ${events.length} events`);

    } catch (error) {
      this.logger.error('Error loading search feed:', error);
      // Always mark as complete even on error to stop loading spinner
      feedData.isRefreshing?.set(false);
      feedData.initialLoadComplete = true;
    }
  }

  /**
   * Load interests-based feed - fetches events filtered by hashtags from user's interest list.
   * 
   * This method uses the SearchRelayService for hashtag queries:
   * 1. Gets the selected hashtags from customInterestHashtags
   * 2. Uses NIP-50 search relays which have indexed hashtags
   * 3. Builds a search query with hashtags (e.g., "#bitcoin #nostr")
   * 4. Returns events matching any of the hashtags
   * 
   * NOTE: Using SearchRelayService instead of accountRelay because most standard relays
   * don't properly support or index hashtag filters (#t). Search relays like relay.nostr.band
   * are specifically designed for this purpose.
   */
  private async loadInterestsFeed(feedData: FeedItem) {
    try {
      const feed = feedData.feed;
      const hashtags = feed.customInterestHashtags;

      if (!hashtags || hashtags.length === 0) {
        this.logger.warn('No interest hashtags specified for interests feed');
        feedData.isRefreshing?.set(false);
        feedData.initialLoadComplete = true;
        return;
      }

      const kinds = feedData.filter?.kinds || [1]; // Default to text notes
      const since = feed.lastRetrieved ? feed.lastRetrieved : undefined;

      this.logger.debug(`🏷️ Loading interests feed for ${hashtags.length} hashtags`);

      // Use account relay with #t tag filter - Nostr filters with #t: [tag1, tag2] 
      // already do OR matching (events with ANY of those tags)
      const filter: any = {
        kinds,
        '#t': hashtags, // Array of tags = OR matching
        limit: 100,
      };

      if (since) {
        filter.since = since;
      }

      const allEvents = await this.accountRelay.getMany<Event>(filter);

      if (allEvents.length === 0) {
        this.logger.debug(`🏷️ No events found for interest hashtags`);
        feedData.isRefreshing?.set(false);
        feedData.initialLoadComplete = true;
        return;
      }

      this.logger.debug(`🏷️ Found ${allEvents.length} events for interest hashtags`);;

      // Add events to the feed
      const currentEvents = feedData.events();
      const existingIds = new Set(currentEvents.map(e => e.id));

      // Filter out duplicates and muted events
      const newEvents = allEvents.filter((event: Event) => {
        if (existingIds.has(event.id)) return false;
        if (this.accountState.muted(event)) return false;
        return true;
      });

      if (newEvents.length > 0) {
        // Sort by created_at descending
        const combinedEvents = [...currentEvents, ...newEvents].sort(
          (a, b) => (b.created_at || 0) - (a.created_at || 0)
        );

        feedData.events.set(combinedEvents);

        // Save to cache (skip for dynamic feeds - they change frequently)
        if (feed.id !== this.DYNAMIC_FEED_ID) {
          this.saveCachedEvents(feed.id, allEvents);
        }

        // Save events to database for offline access
        for (const event of newEvents) {
          this.saveEventToDatabase(event);
        }

        this.logger.debug(`Added ${newEvents.length} new events from interests`);
      }

      // Update lastRetrieved timestamp
      this.updateColumnLastRetrieved(feed.id);

      // Mark initial load as complete and stop showing loading spinner
      feedData.isRefreshing?.set(false);
      feedData.initialLoadComplete = true;

    } catch (error) {
      this.logger.error('Error loading interests feed:', error);
      // Always mark as complete even on error to stop loading spinner
      feedData.isRefreshing?.set(false);
      feedData.initialLoadComplete = true;
    }
  }

  /**
   * Load following feed - fetches events from ALL users the current user follows.
   * 
   * PERFORMANCE OPTIMIZED:
   * - Uses TIME-WINDOW based fetching (6-hour windows) instead of per-user limits
   * - Shows events IMMEDIATELY as they arrive (doesn't wait for all users)
   * - Supports infinite scroll by loading older 6-hour windows
   * 
   * This method uses the FollowingDataService for efficient batched fetching:
   * 1. Groups following users by shared relay sets
   * 2. Fetches ALL events from the current 6-hour time window
   * 3. Updates UI IMMEDIATELY as events arrive (shows "new posts" button ASAP)
   * 4. Loads cached events first for instant UI
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

      this.logger.info(`📢 Loading FOLLOWING feed with ${followingList.length} users (TIME-WINDOW mode)`);

      // Use the centralized FollowingDataService for efficient fetching
      const events = await this.followingData.ensureFollowingData(
        kinds,
        false, // Don't force refresh if data is fresh
        // Incremental update callback - fires IMMEDIATELY when events arrive
        (newEvents: Event[]) => {
          this.handleFollowingIncrementalUpdate(feedData, newEvents);
        },
        // Cache loaded callback - fires when cached events are available
        (cachedEvents: Event[]) => {
          // Show cached events immediately for instant UI
          if (cachedEvents.length > 0 && feedData.events().length === 0) {
            this.handleFollowingIncrementalUpdate(feedData, cachedEvents);
            this.logger.debug(`📦 Loaded ${cachedEvents.length} cached events immediately`);
            
            // Signal initial content ready immediately when cache is loaded
            // This provides the fastest possible time-to-first-render
            if (!this._hasInitialContent()) {
              this._hasInitialContent.set(true);
              this.appState.feedHasInitialContent.set(true);
              this.logger.debug(`✅ [Following] Cache loaded - signaling content ready`);
            }
          }
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
   * Load more events for following feed (infinite scroll).
   * Fetches the next 6-hour time window of events.
   */
  async loadMoreFollowingEvents(feedData: FeedItem): Promise<boolean> {
    try {
      const kinds = feedData.filter?.kinds || [1];

      // Check if there are more events to load
      if (!this.followingData.hasMoreOlderEvents()) {
        this.logger.debug('No more older events available (reached 30-day limit)');
        return false;
      }

      this.logger.info('📜 Loading older events (next 6-hour window)...');

      const newEvents = await this.followingData.loadOlderEvents(
        kinds,
        // Incremental callback for older events
        (batchEvents: Event[]) => {
          // For pagination, add events directly (they're already older)
          this.handleFollowingPaginationUpdate(feedData, batchEvents);
        }
      );

      if (newEvents.length === 0) {
        this.logger.debug('No events found in the older time window');
        return false;
      }

      this.logger.info(`📜 Loaded ${newEvents.length} older events`);
      return true;
    } catch (error) {
      this.logger.error('Error loading more following events:', error);
      return false;
    }
  }

  /**
   * Handle pagination updates for following feed (older events).
   * These are always added to the end of the feed (they're older).
   */
  private handleFollowingPaginationUpdate(feedData: FeedItem, newEvents: Event[]) {
    if (newEvents.length === 0) return;

    const allowedKinds = new Set(feedData.feed.kinds);

    // Filter out muted events and events that don't match column's kinds
    const filteredEvents = newEvents.filter(
      event => !this.accountState.muted(event) && allowedKinds.has(event.kind)
    );

    if (filteredEvents.length === 0) return;

    const existingEvents = feedData.events();
    const existingIds = new Set(existingEvents.map(e => e.id));

    // Only add events that don't already exist
    const trulyNewEvents = filteredEvents.filter(e => !existingIds.has(e.id));

    if (trulyNewEvents.length > 0) {
      // Add to the feed and re-sort (older events will naturally go to the end)
      const mergedEvents = [...existingEvents, ...trulyNewEvents]
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

      feedData.events.set(mergedEvents);

      // Trigger reactivity update for components
      this._feedData.update(map => new Map(map));

      // Save to database
      for (const event of trulyNewEvents) {
        this.saveEventToDatabase(event);
      }

      // Save to cache
      this.saveCachedEvents(feedData.feed.id, mergedEvents);
    }
  }

  /**
   * Handle incremental updates for following feed as events arrive.
   * 
   * CRITICAL FOR PERFORMANCE:
   * - Shows events IMMEDIATELY (doesn't wait for all users to complete)
   * - If no cached events: render first batch immediately for fast initial paint
   * - If has cached events: add to pending for "new posts" button (also immediate!)
   * - Signals hasInitialContent as soon as ANY events are available for faster perceived load
   */
  private handleFollowingIncrementalUpdate(feedData: FeedItem, newEvents: Event[]) {
    if (newEvents.length === 0) return;

    const existingEvents = feedData.events();

    // Get allowed kinds for this column
    const allowedKinds = new Set(feedData.feed.kinds);

    // Filter out muted events and events that don't match the column's kinds
    const filteredEvents = newEvents.filter(
      event => !this.accountState.muted(event) && allowedKinds.has(event.kind)
    );

    if (filteredEvents.length === 0) return;

    // Dynamic update strategy:
    // - If initial load NOT complete: show events immediately
    // - If initial load complete AND has existing events: queue to pending for "new posts" button
    // This allows users to see cached events immediately, then new content via the button
    const hasExistingEvents = existingEvents.length > 0;

    if (!feedData.initialLoadComplete) {
      // Initial load - show events immediately (whether from cache or relay)
      const existingIds = new Set(existingEvents.map(e => e.id));
      const trulyNewEvents = filteredEvents.filter(e => !existingIds.has(e.id));

      if (trulyNewEvents.length > 0) {
        const mergedEvents = [...existingEvents, ...trulyNewEvents]
          .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

        feedData.events.set(mergedEvents);

        // Trigger reactivity update for components that depend on the map reference
        this._feedData.update(map => new Map(map));

        // Mark initial load as complete after first batch is shown
        feedData.initialLoadComplete = true;
        
        // Signal that initial content is ready - this helps with perceived performance
        // and allows other components (like profile loading) to proceed
        if (!this._hasInitialContent()) {
          this._hasInitialContent.set(true);
          this.appState.feedHasInitialContent.set(true);
          this.logger.debug(`✅ [Following] First events rendered - signaling content ready`);
        }

        // Save to database for Summary page queries
        for (const event of trulyNewEvents) {
          this.saveEventToDatabase(event);
        }
      }
    } else if (hasExistingEvents) {
      // User has cached events - queue ALL relay events to pending
      // This shows the "X new posts" button updating dynamically
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

        // Trigger reactivity update for components to see the new pending count
        this._feedData.update(map => new Map(map));

        // Save to database for Summary page queries
        for (const event of trulyNewEvents) {
          this.saveEventToDatabase(event);
        }
      }
    } else {
      // Initial load is marked complete, but there are no displayed events.
      // This can happen when startFeedsOnLastEvent is enabled and there's no cache.
      // In that case, show events immediately to avoid an empty feed.
      const existingIds = new Set(existingEvents.map(e => e.id));
      const trulyNewEvents = filteredEvents.filter(e => !existingIds.has(e.id));

      if (trulyNewEvents.length > 0) {
        const mergedEvents = [...existingEvents, ...trulyNewEvents]
          .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

        feedData.events.set(mergedEvents);
        this._feedData.update(map => new Map(map));

        for (const event of trulyNewEvents) {
          this.saveEventToDatabase(event);
        }
      }
    }
  }

  /**
   * Finalize following feed with all fetched events.
   * This is called after all relay batches have completed.
   * Events may have already been incrementally added to either:
   * - feedData.events() (if user had no cache)
   * - feedData.pendingEvents() (if user had cached events)
   */
  private handleFollowingFinalUpdate(feedData: FeedItem, allEvents: Event[]) {
    // Get allowed kinds for this column
    const allowedKinds = new Set(feedData.feed.kinds);

    // Filter out muted events and events that don't match the column's kinds
    const filteredEvents = allEvents.filter(
      event => !this.accountState.muted(event) && allowedKinds.has(event.kind)
    );

    const existingEvents = feedData.events();
    const existingIds = new Set(existingEvents.map(e => e.id));
    const pendingIds = new Set(feedData.pendingEvents?.()?.map(e => e.id) || []);

    // Find events that weren't processed during incremental updates
    const unprocessedEvents = filteredEvents.filter(
      e => !existingIds.has(e.id) && !pendingIds.has(e.id)
    );

    if (unprocessedEvents.length > 0) {
      if (existingEvents.length > 0) {
        // User has events - find the most recent to determine where to put unprocessed events
        const mostRecentExistingTimestamp = Math.max(...existingEvents.map(e => e.created_at || 0));

        const eventsToMerge: Event[] = [];
        const eventsToQueue: Event[] = [];

        for (const event of unprocessedEvents) {
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

          this.logger.debug(`✅ Final: Merged ${eventsToMerge.length} older events into feed`);
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

          this.logger.debug(`📥 Final: Queued ${eventsToQueue.length} additional events to pending`);
        }
      } else {
        // No existing events - merge all unprocessed events
        const mergedEvents = [...existingEvents, ...unprocessedEvents]
          .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

        feedData.events.set(mergedEvents);

        // Save to database for Summary page queries
        for (const event of unprocessedEvents) {
          this.saveEventToDatabase(event);
        }
      }
    }

    // Save to cache - include both displayed and pending events
    const pendingEvents = feedData.pendingEvents?.() || [];
    const allEventsForCache = [...feedData.events(), ...pendingEvents];
    const uniqueEventsForCache = Array.from(
      new Map(allEventsForCache.map(e => [e.id, e])).values()
    ).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    this.saveCachedEvents(feedData.feed.id, uniqueEventsForCache);

    // Mark initial load as complete
    feedData.initialLoadComplete = true;
    feedData.isRefreshing?.set(false);

    // Update lastRetrieved timestamp
    this.updateColumnLastRetrieved(feedData.feed.id);

    const totalPending = feedData.pendingEvents?.()?.length || 0;
    this.logger.info(`✅ Following feed finalized with ${feedData.events().length} displayed events, ${totalPending} pending`);
  }

  /**
   * Load "For You" feed - combines multiple sources for personalized content
   * 
   * This method implements a personalized feed strategy:
   * 1. Includes popular starter pack accounts (dynamically fetched)
   * 2. Includes algorithm-recommended users based on engagement
   * 3. Includes subset of following accounts (for performance)
   * 4. Deduplicates and fetches events from combined list
   * 
   * OPTIMIZATION: Uses two-phase loading:
   * - Phase 1: Fast batch query to account's connected relays (shows content quickly)
   * - Phase 2: Background outbox model queries for additional content
   */
  private async loadForYouFeed(feedData: FeedItem) {
    try {
      this.logger.debug('🚀 [For You] loadForYouFeed STARTED');
      const isArticlesFeed = feedData.filter?.kinds?.includes(30023);

      // Hardcoded popular pubkeys for INSTANT first load - no waiting for anything
      const FALLBACK_POPULAR_PUBKEYS = [
        '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2', // jack
        '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d', // fiatjaf
        '32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245', // jb55
        '04c915daefee38317fa734444acee390a8269fe5810b2241e5e6dd343dfbecc9', // Vitor Pamplona
        'e33fe65f1fde44c6dc17eeb38fdad0fceaf1cae8722084332ed1e32496291d42', // miljan
        '460c25e682fda7832b52d1f22d3d22b3176d972f60dcdc3212ed8c92ef85065c', // Vitor
        '1577e4599dd10c863498fe3c20bd82aafaf829a595ce83c5cf8ac3463531b09b', // yegorpetrov
        'c48e29f04b482cc01ca1f9ef8c86ef8318c059e0e9353235162f080f26e14c11', // Walker
        '7fa56f5d6962ab1e3cd424e758c3002b8665f7b0d8dcee9fe9e288d7751ac194', // verbiricha
      ];

      // Wait for account relay to be ready before fetching content
      // Account relay is required since discovery relay only handles relay lists (kind 10002/3)
      let accountRelayInitialized = this.accountRelay.isInitialized();
      this.logger.debug(`⚡ [For You] Account relay initialized: ${accountRelayInitialized}`);

      if (!accountRelayInitialized) {
        this.logger.debug('⚡ [For You] Waiting for account relay to initialize...');

        // Wait up to 5 seconds for account relay to be ready
        const MAX_WAIT_MS = 5000;
        const POLL_INTERVAL_MS = 100;
        let waitedMs = 0;

        while (!this.accountRelay.isInitialized() && waitedMs < MAX_WAIT_MS) {
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
          waitedMs += POLL_INTERVAL_MS;
        }

        accountRelayInitialized = this.accountRelay.isInitialized();
        this.logger.debug(`⚡ [For You] After waiting ${waitedMs}ms, account relay initialized: ${accountRelayInitialized}`);
      }

      if (!accountRelayInitialized) {
        this.logger.debug('⚡ [For You] Account relay not ready after waiting, cannot fetch content');
        this.logger.warn('Account relay not ready, cannot load For You feed');
        return;
      }

      // Build pubkey list: fallback popular + following
      const immediatePubkeys = new Set<string>(FALLBACK_POPULAR_PUBKEYS);

      // Add following list (limit to 20 most recent)
      const followingList = this.accountState.followingList();
      const limitedFollowing = followingList.slice(-20);
      limitedFollowing.forEach(pubkey => immediatePubkeys.add(pubkey));

      this.logger.debug(`⚡ [For You] Fetching with ${immediatePubkeys.size} pubkeys (${FALLBACK_POPULAR_PUBKEYS.length} fallback + ${limitedFollowing.length} following)`);
      this.logger.info(`⚡ [For You] Fetching with ${immediatePubkeys.size} pubkeys (${FALLBACK_POPULAR_PUBKEYS.length} fallback + ${limitedFollowing.length} following)`);

      const immediatePubkeysArray = Array.from(immediatePubkeys);
      await this.fetchEventsFromUsersFast(immediatePubkeysArray, feedData);

      this.logger.debug(`⚡ [For You] Events after fetch: ${feedData.events().length}`);

      // PHASE 1: Background enhancement - add starter pack users and algorithm recommendations
      // This runs in background and doesn't block the UI
      this.enhanceForYouFeedInBackground(feedData, isArticlesFeed ?? false);

      this.logger.debug(`Loaded For You feed with initial ${immediatePubkeysArray.length} users`);
      this.logger.debug('🏁 [For You] loadForYouFeed COMPLETED');
    } catch (error) {
      this.logger.error('❌ [For You] loadForYouFeed ERROR:', error);
      this.logger.error('Error loading For You feed:', error);
    }
  }

  /**
   * Background enhancement of For You feed - adds starter pack users and algorithm recommendations
   * Runs after initial content is shown to add more diverse content
   */
  private async enhanceForYouFeedInBackground(feedData: FeedItem, isArticlesFeed: boolean) {
    this.logger.debug('🔄 [For You Background] Starting enhancement...');

    // Wait for account relay to be ready (but don't block UI)
    const MAX_WAIT_MS = 5000;
    const POLL_INTERVAL_MS = 200;
    let waitedMs = 0;

    while (!this.accountRelay.isInitialized() && waitedMs < MAX_WAIT_MS) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      waitedMs += POLL_INTERVAL_MS;
    }

    this.logger.debug(`🔄 [For You Background] Waited ${waitedMs}ms for account relay`);

    if (!this.accountRelay.isInitialized()) {
      this.logger.debug('🔄 [For You Background] Account relay not ready, skipping');
      this.logger.warn('Account relay not ready for background enhancement, skipping');
      return;
    }

    this.logger.debug('🔄 [For You Background] Account relay ready, fetching additional content...');

    try {
      const additionalPubkeys = new Set<string>();

      // Add algorithm-recommended users
      const topEngagedUsers = isArticlesFeed
        ? await this.algorithms.getRecommendedUsersForArticles(10)
        : await this.algorithms.getRecommendedUsers(5);

      topEngagedUsers.forEach(user => additionalPubkeys.add(user.pubkey));
      this.logger.debug(`🔄 [For You Background] Added ${topEngagedUsers.length} algorithm-recommended users`);
      this.logger.debug(`[Background] Added ${topEngagedUsers.length} algorithm-recommended users`);

      // Fetch starter packs in background (with very short timeout)
      try {
        this.logger.debug('🔄 [For You Background] Fetching starter packs...');
        const starterPackPromise = this.followset.fetchStarterPacks('popular');
        const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
        const result = await Promise.race([starterPackPromise, timeoutPromise]);

        if (result && Array.isArray(result)) {
          const popularPack = result.find(pack => pack.dTag === 'popular');
          if (popularPack) {
            popularPack.pubkeys.slice(0, 10).forEach(pubkey => additionalPubkeys.add(pubkey));
            this.logger.debug(`🔄 [For You Background] Added ${Math.min(10, popularPack.pubkeys.length)} starter pack users`);
            this.logger.debug(`[Background] Added ${Math.min(10, popularPack.pubkeys.length)} starter pack users`);
          }
        } else {
          this.logger.debug('🔄 [For You Background] No starter pack result or timed out');
        }
      } catch (error) {
        this.logger.debug('🔄 [For You Background] Starter pack fetch failed:', error);
        this.logger.debug('[Background] Starter pack fetch failed, continuing without');
      }

      this.logger.debug(`🔄 [For You Background] Total additional pubkeys: ${additionalPubkeys.size}`);

      if (additionalPubkeys.size > 0) {
        const pubkeysArray = Array.from(additionalPubkeys);
        this.logger.debug(`🔄 [For You Background] Fetching events from ${pubkeysArray.length} additional users...`);
        // Use fast fetch instead of slow outbox model for better performance
        await this.fetchEventsFromUsersFast(pubkeysArray, feedData);
        this.logger.debug(`🔄 [For You Background] Completed, total events: ${feedData.events().length}`);
      } else {
        this.logger.debug('🔄 [For You Background] No additional pubkeys to fetch');
      }
    } catch (error) {
      this.logger.error('🔄 [For You Background] Error:', error);
      this.logger.error('Error in background enhancement:', error);
    }
  }

  /**
   * PHASE 1: Fast batch fetch using account's already-connected relays
   * This gets content on screen quickly without per-user relay discovery
   * 
   * NOTE: Relays typically limit author filters to 10-50 pubkeys.
   * We batch requests to stay within limits while maximizing parallelism.
   */
  private async fetchEventsFromUsersFast(pubkeys: string[], feedData: FeedItem) {
    const isArticlesFeed = feedData.filter?.kinds?.includes(30023);
    const BATCH_SIZE = 10; // Most relays accept 10 authors per query
    const TIMEOUT_MS = 2000; // Short timeout for fast initial content
    const MAX_CONCURRENT_BATCHES = 2; // Limit concurrent requests to avoid relay rate limits
    const DELAY_BETWEEN_BATCHES_MS = 100; // Small delay to prevent "too fast" errors

    try {
      this.logger.debug(`⚡ [Fast Fetch] Starting batched fetch for ${pubkeys.length} authors (${Math.ceil(pubkeys.length / BATCH_SIZE)} batches)`);

      // Split pubkeys into batches to respect relay limits
      const batches: string[][] = [];
      for (let i = 0; i < pubkeys.length; i += BATCH_SIZE) {
        batches.push(pubkeys.slice(i, i + BATCH_SIZE));
      }

      // Only use 'since' if we have existing events
      const existingEvents = feedData.events();
      const useSince = feedData.feed.lastRetrieved && existingEvents.length > 0;

      // Process batches with limited concurrency to avoid overwhelming relays
      const allEvents: Event[] = [];

      for (let i = 0; i < batches.length; i += MAX_CONCURRENT_BATCHES) {
        const currentBatches = batches.slice(i, i + MAX_CONCURRENT_BATCHES);

        const batchPromises = currentBatches.map(async (batchPubkeys, localIndex) => {
          const batchIndex = i + localIndex;
          const filter: {
            kinds?: number[];
            authors: string[];
            limit: number;
            since?: number;
          } = {
            authors: batchPubkeys,
            kinds: feedData.filter?.kinds,
            limit: isArticlesFeed ? 10 : 5, // Limit per batch
          };

          if (useSince) {
            filter.since = feedData.feed.lastRetrieved;
          }

          try {
            const events = await this.accountRelay.getMany<Event>(filter, { timeout: TIMEOUT_MS });
            this.logger.debug(`⚡ [Fast Fetch] Batch ${batchIndex + 1}/${batches.length}: got ${events.length} events`);
            return events;
          } catch (error) {
            this.logger.debug(`⚡ [Fast Fetch] Batch ${batchIndex + 1} failed:`, error);
            return [];
          }
        });

        const results = await Promise.all(batchPromises);
        allEvents.push(...results.flat());

        // Add delay between batch groups to avoid rate limiting
        if (i + MAX_CONCURRENT_BATCHES < batches.length) {
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
        }
      }

      const events = allEvents;

      if (events.length > 0) {
        this.logger.debug(`⚡ [Fast Fetch] Got ${events.length} total events from ${batches.length} batches`);
        this.logger.info(`[Fast Fetch] Got ${events.length} events from account relays`);

        // Filter and add events to feed
        const allowedKinds = new Set(feedData.feed.kinds);
        const validEvents = events.filter(
          event => !this.accountState.muted(event) && allowedKinds.has(event.kind)
        );

        if (validEvents.length > 0) {
          // Add events to the feed directly since this is initial load
          feedData.events.update((currentEvents: Event[]) => {
            const existingIds = new Set(currentEvents.map(e => e.id));
            const newEvents = validEvents.filter(e => !existingIds.has(e.id));
            const combined = [...currentEvents, ...newEvents];
            const sorted = combined.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
            return sorted;
          });

          // Signal that initial content is ready - this unblocks profile loading
          this.logger.debug(`✅ [Fast Fetch] Feed has ${validEvents.length} events - signaling content ready`);
          this._hasInitialContent.set(true);
          this.appState.feedHasInitialContent.set(true); // Signal via shared state

          // Save to cache
          this.saveCachedEvents(feedData.feed.id, feedData.events());

          // Save events to database for queries
          validEvents.forEach(event => this.saveEventToDatabase(event));
        }
      } else {
        this.logger.debug(`⚠️ [Fast Fetch] No events received from any batch`);
      }

      // Mark initial load as complete so new events get queued
      feedData.initialLoadComplete = true;
      feedData.isRefreshing?.set(false);
      this.updateColumnLastRetrieved(feedData.feed.id);
      this.logger.info(`✅ Initial load complete for column ${feedData.feed.id} - new events will be queued`);

    } catch (error) {
      this.logger.error('[Fast Fetch] Error in fast batch fetch:', error);
      // Fall through - the background fetch will still run
      feedData.initialLoadComplete = true;
      feedData.isRefreshing?.set(false);
    }
  }

  /**
   * PHASE 2: Background fetch using outbox model for more complete data
   * Runs after fast fetch completes, adds more events to pending queue
   */
  private fetchEventsFromUsersBackground(pubkeys: string[], feedData: FeedItem) {
    // Use requestIdleCallback to defer this work
    const performBackgroundFetch = async () => {
      try {
        this.logger.debug(`[Background Fetch] Starting outbox model fetch for ${pubkeys.length} users`);

        // Fetch events using the slower but more complete outbox model
        await this.fetchEventsFromUsers(pubkeys, feedData);

        this.logger.debug(`[Background Fetch] Completed for ${pubkeys.length} users`);
      } catch (error) {
        this.logger.error('[Background Fetch] Error:', error);
      }
    };

    // Schedule background fetch with low priority
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => performBackgroundFetch(), { timeout: 10000 });
    } else {
      // Fallback: run after a short delay
      setTimeout(performBackgroundFetch, 1000);
    }
  }

  /**
   * Fetch events from a list of users using the outbox model
   * Updates UI incrementally as events are received for better UX
   */
  private async fetchEventsFromUsers(pubkeys: string[], feedData: FeedItem) {
    const isArticlesFeed = feedData.filter?.kinds?.includes(30023);
    // Increase limit for better initial load experience, especially for custom feeds
    const eventsPerUser = isArticlesFeed ? 10 : 20;

    this.logger.info(`[fetchEventsFromUsers] 🔍 Fetching ${eventsPerUser} events per user from ${pubkeys.length} users`);

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
        // IMPORTANT: Only use lastRetrieved if we have existing events to display AND
        // if the feed has been retrieved before (lastRetrieved exists).
        // For new/first-time loads, DO NOT use 'since' to ensure we get historical events.
        const existingEvents = feedData.events();
        const hasExistingContent = existingEvents.length > 0;
        const isRefresh = feedData.feed.lastRetrieved && hasExistingContent;

        // Only add 'since' filter if this is a refresh with existing content
        // For initial loads (no lastRetrieved or no existing events), fetch historical data
        if (isRefresh) {
          filterConfig.since = feedData.feed.lastRetrieved;
          this.logger.info(`[fetchEventsFromUsers] 📅 Using since=${filterConfig.since} for user ${pubkey.slice(0, 8)}`);
        } else {
          this.logger.info(`[fetchEventsFromUsers] 📜 Fetching historical events for user ${pubkey.slice(0, 8)} (no since filter)`);
        }

        this.logger.info(`[fetchEventsFromUsers] 🔧 Filter for ${pubkey.slice(0, 8)}: ${JSON.stringify(filterConfig)}`);

        const events = await this.sharedRelayEx.getMany(
          pubkey,
          filterConfig,
          { timeout: 2500 }
        );

        this.logger.info(`[fetchEventsFromUsers] ✅ Found ${events.length} events for user ${pubkey.slice(0, 8)}`);

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

    this.logger.info(`[fetchEventsFromUsers] 🏁 Completed fetching from ${pubkeys.length} users. Total events: ${Array.from(userEventsMap.values()).reduce((sum, events) => sum + events.length, 0)}`);

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
    // Aggregate current events from the user events map
    const aggregatedEvents = this.aggregateAndSortEvents(userEventsMap);

    // Get allowed kinds for this column and filter events
    const allowedKinds = new Set(feedData.feed.kinds);
    const newEvents = aggregatedEvents.filter(
      event => !this.accountState.muted(event) && allowedKinds.has(event.kind)
    );

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

          // Trigger reactivity update so pending count is recalculated in UI
          this._feedData.update(map => new Map(map));

          this.logger.debug(
            `Incremental update: ${processedUsers}/${totalUsers} users processed, ${trulyNewEvents.length} events queued to pending`
          );
        }
      } else {
        // Initial load not complete OR no existing events - merge events directly
        const mergedEvents = this.mergeEvents(existingEvents, newEvents);

        // Update the feed with merged events
        feedData.events.set(mergedEvents);

        // Trigger reactivity update for components
        this._feedData.update(map => new Map(map));

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
    // Final aggregation of events
    const aggregatedEvents = this.aggregateAndSortEvents(userEventsMap);

    // Get allowed kinds for this column and filter events
    const allowedKinds = new Set(feedData.feed.kinds);
    const newEvents = aggregatedEvents.filter(
      event => !this.accountState.muted(event) && allowedKinds.has(event.kind)
    );

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

          // Trigger reactivity update so pending count is recalculated in UI
          this._feedData.update(map => new Map(map));

          // Save pending events to cache as well for persistence
          const allEventsForCache = [...existingEvents, ...trulyNewEvents];
          this.saveCachedEvents(feedData.feed.id, allEventsForCache);

          this.logger.debug(
            `Final update: ${trulyNewEvents.length} events queued to pending (${existingEvents.length} cached events preserved)`
          );
        }
      } else {
        // Initial load not complete OR no existing events - merge events directly
        const mergedEvents = this.mergeEvents(existingEvents, newEvents);

        // Update feed data with merged events
        feedData.events.set(mergedEvents);

        // Trigger reactivity update for components
        this._feedData.update(map => new Map(map));

        // Save to cache after final update
        this.saveCachedEvents(feedData.feed.id, mergedEvents);

        // Update last timestamp for pagination
        feedData.lastTimestamp = Math.min(...mergedEvents.map((e: Event) => (e.created_at || 0) * 1000));

        this.logger.debug(
          `Final update: ${mergedEvents.length} total events (${newEvents.length} new from ${userEventsMap.size} users)`
        );
      }

      // Update lastRetrieved timestamp (current time in seconds) and save to localStorage
      this.updateColumnLastRetrieved(feedData.feed.id);
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
    this.logger.info(`✅ Initial load complete for column ${feedData.feed.id} - new events will be queued`);
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
   * 
   * For 'following' feeds, uses TIME-WINDOW based pagination (6-hour windows).
   * This ensures we get ALL events without gaps caused by users who post at different frequencies.
   */
  async loadMoreEvents(columnId: string) {
    this.logger.debug('[FeedService] loadMoreEvents called for column:', columnId);

    const feedData = this.data.get(columnId);
    if (!feedData || !feedData.isLoadingMore || !feedData.hasMore) {
      this.logger.warn(`Cannot load more events for column ${columnId}: feedData not found or missing loading states`);
      return;
    }

    // Prevent multiple simultaneous loads
    if (feedData.isLoadingMore() || !feedData.hasMore()) {
      this.logger.debug(`[FeedService] Skipping load more: isLoading=${feedData.isLoadingMore()}, hasMore=${feedData.hasMore()}`);
      this.logger.debug(`Skipping load more for column ${columnId}: already loading or no more data`);
      return;
    }

    this.logger.debug('[FeedService] Starting pagination load...');
    feedData.isLoadingMore.set(true);

    try {
      const feed = feedData.feed;

      if (feed.source === 'following') {
        // For following feeds, use TIME-WINDOW based pagination (6-hour windows)
        // This is more efficient and avoids gaps from users with different posting frequencies
        const hasMore = await this.loadMoreFollowingEvents(feedData);
        if (!hasMore) {
          feedData.hasMore.set(false);
        }
      } else if (feed.source === 'for-you') {
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
      } else if (feed.source === 'custom') {
        // For custom feeds, collect the same pubkeys used in initial load
        const allPubkeys = new Set<string>();

        // Add custom users pubkeys
        if (feed.customUsers && feed.customUsers.length > 0) {
          feed.customUsers.forEach(pubkey => allPubkeys.add(pubkey));
        }

        // Add pubkeys from starter packs
        if (feed.customStarterPacks && feed.customStarterPacks.length > 0) {
          try {
            const allStarterPacks = await this.followset.fetchStarterPacks();
            const selectedPacks = allStarterPacks.filter(pack =>
              feed.customStarterPacks?.includes(pack.dTag)
            );
            selectedPacks.forEach(pack => {
              pack.pubkeys.forEach(pubkey => allPubkeys.add(pubkey));
            });
          } catch (error) {
            this.logger.error('Error fetching starter pack data for pagination:', error);
          }
        }

        // Add pubkeys from follow sets (kind 30000)
        if (feed.customFollowSets && feed.customFollowSets.length > 0) {
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

                  if (dTag && feed.customFollowSets.includes(dTag)) {
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
    const eventsPerUser = 10; // Increased for better pagination experience

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

  /**
   * Unsubscribe from a single feed
   */
  private unsubscribeFromFeed(feedId: string): void {
    // Delegate to unsubscribeFromColumn (same implementation)
    this.unsubscribeFromColumn(feedId);
  }

  /**
   * Refresh a feed by unsubscribing and resubscribing
   * @param clearHistory If true, clears the lastRetrieved timestamp to force fetching historical events
   */
  async refreshFeed(feedId: string, clearHistory = false): Promise<void> {
    const feed = this.getFeedById(feedId);
    if (!feed) {
      this.logger.warn(`Cannot refresh feed ${feedId}: feed not found`);
      return;
    }

    this.logger.info(`Refreshing feed: ${feed.label} (${feedId}), clearHistory: ${clearHistory}`);

    // Clear lastRetrieved timestamp if requested - this forces a full historical fetch
    if (clearHistory) {
      this.logger.info(`Clearing lastRetrieved timestamp for feed ${feedId} to force historical fetch`);
      await this.updateFeed(feedId, { lastRetrieved: undefined });

      // Also clear cached events to start fresh
      const feedData = this.data.get(feedId);
      if (feedData) {
        feedData.events.set([]);
        feedData.pendingEvents?.set([]);
      }
    }

    // Unsubscribe from the feed
    this.unsubscribeFromFeed(feedId);

    // Resubscribe to the feed
    await this.subscribeToFeed(feed);

    this.logger.info(`Feed refreshed: ${feed.label}`);
  }

  /**
   * Update the active feed's subscription when content filter kinds change.
   * This refreshes the feed to fetch events matching the new filter kinds.
   * Called when user changes the content filter (e.g., switches from "Photos only" to "All posts").
   * 
   * @param newKinds The new kinds from the content filter
   */
  async updateActiveSubscriptionKinds(newKinds: number[]): Promise<void> {
    const activeFeedId = this._activeFeedId();
    if (!activeFeedId) {
      this.logger.debug('No active feed to update subscription kinds');
      return;
    }

    const feed = this.getFeedById(activeFeedId);
    if (!feed) {
      this.logger.warn(`Cannot update subscription kinds: feed ${activeFeedId} not found`);
      return;
    }

    // Skip for trending feeds - they use external API and don't use kinds
    if (feed.source === 'trending') {
      this.logger.debug('Skipping subscription update for trending feed');
      return;
    }

    const feedData = this.data.get(activeFeedId);
    if (!feedData) {
      this.logger.debug('No feed data found, will subscribe with new kinds on next activation');
      return;
    }

    // Check if the kinds have actually changed from what we're currently fetching
    const currentKinds = feedData.filter?.kinds || feed.kinds || [1];
    const kindsChanged = JSON.stringify([...currentKinds].sort()) !== JSON.stringify([...newKinds].sort());

    if (!kindsChanged) {
      this.logger.debug('Content filter kinds unchanged, skipping resubscription');
      return;
    }

    this.logger.info(`Content filter kinds changed for feed ${feed.label}: ${currentKinds.join(',')} -> ${newKinds.join(',')}`);

    // Update the feed's filter to use the new kinds
    // We temporarily override the feed's kinds with the content filter kinds
    feedData.filter = {
      ...feedData.filter,
      kinds: newKinds,
      limit: feedData.filter?.limit || 60,
    };

    // Clear existing events since they may not match the new filter
    const existingEvents = feedData.events();
    if (existingEvents.length > 0) {
      this.logger.debug(`Clearing ${existingEvents.length} existing events for re-fetch with new kinds`);
      feedData.events.set([]);
    }

    // For following/for-you feeds, clear the FollowingDataService cache
    // This forces a fresh fetch with the new kinds instead of returning stale cached data
    if (feed.source === 'following' || feed.source === 'for-you') {
      this.logger.debug('Clearing FollowingDataService cache to force re-fetch with new kinds');
      this.followingData.clearCache();
    }

    // Unsubscribe from current subscription
    this.unsubscribeFromFeed(activeFeedId);

    // Create a temporary feed config with the new kinds for subscription
    const feedWithNewKinds: FeedConfig = {
      ...feed,
      kinds: newKinds,
    };

    // Resubscribe with new kinds
    await this.subscribeToFeed(feedWithNewKinds);

    this.logger.info(`Feed ${feed.label} resubscribed with new content filter kinds`);
  }

  // Helper method to get events for a specific feed
  getEventsForFeed(feedId: string): Signal<Event[]> {
    const feedData = this.data.get(feedId);
    if (!feedData) {
      return signal<Event[]>([]);
    }

    return feedData.events;
  }

  // Helper method to get events for a specific feed (alias for backward compatibility)
  getEventsForColumn(feedId: string): Signal<Event[]> | undefined {
    return this.data.get(feedId)?.events;
  }

  // Helper methods to get loading states for columns
  getColumnLoadingState(columnId: string): Signal<boolean> | undefined {
    return this.data.get(columnId)?.isLoadingMore;
  }

  getColumnRefreshingState(columnId: string): Signal<boolean> | undefined {
    return this.data.get(columnId)?.isRefreshing;
  }

  getColumnCheckingState(columnId: string): Signal<boolean> | undefined {
    return this.data.get(columnId)?.isCheckingForNewEvents;
  }

  getColumnHasMore(columnId: string): Signal<boolean> | undefined {
    return this.data.get(columnId)?.hasMore;
  }

  /**
   * Check if initial load is complete for a column
   * Used to distinguish between "still loading" and "no results"
   */
  getColumnInitialLoadComplete(columnId: string): boolean {
    return this.data.get(columnId)?.initialLoadComplete ?? false;
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
   * Check for new events across all active feeds
   */
  private async checkForNewEvents(): Promise<void> {
    // Skip if feeds page is not active
    if (!this._feedsPageActive()) {
      return;
    }

    const activeFeedId = this._activeFeedId();
    if (!activeFeedId) return;

    const feedData = this.data.get(activeFeedId);
    if (!feedData || !feedData.lastCheckTimestamp) return;

    // Skip if initial load hasn't completed yet (feed is still loading)
    if (!feedData.initialLoadComplete) return;

    // Set checking state for UI indicator
    feedData.isCheckingForNewEvents?.set(true);
    this._feedData.update(map => new Map(map));

    try {
      await this.checkColumnForNewEvents(activeFeedId);
    } finally {
      feedData.isCheckingForNewEvents?.set(false);
      this._feedData.update(map => new Map(map));
    }
  }

  /**
   * Check a specific column for new events
   */
  private async checkColumnForNewEvents(columnId: string): Promise<void> {
    const feedData = this.data.get(columnId);
    if (!feedData || !feedData.pendingEvents || !feedData.lastCheckTimestamp) return;

    const feed = feedData.feed;
    const currentTime = Math.floor(Date.now() / 1000);

    // Get events newer than the last check timestamp
    let newEvents: Event[] = [];
    const sinceTimestamp = feedData.lastCheckTimestamp;

    if (feed.source === 'following') {
      newEvents = await this.fetchNewEventsForFollowing(feedData, sinceTimestamp);
    } else if (feed.source === 'custom') {
      newEvents = await this.fetchNewEventsForCustom(feedData, sinceTimestamp);
    } else if (feed.source === 'for-you') {
      newEvents = await this.fetchNewEventsForFollowing(feedData, sinceTimestamp);
    } else {
      // Public feed - use standard filter with since parameter
      newEvents = await this.fetchNewEventsStandard(feedData, sinceTimestamp);
    }

    // Update pending events if we found any new ones
    if (newEvents.length > 0) {
      // Filter out events already displayed in the feed
      const existingIds = new Set(feedData.events().map(e => e.id));
      const filteredNewEvents = newEvents.filter(e => !existingIds.has(e.id) && !this.accountState.muted(e));

      if (filteredNewEvents.length > 0) {
        const currentPending = feedData.pendingEvents() || [];
        const allPending = [...filteredNewEvents, ...currentPending];

        // Remove duplicates and sort by created_at descending
        const uniquePending = Array.from(
          new Map(allPending.map(event => [event.id, event])).values()
        ).sort((a, b) => b.created_at - a.created_at);

        feedData.pendingEvents.set(uniquePending);

        // Update reactive signal
        this._feedData.update(map => new Map(map));

        this.logger.debug(`Found ${filteredNewEvents.length} new events for column ${columnId}`);
      }
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
    const feed = feedData.feed;
    const allPubkeys = new Set<string>();

    // Add custom users
    if (feed.customUsers) {
      feed.customUsers.forEach(pubkey => allPubkeys.add(pubkey));
    }

    // Add pubkeys from starter packs
    if (feed.customStarterPacks && feed.customStarterPacks.length > 0) {
      try {
        const allStarterPacks = await this.followset.fetchStarterPacks();
        const selectedPacks = allStarterPacks.filter(pack =>
          feed.customStarterPacks?.includes(pack.dTag)
        );
        selectedPacks.forEach(pack => {
          pack.pubkeys.forEach(pubkey => allPubkeys.add(pubkey));
        });
      } catch (error) {
        this.logger.error('Error fetching starter pack data for new events:', error);
      }
    }

    // Add pubkeys from follow sets (kind 30000)
    if (feed.customFollowSets && feed.customFollowSets.length > 0) {
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

              if (dTag && feed.customFollowSets.includes(dTag)) {
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
    const feed = feedData.feed;

    // Fetch latest events from each user since the last check
    const fetchPromises = pubkeys.map(async pubkey => {
      try {
        const events = await this.sharedRelayEx.getMany(
          pubkey,
          {
            authors: [pubkey],
            kinds: feed.kinds,
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

    // Prefetch profiles for pending events before displaying
    this.prefetchProfilesForEvents(pending);

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
   * The getFeedsFromStorage() helper ensures that:
   * - Default feeds are only created for truly new users (when it returns null)
   * - Login method changes (browser extension, nsec, etc.) don't trigger resets
   * - Intentional feed deletions are respected (empty array is treated as valid)
   * - Feed configurations persist across sessions
   */
  /**
   * Migrate legacy feeds to new structure
   * - If feed has a columns array, convert each column into a separate feed
   * - If feed lacks required properties, set defaults
   * Returns an array of feeds (usually 1, but multiple if columns existed)
   */
  private migrateLegacyFeed(feed: any): FeedConfig[] {
    // Check if this is an old feed with columns array
    if (feed.columns && Array.isArray(feed.columns) && feed.columns.length > 0) {
      this.logger.info(
        `🔄 Migrating legacy feed "${feed.label}" (${feed.id}) with ${feed.columns.length} column(s) to separate feed(s).`
      );

      // Convert each column into a separate feed
      const migratedFeeds: FeedConfig[] = feed.columns.map((column: any, index: number) => {
        // Generate a new feed ID for each column (except use original feed ID for first column)
        const feedId = index === 0 ? feed.id : `${feed.id}-column-${index + 1}`;

        // Generate a label - use column label if it exists, otherwise auto-generate
        let feedLabel: string;
        if (column.label && column.label.trim()) {
          feedLabel = column.label;
        } else if (index === 0 && feed.label) {
          feedLabel = feed.label;
        } else {
          // Auto-generate a label based on type
          const typeName = column.type ? COLUMN_TYPES[column.type as keyof typeof COLUMN_TYPES]?.label : 'Feed';
          feedLabel = `${feed.label} - ${typeName || 'Column ' + (index + 1)}`;
        }

        // Create new feed from column properties
        const migratedFeed: FeedConfig = {
          id: feedId,
          label: feedLabel,
          icon: feed.icon || column.icon || 'dynamic_feed',
          type: column.type || 'notes',
          kinds: column.kinds || [1, 6],
          source: column.source || 'public',
          relayConfig: column.relayConfig ?? 'account',
          customUsers: column.customUsers,
          customStarterPacks: column.customStarterPacks,
          customFollowSets: column.customFollowSets,
          searchQuery: column.searchQuery,
          customRelays: column.customRelays,
          filters: column.filters,
          showReplies: column.showReplies,
          showReposts: column.showReposts,
          createdAt: feed.createdAt || Date.now(),
          updatedAt: Date.now(),
          lastRetrieved: column.lastRetrieved,
          isSystem: feed.isSystem,
        };

        this.logger.info(
          `   ✅ Column ${index + 1}: "${column.label || 'Unnamed'}" → Feed "${feedLabel}" (${feedId})`
        );

        return migratedFeed;
      });

      if (feed.columns.length > 1) {
        this.logger.info(
          `✅ Migration complete: Created ${migratedFeeds.length} separate feeds from "${feed.label}"`
        );
      }

      return migratedFeeds;
    }

    // No columns array - check if feed has required properties
    if (feed.type && feed.kinds && feed.relayConfig !== undefined) {
      return [feed as FeedConfig];
    }

    // If feed lacks required properties, set defaults
    this.logger.warn(
      `Feed "${feed.label}" (${feed.id}) is missing required properties. Setting defaults.`
    );

    const migratedFeed: FeedConfig = {
      ...feed,
      type: feed.type || 'notes',
      kinds: feed.kinds || [1, 6], // Default to notes and reposts
      source: feed.source || 'public',
      relayConfig: feed.relayConfig ?? 'account',
      updatedAt: Date.now(),
    };

    return [migratedFeed];
  }

  private async loadFeeds(pubkey: string): Promise<void> {
    try {
      const storedFeeds = this.getFeedsFromStorage(pubkey);

      // Check if we have synced feeds from kind 30078 settings
      // This takes priority for cross-device sync scenarios
      const syncedFeeds = this.settingsService.getSyncedFeeds();
      const hasSyncedFeeds = syncedFeeds && syncedFeeds.length > 0;

      // If storedFeeds is null, this user has never had feeds before on this device
      if (storedFeeds === null) {
        // Check if there are synced feeds from another device
        if (hasSyncedFeeds) {
          this.logger.info(`Found ${syncedFeeds.length} synced feeds from settings, using those`);
          const feedsFromSync = this.convertSyncedFeedsToFeedConfig(syncedFeeds);
          this._feeds.set(feedsFromSync);
          this._feedsLoaded.set(true);
          // Save to local storage for faster loading next time
          this.saveFeeds();
        } else {
          this.logger.info('No feeds found for pubkey, initializing default feeds for pubkey', pubkey);
          const defaultFeeds = await this.initializeDefaultFeeds();
          this._feeds.set(defaultFeeds);
          this._feedsLoaded.set(true);
          this.saveFeeds();
        }
      } else {
        // storedFeeds exists (could be empty array if user deleted all feeds)
        // Use whatever is stored, even if it's an empty array
        // Filter out any Trending feed that may have been stored previously
        // (Trending is now always appended dynamically via the feeds computed signal)
        const filteredFeeds = storedFeeds.filter(f => f.id !== TRENDING_FEED_ID);

        // Check if synced feeds are newer than local feeds
        // Compare by checking if synced has feeds that local doesn't, or vice versa
        if (hasSyncedFeeds) {
          const syncedFeedsUpdatedAt = Math.max(...syncedFeeds.map(f => f.updatedAt || 0));
          const localFeedsUpdatedAt = Math.max(...filteredFeeds.map(f => f.updatedAt || 0), 0);

          if (syncedFeedsUpdatedAt > localFeedsUpdatedAt) {
            this.logger.info(`Synced feeds are newer (${syncedFeedsUpdatedAt} > ${localFeedsUpdatedAt}), using synced feeds`);
            const feedsFromSync = this.convertSyncedFeedsToFeedConfig(syncedFeeds);
            this._feeds.set(feedsFromSync);
            this._feedsLoaded.set(true);
            // Save to local storage for faster loading next time
            this.saveFeeds();
            this.logger.debug('Loaded feeds from synced settings for pubkey', pubkey, feedsFromSync);

            // Only subscribe if there's an active account
            if (this.accountState.account()) {
              await this.subscribe();
            }
            return;
          }
        }

        // Migrate any legacy column-based feeds
        const feedsBeforeMigration = filteredFeeds.length;
        let migrationOccurred = false;

        // Migration can return multiple feeds per legacy feed (if it had columns)
        const migratedFeeds: FeedConfig[] = [];
        filteredFeeds.forEach(feed => {
          const result = this.migrateLegacyFeed(feed);
          // Migration returns an array - it could be 1 feed or multiple
          if (result.length !== 1 || result[0] !== feed) {
            migrationOccurred = true;
          }
          migratedFeeds.push(...result);
        });

        this._feeds.set(migratedFeeds);
        this._feedsLoaded.set(true);

        // If migration occurred, save the migrated feeds back to storage
        if (migrationOccurred) {
          const feedsAfterMigration = migratedFeeds.length;
          this.logger.info(
            `✅ Migration completed: ${feedsBeforeMigration} feed(s) migrated to ${feedsAfterMigration} feed(s). Saving to storage.`
          );
          this.saveFeeds();
        }

        this.logger.debug('Loaded feeds from storage for pubkey', pubkey, migratedFeeds);
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
   * Convert synced feed configs to full FeedConfig objects.
   * Adds runtime properties that aren't synced (lastRetrieved, etc.)
   */
  private convertSyncedFeedsToFeedConfig(syncedFeeds: SyncedFeedConfig[]): FeedConfig[] {
    return syncedFeeds.map(synced => ({
      ...synced,
      // Runtime properties not stored in sync
      lastRetrieved: undefined,
    }));
  }

  /**
   * Convert FeedConfig to SyncedFeedConfig for storage.
   * Strips runtime/cache properties that shouldn't be synced.
   */
  private convertFeedConfigToSynced(feed: FeedConfig): SyncedFeedConfig {
    return {
      id: feed.id,
      label: feed.label,
      icon: feed.icon,
      type: feed.type,
      kinds: feed.kinds,
      source: feed.source,
      customUsers: feed.customUsers,
      customStarterPacks: feed.customStarterPacks,
      customFollowSets: feed.customFollowSets,
      customInterestHashtags: feed.customInterestHashtags,
      searchQuery: feed.searchQuery,
      relayConfig: feed.relayConfig,
      customRelays: feed.customRelays,
      filters: feed.filters,
      showReplies: feed.showReplies,
      showReposts: feed.showReposts,
      createdAt: feed.createdAt,
      updatedAt: feed.updatedAt,
      isSystem: feed.isSystem,
    };
  }

  /**
   * Initialize default feeds with starter pack data
   * 
   * OPTIMIZATION: For first-time users, return default feeds IMMEDIATELY
   * and fetch starter packs in the background to populate them later.
   * This ensures feeds load instantly while starter packs are fetched async.
   */
  private async initializeDefaultFeeds(): Promise<FeedConfig[]> {
    // Clone default feeds FIRST to return immediately
    const feeds = JSON.parse(JSON.stringify(DEFAULT_FEEDS)) as FeedConfig[];

    // Start fetching starter packs in the BACKGROUND (don't await)
    // This allows the feed to load instantly while starter packs are being fetched
    this.populateStarterPacksInBackground(feeds);

    return feeds;
  }

  /**
   * Populate starter packs into feeds in the background
   * Updates the feed configuration once starter packs are loaded
   */
  private async populateStarterPacksInBackground(feeds: FeedConfig[]): Promise<void> {
    try {
      // Small delay to let the feed UI render first
      await new Promise(resolve => setTimeout(resolve, 100));

      const starterPacks = await this.followset.fetchStarterPacks();

      // Find the starter feed and populate it with the first available starter pack
      const starterFeed = feeds.find(f => f.id === 'default-feed-starter');

      if (starterFeed && starterPacks.length > 0) {
        // Use the first starter pack's dTag directly on the feed
        starterFeed.customStarterPacks = [starterPacks[0].dTag];
        this.logger.info('Populated starter feed with starter pack:', starterPacks[0].dTag);

        // Update feeds signal with the updated configuration
        this._feeds.update(currentFeeds => {
          const updatedFeeds = [...currentFeeds];
          const index = updatedFeeds.findIndex(f => f.id === 'default-feed-starter');
          if (index !== -1) {
            updatedFeeds[index] = { ...starterFeed };
          }
          return updatedFeeds;
        });

        // Save the updated feeds
        this.saveFeeds();
      }
    } catch (error) {
      this.logger.warn('Background starter pack population failed:', error);
      // Non-critical - feeds will work without starter packs
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

      // Filter out the Trending feed - it's always appended dynamically, never persisted
      const feedsToSave = this._feeds().filter(f => f.id !== TRENDING_FEED_ID);
      feedsByAccount[pubkey] = feedsToSave;
      this.localStorageService.setObject(this.appState.FEEDS_STORAGE_KEY, feedsByAccount);

      this.logger.debug('Saved feeds to storage for pubkey', pubkey, feedsToSave);

      // Also sync to kind 30078 settings for cross-device sync
      this.syncFeedsToSettings(feedsToSave);
    } catch (error) {
      this.logger.error('Error saving feeds to storage:', error);
      // Note: Don't set feedsInitialized flag on error to allow retry
    }
  }

  /**
   * Sync feeds to kind 30078 settings event for cross-device synchronization.
   * This is called automatically when feeds are saved locally.
   * Uses debouncing to prevent excessive relay publishes.
   * Compares feeds before publishing to avoid unnecessary signing requests.
   */
  private syncFeedsToSettingsTimeout: ReturnType<typeof setTimeout> | null = null;
  private syncFeedsToSettings(feeds: FeedConfig[]): void {
    // Skip sync for preview accounts - they cannot sign events
    const account = this.accountState.account();
    if (account?.source === 'preview') {
      this.logger.debug('Skipping feed sync for preview account');
      return;
    }

    // Debounce sync to prevent excessive publishes during rapid changes
    if (this.syncFeedsToSettingsTimeout) {
      clearTimeout(this.syncFeedsToSettingsTimeout);
    }

    this.syncFeedsToSettingsTimeout = setTimeout(async () => {
      // Prevent sync loops
      if (this.syncInProgress) {
        this.logger.debug('Sync already in progress, skipping');
        return;
      }

      try {
        this.syncInProgress = true;

        // Convert to synced format (strip runtime properties)
        const syncedFeeds = feeds.map(feed => this.convertFeedConfigToSynced(feed));

        // Compare with existing synced feeds to avoid unnecessary publishes
        const existingSyncedFeeds = this.settingsService.getSyncedFeeds();
        if (this.areFeedsEqual(syncedFeeds, existingSyncedFeeds)) {
          this.logger.debug('Feeds unchanged, skipping sync to settings');
          return;
        }

        this.logger.info(`Syncing ${syncedFeeds.length} feeds to kind 30078 settings`);
        await this.settingsService.updateSyncedFeeds(syncedFeeds);
        this.logger.info('Feeds synced successfully to settings');
      } catch (error) {
        this.logger.error('Failed to sync feeds to settings:', error);
        // Non-critical - feeds are still saved locally
      } finally {
        this.syncInProgress = false;
      }
    }, 2000); // 2 second debounce
  }

  /**
   * Compare two arrays of synced feeds to check if they are equal.
   * Ignores updatedAt field for comparison since it changes on every save.
   * @returns true if feeds are equal, false otherwise
   */
  private areFeedsEqual(feeds1: SyncedFeedConfig[], feeds2: SyncedFeedConfig[] | undefined): boolean {
    if (!feeds2) return false;
    if (feeds1.length !== feeds2.length) return false;

    // Create maps for quick lookup by id
    const feeds2Map = new Map(feeds2.map(f => [f.id, f]));

    for (const feed1 of feeds1) {
      const feed2 = feeds2Map.get(feed1.id);
      if (!feed2) return false;

      // Compare all properties except updatedAt (which changes on every save)
      // and createdAt (which should be stable)
      if (
        feed1.label !== feed2.label ||
        feed1.icon !== feed2.icon ||
        feed1.type !== feed2.type ||
        feed1.source !== feed2.source ||
        feed1.relayConfig !== feed2.relayConfig ||
        feed1.searchQuery !== feed2.searchQuery ||
        feed1.showReplies !== feed2.showReplies ||
        feed1.showReposts !== feed2.showReposts ||
        feed1.isSystem !== feed2.isSystem ||
        !this.arraysEqual(feed1.kinds, feed2.kinds) ||
        !this.arraysEqual(feed1.customUsers, feed2.customUsers) ||
        !this.arraysEqual(feed1.customStarterPacks, feed2.customStarterPacks) ||
        !this.arraysEqual(feed1.customFollowSets, feed2.customFollowSets) ||
        !this.arraysEqual(feed1.customInterestHashtags, feed2.customInterestHashtags) ||
        !this.arraysEqual(feed1.customRelays, feed2.customRelays) ||
        JSON.stringify(feed1.filters) !== JSON.stringify(feed2.filters)
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Helper to compare two arrays for equality (order matters)
   */
  private arraysEqual<T>(arr1: T[] | undefined, arr2: T[] | undefined): boolean {
    if (arr1 === arr2) return true;
    if (!arr1 && !arr2) return true;
    if (!arr1 || !arr2) return false;
    if (arr1.length !== arr2.length) return false;
    return arr1.every((val, index) => val === arr2[index]);
  }

  /**
   * Force sync feeds to settings immediately (without debounce).
   * Useful for explicit user actions like "Sync Now" button.
   */
  async forceSyncFeeds(): Promise<void> {
    // Skip sync for preview accounts - they cannot sign events
    const account = this.accountState.account();
    if (account?.source === 'preview') {
      this.logger.debug('Skipping force feed sync for preview account');
      return;
    }

    // Clear any pending debounced sync
    if (this.syncFeedsToSettingsTimeout) {
      clearTimeout(this.syncFeedsToSettingsTimeout);
      this.syncFeedsToSettingsTimeout = null;
    }

    const feeds = this._feeds().filter(f => f.id !== TRENDING_FEED_ID);
    const syncedFeeds = feeds.map(feed => this.convertFeedConfigToSynced(feed));

    this.logger.info(`Force syncing ${syncedFeeds.length} feeds to kind 30078 settings`);
    await this.settingsService.updateSyncedFeeds(syncedFeeds);
    this.logger.info('Feeds force synced successfully');
  }

  /**
   * Update the lastRetrieved timestamp for a column and save to localStorage
   */
  /**
   * Update the lastRetrieved timestamp for a feed and save to localStorage
   * @param feedId The feed ID (supports both new feed IDs and legacy column IDs)
   */
  private updateFeedLastRetrieved(feedId: string): void {
    try {
      const currentTimestamp = Math.floor(Date.now() / 1000); // Nostr uses seconds

      const feeds = this._feeds();
      let updated = false;

      // First try to find a feed with this ID directly
      const feedIndex = feeds.findIndex(f => f.id === feedId);
      if (feedIndex !== -1) {
        this._feeds.update(currentFeeds => {
          return currentFeeds.map((f, idx) => {
            if (idx === feedIndex) {
              return {
                ...f,
                lastRetrieved: currentTimestamp,
                updatedAt: Date.now(),
              };
            }
            return f;
          });
        });
        updated = true;
        this.logger.debug(`Updated lastRetrieved for feed ${feedId} to ${currentTimestamp}`);
      }

      if (updated) {
        this.saveFeeds();
      } else {
        // This can happen if a background fetch finishes after a feed was removed,
        // or if legacy/ephemeral feed ids are used.
        this.logger.debug(`Feed ${feedId} not found for lastRetrieved update`);
      }
    } catch (error) {
      this.logger.error('Error updating lastRetrieved:', error);
    }
  }

  // Alias for backward compatibility
  private updateColumnLastRetrieved(columnId: string): void {
    this.updateFeedLastRetrieved(columnId);
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

    // Check if this is an update that requires resubscription
    const requiresResubscription =
      updates.kinds !== undefined ||
      updates.source !== undefined ||
      updates.customRelays !== undefined ||
      updates.relayConfig !== undefined ||
      updates.filters !== undefined;

    if (requiresResubscription) {
      // Unsubscribe from current feed
      this.unsubscribeFromColumn(id);
    }

    // Update the feed configuration
    this._feeds.update(feeds => {
      const updatedFeeds = [...feeds];
      updatedFeeds[feedIndex] = {
        ...updatedFeeds[feedIndex],
        ...updates,
        updatedAt: Date.now(),
      };
      return updatedFeeds;
    });

    if (requiresResubscription && this._activeFeedId() === id) {
      // Resubscribe to the updated feed if it's currently active
      const updatedFeed = this._feeds()[feedIndex];
      await this.subscribeToFeedDirect(updatedFeed);
    }

    this.saveFeeds();
    this.logger.debug(`Updated feed ${id}`, updates);
    return true;
  }


  /**
   * Remove a feed
   */
  removeFeed(id: string): boolean {
    // Check if this is a system feed that cannot be deleted
    const feedToRemove = this._feeds().find(f => f.id === id);
    if (feedToRemove?.isSystem) {
      this.logger.warn(`Cannot remove system feed: ${id}`);
      return false;
    }

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

    // Set the first feed as active and subscribe to it
    if (defaultFeeds.length > 0) {
      this._activeFeedId.set(defaultFeeds[0].id);
      this.logger.debug(`Set active feed to: ${defaultFeeds[0].id}`);

      // Re-subscribe to the new active feed if feeds page is active
      if (this._feedsPageActive()) {
        await this.subscribe();
      }
    }

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

  // Dynamic feed ID constant
  private readonly DYNAMIC_FEED_ID = 'dynamic-hashtag-feed';

  /**
   * Create and subscribe to a dynamic feed based on hashtags.
   * This feed is temporary and not saved to storage.
   * Used when navigating from Interests page with ?t= query parameter.
   * 
   * @param hashtags Array of hashtags (without # prefix)
   * @returns The dynamic feed config
   */
  async createDynamicHashtagFeed(hashtags: string[]): Promise<FeedConfig> {
    // First, clean up any existing dynamic feed
    this.cleanupDynamicFeed();

    // Create a label based on hashtags
    const label = hashtags.length === 1
      ? `#${hashtags[0]}`
      : `${hashtags.length} hashtags`;

    // Create the dynamic feed config
    const dynamicFeed: FeedConfig = {
      id: this.DYNAMIC_FEED_ID,
      label,
      icon: 'tag',
      type: 'notes',
      kinds: [1, 6], // Text notes and reposts
      source: 'interests',
      customInterestHashtags: hashtags,
      relayConfig: 'account',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isSystem: true, // Prevent deletion through normal UI
    };

    this.logger.info(`Creating dynamic hashtag feed with tags: ${hashtags.join(', ')}`);

    // Subscribe to the dynamic feed (this will load events)
    await this.subscribeToFeedDirect(dynamicFeed);

    return dynamicFeed;
  }

  /**
   * Clean up the dynamic feed subscription and data.
   * Called when navigating away from dynamic feed or creating a new one.
   */
  cleanupDynamicFeed(): void {
    if (this.data.has(this.DYNAMIC_FEED_ID)) {
      this.unsubscribeFromColumn(this.DYNAMIC_FEED_ID);
      this.logger.debug('Cleaned up dynamic hashtag feed');
    }
  }

  /**
   * Check if a dynamic feed is currently active
   */
  isDynamicFeedActive(): boolean {
    return this._activeFeedId() === this.DYNAMIC_FEED_ID;
  }

  /**
   * Get the dynamic feed ID constant
   */
  getDynamicFeedId(): string {
    return this.DYNAMIC_FEED_ID;
  }
}


