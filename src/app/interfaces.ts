import { Event } from "nostr-tools";

export const MEDIA_SERVERS_EVENT_KIND = 10063;

export interface NostrRecord {
    event: Event;
    /** Data is the parsed content. */
    data: any;
}

export interface MediaItem {
    artwork: string;
    title: string;
    artist: string;
    source: string;
    type: 'Music' | 'Podcast' | 'YouTube' | 'Video';
}

export declare interface OnInitialized {
    initialize(): void;
}

/** Interface that is implemented by services and called when account changes. */
export declare interface NostriaService {
    // initialize(): Promise<any>;
    load(): Promise<any>;
    clear(): void;
}

// Interface for Nostr events
// export interface NostrEvent extends Event {
//     /** Data is the parsed content. */
//     data: any;
// }

export type ViewMode = 'large' | 'medium' | 'small' | 'details' | 'list' | 'tiles' | 'grid' | 'thread';