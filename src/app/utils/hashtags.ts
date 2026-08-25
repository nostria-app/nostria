/**
 * Hard cap on `t` tags processed per event.
 *
 * Aligns with the highest numeric `MaxFeedTagsAllowed` option (20). This is
 * not the user-facing "Tags allowed" feed filter — that setting can still be
 * Any. Extra `t` tags are dropped; the note is kept.
 */
export const MAX_EVENT_HASHTAGS = 20;

export type HashtagSource = { tags: string[][] } | string[][] | null | undefined;

const ingestedHashtags = new WeakMap<object, string[]>();

function readTags(source: HashtagSource): string[][] {
  if (!source) {
    return [];
  }

  return Array.isArray(source) ? source : source.tags;
}

/**
 * Produce the capped `t` list for an event. When `source` is an event object,
 * the list is created once (ingest) and reused for parse, render, and index.
 */
export function getCappedHashtags(source: HashtagSource): string[] {
  if (!source) {
    return [];
  }

  if (!Array.isArray(source)) {
    const cached = ingestedHashtags.get(source);
    if (cached) {
      return cached;
    }

    const list = extractCappedHashtags(source.tags);
    ingestedHashtags.set(source, list);
    return list;
  }

  return extractCappedHashtags(source);
}

function extractCappedHashtags(tags: string[][] | undefined): string[] {
  if (!tags?.length) {
    return [];
  }

  const hashtags: string[] = [];
  const seen = new Set<string>();

  for (const tag of tags) {
    if (tag[0] !== 't' || !tag[1]) {
      continue;
    }

    const normalized = tag[1].toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    hashtags.push(tag[1]);

    if (hashtags.length >= MAX_EVENT_HASHTAGS) {
      break;
    }
  }

  return hashtags;
}

/** True when the event has more `t` tags than the hard cap. */
export function eventExceedsHashtagCap(source: HashtagSource): boolean {
  const tags = readTags(source);
  let count = 0;

  for (const tag of tags) {
    if (tag[0] === 't' && tag[1]) {
      count++;
      if (count > MAX_EVENT_HASHTAGS) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Hashtag-list / hashtag-search match. Over-cap notes are ignored so spam
 * cannot take over a list. Matching uses the same capped `t` list as ingest.
 */
export function eventMatchesCappedHashtag(source: HashtagSource, hashtag: string): boolean {
  if (eventExceedsHashtagCap(source)) {
    return false;
  }

  const needle = hashtag.toLowerCase();
  return getCappedHashtags(source).some(tag => tag.toLowerCase() === needle);
}

export function eventMatchesAnyCappedHashtag(
  source: HashtagSource,
  hashtags: readonly string[]
): boolean {
  if (eventExceedsHashtagCap(source) || hashtags.length === 0) {
    return false;
  }

  const wanted = new Set(hashtags.map(tag => tag.toLowerCase()));
  return getCappedHashtags(source).some(tag => wanted.has(tag.toLowerCase()));
}
