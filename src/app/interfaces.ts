import { Event } from "nostr-tools";

// Interface for Nostr events
export interface NostrEvent extends Event {
    content: any;
}
