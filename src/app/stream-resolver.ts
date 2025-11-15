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
  console.log('[SSR] StreamResolver: fetchEventFromRelays called');
  console.log('[SSR] StreamResolver:   Event ID:', eventId);
  console.log('[SSR] StreamResolver:   Relay hints:', relayHints);

  // Force Node.js WebSocket for SSR environment
  // The browser WebSocket doesn't work properly in Node.js
  console.log('[SSR] StreamResolver: Loading Node.js WebSocket (ws package)...');
  const { WebSocket: WS } = await import('ws');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = WS;
  console.log('[SSR] StreamResolver: Node.js WebSocket loaded');

  // Import SimplePool dynamically
  const { SimplePool } = await import('nostr-tools/pool');
  const pool = new SimplePool();

  // Use relay hints if provided, otherwise use common relays
  const relays = relayHints && relayHints.length > 0
    ? relayHints
    : [
      'wss://relay.damus.io',
      'wss://relay.nostr.band',
      'wss://nos.lol',
      'wss://relay.snort.social',
    ];

  console.log('[SSR] StreamResolver: Using relays:', relays);
  console.log('[SSR] StreamResolver: Calling pool.get() with filter:', { ids: [eventId] });

  try {
    const startTime = Date.now();

    // Try to get the event with a longer timeout
    const event = await Promise.race([
      pool.get(relays, { ids: [eventId] }),
      new Promise<Event | null>((resolve) => setTimeout(() => {
        console.log('[SSR] StreamResolver: Timeout reached after 10 seconds');
        resolve(null);
      }, 10000))
    ]);

    const elapsed = Date.now() - startTime;
    console.log('[SSR] StreamResolver: pool.get() completed in', elapsed, 'ms');

    if (event) {
      console.log('[SSR] StreamResolver: Event received successfully');
      console.log('[SSR] StreamResolver: Event kind:', event.kind);
      console.log('[SSR] StreamResolver: Event content length:', event.content?.length || 0);
      console.log('[SSR] StreamResolver: Event tags count:', event.tags?.length || 0);
    } else {
      console.log('[SSR] StreamResolver: pool.get() returned null/undefined');
      console.log('[SSR] StreamResolver: Possible reasons:');
      console.log('[SSR] StreamResolver:   1. Event not found on any relay');
      console.log('[SSR] StreamResolver:   2. Relays not responding');
      console.log('[SSR] StreamResolver:   3. Event has been deleted');
    }

    pool.close(relays);
    console.log('[SSR] StreamResolver: Pool closed');

    return event;
  } catch (error) {
    console.error('[SSR] StreamResolver: Error fetching event:', error);
    console.error('[SSR] StreamResolver: Error type:', error instanceof Error ? error.constructor.name : typeof error);
    console.error('[SSR] StreamResolver: Error message:', error instanceof Error ? error.message : String(error));
    pool.close(relays);
    return null;
  }
}

export const streamResolver: ResolveFn<StreamData | null> = async (route: ActivatedRouteSnapshot): Promise<StreamData | null> => {
  console.log('[SSR] StreamResolver: Function resolver called');

  const layout = inject(LayoutService);
  const transferState = inject(TransferState);
  const utilities = inject(UtilitiesService);
  const metaService = inject(MetaService);

  console.log('[SSR] StreamResolver: Starting resolve...');
  console.log('[SSR] StreamResolver: Full route:', route);
  console.log('[SSR] StreamResolver: Route URL:', route.url);
  console.log('[SSR] StreamResolver: Route params:', route.params);
  console.log('[SSR] StreamResolver: Route paramMap keys:', route.paramMap.keys);
  console.log('[SSR] StreamResolver: isBrowser?', layout.isBrowser());

  // Only run on server
  if (layout.isBrowser()) {
    console.log('[SSR] StreamResolver: Running in browser, skipping SSR');
    return null;
  }

  const encodedEvent = route.params['encodedEvent'];

  console.log('[SSR] StreamResolver: Processing stream route');
  console.log('[SSR] StreamResolver: Encoded event (first 50 chars):', encodedEvent?.substring(0, 50));
  console.log('[SSR] StreamResolver: Full route params:', route.params);

  const data: StreamData = {
    title: 'Live Stream',
    description: 'Watch live streaming content on Nostria',
  };

  if (!encodedEvent) {
    console.warn('[SSR] StreamResolver: No encoded event found in route params');
    transferState.set(STREAM_STATE_KEY, data);
    return data;
  }

  try {
    console.log('[SSR] StreamResolver: Decoding nevent...');
    // Decode the nevent to get event ID and relay hints
    const eventPointer = utilities.decodeEventFromUrl(encodedEvent);

    if (!eventPointer) {
      console.error('[SSR] StreamResolver: Failed to decode nevent - utilities.decodeEventFromUrl returned null');
      transferState.set(STREAM_STATE_KEY, data);
      return data;
    }

    console.log('[SSR] StreamResolver: Successfully decoded nevent');
    console.log('[SSR] StreamResolver: Event ID:', eventPointer.id);
    console.log('[SSR] StreamResolver: Relay hints:', eventPointer.relays);
    console.log('[SSR] StreamResolver: Author:', eventPointer.author);

    // Fetch the event from relays using SimplePool
    console.log('[SSR] StreamResolver: Fetching event from relays...');
    const event = await fetchEventFromRelays(eventPointer.id, eventPointer.relays);

    // Fallback to metadata API if relay fetch fails
    if (!event) {
      console.warn('[SSR] StreamResolver: Relay fetch failed, trying metadata API fallback...');
      try {
        const metadataResponse = await metaService.loadSocialMetadata(encodedEvent);

        if (metadataResponse) {
          console.log('[SSR] StreamResolver: Metadata API returned data successfully');

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

          console.log('[SSR] StreamResolver: Extracted metadata from API:');
          console.log('[SSR] StreamResolver:   Title:', title);
          console.log('[SSR] StreamResolver:   Description:', description);
          console.log('[SSR] StreamResolver:   Image:', image || '(none)');

          data.title = title;
          data.description = description;
          data.image = image;
          data.streamUrl = streamUrl;

          console.log('[SSR] StreamResolver: Updating social metadata...');
          metaService.updateSocialMetadata({
            title,
            description,
            image: image || '/icons/icon-512x512.png',
            url: `https://nostria.space/stream/${encodedEvent}`,
          });
          console.log('[SSR] StreamResolver: Meta tags updated successfully');

          transferState.set(STREAM_STATE_KEY, data);
          return data;
        } else {
          console.warn('[SSR] StreamResolver: Metadata API did not return data');
        }
      } catch (apiError) {
        console.error('[SSR] StreamResolver: Metadata API fallback failed:', apiError);
      }

      // If metadata API also failed, return default data
      console.error('[SSR] StreamResolver: Failed to fetch event from both relays and metadata API');
      transferState.set(STREAM_STATE_KEY, data);
      return data;
    }

    console.log('[SSR] StreamResolver: Event fetched successfully');
    console.log('[SSR] StreamResolver: Event kind:', event.kind);
    console.log('[SSR] StreamResolver: Event created_at:', event.created_at);
    console.log('[SSR] StreamResolver: Event tags count:', event.tags?.length);

    // Extract stream metadata from event tags
    const titleTag = event.tags.find((tag: string[]) => tag[0] === 'title');
    const summaryTag = event.tags.find((tag: string[]) => tag[0] === 'summary');
    const imageTag = event.tags.find((tag: string[]) => tag[0] === 'image');
    const streamingTag = event.tags.find((tag: string[]) => tag[0] === 'streaming');

    const title = titleTag?.[1] || 'Live Stream';
    const description = summaryTag?.[1] || 'Watch this live stream on Nostria';
    const image = imageTag?.[1];
    const streamUrl = streamingTag?.[1];

    console.log('[SSR] StreamResolver: Extracted metadata:');
    console.log('[SSR] StreamResolver:   Title:', title);
    console.log('[SSR] StreamResolver:   Description:', description);
    console.log('[SSR] StreamResolver:   Image:', image || '(none)');
    console.log('[SSR] StreamResolver:   Stream URL:', streamUrl || '(none)');

    data.title = title;
    data.description = description;
    data.image = image;
    data.streamUrl = streamUrl;
    data.event = event;

    console.log('[SSR] StreamResolver: Updating social metadata...');

    // Update meta tags for social sharing
    metaService.updateSocialMetadata({
      title,
      description,
      image: image || '/icons/icon-512x512.png',
      url: `https://nostria.space/stream/${encodedEvent}`,
    });

    console.log('[SSR] StreamResolver: Meta tags updated successfully');

  } catch (error) {
    console.error('[SSR] StreamResolver: Error loading stream data:', error);
    console.error('[SSR] StreamResolver: Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    data.title = 'Live Stream';
    data.description = 'Error loading stream information';
  }

  console.log('[SSR] StreamResolver: Saving to TransferState...');
  transferState.set(STREAM_STATE_KEY, data);
  console.log('[SSR] StreamResolver: Resolve complete, returning data');
  return data;
};
