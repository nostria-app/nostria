import { Injectable, inject, signal, computed } from '@angular/core';
import { Event } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { DatabaseService } from './database.service';
import { RelayBatchService } from './relay-batch.service';
import { LocalStorageService } from './local-storage.service';

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
 * 2. Time-based fetching - only fetches events since last fetch or max 6 hours
 * 3. Shared state - multiple consumers can access the same data
 * 4. Progressive loading - updates UI as events arrive
 */
@Injectable({
  providedIn: 'root',
})
export class FollowingDataService {
  private readonly logger = inject(LoggerService);
  private readonly accountState = inject(AccountStateService);
  private readonly database = inject(DatabaseService);
  private readonly relayBatch = inject(RelayBatchService);
  private readonly localStorage = inject(LocalStorageService);

  // Storage key for last fetch timestamp
  private readonly LAST_FETCH_KEY = 'nostria-following-last-fetch';

  // How long before data is considered stale (5 minutes)
  private readonly STALE_THRESHOLD_MS = 5 * 60 * 1000;

  // Maximum lookback period for fetching (6 hours in seconds)
  private readonly MAX_LOOKBACK_SECONDS = 6 * 60 * 60;

  // Loading state
  readonly isLoading = signal(false);
  readonly isFetching = signal(false);
  readonly progress = computed(() => this.relayBatch.progress());

  // Last successful fetch timestamp (per account)
  private lastFetchTimestamp = signal<number | null>(null);

  // Cached events from following (in memory)
  private cachedEvents = signal<Event[]>([]);

  // Current fetch promise to avoid duplicate requests
  private currentFetchPromise: Promise<Event[]> | null = null;

  /**
   * Get the timestamp of when we last fetched following data.
   */
  getLastFetchTimestamp(): number | null {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return null;

    const key = `${this.LAST_FETCH_KEY}-${pubkey}`;
    const value = this.localStorage.getItem(key);
    return value ? parseInt(value, 10) : null;
  }

  /**
   * Update the last fetch timestamp.
   */
  private setLastFetchTimestamp(timestamp: number): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    const key = `${this.LAST_FETCH_KEY}-${pubkey}`;
    this.localStorage.setItem(key, timestamp.toString());
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
   * Calculate the 'since' timestamp for queries.
   * Uses the last fetch time or max 6 hours ago.
   */
  private calculateSinceTimestamp(): number {
    const lastFetch = this.getLastFetchTimestamp();
    const now = Math.floor(Date.now() / 1000);
    const maxLookback = now - this.MAX_LOOKBACK_SECONDS;

    if (lastFetch === null) {
      return maxLookback;
    }

    // Convert lastFetch from ms to seconds
    const lastFetchSeconds = Math.floor(lastFetch / 1000);

    // Use whichever is more recent (to limit data volume)
    return Math.max(lastFetchSeconds, maxLookback);
  }

  /**
   * Get events from the database cache.
   * This provides immediate data while fresh data is being fetched.
   */
  async getCachedEvents(kinds: number[], since?: number): Promise<Event[]> {
    const pubkey = this.accountState.pubkey();
    const followingList = this.accountState.followingList();
    if (!pubkey || followingList.length === 0) return [];

    const sinceTimestamp = since ?? this.calculateSinceTimestamp();

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
   * 1. ALWAYS loads cached events from database first (for instant UI)
   * 2. If data is fresh (< 5 minutes old), returns cached data without fetching
   * 3. If data is stale, fetches NEW events since last fetch (not all)
   * 4. Multiple simultaneous calls share the same fetch promise
   * 
   * @param kinds Array of event kinds to fetch (default: [1] for notes)
   * @param force Force a fresh fetch even if data is fresh
   * @param onProgress Callback for incremental updates as events arrive
   * @param onCacheLoaded Callback when cached events are loaded (before fetch)
   */
  async ensureFollowingData(
    kinds: number[] = [1],
    force = false,
    onProgress?: (events: Event[]) => void,
    onCacheLoaded?: (events: Event[]) => void
  ): Promise<Event[]> {
    const followingList = this.accountState.followingList();

    if (followingList.length === 0) {
      this.logger.debug('[FollowingDataService] Following list is empty');
      return [];
    }

    // ALWAYS load cached events first for instant UI
    const cachedEvents = await this.getCachedEvents(kinds);
    if (cachedEvents.length > 0) {
      this.logger.debug(`[FollowingDataService] Loaded ${cachedEvents.length} cached events`);
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

    // Start a new fetch for events SINCE last fetch only
    this.currentFetchPromise = this.fetchFromRelays(kinds, cachedEvents, onProgress);

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
   * Fetch events from relays using batch strategy.
   * Only fetches events SINCE last fetch to avoid re-downloading.
   */
  private async fetchFromRelays(
    kinds: number[],
    existingEvents: Event[],
    onProgress?: (events: Event[]) => void
  ): Promise<Event[]> {
    const followingList = this.accountState.followingList();

    this.isLoading.set(true);
    this.isFetching.set(true);

    // Calculate since timestamp - only fetch what we don't have
    const sinceTimestamp = this.calculateSinceTimestamp();

    try {
      this.logger.info(
        `[FollowingDataService] Fetching events from ${followingList.length} users since ${new Date(sinceTimestamp * 1000).toISOString()}`
      );

      const newEvents = await this.relayBatch.fetchAllFollowingEvents(
        kinds,
        {
          limitPerUser: 5,
          timeout: 15000,
          since: sinceTimestamp, // Only fetch since last fetch
        },
        (batchEvents: Event[]) => {
          // Save events to database as they arrive
          for (const event of batchEvents) {
            this.database.saveEvent(event).catch(err => {
              this.logger.error('[FollowingDataService] Error saving event:', err);
            });
          }

          // Notify progress callback
          if (onProgress) {
            onProgress(batchEvents);
          }
        }
      );

      // Update last fetch timestamp to NOW
      this.setLastFetchTimestamp(Date.now());

      // Merge and cache all events
      const allEvents = this.mergeEvents(existingEvents, newEvents);
      this.cachedEvents.set(allEvents);

      this.logger.info(
        `[FollowingDataService] Fetched ${newEvents.length} NEW events (total: ${allEvents.length})`
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
    this.currentFetchPromise = null;
  }
}
