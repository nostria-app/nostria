import { inject, Injectable, makeStateKey, TransferState } from '@angular/core';
import { ActivatedRouteSnapshot, Resolve } from '@angular/router';
import { NostrService } from './services/nostr.service';
import { LayoutService } from './services/layout.service';
import { Meta } from '@angular/platform-browser';
import { UtilitiesService } from './services/utilities.service';
import { MetaService } from './services/meta.service';
import { UsernameService } from './services/username';
import { kinds, nip05, nip19 } from 'nostr-tools';

export const EVENT_STATE_KEY = makeStateKey<any>('large-json-data');

// Known addressable event kinds
const MUSIC_KIND = 36787;
const MUSIC_PLAYLIST_KIND = 34139;
const ARTICLE_KIND = kinds.LongFormArticle; // 30023

// Total resolver timeout - must complete within this time for social bots
const TOTAL_RESOLVER_TIMEOUT_MS = 6000;

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

    console.log('[SSR] DataResolver: Starting resolve for route:', route.routeConfig?.path);
    console.log('[SSR] DataResolver: Route params:', JSON.stringify(route.params));

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
        console.log('[SSR] DataResolver: Resolving username to pubkey:', username);
        id = await this.usernameService.getPubkey(username);
        console.log('[SSR] DataResolver: Resolved username', username, 'to pubkey:', id);
      }

      // For article routes with slug parameter (e.g., /a/npub.../slug or /a/nip05@domain/slug)
      if (id && slug) {
        const routePath = route.routeConfig?.path || '';
        console.log('[SSR] DataResolver: Article route detected with id:', id, 'slug:', slug);

        try {
          let pubkey: string | undefined;

          // Check if id is a NIP-05 address (contains @)
          if (id.includes('@')) {
            console.log('[SSR] DataResolver: Resolving NIP-05 address:', id);
            const profile = await nip05.queryProfile(id);
            if (profile && profile.pubkey) {
              pubkey = profile.pubkey;
              console.log('[SSR] DataResolver: Resolved NIP-05 to pubkey:', pubkey);
            } else {
              console.warn('[SSR] DataResolver: Failed to resolve NIP-05 address:', id);
            }
          } else if (id.startsWith('npub')) {
            // Decode npub to hex pubkey
            try {
              const decoded = nip19.decode(id);
              if ('data' in decoded && typeof decoded.data === 'string') {
                pubkey = decoded.data;
                console.log('[SSR] DataResolver: Decoded npub to pubkey:', pubkey);
              }
            } catch (e) {
              console.warn('[SSR] DataResolver: Failed to decode npub:', id, e);
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
            console.log('[SSR] DataResolver: Created naddr for article:', naddr);
          }
        } catch (e) {
          console.error('[SSR] DataResolver: Failed to create naddr for article:', e);
        }
      }

      // For addressable events (tracks, playlists), create naddr from pubkey + identifier
      if (id && identifier) {
        const routePath = route.routeConfig?.path || '';
        console.log('[SSR] DataResolver: Found identifier, routePath:', routePath);
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
            console.log('[SSR] DataResolver: Created naddr for addressable event:', naddr);
          } catch (e) {
            console.error('[SSR] DataResolver: Failed to create naddr:', e);
          }
        }
      }

      console.log('[SSR] DataResolver: Attempting to load metadata for id:', id);

      // If we don't have a valid id, return early
      if (!id || id === 'undefined' || !id.trim()) {
        console.warn('[SSR] DataResolver: No valid id found, skipping metadata load');
        return data;
      }

      try {
        if (this.utilities.isHex(id)) {
          // Convert hex pubkey to npub for metadata loading
          const npub = this.utilities.getNpubFromPubkey(id);
          console.log('[SSR] Converting hex pubkey to npub:', id, '->', npub);
          const metadata = await this.metaService.loadSocialMetadata(npub);
          const { author, ...metadataWithoutAuthor } = metadata;
          data.event = metadataWithoutAuthor;
          data.metadata = metadata.author;
        } else {
          const metadata = await this.metaService.loadSocialMetadata(id);
          const { author, ...metadataWithoutAuthor } = metadata;
          data.event = metadataWithoutAuthor;
          data.metadata = metadata.author;
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
