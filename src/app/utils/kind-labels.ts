/**
 * Centralized Nostr event kind label mapping.
 *
 * Provides human-readable names for known event kinds. Used across
 * the app for displaying kind information in event details, feeds,
 * debug panels, backup, and unknown-event rendering.
 */

const KIND_LABELS: Record<number, string> = {
  0: 'User Metadata',
  1: 'Short Text Note',
  2: 'Relay Recommendation',
  3: 'Contacts',
  4: 'Encrypted Direct Message',
  5: 'Event Deletion',
  6: 'Repost',
  7: 'Reaction',
  8: 'Badge Award',
  9: 'Group Chat Message',
  10: 'Group Chat Thread Reply',
  11: 'Group Thread',
  12: 'Group Thread Reply',
  16: 'Generic Repost',
  20: 'Photo',
  21: 'Video',
  22: 'Short Video',
  40: 'Channel Creation',
  41: 'Channel Metadata',
  42: 'Channel Message',
  43: 'Channel Hide Message',
  44: 'Channel Mute User',
  1040: 'OpenTimestamps',
  1063: 'File Metadata',
  1068: 'Poll',
  1084: 'Petition',
  1111: 'Comment',
  1222: 'Audio Track',
  1244: 'Audio File',
  1311: 'Live Chat Message',
  1337: 'Code Snippet',
  1984: 'Reporting',
  6969: 'Zap Poll',
  9734: 'Zap Request',
  9735: 'Zap',
  9802: 'Highlight',
  10000: 'Mute List',
  10001: 'Pin List',
  10002: 'Relay List Metadata',
  10003: 'Bookmark List',
  10005: 'Public Chats List',
  10007: 'Search Relay List',
  10023: 'Pinned Articles List',
  10040: 'Trust Provider List',
  10050: 'DM Relay List',
  10063: 'Media Server List',
  10086: 'Discovery Relay List',
  30000: 'Categorized People List',
  30001: 'Categorized Bookmark List',
  30008: 'Profile Badges',
  30009: 'Badge Definition',
  30015: 'Interest Set',
  30017: 'Marketplace Stall',
  30018: 'Marketplace Product',
  30023: 'Long-form Content',
  30024: 'Draft Long-form Content',
  30030: 'Emoji Set',
  30078: 'Application-specific Data',
  30311: 'Live Event',
  30315: 'User Status',
  30402: 'Classified Listing',
  30403: 'Draft Classified Listing',
  31871: 'Web of Trust Attestation',
  31922: 'Calendar Event (Date)',
  31923: 'Calendar Event (Time)',
  31924: 'Calendar',
  31925: 'Calendar RSVP',
  31989: 'App Recommendation',
  31990: 'App Handler',
  32100: 'M3U Playlist',
  34139: 'Music Album',
  34235: 'Video Event',
  34236: 'Short Video Event',
  36787: 'Music Track',
  39089: 'Starter Pack',
};

/**
 * Returns a human-readable label for a Nostr event kind.
 *
 * @param kind - The numeric event kind
 * @returns A descriptive label, or `Kind <n>` for unrecognized kinds
 */
export function getKindLabel(kind: number): string {
  return KIND_LABELS[kind] ?? `Kind ${kind}`;
}

/**
 * Returns true when the app has a dedicated rendering component for this kind.
 * Unknown kinds (those not in this set) should be rendered with the
 * UnknownEventComponent which shows NIP-31 alt text and NIP-89 app handler
 * suggestions.
 */
export function isKnownRenderableKind(kind: number): boolean {
  return KNOWN_RENDERABLE_KINDS.has(kind);
}

/**
 * Event kinds for which the app ships a dedicated rendering component.
 * Everything else falls into the "unknown kind" path.
 */
const KNOWN_RENDERABLE_KINDS = new Set([
  0,      // Profile Update
  1,      // Short Text Note (rendered by <app-content>)
  3,      // Following
  8,      // Badge Award
  20,     // Photo
  21,     // Video
  22,     // Short Video
  40,     // Channel Creation
  42,     // Channel Message
  1068,   // Poll
  1111,   // Comment (rendered by <app-content>)
  1222,   // Audio Track
  1244,   // Audio File
  1337,   // Code Snippet
  6969,   // Zap Poll
  9802,   // Highlight
  10086,  // Discovery Relay List
  30000,  // People Set
  30023,  // Long-form Content
  30030,  // Emoji Set
  30078,  // Settings
  30311,  // Live Event
  31871,  // Web of Trust
  32100,  // M3U Playlist
  34139,  // Music Album
  34235,  // Video Event
  34236,  // Short Video Event
  36787,  // Music Track
  39089,  // Starter Pack
]);
