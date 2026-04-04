import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { isXStatusUrl, normalizePreviewUrl } from '../utils/url-cleaner';

export interface OpenGraphData {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  siteName?: string;
  type?: string;
  providerName?: string;
  authorName?: string;
  authorUrl?: string;
  embedHtml?: string;
  previewType?: 'generic' | 'x-post' | 'blocked';
  loading: boolean;
  error: boolean;
  errorMessage?: string;
}

@Injectable({
  providedIn: 'root',
})
export class OpenGraphService {
  private document = inject(DOCUMENT);
  private sanitizer = inject(DomSanitizer);
  private cache = new Map<string, OpenGraphData>();

  /**
   * Fetches OpenGraph metadata for a given URL
   * @param url The URL to fetch metadata for
   * @returns A promise that resolves to OpenGraph data
   */
  async getOpenGraphData(url: string): Promise<OpenGraphData> {
    const normalizedUrl = normalizePreviewUrl(url);
    const cacheKey = this.getCacheKey(normalizedUrl);

    if (this.shouldSkipPreview(normalizedUrl)) {
      const blockedData = this.createBlockedPreview(normalizedUrl);

      this.cache.set(cacheKey, blockedData);
      return blockedData;
    }

    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      if (isXStatusUrl(normalizedUrl)) {
        try {
          const xPostEmbed = await this.getXPostEmbedData(normalizedUrl);

          if (xPostEmbed) {
            this.cache.set(cacheKey, xPostEmbed);
            return xPostEmbed;
          }
        } catch (error) {
          console.warn(`Failed to fetch X oEmbed for ${normalizedUrl}:`, error);
        }
      }

      // Updated to use the proxy endpoint that returns JSON directly
      const proxyUrl = `https://metadata.nostria.app/og?url=${encodeURIComponent(normalizedUrl)}`;

      const response = await fetch(proxyUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
      }

      // Parse JSON response instead of HTML
      const jsonData = await response.json();

      // Map the JSON response to our OpenGraphData interface
      const metadata: OpenGraphData = {
        url: normalizedUrl,
        title: jsonData.title,
        description: jsonData.description,
        image: jsonData.image,
        imageWidth: jsonData.imageWidth ? parseInt(jsonData.imageWidth, 10) : undefined,
        imageHeight: jsonData.imageHeight ? parseInt(jsonData.imageHeight, 10) : undefined,
        siteName: jsonData.siteName || jsonData.site_name,
        type: jsonData.type,
        providerName: jsonData.providerName || jsonData.provider_name,
        previewType: 'generic',
        loading: false,
        error: false,
      };

      const enrichedMetadata = this.enrichYouTubePreview(metadata, normalizedUrl);

      // Ensure image URLs are absolute
      if (enrichedMetadata.image && !enrichedMetadata.image.match(/^https?:\/\//)) {
        enrichedMetadata.image = this.resolveUrl(enrichedMetadata.image, normalizedUrl);
      }

      // Cache the result
      this.cache.set(cacheKey, enrichedMetadata);
      return enrichedMetadata;
    } catch (error) {
      console.error(`Error fetching OpenGraph data for ${normalizedUrl}:`, error);

      const youtubeFallback = this.createYouTubeFallbackPreview(normalizedUrl);
      if (youtubeFallback) {
        this.cache.set(cacheKey, youtubeFallback);
        return youtubeFallback;
      }

      const errorData: OpenGraphData = {
        url: normalizedUrl,
        loading: false,
        error: true,
        errorMessage: error instanceof Error ? error.message : 'Failed to fetch metadata',
      };

      // Cache the error result too, but with a shorter TTL in a real app
      this.cache.set(cacheKey, errorData);
      return errorData;
    }
  }

  private enrichYouTubePreview(metadata: OpenGraphData, normalizedUrl: string): OpenGraphData {
    if (!this.isYouTubeUrl(normalizedUrl)) {
      return metadata;
    }

    const youtubeId = this.extractYouTubeVideoId(normalizedUrl);
    if (!youtubeId) {
      return metadata;
    }

    return {
      ...metadata,
      image: metadata.image || this.getYouTubeThumbnailUrl(youtubeId),
      siteName: metadata.siteName || 'YouTube',
      providerName: metadata.providerName || 'YouTube',
      title: metadata.title || 'YouTube video',
      description: metadata.description || 'Watch on YouTube',
    };
  }

  private createYouTubeFallbackPreview(url: string): OpenGraphData | null {
    if (!this.isYouTubeUrl(url)) {
      return null;
    }

    const youtubeId = this.extractYouTubeVideoId(url);
    if (!youtubeId) {
      return null;
    }

    return {
      url,
      title: 'YouTube video',
      description: 'Watch on YouTube',
      image: this.getYouTubeThumbnailUrl(youtubeId),
      siteName: 'YouTube',
      providerName: 'YouTube',
      previewType: 'generic',
      loading: false,
      error: false,
    };
  }

  private shouldSkipPreview(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return hostname === 'reddit.com' || hostname.endsWith('.reddit.com');
    } catch {
      return false;
    }
  }

  private createBlockedPreview(url: string): OpenGraphData {
    let title = 'Link preview unavailable';
    let siteName: string | undefined;

    try {
      const parsedUrl = new URL(url);
      siteName = parsedUrl.hostname.replace(/^www\./, '');
      title = siteName === 'reddit.com' ? 'Reddit link' : siteName;
    } catch {
      // Keep the generic fallback title when URL parsing fails.
    }

    return {
      url,
      title,
      description: 'Open the link to view it directly.',
      siteName,
      previewType: 'blocked',
      loading: false,
      error: false,
    };
  }

  private isYouTubeUrl(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return hostname === 'youtu.be' || hostname.endsWith('.youtu.be') || hostname === 'youtube.com' || hostname.endsWith('.youtube.com');
    } catch {
      return false;
    }
  }

  private extractYouTubeVideoId(url: string): string | null {
    const match = url.match(/(?:(?:[a-zA-Z0-9-]+\.)?youtube\.com\/(?:watch\?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return match?.[1] || null;
  }

  private getYouTubeThumbnailUrl(videoId: string): string {
    return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  }

  private getCacheKey(url: string): string {
    if (!isXStatusUrl(url)) {
      return url;
    }

    const theme = this.getXEmbedTheme() || 'light';
    return `${url}::theme:${theme}`;
  }

  private async getXPostEmbedData(url: string): Promise<OpenGraphData | null> {
    const endpoint = new URL('https://publish.twitter.com/oembed');
    endpoint.searchParams.set('url', url);
    endpoint.searchParams.set('omit_script', 'true');
    endpoint.searchParams.set('dnt', 'true');

    const theme = this.getXEmbedTheme();
    if (theme) {
      endpoint.searchParams.set('theme', theme);
    }

    const response = await fetch(endpoint.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch X oEmbed: ${response.status} ${response.statusText}`);
    }

    const jsonData = await response.json();
    const embedHtml = this.stripScripts(typeof jsonData.html === 'string' ? jsonData.html : '');

    if (!embedHtml) {
      return null;
    }

    return {
      url,
      title: jsonData.author_name ? `${jsonData.author_name} on X` : 'X Post',
      description: 'Embedded X post',
      providerName: jsonData.provider_name || 'X',
      authorName: jsonData.author_name,
      authorUrl: jsonData.author_url,
      embedHtml,
      previewType: 'x-post',
      type: typeof jsonData.type === 'string' ? jsonData.type : 'rich',
      loading: false,
      error: false,
    };
  }

  private getXEmbedTheme(): 'dark' | 'light' | null {
    const rootElement = this.document?.documentElement;
    const bodyElement = this.document?.body;
    const isDarkMode = rootElement?.classList.contains('dark') || bodyElement?.classList.contains('dark');

    if (isDarkMode) {
      return 'dark';
    }

    if (rootElement || bodyElement) {
      return 'light';
    }

    return null;
  }

  private stripScripts(html: string): string {
    return html.replace(/<script[\s\S]*?<\/script>/gi, '').trim();
  }

  /**
   * Resolves relative URLs to absolute URLs
   */
  private resolveUrl(urlString: string, base: string): string {
    try {
      // Check if the URL is already absolute
      if (urlString.match(/^(https?:)?\/\//i)) {
        return urlString.startsWith('//') ? `https:${urlString}` : urlString;
      }

      // Resolve relative URL
      const baseUrl = new URL(base);
      return new URL(urlString, baseUrl.origin).toString();
    } catch (e) {
      console.error('Error resolving URL:', e);
      return urlString;
    }
  }

  /**
   * Clears the cache for a specific URL or all URLs if no URL is provided
   */
  clearCache(url?: string): void {
    if (url) {
      const normalizedUrl = normalizePreviewUrl(url);

      if (isXStatusUrl(normalizedUrl)) {
        const keysToDelete = [...this.cache.keys()].filter(key => key.startsWith(`${normalizedUrl}::theme:`));
        for (const key of keysToDelete) {
          this.cache.delete(key);
        }
        return;
      }

      this.cache.delete(normalizedUrl);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Creates a safe resource URL for iframes or other embedded content
   */
  getSafeUrl(url: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  /**
   * Gets OpenGraph data for multiple URLs
   */
  async getMultipleOpenGraphData(urls: string[]): Promise<OpenGraphData[]> {
    const promises = urls.map(url => this.getOpenGraphData(url));
    return await Promise.all(promises);
  }
}
