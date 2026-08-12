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
  return localizedKindLabel(kind) ?? KIND_LABELS[kind] ?? $localize`:@@kind.unknown:Kind ${kind}:kind:`;
}

function localizedKindLabel(kind: number): string | undefined {
  switch (kind) {
    case 0: return $localize`:@@kind.0:User Metadata`;
    case 1: return $localize`:@@kind.1:Short Text Note`;
    case 2: return $localize`:@@kind.2:Relay Recommendation`;
    case 3: return $localize`:@@kind.3:Contacts`;
    case 4: return $localize`:@@kind.4:Encrypted Direct Message`;
    case 5: return $localize`:@@kind.5:Event Deletion`;
    case 6: return $localize`:@@kind.6:Repost`;
    case 7: return $localize`:@@kind.7:Reaction`;
    case 8: return $localize`:@@kind.8:Badge Award`;
    case 9: return $localize`:@@kind.9:Group Chat Message`;
    case 10: return $localize`:@@kind.10:Group Chat Thread Reply`;
    case 11: return $localize`:@@kind.11:Group Thread`;
    case 12: return $localize`:@@kind.12:Group Thread Reply`;
    case 16: return $localize`:@@kind.16:Generic Repost`;
    case 20: return $localize`:@@kind.20:Photo`;
    case 21: return $localize`:@@kind.21:Video`;
    case 22: return $localize`:@@kind.22:Short Video`;
    case 40: return $localize`:@@kind.40:Channel Creation`;
    case 41: return $localize`:@@kind.41:Channel Metadata`;
    case 42: return $localize`:@@kind.42:Channel Message`;
    case 43: return $localize`:@@kind.43:Channel Hide Message`;
    case 44: return $localize`:@@kind.44:Channel Mute User`;
    case 1040: return $localize`:@@kind.1040:OpenTimestamps`;
    case 1063: return $localize`:@@kind.1063:File Metadata`;
    case 1068: return $localize`:@@kind.1068:Poll`;
    case 1084: return $localize`:@@kind.1084:Petition`;
    case 1111: return $localize`:@@kind.1111:Comment`;
    case 1222: return $localize`:@@kind.1222:Audio Track`;
    case 1244: return $localize`:@@kind.1244:Audio File`;
    case 1311: return $localize`:@@kind.1311:Live Chat Message`;
    case 1337: return $localize`:@@kind.1337:Code Snippet`;
    case 1984: return $localize`:@@kind.1984:Reporting`;
    case 6969: return $localize`:@@kind.6969:Zap Poll`;
    case 9734: return $localize`:@@kind.9734:Zap Request`;
    case 9735: return $localize`:@@kind.9735:Zap`;
    case 9802: return $localize`:@@kind.9802:Highlight`;
    case 10000: return $localize`:@@kind.10000:Mute List`;
    case 10001: return $localize`:@@kind.10001:Pin List`;
    case 10002: return $localize`:@@kind.10002:Relay List Metadata`;
    case 10003: return $localize`:@@kind.10003:Bookmark List`;
    case 10005: return $localize`:@@kind.10005:Public Chats List`;
    case 10007: return $localize`:@@kind.10007:Search Relay List`;
    case 10023: return $localize`:@@kind.10023:Pinned Articles List`;
    case 10040: return $localize`:@@kind.10040:Trust Provider List`;
    case 10050: return $localize`:@@kind.10050:DM Relay List`;
    case 10063: return $localize`:@@kind.10063:Media Server List`;
    case 10086: return $localize`:@@kind.10086:Discovery Relay List`;
    case 30000: return $localize`:@@kind.30000:Categorized People List`;
    case 30001: return $localize`:@@kind.30001:Categorized Bookmark List`;
    case 30008: return $localize`:@@kind.30008:Profile Badges`;
    case 30009: return $localize`:@@kind.30009:Badge Definition`;
    case 30015: return $localize`:@@kind.30015:Interest Set`;
    case 30017: return $localize`:@@kind.30017:Marketplace Stall`;
    case 30018: return $localize`:@@kind.30018:Marketplace Product`;
    case 30023: return $localize`:@@kind.30023:Long-form Content`;
    case 30024: return $localize`:@@kind.30024:Draft Long-form Content`;
    case 30030: return $localize`:@@kind.30030:Emoji Set`;
    case 30078: return $localize`:@@kind.30078:Application-specific Data`;
    case 30311: return $localize`:@@kind.30311:Live Event`;
    case 30315: return $localize`:@@kind.30315:User Status`;
    case 30402: return $localize`:@@kind.30402:Classified Listing`;
    case 30403: return $localize`:@@kind.30403:Draft Classified Listing`;
    case 31871: return $localize`:@@kind.31871:Web of Trust Attestation`;
    case 31922: return $localize`:@@kind.31922:Calendar Event (Date)`;
    case 31923: return $localize`:@@kind.31923:Calendar Event (Time)`;
    case 31924: return $localize`:@@kind.31924:Calendar`;
    case 31925: return $localize`:@@kind.31925:Calendar RSVP`;
    case 31989: return $localize`:@@kind.31989:App Recommendation`;
    case 31990: return $localize`:@@kind.31990:App Handler`;
    case 32100: return $localize`:@@kind.32100:M3U Playlist`;
    case 34139: return $localize`:@@kind.34139:Music Album`;
    case 34235: return $localize`:@@kind.34235:Video Event`;
    case 34236: return $localize`:@@kind.34236:Short Video Event`;
    case 36787: return $localize`:@@kind.36787:Music Track`;
    case 39089: return $localize`:@@kind.39089:Starter Pack`;
    default: return undefined;
  }
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
