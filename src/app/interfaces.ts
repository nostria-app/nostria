import { Event } from 'nostr-tools';

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

export type ViewMode =
  | 'large'
  | 'medium'
  | 'small'
  | 'details'
  | 'list'
  | 'grid'
  | 'thread'
  | 'icon'
  | 'compact'
  | 'card'
  | 'tiny'
  | 'name';

/** Static time constants in milliseconds */
export const minutes = {
  one: 1 * 60 * 1000,
  two: 2 * 60 * 1000,
  three: 3 * 60 * 1000,
  four: 4 * 60 * 1000,
  five: 5 * 60 * 1000,
  six: 6 * 60 * 1000,
  seven: 7 * 60 * 1000,
  eight: 8 * 60 * 1000,
  nine: 9 * 60 * 1000,
  ten: 10 * 60 * 1000,
} as const;

export const hours = {
  one: 1 * 60 * 60 * 1000,
  two: 2 * 60 * 60 * 1000,
  three: 3 * 60 * 60 * 1000,
  four: 4 * 60 * 60 * 1000,
  five: 5 * 60 * 60 * 1000,
} as const;
