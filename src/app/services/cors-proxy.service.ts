import { Injectable, inject } from '@angular/core';
import { DiscoveryRelayService } from './discovery-relay.service';

/**
 * Service for fetching resources through our CORS proxy.
 * Uses the user's selected region for optimal latency.
 */
@Injectable({
  providedIn: 'root'
})
export class CorsProxyService {
  private readonly discoveryRelay = inject(DiscoveryRelayService);

  /**
   * Gets the CORS proxy URL based on the user's selected region.
   * @param targetUrl The URL to proxy
   * @returns The proxied URL through our CORS proxy
   */
  getProxyUrl(targetUrl: string): string {
    const serverName = this.discoveryRelay.selectedServer().name;
    // Extract region code from server name (e.g., 'proxy.eu.nostria.app' -> 'eu')
    const regionMatch = serverName.match(/proxy\.([a-z]+)\.nostria\.app/);
    const regionCode = regionMatch ? regionMatch[1] : 'eu';
    return `https://proxy.${regionCode}.nostria.app/api/cors-proxy?url=${encodeURIComponent(targetUrl)}`;
  }

  /**
   * Fetches a resource through the CORS proxy.
   * Tries direct fetch first, falls back to proxy if CORS blocks the request.
   * @param url The URL to fetch
   * @param options Optional fetch options
   * @returns The fetch Response
   */
  async fetch(url: string, options?: RequestInit): Promise<Response> {
    // Try direct fetch first (works for CORS-enabled resources)
    try {
      const directResponse = await fetch(url, options);
      if (directResponse.ok) {
        return directResponse;
      }
      throw new Error('Direct fetch failed');
    } catch {
      // Use CORS proxy as fallback
      const proxyUrl = this.getProxyUrl(url);
      const proxyResponse = await fetch(proxyUrl, options);
      if (!proxyResponse.ok) {
        throw new Error(`Failed to fetch through proxy: ${proxyResponse.statusText}`);
      }
      return proxyResponse;
    }
  }

  /**
   * Fetches text content through the CORS proxy.
   * @param url The URL to fetch
   * @returns The text content
   */
  async fetchText(url: string): Promise<string> {
    const response = await this.fetch(url);
    return response.text();
  }

  /**
   * Fetches JSON content through the CORS proxy.
   * @param url The URL to fetch
   * @returns The parsed JSON
   */
  async fetchJson<T = unknown>(url: string): Promise<T> {
    const response = await this.fetch(url);
    return response.json();
  }
}
