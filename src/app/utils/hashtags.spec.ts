import { describe, expect, it } from 'vitest';
import {
  eventExceedsHashtagCap,
  eventMatchesAnyCappedHashtag,
  eventMatchesCappedHashtag,
  getCappedHashtags,
  MAX_EVENT_HASHTAGS,
} from './hashtags';

function eventWithTags(tags: string[][]) {
  return {
    id: 'event-id',
    tags,
  };
}

describe('hashtag cap', () => {
  it('caps t-tags at ingest and reuses the same list', () => {
    const tags = Array.from({ length: 500 }, (_, index) => ['t', `tag${index}`]);
    const event = eventWithTags(tags);

    const ingested = getCappedHashtags(event);
    const parsed = getCappedHashtags(event);
    const rendered = getCappedHashtags(event);
    const indexed = getCappedHashtags(event);

    expect(ingested).toHaveLength(MAX_EVENT_HASHTAGS);
    expect(ingested[0]).toBe('tag0');
    expect(ingested[MAX_EVENT_HASHTAGS - 1]).toBe(`tag${MAX_EVENT_HASHTAGS - 1}`);
    expect(parsed).toBe(ingested);
    expect(rendered).toBe(ingested);
    expect(indexed).toBe(ingested);
  });

  it('keeps the note by dropping extra t-tags only', () => {
    const event = eventWithTags([
      ['e', 'root-id'],
      ['t', 'nostr'],
      ['p', 'ab'.repeat(32)],
      ...Array.from({ length: 80 }, (_, index) => ['t', `spam${index}`]),
      ['client', 'nostria'],
    ]);

    expect(getCappedHashtags(event)).toEqual([
      'nostr',
      ...Array.from({ length: MAX_EVENT_HASHTAGS - 1 }, (_, index) => `spam${index}`),
    ]);
    expect(event.tags).toHaveLength(84);
    expect(event.tags.some(tag => tag[0] === 'e' && tag[1] === 'root-id')).toBe(true);
  });

  it('does not allocate or return unbounded t-tag lists from huge input', () => {
    const tags = Array.from({ length: 20_000 }, (_, index) => ['t', `flood${index}`]);

    expect(getCappedHashtags(tags)).toHaveLength(MAX_EVENT_HASHTAGS);
    expect(eventExceedsHashtagCap(tags)).toBe(true);
  });

  it('deduplicates case-insensitively before applying the cap', () => {
    const event = eventWithTags([
      ['t', 'Nostr'],
      ['t', 'nostr'],
      ['t', 'bitcoin'],
    ]);

    expect(getCappedHashtags(event)).toEqual(['Nostr', 'bitcoin']);
    expect(eventExceedsHashtagCap(event)).toBe(false);
  });

  it('ignores over-cap notes from hashtag list matching', () => {
    const event = eventWithTags(
      Array.from({ length: MAX_EVENT_HASHTAGS + 1 }, (_, index) => ['t', `tag${index}`])
    );

    expect(eventMatchesCappedHashtag(event, 'tag0')).toBe(false);
    expect(eventMatchesAnyCappedHashtag(event, ['tag0', 'tag1'])).toBe(false);
  });

  it('skips null and non-array tag entries without throwing', () => {
    const tags = [
      null,
      undefined,
      't',
      ['t'],
      ['t', 'nostr'],
      ['e', 'root-id'],
    ] as unknown as string[][];

    expect(getCappedHashtags(tags)).toEqual(['nostr']);
    expect(eventExceedsHashtagCap(tags)).toBe(false);
    expect(getCappedHashtags({ tags: undefined as unknown as string[][] })).toEqual([]);
  });

  it('matches hashtags only from the capped list on in-cap notes', () => {
    const event = eventWithTags([
      ['t', 'bitcoin'],
      ['t', 'nostr'],
    ]);

    expect(eventMatchesCappedHashtag(event, 'Bitcoin')).toBe(true);
    expect(eventMatchesCappedHashtag(event, 'missing')).toBe(false);
    expect(eventMatchesAnyCappedHashtag(event, ['nostr'])).toBe(true);
  });
});
