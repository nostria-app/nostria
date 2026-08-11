/**
 * Concord protocol constants and types.
 *
 * Concord (the CORD specs) builds end-to-end encrypted Discord-style
 * communities on Nostr. Unlike NIP-29 there is no authoritative relay: relays
 * only ever carry sealed blobs addressed to rotating, meaningless pubkeys, and
 * every client independently verifies authority against an owner-rooted roster.
 *
 * Everything marked "frozen" is part of the wire format. Changing a single byte
 * re-addresses every event ever published and breaks interoperability with
 * other Concord clients (Vector, Soapbox).
 */

// ---------------------------------------------------------------------------
// Kinds (CORD-02 Appendix B, frozen)
// ---------------------------------------------------------------------------

/** Durable stream envelope (a NIP-59-shaped gift wrap, reversed — CORD-01). */
export const CORD_KIND_WRAP = 1059;
/** Realtime-only envelope; relays MUST NOT store it. */
export const CORD_KIND_WRAP_EPHEMERAL = 21059;

/** Seal whose content is the NIP-44-encrypted rumor. */
export const CORD_KIND_SEAL_ENCRYPTED = 20013;
/** Seal whose content is the rumor's serialized JSON, verbatim (Control Plane). */
export const CORD_KIND_SEAL_PLAINTEXT = 20014;

// Chat plane rumors
export const CORD_KIND_MESSAGE = 9;
export const CORD_KIND_REPLY = 1111;
export const CORD_KIND_REACTION = 7;
export const CORD_KIND_DELETE = 5;
export const CORD_KIND_TIMER_NOTICE = 1740;
export const CORD_KIND_EDIT = 3302;
export const CORD_KIND_WEBXDC = 3310;
export const CORD_KIND_TYPING = 23311;
export const CORD_KIND_VOICE_PRESENCE = 23313;

// Guestbook plane rumors
export const CORD_KIND_JOIN_LEAVE = 3306;
export const CORD_KIND_KICK = 3309;
export const CORD_KIND_SNAPSHOT = 3312;

// Control plane
export const CORD_KIND_EDITION = 3308;

// Rekey planes
export const CORD_KIND_REKEY = 3303;

// Outside the wrap
export const CORD_KIND_INVITE_BUNDLE = 33301;
export const CORD_KIND_COMMUNITY_LIST = 13302;
export const CORD_KIND_INVITE_LIST = 13303;
export const CORD_KIND_DIRECT_INVITE = 3313;

/** NIP-98-style HTTP auth, used for the A/V broker (CORD-07). */
export const CORD_KIND_HTTP_AUTH = 27235;

// ---------------------------------------------------------------------------
// Control entity sub-kinds (`vsk`, frozen)
// ---------------------------------------------------------------------------

export const VSK_METADATA = 0;
export const VSK_ROLE = 1;
export const VSK_CHANNEL = 2;
export const VSK_GRANT = 3;
export const VSK_BANLIST = 4;
export const VSK_INVITE_LIVE = 6;
export const VSK_INVITE_REGISTRY = 8;
export const VSK_INVITE_REVOKED = 9;
export const VSK_DISSOLVED = 10;
export const VSK_PINS = 11;

// ---------------------------------------------------------------------------
// HKDF labels (CORD-02 Appendix A.6, frozen)
// ---------------------------------------------------------------------------

export const LABEL_COMMUNITY = 'concord/community';
export const LABEL_CHANNEL = 'concord/channel';
export const LABEL_CONTROL = 'concord/control';
export const LABEL_CONTROL_SIGNER = 'concord/control-signer';
export const LABEL_GUESTBOOK = 'concord/guestbook';
export const LABEL_REKEY_PSEUDONYM = 'concord/rekey-pseudonym';
export const LABEL_BASE_REKEY_PSEUDONYM = 'concord/base-rekey-pseudonym';
export const LABEL_RECIPIENT_PSEUDONYM = 'concord/recipient-pseudonym';
export const LABEL_DISSOLVED = 'concord/dissolved';
export const LABEL_GRANT = 'concord/grant';
export const LABEL_BANLIST = 'concord/banlist';
export const LABEL_PINS = 'concord/pins';
export const LABEL_INVITE_LINKS = 'concord/invite-links';
export const LABEL_INVITE_KEY = 'concord/invite-key';
export const LABEL_VOICE_SIGNER = 'concord/voice-signer';
export const LABEL_VOICE_MEDIA = 'concord/voice-media';
export const LABEL_VOICE_SENDER = 'concord/voice-sender';
export const LABEL_EPOCH_COMMITMENT = 'concord/epoch-key-commitment';

/** Domain label for the edition hash preimage (CORD-04 §1, frozen). */
export const LABEL_EDITION = 'vector-community/v1/edition';

// ---------------------------------------------------------------------------
// Permissions (CORD-04 §3, frozen bit positions)
// ---------------------------------------------------------------------------

export const PERM_MANAGE_ROLES = 1n << 0n;
export const PERM_MANAGE_CHANNELS = 1n << 1n;
export const PERM_MANAGE_METADATA = 1n << 2n;
export const PERM_KICK = 1n << 3n;
export const PERM_BAN = 1n << 4n;
export const PERM_MANAGE_MESSAGES = 1n << 5n;
export const PERM_CREATE_INVITE = 1n << 6n;
// 1<<7 retired (was MANAGE_INVITES)
export const PERM_VIEW_AUDIT_LOG = 1n << 8n;
export const PERM_MENTION_EVERYONE = 1n << 9n;
export const PERM_PIN_MESSAGES = 1n << 11n;

/** Human-facing permission catalogue, in display order. */
export const CORD_PERMISSIONS: { bit: bigint; key: string; label: string; description: string }[] = [
  { bit: PERM_MANAGE_ROLES, key: 'MANAGE_ROLES', label: 'Manage roles', description: 'Create roles and grant them to members.' },
  { bit: PERM_MANAGE_CHANNELS, key: 'MANAGE_CHANNELS', label: 'Manage channels', description: 'Create, rename, and delete channels.' },
  { bit: PERM_MANAGE_METADATA, key: 'MANAGE_METADATA', label: 'Manage community', description: 'Edit the name, description, icon, and timer.' },
  { bit: PERM_KICK, key: 'KICK', label: 'Kick members', description: 'Ask a member\u2019s client to leave the community.' },
  { bit: PERM_BAN, key: 'BAN', label: 'Ban members', description: 'Silence a member and re-found the community to cut their access.' },
  { bit: PERM_MANAGE_MESSAGES, key: 'MANAGE_MESSAGES', label: 'Manage messages', description: 'Delete other members\u2019 messages.' },
  { bit: PERM_CREATE_INVITE, key: 'CREATE_INVITE', label: 'Create invites', description: 'Mint shareable invite links.' },
  { bit: PERM_PIN_MESSAGES, key: 'PIN_MESSAGES', label: 'Pin messages', description: 'Pin messages to a channel.' },
  { bit: PERM_VIEW_AUDIT_LOG, key: 'VIEW_AUDIT_LOG', label: 'View audit log', description: 'Read the community\u2019s action history.' },
  { bit: PERM_MENTION_EVERYONE, key: 'MENTION_EVERYONE', label: 'Mention everyone', description: 'Notify every member at once.' },
];

/**
 * Bits whose actions land as Control Plane editions. A member holding any of
 * them is "staff" and therefore holds the control_root (CORD-04 §3).
 * This list is normative — extending it requires a spec amendment.
 */
export const CORD_STAFF_PERMISSIONS =
  PERM_MANAGE_ROLES |
  PERM_MANAGE_CHANNELS |
  PERM_MANAGE_METADATA |
  PERM_BAN |
  PERM_CREATE_INVITE |
  PERM_PIN_MESSAGES;

// ---------------------------------------------------------------------------
// Protocol limits
// ---------------------------------------------------------------------------

/** NIP-44 hard-caps plaintext; enforced at every nesting layer. */
export const CORD_NIP44_MAX_PLAINTEXT = 65535;
/** Community name cap, uniform across communities, channels and roles. */
export const CORD_NAME_MAX_BYTES = 64;
export const CORD_DESCRIPTION_MAX_BYTES = 10000;
/** Memberships in one Community List (CORD-02 §8). */
export const CORD_MAX_MEMBERSHIPS = 50;
/** Roles per community, and per member. */
export const CORD_MAX_ROLES = 100;
export const CORD_MAX_ROLES_PER_MEMBER = 64;
/** Recipients per rekey event (CORD-06 §1). */
export const CORD_REKEY_BLOBS_PER_EVENT = 120;
/** Members per guestbook snapshot chunk (CORD-02 §5). */
export const CORD_SNAPSHOT_CHUNK = 400;
/** A guestbook entry dated further ahead than this is dropped. */
export const CORD_GUESTBOOK_FUTURE_SKEW_MS = 60 * 60 * 1000;
/** Pin list caps (CORD-04 §7). */
export const CORD_MAX_PINS = 25;
export const CORD_MAX_PIN_BYTES = 32768;
/** Bundle sanity bound against hostile invite links (CORD-05 §1). */
export const CORD_MAX_BUNDLE_CHANNELS = 256;
/** Recommended relay count for a community (CORD-02 §6). */
export const CORD_MAX_RELAYS = 5;
/** Bootstrap relays carried in an invite fragment (CORD-05 §3). */
export const CORD_MAX_FRAGMENT_RELAYS = 3;

/**
 * The stock relay dictionary (CORD-05 §3, generation 4). Referenced by a single
 * byte in an invite fragment, so these ids are part of the wire format.
 */
export const CORD_RELAY_DICTIONARY: Record<number, string> = {
  1: 'wss://jskitty.com/nostr',
  2: 'wss://asia.vectorapp.io/nostr',
  3: 'wss://relay.ditto.pub',
  4: 'wss://relay.dreamith.to',
};

/**
 * What the fragment's "stock set" flag expands to.
 *
 * This is wire format, not preference: a link minted with the flag set means
 * exactly these four relays, so the list must match every other Concord client
 * byte for byte or such links resolve to the wrong hosts.
 */
export const CORD_STOCK_RELAYS = [
  CORD_RELAY_DICTIONARY[1],
  CORD_RELAY_DICTIONARY[2],
  CORD_RELAY_DICTIONARY[3],
  CORD_RELAY_DICTIONARY[4],
];

/**
 * The relays Nostria itself chooses — for new communities, and for mirroring
 * the member's own encrypted lists.
 *
 * Separate from the dictionary above on purpose: this is the one we are free to
 * change, because nothing on the wire refers to it.
 */
export const CORD_DEFAULT_RELAYS = [
  CORD_RELAY_DICTIONARY[3],
  CORD_RELAY_DICTIONARY[4],
];

/** Invite fragment format version; also selects the dictionary generation. */
export const CORD_FRAGMENT_VERSION = 4;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A derived stream keypair plus its NIP-44 self-conversation key. */
export interface CordGroupKey {
  /** 32-byte secret key. */
  sk: Uint8Array;
  /** x-only public key, lowercase hex — the stream address. */
  pk: string;
  /** NIP-44 conversation key (self-ECDH), encrypting the wrap. */
  convKey: Uint8Array;
}

/** An unsigned Nostr rumor: the innermost event, carrying the functional kind. */
export interface CordRumor {
  id?: string;
  kind: number;
  pubkey: string;
  content: string;
  tags: string[][];
  created_at: number;
}

/** The invite payload that confers membership (CORD-05 §1). */
export interface CordInviteBundle {
  community_id: string;
  owner: string;
  owner_salt: string;
  community_root: string;
  root_epoch: number;
  /** Control Plane signer pubkey. Absent on legacy, pre-split communities. */
  control_pk?: string;
  channels: CordInviteChannel[];
  relays: string[];
  name?: string;
  icon?: CordBlobPointer;
  expires_at?: number;
  creator_npub?: string;
  label?: string;
  /** Present only in a member's own Community List, never in a shared link. */
  control_root?: string;
}

export interface CordInviteChannel {
  id: string;
  key: string;
  epoch: number;
  name?: string;
}

/** An encrypted-blob pointer for icons and banners (CORD-02 §6). */
export interface CordBlobPointer {
  url: string;
  key: string;
  nonce: string;
  hash: string;
}

/** Community metadata entity (vsk 0). */
export interface CordCommunityMetadata {
  name: string;
  description?: string;
  relays?: string[];
  icon?: CordBlobPointer | string;
  banner?: CordBlobPointer | string;
  /** Disappearing-messages timer in seconds; absent or 0 means off (CORD-08). */
  message_expiration?: number;
  custom?: Record<string, unknown>;
}

/** Channel metadata entity (vsk 2). */
export interface CordChannelMetadata {
  name: string;
  private: boolean;
  deleted?: boolean;
  custom?: Record<string, unknown>;
}

/** Role entity (vsk 1). */
export interface CordRole {
  role_id: string;
  name: string;
  /** Lower is higher authority; the owner is 0 and is never a role. */
  position: number;
  /** u64 bitfield as a decimal string. */
  permissions: string;
  scope?: { kind: 'server' } | { kind: 'channel'; channel_id: string };
  color?: number;
}

/** Grant entity (vsk 3). */
export interface CordGrant {
  member: string;
  role_ids: string[];
  /** Pairwise-encrypted control_root, delivered on promotion to staff. */
  control_wrap?: string;
}

/** A folded Control Plane edition. */
export interface CordEdition {
  /** Entity type (`vsk`). */
  vsk: number;
  /** Stable entity coordinate. */
  eid: string;
  version: number;
  /** Hash of the edition this supersedes; absent on the first. */
  prev?: string;
  /** This edition's hash, the value a successor cites in `ep`. */
  hash: string;
  /** Raw content bytes as carried, never re-serialized. */
  content: string;
  /** The actor who signed the seal. */
  actor: string;
  createdAt: number;
  /** Authority citation: [grant eid, version, edition hash]. */
  vac?: [string, string, string];
  /** The rumor as received, retained so compaction can re-wrap it verbatim. */
  rumor: CordRumor;
  /** The seal event, retained verbatim for re-wrapping. */
  seal: CordSealEvent;
}

/** A seal event as it appears inside a wrap. */
export interface CordSealEvent {
  id: string;
  kind: number;
  pubkey: string;
  content: string;
  tags: string[][];
  created_at: number;
  sig: string;
}

/** A member's state as folded from the Guestbook. */
export interface CordMemberState {
  pubkey: string;
  status: 'present' | 'departed';
  /** Millisecond timestamp of the entry that decided this state. */
  at: number;
  source: 'join' | 'leave' | 'kick' | 'snapshot' | 'observed';
  /** Invite attribution echoed from the bundle, when the Join carried it. */
  invite?: { creator: string; label?: string };
}

/** A chat message as rendered in the timeline. */
export interface CordMessage {
  id: string;
  channelId: string;
  pubkey: string;
  content: string;
  /** True time in milliseconds: created_at * 1000 + ms. */
  timestamp: number;
  kind: number;
  /** Thread root, for kind 1111 replies. */
  threadRoot?: string;
  /** Immediate parent, for kind 1111 replies. */
  parent?: string;
  /** Quoted rumor id, for inline quotes. */
  quote?: string;
  /** Replacement text from the newest Edit that applies. */
  editedContent?: string;
  editedAt?: number;
  deleted?: boolean;
  reactions?: CordReaction[];
  /** NIP-40 expiry in unix seconds, when the community timer is set. */
  expiration?: number;
  rumor: CordRumor;
  /** Retained verbatim so this message can be pinned with proof later. */
  seal?: CordSealEvent;
  /** The outer wrap id, an unverifiable jump-to-context hint for pins. */
  wrapId?: string;
}

export interface CordReaction {
  emoji: string;
  pubkey: string;
  timestamp: number;
  /** NIP-30 custom emoji URL, when the reaction referenced a shortcode. */
  url?: string;
}

/** A community as held by this client. */
export interface CordCommunity {
  communityId: string;
  owner: string;
  ownerSalt: string;
  communityRoot: string;
  rootEpoch: number;
  controlPk?: string;
  /** Held only by staff. */
  controlRoot?: string;
  channelKeys: CordInviteChannel[];
  relays: string[];
  /** Preview name from the invite, superseded by the Control Plane fold. */
  name?: string;
  addedAt: number;
}

/** A channel as folded from the Control Plane. */
export interface CordChannel {
  channelId: string;
  name: string;
  private: boolean;
  deleted: boolean;
  /** Key and epoch for a private channel; absent for a public one. */
  key?: string;
  epoch: number;
  custom?: Record<string, unknown>;
}

/** Which stream a plane's key addresses. */
export type CordPlane = 'control' | 'chat' | 'guestbook';
