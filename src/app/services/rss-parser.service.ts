import { Injectable } from '@angular/core';

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

  async parse(url: string): Promise<RssFeed> {
    let text: string;

    // Try direct fetch first (works for CORS-enabled feeds)
    try {
      const directResponse = await fetch(url);
      if (directResponse.ok) {
        text = await directResponse.text();
      } else {
        throw new Error('Direct fetch failed');
      }
    } catch {
      // Use allorigins CORS proxy as fallback
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
      const proxyResponse = await fetch(proxyUrl);
      if (!proxyResponse.ok) {
        throw new Error(`Failed to fetch RSS feed: ${proxyResponse.statusText}`);
      }
      text = await proxyResponse.text();
    }
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, "text/xml");

    const channel = xmlDoc.querySelector('channel');
    if (!channel) {
      throw new Error('Invalid RSS feed: No channel element found');
    }

    const title = this.getElementText(channel, 'title');
    const description = this.getElementText(channel, 'description');

    // Get author from itunes:author or author element
    let author = '';
    const itunesAuthor = channel.getElementsByTagName('itunes:author');
    if (itunesAuthor.length > 0) {
      author = itunesAuthor[0].textContent || '';
    } else {
      author = this.getElementText(channel, 'author');
    }

    // Detect medium type from podcast:medium element (podcast, music, video, etc.)
    let medium: RssMedium = 'podcast'; // Default to podcast for backwards compatibility
    const podcastMedium = channel.getElementsByTagName('podcast:medium');
    if (podcastMedium.length > 0) {
      const mediumValue = podcastMedium[0].textContent?.toLowerCase() || '';
      if (['podcast', 'music', 'video', 'film', 'audiobook', 'newsletter', 'blog'].includes(mediumValue)) {
        medium = mediumValue as RssMedium;
      }
    }

    // Try to find image in various standard locations
    let image = '';
    const itunesImages = channel.getElementsByTagName('itunes:image');
    if (itunesImages.length > 0) {
      image = itunesImages[0].getAttribute('href') || '';
    } else {
      const imageElem = channel.querySelector('image');
      if (imageElem) {
        const urlElem = imageElem.querySelector('url');
        if (urlElem) {
          image = urlElem.textContent || '';
        }
      }
    }

    const items: RssFeedItem[] = [];
    const itemElements = channel.querySelectorAll('item');

    itemElements.forEach(item => {
      const itemTitle = this.getElementText(item, 'title');
      const itemDescription = this.getElementText(item, 'description');
      const itemLink = this.getElementText(item, 'link');
      const itemPubDate = this.getElementText(item, 'pubDate');

      const enclosure = item.querySelector('enclosure');
      const mediaUrl = enclosure?.getAttribute('url') || '';
      const type = enclosure?.getAttribute('type') || '';

      console.log('RSS Parser - enclosure URL:', mediaUrl);
      console.log('RSS Parser - enclosure type:', type);

      let itemDuration = '';
      const durationElems = item.getElementsByTagName('itunes:duration');
      if (durationElems.length > 0) {
        itemDuration = durationElems[0].textContent || '';
      }

      // Get episode and season numbers from podcast namespace
      let episode: number | undefined;
      let season: number | undefined;
      const episodeElems = item.getElementsByTagName('podcast:episode');
      if (episodeElems.length > 0) {
        episode = parseInt(episodeElems[0].textContent || '', 10) || undefined;
      }
      const seasonElems = item.getElementsByTagName('podcast:season');
      if (seasonElems.length > 0) {
        season = parseInt(seasonElems[0].textContent || '', 10) || undefined;
      }

      let itemImage = '';
      const itemItunesImages = item.getElementsByTagName('itunes:image');
      if (itemItunesImages.length > 0) {
        itemImage = itemItunesImages[0].getAttribute('href') || '';
      } if (mediaUrl) {
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
      }
    });

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
