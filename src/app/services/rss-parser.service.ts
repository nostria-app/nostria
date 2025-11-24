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
}

export interface RssFeed {
  title: string;
  description: string;
  image: string;
  items: RssFeedItem[];
}

@Injectable({
  providedIn: 'root'
})
export class RssParserService {

  async parse(url: string): Promise<RssFeed> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch RSS feed: ${response.statusText}`);
    }
    const text = await response.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, "text/xml");

    const channel = xmlDoc.querySelector('channel');
    if (!channel) {
      throw new Error('Invalid RSS feed: No channel element found');
    }

    const title = this.getElementText(channel, 'title');
    const description = this.getElementText(channel, 'description');

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

      let itemDuration = '';
      const durationElems = item.getElementsByTagName('itunes:duration');
      if (durationElems.length > 0) {
        itemDuration = durationElems[0].textContent || '';
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
          pubDate: itemPubDate
        });
      }
    });

    return {
      title,
      description,
      image,
      items
    };
  }

  private getElementText(parent: Element, tagName: string): string {
    const element = parent.querySelector(tagName);
    return element?.textContent || '';
  }
}
