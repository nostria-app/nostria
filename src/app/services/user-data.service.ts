import { Injectable, inject } from '@angular/core';
import { StorageService } from './storage.service';
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
}

@Injectable({
  providedIn: 'root',
})
export class UserDataService {
  private readonly storage = inject(StorageService);
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

    if (options?.cache && !options?.invalidateCache) {
      record = this.cache.get<NostrRecord>(`${id}`);

      if (record) {
        return record;
      }
    }

    // If invalidateCache is true, skip storage and fetch directly from relays
    // Otherwise, check storage first if save option is enabled
    if (options?.save && !options?.invalidateCache) {
      event = await this.storage.getEventById(id);
    }

    // Fetch from relays if we don't have event yet (or invalidateCache forced relay fetch)
    if (!event) {
      event = await this.userRelayEx.getEventById(pubkey, id);
    }

    if (!event) {
      return null;
    }

    record = this.toRecord(event);

    if (options?.cache || options?.invalidateCache) {
      this.cache.set(`${id}`, record, options);
    }

    if (options?.save) {
      // queueMicrotask(() => this.storage.saveEvent(event!));
      await this.storage.saveEvent(event);
    }

    return record;
  }

  async discoverUserRelays(pubkey: string): Promise<string[]> {
    const relayUrls = await this.discoveryRelayEx.getUserRelayUrls(pubkey);
    return Array.isArray(relayUrls) ? relayUrls : [];
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

  async getProfile(pubkey: string, refresh = false): Promise<NostrRecord | undefined> {
    // Validate pubkey parameter
    if (!pubkey || pubkey === 'undefined' || !pubkey.trim()) {
      this.logger.warn('getProfile called with invalid pubkey:', pubkey);
      return undefined;
    }

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

    // If no cached data available, load fresh data
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
    refresh: boolean,
  ): Promise<NostrRecord | undefined> {
    let metadata: Event | null = null;
    let record: NostrRecord | undefined = undefined;

    // If not refreshing, try storage first
    if (!refresh) {
      metadata = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.Metadata);
    }

    if (metadata) {
      record = this.toRecord(metadata);
      this.cache.set(cacheKey, record);
    } else {
      // Try to get from relays
      console.log('getProfile', pubkey, metadata);
      metadata = await this.sharedRelayEx.get(pubkey, {
        authors: [pubkey],
        kinds: [kinds.Metadata],
      });
      console.log('gotProfile', pubkey, metadata);

      if (metadata) {
        record = this.toRecord(metadata);
        this.cache.set(cacheKey, record);
        await this.storage.saveEvent(metadata);
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
        (await this.storage.getParameterizedReplaceableEvent(pubkey, kind, dTagValue)) || null;
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
      await this.storage.saveEvent(event);
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
      event = await this.storage.getEventByPubkeyAndKind(pubkey, kind);
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
      await this.storage.saveEvent(event);
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
      events = await this.storage.getEventsByPubkeyAndKind(pubkey, kind);
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
      for (const event of events) {
        await this.storage.saveEvent(event);
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

    // If invalidateCache is true, skip storage and fetch directly from relays
    // Otherwise, check storage first if save option is enabled
    if (events.length === 0 && options?.save && !options?.invalidateCache) {
      const allEvents = await this.storage.getEventsByKind(kind);
      events = allEvents.filter((e) => this.utilities.getTagValues('#e', e.tags)[0] === eventTag);
    }

    // Fetch from relays if we don't have events yet (or invalidateCache forced relay fetch)
    if (events.length === 0) {
      const relayEvents = await this.userRelayEx.getEventsByKindAndEventTag(pubkey, kind, eventTag);
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
        await this.storage.saveEvent(event);
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

    // If invalidateCache is true, skip storage and fetch directly from relays
    // Otherwise, check storage first if save option is enabled
    if (events.length === 0 && options?.save && !options?.invalidateCache) {
      // Fetch from storage for all requested kinds
      const kindEvents = await Promise.all(kinds.map(kind => this.storage.getEventsByKind(kind)));
      events = kindEvents.flat().filter((e) => this.utilities.getTagValues('#e', e.tags)[0] === eventTag);
    }

    // Fetch from relays if we don't have events yet (or invalidateCache forced relay fetch)
    if (events.length === 0) {
      const relayEvents = await this.userRelayEx.getEventsByKindsAndEventTag(pubkey, kinds, eventTag);
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
        await this.storage.saveEvent(event);
      }
    }

    return records;
  }
}

