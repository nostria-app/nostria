import { Injectable, inject, signal, computed } from '@angular/core';
import { DiscoveryRelayService } from './discovery-relay';
import { RelaysService } from './relays';
import { UtilitiesService } from '../utilities.service';
import { DatabaseService } from '../database.service';
import { LoggerService } from '../logger.service';
import { kinds } from 'nostr-tools';

@Injectable({
  providedIn: 'root'
})
export class UserRelaysService {
  private readonly discoveryRelayService = inject(DiscoveryRelayService);
  private readonly relaysService = inject(RelaysService);
  private readonly utilitiesService = inject(UtilitiesService);
  private readonly database = inject(DatabaseService);
  private readonly logger = inject(LoggerService);

  // High-performance cache with timestamp tracking
  private readonly cachedRelays = signal<Map<string, string[]>>(new Map());
  private readonly cacheTimestamps = new Map<string, number>();

  // DM relay cache (kind 10050) - separate from regular relay cache
  // DM relays rarely change, so use a long TTL
  private readonly cachedDmRelays = new Map<string, string[]>();
  private readonly dmRelayCacheTimestamps = new Map<string, number>();
  private readonly inflightDmRelayRequests = new Map<string, Promise<string[]>>();

  // Cache TTL: 5 minutes for general relays (in milliseconds)
  private readonly CACHE_TTL = 5 * 60 * 1000;

  // DM relay cache TTL: 1 hour (kind 10050 rarely changes)
  private readonly DM_RELAY_CACHE_TTL = 60 * 60 * 1000;

  // In-flight requests to prevent duplicate discovery calls
  private readonly inflightRequests = new Map<string, Promise<string[]>>();

  // Signal to track which pubkeys are currently loading relays
  private readonly loadingPubkeys = signal<Set<string>>(new Set());

  // Safety limit for relay hints used in read/navigation flows
  private readonly MAX_CACHED_RELAYS = 10;

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

    // Mark this pubkey as loading
    this.loadingPubkeys.update(set => {
      const newSet = new Set(set);
      newSet.add(pubkey);
      return newSet;
    });

    // Start a new discovery request
    const discoveryPromise = this.discoverAndCacheRelays(pubkey);
    this.inflightRequests.set(pubkey, discoveryPromise);

    try {
      await discoveryPromise;
    } finally {
      // Clean up the in-flight request
      this.inflightRequests.delete(pubkey);
      // Remove from loading set
      this.loadingPubkeys.update(set => {
        const newSet = new Set(set);
        newSet.delete(pubkey);
        return newSet;
      });
    }
  }

  /**
   * Internal method to discover and cache relays
   * Strategy: Load from local database FIRST for instant display,
   * then fetch from discovery relay for updates
   */
  private async discoverAndCacheRelays(pubkey: string): Promise<string[]> {
    let relays: string[] = [];
    let dbRelays: string[] = [];

    try {
      // FIRST: Try to load from local database for immediate availability
      const dbRelayListEvent = await this.database.getEventByPubkeyAndKind(pubkey, kinds.RelayList);
      if (dbRelayListEvent) {
        dbRelays = this.utilitiesService.getOptimalRelayUrlsForFetching(dbRelayListEvent);
        if (dbRelays.length > 0) {
          relays = this.setCachedRelays(pubkey, dbRelays, 'database');
        }
      }

      // THEN: Fetch from discovery service for potential updates (kind 10002 or kind 3)
      const discoveryRelays = await this.discoveryRelayService.getUserRelayUrls(pubkey);

      // If discovery found relays, use them (they may be more up-to-date)
      if (discoveryRelays.length > 0) {
        relays = this.setCachedRelays(pubkey, discoveryRelays, 'discovery');
      }

      // If no relays found through either method, try fallback relays
      if (relays.length === 0) {
        const fallbackRelays = await this.relaysService.getFallbackRelaysForPubkey(pubkey);
        if (fallbackRelays.length > 0) {
          relays = this.setCachedRelays(pubkey, fallbackRelays, 'fallback');
        }
      }

    } catch (error) {
      this.logger.error('Error fetching user relays:', error);

      // If we already have database relays, keep using them
      if (dbRelays.length > 0) {
        return dbRelays;
      }

      // Fallback to relay hints if discovery fails
      try {
        const fallbackRelays = await this.relaysService.getFallbackRelaysForPubkey(pubkey);

        if (fallbackRelays.length > 0) {
          relays = this.setCachedRelays(pubkey, fallbackRelays, 'error-fallback');
        }
      } catch (hintsError) {
        this.logger.error('Error fetching relay hints:', hintsError);
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
      return this.optimizeRelays(cached);
    }
    return [];
  }

  private setCachedRelays(pubkey: string, relays: string[], source: string): string[] {
    const optimizedRelays = this.optimizeRelays(relays);

    if (relays.length > optimizedRelays.length) {
      this.logger.debug(
        `[UserRelaysService] Trimmed relays from ${relays.length} to ${optimizedRelays.length} for ${pubkey.slice(0, 16)}... (source: ${source})`
      );
    }

    this.cachedRelays.update(cache => {
      const newCache = new Map(cache);
      newCache.set(pubkey, optimizedRelays);
      return newCache;
    });
    this.cacheTimestamps.set(pubkey, Date.now());

    return optimizedRelays;
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
      this.logger.error('Error fetching user relays for publishing:', error);
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
    this.cachedDmRelays.delete(pubkey);
    this.dmRelayCacheTimestamps.delete(pubkey);
  }

  /**
   * Clear all cached relays
   */
  clearAllCache(): void {
    this.cachedRelays.set(new Map());
    this.cacheTimestamps.clear();
    this.cachedDmRelays.clear();
    this.dmRelayCacheTimestamps.clear();
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
    return uniqueRelays.slice(0, this.MAX_CACHED_RELAYS);
  }

  /**
   * Ensure DM relays are discovered and cached for a pubkey.
   * Call this when a chat is opened — it loads from database instantly,
   * then refreshes from the network in the background.
   * This avoids network lookups during message sending.
   */
  async ensureDmRelaysForPubkey(pubkey: string): Promise<void> {
    // If we already have a valid cache, just trigger a background refresh
    const cachedTimestamp = this.dmRelayCacheTimestamps.get(pubkey);
    const hasValidCache = cachedTimestamp && Date.now() - cachedTimestamp < this.DM_RELAY_CACHE_TTL;
    const cached = this.cachedDmRelays.get(pubkey);

    if (hasValidCache && cached && cached.length > 0) {
      this.logger.debug(`[UserRelaysService] DM relays already cached for pubkey: ${pubkey.slice(0, 16)}...`);
      return;
    }

    // Load from database first for instant availability
    await this.loadDmRelaysFromDatabase(pubkey);

    // Then refresh from network in the background (fire-and-forget)
    this.refreshDmRelaysFromNetwork(pubkey).catch(err => {
      this.logger.warn(`[UserRelaysService] Background DM relay refresh failed for ${pubkey.slice(0, 16)}:`, err);
    });
  }

  /**
   * Get DM-specific relay URLs for a user (kind 10050 - NIP-17)
   * Used during message publishing. Returns cached/database relays immediately.
   * Only fetches from network if nothing is cached (first contact with no prior data).
   * For best performance, call ensureDmRelaysForPubkey() when a chat is opened.
   * @param pubkey - The recipient's public key
   * @returns Promise<string[]> - Array of DM relay URLs
   */
  async getUserDmRelaysForPublishing(pubkey: string): Promise<string[]> {
    this.logger.debug(`[UserRelaysService] getUserDmRelaysForPublishing called for pubkey: ${pubkey.slice(0, 16)}...`);

    // 1. Check in-memory cache first (fastest path)
    const cached = this.cachedDmRelays.get(pubkey);
    if (cached && cached.length > 0) {
      this.logger.debug(`[UserRelaysService] Returning ${cached.length} cached DM relays for pubkey: ${pubkey.slice(0, 16)}...`);
      return cached;
    }

    // 2. Try loading from local database (no network)
    const dbRelays = await this.loadDmRelaysFromDatabase(pubkey);
    if (dbRelays.length > 0) {
      this.logger.debug(`[UserRelaysService] Returning ${dbRelays.length} DB DM relays for pubkey: ${pubkey.slice(0, 16)}...`);
      return dbRelays;
    }

    // 3. Nothing in cache or database — must fetch from network (first contact)
    this.logger.debug(`[UserRelaysService] No cached DM relays, fetching from network for pubkey: ${pubkey.slice(0, 16)}...`);

    // Deduplicate in-flight requests
    const existingRequest = this.inflightDmRelayRequests.get(pubkey);
    if (existingRequest) {
      return existingRequest;
    }

    const requestPromise = this.fetchDmRelaysFromNetwork(pubkey);
    this.inflightDmRelayRequests.set(pubkey, requestPromise);

    try {
      return await requestPromise;
    } finally {
      this.inflightDmRelayRequests.delete(pubkey);
    }
  }

  /**
   * Load DM relays from local database (kind 10050 event) and cache them.
   * Returns the relay URLs found, or empty array if none stored.
   */
  private async loadDmRelaysFromDatabase(pubkey: string): Promise<string[]> {
    try {
      const dmRelayEvent = await this.database.getEventByPubkeyAndKind(pubkey, kinds.DirectMessageRelaysList);
      if (dmRelayEvent) {
        const relayUrls = dmRelayEvent.tags
          .filter((tag: string[]) => tag[0] === 'relay')
          .map((tag: string[]) => tag[1])
          .filter((url: string | undefined) => url && url.startsWith('wss://'));

        if (relayUrls.length > 0) {
          // Also get fallback relays to combine
          const fallbackRelays = await this.relaysService.getFallbackRelaysForPubkey(pubkey);
          const allRelays = [...relayUrls, ...fallbackRelays];
          const uniqueNormalizedRelays = this.utilitiesService.getUniqueNormalizedRelayUrls(allRelays);

          // Cache immediately
          this.cachedDmRelays.set(pubkey, uniqueNormalizedRelays);
          this.dmRelayCacheTimestamps.set(pubkey, Date.now());

          this.logger.debug(`[UserRelaysService] Loaded ${uniqueNormalizedRelays.length} DM relays from database for pubkey: ${pubkey.slice(0, 16)}...`);
          return uniqueNormalizedRelays;
        }
      }
    } catch (error) {
      this.logger.warn(`[UserRelaysService] Error loading DM relays from database:`, error);
    }
    return [];
  }

  /**
   * Fetch DM relays from the network (discovery relays) and cache the result.
   * Also saves the kind 10050 event to the database for future offline use.
   */
  private async fetchDmRelaysFromNetwork(pubkey: string): Promise<string[]> {
    try {
      // Get DM relays from discovery service (kind 10050, falls back to kind 10002)
      const dmRelays = await this.discoveryRelayService.getUserDmRelayUrls(pubkey);
      this.logger.debug(`[UserRelaysService] discoveryRelayService.getUserDmRelayUrls returned:`, dmRelays);

      // Also get fallback relays in case DM relays are not set
      const fallbackRelays = await this.relaysService.getFallbackRelaysForPubkey(pubkey);

      // Combine and deduplicate
      const allRelays = [...dmRelays, ...fallbackRelays];
      const uniqueNormalizedRelays = this.utilitiesService.getUniqueNormalizedRelayUrls(allRelays);

      this.logger.debug(`[UserRelaysService] Final DM relays for ${pubkey.slice(0, 16)}:`, uniqueNormalizedRelays);

      // Cache the result
      this.cachedDmRelays.set(pubkey, uniqueNormalizedRelays);
      this.dmRelayCacheTimestamps.set(pubkey, Date.now());

      return uniqueNormalizedRelays;
    } catch (error) {
      this.logger.error('[UserRelaysService] Error fetching DM relays from network:', error);
      // Fall back to regular relay list
      return this.getUserRelaysForPublishing(pubkey);
    }
  }

  /**
   * Background refresh of DM relays from the network.
   * Updates cache/database if newer data is found, but doesn't block callers.
   */
  private async refreshDmRelaysFromNetwork(pubkey: string): Promise<void> {
    // Deduplicate with in-flight requests
    if (this.inflightDmRelayRequests.has(pubkey)) {
      return;
    }

    const refreshPromise = this.fetchDmRelaysFromNetwork(pubkey);
    this.inflightDmRelayRequests.set(pubkey, refreshPromise);

    try {
      await refreshPromise;
    } finally {
      this.inflightDmRelayRequests.delete(pubkey);
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
   * Check if relay discovery is currently in progress for a pubkey
   * @param pubkey - The user's public key
   * @returns boolean - Whether relay discovery is loading
   */
  isLoadingRelaysForPubkey(pubkey: string): boolean {
    return this.loadingPubkeys().has(pubkey);
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