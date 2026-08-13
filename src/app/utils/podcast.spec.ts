import {
  buildPodcastEpisodeTags,
  buildPodcastShowTags,
  episodeMatchesQuery,
  formatPodcastDuration,
  getPodcastAudio,
  getPodcastAuthors,
  getPodcastDescription,
  getPodcastImage,
  getPodcastTitle,
  getPrimaryPodcastAudioUrl,
  isPodcastEpisodeKind,
  isPodcastKind,
  isPodcastMetadataKind,
  isValidHttpUrl,
  isValidPodcastEpisode,
  isValidPodcastShow,
  PODCAST_EPISODE_KIND,
  PODCAST_METADATA_KIND,
} from './podcast';
import type { Event } from 'nostr-tools';

function event(partial: Partial<Event> & Pick<Event, 'kind' | 'tags'>): Event {
  return {
    id: partial.id ?? 'id',
    pubkey: partial.pubkey ?? 'pubkey',
    created_at: partial.created_at ?? 1,
    kind: partial.kind,
    tags: partial.tags,
    content: partial.content ?? '',
    sig: partial.sig ?? 'sig',
  };
}

describe('podcast utils', () => {
  it('classifies NIP-F4 kinds', () => {
    expect(isPodcastEpisodeKind(54)).toBe(true);
    expect(isPodcastMetadataKind(10154)).toBe(true);
    expect(isPodcastKind(54)).toBe(true);
    expect(isPodcastKind(10154)).toBe(true);
    expect(isPodcastKind(1)).toBe(false);
  });

  it('reads episode tags and rejects missing audio', () => {
    const episode = event({
      kind: PODCAST_EPISODE_KIND,
      tags: [
        ['title', 'Episode 1'],
        ['description', 'A show about relays'],
        ['image', 'https://cdn.example.com/art.jpg'],
        ['audio', 'https://cdn.example.com/ep1.mp3', 'audio/mpeg'],
        ['audio', 'not-a-url'],
        ['audio', 'https://cdn.example.com/ep1.mp3'],
      ],
    });

    expect(getPodcastTitle(episode)).toBe('Episode 1');
    expect(getPodcastDescription(episode)).toBe('A show about relays');
    expect(getPodcastImage(episode)).toBe('https://cdn.example.com/art.jpg');
    expect(getPodcastAudio(episode)).toEqual([
      { url: 'https://cdn.example.com/ep1.mp3', mediaType: 'audio/mpeg' },
    ]);
    expect(getPrimaryPodcastAudioUrl(episode)).toBe('https://cdn.example.com/ep1.mp3');
    expect(isValidPodcastEpisode(episode)).toBe(true);
  });

  it('rejects spam-like episodes without title or playable audio', () => {
    expect(isValidPodcastEpisode(event({
      kind: PODCAST_EPISODE_KIND,
      tags: [['audio', 'https://cdn.example.com/ep.mp3']],
    }))).toBe(false);

    expect(isValidPodcastEpisode(event({
      kind: PODCAST_EPISODE_KIND,
      tags: [['title', 'Spam'], ['audio', 'ftp://bad.example/file']],
    }))).toBe(false);

    expect(isValidHttpUrl('javascript:alert(1)')).toBe(false);
  });

  it('validates show metadata and authors', () => {
    const show = event({
      kind: PODCAST_METADATA_KIND,
      tags: [
        ['title', 'Relay Talk'],
        ['p', 'host-pubkey', 'host'],
        ['p', 'cohost-pubkey'],
      ],
    });

    expect(isValidPodcastShow(show)).toBe(true);
    expect(getPodcastAuthors(show)).toEqual([
      { pubkey: 'host-pubkey', role: 'host' },
      { pubkey: 'cohost-pubkey', role: undefined },
    ]);
    expect(isValidPodcastShow(event({ kind: PODCAST_METADATA_KIND, tags: [] }))).toBe(false);
  });

  it('matches search queries across title, description, and hashtags', () => {
    const episode = event({
      kind: PODCAST_EPISODE_KIND,
      content: 'Deep dive into NIP-F4',
      tags: [
        ['title', 'Podcast Protocols'],
        ['description', 'How episodes travel'],
        ['t', 'nostr'],
        ['audio', 'https://cdn.example.com/ep.mp3'],
      ],
    });

    expect(episodeMatchesQuery(episode, 'protocols')).toBe(true);
    expect(episodeMatchesQuery(episode, 'NIP-F4')).toBe(true);
    expect(episodeMatchesQuery(episode, 'nostr')).toBe(true);
    expect(episodeMatchesQuery(episode, 'music')).toBe(false);
  });

  it('formats durations', () => {
    expect(formatPodcastDuration(75)).toBe('1:15');
    expect(formatPodcastDuration(3661)).toBe('1:01:01');
    expect(formatPodcastDuration(0)).toBeUndefined();
  });

  it('builds NIP-F4 show and episode tags', () => {
    expect(buildPodcastShowTags({
      title: 'Relay Talk',
      description: 'Weekly',
      imageUrl: 'https://cdn.example.com/show.jpg',
      website: 'https://example.com',
    })).toEqual([
      ['title', 'Relay Talk'],
      ['description', 'Weekly'],
      ['image', 'https://cdn.example.com/show.jpg'],
      ['website', 'https://example.com'],
    ]);

    expect(buildPodcastEpisodeTags({
      title: 'Episode 1',
      audioUrl: 'https://cdn.example.com/ep.mp3',
      audioType: 'audio/mpeg',
      imageUrl: 'not-a-url',
    })).toEqual([
      ['title', 'Episode 1'],
      ['audio', 'https://cdn.example.com/ep.mp3', 'audio/mpeg'],
    ]);
  });
});
