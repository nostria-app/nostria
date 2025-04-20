import { Event } from "nostr-tools";

export const MEDIA_SERVERS_EVENT_KIND = 10063;

// Interface for Nostr events
export interface NostrEvent extends Event {
    content: any;
}

export type ViewMode = 'large' | 'medium' | 'small' | 'details' | 'tiles' | 'list' | 'grid';