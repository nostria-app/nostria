import { Event } from 'nostr-tools';

/**
 * NIP-29 (Relay-based Groups) types.
 *
 * Terminology used in the Nostria UI (Discord-like):
 *  - "Server"  = a relay that hosts NIP-29 groups.
 *  - "Channel" = a NIP-29 group (kind:39000). Groups can be nested via
 *                `parent`/`child` tags, which we render as categories.
 */

/** Relay-generated addressable events. */
export const NIP29_KIND_METADATA = 39000;
export const NIP29_KIND_ADMINS = 39001;
export const NIP29_KIND_MEMBERS = 39002;
export const NIP29_KIND_ROLES = 39003;
export const NIP29_KIND_LIVEKIT_PARTICIPANTS = 39004;
export const NIP29_KIND_PINNED = 39005;

/** User-created content. */
export const NIP29_KIND_CHAT = 9;
export const NIP29_KIND_THREAD = 11;
export const NIP29_KIND_THREAD_REPLY = 1111;

/** User-related group management. */
export const NIP29_KIND_JOIN_REQUEST = 9021;
export const NIP29_KIND_LEAVE_REQUEST = 9022;

/** Moderation. */
export const NIP29_KIND_PUT_USER = 9000;
export const NIP29_KIND_REMOVE_USER = 9001;
export const NIP29_KIND_EDIT_METADATA = 9002;
export const NIP29_KIND_DELETE_EVENT = 9005;
export const NIP29_KIND_CREATE_GROUP = 9007;
export const NIP29_KIND_DELETE_GROUP = 9008;
export const NIP29_KIND_CREATE_INVITE = 9009;
export const NIP29_KIND_UPDATE_PIN_LIST = 9010;

/** NIP-51 list of groups the user wants to remember being in. */
export const NIP29_KIND_GROUPS_LIST = 10009;

/** NIP-98 HTTP auth event kind, used for the LiveKit token endpoint. */
export const NIP98_KIND_HTTP_AUTH = 27235;

/** All relay-generated addressable kinds, fetched together in a single filter. */
export const NIP29_ADDRESSABLE_KINDS = [
  NIP29_KIND_METADATA,
  NIP29_KIND_ADMINS,
  NIP29_KIND_MEMBERS,
  NIP29_KIND_ROLES,
  NIP29_KIND_LIVEKIT_PARTICIPANTS,
  NIP29_KIND_PINNED,
];

/** A relay hosting NIP-29 groups. */
export interface Nip29Server {
  /** Normalized relay URL, e.g. `wss://groups.0xchat.com/`. */
  url: string;
  /** Route-safe identifier derived from the URL host (+ path). */
  slug: string;
  /** Display name, from NIP-11 when available, otherwise the host name. */
  name: string;
  /** Icon URL from NIP-11 `icon`. */
  icon?: string;
  /** Short description from NIP-11 `description`. */
  description?: string;
  /** The relay's own pubkey (NIP-11 `self`) that signs kind:390xx events. */
  selfPubkey?: string;
  /** Whether the relay advertises subgroup support (`nip29.subgroups`). */
  supportsSubgroups?: boolean;
  /** Whether the relay advertises LiveKit support (204 on the well-known path). */
  supportsLivekit?: boolean;
  /** Whether the user explicitly added this server (vs. a built-in suggestion). */
  added: boolean;
  /** Unix seconds when NIP-11 info was last fetched. */
  infoFetchedAt?: number;
}

export interface Nip29Role {
  name: string;
  description?: string;
}

export interface Nip29Admin {
  pubkey: string;
  roles: string[];
}

/** A NIP-29 group as reconstructed from the relay-generated events. */
export interface Nip29Group {
  /** Relay URL this group lives on. */
  relay: string;
  /** Group `d` identifier. */
  id: string;
  name: string;
  picture?: string;
  banner?: string;
  about?: string;
  /** Only members can read. */
  isPrivate: boolean;
  /** Only members can write. */
  isRestricted: boolean;
  /** Metadata hidden from non-members. */
  isHidden: boolean;
  /** Join requests are ignored unless an invite code is supplied. */
  isClosed: boolean;
  /** Group supports LiveKit audio/video rooms. */
  hasLivekit: boolean;
  /**
   * Kinds the group accepts. `undefined` means "all kinds supported".
   * An empty array means no event kinds are supported (AV-only group).
   */
  supportedKinds?: number[];
  /** Parent group `d` identifier, when this is a subgroup. */
  parent?: string;
  /** Ordered list of child group identifiers. */
  children: string[];
  /** created_at of the kind:39000 event. */
  updatedAt: number;
}

/** Extra, lazily-loaded details about a group. */
export interface Nip29GroupDetails {
  admins: Nip29Admin[];
  members: string[];
  roles: Nip29Role[];
  /** Event ids / addresses pinned by moderators, in display order. */
  pinned: string[];
  /** Pubkeys currently connected to the group's LiveKit room. */
  livekitParticipants: string[];
  /** Unix ms of the last successful fetch, used for TTL caching. */
  fetchedAt: number;
}

export type Nip29Membership = 'member' | 'not-member' | 'unknown';

/** A chat message (kind:9) or thread root (kind:11) rendered in the timeline. */
export interface Nip29Message {
  id: string;
  pubkey: string;
  content: string;
  createdAt: number;
  kind: number;
  /** Id of the message this one replies to, when set. */
  replyTo?: string;
  /** Subject/title, used by threads (kind:11). */
  subject?: string;
  event: Event;
}

/** Cached, serializable snapshot of a server's group list. */
export interface Nip29ServerCache {
  relay: string;
  /** Unix ms when the group list was fetched. */
  fetchedAt: number;
  groups: Nip29Group[];
}

/** An entry in the user's kind:10009 list. */
export interface Nip29GroupsListEntry {
  groupId: string;
  relay: string;
  name?: string;
}

/** Node in the channel tree rendered in the sidebar. */
export interface Nip29GroupNode {
  group: Nip29Group;
  children: Nip29GroupNode[];
  depth: number;
}

/** Result of requesting a LiveKit token from a relay. */
export interface Nip29LivekitToken {
  token: string;
  url: string;
}
