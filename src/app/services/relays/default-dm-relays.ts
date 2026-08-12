/**
 * Auth-friendly default inbox relays for kind 10050 (NIP-17 DMs).
 *
 * These relays support NIP-42 authentication for kind 1059 gift wraps.
 * Note: wss://auth.nostr1.com is auth-only for all events and must not be
 * used as a default for media relay lists (kind 10051).
 */
export const DEFAULT_DM_RELAYS = [
  'wss://auth.nostr1.com/',
  'wss://relay.ditto.pub/',
  'wss://chat.wisp.talk/',
  'wss://relay.dreamith.to/',
] as const;
