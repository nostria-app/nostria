import { Injectable, inject } from '@angular/core';
import { signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

export interface OpenGraphData {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  siteName?: string;
  type?: string;
  loading: boolean;
  error: boolean;
  errorMessage?: string;
}

@Injectable({
  providedIn: 'root',
})
export class OpenGraphService {
  private sanitizer = inject(DomSanitizer);
  private cache = new Map<string, OpenGraphData>();

  /**
   * Fetches OpenGraph metadata for a given URL
   * @param url The URL to fetch metadata for
   * @returns A promise that resolves to OpenGraph data
   */
  async getOpenGraphData(url: string): Promise<OpenGraphData> {
    // Check cache first
    if (this.cache.has(url)) {
      return this.cache.get(url)!;
    }

    // Create initial data object
    const initialData: OpenGraphData = {
      url,
      loading: true,
      error: false,
    };

    try {
      // Updated to use the proxy endpoint that returns JSON directly
      const proxyUrl = `https://metadata.nostria.app/og?url=${encodeURIComponent(url)}`;

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
        url,
        title: jsonData.title,
        description: jsonData.description,
        image: jsonData.image,
        imageWidth: jsonData.imageWidth ? parseInt(jsonData.imageWidth, 10) : undefined,
        imageHeight: jsonData.imageHeight ? parseInt(jsonData.imageHeight, 10) : undefined,
        loading: false,
        error: false,
      };

      // Ensure image URLs are absolute
      if (metadata.image && !metadata.image.match(/^https?:\/\//)) {
        metadata.image = this.resolveUrl(metadata.image, url);
      }

      // Cache the result
      this.cache.set(url, metadata);
      return metadata;
    } catch (error) {
      console.error(`Error fetching OpenGraph data for ${url}:`, error);

      const errorData: OpenGraphData = {
        url,
        loading: false,
        error: true,
        errorMessage: error instanceof Error ? error.message : 'Failed to fetch metadata',
      };

      // Cache the error result too, but with a shorter TTL in a real app
      this.cache.set(url, errorData);
      return errorData;
    }
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
      this.cache.delete(url);
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
    const promises = urls.map((url) => this.getOpenGraphData(url));
    return await Promise.all(promises);
  }
}
