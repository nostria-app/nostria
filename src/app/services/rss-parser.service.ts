import { Injectable, inject } from '@angular/core';
import { CorsProxyService } from './cors-proxy.service';

export interface RssFeedItem {
  title: string;
  description: string;
  link: string;
  mediaUrl: string;
  type: string;
  duration: string;
  image: string;
  pubDate: string;
  episode?: number;
  season?: number;
}

export type RssMedium = 'podcast' | 'music' | 'video' | 'film' | 'audiobook' | 'newsletter' | 'blog';

export interface RssFeed {
  title: string;
  description: string;
  image: string;
  author: string;
  medium: RssMedium;
  items: RssFeedItem[];
}

@Injectable({
  providedIn: 'root'
})
export class RssParserService {
  private readonly corsProxy = inject(CorsProxyService);

  // Common namespaces used in podcast RSS feeds
  private readonly ITUNES_NS = 'http://www.itunes.com/dtds/podcast-1.0.dtd';
  private readonly PODCAST_NS = 'https://podcastindex.org/namespace/1.0';
  private readonly MEDIA_NS = 'http://search.yahoo.com/mrss/';

  /**
   * Gets elements by local name, handling both namespaced and non-namespaced elements.
   * This is more reliable than getElementsByTagName with prefixes.
   */
  private getElementByLocalName(parent: Element, localName: string): Element | null {
    // Try querySelector first for non-namespaced elements
    const direct = parent.querySelector(localName);
    if (direct) return direct;

    // For namespaced elements, search through all children
    const allElements = parent.getElementsByTagName('*');
    for (const elem of allElements) {
      if (elem.localName === localName) {
        return elem;
      }
    }
    return null;
  }

  /**
   * Gets all elements by local name, handling both namespaced and non-namespaced elements.
   */
  private getElementsByLocalName(parent: Element, localName: string): Element[] {
    const results: Element[] = [];
    const allElements = parent.getElementsByTagName('*');
    for (const elem of allElements) {
      if (elem.localName === localName && elem.parentElement === parent) {
        results.push(elem);
      }
    }
    // Also check direct children with querySelector
    const directChildren = parent.querySelectorAll(`:scope > ${localName}`);
    directChildren.forEach(child => {
      if (!results.includes(child)) {
        results.push(child);
      }
    });
    return results;
  }

  async parse(url: string): Promise<RssFeed> {
    const text = await this.corsProxy.fetchText(url);

    // Check if the response is a JSON error from the CORS proxy
    const trimmedText = text.trim();
    if (trimmedText.startsWith('{')) {
      try {
        const jsonResponse = JSON.parse(trimmedText);
        if (jsonResponse.error) {
          console.error('RSS Parser - CORS proxy error:', jsonResponse);
          throw new Error(`Failed to fetch RSS feed: ${jsonResponse.error}${jsonResponse.timeout ? ` (timeout: ${jsonResponse.timeout}ms)` : ''}`);
        }
      } catch (e) {
        // If JSON parsing fails, it might still be valid XML that starts with {
        // Continue with XML parsing
        if (e instanceof SyntaxError) {
          // Not valid JSON, continue with XML parsing
        } else {
          throw e;
        }
      }
    }

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, "text/xml");

    // Check for parser errors
    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) {
      console.error('RSS Parser - XML parse error:', parseError.textContent);
      throw new Error('Invalid XML: ' + parseError.textContent);
    }

    // Try multiple methods to find the channel element
    // Some feeds may have the channel directly under rss, others may have different structures
    let channel = xmlDoc.querySelector('channel');
    if (!channel) {
      // Try finding it under rss element
      const rss = xmlDoc.querySelector('rss');
      if (rss) {
        channel = rss.querySelector('channel');
      }
    }
    if (!channel) {
      console.error('RSS Parser - No channel element found in document:', xmlDoc);
      throw new Error('Invalid RSS feed: No channel element found');
    }

    const title = this.getElementText(channel, 'title');
    const description = this.getElementText(channel, 'description');

    // Get author from itunes:author or author element (using local name for namespace support)
    let author = '';
    const itunesAuthor = this.getElementByLocalName(channel, 'author');
    if (itunesAuthor) {
      author = itunesAuthor.textContent || '';
    }

    // Detect medium type from podcast:medium element (podcast, music, video, etc.)
    let medium: RssMedium = 'podcast'; // Default to podcast for backwards compatibility
    const podcastMedium = this.getElementByLocalName(channel, 'medium');
    if (podcastMedium) {
      const mediumValue = podcastMedium.textContent?.toLowerCase() || '';
      if (['podcast', 'music', 'video', 'film', 'audiobook', 'newsletter', 'blog'].includes(mediumValue)) {
        medium = mediumValue as RssMedium;
      }
    }

    // Try to find image - prioritize itunes:image with href attribute
    let image = '';
    // First look for itunes:image (localName 'image' with href attribute) as direct child of channel
    const channelChildren = Array.from(channel.children);
    for (const elem of channelChildren) {
      if (elem.localName === 'image' && elem.hasAttribute('href')) {
        image = elem.getAttribute('href') || '';
        console.log('RSS Parser - Found itunes:image href:', image);
        break;
      }
    }
    // Fallback to standard RSS image/url structure
    if (!image) {
      for (const elem of channelChildren) {
        if (elem.localName === 'image' && !elem.hasAttribute('href')) {
          const urlElem = elem.querySelector('url');
          if (urlElem) {
            image = urlElem.textContent || '';
            console.log('RSS Parser - Found standard image url:', image);
            break;
          }
        }
      }
    }

    const items: RssFeedItem[] = [];
    // Get items - avoid :scope which may not work in XML documents
    const itemElements = Array.from(channel.children).filter(el => el.localName === 'item');

    console.log('RSS Parser - Found items:', itemElements.length);

    itemElements.forEach((item, index) => {
      const itemTitle = this.getElementText(item, 'title');
      const itemDescription = this.getElementText(item, 'description');
      const itemLink = this.getElementText(item, 'link');
      const itemPubDate = this.getElementText(item, 'pubDate');

      // Try multiple sources for media URL in order of preference:
      // 1. enclosure element (standard RSS)
      // 2. media:content element
      // 3. link element (some feeds put media URL here)
      let mediaUrl = '';
      let type = '';

      // 1. Try enclosure first
      const enclosure = item.querySelector('enclosure');
      if (enclosure) {
        mediaUrl = enclosure.getAttribute('url') || '';
        type = enclosure.getAttribute('type') || '';
        console.log(`RSS Parser - Item ${index}: Found enclosure url="${mediaUrl}", type="${type}"`);
      }

      // 2. Fallback to media:content if no enclosure or enclosure has no url
      if (!mediaUrl) {
        const itemChildren = Array.from(item.children);
        for (const elem of itemChildren) {
          if (elem.localName === 'content' && elem.hasAttribute('url')) {
            mediaUrl = elem.getAttribute('url') || '';
            type = elem.getAttribute('type') || '';
            console.log(`RSS Parser - Item ${index}: Found media:content url="${mediaUrl}", type="${type}"`);
            break;
          }
        }
      }

      // 3. Fallback to link element if it contains a media file URL
      if (!mediaUrl && itemLink) {
        const mediaExtensions = /\.(mp3|mp4|m4a|ogg|opus|wav|aac|flac|webm|mkv|avi|mov)(\?.*)?$/i;
        if (mediaExtensions.test(itemLink)) {
          mediaUrl = itemLink;
          type = 'audio/mpeg'; // Default type
          console.log(`RSS Parser - Item ${index}: Found media URL in link="${mediaUrl}"`);
        }
      }

      console.log(`RSS Parser - Item ${index}: title="${itemTitle}", mediaUrl="${mediaUrl}", type="${type}"`);

      // Get duration from itunes:duration
      let itemDuration = '';
      const durationElem = this.getElementByLocalName(item, 'duration');
      if (durationElem) {
        itemDuration = durationElem.textContent || '';
      }

      // Get episode and season numbers from podcast namespace
      let episode: number | undefined;
      let season: number | undefined;
      const episodeElem = this.getElementByLocalName(item, 'episode');
      if (episodeElem) {
        episode = parseInt(episodeElem.textContent || '', 10) || undefined;
      }
      const seasonElem = this.getElementByLocalName(item, 'season');
      if (seasonElem) {
        season = parseInt(seasonElem.textContent || '', 10) || undefined;
      }

      // Get item image - prioritize itunes:image with href attribute
      let itemImage = '';
      const itemChildrenForImage = Array.from(item.children);
      for (const elem of itemChildrenForImage) {
        if (elem.localName === 'image' && elem.hasAttribute('href')) {
          itemImage = elem.getAttribute('href') || '';
          break;
        }
      }

      if (mediaUrl) {
        items.push({
          title: itemTitle,
          description: itemDescription,
          link: itemLink,
          mediaUrl,
          type,
          duration: itemDuration,
          image: itemImage || image, // Fallback to channel image
          pubDate: itemPubDate,
          episode,
          season
        });
        console.log(`RSS Parser - Added item: title="${itemTitle}", mediaUrl="${mediaUrl}", image="${itemImage || image}"`);
      }
    });

    console.log('RSS Parser - Parsed feed:', { title, author, medium, itemCount: items.length });

    return {
      title,
      description,
      image,
      author,
      medium,
      items
    };
  }

  private getElementText(parent: Element, tagName: string): string {
    const element = parent.querySelector(tagName);
    return element?.textContent || '';
  }
}
