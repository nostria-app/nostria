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
async function fetchEventFromRelays(eventId: string, relayHints?: string[]): Promise<Event | null> {
  const pool = await createSSRPool();
  const relays = buildRelayList(relayHints);

  console.log('[SSR] DataResolver: Fetching event from', relays.length, 'relays (hints:', relayHints?.length || 0, ')');

  try {
    const event = await Promise.race([
      pool.get(relays, { ids: [eventId] }),
      new Promise<Event | null>((resolve) => setTimeout(() => resolve(null), SSR_RELAY_FETCH_TIMEOUT_MS))
    ]);

    pool.close(relays);

    return event;
  } catch (error) {
    console.error('[SSR] DataResolver: Error fetching from relays:', error);
    pool.close(relays);
    return null;
  }
}

/**
 * Fetch event directly from relays by address (kind, pubkey, identifier)
 */
async function fetchEventByAddress(kind: number, pubkey: string, identifier: string, relayHints?: string[]): Promise<Event | null> {
  const pool = await createSSRPool();
  const relays = buildRelayList(relayHints);

  console.log('[SSR] DataResolver: Fetching by address from', relays.length, 'relays (hints:', relayHints?.length || 0, ')');

  try {
    const event = await Promise.race([
      pool.get(relays, {
        kinds: [kind],
        authors: [pubkey],
        '#d': [identifier],
      }),
      new Promise<Event | null>((resolve) => setTimeout(() => resolve(null), SSR_RELAY_FETCH_TIMEOUT_MS))
    ]);

    pool.close(relays);

    return event;
  } catch (error) {
    console.error('[SSR] DataResolver: Error fetching by address:', error);
    pool.close(relays);
    return null;
  }
}

/**
 * Fetch a user profile (kind 0 metadata) directly from relays.
 * Used for profile pages (npub/nprofile) to get social preview data
 * without waiting for the outbox model discovery.
 */
async function fetchProfileFromRelays(pubkey: string, relayHints?: string[]): Promise<Event | null> {
  const pool = await createSSRPool();
  const relays = buildRelayList(relayHints);

  console.log('[SSR] DataResolver: Fetching profile from', relays.length, 'relays (hints:', relayHints?.length || 0, ')');

  try {
    const event = await Promise.race([
      pool.get(relays, {
        kinds: [0],
        authors: [pubkey],
      }),
      new Promise<Event | null>((resolve) => setTimeout(() => resolve(null), SSR_RELAY_FETCH_TIMEOUT_MS))
    ]);

    pool.close(relays);

    return event;
  } catch (error) {
    console.error('[SSR] DataResolver: Error fetching profile from relays:', error);
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
      title: 'Nostr Event',
      description: 'Loading Nostr event content...',
    };

    // Wrap resolution in a timeout to ensure fast response for social bots
    const resolveData = async (): Promise<EventData> => {
      const data: EventData = { ...defaultData };

      let id = route.params['id'] || route.params['pubkey'];
      const identifier = route.params['identifier'];
      const slug = route.params['slug']; // For article routes like /a/:id/:slug

      // For username routes, resolve the username to pubkey
      const username = route.params['username'];
      if (!id && username) {
        id = await this.usernameService.getPubkey(username);
      }

      // For article routes with slug parameter (e.g., /a/npub.../slug or /a/nip05@domain/slug)
      if (id && slug) {
        const routePath = route.routeConfig?.path || '';

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
        const routePath = route.routeConfig?.path || '';
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
        return data;
      }

      // Parse relay hints from nevent/naddr for potential direct relay fetch
      let eventPointer: { id?: string; relays?: string[]; author?: string; kind?: number; identifier?: string } | null = null;
      if (id.startsWith('nevent') || id.startsWith('naddr')) {
        eventPointer = this.utilities.decodeEventFromUrl(id);
      }

      // Check if this is a profile page (npub/nprofile/hex pubkey)
      // For profiles, we fetch the kind 0 metadata event directly from relays
      // because the outbox model is too slow for SSR social preview generation.
      const profileInfo = decodeProfileFromId(id);
      const isHexPubkey = !profileInfo && this.utilities.isHex(id) && id.length === 64;

      // If we have relay hints, fetch from relays IN PARALLEL with the metadata API
      // This ensures we get the event content quickly even if metadata API is slow
      let directRelayFetchPromise: Promise<Event | null> | null = null;
      if (eventPointer) {
        if (eventPointer.kind && eventPointer.identifier !== undefined && eventPointer.author) {
          directRelayFetchPromise = fetchEventByAddress(
            eventPointer.kind,
            eventPointer.author,
            eventPointer.identifier,
            eventPointer.relays
          );
        } else if (eventPointer.id) {
          directRelayFetchPromise = fetchEventFromRelays(eventPointer.id, eventPointer.relays);
        }
      }

      // Fetch profile directly from relays when possible.
      // This is used for:
      // - profile pages (npub/nprofile/hex)
      // - event pages when the event pointer includes author pubkey
      // so we can quickly use avatar as social image fallback if event has no image.
      let profileRelayFetchPromise: Promise<Event | null> | null = null;
      if (profileInfo) {
        profileRelayFetchPromise = fetchProfileFromRelays(profileInfo.pubkey, profileInfo.relays);
      } else if (isHexPubkey) {
        profileRelayFetchPromise = fetchProfileFromRelays(id);
      } else if (eventPointer?.author) {
        profileRelayFetchPromise = fetchProfileFromRelays(eventPointer.author, eventPointer.relays);
      }

      try {
        // Start metadata API call
        let metadataPromise;
        if (this.utilities.isHex(id)) {
          const npub = this.utilities.getNpubFromPubkey(id);
          metadataPromise = this.metaService.loadSocialMetadata(npub);
        } else {
          metadataPromise = this.metaService.loadSocialMetadata(id);
        }

        // Wait for both in parallel if we have a relay fetch running
        let metadata;
        let directEvent: Event | null = null;
        let profileEvent: Event | null = null;
        let relayProfilePicture: string | undefined;

        if (directRelayFetchPromise || profileRelayFetchPromise) {
          // Run all fetches in parallel — use whichever gives us content
          const [metadataResult, relayResult, profileResult] = await Promise.all([
            metadataPromise.catch(() => null),
            directRelayFetchPromise ? directRelayFetchPromise.catch(() => null) : Promise.resolve(null),
            profileRelayFetchPromise ? profileRelayFetchPromise.catch(() => null) : Promise.resolve(null),
          ]);

          metadata = metadataResult;
          directEvent = relayResult;
          profileEvent = profileResult;
        } else {
          metadata = await metadataPromise;
        }

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

            if (!metadata?.author?.profile?.name && !metadata?.author?.profile?.display_name) {
              // Metadata API returned no useful author info — use relay data
              console.log('[SSR] DataResolver: Using relay-fetched profile for', profileInfo?.pubkey || id);

              const displayName = relayProfile.profile.display_name || relayProfile.profile.name || 'Nostr User';
              const about = relayProfile.profile.about || '';
              const description = about.length > 200 ? about.substring(0, 200) + '...' : about || 'Nostr profile';

              // Determine canonical URL for the profile
              const pubkey = profileInfo?.pubkey || id;
              const npub = nip19.npubEncode(pubkey);
              const targetUrl = `https://nostria.app/p/${npub}`;

              this.metaService.updateSocialMetadata({
                title: displayName,
                description,
                image: relayProfile.profile.picture || 'https://nostria.app/assets/nostria-social.jpg',
                url: targetUrl,
              });

              data.metadata = relayProfile;
            } else if (metadata?.author) {
              // Metadata API had info — fill in any gaps from relay data
              if (!metadata.author.profile.picture && relayProfile.profile.picture) {
                metadata.author.profile.picture = relayProfile.profile.picture;
              }
            }
          } catch (e) {
            console.error('[SSR] DataResolver: Failed to parse relay profile:', e);
          }
        }

        if (metadata?.author?.profile && !metadata.author.profile.picture && relayProfilePicture) {
          metadata.author.profile.picture = relayProfilePicture;
        }

        // Determine the best source for content
        // Prefer metadata API if it has content, otherwise use direct relay fetch
        if (metadata && metadata.content) {
          // If metadata API already set default image and event has no media image,
          // override it with relay-fetched profile avatar when available.
          const metadataEventWithoutAuthorImage = {
            tags: metadata.tags || [],
            content: metadata.content || '',
          } as Event;
          const metadataMediaImage = extractImageFromEvent(metadataEventWithoutAuthorImage);
          if (!metadataMediaImage && relayProfilePicture) {
            this.metaService.updateSocialMetadata({ image: relayProfilePicture });
          }

          const { author, ...metadataWithoutAuthor } = metadata;
          data.event = metadataWithoutAuthor;
          // Only overwrite metadata if we don't already have relay-fetched profile
          if (!data.metadata) {
            data.metadata = metadata.author;
          }
        } else if (directEvent) {
          // Use content from direct relay fetch
          const description = directEvent.content?.length > 200
            ? directEvent.content.substring(0, 200) + '...'
            : directEvent.content || 'No description available';

          const titleTag = directEvent.tags?.find((tag: string[]) => tag[0] === 'title');
          const title = titleTag?.[1] || metadata?.author?.profile?.display_name || metadata?.author?.profile?.name || 'Nostr Event';

          // Try to extract an image for the social preview from the relay-fetched event.
          // Priority: image tag > imeta image > content image > YouTube thumbnail > author picture
          const authorPicture = relayProfilePicture || metadata?.author?.profile?.picture;
          const eventImage = extractImageFromEvent(directEvent, authorPicture);

          this.metaService.updateSocialMetadata({
            title,
            description,
            image: eventImage || 'https://nostria.app/assets/nostria-social.jpg',
            publishedAtSeconds: directEvent.created_at,
          });

          data.event = {
            content: directEvent.content,
            tags: directEvent.tags,
          };
          if (!data.metadata) {
            data.metadata = metadata?.author;
          }
        } else if (metadata) {
          // Metadata API returned but with no content, and no direct event
          const { author, ...metadataWithoutAuthor } = metadata;
          data.event = metadataWithoutAuthor;
          if (!data.metadata) {
            data.metadata = metadata.author;
          }
        } else if (!data.metadata) {
          data.title = 'Nostr Event';
          data.description = 'Content not available';
        }
      } catch (error) {
        console.error('[SSR] Failed to load metadata:', error);
        data.title = 'Nostr Event (Error)';
        data.description = 'Error loading event content';
      }

      return data;
    };

    // Race between the actual resolution and a timeout
    // This ensures we always return something quickly for social media bots
    const result = await Promise.race([
      resolveData(),
      new Promise<EventData>((resolve) => {
        setTimeout(() => {
          console.warn(`[SSR] DataResolver: Total timeout (${SSR_TOTAL_RESOLVER_TIMEOUT_MS}ms) reached, returning default data`);
          resolve(defaultData);
        }, SSR_TOTAL_RESOLVER_TIMEOUT_MS);
      })
    ]);

    this.transferState.set(EVENT_STATE_KEY, result);
    return result;
  }
}
