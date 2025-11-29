import { inject, Injectable } from '@angular/core';
import { StorageService } from './storage.service';
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

export interface DataOptions {
  cache?: boolean; // Whether to use cache
  save?: boolean; // Whether to save the event to storage
}

@Injectable({
  providedIn: 'root',
})
export class DataService {
  private readonly storage = inject(StorageService);
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
      event = await this.storage.getEventById(id);
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
      await this.storage.saveEvent(event);
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
    const relayListEvent = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.RelayList);

    if (relayListEvent) {
      relayUrls = this.utilities.getRelayUrls(relayListEvent);
    }

    if (!relayUrls || relayUrls.length === 0) {
      const followingEvent = await this.storage.getEventByPubkeyAndKind(pubkey, 3);
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
   * Gets cached profile synchronously without triggering any async operations
   * Returns undefined if profile is not in cache
   */
  getCachedProfile(pubkey: string): NostrRecord | undefined {
    const cacheKey = `metadata-${pubkey}`;
    return this.cache.get<NostrRecord>(cacheKey);
  }

  async getProfile(pubkey: string, refresh = false): Promise<NostrRecord | undefined> {
    const cacheKey = `metadata-${pubkey}`;

    // Check if there's already a pending request for this pubkey
    if (this.pendingProfileRequests.has(pubkey)) {
      this.logger.debug(`Returning existing pending request for profile: ${pubkey}`);
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

    // If no cached data available or refresh requested and no cache, load fresh data
    const profilePromise = this.loadProfile(pubkey, cacheKey, refresh);
    this.pendingProfileRequests.set(pubkey, profilePromise);

    try {
      const result = await profilePromise;
      return result;
    } finally {
      // Always clean up the pending request
      this.pendingProfileRequests.delete(pubkey);
    }
  }

  private async loadProfile(
    pubkey: string,
    cacheKey: string,
    refresh: boolean
  ): Promise<NostrRecord | undefined> {
    let metadata: Event | null = null;
    let record: NostrRecord | undefined = undefined;

    if (refresh) {
      // When refresh is true, skip storage and go directly to relays for fresh data
      // Reduced logging to prevent console spam
      metadata = await this.sharedRelayEx.get(pubkey, {
        authors: [pubkey],
        kinds: [kinds.Metadata],
      });

      if (metadata) {
        record = this.toRecord(metadata);
        this.cache.set(cacheKey, record);
        await this.storage.saveEvent(metadata);
        // Also save to new DatabaseService for Summary queries
        await this.saveEventToDatabase(metadata);
        // Process relay hints when saving metadata
        await this.processEventForRelayHints(metadata);
      }
    } else {
      // Normal flow: try storage first, then relays if not found
      metadata = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.Metadata);

      if (metadata) {
        record = this.toRecord(metadata);
        this.cache.set(cacheKey, record);
      } else {
        // Try to get from relays - reduced logging to prevent console spam
        metadata = await this.sharedRelayEx.get(pubkey, {
          authors: [pubkey],
          kinds: [kinds.Metadata],
        });

        if (metadata) {
          record = this.toRecord(metadata);
          this.cache.set(cacheKey, record);
          await this.storage.saveEvent(metadata);
          // Also save to new DatabaseService for Summary queries
          await this.saveEventToDatabase(metadata);
          // Process relay hints when saving metadata
          await this.processEventForRelayHints(metadata);
        }
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
          await this.storage.saveEvent(fresh);
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
        (await this.storage.getParameterizedReplaceableEvent(pubkey, kind, dTagValue)) || null;
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
      await this.storage.saveEvent(event);
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
      event = await this.storage.getEventByPubkeyAndKind(pubkey, kind);
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
      await this.storage.saveEvent(event);
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
      const allEvents = await this.storage.getEventsByKind(kind);
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
        await this.storage.saveEvent(event);
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
