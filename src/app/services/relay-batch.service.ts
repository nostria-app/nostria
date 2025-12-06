import { Injectable, inject, signal } from '@angular/core';
import { Event } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { UserRelaysService } from './relays/user-relays';
import { RelayPoolService } from './relays/relay-pool';
import { AccountStateService } from './account-state.service';
import { LocalStorageService } from './local-storage.service';
import { UtilitiesService } from './utilities.service';

/**
 * Interface for a batch of pubkeys that share the same relay set
 */
export interface RelayBatch {
  relays: string[];
  pubkeys: string[];
}

/**
 * Interface for batch query result
 */
export interface BatchQueryResult {
  events: Event[];
  pubkeysProcessed: number;
  batchesExecuted: number;
  errors: string[];
}

/**
 * Service for efficiently batching Nostr queries by grouping users with common relays.
 * 
 * This service implements an optimization strategy for fetching events from many users:
 * 1. Groups users by their relay intersection (users who share the same set of relays)
 * 2. Sends batched queries to relay groups instead of individual per-user queries
 * 3. Reduces total number of relay connections needed
 * 
 * Example: If users A, B, C all have relays X, Y, Z in common, we can query X (or Y or Z)
 * once for all 3 users instead of making 3 separate queries.
 */
@Injectable({
  providedIn: 'root',
})
export class RelayBatchService {
  private readonly logger = inject(LoggerService);
  private readonly userRelaysService = inject(UserRelaysService);
  private readonly relayPool = inject(RelayPoolService);
  private readonly accountState = inject(AccountStateService);
  private readonly localStorage = inject(LocalStorageService);
  private readonly utilities = inject(UtilitiesService);

  // Storage key for last app open timestamp
  private readonly LAST_APP_OPEN_KEY = 'nostria-last-app-open';

  // Loading state for UI feedback
  readonly isLoading = signal(false);
  readonly progress = signal({ processed: 0, total: 0, batches: 0 });

  /**
   * Get the timestamp of when the app was last opened.
   * Returns null if never opened before.
   */
  getLastAppOpenTimestamp(): number | null {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return null;

    const key = `${this.LAST_APP_OPEN_KEY}-${pubkey}`;
    const value = this.localStorage.getItem(key);
    return value ? parseInt(value, 10) : null;
  }

  /**
   * Update the last app open timestamp to current time (in seconds).
   */
  updateLastAppOpenTimestamp(): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    const key = `${this.LAST_APP_OPEN_KEY}-${pubkey}`;
    const now = Math.floor(Date.now() / 1000);
    this.localStorage.setItem(key, now.toString());
    this.logger.debug(`[RelayBatchService] Updated last app open timestamp: ${now}`);
  }

  /**
   * Calculate the 'since' timestamp for queries.
   * Uses the earlier of: last app open time OR 24 hours ago.
   * If no last app open, defaults to 24 hours ago.
   */
  calculateSinceTimestamp(): number {
    const lastAppOpen = this.getLastAppOpenTimestamp();
    const now = Math.floor(Date.now() / 1000);
    const twentyFourHoursAgo = now - 24 * 60 * 60;

    if (lastAppOpen === null) {
      return twentyFourHoursAgo;
    }

    // Use whichever is more recent (to limit data but ensure we get new content)
    return Math.max(lastAppOpen, twentyFourHoursAgo);
  }

  /**
   * Check if a relay URL is valid (has wss:// or ws:// protocol and a real domain).
   * Filters out internal URLs like "nostr-idb:cache-relay".
   */
  private isValidRelayUrl(url: string): boolean {
    if (!url) return false;
    try {
      const urlObj = new URL(url);
      // Must be wss:// or ws:// protocol
      if (urlObj.protocol !== 'wss:' && urlObj.protocol !== 'ws:') {
        return false;
      }
      // Must have a real hostname (not internal names like "nostr-idb")
      if (!urlObj.hostname.includes('.')) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Filter an array of relay URLs to only include valid ones.
   */
  private filterValidRelays(relays: string[]): string[] {
    return relays.filter(r => this.isValidRelayUrl(r));
  }

  /**
   * Discover and cache relays for all provided pubkeys in parallel.
   * This is a preparatory step before batching.
   */
  async discoverRelaysForPubkeys(pubkeys: string[]): Promise<Map<string, string[]>> {
    const relayMap = new Map<string, string[]>();

    this.logger.debug(`[RelayBatchService] Discovering relays for ${pubkeys.length} pubkeys...`);

    // Process in batches of 50 to avoid overwhelming the system
    const BATCH_SIZE = 50;
    const batches = [];
    for (let i = 0; i < pubkeys.length; i += BATCH_SIZE) {
      batches.push(pubkeys.slice(i, i + BATCH_SIZE));
    }

    for (const batch of batches) {
      await Promise.all(
        batch.map(async pubkey => {
          try {
            await this.userRelaysService.ensureRelaysForPubkey(pubkey);
            const relays = this.userRelaysService.getRelaysForPubkey(pubkey);
            if (relays.length > 0) {
              relayMap.set(pubkey, relays);
            }
          } catch {
            this.logger.debug(`[RelayBatchService] Failed to discover relays for ${pubkey.slice(0, 8)}...`);
          }
        })
      );
    }

    this.logger.debug(`[RelayBatchService] Discovered relays for ${relayMap.size}/${pubkeys.length} pubkeys`);
    return relayMap;
  }

  /**
   * Group pubkeys by their relay intersection.
   * 
   * Strategy:
   * 1. Find pubkeys that share at least one common relay
   * 2. Group them together to minimize the number of queries
   * 3. For pubkeys with no discovered relays, they'll be in a separate "fallback" group
   */
  groupPubkeysByRelays(relayMap: Map<string, string[]>): RelayBatch[] {
    const batches: RelayBatch[] = [];
    const processedPubkeys = new Set<string>();

    // Convert relay map to an array for easier processing
    const pubkeysWithRelays = Array.from(relayMap.entries());

    // Sort by number of relays (ascending) to process users with fewer relays first
    // This helps create more efficient batches
    pubkeysWithRelays.sort((a, b) => a[1].length - b[1].length);

    for (const [pubkey, relays] of pubkeysWithRelays) {
      if (processedPubkeys.has(pubkey)) continue;

      // Filter and normalize relay URLs for comparison
      const validRelays = this.filterValidRelays(relays);
      if (validRelays.length === 0) continue; // Skip pubkeys with no valid relays

      const normalizedRelays = validRelays.map(r => this.utilities.normalizeRelayUrl(r));

      // Find all other pubkeys that share at least one relay with this one
      const batchPubkeys = [pubkey];
      const sharedRelays = new Set(normalizedRelays);

      for (const [otherPubkey, otherRelays] of pubkeysWithRelays) {
        if (processedPubkeys.has(otherPubkey) || otherPubkey === pubkey) continue;

        const validOtherRelays = this.filterValidRelays(otherRelays);
        if (validOtherRelays.length === 0) continue; // Skip pubkeys with no valid relays

        const normalizedOtherRelays = validOtherRelays.map(r => this.utilities.normalizeRelayUrl(r));

        // Find intersection of relays
        const intersection = normalizedOtherRelays.filter(r => sharedRelays.has(r));

        if (intersection.length > 0) {
          batchPubkeys.push(otherPubkey);
          // Update shared relays to only keep the common ones
          // This ensures we use relays that ALL pubkeys in this batch have in common
          for (const relay of Array.from(sharedRelays)) {
            if (!intersection.includes(relay)) {
              sharedRelays.delete(relay);
            }
          }
        }
      }

      // Mark all pubkeys in this batch as processed
      for (const pk of batchPubkeys) {
        processedPubkeys.add(pk);
      }

      // Create the batch with unique relays
      const batchRelays = Array.from(sharedRelays);

      if (batchRelays.length > 0) {
        batches.push({
          relays: batchRelays.slice(0, 5), // Limit to 5 relays per batch for performance
          pubkeys: batchPubkeys,
        });
      }
    }

    this.logger.debug(
      `[RelayBatchService] Created ${batches.length} batches from ${relayMap.size} pubkeys. ` +
      `Average pubkeys per batch: ${(relayMap.size / batches.length).toFixed(1)}`
    );

    return batches;
  }

  /**
   * Execute a batched query to fetch events from all following users efficiently.
   * 
   * @param pubkeys - Array of pubkeys to fetch events for
   * @param kinds - Event kinds to fetch
   * @param options - Additional options (limit per user, timeout, etc.)
   * @param onEventsReceived - Callback for incremental updates as events arrive
   */
  async fetchEventsFromAllFollowing(
    pubkeys: string[],
    kinds: number[],
    options: {
      limitPerUser?: number;
      timeout?: number;
      useSinceTimestamp?: boolean;
      customSince?: number;
    } = {},
    onEventsReceived?: (events: Event[], batch: RelayBatch) => void
  ): Promise<BatchQueryResult> {
    const {
      limitPerUser = 5,
      timeout = 10000,
      useSinceTimestamp = true,
      customSince,
    } = options;

    this.isLoading.set(true);
    this.progress.set({ processed: 0, total: pubkeys.length, batches: 0 });

    const result: BatchQueryResult = {
      events: [],
      pubkeysProcessed: 0,
      batchesExecuted: 0,
      errors: [],
    };

    try {
      // Step 1: Discover relays for all pubkeys
      this.logger.info(`[RelayBatchService] Starting batch fetch for ${pubkeys.length} pubkeys`);
      const relayMap = await this.discoverRelaysForPubkeys(pubkeys);

      // Step 2: Group pubkeys by shared relays
      const batches = this.groupPubkeysByRelays(relayMap);
      this.logger.info(`[RelayBatchService] Created ${batches.length} relay batches`);

      // Step 3: Calculate 'since' timestamp
      const sinceTimestamp = useSinceTimestamp
        ? (customSince ?? this.calculateSinceTimestamp())
        : undefined;

      if (sinceTimestamp) {
        const sinceDate = new Date(sinceTimestamp * 1000);
        this.logger.info(`[RelayBatchService] Fetching events since: ${sinceDate.toISOString()}`);
      }

      // Step 4: Execute batched queries
      const batchPromises = batches.map(async (batch, index) => {
        try {
          const filter: {
            authors: string[];
            kinds: number[];
            limit: number;
            since?: number;
          } = {
            authors: batch.pubkeys,
            kinds: kinds,
            // Calculate limit: limitPerUser * number of users in batch (capped at 500)
            limit: Math.min(limitPerUser * batch.pubkeys.length, 500),
          };

          if (sinceTimestamp) {
            filter.since = sinceTimestamp;
          }

          this.logger.debug(
            `[RelayBatchService] Batch ${index + 1}/${batches.length}: ` +
            `${batch.pubkeys.length} pubkeys via ${batch.relays.length} relays`
          );

          // Use relay pool to query multiple relays at once
          const events = await new Promise<Event[]>((resolve) => {
            const receivedEvents: Event[] = [];
            let resolved = false;

            // Timeout to ensure we don't wait forever
            setTimeout(() => {
              if (!resolved) {
                resolved = true;
                sub.close();
                resolve(receivedEvents);
              }
            }, timeout);

            const sub = this.relayPool.subscribe(
              batch.relays,
              filter,
              (event: Event) => {
                receivedEvents.push(event);

                // Incremental callback for UI updates
                if (onEventsReceived) {
                  onEventsReceived([event], batch);
                }
              }
            );

            // Since there's no onEose callback, we rely on timeout
            // The timeout will close the subscription and resolve
          });

          result.events.push(...events);
          result.pubkeysProcessed += batch.pubkeys.length;
          result.batchesExecuted++;

          // Update progress
          this.progress.update(p => ({
            ...p,
            processed: p.processed + batch.pubkeys.length,
            batches: p.batches + 1,
          }));

          this.logger.debug(
            `[RelayBatchService] Batch ${index + 1} complete: ${events.length} events`
          );
        } catch (error) {
          result.errors.push(`Batch ${index + 1} failed: ${error}`);
          this.logger.error(`[RelayBatchService] Batch ${index + 1} failed:`, error);
        }
      });

      // Execute batches in parallel (but limit concurrency to 10)
      const CONCURRENT_BATCHES = 10;
      for (let i = 0; i < batchPromises.length; i += CONCURRENT_BATCHES) {
        await Promise.all(batchPromises.slice(i, i + CONCURRENT_BATCHES));
      }

      // Step 5: Handle pubkeys that weren't in any batch (no relays found)
      const processedPubkeys = new Set(batches.flatMap(b => b.pubkeys));
      const unprocessedPubkeys = pubkeys.filter(pk => !processedPubkeys.has(pk));

      if (unprocessedPubkeys.length > 0) {
        this.logger.debug(
          `[RelayBatchService] ${unprocessedPubkeys.length} pubkeys had no relay info - skipped`
        );
      }

      // Deduplicate events by ID
      const eventMap = new Map<string, Event>();
      for (const event of result.events) {
        eventMap.set(event.id, event);
      }
      result.events = Array.from(eventMap.values());

      // Sort by created_at (newest first)
      result.events.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

      this.logger.info(
        `[RelayBatchService] Batch fetch complete: ${result.events.length} unique events ` +
        `from ${result.pubkeysProcessed} pubkeys in ${result.batchesExecuted} batches`
      );

      return result;
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Optimized method specifically for "all-following" column type.
   * Fetches events from ALL following users using the batch strategy.
   */
  async fetchAllFollowingEvents(
    kinds: number[],
    options: {
      limitPerUser?: number;
      timeout?: number;
      since?: number; // Custom since timestamp to fetch only newer events
    } = {},
    onEventsReceived?: (events: Event[]) => void
  ): Promise<Event[]> {
    const followingList = this.accountState.followingList();

    if (followingList.length === 0) {
      this.logger.debug('[RelayBatchService] Following list is empty');
      return [];
    }

    this.logger.info(
      `[RelayBatchService] Fetching events from ALL ${followingList.length} following users`
    );

    const result = await this.fetchEventsFromAllFollowing(
      followingList,
      kinds,
      {
        limitPerUser: options.limitPerUser,
        timeout: options.timeout,
        useSinceTimestamp: true, // Always use time-based filtering for all-following
        customSince: options.since, // Pass custom since if provided
      },
      onEventsReceived ? (events) => onEventsReceived(events) : undefined
    );

    // Update last app open timestamp after successful fetch
    this.updateLastAppOpenTimestamp();

    return result.events;
  }
}
