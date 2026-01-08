import { Injectable, inject, signal, computed } from '@angular/core';
import { DiscoveryRelayService } from './discovery-relay';
import { RelaysService } from './relays';
import { UtilitiesService } from '../utilities.service';

@Injectable({
  providedIn: 'root'
})
export class UserRelaysService {
  private readonly discoveryRelayService = inject(DiscoveryRelayService);
  private readonly relaysService = inject(RelaysService);
  private readonly utilitiesService = inject(UtilitiesService);

  // High-performance cache with timestamp tracking
  private readonly cachedRelays = signal<Map<string, string[]>>(new Map());
  private readonly cacheTimestamps = new Map<string, number>();

  // Cache TTL: 5 minutes (in milliseconds)
  private readonly CACHE_TTL = 5 * 60 * 1000;

  // In-flight requests to prevent duplicate discovery calls
  private readonly inflightRequests = new Map<string, Promise<string[]>>();

  /**
   * Check if the cache is still valid for a given pubkey
   */
  private isCacheValid(pubkey: string): boolean {
    const timestamp = this.cacheTimestamps.get(pubkey);
    if (!timestamp) return false;

    return Date.now() - timestamp < this.CACHE_TTL;
  }

  /**
   * Ensure relays are discovered and cached for a pubkey
   * This method is idempotent and safe to call multiple times
   * It will only perform discovery if needed
   */
  async ensureRelaysForPubkey(pubkey: string): Promise<void> {
    // Check if we have valid cached data
    if (this.isCacheValid(pubkey)) {
      return; // Already discovered and cache is valid
    }

    // Check if there's already an in-flight request
    const existingRequest = this.inflightRequests.get(pubkey);
    if (existingRequest) {
      await existingRequest; // Wait for the existing request to complete
      return;
    }

    // Start a new discovery request
    const discoveryPromise = this.discoverAndCacheRelays(pubkey);
    this.inflightRequests.set(pubkey, discoveryPromise);

    try {
      await discoveryPromise;
    } finally {
      // Clean up the in-flight request
      this.inflightRequests.delete(pubkey);
    }
  }

  /**
   * Internal method to discover and cache relays
   */
  private async discoverAndCacheRelays(pubkey: string): Promise<string[]> {
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
        this.cacheTimestamps.set(pubkey, Date.now());
      }

    } catch (error) {
      console.error('Error fetching user relays:', error);

      // Fallback to relay hints if discovery fails
      try {
        relays = await this.relaysService.getFallbackRelaysForPubkey(pubkey);

        if (relays.length > 0) {
          this.cachedRelays.update(cache => {
            const newCache = new Map(cache);
            newCache.set(pubkey, relays);
            return newCache;
          });
          this.cacheTimestamps.set(pubkey, Date.now());
        }
      } catch (hintsError) {
        console.error('Error fetching relay hints:', hintsError);
        relays = [];
      }
    }

    return relays;
  }

  /**
   * Get relay URLs for a specific pubkey (synchronous if cached)
   * Returns empty array if not cached - call ensureRelaysForPubkey first
   */
  getRelaysForPubkey(pubkey: string): string[] {
    const cached = this.cachedRelays().get(pubkey);
    if (cached && this.isCacheValid(pubkey)) {
      return cached;
    }
    return [];
  }

  /**
   * Get optimal relays for a user's public key
   * This method ensures relays are discovered and cached
   * @param pubkey - The user's public key in hex format
   * @returns Promise<string[]> - Array of relay URLs (limited to 10)
   */
  async getUserRelays(pubkey: string): Promise<string[]> {
    // Ensure relays are discovered and cached
    await this.ensureRelaysForPubkey(pubkey);

    // Get from cache
    const cached = this.cachedRelays().get(pubkey);
    if (cached && cached.length > 0) {
      return this.optimizeRelays(cached);
    }

    // If still no relays, return empty array
    return [];
  }

  /**
   * Get optimal relays for reading/connecting - returns a limited number of best relays
   * @param pubkey - The user's public key in hex format
   * @param maxRelays - Maximum number of relays to return (default: 3)
   * @returns Promise<string[]> - Array of optimal relay URLs for reading
   */
  async getUserRelaysForReading(pubkey: string, maxRelays = 3): Promise<string[]> {
    // Ensure relays are discovered and cached
    await this.ensureRelaysForPubkey(pubkey);

    const allRelays = this.getRelaysForPubkey(pubkey);

    if (allRelays.length === 0) {
      return [];
    }

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
      // Ensure relays are discovered and cached
      await this.ensureRelaysForPubkey(pubkey);

      // 1. Get relays from cache (which includes discovery service results)
      const cachedRelays = this.getRelaysForPubkey(pubkey);
      allRelays.push(...cachedRelays);

      // 2. Get relays from observed relay hints (additional sources)
      const fallbackRelays = await this.relaysService.getFallbackRelaysForPubkey(pubkey);
      allRelays.push(...fallbackRelays);

      // 3. Remove duplicates and normalize URLs using utility function
      const uniqueNormalizedRelays = this.utilitiesService.getUniqueNormalizedRelayUrls(allRelays);

      // 4. For publishing, we return ALL discovered relays (no optimization or limiting)
      // This ensures maximum distribution of the event across the user's entire relay network
      return uniqueNormalizedRelays;

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
    this.cacheTimestamps.delete(pubkey);
  }

  /**
   * Clear all cached relays
   */
  clearAllCache(): void {
    this.cachedRelays.set(new Map());
    this.cacheTimestamps.clear();
  }

  /**
   * Force refresh relays for a specific user (bypasses cache)
   * @param pubkey - The user's public key
   */
  async refreshUserRelays(pubkey: string): Promise<string[]> {
    // Clear cache for this user
    this.clearUserRelaysCache(pubkey);

    // Discover fresh relays
    return this.discoverAndCacheRelays(pubkey);
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
      })
      // Filter out insecure ws:// relays - they cannot be used from secure context
      .filter(relay => !relay.startsWith('ws://'));

    // TODO: Add logic to sort by reliability/performance metrics
    // For now, return first 10 relays to avoid overwhelming connections
    return uniqueRelays.slice(0, 10);
  }

  /**
   * Get DM-specific relay URLs for a user (kind 10050 - NIP-17)
   * Used for publishing gift-wrapped messages to a recipient.
   * @param pubkey - The recipient's public key
   * @returns Promise<string[]> - Array of DM relay URLs
   */
  async getUserDmRelaysForPublishing(pubkey: string): Promise<string[]> {
    console.log(`[UserRelaysService] getUserDmRelaysForPublishing called for pubkey: ${pubkey.slice(0, 16)}...`);

    try {
      // Get DM relays from discovery service (kind 10050, falls back to kind 10002)
      const dmRelays = await this.discoveryRelayService.getUserDmRelayUrls(pubkey);
      console.log(`[UserRelaysService] discoveryRelayService.getUserDmRelayUrls returned:`, dmRelays);

      // Also get fallback relays in case DM relays are not set
      const fallbackRelays = await this.relaysService.getFallbackRelaysForPubkey(pubkey);
      console.log(`[UserRelaysService] relaysService.getFallbackRelaysForPubkey returned:`, fallbackRelays);

      // Combine and deduplicate
      const allRelays = [...dmRelays, ...fallbackRelays];
      const uniqueNormalizedRelays = this.utilitiesService.getUniqueNormalizedRelayUrls(allRelays);

      console.log(`[UserRelaysService] Final relays for DM publishing to ${pubkey.slice(0, 16)}:`, uniqueNormalizedRelays);

      return uniqueNormalizedRelays;
    } catch (error) {
      console.error('[UserRelaysService] Error fetching user DM relays for publishing:', error);
      // Fall back to regular relay list
      return this.getUserRelaysForPublishing(pubkey);
    }
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