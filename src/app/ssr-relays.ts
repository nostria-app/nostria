/**
 * Shared relay configuration for SSR (Server-Side Rendering) resolvers.
 *
 * These relays are used to fetch Nostr events and profiles directly during
 * server-side rendering for social sharing previews. The outbox model is too
 * slow for SSR since social media bots have very short timeouts, so we
 * connect directly to a set of popular relays that are likely to have the data.
 */

// Popular relays to query during SSR for social sharing previews.
// These should be well-connected, reliable relays with broad event coverage.
export const SSR_POPULAR_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://relay.primal.net',
  'wss://nostr.wine',
  'wss://relay.nos.social',
  'wss://nostr.mom',
  'wss://relay.mostr.pub',
];

// Timeout for direct relay fetches (milliseconds)
export const SSR_RELAY_FETCH_TIMEOUT_MS = 3000;

// Total resolver timeout — must complete within this time for social bots
export const SSR_TOTAL_RESOLVER_TIMEOUT_MS = 6000;

/**
 * Combine relay hints with popular relays, deduplicating the result.
 * Relay hints are placed first so they are prioritized by SimplePool.
 */
export function buildRelayList(relayHints?: string[]): string[] {
  if (relayHints && relayHints.length > 0) {
    return [...new Set([...relayHints, ...SSR_POPULAR_RELAYS])];
  }
  return SSR_POPULAR_RELAYS;
}
