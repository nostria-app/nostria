import { inject } from '@angular/core';
import { StorageService } from './storage.service';
import { NostrRecord } from '../interfaces';
import { LoggerService } from './logger.service';
import { Event, kinds } from 'nostr-tools';
import { UserRelayExFactoryService } from './user-relay-factory.service';
import { UtilitiesService } from './utilities.service';
import { Cache, CacheOptions } from './cache';
import { DiscoveryRelayServiceEx } from './relays/discovery-relay';
import { SharedRelayServiceEx } from './relays/shared-relay';
import { UserRelayServiceEx } from './relays/user-relay';

export interface DataOptions {
  cache: boolean; // Whether to use cache
  save: boolean; // Whether to save the event to storage
}

export class UserDataService {
  private readonly storage = inject(StorageService);
  private readonly userRelayFactory = inject(UserRelayExFactoryService);
  private readonly discoveryRelayEx = inject(DiscoveryRelayServiceEx);
  private readonly sharedRelayEx = inject(SharedRelayServiceEx);
  private readonly logger = inject(LoggerService);
  private readonly utilities = inject(UtilitiesService);
  private readonly cache = inject(Cache);
  private userRelayEx!: UserRelayServiceEx;

  // Map to track pending profile requests to prevent race conditions
  private pendingProfileRequests = new Map<
    string,
    Promise<NostrRecord | undefined>
  >();

  // Clean up old pending requests periodically
  constructor() {
    // Clean up any stale pending requests every 30 seconds
    // setInterval(() => {
    //   if (this.pendingProfileRequests.size > 100) {
    //     this.logger.warn(
    //       `Large number of pending profile requests: ${this.pendingProfileRequests.size}. Consider investigating.`
    //     );
    //   }
    // }, 30000);
  }

  async initialize(pubkey: string) {
    this.userRelayEx = await this.userRelayFactory.create(pubkey);
    this.logger.debug(`UserDataService initialized for pubkey: ${pubkey}`);
  }

  toRecord(event: Event) {
    return this.utilities.toRecord(event);
  }

  toRecords(events: Event[]) {
    return this.utilities.toRecords(events);
  }

  async getEventById(
    id: string,
    options?: CacheOptions & DataOptions
  ): Promise<NostrRecord | null> {
    let event: Event | null = null;
    let record: NostrRecord | undefined = undefined;

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

    // If the caller explicitly supplies user relay, don't attempt to user account relay.
    if (!event) {
      event = await this.userRelayEx.getEventById(id);
    }

    if (!event) {
      return null;
    }

    record = this.toRecord(event);

    if (options?.cache) {
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
    const relayListEvent = await this.storage.getEventByPubkeyAndKind(
      pubkey,
      10002
    );

    if (relayListEvent) {
      relayUrls = this.utilities.getRelayUrls(relayListEvent);
    }

    if (!relayUrls || relayUrls.length === 0) {
      const followingEvent = await this.storage.getEventByPubkeyAndKind(
        pubkey,
        3
      );
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

  async getProfile(
    pubkey: string,
    refresh = false
  ): Promise<NostrRecord | undefined> {
    // Validate pubkey parameter
    if (!pubkey || pubkey === 'undefined' || !pubkey.trim()) {
      this.logger.warn('getProfile called with invalid pubkey:', pubkey);
      return undefined;
    }

    const cacheKey = `metadata-${pubkey}`;

    // Check if there's already a pending request for this pubkey
    if (this.pendingProfileRequests.has(pubkey)) {
      this.logger.debug(
        `Returning existing pending request for profile: ${pubkey}`
      );
      return this.pendingProfileRequests.get(pubkey);
    }

    // Check cache first
    if (this.cache.has(cacheKey)) {
      const record = this.cache.get<NostrRecord>(cacheKey);
      if (record) {
        // If refresh is requested, trigger background update
        // if (refresh) {
        //   this.refreshProfileInBackground(pubkey, cacheKey);
        // }
        return record;
      }
    }

    // Create and store the promise to prevent race conditions
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

    // Try storage first
    metadata = await this.storage.getEventByPubkeyAndKind(
      pubkey,
      kinds.Metadata
    );

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

    // Handle background refresh if requested
    // if (refresh) {
    //   this.refreshProfileInBackground(pubkey, cacheKey);
    // }

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
        this.logger.warn(
          `Failed to refresh profile in background for ${pubkey}:`,
          error
        );
      }
    });
  }

  /** Will read event from local database, if available, or get from relay, and then save to database. */
  async getEventByPubkeyAndKindAndReplaceableEvent(
    pubkey: string,
    kind: number,
    dTagValue: string,
    options?: CacheOptions & DataOptions
  ): Promise<NostrRecord | null> {
    // Validate pubkey parameter
    if (!pubkey || pubkey === 'undefined' || !pubkey.trim()) {
      this.logger.warn(
        'getEventByPubkeyAndKindAndReplaceableEvent called with invalid pubkey:',
        pubkey
      );
      return null;
    }

    const cacheKey = `${pubkey}-${kind}-${dTagValue}`;
    let event: Event | null = null;
    let record: NostrRecord | undefined = undefined;

    if (options?.cache) {
      record = this.cache.get<NostrRecord>(cacheKey);

      if (record) {
        return record;
      }
    }

    // If the caller explicitly don't want to save, we will not check the storage.
    if (options?.save) {
      event =
        (await this.storage.getParameterizedReplaceableEvent(
          pubkey,
          kind,
          dTagValue
        )) || null;
    }

    // If the caller explicitly supplies user relay, don't attempt to user account relay.
    if (!event) {
      event = await this.userRelayEx.getEventByPubkeyAndKindAndTag(
        pubkey,
        kind,
        { key: 'd', value: dTagValue }
      );
    }

    if (!event) {
      return null;
    }

    record = this.toRecord(event);

    if (options?.cache) {
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
    options?: CacheOptions & DataOptions
  ): Promise<NostrRecord | null> {
    // Validate pubkey parameter
    if (!pubkey || (Array.isArray(pubkey) && pubkey.length === 0)) {
      debugger;
      this.logger.warn(
        'getEventByPubkeyAndKind called with invalid pubkey:',
        pubkey
      );
      return null;
    }

    if (Array.isArray(pubkey) && pubkey.some(pk => !pk || pk === 'undefined')) {
      this.logger.warn(
        'getEventByPubkeyAndKind called with invalid pubkey in array:',
        pubkey
      );
      return null;
    }

    if (
      typeof pubkey === 'string' &&
      (pubkey === 'undefined' || !pubkey.trim())
    ) {
      this.logger.warn(
        'getEventByPubkeyAndKind called with invalid pubkey string:',
        pubkey
      );
      return null;
    }

    const cacheKey = `${Array.isArray(pubkey) ? pubkey.join(',') : pubkey}-${kind}`;
    let event: Event | null = null;
    let record: NostrRecord | undefined = undefined;

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
      // If userRelays is true, we will try to get the event from user relays.
      event = await this.userRelayEx.getEventByPubkeyAndKind(pubkey, kind);
    }

    if (!event) {
      return null;
    }

    record = this.toRecord(event);

    if (options?.cache) {
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
    options?: CacheOptions & DataOptions
  ): Promise<NostrRecord[]> {
    // Validate pubkey parameter
    if (!pubkey || (Array.isArray(pubkey) && pubkey.length === 0)) {
      this.logger.warn(
        'getEventsByPubkeyAndKind called with invalid pubkey:',
        pubkey
      );
      return [];
    }

    if (Array.isArray(pubkey) && pubkey.some(pk => !pk || pk === 'undefined')) {
      this.logger.warn(
        'getEventsByPubkeyAndKind called with invalid pubkey in array:',
        pubkey
      );
      return [];
    }

    if (
      typeof pubkey === 'string' &&
      (pubkey === 'undefined' || !pubkey.trim())
    ) {
      this.logger.warn(
        'getEventsByPubkeyAndKind called with invalid pubkey string:',
        pubkey
      );
      return [];
    }

    const cacheKey = `${Array.isArray(pubkey) ? pubkey.join(',') : pubkey}-${kind}-all`;
    let events: Event[] = [];
    let records: NostrRecord[] = [];

    if (options?.cache) {
      const records = this.cache.get<NostrRecord[]>(cacheKey);

      if (records) {
        return records;
      }
    }

    // If the caller explicitly don't want to save, we will not check the storage.
    if (events.length === 0 && options?.save) {
      events = await this.storage.getEventsByPubkeyAndKind(pubkey, kind);
    }

    if (events.length === 0) {
      const relayEvents = await this.userRelayEx.getEventsByPubkeyAndKind(
        pubkey,
        kind
      );
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

    if (options?.save) {
      for (const event of events) {
        await this.storage.saveEvent(event);
      }
    }

    return records;
  }

  async getEventsByKindAndEventTag(
    kind: number,
    eventTag: string,
    options?: CacheOptions & DataOptions
  ): Promise<NostrRecord[]> {
    const cacheKey = `${kind}-${eventTag}-all`;
    let events: Event[] = [];
    let records: NostrRecord[] = [];

    if (options?.cache) {
      const records = this.cache.get<NostrRecord[]>(cacheKey);

      if (records) {
        console.log('kind', kind, 'cache hit')
        return records;
      }
    }

    // If the caller explicitly don't want to save, we will not check the storage.
    if (events.length === 0 && options?.save) {
      const allEvents = await this.storage.getEventsByKind(kind);
      events = allEvents.filter(
        e => this.utilities.getTagValues('#e', e.tags)[0] === eventTag
      );
    }

    if (events.length === 0) {
      const relayEvents = await this.userRelayEx.getEventsByKindAndEventTag(
        kind,
        eventTag
      );
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

    if (options?.save) {
      for (const event of events) {
        await this.storage.saveEvent(event);
      }
    }

    return records;
  }
}
