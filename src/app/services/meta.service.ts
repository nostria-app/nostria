import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface MetadataResponse {
  author: {
    profile: {
      display_name?: string;
      name?: string;
      picture: string;
    };
  };
  content: string;
  tags: any[];
}

@Injectable({
  providedIn: 'root',
})
export class MetaService {
  private meta = inject(Meta);
  private title = inject(Title);
  private readonly http = inject(HttpClient);
  #metadataUrl = environment.metadataUrl;

  /**
   * Sets the page title
   * @param title The title to set
   */
  setTitle(title: string): void {
    this.title.setTitle(title);
  }

  /**
   * Sets the page description
   * @param description The description to set
   */
  setDescription(description: string): void {
    this.meta.updateTag({ property: 'description', content: description });
  }

  /**
   * Sets the canonical URL for the page
   * @param url The canonical URL
   */
  setCanonicalUrl(url: string): void {
    let link: HTMLLinkElement | null = this.getLinkElement('canonical');

    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      document.head.appendChild(link);
    }

    link.setAttribute('href', url);
  }

  /**
   * Updates all social media tags at once with consistent information
   * @param config Object containing metadata properties
   */
  updateSocialMetadata(config: {
    title?: string;
    description?: string;
    image?: string;
    url?: string;
    type?: string;
    author?: string;
    twitterCard?: 'summary' | 'summary_large_image' | 'app' | 'player' | any;
  }): void {
    if (config.title) this.setTitle(config.title);
    if (config.description) this.setDescription(config.description);

    // Open Graph
    if (config.title) this.meta.updateTag({ property: 'og:title', content: config.title });
    if (config.description)
      this.meta.updateTag({
        property: 'og:description',
        content: config.description,
      });
    if (config.image) this.meta.updateTag({ property: 'og:image', content: config.image });

    // Twitter Card
    if (config.title) this.meta.updateTag({ name: 'twitter:title', content: config.title });
    if (config.description)
      this.meta.updateTag({
        name: 'twitter:description',
        content: config.description,
      });
    if (config.image) this.meta.updateTag({ name: 'twitter:image', content: config.image });
  }

  /**
   * Gets a link element if it exists
   * @param rel The rel attribute to look for
   * @returns The link element or null if not found
   */
  private getLinkElement(rel: string): HTMLLinkElement | null {
    return document.querySelector(`link[rel='${rel}']`);
  }

  async loadSocialMetadata(addr: string): Promise<MetadataResponse> {
    let title = '';
    let description = '';
    let imageUrl = '';
    let url = '';
    let targetUrl = '';

    if (addr.startsWith('nevent')) {
      // This API will parse out the event ID and author from the Nostr event address.
      url = `${this.#metadataUrl}e/${addr}`;
      targetUrl = `https://nostria.app/e/${addr}`;
    } else if (addr.startsWith('nprofile') || addr.startsWith('npub')) {
      // This API will parse out the profile ID from the Nostr profile address.
      url = `${this.#metadataUrl}p/${addr}`;
      targetUrl = `https://nostria.app/p/${addr}`;
    } else if (addr.startsWith('naddr')) {
      // This API will parse out the event ID from the Nostr address.
      url = `${this.#metadataUrl}a/${addr}`;
      targetUrl = `https://nostria.app/a/${addr}`;
    }

    const data = await firstValueFrom(this.http.get<MetadataResponse>(url));

    // Extract image URL from imeta tag or content
    let eventImageUrl = this.extractImageUrlFromImeta(data.tags);
    if (!eventImageUrl) {
      eventImageUrl = this.extractImageUrlFromContent(data.content);
    }

    if (eventImageUrl) {
      imageUrl = eventImageUrl; // Use extracted image if available
    } else if (data.author?.profile?.picture) {
      imageUrl = data.author.profile.picture;
    }

    title = data.author?.profile?.display_name || data.author?.profile?.name || 'Nostr Event';

    const fullDescription = data.content || 'No description available';
    description =
      fullDescription.length > 200 ? fullDescription.substring(0, 200) + '...' : fullDescription;

    this.updateSocialMetadata({
      title: title,
      description: description,
      image: imageUrl || 'https://nostria.app/icons/icon-512x512.png', // Use extracted image or fallback
      url: targetUrl,
    });

    return data;
  }

  private extractImageUrlFromImeta(tags: any[]): string | null {
    if (!tags || !Array.isArray(tags)) return null;

    for (const tag of tags) {
      if (Array.isArray(tag) && tag[0] === 'imeta') {
        // Extract URL from imeta tag content which is typically in format "url https://..."
        const imetaContent = tag[1];
        if (imetaContent && imetaContent.startsWith('url ')) {
          return imetaContent.substring(4).trim(); // Remove 'url ' prefix
        }
      }
    }
    return null;
  }

  private extractImageUrlFromContent(content: string): string | null {
    if (!content) return null;

    // Regular expression to match image URLs in content
    const urlRegex = /(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp))/i;
    const match = content.match(urlRegex);

    return match ? match[0] : null;
  }
}
