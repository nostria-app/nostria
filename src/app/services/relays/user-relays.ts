import { Injectable, inject, signal, computed } from '@angular/core';
import { DiscoveryRelayService } from './discovery-relay';
import { RelaysService } from './relays';

@Injectable({
  providedIn: 'root'
})
export class UserRelaysService {
  private readonly discoveryRelayService = inject(DiscoveryRelayService);
  private readonly relaysService = inject(RelaysService);
  private readonly cachedRelays = signal<Map<string, string[]>>(new Map());

  /**
   * Get optimal relays for a user's public key (legacy method)
   * @deprecated Use getUserRelaysForReading() or getUserRelaysForPublishing() instead
   * @param pubkey - The user's public key in hex format
   * @returns Promise<string[]> - Array of relay URLs (limited to 10)
   */
  async getUserRelays(pubkey: string): Promise<string[]> {
    // Check cache first
    const cached = this.cachedRelays().get(pubkey);
    if (cached && cached.length > 0) {
      return cached;
    }

    let relays: string[] = [];

    try {
      // First, try to get relays from discovery service (kind 10002 or kind 3)
      relays = await this.discoveryRelayService.getUserRelayUrls(pubkey);

      // If no relays found through discovery, try fallback relays
      if (relays.length === 0) {
        relays = await this.relaysService.getFallbackRelaysForPubkey(pubkey);
      }

      // Cache the result if we found relays
      if (relays.length > 0) {
        this.cachedRelays.update(cache => {
          const newCache = new Map(cache);
          newCache.set(pubkey, relays);
          return newCache;
        });
      }

    } catch (error) {
      console.error('Error fetching user relays:', error);

      // Fallback to relay hints if discovery fails
      try {
        relays = await this.relaysService.getFallbackRelaysForPubkey(pubkey);
      } catch (hintsError) {
        console.error('Error fetching relay hints:', hintsError);
        relays = [];
      }
    }

    return this.optimizeRelays(relays);
  }

  /**
   * Get optimal relays for reading/connecting - returns a limited number of best relays
   * @param pubkey - The user's public key in hex format
   * @param maxRelays - Maximum number of relays to return (default: 3)
   * @returns Promise<string[]> - Array of optimal relay URLs for reading
   */
  async getUserRelaysForReading(pubkey: string, maxRelays = 3): Promise<string[]> {
    const allRelays = await this.getUserRelays(pubkey);

    // Get performance-ranked relays from RelaysService
    const rankedRelays = this.relaysService.getOptimalRelays(allRelays, maxRelays);

    return rankedRelays.slice(0, maxRelays);
  }

  /**
   * Get all known relays for publishing - returns comprehensive list for wide distribution
   * @param pubkey - The user's public key in hex format
   * @returns Promise<string[]> - Array of all known relay URLs for publishing
   */
  async getUserRelaysForPublishing(pubkey: string): Promise<string[]> {
    const allRelays: string[] = [];

    try {
      // 1. Get relays from discovery service (kind 10002 or kind 3)
      const discoveryRelays = await this.discoveryRelayService.getUserRelayUrls(pubkey);
      allRelays.push(...discoveryRelays);

      // 2. Get relays from observed relay hints
      const fallbackRelays = await this.relaysService.getFallbackRelaysForPubkey(pubkey);
      allRelays.push(...fallbackRelays);

      // 3. Get user's cached relays (if any)
      const cached = this.cachedRelays().get(pubkey);
      if (cached && cached.length > 0) {
        allRelays.push(...cached);
      }

      // 4. Remove duplicates and normalize URLs
      const uniqueRelays = [...new Set(allRelays)]
        .map(relay => relay.trim())
        .filter(relay => relay.length > 0)
        .map(relay => {
          // Normalize relay URLs
          if (!relay.startsWith('ws://') && !relay.startsWith('wss://')) {
            return `wss://${relay}`;
          }
          return relay;
        });

      // 5. For publishing, we want to include all discovered relays (no limit)
      // but we can still sort by reliability
      const sortedRelays = this.relaysService.getOptimalRelays(uniqueRelays, uniqueRelays.length);

      return sortedRelays;

    } catch (error) {
      console.error('Error fetching user relays for publishing:', error);
      return [];
    }
  }

  /**
   * Clear cached relays for a specific user
   * @param pubkey - The user's public key
   */
  clearUserRelaysCache(pubkey: string): void {
    this.cachedRelays.update(cache => {
      const newCache = new Map(cache);
      newCache.delete(pubkey);
      return newCache;
    });
  }

  /**
   * Clear all cached relays
   */
  clearAllCache(): void {
    this.cachedRelays.set(new Map());
  }

  /**
   * Optimize relay list by removing duplicates and sorting by reliability
   * @param relays - Array of relay URLs
   * @returns string[] - Optimized relay URLs
   */
  private optimizeRelays(relays: string[]): string[] {
    // Remove duplicates and normalize URLs
    const uniqueRelays = [...new Set(relays)]
      .map(relay => relay.trim())
      .filter(relay => relay.length > 0)
      .map(relay => {
        // Normalize relay URLs
        if (!relay.startsWith('ws://') && !relay.startsWith('wss://')) {
          return `wss://${relay}`;
        }
        return relay;
      });

    // TODO: Add logic to sort by reliability/performance metrics
    // For now, return first 10 relays to avoid overwhelming connections
    return uniqueRelays.slice(0, 10);
  }

  /**
   * Check if relays are cached for a user
   * @param pubkey - The user's public key
   * @returns boolean - Whether relays are cached
   */
  hasRelaysCached(pubkey: string): boolean {
    const cached = this.cachedRelays().get(pubkey);
    return cached !== undefined && cached.length > 0;
  }

  /**
   * Get cached relays count
   * @returns number - Number of users with cached relays
   */
  getCachedRelaysCount = computed(() => this.cachedRelays().size);

  /**
   * Get relay counts for a specific user
   * @param pubkey - The user's public key
   * @returns Promise<{reading: number, publishing: number}> - Count of relays for different purposes
   */
  async getRelayCountsForUser(pubkey: string): Promise<{ reading: number, publishing: number }> {
    const [readingRelays, publishingRelays] = await Promise.all([
      this.getUserRelaysForReading(pubkey),
      this.getUserRelaysForPublishing(pubkey)
    ]);

    return {
      reading: readingRelays.length,
      publishing: publishingRelays.length
    };
  }

  /**
   * Check if a user has sufficient relays for reliable operation
   * @param pubkey - The user's public key
   * @returns Promise<{hasReadingRelays: boolean, hasPublishingRelays: boolean}> - Relay availability status
   */
  async validateUserRelays(pubkey: string): Promise<{ hasReadingRelays: boolean, hasPublishingRelays: boolean }> {
    const counts = await this.getRelayCountsForUser(pubkey);

    return {
      hasReadingRelays: counts.reading > 0,
      hasPublishingRelays: counts.publishing > 0
    };
  }
}