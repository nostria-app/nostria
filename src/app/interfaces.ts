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
  type: 'Music' | 'Podcast' | 'YouTube' | 'Video' | 'HLS' | 'LiveKit' | 'External';
  isLiveStream?: boolean; // Flag for live streaming content
  participants?: { pubkey: string; role?: string }[]; // Live stream participants
  liveEventData?: Event; // Full Nostr event for live streams
  // For linking to song/artist pages from media player
  eventPubkey?: string; // npub of the event author
  eventIdentifier?: string; // d-tag identifier for the event
  // Lyrics for the track (plain text or LRC format)
  lyrics?: string;
}

// Podcast progress tracking interface
export interface PodcastProgress {
  position: number; // Current playback position in seconds
  duration?: number; // Total duration in seconds (optional)
  lastListenedAt: number; // Unix timestamp in seconds when last listened
  completed: boolean; // Whether user marked as completed/listened
}

// Playlist-related interfaces for Nostr kind 32100 events
export interface PlaylistTrack {
  url: string;
  title?: string;
  artist?: string;
  duration?: string;
}

export interface PlaylistMetadata {
  id: string; // From 'd' tag
  title: string; // From 'alt' tag
  description?: string; // From 'd' tag
  tags?: string[]; // From 't' tags
  url?: string; // From 'u' tag
  created_at: number;
  pubkey: string;
  eventId?: string; // Nostr event id if published
  kind?: number; // Event kind (usually 32100)
  isLocal: boolean; // True if only stored locally, false if published to Nostr
}

export interface Playlist extends PlaylistMetadata {
  tracks: PlaylistTrack[];
  totalDuration?: string;
}

export interface PlaylistDraft {
  id?: string;
  title: string;
  description?: string;
  tags?: string[];
  tracks: PlaylistTrack[];
  isNewPlaylist: boolean;
}

// Poll-related interfaces for NIP-88 (Nostr kind 1068 events)
export interface PollOption {
  id: string; // Option ID (alphanumeric)
  label: string; // Option label
}

export interface PollMetadata {
  id: string; // From event id or draft id
  content: string; // Poll question/label
  options: PollOption[];
  relays: string[]; // Relays where responses should be published
  pollType: 'singlechoice' | 'multiplechoice';
  endsAt?: number; // Unix timestamp in seconds
  created_at: number; // Unix timestamp in seconds
  pubkey: string;
  eventId?: string; // Nostr event id if published
  isLocal: boolean; // True if only stored locally, false if published to Nostr
}

export interface Poll extends PollMetadata {
  responses?: PollResponse[]; // Collected responses
  results?: PollResults; // Calculated results
}

export interface PollResponse {
  id: string; // Response event id
  pollId: string; // Poll event id
  pubkey: string; // Responder's pubkey
  responseIds: string[]; // Selected option IDs
  created_at: number; // Unix timestamp in seconds
}

export interface PollResults {
  totalVotes: number;
  optionCounts: Record<string, number>; // option id -> count
  voters: string[]; // List of pubkeys who voted
}

export interface PollDraft {
  id?: string;
  content: string;
  options: PollOption[];
  relays: string[];
  pollType: 'singlechoice' | 'multiplechoice';
  endsAt?: number;
  isNewPoll: boolean;
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
