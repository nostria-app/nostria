import { inject, Injectable, signal } from "@angular/core";
import { StorageService } from "./storage.service";
import { NostrService } from "./nostr.service";
import { RelayService } from "./relay.service";
import { NostrRecord } from "../interfaces";
import { LoggerService } from "./logger.service";
import { Event } from "nostr-tools";

@Injectable({
    providedIn: 'root'
})
export class DataService {
    private readonly storage = inject(StorageService);
    private readonly relay = inject(RelayService);
    private readonly logger = inject(LoggerService);

    getRecord(event: Event) {
        return {
            event,
            data: this.parseContent(event.content)
        }
    }

    getRecords(events: Event[]) {
        return events.map(event => this.getRecord(event));
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

    /** Attempts to parse the content if it is a JSON string. */
    parseContent(content: string): any {
        if (content && content !== '') {
            try {

                // First check if the content is already an object (not a string)
                if (typeof content === 'string') {
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