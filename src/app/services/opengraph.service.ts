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
  previewType?: 'generic' | 'x-post';
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

    // Check cache first
    if (this.cache.has(normalizedUrl)) {
      return this.cache.get(normalizedUrl)!;
    }

    try {
      if (isXStatusUrl(normalizedUrl)) {
        try {
          const xPostEmbed = await this.getXPostEmbedData(normalizedUrl);

          if (xPostEmbed) {
            this.cache.set(normalizedUrl, xPostEmbed);
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

      // Ensure image URLs are absolute
      if (metadata.image && !metadata.image.match(/^https?:\/\//)) {
        metadata.image = this.resolveUrl(metadata.image, normalizedUrl);
      }

      // Cache the result
      this.cache.set(normalizedUrl, metadata);
      return metadata;
    } catch (error) {
      console.error(`Error fetching OpenGraph data for ${normalizedUrl}:`, error);

      const errorData: OpenGraphData = {
        url: normalizedUrl,
        loading: false,
        error: true,
        errorMessage: error instanceof Error ? error.message : 'Failed to fetch metadata',
      };

      // Cache the error result too, but with a shorter TTL in a real app
      this.cache.set(normalizedUrl, errorData);
      return errorData;
    }
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
      this.cache.delete(normalizePreviewUrl(url));
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
