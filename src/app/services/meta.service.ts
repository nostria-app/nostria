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
    // Skip if not in browser environment (SSR)
    if (typeof document === 'undefined') {
      return;
    }

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
    if (typeof document === 'undefined') {
      return null;
    }
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

    // Extract image URL - check various tag formats
    let eventImageUrl = this.extractImageUrlFromImageTag(data.tags); // Check 'image' tag first (music tracks, etc.)
    if (!eventImageUrl) {
      eventImageUrl = this.extractImageUrlFromImeta(data.tags);
    }
    if (!eventImageUrl) {
      eventImageUrl = this.extractImageUrlFromContent(data.content);
    }

    // If no regular image found, try to extract YouTube thumbnail
    if (!eventImageUrl) {
      eventImageUrl = this.extractYouTubeThumbnailFromContent(data.content);
    }

    if (eventImageUrl) {
      imageUrl = eventImageUrl; // Use extracted image if available
    } else if (data.author?.profile?.picture) {
      imageUrl = data.author.profile.picture;
    }

    // Extract title from 'title' tag if present (for addressable events like music tracks)
    const eventTitle = this.extractTagValue(data.tags, 'title');
    if (eventTitle) {
      title = eventTitle;
    } else {
      title = data.author?.profile?.display_name || data.author?.profile?.name || 'Nostr Event';
    }

    // Extract summary/description - prefer 'summary' tag (NIP-23 articles) over content
    const eventSummary = this.extractTagValue(data.tags, 'summary');
    const fullDescription = eventSummary || data.content || 'No description available';
    description =
      fullDescription.length > 200 ? fullDescription.substring(0, 200) + '...' : fullDescription;

    this.updateSocialMetadata({
      title: title,
      description: description,
      image: imageUrl || 'https://nostria.app/assets/nostria-social.jpg', // Use extracted image or fallback
      url: targetUrl,
    });

    return data;
  }

  /**
   * Extract a tag value by tag name
   * @param tags The tags array from the event
   * @param tagName The name of the tag to find (e.g., 'title', 'image')
   * @returns The tag value or null if not found
   */
  private extractTagValue(tags: any[], tagName: string): string | null {
    if (!tags || !Array.isArray(tags)) return null;

    for (const tag of tags) {
      if (Array.isArray(tag) && tag[0] === tagName && tag[1]) {
        return tag[1];
      }
    }
    return null;
  }

  /**
   * Extract image URL from 'image' tag (used by music tracks, etc.)
   * @param tags The tags array from the event
   * @returns The image URL or null if not found
   */
  private extractImageUrlFromImageTag(tags: any[]): string | null {
    return this.extractTagValue(tags, 'image');
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

  /**
   * Extract YouTube thumbnail URL from content if it contains a YouTube video
   * @param content The content to search for YouTube URLs
   * @returns YouTube thumbnail URL or null if no YouTube video found
   */
  private extractYouTubeThumbnailFromContent(content: string): string | null {
    if (!content) return null;

    const youtubeId = this.extractYouTubeId(content);
    if (youtubeId) {
      return `https://img.youtube.com/vi/${youtubeId}/0.jpg`;
    }

    return null;
  }

  /**
   * Extract YouTube video ID from various URL formats
   * @param url The URL or content to extract YouTube ID from
   * @returns YouTube video ID or null if not found
   */
  private extractYouTubeId(url: string): string | null {
    if (!url) return null;

    // Handle youtube.com/embed/ format
    const embedMatch = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]+)/);
    if (embedMatch) return embedMatch[1];

    // Handle youtube.com/watch?v= format
    const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
    if (watchMatch) return watchMatch[1];

    // Handle youtu.be/ format
    const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
    if (shortMatch) return shortMatch[1];

    return null;
  }
}
