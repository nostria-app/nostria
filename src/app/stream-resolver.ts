import { inject, makeStateKey, TransferState } from '@angular/core';
import { ActivatedRouteSnapshot, ResolveFn } from '@angular/router';
import { LayoutService } from './services/layout.service';
import { MetaService } from './services/meta.service';
import { UtilitiesService } from './services/utilities.service';
import { Event, nip19 } from 'nostr-tools';
import { SSR_RELAY_FETCH_TIMEOUT_MS, SSR_TOTAL_RESOLVER_TIMEOUT_MS, buildRelayList } from './ssr-relays';

export const STREAM_STATE_KEY = makeStateKey<StreamData>('stream-data');
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

export interface StreamData {
  title: string;
  description: string;
  image?: string;
  streamUrl?: string;
  event?: Event;
}

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

async function fetchEventFromRelays(eventId: string, relayHints?: string[], timeoutMs = SSR_RELAY_FETCH_TIMEOUT_MS): Promise<Event | null> {
  await configureSsrWebSocketImplementation();

  // Import SimplePool dynamically
  const { SimplePool } = await import('nostr-tools/pool');
  const pool = new SimplePool({ enablePing: true, enableReconnect: true });

  const relays = buildRelayList(relayHints);
  const startedAt = Date.now();
  let didTimeout = false;

  debugLog('[SSR] StreamResolver: Fetching from relays', { relayCount: relays.length, relayHintsCount: relayHints?.length || 0 });

  try {
    // Try to get the event with shorter timeout since we have API fallback
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
      debugLog(`[SSR] StreamResolver: Relay event fetch timed out after ${durationMs}ms (timeout ${timeoutMs}ms)`);
    } else {
      debugLog('[SSR] StreamResolver: Relay event fetch completed', {
        durationMs,
        found: !!event,
      });
    }

    return event;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.error(`[SSR] StreamResolver: Error fetching event after ${durationMs}ms:`, error);
    pool.close(relays);
    return null;
  }
}

/**
 * Fetch event from relays by address (kind, pubkey, identifier)
 */
async function fetchEventByAddress(kind: number, pubkey: string, identifier: string, relayHints?: string[], timeoutMs = SSR_RELAY_FETCH_TIMEOUT_MS): Promise<Event | null> {
  await configureSsrWebSocketImplementation();

  const { SimplePool } = await import('nostr-tools/pool');
  const pool = new SimplePool({ enablePing: true, enableReconnect: true });

  const relays = buildRelayList(relayHints);
  const startedAt = Date.now();
  let didTimeout = false;

  debugLog('[SSR] StreamResolver: Fetching stream by address from relays', {
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
      debugLog(`[SSR] StreamResolver: Relay address fetch timed out after ${durationMs}ms (timeout ${timeoutMs}ms)`);
    } else {
      debugLog('[SSR] StreamResolver: Relay address fetch completed', {
        durationMs,
        found: !!event,
      });
    }

    return event;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.error(`[SSR] StreamResolver: Error fetching event by address after ${durationMs}ms:`, error);
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

function parseNostrTimestamp(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const asNumber = Number(value);
  if (!Number.isFinite(asNumber) || asNumber <= 0) {
    return undefined;
  }

  return Math.floor(asNumber);
}

function extractPublishedAtFromTags(tags: string[][]): number | undefined {
  const publishedAtTag = tags.find((tag) => tag[0] === 'published_at');
  return parseNostrTimestamp(publishedAtTag?.[1]);
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
    const resolveStart = Date.now();
    const traceId = `ssr-stream-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const data: StreamData = { ...defaultData };

    try {
      const eventPointer = utilities.decodeEventFromUrl(encodedEvent);

      if (!eventPointer) {
        console.error('[SSR] StreamResolver: Failed to decode event');
        return data;
      }

      debugLog(`[SSR] StreamResolver(${traceId}): Decoded stream pointer`, {
        eventPointerId: eventPointer.id,
        eventPointerKind: eventPointer.kind,
        eventPointerAuthor: eventPointer.author,
        relayHintsCount: eventPointer.relays?.length || 0,
      });

      const isNaddrRoute = encodedEvent.startsWith('naddr');
      const canRelayPrefetch = !!(eventPointer.kind && eventPointer.identifier !== undefined && eventPointer.author) || !!eventPointer.id;
      let relayFetchPromise: Promise<Event | null> | null = null;
      const startRelayFetch = (timeoutMs: number): void => {
        if (relayFetchPromise) {
          return;
        }

        if (eventPointer.kind && eventPointer.identifier !== undefined && eventPointer.author) {
          relayFetchPromise = fetchEventByAddress(
            eventPointer.kind,
            eventPointer.author,
            eventPointer.identifier,
            eventPointer.relays,
            timeoutMs,
          );
          return;
        }

        if (eventPointer.id) {
          relayFetchPromise = fetchEventFromRelays(eventPointer.id, eventPointer.relays, timeoutMs);
        }
      };

      if (canRelayPrefetch) {
        startRelayFetch(SSR_RELAY_FETCH_TIMEOUT_MS);
        debugLog(
          `[SSR] StreamResolver(${traceId}): Started relay prefetch in parallel with metadata (route=${isNaddrRoute ? 'naddr' : 'standard'})`
        );
      }

      let metadataResponse: Awaited<ReturnType<MetaService['loadSocialMetadata']>> | null = null;
      const metadataStart = Date.now();

      try {
        metadataResponse = await metaService.loadSocialMetadata(encodedEvent);
        debugLog(`[SSR] StreamResolver(${traceId}): Metadata fetch completed in ${Date.now() - metadataStart}ms`, {
          contentLength: metadataResponse?.content?.length || 0,
          tagsCount: metadataResponse?.tags?.length || 0,
        });
      } catch (apiError) {
        console.error(`[SSR] StreamResolver(${traceId}): Metadata fetch failed in ${Date.now() - metadataStart}ms:`, apiError);
      }

      if (metadataResponse) {
        const tags = metadataResponse.tags || [];
        const titleTag = tags.find((tag: string[]) => tag[0] === 'title');
        const summaryTag = tags.find((tag: string[]) => tag[0] === 'summary');
        const imageTag = tags.find((tag: string[]) => tag[0] === 'image');
        const streamingTag = tags.find((tag: string[]) => tag[0] === 'streaming');

        const metadataHasUsefulData =
          !!metadataResponse.content?.trim() ||
          !!titleTag?.[1] ||
          !!summaryTag?.[1] ||
          !!streamingTag?.[1];

        if (metadataHasUsefulData) {
          const title = titleTag?.[1] || 'Live Stream';
          const description = summaryTag?.[1] || metadataResponse.content || 'Watch this live stream on Nostria';
          const image = imageTag?.[1];
          const streamUrl = streamingTag?.[1];
          const publishedAtSeconds =
            extractPublishedAtFromTags(tags) || parseNostrTimestamp(metadataResponse.created_at);

          data.title = title;
          data.description = description;
          data.image = image;
          data.streamUrl = streamUrl;

          metaService.updateSocialMetadata({
            title,
            description,
            image: image || '/assets/nostria-social.jpg',
            url: getCanonicalStreamUrl(encodedEvent),
            publishedAtSeconds,
          });

          debugLog(`[SSR] StreamResolver(${traceId}): Metadata was sufficient, skipping relay fallback`);
          console.log(`[SSR] StreamResolver(${traceId}): Resolve finished in ${Date.now() - resolveStart}ms`);
          return data;
        }
      }

      // Metadata was insufficient; fetch the event from relays with remaining budget.
      const elapsedMs = Date.now() - resolveStart;
      const remainingBudgetMs = SSR_TOTAL_RESOLVER_TIMEOUT_MS - elapsedMs - 250;
      const relayTimeoutMs = Math.max(500, Math.min(SSR_RELAY_FETCH_TIMEOUT_MS, remainingBudgetMs));

      if (remainingBudgetMs <= 0) {
        console.warn(`[SSR] StreamResolver(${traceId}): No time budget left for relay fallback (elapsed=${elapsedMs}ms)`);
        metaService.updateSocialMetadata({
          title: data.title,
          description: data.description,
          image: data.image || '/assets/nostria-social.jpg',
          url: getCanonicalStreamUrl(encodedEvent),
        });
        return data;
      }

      if (!relayFetchPromise) {
        startRelayFetch(relayTimeoutMs);
      }

      let event: Event | null;
      if (relayFetchPromise) {
        event = await relayFetchPromise;
      } else {
        console.error('[SSR] StreamResolver: Invalid event pointer format');
        return data;
      }

      // Fall back to metadata payload if relay fetch failed
      if (!event) {
        if (metadataResponse) {
          const tags = metadataResponse.tags || [];
          const titleTag = tags.find((tag: string[]) => tag[0] === 'title');
          const summaryTag = tags.find((tag: string[]) => tag[0] === 'summary');
          const imageTag = tags.find((tag: string[]) => tag[0] === 'image');
          const streamingTag = tags.find((tag: string[]) => tag[0] === 'streaming');
          const publishedAtSeconds =
            extractPublishedAtFromTags(tags) || parseNostrTimestamp(metadataResponse.created_at);

          const fallbackTitle = titleTag?.[1] || data.title;
          const fallbackDescription = summaryTag?.[1] || metadataResponse.content || data.description;
          const fallbackImage = imageTag?.[1] || data.image;

          data.title = fallbackTitle;
          data.description = fallbackDescription;
          data.image = fallbackImage;
          data.streamUrl = streamingTag?.[1] || data.streamUrl;

          metaService.updateSocialMetadata({
            title: fallbackTitle,
            description: fallbackDescription,
            image: fallbackImage || '/assets/nostria-social.jpg',
            url: getCanonicalStreamUrl(encodedEvent),
            publishedAtSeconds,
          });

          console.log(`[SSR] StreamResolver(${traceId}): Resolve finished in ${Date.now() - resolveStart}ms`);
          return data;
        }

        // If metadata API also failed, set default meta tags
        metaService.updateSocialMetadata({
          title: 'Live Stream - Nostria',
          description: 'Watch live streams on Nostria, your decentralized social network',
          image: '/assets/nostria-social.jpg',
          url: getCanonicalStreamUrl(encodedEvent),
        });

        console.log(`[SSR] StreamResolver(${traceId}): Resolve finished in ${Date.now() - resolveStart}ms`);
        return data;
      }

      // Extract stream metadata from event tags
      const resolvedEvent = event as Event;
      const titleTag = resolvedEvent.tags.find((tag: string[]) => tag[0] === 'title');
      const summaryTag = resolvedEvent.tags.find((tag: string[]) => tag[0] === 'summary');
      const imageTag = resolvedEvent.tags.find((tag: string[]) => tag[0] === 'image');
      const streamingTag = resolvedEvent.tags.find((tag: string[]) => tag[0] === 'streaming');

      const title = titleTag?.[1] || 'Live Stream';
      const description = summaryTag?.[1] || 'Watch this live stream on Nostria';
      const image = imageTag?.[1];
      const streamUrl = streamingTag?.[1];

      data.title = title;
      data.description = description;
      data.image = image;
      data.streamUrl = streamUrl;
      data.event = resolvedEvent;

      // Update meta tags for social sharing
      metaService.updateSocialMetadata({
        title,
        description,
        image: image || '/assets/nostria-social.jpg',
        url: getCanonicalStreamUrl(encodedEvent),
        publishedAtSeconds: resolvedEvent.created_at,
      });

      console.log(`[SSR] StreamResolver(${traceId}): Resolve finished in ${Date.now() - resolveStart}ms`);
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
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let timeoutTriggered = false;

  const timeoutPromise = new Promise<StreamData>((resolve) => {
    timeoutHandle = setTimeout(() => {
      timeoutTriggered = true;
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
  });

  const result = await Promise.race([
    resolveStream(),
    timeoutPromise,
  ]);

  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }

  if (!timeoutTriggered) {
    debugLog('[SSR] StreamResolver: Completed before total timeout');
  }

  transferState.set(STREAM_STATE_KEY, result);
  return result;
};
