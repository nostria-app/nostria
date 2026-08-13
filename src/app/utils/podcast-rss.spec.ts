import { parsePodcastRssFeed, parseRssDurationToSeconds, stripRssHtml } from './podcast-rss';

const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Relay Talk</title>
    <link>https://example.com/show</link>
    <description>Weekly notes about relays</description>
    <itunes:image href="https://cdn.example.com/show.jpg" />
    <item>
      <title>Episode One</title>
      <guid>ep-1</guid>
      <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
      <itunes:subtitle>First show</itunes:subtitle>
      <itunes:episode>696</itunes:episode>
      <itunes:duration>3661</itunes:duration>
      <itunes:image href="https://cdn.example.com/ep1.jpg" />
      <content:encoded><![CDATA[<p>Show notes with a https://very-long.example.com/path/that/should-be-editable</p>]]></content:encoded>
      <enclosure url="https://cdn.example.com/ep1.mp3" type="audio/mpeg" />
    </item>
    <item>
      <title>No audio</title>
      <description>Skip me</description>
    </item>
    <item>
      <title>Episode Two</title>
      <guid>ep-2</guid>
      <description>Second episode</description>
      <enclosure url="https://cdn.example.com/ep2.mp3" type="audio/mpeg" />
    </item>
  </channel>
</rss>`;

describe('podcast RSS parser', () => {
  it('parses show metadata and audio episodes', () => {
    const feed = parsePodcastRssFeed(SAMPLE_FEED);

    expect(feed.show).toEqual({
      title: 'Relay Talk',
      description: 'Weekly notes about relays',
      imageUrl: 'https://cdn.example.com/show.jpg',
      website: 'https://example.com/show',
    });
    expect(feed.episodes).toHaveLength(2);
    expect(feed.episodes[0]).toMatchObject({
      guid: 'ep-1',
      title: 'Episode One',
      audioUrl: 'https://cdn.example.com/ep1.mp3',
      audioType: 'audio/mpeg',
      imageUrl: 'https://cdn.example.com/ep1.jpg',
      description: 'First show',
      notes: 'Show notes with a https://very-long.example.com/path/that/should-be-editable',
      episode: '696',
      duration: '1:01:01',
      durationSeconds: 3661,
      publishedAt: Math.floor(Date.parse('Mon, 01 Jan 2024 12:00:00 GMT') / 1000),
    });
    expect(feed.episodes[1].title).toBe('Episode Two');
    expect(feed.episodes[1].description).toBe('Second episode');
    expect(feed.episodes[1].episode).toBe('');
    expect(feed.episodes[1].durationSeconds).toBeNull();
  });

  it('rejects empty and invalid feeds', () => {
    expect(() => parsePodcastRssFeed('')).toThrow('Empty RSS feed');
    expect(() => parsePodcastRssFeed('<not-rss></not-rss>')).toThrow('No channel found');
    expect(() => parsePodcastRssFeed('{"error":"timeout","timeout":8000}')).toThrow('timeout');
  });

  it('strips HTML and parses durations', () => {
    expect(stripRssHtml('<p>Hello <strong>world</strong></p>')).toBe('Hello world');
    expect(parseRssDurationToSeconds('1:01:01')).toBe(3661);
    expect(parseRssDurationToSeconds('75')).toBe(75);
  });

  it('prefers channel/link over channel/image/link for the website', () => {
    const feed = parsePodcastRssFeed(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Image First</title>
    <image>
      <url>https://cdn.example.com/show.jpg</url>
      <link>https://cdn.example.com/from-image</link>
    </image>
    <link>https://example.com/show</link>
    <item>
      <title>Episode</title>
      <enclosure url="https://cdn.example.com/ep.mp3" type="audio/mpeg" />
    </item>
  </channel>
</rss>`);
    expect(feed.show.website).toBe('https://example.com/show');
  });

  it('falls back to channel/image/link when channel/link is missing', () => {
    const feed = parsePodcastRssFeed(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Image Only</title>
    <image>
      <url>https://cdn.example.com/show.jpg</url>
      <link>https://example.com/from-image</link>
    </image>
    <item>
      <title>Episode</title>
      <enclosure url="https://cdn.example.com/ep.mp3" type="audio/mpeg" />
    </item>
  </channel>
</rss>`);
    expect(feed.show.website).toBe('https://example.com/from-image');
  });
});
