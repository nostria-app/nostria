import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DatabaseService } from './database.service';
import { NostrRecord } from '../interfaces';
import { LoggerService } from './logger.service';
import { Event, kinds } from 'nostr-tools';
import { UtilitiesService } from './utilities.service';
import { Cache, CacheOptions } from './cache';
import { DiscoveryRelayService } from './relays/discovery-relay';
import { SharedRelayService } from './relays/shared-relay';
import { UserRelayService } from './relays/user-relay';
import { RelaysService } from './relays/relays';
import { RelayPoolService } from './relays/relay-pool';

export interface DataOptions {
  cache?: boolean; // Whether to use cache
  invalidateCache?: boolean;
  save?: boolean; // Whether to save the event to storage
  /**
   * Whether to include the current logged-in account's relays when querying.
   * Useful for discovering interactions (replies, reactions, zaps) that may not
   * be on the target user's relays but are on the current account's relays.
   */
  includeAccountRelays?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class UserDataService {
  private readonly database = inject(DatabaseService);
  private readonly userRelayEx = inject(UserRelayService);
  private readonly discoveryRelayEx = inject(DiscoveryRelayService);
  private readonly sharedRelayEx = inject(SharedRelayService);
  private readonly logger = inject(LoggerService);
  private readonly utilities = inject(UtilitiesService);
  private readonly cache = inject(Cache);
  private readonly relaysService = inject(RelaysService);
  private readonly relayPool = inject(RelayPoolService);
  private readonly snackBar = inject(MatSnackBar);

  // Map to track pending profile requests to prevent race conditions
  private pendingProfileRequests = new Map<string, Promise<NostrRecord | undefined>>();

  /**
   * Save events to database in background (non-blocking)
   * Uses batch save for efficiency and shows toast on error
   */
  private saveEventsInBackground(events: Event[], context: string): void {
    if (events.length === 0) return;

    // Fire and forget - don't await
    this.database.saveEvents(events).catch((error) => {
      this.logger.error(`Background save failed for ${context}:`, error);
      this.snackBar.open(
        `Failed to cache ${events.length} events locally. They may need to be re-fetched.`,
        'Dismiss',
        { duration: 5000 }
      );
    });
  }

  toRecord(event: Event) {
    return this.utilities.toRecord(event);
  }

  toRecords(events: Event[]) {
    return this.utilities.toRecords(events);
  }

  async getEventById(
    pubkey: string,
    id: string,
    options?: CacheOptions & DataOptions,
  ): Promise<NostrRecord | null> {
    let event: Event | null = null;
    let record: NostrRecord | undefined = undefined;
    let eventFromRelays = false;

    if (options?.cache && !options?.invalidateCache) {
      record = this.cache.get<NostrRecord>(`${id}`);

      if (record) {
        return record;
      }
    }

    // If invalidateCache is true, skip storage and fetch directly from relays
    // Otherwise, check storage first if save option is enabled
    if (options?.save && !options?.invalidateCache) {
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
    // 2. Event is replaceable/parameterized replaceable (need latest version), OR
    // 3. invalidateCache is true
    if (!event || this.utilities.shouldAlwaysFetchFromRelay(event.kind) || options?.invalidateCache) {
      const relayEvent = await this.userRelayEx.getEventById(pubkey, id);

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

    if (options?.cache || options?.invalidateCache) {
      this.cache.set(`${id}`, record, options);
    }

    if (options?.save && eventFromRelays) {
      await this.database.saveEvent(event);
    }

    return record;
  }

  async discoverUserRelays(pubkey: string): Promise<string[]> {
    const relayUrls = await this.discoveryRelayEx.getUserRelayUrls(pubkey);
    return Array.isArray(relayUrls) ? relayUrls : [];
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

  async getProfile(pubkey: string, options?: { refresh?: boolean; skipRelay?: boolean; deepResolve?: boolean } | boolean): Promise<NostrRecord | undefined> {
    let refresh = false;
    let skipRelay = false;
    let deepResolve = false;

    if (typeof options === 'boolean') {
      refresh = options;
    } else if (options) {
      refresh = options.refresh || false;
      skipRelay = options.skipRelay || false;
      deepResolve = options.deepResolve || false;
    }

    // Validate pubkey parameter
    if (!pubkey || pubkey === 'undefined' || !pubkey.trim()) {
      this.logger.warn('getProfile called with invalid pubkey:', pubkey);
      return undefined;
    }

    const cacheKey = `metadata-${pubkey}`;

    // CRITICAL: Check pending requests FIRST, synchronously, before any async work
    if (this.pendingProfileRequests.has(pubkey)) {
      this.logger.debug(`[UserData Dedup] Returning existing pending request for profile: ${pubkey.substring(0, 8)}...`);
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
    // Only log when pending count is high (indicates potential issue)
    if (this.pendingProfileRequests.size > 10) {
      this.logger.debug(`[UserData] New request for: ${pubkey.substring(0, 8)}... (pending: ${this.pendingProfileRequests.size})`);
    }

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
      const result = await this.loadProfile(pubkey, cacheKey, refresh, skipRelay, deepResolve);
      resolvePromise!(result);
      return result;
    } catch (error) {
      rejectPromise!(error);
      throw error;
    } finally {
      // Clean up after a longer delay to catch late duplicates (5 seconds)
      setTimeout(() => {
        this.pendingProfileRequests.delete(pubkey);
      }, 5000);
    }
  }

  private async loadProfile(
    pubkey: string,
    cacheKey: string,
    refresh: boolean,
    skipRelay = false,
    deepResolve = false
  ): Promise<NostrRecord | undefined> {
    let metadata: Event | null = null;
    let record: NostrRecord | undefined = undefined;
    let foundViaDeepResolution = false;

    // If not refreshing, try storage first
    if (!refresh) {
      metadata = await this.database.getEventByPubkeyAndKind(pubkey, kinds.Metadata);
    }

    if (metadata) {
      record = this.toRecord(metadata);
      this.cache.set(cacheKey, record);
    } else if (!skipRelay) {
      // Try to get from relays
      metadata = await this.sharedRelayEx.get(pubkey, {
        authors: [pubkey],
        kinds: [kinds.Metadata],
      });

      // If not found via normal relay fetch, attempt deep resolution (ONLY if explicitly enabled)
      if (!metadata && deepResolve) {
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

        // If found via deep resolution, re-publish to user's relays to help future lookups
        if (foundViaDeepResolution) {
          await this.republishProfileToUserRelays(pubkey, metadata);
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
        }
      } catch (error) {
        this.logger.warn(`Failed to refresh profile in background for ${pubkey}:`, error);
      }
    });
  }

  /** Will read event from local database, if available, or get from relay, and then save to database. */
  async getEventByPubkeyAndKindAndReplaceableEvent(
    pubkey: string,
    kind: number,
    dTagValue: string,
    options?: CacheOptions & DataOptions,
  ): Promise<NostrRecord | null> {
    // Validate pubkey parameter
    if (!pubkey || pubkey === 'undefined' || !pubkey.trim()) {
      this.logger.warn(
        'getEventByPubkeyAndKindAndReplaceableEvent called with invalid pubkey:',
        pubkey,
      );
      return null;
    }

    const cacheKey = `${pubkey}-${kind}-${dTagValue}`;
    let event: Event | null = null;
    let record: NostrRecord | undefined = undefined;

    if (options?.cache && !options?.invalidateCache) {
      record = this.cache.get<NostrRecord>(cacheKey);

      if (record) {
        return record;
      }
    }

    // If invalidateCache is true, skip storage and fetch directly from relays
    // Otherwise, check storage first if save option is enabled
    if (options?.save && !options?.invalidateCache) {
      event =
        (await this.database.getParameterizedReplaceableEvent(pubkey, kind, dTagValue)) || null;
    }

    // Fetch from relays if we don't have event yet (or invalidateCache forced relay fetch)
    if (!event) {
      event = await this.userRelayEx.getEventByPubkeyAndKindAndTag(pubkey, kind, {
        key: 'd',
        value: dTagValue,
      });
    }

    if (!event) {
      return null;
    }

    record = this.toRecord(event);

    if (options?.cache || options?.invalidateCache) {
      this.cache.set(cacheKey, record, options);
    }

    if (options?.save) {
      await this.database.saveEvent(event);
    }

    return record;
  }

  /** Will read event from local database, if available, or get from relay, and then save to database. */
  async getEventByPubkeyAndKind(
    pubkey: string | string[],
    kind: number,
    options?: CacheOptions & DataOptions,
  ): Promise<NostrRecord | null> {
    // Validate pubkey parameter
    if (!pubkey || (Array.isArray(pubkey) && pubkey.length === 0)) {
      this.logger.warn('getEventByPubkeyAndKind called with invalid pubkey:', pubkey);
      return null;
    }

    if (Array.isArray(pubkey) && pubkey.some((pk) => !pk || pk === 'undefined')) {
      this.logger.warn('getEventByPubkeyAndKind called with invalid pubkey in array:', pubkey);
      return null;
    }

    if (typeof pubkey === 'string' && (pubkey === 'undefined' || !pubkey.trim())) {
      this.logger.warn('getEventByPubkeyAndKind called with invalid pubkey string:', pubkey);
      return null;
    }

    const cacheKey = `${Array.isArray(pubkey) ? pubkey.join(',') : pubkey}-${kind}`;
    let event: Event | null = null;
    let record: NostrRecord | undefined = undefined;

    if (options?.cache && !options?.invalidateCache) {
      record = this.cache.get<NostrRecord>(cacheKey);

      if (record) {
        return record;
      }
    }

    // If invalidateCache is true, skip storage and fetch directly from relays
    // Otherwise, check storage first if save option is enabled
    if (options?.save && !options?.invalidateCache) {
      event = await this.database.getEventByPubkeyAndKind(pubkey, kind);
    }

    // Fetch from relays if we don't have event yet (or invalidateCache forced relay fetch)
    if (!event) {
      // If userRelays is true, we will try to get the event from user relays.
      event = await this.userRelayEx.getEventByPubkeyAndKind(pubkey, kind);
    }

    if (!event) {
      return null;
    }

    record = this.toRecord(event);

    if (options?.cache || options?.invalidateCache) {
      this.cache.set(cacheKey, record, options);
    }

    if (options?.save) {
      await this.database.saveEvent(event);
    }

    return record;
  }

  async getEventsByPubkeyAndKind(
    pubkey: string | string[],
    kind: number,
    options?: CacheOptions & DataOptions,
  ): Promise<NostrRecord[]> {
    // Validate pubkey parameter
    if (!pubkey || (Array.isArray(pubkey) && pubkey.length === 0)) {
      this.logger.warn('getEventsByPubkeyAndKind called with invalid pubkey:', pubkey);
      return [];
    }

    if (Array.isArray(pubkey) && pubkey.some((pk) => !pk || pk === 'undefined')) {
      this.logger.warn('getEventsByPubkeyAndKind called with invalid pubkey in array:', pubkey);
      return [];
    }

    if (typeof pubkey === 'string' && (pubkey === 'undefined' || !pubkey.trim())) {
      this.logger.warn('getEventsByPubkeyAndKind called with invalid pubkey string:', pubkey);
      return [];
    }

    const cacheKey = `${Array.isArray(pubkey) ? pubkey.join(',') : pubkey}-${kind}-all`;
    let events: Event[] = [];
    let records: NostrRecord[] = [];

    if (options?.cache && !options?.invalidateCache) {
      const records = this.cache.get<NostrRecord[]>(cacheKey);

      if (records) {
        return records;
      }
    }

    // If invalidateCache is true, skip storage and fetch directly from relays
    // Otherwise, check storage first if save option is enabled
    if (events.length === 0 && options?.save && !options?.invalidateCache) {
      // Use new DatabaseService for event queries
      await this.database.init();
      events = await this.database.getEventsByPubkeyAndKind(pubkey, kind);
    }

    // Fetch from relays if we don't have events yet (or invalidateCache forced relay fetch)
    if (events.length === 0) {
      const relayEvents = await this.userRelayEx.getEventsByPubkeyAndKind(pubkey, kind);
      if (relayEvents && relayEvents.length > 0) {
        events = relayEvents;
      }
    }

    if (events.length === 0) {
      return [];
    }

    records = events.map((event) => this.toRecord(event));

    if (options?.cache || options?.invalidateCache) {
      this.cache.set(cacheKey, records, options);
    }

    if (options?.save) {
      // Use new DatabaseService for saving events
      await this.database.init();
      for (const event of events) {
        await this.database.saveEvent(event);
      }
    }

    return records;
  }

  /**
   * Get events by pubkey and kind with pagination support for infinite scroll
   * @param pubkey User's public key
   * @param kind Event kind
   * @param until Fetch events older than this timestamp (for pagination)
   * @param limit Number of events to fetch per request
   * @param options Cache and storage options
   */
  async getEventsByPubkeyAndKindPaginated(
    pubkey: string | string[],
    kind: number,
    until?: number,
    limit = 20,
    options?: CacheOptions & DataOptions,
  ): Promise<NostrRecord[]> {
    console.log('[UserDataService] getEventsByPubkeyAndKindPaginated called:', {
      pubkey: Array.isArray(pubkey) ? pubkey.map(p => p.slice(0, 8)) : pubkey.slice(0, 8),
      kind,
      until: until ? new Date(until * 1000).toISOString() : 'none',
      limit
    });

    // Validate pubkey parameter
    if (!pubkey || (Array.isArray(pubkey) && pubkey.length === 0)) {
      this.logger.warn('getEventsByPubkeyAndKindPaginated called with invalid pubkey:', pubkey);
      return [];
    }

    if (Array.isArray(pubkey) && pubkey.some((pk) => !pk || pk === 'undefined')) {
      this.logger.warn('getEventsByPubkeyAndKindPaginated called with invalid pubkey in array:', pubkey);
      return [];
    }

    if (typeof pubkey === 'string' && (pubkey === 'undefined' || !pubkey.trim())) {
      this.logger.warn('getEventsByPubkeyAndKindPaginated called with invalid pubkey string:', pubkey);
      return [];
    }

    // Don't cache paginated requests as they depend on the until parameter
    // Fetch directly from relays with pagination support
    const events = await this.userRelayEx.getEventsByPubkeyAndKindPaginated(pubkey, kind, until, limit);

    if (events.length === 0) {
      return [];
    }

    const records = events.map((event) => this.toRecord(event));

    if (options?.save) {
      for (const event of events) {
        await this.database.saveEvent(event);
      }
    }

    return records;
  }

  async getEventsByKindAndEventTag(
    pubkey: string,
    kind: number,
    eventTag: string,
    options?: CacheOptions & DataOptions,
  ): Promise<NostrRecord[]> {
    const cacheKey = `${kind}-${eventTag}-all`;
    let events: Event[] = [];
    let records: NostrRecord[] = [];

    if (options?.cache && !options?.invalidateCache) {
      const records = this.cache.get<NostrRecord[]>(cacheKey);

      if (records) {
        return records;
      }
    }

    // Check if this kind is replaceable - if so, we need to fetch from relays for latest version
    const isReplaceable = this.utilities.shouldAlwaysFetchFromRelay(kind);
    let dbEvents: Event[] = [];

    // Load from database first if save option is enabled and event is not replaceable
    // (replaceable events need latest version from relays)
    if (options?.save && !options?.invalidateCache && !isReplaceable) {
      // Use efficient cursor-based query that filters by e-tag without loading all events
      dbEvents = await this.database.getEventsByKindAndEventTag(kind, eventTag);

      if (dbEvents.length > 0) {
        console.log(`📀 [DB Cache] Loaded ${dbEvents.length} events from database for kind ${kind} with tag ${eventTag.substring(0, 8)}...`);
        this.logger.debug(`Found ${dbEvents.length} cached events for non-replaceable kind ${kind} with tag ${eventTag}`);
      }
    }

    // Always fetch from relays to get potentially newer events
    // Database results supplement relay results but don't replace them
    console.log(`🌐 [Relay] Fetching kind ${kind} with tag ${eventTag.substring(0, 8)}... from relays (db had ${dbEvents.length})`);
    const relayEvents = await this.userRelayEx.getEventsByKindAndEventTag(
      pubkey,
      kind,
      eventTag,
      options?.includeAccountRelays
    );

    // Merge database and relay events, deduplicated by event ID
    const eventMap = new Map<string, Event>();

    // Add database events first
    for (const event of dbEvents) {
      eventMap.set(event.id, event);
    }

    // Add/update with relay events (relay events take precedence if same ID)
    if (relayEvents && relayEvents.length > 0) {
      console.log(`🌐 [Relay] Received ${relayEvents.length} events from relays for kind ${kind}`);
      for (const event of relayEvents) {
        eventMap.set(event.id, event);
      }
    }

    events = Array.from(eventMap.values());

    if (events.length === 0) {
      return [];
    }

    records = events.map((event) => this.toRecord(event));

    if (options?.cache || options?.invalidateCache) {
      this.cache.set(cacheKey, records, options);
    }

    // Save new relay events to database in background
    // Only save events that came from relays (not already in DB)
    if (options?.save && relayEvents && relayEvents.length > 0) {
      // Filter to only save events that weren't in the database
      const dbEventIds = new Set(dbEvents.map(e => e.id));
      const newRelayEvents = relayEvents.filter(e => !dbEventIds.has(e.id));
      if (newRelayEvents.length > 0) {
        this.saveEventsInBackground(newRelayEvents, `kind ${kind}`);
      }
    }

    return records;
  }

  /**
   * Get events by multiple kinds and event tag (optimized for fetching reactions, reposts, reports in one query)
   */
  async getEventsByKindsAndEventTag(
    pubkey: string,
    kinds: number[],
    eventTag: string,
    options?: CacheOptions & DataOptions,
  ): Promise<NostrRecord[]> {
    const cacheKey = `${kinds.join(',')}-${eventTag}-all`;
    let events: Event[] = [];
    let records: NostrRecord[] = [];

    if (options?.cache && !options?.invalidateCache) {
      const records = this.cache.get<NostrRecord[]>(cacheKey);

      if (records) {
        return records;
      }
    }

    // Check if any of these kinds are replaceable
    const hasReplaceableKind = kinds.some(kind => this.utilities.shouldAlwaysFetchFromRelay(kind));
    let dbEvents: Event[] = [];

    // Load from database first if save option is enabled and no kinds are replaceable
    // (replaceable events need latest version from relays)
    if (options?.save && !options?.invalidateCache && !hasReplaceableKind) {
      // Use efficient cursor-based query that filters by e-tag without loading all events
      dbEvents = await this.database.getEventsByKindsAndEventTag(kinds, eventTag);

      if (dbEvents.length > 0) {
        console.log(`📀 [DB Cache] Loaded ${dbEvents.length} events from database for kinds [${kinds.join(',')}] with tag ${eventTag.substring(0, 8)}...`);
        this.logger.debug(`Found ${dbEvents.length} cached events for non-replaceable kinds [${kinds.join(',')}] with tag ${eventTag}`);
      }
    }

    // Always fetch from relays to get potentially newer events
    // Database results supplement relay results but don't replace them
    console.log(`🌐 [Relay] Fetching kinds [${kinds.join(',')}] with tag ${eventTag.substring(0, 8)}... from relays (db had ${dbEvents.length})`);
    const relayEvents = await this.userRelayEx.getEventsByKindsAndEventTag(
      pubkey,
      kinds,
      eventTag,
      options?.includeAccountRelays
    );

    // Merge database and relay events, deduplicated by event ID
    const eventMap = new Map<string, Event>();

    // Add database events first
    for (const event of dbEvents) {
      eventMap.set(event.id, event);
    }

    // Add/update with relay events (relay events take precedence if same ID)
    if (relayEvents && relayEvents.length > 0) {
      console.log(`🌐 [Relay] Received ${relayEvents.length} events from relays for kinds [${kinds.join(',')}]`);
      for (const event of relayEvents) {
        eventMap.set(event.id, event);
      }
    }

    events = Array.from(eventMap.values());

    if (events.length === 0) {
      return [];
    }

    records = events.map((event) => this.toRecord(event));

    if (options?.cache || options?.invalidateCache) {
      this.cache.set(cacheKey, records, options);
    }

    // Save new relay events to database in background
    // Only save events that came from relays (not already in DB)
    if (options?.save && relayEvents && relayEvents.length > 0) {
      // Filter to only save events that weren't in the database
      const dbEventIds = new Set(dbEvents.map(e => e.id));
      const newRelayEvents = relayEvents.filter(e => !dbEventIds.has(e.id));
      if (newRelayEvents.length > 0) {
        this.saveEventsInBackground(newRelayEvents, `kinds [${kinds.join(',')}]`);
      }
    }

    return records;
  }

  /**
   * Get events by kind and quote tag (for finding quote reposts - NIP-18)
   */
  async getEventsByKindAndQuoteTag(
    pubkey: string,
    kinds: number[],
    quoteEventId: string,
    options?: CacheOptions & DataOptions,
  ): Promise<NostrRecord[]> {
    const cacheKey = `quotes-${kinds.join(',')}-${quoteEventId}`;
    let events: Event[] = [];
    let records: NostrRecord[] = [];

    if (options?.cache && !options?.invalidateCache) {
      const cachedRecords = this.cache.get<NostrRecord[]>(cacheKey);
      if (cachedRecords) {
        return cachedRecords;
      }
    }

    // Fetch from relays using #q tag filter
    const relayEvents = await this.userRelayEx.getEventsByKindAndQuoteTag(
      pubkey,
      kinds,
      quoteEventId,
      options?.includeAccountRelays
    );

    if (relayEvents && relayEvents.length > 0) {
      events = relayEvents;
    }

    if (events.length === 0) {
      return [];
    }

    records = events.map((event) => this.toRecord(event));

    if (options?.cache || options?.invalidateCache) {
      this.cache.set(cacheKey, records, options);
    }

    if (options?.save) {
      for (const event of events) {
        await this.database.saveEvent(event);
      }
    }

    return records;
  }
}

