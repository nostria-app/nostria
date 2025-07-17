import { inject, Injectable, signal } from "@angular/core";
import { StorageService } from "./storage.service";
import { RelayService } from "./relay.service";
import { NostrRecord } from "../interfaces";
import { LoggerService } from "./logger.service";
import { Event, kinds } from "nostr-tools";
import { UserRelayFactoryService } from "./user-relay-factory.service";
import { UtilitiesService } from "./utilities.service";
import { Cache, CacheOptions } from "./cache";
import { AccountRelayService, AccountRelayServiceEx, DiscoveryRelayServiceEx, SharedRelayServiceEx, UserRelayServiceEx } from "./account-relay.service";
import { UserRelayService } from "./user-relay.service";
import { RelaysService } from "./relays.service";

export interface DataOptions {
    cache: boolean; // Whether to use cache
    save: boolean; // Whether to save the event to storage
}

@Injectable({
    providedIn: 'root'
})
export class DataService {
    private readonly storage = inject(StorageService);
    private readonly relay = inject(RelayService);
    private readonly accountRelay = inject(AccountRelayService);
    private readonly userRelayFactory = inject(UserRelayFactoryService);
    private readonly userRelayEx = inject(UserRelayServiceEx);
    private readonly discoveryRelayEx = inject(DiscoveryRelayServiceEx);
    private readonly accountRelayEx = inject(AccountRelayServiceEx);
    private readonly sharedRelayEx = inject(SharedRelayServiceEx);
    private readonly logger = inject(LoggerService);
    private readonly utilities = inject(UtilitiesService);
    private readonly cache = inject(Cache);
    private readonly relaysService = inject(RelaysService);

    toRecord(event: Event) {
        return this.utilities.toRecord(event);
    }

    toRecords(events: Event[]) {
        return this.utilities.toRecords(events);
    }

    async getEventById(id: string, options?: CacheOptions & DataOptions, userRelays = false): Promise<NostrRecord | null> {
        let event: Event | null = null;

        if (options?.cache) {
            event = this.cache.get<Event>(`${id}`);
        }

        // If the caller explicitly don't want to save, we will not check the storage.
        if (options?.save) {
            event = await this.storage.getEventById(id);
        }

        // If the caller explicitly supplies user relay, don't attempt to user account relay.
        if (!event) {
            if (userRelays) {
                // If userRelays is true, we will try to get the event from user relays.
                event = await this.userRelayEx.getEventById(id);
            } else {
                // Try to get the event from the account relay.
                event = await this.accountRelayEx.getEventById(id);
            }
        }

        if (!event) {
            return null;
        }

        if (options?.cache) {
            this.cache.set(`${id}`, event, options);
        }

        if (options?.save) {
            // queueMicrotask(() => this.storage.saveEvent(event!));
            await this.storage.saveEvent(event);
        }

        return this.toRecord(event);
    }

    // async getEventsById(ids: string[]): Promise<NostrRecord[]> {
    //     const events = await this.storage.getEventsById(ids);

    //     if (events && events.length > 0) {
    //         return events.map(event => this.getRecord(event));
    //     }

    //     const relayEvents = await this.relay.getEventsById(ids);

    //     if (relayEvents && relayEvents.length > 0) {
    //         for (const event of relayEvents) {
    //             await this.storage.saveEvent(event);
    //         }

    //         return relayEvents.map(event => this.getRecord(event));
    //     }

    //     return [];
    // }

    // async getUserProfile(pubkey: string, relayUrls: string[], options?: CacheOptions & DataOptions): Promise<NostrRecord | null> {

    //     this.relaysService.getUserRelays(pubkey);


    //     // First get the relays for the user.
    //     this.sharedRelayEx.get(pubkey, )

    // }

    async discoverUserRelays(pubkey: string): Promise<string[]> {
        return this.discoveryRelayEx.getUserRelayUrls(pubkey);
    }

    async getUserRelays(pubkey: string) {
        let relayUrls: string[] = [];
        const relayListEvent = await this.storage.getEventByPubkeyAndKind(pubkey, 10002);

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

    async getProfile(pubkey: string, refresh: boolean = false): Promise<NostrRecord | undefined> {
        const cacheKey = `metadata-${pubkey}`;
        let metadata: Event | null = null;

        if (this.cache.has(cacheKey)) {
            metadata = this.cache.get<Event>(cacheKey);
        } else {
            metadata = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.Metadata);

            if (metadata) {
                this.cache.set(cacheKey, metadata);
            }
        }

        if (!metadata) {
            // Try to get from relays
            metadata = await this.sharedRelayEx.get(pubkey, { authors: [pubkey], kinds: [kinds.Metadata] });

            if (metadata) {
                this.cache.set(cacheKey, metadata);
                await this.storage.saveEvent(metadata);
            }
        } else if (refresh) {
            // If we have metadata and refresh is true, we will refresh it in the background.
            queueMicrotask(async () => {
                let fresh = await this.sharedRelayEx.get(pubkey, { authors: [pubkey], kinds: [kinds.Metadata] });

                if (fresh) {
                    this.cache.set(cacheKey, fresh);
                    await this.storage.saveEvent(fresh);
                }
            });
        }

        if (!metadata) {
            return undefined;
        }

        return this.toRecord(metadata);
    }

    /** Will read event from local database, if available, or get from relay, and then save to database. */
    async getEventByPubkeyAndKindAndReplaceableEvent(pubkey: string, kind: number, dTagValue: string, options?: CacheOptions & DataOptions, userRelays = false): Promise<NostrRecord | null> {
        const cacheKey = `${pubkey}-${kind}-${dTagValue}`;
        let event: Event | null = null;

        if (options?.cache) {
            event = this.cache.get<Event>(cacheKey);
        }

        // If the caller explicitly don't want to save, we will not check the storage.
        if (options?.save) {
            event = await this.storage.getParameterizedReplaceableEvent(pubkey, kind, dTagValue) || null;
        }

        // If the caller explicitly supplies user relay, don't attempt to user account relay.
        if (!event) {
            if (userRelays) {
                // If userRelays is true, we will try to get the event from user relays.
                await this.userRelayEx.setUser(pubkey);
                event = await this.userRelayEx.getEventByPubkeyAndKindAndTag(pubkey, kind, { key: 'd', value: dTagValue });
            } else {
                // Try to get the event from the account relay.
                event = await this.accountRelayEx.getEventByPubkeyAndKindAndTag(pubkey, kind, { key: 'd', value: dTagValue });
            }
        }

        if (!event) {
            return null;
        }

        if (options?.cache) {
            this.cache.set(cacheKey, event, options);
        }

        if (options?.save) {
            await this.storage.saveEvent(event);
        }

        return this.toRecord(event);
    }

    /** Will read event from local database, if available, or get from relay, and then save to database. */
    async getEventByPubkeyAndKind(pubkey: string | string[], kind: number, options?: CacheOptions & DataOptions, userRelays = false): Promise<NostrRecord | null> {
        const cacheKey = `${Array.isArray(pubkey) ? pubkey.join(',') : pubkey}-${kind}`;
        let event: Event | null = null;

        if (options?.cache) {
            event = this.cache.get<Event>(cacheKey);
        }

        // If the caller explicitly don't want to save, we will not check the storage.
        if (options?.save) {
            event = await this.storage.getEventByPubkeyAndKind(pubkey, kind);
        }

        // If the caller explicitly supplies user relay, don't attempt to user account relay.
        if (!event) {
            if (userRelays) {
                // If userRelays is true, we will try to get the event from user relays.
                event = await this.userRelayEx.getEventByPubkeyAndKind(pubkey, kind);
            } else {
                // Try to get the event from the account relay.
                event = await this.accountRelayEx.getEventByPubkeyAndKind(pubkey, kind);
            }
        }

        if (!event) {
            return null;
        }

        if (options?.cache) {
            this.cache.set(cacheKey, event, options);
        }

        if (options?.save) {
            await this.storage.saveEvent(event);
        }

        return this.toRecord(event);
    }

    async getEventsByPubkeyAndKind(pubkey: string | string[], kind: number, options?: CacheOptions & DataOptions): Promise<NostrRecord[]> {
        const cacheKey = `${Array.isArray(pubkey) ? pubkey.join(',') : pubkey}-${kind}-all`;
        let events: Event[] = [];

        if (options?.cache) {
            const cachedEvents = this.cache.get<Event[]>(cacheKey);
            if (cachedEvents) {
                events = cachedEvents;
            }
        }

        // If the caller explicitly don't want to save, we will not check the storage.
        if (events.length === 0 && options?.save) {
            events = await this.storage.getEventsByPubkeyAndKind(pubkey, kind);
        }

        if (events.length === 0) {
            const relayEvents = await this.relay.getEventsByPubkeyAndKind(pubkey, kind);
            if (relayEvents && relayEvents.length > 0) {
                events = relayEvents;
            }
        }

        if (events.length === 0) {
            return [];
        }

        if (options?.cache) {
            this.cache.set(cacheKey, events, options);
        }

        if (options?.save) {
            for (const event of events) {
                await this.storage.saveEvent(event);
            }
        }

        return events.map(event => this.toRecord(event));
    }
}