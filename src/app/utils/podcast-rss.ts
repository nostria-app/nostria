const ITUNES_NS = 'http://www.itunes.com/dtds/podcast-1.0.dtd';
const CONTENT_NS = 'http://purl.org/rss/1.0/modules/content/';

export interface ParsedPodcastShow {
  title: string;
  description: string;
  imageUrl: string;
  website: string;
}

export interface ParsedPodcastEpisode {
  guid: string;
  title: string;
  audioUrl: string;
  audioType: string;
  imageUrl: string;
  description: string;
  notes: string;
  publishedAt: number | null;
  duration: string;
}

export interface ParsedPodcastFeed {
  show: ParsedPodcastShow;
  episodes: ParsedPodcastEpisode[];
}

export function parsePodcastRssFeed(xml: string): ParsedPodcastFeed {
  const trimmed = xml.trim();
  if (!trimmed) {
    throw new Error('Empty RSS feed');
  }

  if (trimmed.startsWith('{')) {
    try {
      const jsonResponse = JSON.parse(trimmed) as { error?: string; timeout?: number };
      if (jsonResponse.error) {
        throw new Error(
          `Failed to fetch RSS feed: ${jsonResponse.error}${jsonResponse.timeout ? ` (timeout: ${jsonResponse.timeout}ms)` : ''}`
        );
      }
    } catch (err) {
      if (!(err instanceof SyntaxError)) {
        throw err;
      }
    }
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Invalid RSS feed format');
  }

  const channel = doc.querySelector('channel');
  if (!channel) {
    throw new Error('No channel found in RSS feed');
  }

  const showTitle = textContent(channel, 'title');
  const showDescription = stripRssHtml(
    itunesText(channel, 'summary') || textContent(channel, 'description')
  );
  const showImage = channel.querySelector('image > url')?.textContent?.trim()
    || itunesImageHref(channel)
    || '';
  const website = parseChannelWebsite(channel);

  const episodes: ParsedPodcastEpisode[] = [];
  const items = channel.querySelectorAll('item');
  items.forEach((item, index) => {
    const enclosure = item.querySelector('enclosure');
    const audioUrl = enclosure?.getAttribute('url')?.trim() || '';
    if (!audioUrl) {
      return;
    }

    const rawDescription = contentEncoded(item)
      || itunesText(item, 'summary')
      || textContent(item, 'description');
    const notes = stripRssHtml(rawDescription);
    const subtitle = stripRssHtml(itunesText(item, 'subtitle'));
    const description = subtitle || truncateText(notes, 280);
    const pubDate = textContent(item, 'pubDate');
    const guid = textContent(item, 'guid') || audioUrl;
    const duration = formatRssDuration(itunesText(item, 'duration'));

    episodes.push({
      guid,
      title: textContent(item, 'title') || `Episode ${index + 1}`,
      audioUrl,
      audioType: enclosure?.getAttribute('type')?.trim() || '',
      imageUrl: itunesImageHref(item),
      description,
      notes,
      publishedAt: parseRssDate(pubDate),
      duration,
    });
  });

  return {
    show: {
      title: showTitle,
      description: showDescription,
      imageUrl: showImage,
      website,
    },
    episodes,
  };
}

export function stripRssHtml(html: string): string {
  if (!html) {
    return '';
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  return (doc.body.textContent || '').replace(/\s+\n/g, '\n').trim();
}

/** channel/link wins; fall back to channel/image/link. */
export function parseChannelWebsite(channel: Element): string {
  for (const child of Array.from(channel.children)) {
    const localName = child.localName || child.nodeName;
    if (localName === 'link') {
      const value = child.textContent?.trim();
      if (value) {
        return value;
      }
    }
  }

  return channel.querySelector('image > link')?.textContent?.trim() || '';
}

export function parseRssDurationToSeconds(duration: string): number | null {
  const value = duration.trim();
  if (!value) {
    return null;
  }

  if (value.includes(':')) {
    const parts = value.split(':').map(part => parseInt(part, 10));
    if (parts.some(part => Number.isNaN(part))) {
      return null;
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return null;
  }

  const seconds = parseInt(value, 10);
  return Number.isNaN(seconds) ? null : seconds;
}

function formatRssDuration(duration: string): string {
  if (!duration) {
    return '';
  }
  if (duration.includes(':')) {
    return duration;
  }

  const seconds = parseRssDurationToSeconds(duration);
  if (seconds == null || seconds <= 0) {
    return duration;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remaining.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${remaining.toString().padStart(2, '0')}`;
}

function parseRssDate(value: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.floor(parsed / 1000);
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength).trimEnd()}…`;
}

function textContent(parent: Element, tagName: string): string {
  return parent.querySelector(tagName)?.textContent?.trim() || '';
}

function itunesImageHref(parent: Element): string {
  const nsElements = parent.getElementsByTagNameNS(ITUNES_NS, 'image');
  if (nsElements.length > 0) {
    return nsElements[0].getAttribute('href')?.trim() || '';
  }

  for (const child of Array.from(parent.children)) {
    const localName = child.localName || child.nodeName;
    if (localName === 'image' && (child.namespaceURI === ITUNES_NS || child.nodeName.includes('itunes'))) {
      return child.getAttribute('href')?.trim() || '';
    }
    if (child.nodeName === 'itunes:image') {
      return child.getAttribute('href')?.trim() || '';
    }
  }

  return '';
}

function itunesText(parent: Element, tagName: string): string {
  const nsElements = parent.getElementsByTagNameNS(ITUNES_NS, tagName);
  if (nsElements.length > 0) {
    return nsElements[0].textContent?.trim() || '';
  }

  for (const child of Array.from(parent.children)) {
    if (child.nodeName === `itunes:${tagName}`) {
      return child.textContent?.trim() || '';
    }
  }

  return '';
}

function contentEncoded(parent: Element): string {
  const nsElements = parent.getElementsByTagNameNS(CONTENT_NS, 'encoded');
  if (nsElements.length > 0) {
    return nsElements[0].textContent || '';
  }

  for (const child of Array.from(parent.children)) {
    if (child.nodeName === 'content:encoded') {
      return child.textContent || '';
    }
  }

  return '';
}
