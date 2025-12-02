import { Injectable, inject } from '@angular/core';
import { DatabaseService } from './database.service';
import { NostrRecord } from '../interfaces';
import { LoggerService } from './logger.service';
import { Event, kinds } from 'nostr-tools';
import { UtilitiesService } from './utilities.service';
import { Cache, CacheOptions } from './cache';
import { DiscoveryRelayService } from './relays/discovery-relay';
import { SharedRelayService } from './relays/shared-relay';
import { UserRelayService } from './relays/user-relay';

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

  // Map to track pending profile requests to prevent race conditions
  private pendingProfileRequests = new Map<string, Promise<NostrRecord | undefined>>();

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
      relayUrls = this.utilities.getRelayUrls(relayListEvent);
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

  async getProfile(pubkey: string, options?: { refresh?: boolean; skipRelay?: boolean } | boolean): Promise<NostrRecord | undefined> {
    let refresh = false;
    let skipRelay = false;

    if (typeof options === 'boolean') {
      refresh = options;
    } else if (options) {
      refresh = options.refresh || false;
      skipRelay = options.skipRelay || false;
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
      const result = await this.loadProfile(pubkey, cacheKey, refresh, skipRelay);
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
  ): Promise<NostrRecord | undefined> {
    let metadata: Event | null = null;
    let record: NostrRecord | undefined = undefined;

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

      if (metadata) {
        record = this.toRecord(metadata);
        this.cache.set(cacheKey, record);
        await this.database.saveEvent(metadata);
      }
    }

    return record;
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

    // Check if this kind is replaceable - if not, we can use cached events
    const isReplaceable = this.utilities.shouldAlwaysFetchFromRelay(kind);

    // If invalidateCache is true, skip storage and fetch directly from relays
    // Otherwise, check storage first if save option is enabled and event is not replaceable
    if (events.length === 0 && options?.save && !options?.invalidateCache && !isReplaceable) {
      const allEvents = await this.database.getEventsByKind(kind);
      events = allEvents.filter((e: Event) => this.utilities.getTagValues('#e', e.tags)[0] === eventTag);

      if (events.length > 0) {
        this.logger.debug(`Using ${events.length} cached events for non-replaceable kind ${kind} with tag ${eventTag}`);
      }
    }

    // Fetch from relays if:
    // 1. No events found in storage, OR
    // 2. Kind is replaceable (need latest version), OR
    // 3. invalidateCache is true
    if (events.length === 0 || isReplaceable || options?.invalidateCache) {
      const relayEvents = await this.userRelayEx.getEventsByKindAndEventTag(
        pubkey,
        kind,
        eventTag,
        options?.includeAccountRelays
      );
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
      for (const event of events) {
        await this.database.saveEvent(event);
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

    // If invalidateCache is true, skip storage and fetch directly from relays
    // Otherwise, check storage first if save option is enabled and no kinds are replaceable
    if (events.length === 0 && options?.save && !options?.invalidateCache && !hasReplaceableKind) {
      // Fetch from storage for all requested kinds
      const kindEvents = await Promise.all(kinds.map(kind => this.database.getEventsByKind(kind)));
      events = kindEvents.flat().filter((e: Event) => this.utilities.getTagValues('#e', e.tags)[0] === eventTag);

      if (events.length > 0) {
        this.logger.debug(`Using ${events.length} cached events for non-replaceable kinds [${kinds.join(',')}] with tag ${eventTag}`);
      }
    }

    // Fetch from relays if:
    // 1. No events found in storage, OR
    // 2. Any kind is replaceable (need latest version), OR
    // 3. invalidateCache is true
    if (events.length === 0 || hasReplaceableKind || options?.invalidateCache) {
      const relayEvents = await this.userRelayEx.getEventsByKindsAndEventTag(
        pubkey,
        kinds,
        eventTag,
        options?.includeAccountRelays
      );
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
      for (const event of events) {
        await this.database.saveEvent(event);
      }
    }

    return records;
  }
}

