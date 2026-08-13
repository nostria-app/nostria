import { AUTHORED_PODCASTS_KIND, isValidHttpUrl } from './podcast';

export type ImportEventSigner = 'identity' | 'account';

export function uniqueRelayUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const url of urls) {
    const trimmed = url.trim();
    if (!trimmed) {
      continue;
    }

    const key = trimmed.replace(/\/+$/, '');
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

export function importEventSigner(kind: number, useIdentity: boolean): ImportEventSigner {
  if (!useIdentity || kind === AUTHORED_PODCASTS_KIND) {
    return 'account';
  }

  return 'identity';
}

export function readProfileLightningAddress(profile: { data?: unknown; event?: { content?: string } } | null | undefined): string {
  if (!profile) {
    return '';
  }

  if (profile.data && typeof profile.data === 'object') {
    const fromData = (profile.data as Record<string, unknown>)['lud16'];
    if (typeof fromData === 'string' && fromData.trim()) {
      return fromData.trim();
    }
  }

  const content = profile.event?.content;
  if (!content) {
    return '';
  }

  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const fromEvent = parsed['lud16'];
    if (typeof fromEvent === 'string') {
      return fromEvent.trim();
    }
  } catch {
    return '';
  }

  return '';
}

export function publishedPodcastAudioUrls(events: { tags: string[][] }[]): Set<string> {
  const urls = new Set<string>();
  for (const event of events) {
    for (const tag of event.tags) {
      const url = tag[0] === 'audio' ? tag[1]?.trim() : '';
      if (url && isValidHttpUrl(url)) {
        urls.add(url);
      }
    }
  }
  return urls;
}

export function selectUnpublishedEpisodes<T extends { audioUrl: string; selected: boolean }>(
  episodes: T[],
  publishedUrls: Iterable<string>,
): T[] {
  const published = new Set(Array.from(publishedUrls, url => url.trim()).filter(Boolean));
  return episodes.map(episode => ({
    ...episode,
    selected: !published.has(episode.audioUrl.trim()),
  }));
}
