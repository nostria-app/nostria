import { Injectable, inject, signal, computed } from '@angular/core';
import { Event } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { DatabaseService } from './database.service';
import { RelayBatchService } from './relay-batch.service';
import { AccountLocalStateService } from './account-local-state.service';

/**
 * Service for managing following data fetching across the application.
 * 
 * This service provides a centralized way to fetch and cache events from all
 * users that the current account follows. It's used by:
 * - Following feeds (any feed with source='following')
 * - Summary page
 * 
 * Key features:
 * 1. Smart caching - avoids redundant fetches if data is fresh
 * 2. TIME-WINDOW based fetching - fetches events in 6-hour time windows
 * 3. Shared state - multiple consumers can access the same data
 * 4. Progressive loading - updates UI IMMEDIATELY as events arrive
 * 5. Infinite scroll support - loads older 6-hour windows on demand
 * 
 * PERFORMANCE OPTIMIZATION:
 * Instead of limiting by number of events per user (which causes issues with
 * users who post at different frequencies), we limit by TIME WINDOW.
 * This ensures we get ALL events from the time period without gaps.
 */
@Injectable({
  providedIn: 'root',
})
export class FollowingDataService {
  private readonly logger = inject(LoggerService);
  private readonly accountState = inject(AccountStateService);
  private readonly database = inject(DatabaseService);
  private readonly relayBatch = inject(RelayBatchService);
  private readonly accountLocalState = inject(AccountLocalStateService);

  // How long before data is considered stale (5 minutes)
  private readonly STALE_THRESHOLD_MS = 5 * 60 * 1000;

  // Time window for fetching (6 hours in seconds)
  // This is the size of each "page" when infinite scrolling
  readonly TIME_WINDOW_SECONDS = 6 * 60 * 60;

  // Maximum lookback period for DATABASE queries (90 days in seconds)
  // This matches the column cache max age and allows showing all locally stored events
  private readonly MAX_DATABASE_LOOKBACK_SECONDS = 90 * 24 * 60 * 60;

  // Loading state
  readonly isLoading = signal(false);
  readonly isFetching = signal(false);
  readonly progress = computed(() => this.relayBatch.progress());

  // Track the oldest timestamp we've fetched to (for infinite scroll)
  private oldestFetchedTimestamp = signal<number | null>(null);

  // Last successful fetch timestamp (per account)
  private lastFetchTimestamp = signal<number | null>(null);

  // Cached events from following (in memory)
  private cachedEvents = signal<Event[]>([]);

  // Current fetch promise to avoid duplicate requests
  private currentFetchPromise: Promise<Event[]> | null = null;

  // Current pagination fetch promise (for loading older events)
  private paginationFetchPromise: Promise<Event[]> | null = null;

  /**
   * Get the timestamp of when we last fetched following data.
   */
  getLastFetchTimestamp(): number | null {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return null;

    const timestamp = this.accountLocalState.getFollowingLastFetch(pubkey);
    return timestamp || null;
  }

  /**
   * Update the last fetch timestamp.
   */
  private setLastFetchTimestamp(timestamp: number): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    this.accountLocalState.setFollowingLastFetch(pubkey, timestamp);
    this.lastFetchTimestamp.set(timestamp);
  }

  /**
   * Check if the cached data is still fresh (not stale).
   */
  isDataFresh(): boolean {
    const lastFetch = this.getLastFetchTimestamp();
    if (!lastFetch) return false;

    const now = Date.now();
    return now - lastFetch < this.STALE_THRESHOLD_MS;
  }

  /**
   * Calculate the 'since' timestamp for RELAY fetching.
   * Returns the start of the current 6-hour time window.
   */
  private calculateRelayFetchSinceTimestamp(): number {
    const now = Math.floor(Date.now() / 1000);
    return now - this.TIME_WINDOW_SECONDS;
  }

  /**
   * Get the oldest timestamp we have fetched to.
   * Used for infinite scroll pagination.
   */
  getOldestFetchedTimestamp(): number | null {
    return this.oldestFetchedTimestamp();
  }

  /**
   * Calculate the 'since' timestamp for DATABASE queries.
   * Uses a longer lookback (1 week) to show all locally cached events.
   */
  private calculateDatabaseSinceTimestamp(): number {
    const now = Math.floor(Date.now() / 1000);
    return now - this.MAX_DATABASE_LOOKBACK_SECONDS;
  }

  /**
   * Get events from the database cache.
   * This provides immediate data while fresh data is being fetched.
   * Uses a 1-week lookback by default to show all locally stored events.
   */
  async getCachedEvents(kinds: number[], since?: number): Promise<Event[]> {
    const pubkey = this.accountState.pubkey();
    const followingList = this.accountState.followingList();
    if (!pubkey || followingList.length === 0) return [];

    // Use provided since timestamp, or default to 1 week lookback for database queries
    const sinceTimestamp = since ?? this.calculateDatabaseSinceTimestamp();

    try {
      // Fetch events for each kind and combine
      const allEvents: Event[] = [];

      for (const kind of kinds) {
        const events = await this.database.getAllEventsByPubkeyKindSince(
          pubkey,
          followingList,
          kind,
          sinceTimestamp
        );
        allEvents.push(...events);
      }

      // Sort by timestamp descending and deduplicate
      const eventMap = new Map<string, Event>();
      for (const event of allEvents) {
        eventMap.set(event.id, event);
      }

      return Array.from(eventMap.values())
        .sort((a, b) => b.created_at - a.created_at);
    } catch (error) {
      this.logger.error('[FollowingDataService] Error getting cached events:', error);
      return [];
    }
  }

  /**
   * Ensure following data is loaded. This is the main entry point.
   * 
   * Behavior:
   * 1. If in-memory cache exists and is fresh, return immediately (no database hit)
   * 2. Otherwise, load cached events from database first (for instant UI)
   * 3. If data is fresh (< 5 minutes old), returns cached data without fetching
   * 4. If data is stale, fetches NEW events since last fetch (not all)
   * 5. Multiple simultaneous calls share the same fetch promise
   * 
   * @param kinds Array of event kinds to fetch (default: [1] for notes)
   * @param force Force a fresh fetch even if data is fresh
   * @param onProgress Callback for incremental updates as events arrive
   * @param onCacheLoaded Callback when cached events are loaded (before fetch)
   * @param customSince Override the since timestamp for fetching (in seconds)
   */
  async ensureFollowingData(
    kinds: number[] = [1],
    force = false,
    onProgress?: (events: Event[]) => void,
    onCacheLoaded?: (events: Event[]) => void,
    customSince?: number
  ): Promise<Event[]> {
    const followingList = this.accountState.followingList();

    if (followingList.length === 0) {
      this.logger.debug('[FollowingDataService] Following list is empty');
      return [];
    }

    // OPTIMIZATION: If we have in-memory cache and data is fresh, return immediately
    // This avoids hitting IndexedDB on subsequent calls within the 5-minute window
    const memoryCache = this.cachedEvents();
    if (memoryCache.length > 0 && !force && this.isDataFresh()) {
      this.logger.debug(`[FollowingDataService] Using in-memory cache (${memoryCache.length} events)`);
      if (onCacheLoaded) {
        onCacheLoaded(memoryCache);
      }
      return memoryCache;
    }

    // Load from database if we don't have in-memory cache or data is stale
    const cachedEvents = await this.getCachedEvents(kinds, customSince);
    if (cachedEvents.length > 0) {
      this.logger.debug(`[FollowingDataService] Loaded ${cachedEvents.length} cached events from database`);
      // Notify caller about cached events immediately
      if (onCacheLoaded) {
        onCacheLoaded(cachedEvents);
      }
      // Update in-memory cache
      this.cachedEvents.set(cachedEvents);
    }

    // If data is fresh and not forced, return cached events without fetching
    if (!force && this.isDataFresh()) {
      this.logger.debug('[FollowingDataService] Data is fresh, skipping fetch');
      return cachedEvents;
    }

    // If there's already a fetch in progress, return that promise
    if (this.currentFetchPromise) {
      this.logger.debug('[FollowingDataService] Fetch already in progress, waiting...');
      return this.currentFetchPromise;
    }

    // Start a new fetch for events SINCE the specified time (or last fetch)
    this.currentFetchPromise = this.fetchFromRelays(kinds, cachedEvents, onProgress, customSince);

    try {
      const newEvents = await this.currentFetchPromise;
      // Merge new events with cached events
      const allEvents = this.mergeEvents(cachedEvents, newEvents);
      return allEvents;
    } finally {
      this.currentFetchPromise = null;
    }
  }

  /**
   * Merge new events with existing events, avoiding duplicates.
   */
  private mergeEvents(existing: Event[], newEvents: Event[]): Event[] {
    const eventMap = new Map<string, Event>();

    // Add existing events first
    for (const event of existing) {
      eventMap.set(event.id, event);
    }

    // Add new events (overwrites if duplicate)
    for (const event of newEvents) {
      eventMap.set(event.id, event);
    }

    // Sort by timestamp descending
    return Array.from(eventMap.values())
      .sort((a, b) => b.created_at - a.created_at);
  }

  /**
   * Fetch events from relays using the FAST method (account relays directly).
   * 
   * PERFORMANCE: This uses the user's own account relays instead of discovering
   * each following user's relays. This is MUCH faster because:
   * 1. No kind 10002/kind 3 fetch for each following user
   * 2. Account relays are already connected
   * 3. Batches authors together efficiently
   * 
   * Events are delivered IMMEDIATELY as they arrive via onProgress callback.
   * @param customSince Override the since timestamp (in seconds)
   * @param customUntil Optional until timestamp for fetching older windows (in seconds)
   */
  private async fetchFromRelays(
    kinds: number[],
    existingEvents: Event[],
    onProgress?: (events: Event[]) => void,
    customSince?: number,
    customUntil?: number
  ): Promise<Event[]> {
    const followingList = this.accountState.followingList();

    this.isLoading.set(true);
    this.isFetching.set(true);

    // Calculate time window for relay fetching
    const now = Math.floor(Date.now() / 1000);
    const sinceTimestamp = customSince ?? this.calculateRelayFetchSinceTimestamp();
    const untilTimestamp = customUntil ?? now;

    try {
      this.logger.info(
        `[FollowingDataService] FAST fetch from ${followingList.length} users ` +
        `from ${new Date(sinceTimestamp * 1000).toISOString()} to ${new Date(untilTimestamp * 1000).toISOString()}`
      );

      // Use the FAST method that bypasses relay discovery
      const newEvents = await this.relayBatch.fetchFollowingEventsFast(
        kinds,
        {
          since: sinceTimestamp,
          until: untilTimestamp,
          timeout: 5000, // Shorter timeout since we're using connected relays
        },
        (batchEvents: Event[]) => {
          // Save events to database as they arrive
          for (const event of batchEvents) {
            this.database.saveEvent(event).catch(err => {
              this.logger.error('[FollowingDataService] Error saving event:', err);
            });
          }

          // IMMEDIATELY notify progress callback - this is critical for UX
          // The UI should show "new posts" button as soon as ANY event arrives
          if (onProgress) {
            onProgress(batchEvents);
          }
        }
      );

      // Update last fetch timestamp to NOW
      this.setLastFetchTimestamp(Date.now());

      // Track the oldest timestamp we've fetched
      if (newEvents.length > 0) {
        const oldestEventTime = Math.min(...newEvents.map(e => e.created_at || 0));
        const currentOldest = this.oldestFetchedTimestamp();
        if (!currentOldest || oldestEventTime < currentOldest) {
          this.oldestFetchedTimestamp.set(oldestEventTime);
        }
      } else if (!this.oldestFetchedTimestamp()) {
        // Even if no events, track the time window we searched
        this.oldestFetchedTimestamp.set(sinceTimestamp);
      }

      // Merge and cache all events
      const allEvents = this.mergeEvents(existingEvents, newEvents);
      this.cachedEvents.set(allEvents);

      this.logger.info(
        `[FollowingDataService] Fetched ${newEvents.length} events (total: ${allEvents.length})`
      );

      return newEvents; // Return only new events, caller merges
    } catch (error) {
      this.logger.error('[FollowingDataService] Error fetching from relays:', error);
      throw error;
    } finally {
      this.isLoading.set(false);
      this.isFetching.set(false);
    }
  }

  /**
   * Load older events (next 6-hour window) for infinite scroll pagination.
   * This is called when user scrolls to the bottom of the feed.
   * 
   * @param kinds Array of event kinds to fetch
   * @param onProgress Callback for incremental updates as events arrive
   * @returns The newly fetched events
   */
  async loadOlderEvents(
    kinds: number[] = [1],
    onProgress?: (events: Event[]) => void
  ): Promise<Event[]> {
    const followingList = this.accountState.followingList();

    if (followingList.length === 0) {
      this.logger.debug('[FollowingDataService] Following list is empty');
      return [];
    }

    // Prevent duplicate pagination requests
    if (this.paginationFetchPromise) {
      this.logger.debug('[FollowingDataService] Pagination already in progress, waiting...');
      return this.paginationFetchPromise;
    }

    // Determine the time window for the next page
    const oldestTimestamp = this.oldestFetchedTimestamp();
    if (!oldestTimestamp) {
      // No previous fetch, just do initial load
      return this.ensureFollowingData(kinds, true, onProgress);
    }

    // Calculate the next 6-hour window (going backwards in time)
    const untilTimestamp = oldestTimestamp - 1; // Just before the oldest we have
    const sinceTimestamp = untilTimestamp - this.TIME_WINDOW_SECONDS;

    this.logger.info(
      `[FollowingDataService] Loading older events: ` +
      `from ${new Date(sinceTimestamp * 1000).toISOString()} to ${new Date(untilTimestamp * 1000).toISOString()}`
    );

    // Start pagination fetch
    const existingEvents = this.cachedEvents();
    this.paginationFetchPromise = this.fetchFromRelays(
      kinds,
      existingEvents,
      onProgress,
      sinceTimestamp,
      untilTimestamp
    );

    try {
      const newEvents = await this.paginationFetchPromise;
      return newEvents;
    } finally {
      this.paginationFetchPromise = null;
    }
  }

  /**
   * Check if there are potentially more older events to load.
   * We assume there are more events unless we've gone too far back.
   */
  hasMoreOlderEvents(): boolean {
    const oldest = this.oldestFetchedTimestamp();
    if (!oldest) return true;

    // Allow infinite scrolling - no time limit
    // Previously limited to 30 days, now removed to support continuous loading
    return true;
  }

  /**
   * Force refresh following data, ignoring cache freshness.
   */
  async refresh(
    kinds: number[] = [1],
    onProgress?: (events: Event[]) => void
  ): Promise<Event[]> {
    return this.ensureFollowingData(kinds, true, onProgress);
  }

  /**
   * Get the current in-memory cached events.
   */
  getCachedEventsSync(): Event[] {
    return this.cachedEvents();
  }

  /**
   * Clear all cached data (useful when switching accounts).
   */
  clearCache(): void {
    this.cachedEvents.set([]);
    this.lastFetchTimestamp.set(null);
    this.oldestFetchedTimestamp.set(null);
    this.currentFetchPromise = null;
    this.paginationFetchPromise = null;
  }
}
