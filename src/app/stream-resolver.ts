import { inject, makeStateKey, TransferState } from '@angular/core';
import { ActivatedRouteSnapshot, ResolveFn } from '@angular/router';
import { LayoutService } from './services/layout.service';
import { MetaService } from './services/meta.service';
import { UtilitiesService } from './services/utilities.service';
import { Event } from 'nostr-tools';

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
  const pool = new SimplePool();

  // Expand relay list - combine hints with popular relays for better discovery
  const popularRelays = [
    'wss://relay.damus.io',
    // 'wss://relay.nostr.band',
    'wss://nos.lol',
    'wss://relay.snort.social',
    'wss://relay.primal.net',
    'wss://nostr.wine',
    'wss://purplepag.es',
  ];

  const relays = relayHints && relayHints.length > 0
    ? [...new Set([...relayHints, ...popularRelays])] // Combine and dedupe
    : popularRelays;

  console.log('[SSR] StreamResolver: Fetching from', relays.length, 'relays...');

  try {
    // Try to get the event with 5 second timeout
    const event = await Promise.race([
      pool.get(relays, { ids: [eventId] }),
      new Promise<Event | null>((resolve) => setTimeout(() => resolve(null), 5000))
    ]);

    pool.close(relays);

    if (event) {
      console.log('[SSR] StreamResolver: Event found (kind:', event.kind, ')');
    } else {
      console.log('[SSR] StreamResolver: Event not found on relays');
    }

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
  const pool = new SimplePool();

  const popularRelays = [
    'wss://relay.damus.io',
    // 'wss://relay.nostr.band',
    'wss://nos.lol',
    'wss://relay.snort.social',
    'wss://relay.primal.net',
    'wss://nostr.wine',
    'wss://purplepag.es',
  ];

  const relays = relayHints && relayHints.length > 0
    ? [...new Set([...relayHints, ...popularRelays])]
    : popularRelays;

  console.log('[SSR] StreamResolver: Fetching by address from', relays.length, 'relays...');

  try {
    const event = await Promise.race([
      pool.get(relays, {
        kinds: [kind],
        authors: [pubkey],
        '#d': [identifier],
      }),
      new Promise<Event | null>((resolve) => setTimeout(() => resolve(null), 5000))
    ]);

    pool.close(relays);

    if (event) {
      console.log('[SSR] StreamResolver: Event found by address (kind:', event.kind, ')');
    } else {
      console.log('[SSR] StreamResolver: Event not found by address');
    }

    return event;
  } catch (error) {
    console.error('[SSR] StreamResolver: Error fetching event by address:', error);
    pool.close(relays);
    return null;
  }
}

export const streamResolver: ResolveFn<StreamData | null> = async (route: ActivatedRouteSnapshot): Promise<StreamData | null> => {
  const layout = inject(LayoutService);
  const transferState = inject(TransferState);
  const utilities = inject(UtilitiesService);
  const metaService = inject(MetaService);

  // Only run on server
  if (layout.isBrowser()) {
    return null;
  } const encodedEvent = route.params['encodedEvent'];

  console.log('[SSR] StreamResolver: Processing stream:', encodedEvent?.substring(0, 30) + '...');

  const data: StreamData = {
    title: 'Live Stream',
    description: 'Watch live streaming content on Nostria',
  };

  if (!encodedEvent) {
    transferState.set(STREAM_STATE_KEY, data);
    return data;
  }

  try {
    const eventPointer = utilities.decodeEventFromUrl(encodedEvent);

    if (!eventPointer) {
      console.error('[SSR] StreamResolver: Failed to decode event');
      transferState.set(STREAM_STATE_KEY, data);
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
      transferState.set(STREAM_STATE_KEY, data);
      return data;
    }

    // Fallback to metadata API if relay fetch fails
    if (!event) {
      console.log('[SSR] StreamResolver: Falling back to metadata API...');
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

          console.log('[SSR] StreamResolver: Loaded from API:', title);

          data.title = title;
          data.description = description;
          data.image = image;
          data.streamUrl = streamUrl;

          metaService.updateSocialMetadata({
            title,
            description,
            image: image || '/assets/nostria-social.jpg',
            url: `https://nostria.app/stream/${encodedEvent}`,
          });

          transferState.set(STREAM_STATE_KEY, data);
          return data;
        }
      } catch (apiError) {
        console.error('[SSR] StreamResolver: Metadata API fallback failed:', apiError);
      }

      // If metadata API also failed, set default meta tags
      console.log('[SSR] StreamResolver: Using default meta tags (event not found)');

      metaService.updateSocialMetadata({
        title: 'Live Stream - Nostria',
        description: 'Watch live streams on Nostria, your decentralized social network',
        image: '/assets/nostria-social.jpg',
        url: `https://nostria.app/stream/${encodedEvent}`,
      });

      transferState.set(STREAM_STATE_KEY, data);
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

    console.log('[SSR] StreamResolver: Loaded from relay:', title);

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
      url: `https://nostria.app/stream/${encodedEvent}`,
    });

  } catch (error) {
    console.error('[SSR] StreamResolver: Error:', error);
    data.title = 'Live Stream';
    data.description = 'Error loading stream information';
  }

  transferState.set(STREAM_STATE_KEY, data);
  return data;
};
