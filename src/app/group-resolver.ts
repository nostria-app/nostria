import { inject, makeStateKey, TransferState } from '@angular/core';
import { ActivatedRouteSnapshot, ResolveFn } from '@angular/router';
import { Event } from 'nostr-tools';

import { LayoutService } from './services/layout.service';
import { MetaService } from './services/meta.service';
import { SSR_RELAY_FETCH_TIMEOUT_MS, SSR_TOTAL_RESOLVER_TIMEOUT_MS } from './ssr-relays';
import { NIP29_KIND_METADATA } from './interfaces/nip29';

export const GROUP_STATE_KEY = makeStateKey<GroupData>('nip29-group-data');

const SSR_DEBUG_LOGS =
  typeof process !== 'undefined' &&
  typeof process.env !== 'undefined' &&
  process.env['SSR_DEBUG_LOGS'] === 'true';

function debugLog(message: string, ...args: unknown[]): void {
  if (!SSR_DEBUG_LOGS) return;
  console.log(message, ...args);
}

/** Server-rendered preview data for a NIP-29 group. */
export interface GroupData {
  title: string;
  description: string;
  image?: string;
  banner?: string;
  relay?: string;
  groupId?: string;
  /** The raw kind:39000 event, handed to the client through TransferState. */
  event?: Event;
}

const DEFAULT_IMAGE = 'https://nostria.app/assets/nostria-social.jpg';

let ssrWebSocketConfigured = false;

async function configureSsrWebSocketImplementation(): Promise<void> {
  if (ssrWebSocketConfigured) return;

  const [{ WebSocket: WS }, { useWebSocketImplementation }] = await Promise.all([
    import('ws'),
    import('nostr-tools/pool'),
  ]);

  useWebSocketImplementation(WS as unknown as typeof WebSocket);
  ssrWebSocketConfigured = true;
}

/**
 * Turn the route slug back into a relay URL. The slug is the relay host, with
 * `~` standing in for path separators (see `Nip29Service.serverSlug`).
 */
function slugToRelayUrl(slug: string): string | null {
  const host = slug.replace(/~/g, '/').trim();

  // Reject anything that is not a plausible host to avoid dialling arbitrary
  // strings from the URL bar.
  if (!host || !/^[a-zA-Z0-9.\-_]+\.[a-zA-Z]{2,}(\/[\w\-./]*)?$/.test(host)) {
    return null;
  }

  return `wss://${host}`;
}

/**
 * Fetch a group's kind:39000 metadata straight from its hosting relay.
 *
 * Only that relay is queried: NIP-29 group state is relay-scoped, so the
 * general-purpose SSR relay list would be both useless and slow here.
 */
async function fetchGroupMetadata(
  relayUrl: string,
  groupId: string,
  timeoutMs = SSR_RELAY_FETCH_TIMEOUT_MS
): Promise<Event | null> {
  await configureSsrWebSocketImplementation();

  const { SimplePool } = await import('nostr-tools/pool');
  const pool = new SimplePool({ enablePing: false, enableReconnect: false });
  const relays = [relayUrl];
  const startedAt = Date.now();
  let didTimeout = false;

  debugLog('[SSR] GroupResolver: fetching group metadata', { relayUrl, groupId, timeoutMs });

  try {
    const event = await Promise.race([
      pool.get(relays, { kinds: [NIP29_KIND_METADATA], '#d': [groupId] }),
      new Promise<Event | null>(resolve =>
        setTimeout(() => {
          didTimeout = true;
          resolve(null);
        }, timeoutMs)
      ),
    ]);

    pool.close(relays);

    debugLog('[SSR] GroupResolver: fetch finished', {
      durationMs: Date.now() - startedAt,
      didTimeout,
      found: !!event,
    });

    return event;
  } catch (error) {
    console.error('[SSR] GroupResolver: error fetching group metadata:', error);
    pool.close(relays);
    return null;
  }
}

function tagValue(event: Event, name: string): string | undefined {
  const value = event.tags.find(tag => tag[0] === name)?.[1];
  return value?.trim() || undefined;
}

/**
 * Resolver for `/g/:slug/:groupId` (and the `chats/servers` alias) that renders
 * Open Graph tags for NIP-29 groups so shared links preview properly.
 */
export const groupResolver: ResolveFn<GroupData> = async (route: ActivatedRouteSnapshot) => {
  const layout = inject(LayoutService);
  const metaService = inject(MetaService);
  const transferState = inject(TransferState);

  const slug = route.params['slug'] as string | undefined;
  const groupId = route.params['groupId'] as string | undefined;

  const canonicalUrl =
    slug && groupId ? `https://nostria.app/g/${slug}/${groupId}` : 'https://nostria.app/g';

  const fallback: GroupData = {
    title: 'Group on Nostria',
    description: 'Join this group on Nostria, the decentralized social app.',
    image: DEFAULT_IMAGE,
    relay: slug,
    groupId,
  };

  // Browser navigations use the live service; this only runs on the server.
  if (layout.isBrowser()) {
    return fallback;
  }

  const resolveStart = Date.now();

  const resolveGroup = async (): Promise<GroupData> => {
    if (!slug || !groupId) {
      metaService.updateSocialMetadata({
        title: fallback.title,
        description: fallback.description,
        image: DEFAULT_IMAGE,
        url: canonicalUrl,
        type: 'website',
      });
      return fallback;
    }

    const relayUrl = slugToRelayUrl(slug);

    if (!relayUrl) {
      metaService.updateSocialMetadata({
        title: fallback.title,
        description: fallback.description,
        image: DEFAULT_IMAGE,
        url: canonicalUrl,
        type: 'website',
      });
      return fallback;
    }

    // Leave headroom so the total-timeout race below never fires first.
    const remainingBudgetMs = SSR_TOTAL_RESOLVER_TIMEOUT_MS - (Date.now() - resolveStart) - 250;
    const relayTimeoutMs = Math.max(
      500,
      Math.min(SSR_RELAY_FETCH_TIMEOUT_MS, remainingBudgetMs)
    );

    const event = await fetchGroupMetadata(relayUrl, groupId, relayTimeoutMs);

    if (!event) {
      metaService.updateSocialMetadata({
        title: fallback.title,
        description: fallback.description,
        image: DEFAULT_IMAGE,
        url: canonicalUrl,
        type: 'website',
      });
      return fallback;
    }

    const name = tagValue(event, 'name') || groupId;
    const about = tagValue(event, 'about');
    const picture = tagValue(event, 'picture');
    const banner = tagValue(event, 'banner');
    const relayHost = slug.replace(/~/g, '/');

    const title = `${name} on Nostria`;
    const description =
      about ||
      `Join ${name}, a group hosted on ${relayHost}. Open it on Nostria, the decentralized social app.`;

    // Banners are wide and make the best large card. A group icon is square,
    // so it previews better as a small 'summary' card than upscaled into a
    // blurry banner. Favicons are too small to be usable either way.
    const usableIcon = picture && !/\.(ico|svg)(\?|$)/i.test(picture) ? picture : undefined;

    let socialImage: string;
    let socialImages: string[] | undefined;
    let twitterCard: 'summary' | 'summary_large_image';

    if (banner) {
      socialImage = banner;
      socialImages = usableIcon ? [banner, usableIcon] : [banner];
      twitterCard = 'summary_large_image';
    } else if (usableIcon) {
      socialImage = usableIcon;
      socialImages = [usableIcon];
      twitterCard = 'summary';
    } else {
      socialImage = DEFAULT_IMAGE;
      socialImages = undefined;
      twitterCard = 'summary_large_image';
    }

    metaService.updateSocialMetadata({
      title,
      description,
      image: socialImage,
      images: socialImages,
      url: canonicalUrl,
      type: 'website',
      twitterCard,
      faviconUrl: picture,
      publishedAtSeconds: event.created_at,
    });

    debugLog('[SSR] GroupResolver: resolved', { title, twitterCard, hasBanner: !!banner });

    return {
      title,
      description,
      image: picture,
      banner,
      relay: relayUrl,
      groupId,
      event,
    };
  };

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<GroupData>(resolve => {
    timeoutHandle = setTimeout(() => {
      console.warn(
        `[SSR] GroupResolver: total timeout (${SSR_TOTAL_RESOLVER_TIMEOUT_MS}ms) reached`
      );
      metaService.updateSocialMetadata({
        title: fallback.title,
        description: fallback.description,
        image: DEFAULT_IMAGE,
        url: canonicalUrl,
        type: 'website',
      });
      resolve(fallback);
    }, SSR_TOTAL_RESOLVER_TIMEOUT_MS);
  });

  const result = await Promise.race([resolveGroup(), timeoutPromise]);

  if (timeoutHandle) clearTimeout(timeoutHandle);

  transferState.set(GROUP_STATE_KEY, result);
  return result;
};
