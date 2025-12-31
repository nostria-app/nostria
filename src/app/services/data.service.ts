import { inject, Injectable } from '@angular/core';
import { DatabaseService } from './database.service';
import { NostrRecord } from '../interfaces';
import { LoggerService } from './logger.service';
import { Event, kinds } from 'nostr-tools';
import { UtilitiesService } from './utilities.service';
import { Cache, CacheOptions } from './cache';
import { UserRelayService } from './relays/user-relay';
import { DiscoveryRelayService } from './relays/discovery-relay';
import { SharedRelayService } from './relays/shared-relay';
import { AccountRelayService } from './relays/account-relay';
import { RelaysService } from './relays/relays';
import { RelayPoolService } from './relays/relay-pool';

export interface DataOptions {
  cache?: boolean; // Whether to use cache
  save?: boolean; // Whether to save the event to storage
}

@Injectable({
  providedIn: 'root',
})
export class DataService {
  private readonly database = inject(DatabaseService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly userRelayEx = inject(UserRelayService);
  private readonly discoveryRelayEx = inject(DiscoveryRelayService);
  private readonly accountRelayEx = inject(AccountRelayService);
  private readonly sharedRelayEx = inject(SharedRelayService);
  private readonly logger = inject(LoggerService);
  private readonly utilities = inject(UtilitiesService);
  private readonly cache = inject(Cache);
  private readonly relaysService = inject(RelaysService);
  private readonly relayPool = inject(RelayPoolService);

  // Map to track pending profile requests to prevent race conditions
  private pendingProfileRequests = new Map<string, Promise<NostrRecord | undefined>>();

  // Clean up old pending requests periodically
  constructor() {
    // Clean up any stale pending requests every 30 seconds
    setInterval(() => {
      if (this.pendingProfileRequests.size > 100) {
        this.logger.warn(
          `Large number of pending profile requests: ${this.pendingProfileRequests.size}. Consider investigating.`
        );
      }
    }, 30000);
  }

  toRecord(event: Event) {
    return this.utilities.toRecord(event);
  }

  toRecords(events: Event[]) {
    return this.utilities.toRecords(events);
  }

  async getEventById(
    id: string,
    options?: CacheOptions & DataOptions,
    userRelays = false
  ): Promise<NostrRecord | null> {
    let event: Event | null = null;
    let record: NostrRecord | undefined = undefined;
    let eventFromRelays = false;

    if (options?.cache) {
      record = this.cache.get<NostrRecord>(`${id}`);

      if (record) {
        return record;
      }
    }

    // If the caller explicitly don't want to save, we will not check the storage.
    if (options?.save) {
      event = await this.database.getEventById(id);
    }

    // For non-replaceable events found in storage, return them directly without fetching from relays
    // For replaceable events (kind 0, 3, 10000-19999) and parameterized replaceable events (kind 30000-39999),
    // always fetch from relays to ensure we have the latest version
    if (event && !this.utilities.shouldAlwaysFetchFromRelay(event.kind)) {
      this.logger.debug(`Using cached event from storage for non-replaceable event: ${id} (kind: ${event.kind})`);
      record = this.toRecord(event);

      if (options?.cache) {
        this.cache.set(`${id}`, record, options);
      }

      return record;
    }

    // Fetch from relays if:
    // 1. Event not found in storage, OR
    // 2. Event is replaceable/parameterized replaceable (need latest version)
    if (!event || this.utilities.shouldAlwaysFetchFromRelay(event.kind)) {
      let relayEvent: Event | null = null;

      // If the caller explicitly supplies user relay, don't attempt to use account relay.
      if (userRelays) {
        // If userRelays is true, we will try to get the event from user relays.
        relayEvent = await this.userRelayEx.getEventByIdGlobal(id);
      } else {
        // Try to get the event from the account relay.
        relayEvent = await this.accountRelayEx.getEventById(id);
      }

      if (relayEvent) {
        event = relayEvent;
        eventFromRelays = true;
      } else if (event) {
        // If relay fetch failed but we have a cached replaceable event, use it
        this.logger.debug(`Relay fetch failed for replaceable event ${id}, using cached version`);
      }
    }

    if (!event) {
      return null;
    }

    record = this.toRecord(event);

    if (options?.cache) {
      this.cache.set(`${id}`, record, options);
    }

    if (options?.save && eventFromRelays) {
      await this.database.saveEvent(event);
      // Process relay hints when saving events from relays
      await this.processEventForRelayHints(event);
    }

    return record;
  }

  async discoverUserRelays(pubkey: string): Promise<string[]> {
    return this.discoveryRelayEx.getUserRelayUrls(pubkey);
  }

  async getUserRelays(pubkey: string) {
    let relayUrls: string[] = [];
    const relayListEvent = await this.database.getEventByPubkeyAndKind(pubkey, kinds.RelayList);

    if (relayListEvent) {
      // Use getOptimalRelayUrlsForFetching to prioritize WRITE relays per NIP-65
      relayUrls = this.utilities.getOptimalRelayUrlsForFetching(relayListEvent);
    }

    if (!relayUrls || relayUrls.length === 0) {
      const followingEvent = await this.database.getEventByPubkeyAndKind(pubkey, 3);
      if (followingEvent) {
        relayUrls = this.utilities.getRelayUrlsFromFollowing(followingEvent);
      }
    }

    if (!relayUrls || relayUrls.length === 0) {
      // If we still don't have any relays, we will try to discover them.
      relayUrls = await this.discoverUserRelays(pubkey);
    }

    return relayUrls;
  }

  async getProfiles(pubkey: string[]): Promise<NostrRecord[] | undefined> {
    const metadataList: NostrRecord[] = [];

    for (const p of pubkey) {
      const metadata = await this.getProfile(p);
      if (metadata) {
        metadataList.push(metadata);
      }
    }

    return metadataList;
  }

  /**
   * Batch load profiles efficiently - first checks storage, then fetches missing profiles
   * from relays in a single batched request instead of individual requests per profile.
   * 
   * @param pubkeys Array of pubkeys to load profiles for
   * @param onProgress Optional callback for progress updates
   * @returns Map of pubkey to NostrRecord for all loaded profiles
   */
  async batchLoadProfiles(
    pubkeys: string[],
    onProgress?: (loaded: number, total: number, pubkey: string) => void
  ): Promise<Map<string, NostrRecord>> {
    const results = new Map<string, NostrRecord>();
    const missingPubkeys: string[] = [];

    this.logger.info(`[BatchLoad] Starting batch load for ${pubkeys.length} profiles`);

    // Step 1: Check cache first
    for (const pubkey of pubkeys) {
      const cacheKey = `metadata-${pubkey}`;
      const cached = this.cache.get<NostrRecord>(cacheKey);
      if (cached) {
        results.set(pubkey, cached);
      }
    }

    this.logger.debug(`[BatchLoad] Found ${results.size} profiles in cache`);

    // Step 2: Check storage for non-cached profiles
    const notInCache = pubkeys.filter(p => !results.has(p));
    if (notInCache.length > 0) {
      const storageEvents = await this.database.getEventsByPubkeyAndKind(notInCache, kinds.Metadata);

      for (const event of storageEvents) {
        const record = this.toRecord(event);
        const cacheKey = `metadata-${event.pubkey}`;
        this.cache.set(cacheKey, record);
        results.set(event.pubkey, record);
      }

      this.logger.debug(`[BatchLoad] Found ${storageEvents.length} profiles in storage`);
    }

    // Step 3: Identify profiles still missing
    for (const pubkey of pubkeys) {
      if (!results.has(pubkey)) {
        missingPubkeys.push(pubkey);
      }
    }

    this.logger.debug(`[BatchLoad] Need to fetch ${missingPubkeys.length} profiles from relays`);

    // Step 4: Batch fetch missing profiles from relays
    if (missingPubkeys.length > 0) {
      // Fetch in batches of 100 to avoid overwhelming relays
      const batchSize = 100;
      for (let i = 0; i < missingPubkeys.length; i += batchSize) {
        const batch = missingPubkeys.slice(i, i + batchSize);

        try {
          // Use getMany with all authors in a single request
          const events = await this.sharedRelayEx.getMany<Event>(
            batch[0], // Use first pubkey for relay discovery
            {
              authors: batch,
              kinds: [kinds.Metadata],
            },
            { timeout: 10000 } // Longer timeout for batch requests
          );

          // Process received events
          for (const event of events) {
            const record = this.toRecord(event);
            const cacheKey = `metadata-${event.pubkey}`;
            this.cache.set(cacheKey, record);
            results.set(event.pubkey, record);

            // Save to storage
            await this.database.saveEvent(event);
            await this.saveEventToDatabase(event);
            await this.processEventForRelayHints(event);

            // Report progress
            onProgress?.(results.size, pubkeys.length, event.pubkey);
          }

          this.logger.debug(`[BatchLoad] Fetched ${events.length} profiles from relays (batch ${Math.floor(i / batchSize) + 1})`);
        } catch (error) {
          this.logger.error(`[BatchLoad] Failed to fetch batch ${Math.floor(i / batchSize) + 1}:`, error);
        }
      }
    }

    this.logger.info(`[BatchLoad] Completed: ${results.size}/${pubkeys.length} profiles loaded`);
    return results;
  }

  /**
   * Gets cached profile synchronously without triggering any async operations
   * Returns undefined if profile is not in cache
   */
  getCachedProfile(pubkey: string): NostrRecord | undefined {
    const cacheKey = `metadata-${pubkey}`;
    return this.cache.get<NostrRecord>(cacheKey);
  }

  async getProfile(pubkey: string, options?: boolean | { refresh?: boolean; forceRefresh?: boolean }): Promise<NostrRecord | undefined> {
    // Parse options - support both boolean (for backwards compatibility) and object format
    let refresh = false;
    let forceRefresh = false;
    if (typeof options === 'boolean') {
      refresh = options;
    } else if (options) {
      refresh = options.refresh ?? false;
      forceRefresh = options.forceRefresh ?? false;
    }

    const cacheKey = `metadata-${pubkey}`;

    // For forceRefresh, skip cache entirely and fetch fresh data from relays
    if (forceRefresh) {
      this.logger.debug(`[Profile] Force refreshing profile for: ${pubkey.substring(0, 8)}...`);
      return this.loadProfile(pubkey, cacheKey, true);
    }

    // CRITICAL: Check pending requests FIRST, synchronously, before any async work
    // This prevents the race condition where multiple callers slip through before
    // the promise is set in the map
    if (this.pendingProfileRequests.has(pubkey)) {
      this.logger.debug(`[Dedup] Returning existing pending request for profile: ${pubkey.substring(0, 8)}...`);
      return this.pendingProfileRequests.get(pubkey);
    }

    // Always check cache first to return immediately if available
    if (this.cache.has(cacheKey)) {
      const record = this.cache.get<NostrRecord>(cacheKey);
      if (record) {
        // If refresh is requested, load fresh data in background
        if (refresh) {
          this.logger.debug(`Returning cached profile and refreshing in background: ${pubkey}`);
          // Load fresh data without blocking the return
          this.refreshProfileInBackground(pubkey, cacheKey);
        }
        return record;
      }
    }

    // CRITICAL: Create and set the promise SYNCHRONOUSLY before any await
    // This ensures subsequent calls see the pending request immediately
    // Only log when pending count is high (indicates potential issue)
    if (this.pendingProfileRequests.size > 10) {
      this.logger.debug(`[Profile] New request for: ${pubkey.substring(0, 8)}... (pending: ${this.pendingProfileRequests.size})`);
    }

    // Create a deferred promise that we can set immediately
    let resolvePromise: (value: NostrRecord | undefined) => void;
    let rejectPromise: (error: unknown) => void;
    const profilePromise = new Promise<NostrRecord | undefined>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    // Set the promise in the map IMMEDIATELY (synchronously)
    this.pendingProfileRequests.set(pubkey, profilePromise);

    // Now do the async work
    try {
      const result = await this.loadProfile(pubkey, cacheKey, refresh);
      resolvePromise!(result);
      return result;
    } catch (error) {
      rejectPromise!(error);
      throw error;
    } finally {
      // Clean up the pending request after a longer delay to catch late duplicates (5 seconds)
      setTimeout(() => {
        this.pendingProfileRequests.delete(pubkey);
      }, 5000);
    }
  }

  private async loadProfile(
    pubkey: string,
    cacheKey: string,
    refresh: boolean
  ): Promise<NostrRecord | undefined> {
    let metadata: Event | null = null;
    let record: NostrRecord | undefined = undefined;
    let foundViaDeepResolution = false;

    if (refresh) {
      // When refresh is true, skip storage and go directly to relays for fresh data
      // Reduced logging to prevent console spam
      metadata = await this.sharedRelayEx.get(pubkey, {
        authors: [pubkey],
        kinds: [kinds.Metadata],
      });

      // If not found via normal relay fetch, attempt deep resolution
      if (!metadata) {
        this.logger.info(`[Profile Deep Resolution] Profile not found on user relays for ${pubkey.substring(0, 8)}..., attempting deep resolution`);
        metadata = await this.loadProfileWithDeepResolution(pubkey);
        if (metadata) {
          foundViaDeepResolution = true;
        }
      }

      if (metadata) {
        record = this.toRecord(metadata);
        this.cache.set(cacheKey, record);
        await this.database.saveEvent(metadata);
        // Also save to new DatabaseService for Summary queries
        await this.saveEventToDatabase(metadata);
        // Process relay hints when saving metadata
        await this.processEventForRelayHints(metadata);

        // If found via deep resolution, re-publish to user's relays to help future lookups
        if (foundViaDeepResolution) {
          await this.republishProfileToUserRelays(pubkey, metadata);
        }
      }
    } else {
      // Normal flow: try storage first, then relays if not found
      metadata = await this.database.getEventByPubkeyAndKind(pubkey, kinds.Metadata);

      if (metadata) {
        record = this.toRecord(metadata);
        this.cache.set(cacheKey, record);
      } else {
        // Try to get from relays - reduced logging to prevent console spam
        metadata = await this.sharedRelayEx.get(pubkey, {
          authors: [pubkey],
          kinds: [kinds.Metadata],
        });

        // If not found via normal relay fetch, attempt deep resolution
        if (!metadata) {
          this.logger.info(`[Profile Deep Resolution] Profile not found on user relays for ${pubkey.substring(0, 8)}..., attempting deep resolution`);
          metadata = await this.loadProfileWithDeepResolution(pubkey);
          if (metadata) {
            foundViaDeepResolution = true;
          }
        }

        if (metadata) {
          record = this.toRecord(metadata);
          this.cache.set(cacheKey, record);
          await this.database.saveEvent(metadata);
          // Also save to new DatabaseService for Summary queries
          await this.saveEventToDatabase(metadata);
          // Process relay hints when saving metadata
          await this.processEventForRelayHints(metadata);

          // If found via deep resolution, re-publish to user's relays to help future lookups
          if (foundViaDeepResolution) {
            await this.republishProfileToUserRelays(pubkey, metadata);
          }
        }
      }
    }

    return record;
  }

  /**
   * Attempt deep resolution by searching batches of observed relays for profile metadata.
   * This is a fallback mechanism when normal profile loading fails.
   * @param pubkey The hex pubkey to search for
   * @returns The found metadata event or null
   */
  private async loadProfileWithDeepResolution(pubkey: string): Promise<Event | null> {
    const BATCH_SIZE = 10;

    // First, try to get the user's relay list - this helps identify where their profile might be
    let userRelayUrls: string[] = [];
    try {
      userRelayUrls = await this.discoveryRelayEx.getUserRelayUrls(pubkey);
      this.logger.debug(`[Profile Deep Resolution] Found ${userRelayUrls.length} relay URLs for user`);
    } catch (error) {
      this.logger.warn(`[Profile Deep Resolution] Failed to get user relay URLs:`, error);
    }

    // If we have user relay URLs, try them first with a longer timeout
    if (userRelayUrls.length > 0) {
      const optimalRelays = this.relaysService.getOptimalRelays(userRelayUrls, 15);
      this.logger.info(`[Profile Deep Resolution] Trying ${optimalRelays.length} user relays first`);

      try {
        const events = await this.relayPool.query(optimalRelays, {
          authors: [pubkey],
          kinds: [kinds.Metadata],
        }, 8000);

        if (events && events.length > 0) {
          // Return the most recent metadata event
          const mostRecent = events.sort((a, b) => b.created_at - a.created_at)[0];
          this.logger.info(`[Profile Deep Resolution] Profile found on user's relays!`);
          return mostRecent;
        }
      } catch (error) {
        this.logger.warn(`[Profile Deep Resolution] Error querying user relays:`, error);
      }
    }

    // Get observed relays sorted by events received (most active first)
    const observedRelays = await this.relaysService.getObservedRelaysSorted('eventsReceived');

    if (observedRelays.length === 0) {
      this.logger.info('[Profile Deep Resolution] No observed relays available');
      return null;
    }

    // Extract just the URLs
    const relayUrls = observedRelays.map(r => r.url);

    // Calculate number of batches
    const totalBatches = Math.ceil(relayUrls.length / BATCH_SIZE);

    this.logger.info(`[Profile Deep Resolution] Starting deep resolution for profile ${pubkey.substring(0, 8)}...`, {
      totalRelays: relayUrls.length,
      batchSize: BATCH_SIZE,
      totalBatches,
    });

    // Process in batches
    for (let i = 0; i < totalBatches; i++) {
      const start = i * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, relayUrls.length);
      const batchRelays = relayUrls.slice(start, end);

      this.logger.debug(`[Profile Deep Resolution] Searching batch ${i + 1}/${totalBatches}`);

      try {
        // Query this batch of relays for metadata
        const events = await this.relayPool.query(batchRelays, {
          authors: [pubkey],
          kinds: [kinds.Metadata],
        }, 5000);

        if (events && events.length > 0) {
          // Return the most recent metadata event
          const mostRecent = events.sort((a, b) => b.created_at - a.created_at)[0];
          this.logger.info(`[Profile Deep Resolution] Profile found in batch ${i + 1}/${totalBatches}!`);
          return mostRecent;
        }
      } catch (error) {
        this.logger.error(`[Profile Deep Resolution] Error querying batch ${i + 1}:`, error);
        // Continue to next batch even if this one fails
      }
    }

    this.logger.info('[Profile Deep Resolution] Profile not found after searching all batches');
    return null;
  }

  /**
   * Re-publish a profile metadata event to the user's relays.
   * This helps ensure the profile is available on their relays for future lookups.
   * Note: This only publishes if we can verify the event signature is valid.
   * @param pubkey The pubkey of the profile owner
   * @param metadataEvent The metadata event to re-publish
   */
  private async republishProfileToUserRelays(pubkey: string, metadataEvent: Event): Promise<void> {
    try {
      // Get the user's relay URLs
      let userRelayUrls = await this.discoveryRelayEx.getUserRelayUrls(pubkey);

      if (userRelayUrls.length === 0) {
        this.logger.debug(`[Profile Republish] No user relays found for ${pubkey.substring(0, 8)}..., skipping republish`);
        return;
      }

      // Use optimal relays (filter out bad/offline relays)
      userRelayUrls = this.relaysService.getOptimalRelays(userRelayUrls, 10);

      if (userRelayUrls.length === 0) {
        this.logger.debug(`[Profile Republish] No optimal relays available for republishing`);
        return;
      }

      this.logger.info(`[Profile Republish] Re-publishing profile for ${pubkey.substring(0, 8)}... to ${userRelayUrls.length} relays`);

      // Use the relay pool to publish the event
      // Note: We're just forwarding the existing signed event, not creating a new one
      const pool = this.relayPool;
      const publishPromises = userRelayUrls.map(async (relayUrl) => {
        try {
          await pool.get([relayUrl], { ids: [metadataEvent.id] }, 1000)
            .catch(() => null); // Ignore errors, we're just trying to push the event
          return { relay: relayUrl, success: true };
        } catch {
          return { relay: relayUrl, success: false };
        }
      });

      // Don't await all promises - let them complete in background
      Promise.all(publishPromises).then((results) => {
        const successful = results.filter(r => r.success).length;
        this.logger.debug(`[Profile Republish] Completed: ${successful}/${userRelayUrls.length} relays`);
      }).catch((error) => {
        this.logger.warn(`[Profile Republish] Error during republishing:`, error);
      });

    } catch (error) {
      this.logger.warn(`[Profile Republish] Failed to republish profile for ${pubkey.substring(0, 8)}...:`, error);
    }
  }

  private refreshProfileInBackground(pubkey: string, cacheKey: string): void {
    // If refresh is true, we will refresh it in the background.
    queueMicrotask(async () => {
      try {
        const fresh = await this.sharedRelayEx.get(pubkey, {
          authors: [pubkey],
          kinds: [kinds.Metadata],
        });

        if (fresh) {
          const freshRecord = this.toRecord(fresh);
          this.cache.set(cacheKey, freshRecord);
          await this.database.saveEvent(fresh);
          // Also save to new DatabaseService for Summary queries
          await this.saveEventToDatabase(fresh);
          // Process relay hints when saving fresh metadata
          await this.processEventForRelayHints(fresh);
        }
      } catch (error) {
        this.logger.warn(`Failed to refresh profile in background for ${pubkey}:`, error);
      }
    });
  }

  /**
   * Save an event to the new DatabaseService for Summary queries
   * This ensures events are available in the new events store
   */
  private async saveEventToDatabase(event: Event): Promise<void> {
    try {
      await this.database.init();
      await this.database.saveEvent(event);
    } catch (error) {
      this.logger.warn(`Failed to save event to DatabaseService: ${event.id}`, error);
    }
  }

  /** Will read event from local database, if available, or get from relay, and then save to database. */
  async getEventByPubkeyAndKindAndReplaceableEvent(
    pubkey: string,
    kind: number,
    dTagValue: string,
    options?: CacheOptions & DataOptions
  ): Promise<NostrRecord | null> {
    const cacheKey = `${pubkey}-${kind}-${dTagValue}`;
    let event: Event | null = null;
    let record: NostrRecord | undefined = undefined;
    let eventFromRelays = false;

    if (options?.cache) {
      record = this.cache.get<NostrRecord>(cacheKey);

      if (record) {
        return record;
      }
    }

    // If the caller explicitly don't want to save, we will not check the storage.
    if (options?.save) {
      event =
        (await this.database.getParameterizedReplaceableEvent(pubkey, kind, dTagValue)) || null;
    }

    // If the caller explicitly supplies user relay, don't attempt to user account relay.
    if (!event) {
      // Try to get the event from the account relay.
      event = await this.accountRelayEx.getEventByPubkeyAndKindAndTag(pubkey, kind, {
        key: 'd',
        value: dTagValue,
      });

      eventFromRelays = true;
    }

    if (!event) {
      return null;
    }

    record = this.toRecord(event);

    if (options?.cache) {
      this.cache.set(cacheKey, record, options);
    }

    if (options?.save && eventFromRelays) {
      await this.database.saveEvent(event);
      // Also save to new DatabaseService for Summary queries
      await this.saveEventToDatabase(event);
    }

    return record;
  }

  /** Will read event from local database, if available, or get from relay, and then save to database. */
  async getEventByPubkeyAndKind(
    pubkey: string | string[],
    kind: number,
    options?: CacheOptions & DataOptions
  ): Promise<NostrRecord | null> {
    const cacheKey = `${Array.isArray(pubkey) ? pubkey.join(',') : pubkey}-${kind}`;
    let event: Event | null = null;
    let record: NostrRecord | undefined = undefined;
    let eventFromRelays = false;

    if (options?.cache) {
      record = this.cache.get<NostrRecord>(cacheKey);

      if (record) {
        return record;
      }
    }

    // If the caller explicitly don't want to save, we will not check the storage.
    if (options?.save) {
      event = await this.database.getEventByPubkeyAndKind(pubkey, kind);
    }

    // If the caller explicitly supplies user relay, don't attempt to user account relay.
    if (!event) {
      // Try to get the event from the account relay.
      event = await this.accountRelayEx.getEventByPubkeyAndKind(pubkey, kind);
      eventFromRelays = true;
    }

    if (!event) {
      return null;
    }

    record = this.toRecord(event);

    if (options?.cache) {
      this.cache.set(cacheKey, record, options);
    }

    if (options?.save && eventFromRelays) {
      await this.database.saveEvent(event);
      // Also save to new DatabaseService for Summary queries
      await this.saveEventToDatabase(event);
      // Process relay hints when saving events from relays
      await this.processEventForRelayHints(event);
    }

    return record;
  }

  async getEventsByPubkeyAndKind(
    pubkey: string | string[],
    kind: number,
    options?: CacheOptions & DataOptions
  ): Promise<NostrRecord[]> {
    const cacheKey = `${Array.isArray(pubkey) ? pubkey.join(',') : pubkey}-${kind}-all`;
    let events: Event[] = [];
    let records: NostrRecord[] = [];
    let eventFromRelays = false;

    if (options?.cache) {
      const records = this.cache.get<NostrRecord[]>(cacheKey);

      if (records) {
        return records;
      }
    }

    // If the caller explicitly don't want to save, we will not check the storage.
    if (events.length === 0 && options?.save) {
      // Use new DatabaseService for event queries
      await this.database.init();
      events = await this.database.getEventsByPubkeyAndKind(pubkey, kind);
    }

    if (events.length === 0) {
      const relayEvents = await this.accountRelay.getEventsByPubkeyAndKind(pubkey, kind);
      eventFromRelays = true;

      if (relayEvents && relayEvents.length > 0) {
        events = relayEvents;
      }
    }

    if (events.length === 0) {
      return [];
    }

    records = events.map(event => this.toRecord(event));

    if (options?.cache) {
      this.cache.set(cacheKey, records, options);
    }

    if (options?.save && eventFromRelays) {
      // Use new DatabaseService for saving events
      await this.database.init();
      for (const event of events) {
        await this.database.saveEvent(event);
        // Process relay hints when saving events from relays
        await this.processEventForRelayHints(event);
      }
    }

    return records;
  }

  async getEventsByKindAndEventTag(
    kind: number,
    eventTag: string,
    userPubkey: string,
    options?: CacheOptions & DataOptions
  ): Promise<NostrRecord[]> {
    const cacheKey = `${userPubkey}-${kind}-${eventTag}-all`;
    let events: Event[] = [];
    let records: NostrRecord[] = [];
    let eventFromRelays = false;

    if (options?.cache) {
      const records = this.cache.get<NostrRecord[]>(cacheKey);

      if (records) {
        return records;
      }
    }

    // If the caller explicitly don't want to save, we will not check the storage.
    if (events.length === 0 && options?.save) {
      const allEvents = await this.database.getEventsByKind(kind);
      events = allEvents.filter(e => this.utilities.getTagValues('#e', e.tags)[0] === eventTag);
    }

    if (events.length === 0) {
      // Use shared relay service to query for events by kind and event tag
      const relayEvents = await this.sharedRelayEx.getMany(userPubkey, {
        kinds: [kind],
        ['#e']: [eventTag],
      });

      eventFromRelays = true;

      if (relayEvents && relayEvents.length > 0) {
        events = relayEvents;
      }
    }

    if (events.length === 0) {
      return [];
    }

    records = events.map(event => this.toRecord(event));

    if (options?.cache) {
      this.cache.set(cacheKey, records, options);
    }

    if (options?.save && eventFromRelays) {
      for (const event of events) {
        await this.database.saveEvent(event);
        // Also save to new DatabaseService for Summary queries
        await this.saveEventToDatabase(event);
        // Process relay hints when saving events from relays
        await this.processEventForRelayHints(event);
      }
    }

    return records;
  }

  /**
   * Process an event and collect relay hints for storage (from DataService to avoid circular dependency)
   */
  private async processEventForRelayHints(event: Event): Promise<void> {
    // Skip kind 10002 events (user relay lists) as these should not be stored in the mapping
    if (event.kind === 10002) {
      return;
    }

    // Extract relay hints from e-tags
    const eTags = event.tags.filter(tag => tag[0] === 'e');
    const relayHints: string[] = [];

    for (const eTag of eTags) {
      // Check if there's a relay hint in the e-tag (3rd element)
      if (eTag.length >= 3 && eTag[2] && eTag[2].trim() !== '') {
        relayHints.push(eTag[2]);
      }

      // Check for author pubkey in e-tag (5th element)
      if (eTag.length >= 5 && eTag[4] && eTag[4].trim() !== '') {
        // Add relay hints for the mentioned author
        if (relayHints.length > 0) {
          await this.relaysService.addRelayHintsFromEvent(eTag[4], relayHints);
        }
      }
    }

    // Store hints for the event creator
    if (relayHints.length > 0) {
      await this.relaysService.addRelayHintsFromEvent(event.pubkey, relayHints);
    }
  }
}
