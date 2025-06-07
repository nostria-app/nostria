import { inject, Injectable, signal } from "@angular/core";
import { StorageService } from "./storage.service";
import { RelayService } from "./relay.service";
import { NostrRecord } from "../interfaces";
import { LoggerService } from "./logger.service";
import { Event } from "nostr-tools";
import { UserRelayFactoryService } from "./user-relay-factory.service";
import { UtilitiesService } from "./utilities.service";

@Injectable({
    providedIn: 'root'
})
export class DataService {
    private readonly storage = inject(StorageService);
    private readonly relay = inject(RelayService);
    private readonly logger = inject(LoggerService);
    private readonly userRelayFactory = inject(UserRelayFactoryService);
    private readonly utilities = inject(UtilitiesService);

    getRecord(event: Event) {
        return {
            event,
            data: this.parseContent(event.content)
        }
    }

    getRecords(events: Event[]) {
        return events.map(event => this.getRecord(event));
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

        return relayUrls;
    }

    async getEventById(id: string): Promise<NostrRecord | null> {
        let event = await this.storage.getEventById(id);

        if (event) {
            return this.getRecord(event);
        }

        event = await this.relay.getEventById(id);

        if (event) {
            this.storage.saveEvent(event);
            return this.getRecord(event);
        }

        return null;
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
        debugger;
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

    sanitizeJsonString(json: string): string {
        return json
            // Specifically handle newlines that appear before closing quotes in JSON values
            .replace(/\n+"/g, '"')
            .trim();
    }

    /** Attempts to parse the content if it is a JSON string. */
    parseContent(content: string): any {
        if (content && content !== '') {
            try {
                // First check if the content is already an object (not a string)
                if (typeof content === 'string') {
                    // Sanitize the JSON string to remove problematic characters
                    // Example npub that is problematic: npub1xdn5apqgt2fyuace95cv7lvx344wdw5ppac7kvwycdqzlg7zdnds2ly4d0
                    content = this.sanitizeJsonString(content);

                    // Check if it looks like JSON (starts with { or [)
                    const trimmedContent = content.trim();

                    if ((trimmedContent.startsWith('{') && trimmedContent.endsWith('}')) ||
                        (trimmedContent.startsWith('[') && trimmedContent.endsWith(']'))) {
                        // Try parsing it as JSON
                        content = JSON.parse(content);
                    }
                    // If it doesn't look like JSON or parsing fails, the catch block will keep it as a string
                }
            } catch (e) {
                debugger;
                this.logger.error('Failed to parse event content', e);
            }
        }

        return content;
    }
}