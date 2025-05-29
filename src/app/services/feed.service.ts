import { Injectable, inject, signal, computed, Signal, WritableSignal } from '@angular/core';
import { LocalStorageService } from './local-storage.service';
import { LoggerService } from './logger.service';
import { NostrService } from './nostr.service';
import { RelayService } from './relay.service';
import { Event } from 'nostr-tools';
import { SubCloser } from 'nostr-tools/abstract-pool';
import { ApplicationStateService } from './application-state.service';

export interface FeedData {
  column: ColumnConfig,
  filter: any,
  events: WritableSignal<Event[]>,
  subscription: SubCloser | null
}

export interface ColumnConfig {
  id: string;
  label: string;
  icon: string;
  path?: string;
  type: 'notes' | 'articles' | 'photos' | 'videos' | 'custom';
  kinds: number[];
  relayConfig: 'user' | 'discovery' | 'custom';
  customRelays?: string[];
  filters?: Record<string, any>;
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

const FEED_TYPES = {
  notes: {
    label: 'Notes',
    icon: 'chat',
    kinds: [1], // Text notes
    description: 'Short text posts and updates'
  },
  articles: {
    label: 'Articles',
    icon: 'article',
    kinds: [30023], // Long-form content
    description: 'Long-form articles and blog posts'
  },
  photos: {
    label: 'Photos',
    icon: 'image',
    kinds: [20],
    description: 'Images'
  },
  videos: {
    label: 'Videos',
    icon: 'movie',
    kinds: [21],
    description: 'Videos'
  },
  custom: {
    label: 'Custom',
    icon: 'tune',
    kinds: [],
    description: 'Custom configuration with specific event kinds'
  }
};

const DEFAULT_FEEDS: FeedConfig[] = [
  {
    id: 'default-feed',
    label: 'My Feed',
    icon: 'dynamic_feed',
    description: 'Default feed with notes',
    columns: [
      {
        id: 'notes',
        label: 'Notes',
        icon: 'chat',
        type: 'notes',
        kinds: [1],
        relayConfig: 'user',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
];

@Injectable({
  providedIn: 'root'
})
export class FeedService {
  private readonly localStorageService = inject(LocalStorageService);
  private readonly logger = inject(LoggerService);
  private readonly nostr = inject(NostrService);
  private readonly relay = inject(RelayService);
  private readonly appState = inject(ApplicationStateService);

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
  readonly feedTypes = FEED_TYPES;

  constructor() {
    this.loadFeeds();
    this.loadRelays();
  }

  /**
   * Load feeds from local storage
   */
  private loadFeeds(): void {
    try {
      const storedFeeds = this.localStorageService.getObject<FeedConfig[]>(this.appState.FEEDS_STORAGE_KEY);
      if (storedFeeds && Array.isArray(storedFeeds) && storedFeeds.length > 0) {
        this._feeds.set(storedFeeds);
        this.logger.debug('Loaded feeds from storage', storedFeeds);
      } else {
        this._feeds.set(DEFAULT_FEEDS);
        this.saveFeeds();
        this.logger.debug('No feeds found, using defaults');
      }
    } catch (error) {
      this.logger.error('Error loading feeds from storage:', error);
      this._feeds.set(DEFAULT_FEEDS);
      this.saveFeeds();
    }

    this.subscribe();
  }
  // Use a signal to track feed data for reactivity
  private readonly _feedData = signal(new Map<string, FeedData>());
  readonly data = new Map<string, FeedData>();

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
        this.subscribeToFeed(activeFeed);
        this.logger.debug('Subscribed to active feed:', activeFeedId);
      }
    }
    
    console.log('Subscribed to feeds:', Array.from(this.data.keys()));
  }

  /**
   * Set the active feed and manage subscriptions
   */
  setActiveFeed(feedId: string | null): void {
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
        this.subscribeToFeed(activeFeed);
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
  private subscribeToFeed(feed: FeedConfig): void {
    // Subscribe to each column in the feed
    feed.columns.forEach(column => {
      this.subscribeToColumn(column);
    });
  }

  /**
   * Subscribe to a single column
   */
  private subscribeToColumn(column: ColumnConfig): void {
    // Don't subscribe if already subscribed
    if (this.data.has(column.id)) {
      this.logger.warn(`Column ${column.id} is already subscribed`);
      return;
    }

    const item: FeedData = {
      column,
      filter: null as any,
      events: signal<Event[]>([]),
      subscription: null as SubCloser | null
    };

    // Build filter based on column configuration
    if (column.filters) {
      item.filter = {
        limit: 6,
        kinds: column.kinds,
        // authors: column.relayConfig === 'user' ? this._userRelays().map(r => r.url) : this._discoveryRelays().map(r => r.url),
        ...column.filters
      };
    } else {
      item.filter = {
        limit: 6,
        kinds: column.kinds,
        // authors: column.relayConfig === 'user' ? this._userRelays().map(r => r.url) : this._discoveryRelays().map(r => r.url)
      };
    }

    // Subscribe to relay events
    const sub = this.relay.subscribe([item.filter], (event) => {
      item.events.update(events => [event, ...events]);
      this.logger.debug(`Column event received for ${column.id}:`, event);
    });

    item.subscription = sub as any;
    this.data.set(column.id, item);
    
    // Update the reactive signal
    this._feedData.update(map => {
      const newMap = new Map(map);
      newMap.set(column.id, item);
      return newMap;
    });
    
    this.logger.debug(`Subscribed to column: ${column.id}`);
  }  /**
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
        columnData.subscription.close();
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
  unsubscribe() {
    this.data.forEach(item => item.subscription?.close());
    this.data.clear();
    this._feedData.set(new Map());
    this.logger.debug('Unsubscribed from all feed subscriptions');
  }

  /**
   * Save feeds to local storage
   */
  private saveFeeds(): void {
    try {
      this.localStorageService.setObject(this.appState.FEEDS_STORAGE_KEY, this._feeds());
      this.logger.debug('Saved feeds to storage', this._feeds());
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
      { url: 'wss://relay.snort.social', read: true, write: true }
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
        discovery: this._discoveryRelays()
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
  addFeed(feedData: Omit<FeedConfig, 'id' | 'createdAt' | 'updatedAt'>): FeedConfig {
    const newFeed: FeedConfig = {
      ...feedData,
      id: `feed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this._feeds.update(feeds => [...feeds, newFeed]);
    this.saveFeeds();
    
    // Subscribe to the new feed immediately
    this.subscribeToFeed(newFeed);

    this.logger.debug('Added new feed and subscribed', newFeed);
    return newFeed;
  }  /**
   * Update an existing feed
   */
  updateFeed(id: string, updates: Partial<Omit<FeedConfig, 'id' | 'createdAt'>>): boolean {
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
      
      // Find columns that were removed
      const removedColumns = currentColumns.filter(currentCol => 
        !newColumns.some(newCol => newCol.id === currentCol.id)
      );
      
      // Find columns that were added
      const addedColumns = newColumns.filter(newCol => 
        !currentColumns.some(currentCol => currentCol.id === newCol.id)
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
          updatedAt: Date.now()
        };
        return updatedFeeds;
      });
      
      // Subscribe to new columns
      addedColumns.forEach(column => {
        this.subscribeToColumn(column);
      });
    } else {
      // For non-column updates, just update the configuration
      this._feeds.update(feeds => {
        const updatedFeeds = [...feeds];
        updatedFeeds[feedIndex] = {
          ...updatedFeeds[feedIndex],
          ...updates,
          updatedAt: Date.now()
        };
        return updatedFeeds;
      });
    }

    this.saveFeeds();
    this.logger.debug(`Updated feed ${id}`, updates);
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
  getFeedType(type: keyof typeof FEED_TYPES) {
    return FEED_TYPES[type];
  }

  /**
   * Get all available feed types
   */
  getFeedTypes() {
    return Object.entries(FEED_TYPES).map(([key, value]) => ({
      key: key as keyof typeof FEED_TYPES,
      ...value
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
}
