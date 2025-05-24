import { Event } from "nostr-tools";

export const MEDIA_SERVERS_EVENT_KIND = 10063;

export interface NostrRecord {
    event: Event;
    /** Data is the parsed content. */
    data: any;
}

// Interface for Nostr events
// export interface NostrEvent extends Event {
//     /** Data is the parsed content. */
//     data: any;
// }

export type ViewMode = 'large' | 'medium' | 'small' | 'details' | 'list' | 'tiles' | 'grid' | 'thread';