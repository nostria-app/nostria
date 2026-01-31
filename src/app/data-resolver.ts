import { inject, Injectable, makeStateKey, TransferState } from '@angular/core';
import { ActivatedRouteSnapshot, Resolve } from '@angular/router';
import { NostrService } from './services/nostr.service';
import { LayoutService } from './services/layout.service';
import { Meta } from '@angular/platform-browser';
import { UtilitiesService } from './services/utilities.service';
import { MetaService } from './services/meta.service';
import { UsernameService } from './services/username';
import { Event, kinds, nip05, nip19 } from 'nostr-tools';

export const EVENT_STATE_KEY = makeStateKey<any>('large-json-data');

// Known addressable event kinds
const MUSIC_KIND = 36787;
const MUSIC_PLAYLIST_KIND = 34139;
const ARTICLE_KIND = kinds.LongFormArticle; // 30023

// Total resolver timeout - must complete within this time for social bots
const TOTAL_RESOLVER_TIMEOUT_MS = 6000;
// Timeout for direct relay fetches
const RELAY_FETCH_TIMEOUT_MS = 3000;

// Popular relays to use as fallback
const POPULAR_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://relay.primal.net',
  'wss://nostr.wine',
  'wss://purplepag.es',
];

/**
 * Fetch event directly from relays by ID
 */
async function fetchEventFromRelays(eventId: string, relayHints?: string[]): Promise<Event | null> {
  // Force Node.js WebSocket for SSR environment
  const { WebSocket: WS } = await import('ws');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = WS;

  const { SimplePool } = await import('nostr-tools/pool');
  const pool = new SimplePool();

  // Combine relay hints with popular relays for better discovery
  const relays = relayHints && relayHints.length > 0
    ? [...new Set([...relayHints, ...POPULAR_RELAYS])]
    : POPULAR_RELAYS;

  console.log('[SSR] DataResolver: Fetching from', relays.length, 'relays (hints:', relayHints?.length || 0, ')');

  try {
    const event = await Promise.race([
      pool.get(relays, { ids: [eventId] }),
      new Promise<Event | null>((resolve) => setTimeout(() => resolve(null), RELAY_FETCH_TIMEOUT_MS))
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
  const { WebSocket: WS } = await import('ws');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = WS;

  const { SimplePool } = await import('nostr-tools/pool');
  const pool = new SimplePool();

  const relays = relayHints && relayHints.length > 0
    ? [...new Set([...relayHints, ...POPULAR_RELAYS])]
    : POPULAR_RELAYS;

  console.log('[SSR] DataResolver: Fetching by address from', relays.length, 'relays (hints:', relayHints?.length || 0, ')');

  try {
    const event = await Promise.race([
      pool.get(relays, {
        kinds: [kind],
        authors: [pubkey],
        '#d': [identifier],
      }),
      new Promise<Event | null>((resolve) => setTimeout(() => resolve(null), RELAY_FETCH_TIMEOUT_MS))
    ]);

    pool.close(relays);

    return event;
  } catch (error) {
    console.error('[SSR] DataResolver: Error fetching by address:', error);
    pool.close(relays);
    return null;
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

        if (directRelayFetchPromise) {
          // Race: wait for both but use whichever gives us content first
          const [metadataResult, relayResult] = await Promise.all([
            metadataPromise.catch(() => null),
            directRelayFetchPromise.catch(() => null)
          ]);

          metadata = metadataResult;
          directEvent = relayResult;
        } else {
          metadata = await metadataPromise;
        }

        // Determine the best source for content
        // Prefer metadata API if it has content, otherwise use direct relay fetch
        if (metadata && metadata.content) {
          const { author, ...metadataWithoutAuthor } = metadata;
          data.event = metadataWithoutAuthor;
          data.metadata = metadata.author;
        } else if (directEvent) {
          // Use content from direct relay fetch
          const description = directEvent.content?.length > 200
            ? directEvent.content.substring(0, 200) + '...'
            : directEvent.content || 'No description available';

          const titleTag = directEvent.tags?.find((tag: string[]) => tag[0] === 'title');
          const title = titleTag?.[1] || metadata?.author?.profile?.display_name || metadata?.author?.profile?.name || 'Nostr Event';

          this.metaService.updateSocialMetadata({
            title,
            description,
          });

          data.event = {
            content: directEvent.content,
            tags: directEvent.tags,
          };
          data.metadata = metadata?.author;
        } else if (metadata) {
          // Metadata API returned but with no content, and no direct event
          const { author, ...metadataWithoutAuthor } = metadata;
          data.event = metadataWithoutAuthor;
          data.metadata = metadata.author;
        } else {
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
          console.warn(`[SSR] DataResolver: Total timeout (${TOTAL_RESOLVER_TIMEOUT_MS}ms) reached, returning default data`);
          resolve(defaultData);
        }, TOTAL_RESOLVER_TIMEOUT_MS);
      })
    ]);

    this.transferState.set(EVENT_STATE_KEY, result);
    return result;
  }
}
