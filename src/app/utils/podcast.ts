import { Event, UnsignedEvent } from 'nostr-tools';

/** NIP-F4 podcast episode. */
export const PODCAST_EPISODE_KIND = 54;

/** NIP-F4 replaceable podcast metadata for a show. */
export const PODCAST_METADATA_KIND = 10154;

/** NIP-51 favorite podcasts list. */
export const FAVORITE_PODCASTS_KIND = 10054;

/** NIP-51 authored podcasts list. */
export const AUTHORED_PODCASTS_KIND = 10064;

export const PODCAST_KINDS = [PODCAST_EPISODE_KIND, PODCAST_METADATA_KIND] as const;

export interface PodcastAudio {
  url: string;
  mediaType?: string;
}

export interface PodcastAuthor {
  pubkey: string;
  role?: string;
}

const HTTP_URL_RE = /^https?:\/\/.+/i;

function tagValue(event: Event | UnsignedEvent, name: string): string | undefined {
  const tag = event.tags.find(t => t[0] === name);
  const value = tag?.[1]?.trim();
  return value || undefined;
}

export function isPodcastEpisodeKind(kind: number): boolean {
  return kind === PODCAST_EPISODE_KIND;
}

export function isPodcastMetadataKind(kind: number): boolean {
  return kind === PODCAST_METADATA_KIND;
}

export function isPodcastKind(kind: number): boolean {
  return kind === PODCAST_EPISODE_KIND || kind === PODCAST_METADATA_KIND;
}

export function getPodcastTitle(event: Event | UnsignedEvent): string | undefined {
  return tagValue(event, 'title') || tagValue(event, 'subject');
}

export function getPodcastDescription(event: Event | UnsignedEvent): string | undefined {
  return tagValue(event, 'description') || tagValue(event, 'summary');
}

export function getPodcastImage(event: Event | UnsignedEvent): string | undefined {
  return tagValue(event, 'image') || tagValue(event, 'cover') || tagValue(event, 'thumb');
}

export function getPodcastWebsites(event: Event | UnsignedEvent): string[] {
  return event.tags
    .filter(tag => tag[0] === 'website' && !!tag[1]?.trim())
    .map(tag => tag[1].trim());
}

export function getPodcastAuthors(event: Event | UnsignedEvent): PodcastAuthor[] {
  return event.tags
    .filter(tag => tag[0] === 'p' && !!tag[1]?.trim())
    .map(tag => ({
      pubkey: tag[1].trim(),
      role: tag[2]?.trim() || undefined,
    }));
}

export function isValidHttpUrl(url: string): boolean {
  if (!HTTP_URL_RE.test(url)) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getPodcastAudio(event: Event | UnsignedEvent): PodcastAudio[] {
  const seen = new Set<string>();
  const audio: PodcastAudio[] = [];

  for (const tag of event.tags) {
    if (tag[0] !== 'audio' || !tag[1]?.trim()) {
      continue;
    }

    const url = tag[1].trim();
    if (!isValidHttpUrl(url) || seen.has(url)) {
      continue;
    }

    seen.add(url);
    audio.push({
      url,
      mediaType: tag[2]?.trim() || undefined,
    });
  }

  return audio;
}

export function getPrimaryPodcastAudioUrl(event: Event | UnsignedEvent): string | undefined {
  return getPodcastAudio(event)[0]?.url;
}

export function getPodcastEpisodeNumber(event: Event | UnsignedEvent): string | undefined {
  return tagValue(event, 'episode');
}

export function getPodcastDurationSeconds(event: Event | UnsignedEvent): number | undefined {
  const raw = tagValue(event, 'duration');
  if (!raw) {
    return undefined;
  }

  const seconds = parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

export function isValidPodcastEpisode(event: Event | UnsignedEvent): boolean {
  return event.kind === PODCAST_EPISODE_KIND
    && !!getPodcastTitle(event)
    && getPodcastAudio(event).length > 0;
}

export function isValidPodcastShow(event: Event | UnsignedEvent): boolean {
  return event.kind === PODCAST_METADATA_KIND && !!getPodcastTitle(event);
}

export function episodeMatchesQuery(event: Event | UnsignedEvent, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  const title = getPodcastTitle(event)?.toLowerCase() ?? '';
  const description = getPodcastDescription(event)?.toLowerCase() ?? '';
  const content = typeof event.content === 'string' ? event.content.toLowerCase() : '';
  const hashtags = event.tags
    .filter(tag => tag[0] === 't' && !!tag[1])
    .map(tag => tag[1].toLowerCase());

  return title.includes(normalized)
    || description.includes(normalized)
    || content.includes(normalized)
    || hashtags.some(tag => tag.includes(normalized));
}

export function showMatchesQuery(event: Event | UnsignedEvent, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  const title = getPodcastTitle(event)?.toLowerCase() ?? '';
  const description = getPodcastDescription(event)?.toLowerCase() ?? '';
  return title.includes(normalized) || description.includes(normalized);
}

export function formatPodcastDuration(totalSeconds?: number | null): string | undefined {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return undefined;
  }

  const rounded = Math.floor(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export interface PodcastShowDraft {
  title: string;
  description?: string;
  imageUrl?: string;
  website?: string;
}

export interface PodcastEpisodeDraft {
  title: string;
  audioUrl: string;
  audioType?: string;
  imageUrl?: string;
  description?: string;
  episode?: string;
  duration?: number;
}

/** NIP-F4 kind 10154 tags. */
export function buildPodcastShowTags(draft: PodcastShowDraft): string[][] {
  const title = draft.title.trim();
  const tags: string[][] = [['title', title]];
  const description = draft.description?.trim();
  if (description) {
    tags.push(['description', description]);
  }

  const imageUrl = draft.imageUrl?.trim();
  if (imageUrl && isValidHttpUrl(imageUrl)) {
    tags.push(['image', imageUrl]);
  }

  const website = draft.website?.trim();
  if (website && isValidHttpUrl(website)) {
    tags.push(['website', website]);
  }

  return tags;
}

/** NIP-F4 kind 54 tags. */
export function buildPodcastEpisodeTags(draft: PodcastEpisodeDraft): string[][] {
  const title = draft.title.trim();
  const audioUrl = draft.audioUrl.trim();
  const audioType = draft.audioType?.trim();
  const tags: string[][] = [
    ['title', title],
    audioType ? ['audio', audioUrl, audioType] : ['audio', audioUrl],
  ];

  const description = draft.description?.trim();
  if (description) {
    tags.push(['description', description]);
  }

  const imageUrl = draft.imageUrl?.trim();
  if (imageUrl && isValidHttpUrl(imageUrl)) {
    tags.push(['image', imageUrl]);
  }

  const episode = draft.episode?.trim();
  if (episode) {
    tags.push(['episode', episode]);
  }

  if (draft.duration != null && Number.isFinite(draft.duration) && draft.duration > 0) {
    tags.push(['duration', String(Math.floor(draft.duration))]);
  }

  return tags;
}
