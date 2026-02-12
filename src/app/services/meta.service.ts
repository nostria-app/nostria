import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { firstValueFrom, timeout, catchError, of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { nip19 } from 'nostr-tools';

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

// Timeout for metadata API requests (in milliseconds)
// Social media bots typically have short timeouts, so we need to respond quickly
const METADATA_REQUEST_TIMEOUT_MS = 4000;

@Injectable({
  providedIn: 'root',
})
export class MetaService {
  private meta = inject(Meta);
  private title = inject(Title);
  private readonly http = inject(HttpClient);
  #metadataUrl = environment.metadataUrl;

  /**
   * Sets the page title with consistent "Nostria – " prefix
   * @param title The title to set (will have "Nostria – " prepended if not already)
   */
  setTitle(title: string): void {
    // Ensure consistent "Nostria – " prefix format
    let formattedTitle = title;
    // Remove old " - Nostria" suffix if present
    if (formattedTitle.endsWith(' - Nostria')) {
      formattedTitle = formattedTitle.slice(0, -10);
    }
    // Add prefix if not already present
    if (!formattedTitle.startsWith('Nostria – ')) {
      formattedTitle = `Nostria – ${formattedTitle}`;
    }
    this.title.setTitle(formattedTitle);
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

    // Open Graph - use addTag with explicit selector to ensure tags are created/updated
    if (config.title) {
      this.meta.updateTag({ property: 'og:title', content: config.title }, 'property="og:title"');
    }
    if (config.description) {
      this.meta.updateTag({ property: 'og:description', content: config.description }, 'property="og:description"');
    }
    if (config.image) {
      this.meta.updateTag({ property: 'og:image', content: config.image }, 'property="og:image"');
    }
    if (config.url) {
      this.meta.updateTag({ property: 'og:url', content: config.url }, 'property="og:url"');
    }

    // Twitter Card - use explicit selector
    if (config.title) {
      this.meta.updateTag({ name: 'twitter:title', content: config.title }, 'name="twitter:title"');
    }
    if (config.description) {
      this.meta.updateTag({ name: 'twitter:description', content: config.description }, 'name="twitter:description"');
    }
    if (config.image) {
      this.meta.updateTag({ name: 'twitter:image', content: config.image }, 'name="twitter:image"');
    }
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
      // For nevent, decode and re-encode without relay hints
      try {
        const decoded = nip19.decode(addr);
        if (decoded.type === 'nevent') {
          const canonicalNevent = nip19.neventEncode({
            id: decoded.data.id,
            author: decoded.data.author,
            kind: decoded.data.kind,
            // No relays - canonical form
          });
          targetUrl = `https://nostria.app/e/${canonicalNevent}`;
        } else {
          targetUrl = `https://nostria.app/e/${addr}`;
        }
      } catch {
        targetUrl = `https://nostria.app/e/${addr}`;
      }
    } else if (addr.startsWith('nprofile')) {
      // This API will parse out the profile ID from the Nostr profile address.
      url = `${this.#metadataUrl}p/${addr}`;
      // For nprofile, decode and convert to npub (canonical form)
      try {
        const decoded = nip19.decode(addr);
        if (decoded.type === 'nprofile') {
          const npub = nip19.npubEncode(decoded.data.pubkey);
          targetUrl = `https://nostria.app/p/${npub}`;
        } else {
          targetUrl = `https://nostria.app/p/${addr}`;
        }
      } catch {
        targetUrl = `https://nostria.app/p/${addr}`;
      }
    } else if (addr.startsWith('npub')) {
      // npub is already canonical
      url = `${this.#metadataUrl}p/${addr}`;
      targetUrl = `https://nostria.app/p/${addr}`;
    } else if (addr.startsWith('naddr')) {
      // This API will parse out the event ID from the Nostr address.
      url = `${this.#metadataUrl}a/${addr}`;
      // For naddr, decode and re-encode without relay hints
      try {
        const decoded = nip19.decode(addr);
        if (decoded.type === 'naddr') {
          const canonicalNaddr = nip19.naddrEncode({
            kind: decoded.data.kind,
            pubkey: decoded.data.pubkey,
            identifier: decoded.data.identifier,
            // No relays - canonical form
          });
          targetUrl = `https://nostria.app/a/${canonicalNaddr}`;
        } else {
          targetUrl = `https://nostria.app/a/${addr}`;
        }
      } catch {
        targetUrl = `https://nostria.app/a/${addr}`;
      }
    }

    // Fetch metadata with timeout to ensure fast response for social media bots
    const data = await firstValueFrom(
      this.http.get<MetadataResponse>(url).pipe(
        timeout(METADATA_REQUEST_TIMEOUT_MS),
        catchError(error => {
          console.error(`[SSR] Metadata fetch failed or timed out for ${addr}:`, error?.message || error);
          // Return a minimal response on timeout/error so SSR can still complete
          return of({
            author: {
              profile: {
                display_name: undefined,
                name: undefined,
                picture: '',
              },
            },
            content: '',
            tags: [],
          } as MetadataResponse);
        })
      )
    );

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

  /**
   * Extract an image URL from imeta tags (NIP-92).
   *
   * Strategy:
   * 1. Return the `url` of the first imeta tag whose mime type (`m`) starts with `image/`.
   * 2. If no image-type imeta is found, return the first `image` field from any imeta tag
   *    (this is the video thumbnail/screenshot per NIP-71).
   * 3. Falls back to null so other extraction methods can try.
   */
  private extractImageUrlFromImeta(tags: any[]): string | null {
    if (!tags || !Array.isArray(tags)) return null;

    let firstVideoThumbnail: string | null = null;

    for (const tag of tags) {
      if (!Array.isArray(tag) || tag[0] !== 'imeta') continue;

      const parsed = this.parseImetaTag(tag);

      // If this imeta entry is an image, return its URL directly
      if (parsed['m']?.startsWith('image/') && parsed['url']) {
        return parsed['url'];
      }

      // If this imeta entry has a video thumbnail (`image` field), remember it
      if (!firstVideoThumbnail && parsed['image']) {
        firstVideoThumbnail = parsed['image'];
      }

      // Fallback: if no mime type but the URL looks like an image, use it
      if (!parsed['m'] && parsed['url']) {
        const url = parsed['url'];
        if (/\.(jpg|jpeg|png|gif|webp|avif|svg)(\?|$)/i.test(url)) {
          return url;
        }
      }
    }

    // No direct image found — use a video thumbnail if available
    return firstVideoThumbnail;
  }

  /**
   * Parse an imeta tag into a key-value object.
   * Format: ["imeta", "url https://...", "m image/jpeg", "image https://thumb.jpg", ...]
   */
  private parseImetaTag(tag: string[]): Record<string, string> {
    const parsed: Record<string, string> = {};
    for (let i = 1; i < tag.length; i++) {
      const part = tag[i];
      if (!part) continue;
      const spaceIndex = part.indexOf(' ');
      if (spaceIndex > 0) {
        const key = part.substring(0, spaceIndex);
        const value = part.substring(spaceIndex + 1);
        // Keep first occurrence of each key
        if (!parsed[key]) {
          parsed[key] = value;
        }
      }
    }
    return parsed;
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

    // Handle youtube.com/shorts/ format
    const shortsMatch = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/);
    if (shortsMatch) return shortsMatch[1];

    // Handle youtube.com/live/ format
    const liveMatch = url.match(/youtube\.com\/live\/([a-zA-Z0-9_-]+)/);
    if (liveMatch) return liveMatch[1];

    return null;
  }
}
