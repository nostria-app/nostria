import { inject, Injectable, makeStateKey, TransferState } from '@angular/core';
import { ActivatedRouteSnapshot, Resolve } from '@angular/router';
import { NostrService } from './services/nostr.service';
import { LayoutService } from './services/layout.service';
import { Meta } from '@angular/platform-browser';
import { UtilitiesService } from './services/utilities.service';
import { MetaService } from './services/meta.service';
import { UsernameService } from './services/username';
import { Event, kinds, nip05, nip19 } from 'nostr-tools';
import { SSR_RELAY_FETCH_TIMEOUT_MS, SSR_TOTAL_RESOLVER_TIMEOUT_MS, buildRelayList } from './ssr-relays';

export const EVENT_STATE_KEY = makeStateKey<any>('large-json-data');
const SSR_DEBUG_LOGS =
  typeof process !== 'undefined' &&
  typeof process.env !== 'undefined' &&
  process.env['SSR_DEBUG_LOGS'] === 'true';

function debugLog(message: string, ...args: unknown[]): void {
  if (!SSR_DEBUG_LOGS) {
    return;
  }
  console.log(message, ...args);
}

// Known addressable event kinds
const MUSIC_KIND = 36787;
const MUSIC_PLAYLIST_KIND = 34139;
const ARTICLE_KIND = kinds.LongFormArticle; // 30023

/**
 * Configure nostr-tools to use Node.js WebSocket implementation during SSR.
 */
let ssrWebSocketConfigured = false;

async function configureSsrWebSocketImplementation(): Promise<void> {
  if (ssrWebSocketConfigured) {
    return;
  }

  const [{ WebSocket: WS }, { useWebSocketImplementation }] = await Promise.all([
    import('ws'),
    import('nostr-tools/pool'),
  ]);

  useWebSocketImplementation(WS as unknown as typeof WebSocket);
  ssrWebSocketConfigured = true;
}

async function createSSRPool() {
  await configureSsrWebSocketImplementation();

  const { SimplePool } = await import('nostr-tools/pool');
  return new SimplePool({ enablePing: true, enableReconnect: true });
}

/**
 * Fetch event directly from relays by ID
 */
async function fetchEventFromRelays(eventId: string, relayHints?: string[], timeoutMs = SSR_RELAY_FETCH_TIMEOUT_MS): Promise<Event | null> {
  const pool = await createSSRPool();
  const relays = buildRelayList(relayHints);

  const startedAt = Date.now();
  let didTimeout = false;

  debugLog('[SSR] DataResolver: Fetching event from relays', {
    relayCount: relays.length,
    relayHintsCount: relayHints?.length || 0,
  });

  try {
    const event = await Promise.race([
      pool.get(relays, { ids: [eventId] }),
      new Promise<Event | null>((resolve) => setTimeout(() => {
        didTimeout = true;
        resolve(null);
      }, timeoutMs))
    ]);

    pool.close(relays);

    const durationMs = Date.now() - startedAt;
    if (didTimeout) {
      debugLog(`[SSR] DataResolver: Event relay fetch timed out after ${durationMs}ms (timeout ${timeoutMs}ms)`);
    } else if (event) {
      debugLog(`[SSR] DataResolver: Event relay fetch resolved in ${durationMs}ms`, { kind: event.kind, created_at: event.created_at });
    } else {
      console.warn(`[SSR] DataResolver: Event relay fetch returned null in ${durationMs}ms before timeout`);
    }

    return event;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.error(`[SSR] DataResolver: Error fetching from relays after ${durationMs}ms:`, error);
    pool.close(relays);
    return null;
  }
}

/**
 * Fetch event directly from relays by address (kind, pubkey, identifier)
 */
async function fetchEventByAddress(kind: number, pubkey: string, identifier: string, relayHints?: string[], timeoutMs = SSR_RELAY_FETCH_TIMEOUT_MS): Promise<Event | null> {
  const pool = await createSSRPool();
  const relays = buildRelayList(relayHints);

  const startedAt = Date.now();
  let didTimeout = false;

  debugLog('[SSR] DataResolver: Fetching by address from relays', {
    relayCount: relays.length,
    relayHintsCount: relayHints?.length || 0,
    kind,
    pubkey,
    identifier,
  });

  try {
    const event = await Promise.race([
      pool.get(relays, {
        kinds: [kind],
        authors: [pubkey],
        '#d': [identifier],
      }),
      new Promise<Event | null>((resolve) => setTimeout(() => {
        didTimeout = true;
        resolve(null);
      }, timeoutMs))
    ]);

    pool.close(relays);

    const durationMs = Date.now() - startedAt;
    if (didTimeout) {
      debugLog(`[SSR] DataResolver: Address relay fetch timed out after ${durationMs}ms (timeout ${timeoutMs}ms)`);
    } else if (event) {
      debugLog(`[SSR] DataResolver: Address relay fetch resolved in ${durationMs}ms`, { kind: event.kind, created_at: event.created_at });
    } else {
      console.warn(`[SSR] DataResolver: Address relay fetch returned null in ${durationMs}ms before timeout`);
    }

    return event;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.error(`[SSR] DataResolver: Error fetching by address after ${durationMs}ms:`, error);
    pool.close(relays);
    return null;
  }
}

/**
 * Fetch a user profile (kind 0 metadata) directly from relays.
 * Used for profile pages (npub/nprofile) to get social preview data
 * without waiting for the outbox model discovery.
 */
async function fetchProfileFromRelays(pubkey: string, relayHints?: string[], timeoutMs = SSR_RELAY_FETCH_TIMEOUT_MS): Promise<Event | null> {
  const pool = await createSSRPool();
  const relays = buildRelayList(relayHints);

  const startedAt = Date.now();
  let didTimeout = false;

  debugLog('[SSR] DataResolver: Fetching profile from relays', {
    relayCount: relays.length,
    relayHintsCount: relayHints?.length || 0,
    pubkey,
  });

  try {
    const event = await Promise.race([
      pool.get(relays, {
        kinds: [0],
        authors: [pubkey],
      }),
      new Promise<Event | null>((resolve) => setTimeout(() => {
        didTimeout = true;
        resolve(null);
      }, timeoutMs))
    ]);

    pool.close(relays);

    const durationMs = Date.now() - startedAt;
    if (didTimeout) {
      debugLog(`[SSR] DataResolver: Profile relay fetch timed out after ${durationMs}ms (timeout ${timeoutMs}ms)`);
    } else if (event) {
      debugLog(`[SSR] DataResolver: Profile relay fetch resolved in ${durationMs}ms`, { created_at: event.created_at });
    } else {
      console.warn(`[SSR] DataResolver: Profile relay fetch returned null in ${durationMs}ms before timeout`);
    }

    return event;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.error(`[SSR] DataResolver: Error fetching profile from relays after ${durationMs}ms:`, error);
    pool.close(relays);
    return null;
  }
}

/**
 * Extract pubkey and relay hints from an npub or nprofile identifier.
 * Returns null if the id is not a profile identifier.
 */
function decodeProfileFromId(id: string): { pubkey: string; relays?: string[] } | null {
  try {
    if (id.startsWith('nprofile')) {
      const decoded = nip19.decode(id);
      if (decoded.type === 'nprofile') {
        return {
          pubkey: decoded.data.pubkey,
          relays: decoded.data.relays,
        };
      }
    } else if (id.startsWith('npub')) {
      const decoded = nip19.decode(id);
      if (decoded.type === 'npub') {
        return { pubkey: decoded.data };
      }
    }
  } catch {
    // Invalid encoding
  }
  return null;
}

/**
 * Parse a single imeta tag into a key-value map.
 * Format: ["imeta", "url https://...", "m image/jpeg", "image https://thumb.jpg", ...]
 */
function parseImetaTag(tag: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let i = 1; i < tag.length; i++) {
    const part = tag[i];
    if (!part) continue;
    const spaceIndex = part.indexOf(' ');
    if (spaceIndex > 0) {
      const key = part.substring(0, spaceIndex);
      const value = part.substring(spaceIndex + 1);
      if (!parsed[key]) {
        parsed[key] = value;
      }
    }
  }
  return parsed;
}

/**
 * Extract the best image URL from a relay-fetched event for social sharing.
 *
 * Priority:
 * 1. Explicit `image` tag value (used by music tracks, etc.)
 * 2. imeta tag with image mime type (`m image/*`) → use its `url`
 * 3. imeta tag with a video thumbnail (`image` field, per NIP-71)
 * 4. Image URL found in the event content text
 * 5. YouTube thumbnail extracted from content
 * 6. Author profile picture (fallback)
 */
function extractImageFromEvent(event: Event, authorPicture?: string): string | null {
  const tags = event.tags;

  // 1. Explicit 'image' tag
  if (tags) {
    const imageTag = tags.find((t: string[]) => t[0] === 'image' && t[1]);
    if (imageTag) return imageTag[1];
  }

  // 2 & 3. imeta tags — prefer image-type URL, then video thumbnail
  if (tags) {
    let firstVideoThumbnail: string | null = null;

    for (const tag of tags) {
      if (!Array.isArray(tag) || tag[0] !== 'imeta') continue;

      const parsed = parseImetaTag(tag);

      // Direct image attachment
      if (parsed['m']?.startsWith('image/') && parsed['url']) {
        return parsed['url'];
      }

      // Video thumbnail (NIP-71 `image` field)
      if (!firstVideoThumbnail && parsed['image']) {
        firstVideoThumbnail = parsed['image'];
      }

      // URL that looks like an image (no mime type specified)
      if (!parsed['m'] && parsed['url']) {
        if (/\.(jpg|jpeg|png|gif|webp|avif|svg)(\?|$)/i.test(parsed['url'])) {
          return parsed['url'];
        }
      }
    }

    if (firstVideoThumbnail) return firstVideoThumbnail;
  }

  // 4. Image URL in content
  if (event.content) {
    const urlRegex = /(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp))/i;
    const match = event.content.match(urlRegex);
    if (match) return match[0];
  }

  // 5. YouTube thumbnail from content
  if (event.content) {
    const ytId = extractYouTubeId(event.content);
    if (ytId) return `https://img.youtube.com/vi/${ytId}/0.jpg`;
  }

  // 6. Author picture fallback
  return authorPicture || null;
}

/**
 * Extract YouTube video ID from various URL formats.
 */
function extractYouTubeId(text: string): string | null {
  if (!text) return null;
  const patterns = [
    /youtube\.com\/embed\/([a-zA-Z0-9_-]+)/,
    /[?&]v=([a-zA-Z0-9_-]+)/,
    /youtu\.be\/([a-zA-Z0-9_-]+)/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/,
    /youtube\.com\/live\/([a-zA-Z0-9_-]+)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Extract profile picture URL from a kind 0 profile event.
 */
function extractProfilePictureFromEvent(profileEvent: Event): string | undefined {
  try {
    const profileContent = JSON.parse(profileEvent.content);
    const picture = profileContent.picture || profileContent.image;
    return typeof picture === 'string' && picture.trim() ? picture : undefined;
  } catch {
    return undefined;
  }
}

function canonicalizeNostrIdentifier(identifier: string): string {
  if (!identifier) {
    return identifier;
  }

  try {
    const decoded = nip19.decode(identifier);

    if (decoded.type === 'nevent') {
      return nip19.neventEncode({
        id: decoded.data.id,
        author: decoded.data.author,
        kind: decoded.data.kind,
      });
    }

    if (decoded.type === 'naddr') {
      return nip19.naddrEncode({
        kind: decoded.data.kind,
        pubkey: decoded.data.pubkey,
        identifier: decoded.data.identifier,
      });
    }

    if (decoded.type === 'nprofile') {
      return nip19.npubEncode(decoded.data.pubkey);
    }
  } catch {
    return identifier;
  }

  return identifier;
}

function buildFallbackSocialMetadata(routePath: string, id: string): { title: string; description: string; url: string } {
  const normalizedId = canonicalizeNostrIdentifier(id);

  if (routePath.startsWith('e/')) {
    return {
      title: 'Nostr Note on Nostria',
      description: 'Open this Nostr note on Nostria, the decentralized social app.',
      url: `https://nostria.app/e/${normalizedId}`,
    };
  }

  if (routePath.startsWith('a/') || normalizedId.startsWith('naddr')) {
    return {
      title: 'Nostr Article on Nostria',
      description: 'Open this Nostr article on Nostria, the decentralized social app.',
      url: `https://nostria.app/a/${normalizedId}`,
    };
  }

  if (routePath.startsWith('p/') || routePath.startsWith('u/') || routePath.startsWith('music/artist')) {
    return {
      title: 'Nostr Profile on Nostria',
      description: 'View this Nostr profile on Nostria, the decentralized social app.',
      url: `https://nostria.app/p/${normalizedId}`,
    };
  }

  if (routePath.startsWith('music/song')) {
    return {
      title: 'Nostr Song on Nostria',
      description: 'Listen to this track on Nostria, the decentralized social app.',
      url: `https://nostria.app/music/song/${normalizedId}`,
    };
  }

  if (routePath.startsWith('music/playlist')) {
    return {
      title: 'Nostr Playlist on Nostria',
      description: 'Open this playlist on Nostria, the decentralized social app.',
      url: `https://nostria.app/music/playlist/${normalizedId}`,
    };
  }

  return {
    title: 'Nostr Post on Nostria',
    description: 'Open this content on Nostria, the decentralized social app.',
    url: 'https://nostria.app',
  };
}

export interface EventData {
  title: string;
  description: string;
  event?: any;
  metadata?: any;
}

@Injectable({ providedIn: 'root' })
export class DataResolver implements Resolve<EventData | null> {
  nostr = inject(NostrService);
  layout = inject(LayoutService);
  transferState = inject(TransferState);
  utilities = inject(UtilitiesService);
  metaService = inject(MetaService);
  meta = inject(Meta);
  usernameService = inject(UsernameService);

  constructor() { }

  async resolve(route: ActivatedRouteSnapshot): Promise<EventData | null> {
    if (this.layout.isBrowser()) {
      return null;
    }

    const defaultData: EventData = {
      title: 'Nostr Post on Nostria',
      description: 'Open this content on Nostria, the decentralized social app.',
    };

    const timeoutRoutePath = route.routeConfig?.path || '';
    const timeoutRouteId = route.params['id'] || route.params['pubkey'] || route.params['username'];
    const timeoutFallback = typeof timeoutRouteId === 'string' && timeoutRouteId.trim()
      ? buildFallbackSocialMetadata(timeoutRoutePath, timeoutRouteId)
      : {
        title: defaultData.title,
        description: defaultData.description,
        url: 'https://nostria.app',
      };

    // Wrap resolution in a timeout to ensure fast response for social bots
    const resolveData = async (): Promise<EventData> => {
      const resolveStart = Date.now();
      const traceId = `ssr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const data: EventData = { ...defaultData };

      let id = route.params['id'] || route.params['pubkey'];
      const identifier = route.params['identifier'];
      const slug = route.params['slug']; // For article routes like /a/:id/:slug
      const routePath = route.routeConfig?.path || '';

      // For username routes, resolve the username to pubkey
      const username = route.params['username'];
      if (!id && username) {
        id = await this.usernameService.getPubkey(username);
      }

      // For article routes with slug parameter (e.g., /a/npub.../slug or /a/nip05@domain/slug)
      if (id && slug) {

        try {
          let pubkey: string | undefined;

          // Check if id is a NIP-05 address (contains @)
          if (id.includes('@')) {
            const profile = await nip05.queryProfile(id);
            if (profile && profile.pubkey) {
              pubkey = profile.pubkey;
            }
          } else if (id.startsWith('npub')) {
            // Decode npub to hex pubkey
            try {
              const decoded = nip19.decode(id);
              if ('data' in decoded && typeof decoded.data === 'string') {
                pubkey = decoded.data;
              }
            } catch (e) {
              // Invalid npub
            }
          } else if (this.utilities.isHex(id) && id.length === 64) {
            // Already a hex pubkey
            pubkey = id;
          }

          if (pubkey) {
            const naddr = nip19.naddrEncode({
              kind: ARTICLE_KIND,
              pubkey,
              identifier: slug,
            });
            id = naddr;
          }
        } catch (e) {
          console.error('[SSR] DataResolver: Failed to create naddr for article:', e);
        }
      }

      // For addressable events (tracks, playlists), create naddr from pubkey + identifier
      if (id && identifier) {
        let kind: number | undefined;

        if (routePath.includes('music/song')) {
          kind = MUSIC_KIND;
        } else if (routePath.includes('music/playlist')) {
          kind = MUSIC_PLAYLIST_KIND;
        }

        if (kind) {
          try {
            // Decode npub to hex if needed
            let pubkey = id;
            if (id.startsWith('npub')) {
              try {
                const decoded = nip19.decode(id);
                // Use type guard to extract pubkey
                if ('data' in decoded && typeof decoded.data === 'string') {
                  pubkey = decoded.data;
                }
              } catch {
                // Invalid npub, use as-is
              }
            }

            const naddr = nip19.naddrEncode({
              kind,
              pubkey,
              identifier,
            });
            id = naddr;
          } catch (e) {
            console.error('[SSR] DataResolver: Failed to create naddr:', e);
          }
        }
      }

      // If we don't have a valid id, return early
      if (!id || id === 'undefined' || !id.trim()) {
        console.warn(`[SSR] DataResolver(${traceId}): Missing/invalid ID, returning default data`);
        this.metaService.updateSocialMetadata({
          title: defaultData.title,
          description: defaultData.description,
          image: 'https://nostria.app/assets/nostria-social.jpg',
          url: 'https://nostria.app',
        });
        return data;
      }

      const fallbackSocial = buildFallbackSocialMetadata(routePath, id);
      data.title = fallbackSocial.title;
      data.description = fallbackSocial.description;
      this.metaService.updateSocialMetadata({
        title: fallbackSocial.title,
        description: fallbackSocial.description,
        image: 'https://nostria.app/assets/nostria-social.jpg',
        url: fallbackSocial.url,
      });

      debugLog(`[SSR] DataResolver(${traceId}): Resolving route`, {
        routePath,
        id,
        identifier,
        slug,
      });

      // Parse relay hints from nevent/naddr for potential direct relay fetch
      let eventPointer: { id?: string; relays?: string[]; author?: string; kind?: number; identifier?: string } | null = null;
      if (id.startsWith('nevent') || id.startsWith('naddr')) {
        eventPointer = this.utilities.decodeEventFromUrl(id);
      }

      debugLog(`[SSR] DataResolver(${traceId}): Decoded pointers`, {
        hasEventPointer: !!eventPointer,
        eventPointerId: eventPointer?.id,
        eventPointerKind: eventPointer?.kind,
        eventPointerAuthor: eventPointer?.author,
        relayHintsCount: eventPointer?.relays?.length || 0,
      });

      // Check if this is a profile page (npub/nprofile/hex pubkey)
      // For profiles, we fetch the kind 0 metadata event directly from relays
      // because the outbox model is too slow for SSR social preview generation.
      const profileInfo = decodeProfileFromId(id);
      const isProfileRoute = routePath.startsWith('p/') || routePath.startsWith('u/') || routePath.startsWith('music/artist');
      const isHexPubkey = !profileInfo && isProfileRoute && this.utilities.isHex(id) && id.length === 64;
      const isHexEventId = !eventPointer && routePath.startsWith('e/') && this.utilities.isHex(id) && id.length === 64;
      const canFetchDirectRelayEvent =
        (!!eventPointer &&
          ((!!eventPointer.kind && eventPointer.identifier !== undefined && !!eventPointer.author) || !!eventPointer.id)) ||
        isHexEventId;
      const canFetchRelayProfile = !!profileInfo || isHexPubkey || !!eventPointer?.author;
      const isNaddrId = id.startsWith('naddr');
      const shouldParallelPrefetch = canFetchDirectRelayEvent || canFetchRelayProfile;

      const fetchStatus: {
        metadata: 'skipped';
        relayEvent: 'skipped' | 'pending' | 'success' | 'empty' | 'error';
        relayProfile: 'skipped' | 'pending' | 'success' | 'empty' | 'error';
      } = {
        metadata: 'skipped',
        relayEvent: canFetchDirectRelayEvent ? 'pending' : 'skipped',
        relayProfile: canFetchRelayProfile ? 'pending' : 'skipped',
      };

      try {
        debugLog(`[SSR] DataResolver(${traceId}): Relay-only SSR metadata mode`);

        let directEvent: Event | null = null;
        let profileEvent: Event | null = null;
        let relayProfilePicture: string | undefined;

        let directRelayFetchPromise: Promise<Event | null> | null = null;
        let profileRelayFetchPromise: Promise<Event | null> | null = null;

        const startRelayFallbackFetches = (relayTimeoutMs: number): void => {
          if (eventPointer && !directRelayFetchPromise) {
            if (eventPointer.kind && eventPointer.identifier !== undefined && eventPointer.author) {
              const directStart = Date.now();
              directRelayFetchPromise = fetchEventByAddress(
                eventPointer.kind,
                eventPointer.author,
                eventPointer.identifier,
                eventPointer.relays,
                relayTimeoutMs,
              )
                .then((result) => {
                  fetchStatus.relayEvent = result ? 'success' : 'empty';
                  debugLog(`[SSR] DataResolver(${traceId}): Direct relay event fetch completed in ${Date.now() - directStart}ms`);
                  return result;
                })
                .catch((error) => {
                  fetchStatus.relayEvent = 'error';
                  console.error(`[SSR] DataResolver(${traceId}): Direct relay event fetch failed in ${Date.now() - directStart}ms:`, error);
                  throw error;
                });
            } else if (eventPointer.id) {
              const directStart = Date.now();
              directRelayFetchPromise = fetchEventFromRelays(eventPointer.id, eventPointer.relays, relayTimeoutMs)
                .then((result) => {
                  fetchStatus.relayEvent = result ? 'success' : 'empty';
                  debugLog(`[SSR] DataResolver(${traceId}): Direct relay event fetch completed in ${Date.now() - directStart}ms`);
                  return result;
                })
                .catch((error) => {
                  fetchStatus.relayEvent = 'error';
                  console.error(`[SSR] DataResolver(${traceId}): Direct relay event fetch failed in ${Date.now() - directStart}ms:`, error);
                  throw error;
                });
            }
          } else if (isHexEventId && !directRelayFetchPromise) {
            const directStart = Date.now();
            directRelayFetchPromise = fetchEventFromRelays(id, undefined, relayTimeoutMs)
              .then((result) => {
                fetchStatus.relayEvent = result ? 'success' : 'empty';
                debugLog(`[SSR] DataResolver(${traceId}): Direct relay event fetch completed in ${Date.now() - directStart}ms`);
                return result;
              })
              .catch((error) => {
                fetchStatus.relayEvent = 'error';
                console.error(`[SSR] DataResolver(${traceId}): Direct relay event fetch failed in ${Date.now() - directStart}ms:`, error);
                throw error;
              });
          }

          if (!profileRelayFetchPromise && profileInfo) {
            const profileStart = Date.now();
            profileRelayFetchPromise = fetchProfileFromRelays(profileInfo.pubkey, profileInfo.relays, relayTimeoutMs)
              .then((result) => {
                fetchStatus.relayProfile = result ? 'success' : 'empty';
                debugLog(`[SSR] DataResolver(${traceId}): Relay profile fetch completed in ${Date.now() - profileStart}ms`);
                return result;
              })
              .catch((error) => {
                fetchStatus.relayProfile = 'error';
                console.error(`[SSR] DataResolver(${traceId}): Relay profile fetch failed in ${Date.now() - profileStart}ms:`, error);
                throw error;
              });
          } else if (!profileRelayFetchPromise && isHexPubkey) {
            const profileStart = Date.now();
            profileRelayFetchPromise = fetchProfileFromRelays(id, undefined, relayTimeoutMs)
              .then((result) => {
                fetchStatus.relayProfile = result ? 'success' : 'empty';
                debugLog(`[SSR] DataResolver(${traceId}): Relay profile fetch completed in ${Date.now() - profileStart}ms`);
                return result;
              })
              .catch((error) => {
                fetchStatus.relayProfile = 'error';
                console.error(`[SSR] DataResolver(${traceId}): Relay profile fetch failed in ${Date.now() - profileStart}ms:`, error);
                throw error;
              });
          } else if (!profileRelayFetchPromise && eventPointer?.author) {
            const profileStart = Date.now();
            profileRelayFetchPromise = fetchProfileFromRelays(eventPointer.author, eventPointer.relays, relayTimeoutMs)
              .then((result) => {
                fetchStatus.relayProfile = result ? 'success' : 'empty';
                debugLog(`[SSR] DataResolver(${traceId}): Relay profile fetch completed in ${Date.now() - profileStart}ms`);
                return result;
              })
              .catch((error) => {
                fetchStatus.relayProfile = 'error';
                console.error(`[SSR] DataResolver(${traceId}): Relay profile fetch failed in ${Date.now() - profileStart}ms:`, error);
                throw error;
              });
          }
        };

        if (shouldParallelPrefetch) {
          startRelayFallbackFetches(SSR_RELAY_FETCH_TIMEOUT_MS);
          debugLog(
            `[SSR] DataResolver(${traceId}): Started relay prefetch (route=${isNaddrId ? 'naddr' : 'standard'})`
          );
        }

        const elapsedMs = Date.now() - resolveStart;
        const remainingBudgetMs = SSR_TOTAL_RESOLVER_TIMEOUT_MS - elapsedMs - 250;
        const relayTimeoutMs = Math.max(500, Math.min(SSR_RELAY_FETCH_TIMEOUT_MS, remainingBudgetMs));

        if (remainingBudgetMs <= 0) {
          console.warn(`[SSR] DataResolver(${traceId}): No time budget left for relay fallback (elapsed=${elapsedMs}ms)`);
          fetchStatus.relayEvent = fetchStatus.relayEvent === 'pending' ? 'skipped' : fetchStatus.relayEvent;
          fetchStatus.relayProfile = fetchStatus.relayProfile === 'pending' ? 'skipped' : fetchStatus.relayProfile;
        }

        if (remainingBudgetMs > 0) {
          startRelayFallbackFetches(relayTimeoutMs);
        }

        if (directRelayFetchPromise || profileRelayFetchPromise) {
          const directPromise = directRelayFetchPromise as Promise<Event | null> | null;
          const profilePromise = profileRelayFetchPromise as Promise<Event | null> | null;
          const [relayResult, profileResult] = await Promise.all([
            directPromise ? directPromise.catch(() => null) : Promise.resolve(null),
            profilePromise ? profilePromise.catch(() => null) : Promise.resolve(null),
          ]);

          directEvent = relayResult;
          profileEvent = profileResult;
        }

        debugLog(`[SSR] DataResolver(${traceId}): Fetch status summary`, fetchStatus);

        if (profileEvent) {
          relayProfilePicture = extractProfilePictureFromEvent(profileEvent);
        }

        // --- Profile pages: merge relay-fetched profile into metadata ---
        // If the metadata API didn't return author info but we got a profile
        // from relays, use the relay-fetched profile for social preview.
        if (profileEvent) {
          try {
            const profileContent = JSON.parse(profileEvent.content);
            const relayProfile = {
              profile: {
                display_name: profileContent.display_name || profileContent.displayName,
                name: profileContent.name,
                picture: profileContent.picture || profileContent.image,
                about: profileContent.about,
                banner: profileContent.banner,
                nip05: profileContent.nip05,
                lud16: profileContent.lud16,
              },
            };

            if (!data.metadata) {
              // Use relay profile data when no profile metadata has been set yet
              const resolvedProfilePubkey = profileInfo?.pubkey || eventPointer?.author || (isHexPubkey ? id : undefined);
              console.log('[SSR] DataResolver: Using relay-fetched profile for', resolvedProfilePubkey || id);

              const displayName = relayProfile.profile.display_name || relayProfile.profile.name || 'Nostr User';
              const about = relayProfile.profile.about || '';
              const description = about.length > 200 ? about.substring(0, 200) + '...' : about || 'Nostr profile';

              // Determine canonical URL for the profile
              const targetUrl = resolvedProfilePubkey
                ? `https://nostria.app/p/${nip19.npubEncode(resolvedProfilePubkey)}`
                : undefined;

              this.metaService.updateSocialMetadata({
                title: displayName,
                description,
                image: relayProfile.profile.picture || 'https://nostria.app/assets/nostria-social.jpg',
                url: targetUrl,
              });

              data.metadata = relayProfile;
            }
          } catch (e) {
            console.error('[SSR] DataResolver: Failed to parse relay profile:', e);
          }
        }

        // Determine the best source for content
        if (directEvent) {
          // Use content from direct relay fetch
          const description = directEvent.content?.length > 200
            ? directEvent.content.substring(0, 200) + '...'
            : directEvent.content || 'Open this Nostr post on Nostria, the decentralized social app.';

          const titleTag = directEvent.tags?.find((tag: string[]) => tag[0] === 'title');
          const title = titleTag?.[1] || 'Nostr Post on Nostria';
          const authorName =
            data.metadata?.profile?.display_name ||
            data.metadata?.profile?.name ||
            undefined;

          // Try to extract an image for the social preview from the relay-fetched event.
          // Priority: image tag > imeta image > content image > YouTube thumbnail > author picture
          const authorPicture = relayProfilePicture;
          const eventImage = extractImageFromEvent(directEvent, authorPicture);

          this.metaService.updateSocialMetadata({
            title,
            description,
            image: eventImage || 'https://nostria.app/assets/nostria-social.jpg',
            publishedAtSeconds: directEvent.created_at,
            author: authorName,
          });

          data.event = {
            content: directEvent.content,
            tags: directEvent.tags,
          };
        } else if (!data.metadata) {
          data.title = 'Nostr Post on Nostria';
          data.description = 'Open this content on Nostria, the decentralized social app.';

          this.metaService.updateSocialMetadata({
            title: data.title,
            description: data.description,
            image: 'https://nostria.app/assets/nostria-social.jpg',
          });
        }
      } catch (error) {
        console.error(`[SSR] DataResolver(${traceId}): Failed to load metadata:`, error);
        data.title = 'Nostr Post on Nostria';
        data.description = 'Open this content on Nostria, the decentralized social app.';

        this.metaService.updateSocialMetadata({
          title: data.title,
          description: data.description,
          image: 'https://nostria.app/assets/nostria-social.jpg',
        });
      }

      console.log(`[SSR] DataResolver(${traceId}): Resolve finished in ${Date.now() - resolveStart}ms`);

      return data;
    };

    // Race between the actual resolution and a timeout
    // This ensures we always return something quickly for social media bots
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let timeoutTriggered = false;

    const timeoutPromise = new Promise<EventData>((resolve) => {
      timeoutHandle = setTimeout(() => {
        timeoutTriggered = true;
        console.warn(`[SSR] DataResolver: Total timeout (${SSR_TOTAL_RESOLVER_TIMEOUT_MS}ms) reached, returning default data. Route params:`, route.params);
        this.metaService.updateSocialMetadata({
          title: timeoutFallback.title,
          description: timeoutFallback.description,
          image: 'https://nostria.app/assets/nostria-social.jpg',
          url: timeoutFallback.url,
        });
        resolve(defaultData);
      }, SSR_TOTAL_RESOLVER_TIMEOUT_MS);
    });

    const result = await Promise.race([
      resolveData(),
      timeoutPromise,
    ]);

    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    if (!timeoutTriggered) {
      debugLog('[SSR] DataResolver: Completed before total timeout');
    }

    this.transferState.set(EVENT_STATE_KEY, result);
    return result;
  }
}
