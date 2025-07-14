import { inject, Injectable, signal } from "@angular/core";
import { StorageService } from "./storage.service";
import { RelayService } from "./relay.service";
import { NostrRecord } from "../interfaces";
import { LoggerService } from "./logger.service";
import { Event } from "nostr-tools";
import { UserRelayFactoryService } from "./user-relay-factory.service";
import { UtilitiesService } from "./utilities.service";
import { Cache, CacheOptions } from "./cache";
import { AccountRelayService } from "./account-relay.service";

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
    private readonly logger = inject(LoggerService);
    private readonly userRelayFactory = inject(UserRelayFactoryService);
    private readonly utilities = inject(UtilitiesService);
    private readonly cache = inject(Cache);

    getRecord(event: Event) {
        return this.utilities.getRecord(event);
    }

    getRecords(events: Event[]) {
        return this.utilities.getRecords(events);
    }

    async getEventById(id: string, options?: CacheOptions & DataOptions): Promise<NostrRecord | null> {
        let event: Event | null = null;

        if (options?.cache) {
            event = this.cache.get<Event>(`${id}`);
        }

        // If the caller explicitly don't want to save, we will not check the storage.
        if (options?.save) {
            event = await this.storage.getEventById(id);
        }

        if (!event) {
            event = await this.relay.getEventById(id);
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

        return this.getRecord(event);
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

    /** Get relay for a specific user, only local search. */
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

        return relayUrls;
    }

    /** Will read event from local database, if available, or get from relay, and then save to database. */
    async getEventByPubkeyAndKindAndReplaceableEvent(pubkey: string, kind: number, dTagValue: string, userRelays: boolean): Promise<NostrRecord | null> {
        let event: Event | null | undefined = await this.storage.getParameterizedReplaceableEvent(pubkey, kind, dTagValue);

        if (event) {
            return this.getRecord(event);
        }

        if (userRelays) {
            // If userRelays is true, we will try to get the event from user relays.
            const userRelayService = await this.userRelayFactory.create(pubkey);
            event = await userRelayService.getEventByPubkeyAndKindAndTag(pubkey, kind, { key: 'd', value: dTagValue });

            if (event) {
                this.storage.saveEvent(event);
                return this.getRecord(event);
            }
        }

        // If not found in user relays, we will try to get the event from the main relay.
        event = await this.relay.getEventByPubkeyAndKindAndTag(pubkey, kind, { key: 'd', value: dTagValue });

        if (event) {
            this.storage.saveEvent(event);
            return this.getRecord(event);
        }

        return null;
    }

    /** Will read event from local database, if available, or get from relay, and then save to database. */
    async getEventByPubkeyAndKind(pubkey: string | string[], kind: number): Promise<NostrRecord | null> {
        let event = await this.storage.getEventByPubkeyAndKind(pubkey, kind);

        if (event) {
            return this.getRecord(event);
        }

        event = await this.relay.getEventByPubkeyAndKind(pubkey, kind);

        if (event) {
            this.storage.saveEvent(event);
            return this.getRecord(event);
        }

        return null;
    }

    async getEventsByPubkeyAndKind(pubkey: string | string[], kind: number): Promise<NostrRecord[]> {
        const events = await this.storage.getEventsByPubkeyAndKind(pubkey, kind);

        if (events && events.length > 0) {
            return events.map(event => this.getRecord(event));
        }

        const relayEvents = await this.relay.getEventsByPubkeyAndKind(pubkey, kind);

        if (relayEvents && relayEvents.length > 0) {
            for (const event of relayEvents) {
                await this.storage.saveEvent(event);
            }

            return relayEvents.map(event => this.getRecord(event));
        }

        return [];
    }
}