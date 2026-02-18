import { Injectable, inject, signal, computed } from '@angular/core';
import { Event } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { DatabaseService, FollowingActivityRecord } from './database.service';
import { RelayBatchService } from './relay-batch.service';
import { AccountLocalStateService } from './account-local-state.service';
import { FollowSetsService } from './follow-sets.service';

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
  private readonly followSets = inject(FollowSetsService);

  // How long before data is considered stale (5 minutes)
  private readonly STALE_THRESHOLD_MS = 5 * 60 * 1000;

  // Time window for fetching (6 hours in seconds)
  // This is the size of each "page" when infinite scrolling
  readonly TIME_WINDOW_SECONDS = 6 * 60 * 60;

  // Maximum lookback period for initial cache loading (7 days in seconds)
  // This limits how many events are loaded at startup for the feed display
  // Older events can still be loaded via infinite scroll pagination
  private readonly MAX_INITIAL_CACHE_SECONDS = 7 * 24 * 60 * 60;

  // Activity persistence tuning
  private readonly ACTIVITY_FLUSH_DELAY_MS = 750;
  private readonly ACTIVITY_PRUNE_INTERVAL_MS = 10 * 60 * 1000;

  // Periodic following refresh tuning
  private readonly REFRESH_TOP_ACTIVE_RATIO = 0.4;
  private readonly REFRESH_MIN_TOP_ACTIVE = 10;

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

  // Windowed rotation cursor for periodic refresh checks
  private refreshWindowCursor = 0;

  // Batched activity write buffer (pubkey -> aggregate)
  private pendingActivityUpdates = new Map<string, { lastPostedAtSec: number; lastSeenAtMs: number; eventCountDelta: number }>();
  private activityFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastActivityPruneAtMs = 0;

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
   * Calculate the 'since' timestamp for initial cache loading.
   * Uses a 7-day lookback for the feed display - older events are loaded via pagination.
   */
  private calculateInitialCacheSinceTimestamp(): number {
    const now = Math.floor(Date.now() / 1000);
    return now - this.MAX_INITIAL_CACHE_SECONDS;
  }

  /**
   * Get events from the database cache.
   * This provides immediate data while fresh data is being fetched.
   * Uses a 7-day lookback by default - older events are loaded via infinite scroll.
   */
  async getCachedEvents(kinds: number[], since?: number): Promise<Event[]> {
    const pubkey = this.accountState.pubkey();
    const followingList = this.accountState.followingList();
    if (!pubkey || followingList.length === 0) return [];

    // Use provided since timestamp, or default to 7-day lookback for initial cache loading
    const sinceTimestamp = since ?? this.calculateInitialCacheSinceTimestamp();

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
   * Build a tracked pubkey set from default follows + all people lists.
   */
  private getTrackedPubkeysSet(): Set<string> {
    const tracked = new Set<string>();

    for (const pubkey of this.accountState.followingList()) {
      if (pubkey) {
        tracked.add(pubkey);
      }
    }

    for (const followSet of this.followSets.followSets()) {
      for (const pubkey of followSet.pubkeys) {
        if (pubkey) {
          tracked.add(pubkey);
        }
      }
    }

    return tracked;
  }

  /**
   * Keep shared activity store scoped to currently tracked pubkeys.
   */
  private async pruneActivityIfNeeded(trackedPubkeys: string[]): Promise<void> {
    const nowMs = Date.now();
    if (nowMs - this.lastActivityPruneAtMs < this.ACTIVITY_PRUNE_INTERVAL_MS) {
      return;
    }

    this.lastActivityPruneAtMs = nowMs;
    try {
      await this.database.pruneFollowingActivity(trackedPubkeys);
    } catch (error) {
      this.logger.warn('[FollowingDataService] Failed to prune following activity records:', error);
    }
  }

  /**
   * Returns following authors prioritized by:
   * 1) known last-posted activity (desc)
   * 2) reverse follow-list order fallback for unknowns (bottom first)
   */
  private async getPrioritizedFollowingPubkeys(): Promise<string[]> {
    const followingList = this.accountState.followingList();
    if (followingList.length === 0) {
      return [];
    }

    const reverseDeduped: string[] = [];
    const seen = new Set<string>();

    // Reverse processing for first-time unknown users: newest follows (bottom) first
    for (let index = followingList.length - 1; index >= 0; index--) {
      const pubkey = followingList[index];
      if (!pubkey || seen.has(pubkey)) {
        continue;
      }
      seen.add(pubkey);
      reverseDeduped.push(pubkey);
    }

    let records: FollowingActivityRecord[] = [];
    try {
      records = await this.database.getFollowingActivity(reverseDeduped);
    } catch (error) {
      this.logger.warn('[FollowingDataService] Failed to load following activity for prioritization:', error);
    }

    const activityByPubkey = new Map(records.map(record => [record.pubkey, record]));

    const knownActive = reverseDeduped
      .filter(pubkey => activityByPubkey.has(pubkey))
      .sort((pubkeyA, pubkeyB) => {
        const a = activityByPubkey.get(pubkeyA)?.lastPostedAtSec ?? 0;
        const b = activityByPubkey.get(pubkeyB)?.lastPostedAtSec ?? 0;
        return b - a;
      });

    const unknownActive = reverseDeduped.filter(pubkey => !activityByPubkey.has(pubkey));

    return [...knownActive, ...unknownActive];
  }

  /**
   * Queue activity updates and flush shortly after to avoid excessive IndexedDB writes.
   */
  private queueActivityUpdates(events: Event[], trackedPubkeys: Set<string>): void {
    if (events.length === 0 || trackedPubkeys.size === 0) {
      return;
    }

    const nowMs = Date.now();
    let hasUpdates = false;

    for (const event of events) {
      const pubkey = event.pubkey;
      if (!pubkey || !trackedPubkeys.has(pubkey)) {
        continue;
      }

      const existing = this.pendingActivityUpdates.get(pubkey);
      const nextLastPosted = Math.max(existing?.lastPostedAtSec ?? 0, event.created_at ?? 0);

      this.pendingActivityUpdates.set(pubkey, {
        lastPostedAtSec: nextLastPosted,
        lastSeenAtMs: nowMs,
        eventCountDelta: (existing?.eventCountDelta ?? 0) + 1,
      });

      hasUpdates = true;
    }

    if (!hasUpdates || this.activityFlushTimer) {
      return;
    }

    this.activityFlushTimer = setTimeout(() => {
      void this.flushActivityUpdates();
    }, this.ACTIVITY_FLUSH_DELAY_MS);
  }

  /**
   * Flush queued activity updates to shared DB.
   */
  private async flushActivityUpdates(): Promise<void> {
    if (this.activityFlushTimer) {
      clearTimeout(this.activityFlushTimer);
      this.activityFlushTimer = null;
    }

    if (this.pendingActivityUpdates.size === 0) {
      return;
    }

    const updates = Array.from(this.pendingActivityUpdates.entries()).map(([pubkey, data]) => ({
      pubkey,
      lastPostedAtSec: data.lastPostedAtSec,
      lastSeenAtMs: data.lastSeenAtMs,
      eventCountDelta: data.eventCountDelta,
    }));

    this.pendingActivityUpdates.clear();

    try {
      await this.database.upsertFollowingActivity(updates);
    } catch (error) {
      this.logger.warn('[FollowingDataService] Failed to persist following activity updates:', error);
    }
  }

  /**
   * Get a periodic refresh window: always include a top-active slice,
   * then rotate through the remaining followed authors.
   */
  async getFollowingRefreshWindowPubkeys(windowSize = 140): Promise<string[]> {
    const prioritized = await this.getPrioritizedFollowingPubkeys();
    if (prioritized.length <= windowSize) {
      return prioritized;
    }

    const topCount = Math.min(
      prioritized.length,
      Math.max(this.REFRESH_MIN_TOP_ACTIVE, Math.floor(windowSize * this.REFRESH_TOP_ACTIVE_RATIO))
    );

    const topAuthors = prioritized.slice(0, topCount);
    const rotatingPool = prioritized.slice(topCount);
    const remainingSlots = Math.max(windowSize - topAuthors.length, 0);

    if (remainingSlots === 0 || rotatingPool.length === 0) {
      return topAuthors;
    }

    const start = this.refreshWindowCursor % rotatingPool.length;
    const rotated: string[] = [];

    for (let i = 0; i < remainingSlots; i++) {
      const pubkey = rotatingPool[(start + i) % rotatingPool.length];
      rotated.push(pubkey);
    }

    this.refreshWindowCursor = (start + remainingSlots) % rotatingPool.length;

    return Array.from(new Set([...topAuthors, ...rotated]));
  }

  /**
   * Fetch newest events for an explicit subset of following authors.
   */
  async fetchNewEventsForAuthors(
    pubkeys: string[],
    kinds: number[],
    sinceTimestamp: number,
    timeout = 1800
  ): Promise<Event[]> {
    if (pubkeys.length === 0) {
      return [];
    }

    const trackedPubkeys = this.getTrackedPubkeysSet();
    await this.pruneActivityIfNeeded(Array.from(trackedPubkeys));

    const now = Math.floor(Date.now() / 1000);

    const events = await this.relayBatch.fetchFollowingEventsFast(
      kinds,
      {
        authors: pubkeys,
        since: sinceTimestamp,
        until: now,
        timeout,
      },
      (batchEvents: Event[]) => {
        for (const event of batchEvents) {
          this.database.saveEvent(event).catch(err => {
            this.logger.error('[FollowingDataService] Error saving event during refresh fetch:', err);
          });
        }
        this.queueActivityUpdates(batchEvents, trackedPubkeys);
      }
    );

    this.queueActivityUpdates(events, trackedPubkeys);
    await this.flushActivityUpdates();

    return events;
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
    const trackedPubkeys = this.getTrackedPubkeysSet();
    const followingList = await this.getPrioritizedFollowingPubkeys();

    if (followingList.length === 0) {
      return [];
    }

    await this.pruneActivityIfNeeded(Array.from(trackedPubkeys));

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
          authors: followingList,
          since: sinceTimestamp,
          until: untilTimestamp,
          timeout: 2000, // Short timeout - fail fast on slow relays, we have caching
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

          this.queueActivityUpdates(batchEvents, trackedPubkeys);
        }
      );

      this.queueActivityUpdates(newEvents, trackedPubkeys);
      await this.flushActivityUpdates();

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
    this.refreshWindowCursor = 0;
    this.pendingActivityUpdates.clear();
    if (this.activityFlushTimer) {
      clearTimeout(this.activityFlushTimer);
      this.activityFlushTimer = null;
    }
  }
}
