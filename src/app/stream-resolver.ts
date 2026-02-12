import { inject, makeStateKey, TransferState } from '@angular/core';
import { ActivatedRouteSnapshot, ResolveFn } from '@angular/router';
import { LayoutService } from './services/layout.service';
import { MetaService } from './services/meta.service';
import { UtilitiesService } from './services/utilities.service';
import { Event, nip19 } from 'nostr-tools';
import { SSR_RELAY_FETCH_TIMEOUT_MS, SSR_TOTAL_RESOLVER_TIMEOUT_MS, buildRelayList } from './ssr-relays';

export const STREAM_STATE_KEY = makeStateKey<StreamData>('stream-data');

export interface StreamData {
  title: string;
  description: string;
  image?: string;
  streamUrl?: string;
  event?: Event;
}

async function fetchEventFromRelays(eventId: string, relayHints?: string[]): Promise<Event | null> {
  // Force Node.js WebSocket for SSR environment
  const { WebSocket: WS } = await import('ws');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = WS;

  // Import SimplePool dynamically
  const { SimplePool } = await import('nostr-tools/pool');
  const pool = new SimplePool({ enablePing: true, enableReconnect: true });

  const relays = buildRelayList(relayHints);

  console.log('[SSR] StreamResolver: Fetching from', relays.length, 'relays...');

  try {
    // Try to get the event with shorter timeout since we have API fallback
    const event = await Promise.race([
      pool.get(relays, { ids: [eventId] }),
      new Promise<Event | null>((resolve) => setTimeout(() => resolve(null), SSR_RELAY_FETCH_TIMEOUT_MS))
    ]);

    pool.close(relays);

    return event;
  } catch (error) {
    console.error('[SSR] StreamResolver: Error fetching event:', error);
    pool.close(relays);
    return null;
  }
}

/**
 * Fetch event from relays by address (kind, pubkey, identifier)
 */
async function fetchEventByAddress(kind: number, pubkey: string, identifier: string, relayHints?: string[]): Promise<Event | null> {
   
  const { WebSocket: WS } = await import('ws');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = WS;

  const { SimplePool } = await import('nostr-tools/pool');
  const pool = new SimplePool({ enablePing: true, enableReconnect: true });

  const relays = buildRelayList(relayHints);

  console.log('[SSR] StreamResolver: Fetching by address from', relays.length, 'relays...');

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
    console.error('[SSR] StreamResolver: Error fetching event by address:', error);
    pool.close(relays);
    return null;
  }
}

/**
 * Generate canonical URL for streams by stripping relay hints from naddr/nevent
 */
function getCanonicalStreamUrl(encodedEvent: string): string {
  try {
    const decoded = nip19.decode(encodedEvent);
    if (decoded.type === 'naddr') {
      const canonicalNaddr = nip19.naddrEncode({
        kind: decoded.data.kind,
        pubkey: decoded.data.pubkey,
        identifier: decoded.data.identifier,
        // No relays - canonical form
      });
      return `https://nostria.app/stream/${canonicalNaddr}`;
    } else if (decoded.type === 'nevent') {
      const canonicalNevent = nip19.neventEncode({
        id: decoded.data.id,
        author: decoded.data.author,
        kind: decoded.data.kind,
        // No relays - canonical form
      });
      return `https://nostria.app/stream/${canonicalNevent}`;
    }
  } catch {
    // If decoding fails, use the original
  }
  return `https://nostria.app/stream/${encodedEvent}`;
}

export const streamResolver: ResolveFn<StreamData | null> = async (route: ActivatedRouteSnapshot): Promise<StreamData | null> => {
  const layout = inject(LayoutService);
  const transferState = inject(TransferState);
  const utilities = inject(UtilitiesService);
  const metaService = inject(MetaService);

  // Only run on server
  if (layout.isBrowser()) {
    return null;
  }

  const encodedEvent = route.params['encodedEvent'];

  const defaultData: StreamData = {
    title: 'Live Stream',
    description: 'Watch live streaming content on Nostria',
  };

  if (!encodedEvent) {
    transferState.set(STREAM_STATE_KEY, defaultData);
    return defaultData;
  }

  // Wrap the entire resolution in a timeout to ensure we always respond quickly for social bots
  const resolveStream = async (): Promise<StreamData> => {
    const data: StreamData = { ...defaultData };

    try {
      const eventPointer = utilities.decodeEventFromUrl(encodedEvent);

      if (!eventPointer) {
        console.error('[SSR] StreamResolver: Failed to decode event');
        return data;
      }

      // Fetch the event from relays - handle both nevent and naddr
      let event: Event | null;

      if (eventPointer.kind && eventPointer.identifier !== undefined && eventPointer.author) {
        // It's an naddr - fetch by kind, pubkey, and d-tag
        event = await fetchEventByAddress(
          eventPointer.kind,
          eventPointer.author,
          eventPointer.identifier,
          eventPointer.relays
        );
      } else if (eventPointer.id) {
        // It's a nevent - fetch by ID
        event = await fetchEventFromRelays(eventPointer.id, eventPointer.relays);
      } else {
        console.error('[SSR] StreamResolver: Invalid event pointer format');
        return data;
      }

      // Fallback to metadata API if relay fetch fails
      if (!event) {
        try {
          const metadataResponse = await metaService.loadSocialMetadata(encodedEvent);

          if (metadataResponse) {
            // Extract from metadata response
            const tags = metadataResponse.tags || [];
            const titleTag = tags.find((tag: string[]) => tag[0] === 'title');
            const summaryTag = tags.find((tag: string[]) => tag[0] === 'summary');
            const imageTag = tags.find((tag: string[]) => tag[0] === 'image');
            const streamingTag = tags.find((tag: string[]) => tag[0] === 'streaming');

            const title = titleTag?.[1] || 'Live Stream';
            const description = summaryTag?.[1] || metadataResponse.content || 'Watch this live stream on Nostria';
            const image = imageTag?.[1];
            const streamUrl = streamingTag?.[1];

            data.title = title;
            data.description = description;
            data.image = image;
            data.streamUrl = streamUrl;

            metaService.updateSocialMetadata({
              title,
              description,
              image: image || '/assets/nostria-social.jpg',
              url: getCanonicalStreamUrl(encodedEvent),
            });

            return data;
          }
        } catch (apiError) {
          console.error('[SSR] StreamResolver: Metadata API fallback failed:', apiError);
        }

        // If metadata API also failed, set default meta tags
        metaService.updateSocialMetadata({
          title: 'Live Stream - Nostria',
          description: 'Watch live streams on Nostria, your decentralized social network',
          image: '/assets/nostria-social.jpg',
          url: getCanonicalStreamUrl(encodedEvent),
        });

        return data;
      }

      // Extract stream metadata from event tags
      const titleTag = event.tags.find((tag: string[]) => tag[0] === 'title');
      const summaryTag = event.tags.find((tag: string[]) => tag[0] === 'summary');
      const imageTag = event.tags.find((tag: string[]) => tag[0] === 'image');
      const streamingTag = event.tags.find((tag: string[]) => tag[0] === 'streaming');

      const title = titleTag?.[1] || 'Live Stream';
      const description = summaryTag?.[1] || 'Watch this live stream on Nostria';
      const image = imageTag?.[1];
      const streamUrl = streamingTag?.[1];

      data.title = title;
      data.description = description;
      data.image = image;
      data.streamUrl = streamUrl;
      data.event = event;

      // Update meta tags for social sharing
      metaService.updateSocialMetadata({
        title,
        description,
        image: image || '/assets/nostria-social.jpg',
        url: getCanonicalStreamUrl(encodedEvent),
      });

      return data;
    } catch (error) {
      console.error('[SSR] StreamResolver: Error:', error);
      data.title = 'Live Stream';
      data.description = 'Error loading stream information';
      return data;
    }
  };

  // Race between the actual resolution and a timeout
  // This ensures we always return something quickly for social media bots
  const result = await Promise.race([
    resolveStream(),
    new Promise<StreamData>((resolve) => {
      setTimeout(() => {
        console.warn(`[SSR] StreamResolver: Total timeout (${SSR_TOTAL_RESOLVER_TIMEOUT_MS}ms) reached, returning default data`);
        // Set default meta tags on timeout
        metaService.updateSocialMetadata({
          title: 'Live Stream - Nostria',
          description: 'Watch live streams on Nostria, your decentralized social network',
          image: '/assets/nostria-social.jpg',
          url: getCanonicalStreamUrl(encodedEvent),
        });
        resolve(defaultData);
      }, SSR_TOTAL_RESOLVER_TIMEOUT_MS);
    })
  ]);

  transferState.set(STREAM_STATE_KEY, result);
  return result;
};
