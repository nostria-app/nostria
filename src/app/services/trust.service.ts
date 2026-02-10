import { Injectable, inject, signal, computed, Injector, runInInjectionContext } from '@angular/core';
import { LocalSettingsService } from './local-settings.service';
import { LoggerService } from './logger.service';
import { RelayPoolService } from './relays/relay-pool';
import { DatabaseService, TrustMetrics } from './database.service';
import { TrustProviderService } from './trust-provider.service';
import type { Event as NostrEvent, Filter } from 'nostr-tools';

/**
 * Service for managing NIP-85 Web of Trust data
 * Fetches trusted assertions (kind 30382) from configured relay
 */
@Injectable({
  providedIn: 'root',
})
export class TrustService {
  private localSettings = inject(LocalSettingsService);
  private logger = inject(LoggerService);
  private relayPool = inject(RelayPoolService);
  private database = inject(DatabaseService);
  private trustProviderService = inject(TrustProviderService);
  private injector = inject(Injector);

  // In-memory cache for quick access
  private metricsCache = new Map<string, TrustMetrics>();

  // Cache for pending fetch promises to prevent duplicate concurrent requests
  private pendingFetches = new Map<string, Promise<TrustMetrics | null>>();

  // Track pubkeys that have no metrics (to avoid repeated relay queries)
  private notFoundCache = new Set<string>();

  // Signal for tracking loaded pubkeys
  private loadedPubkeys = signal<Set<string>>(new Set());

  /**
   * Check if trust features are enabled
   */
  readonly isEnabled = computed(() => this.localSettings.trustEnabled());

  /**
   * Get the configured trust relay URL
   */
  readonly trustRelayUrl = computed(() => this.localSettings.trustRelay());

  constructor() {
    this.logger.info('TrustService initialized');
  }

  /**
   * Fetch trust metrics for a specific pubkey
   * Returns cached data if available, otherwise fetches from relay and saves to database
   */
  async fetchMetrics(pubkey: string): Promise<TrustMetrics | null> {
    if (!this.isEnabled()) {
      return null;
    }

    // Check in-memory cache first
    if (this.metricsCache.has(pubkey)) {
      const cached = this.metricsCache.get(pubkey);
      if (cached) {
        // Check if data is older than 24 hours
        const age = Date.now() - (cached.lastUpdated || 0);
        const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
        if (age > TWENTY_FOUR_HOURS) {
          // Refresh in background but return cached data immediately
          this.refreshMetricsInBackground(pubkey);
        }
        return cached;
      }
    }

    // Check if there's already a pending fetch for this pubkey
    if (this.pendingFetches.has(pubkey)) {
      return this.pendingFetches.get(pubkey)!;
    }

    // Create a promise for this fetch
    const fetchPromise = this.fetchMetricsInternal(pubkey);
    this.pendingFetches.set(pubkey, fetchPromise);

    try {
      const result = await fetchPromise;
      return result;
    } finally {
      // Clean up the pending fetch
      this.pendingFetches.delete(pubkey);
    }
  }

  /**
   * Internal method to fetch metrics from database or relay
   */
  private async fetchMetricsInternal(pubkey: string): Promise<TrustMetrics | null> {
    // Check if we've already determined this pubkey has no metrics
    if (this.notFoundCache.has(pubkey)) {
      return null;
    }

    // Check database cache
    try {
      const cachedMetrics = await this.database.getTrustMetrics(pubkey);
      if (cachedMetrics) {
        // Cache in memory for quick access
        this.metricsCache.set(pubkey, cachedMetrics);
        this.loadedPubkeys.update(set => new Set(set).add(pubkey));

        // Check if data is older than 24 hours
        const age = Date.now() - (cachedMetrics.lastUpdated || 0);
        const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
        if (age > TWENTY_FOUR_HOURS) {
          this.refreshMetricsInBackground(pubkey);
        }

        return cachedMetrics;
      }
    } catch (error) {
      this.logger.error(`Failed to load trust metrics from database for ${pubkey}`, error);
    }

    // Fetch from relay if not in cache
    return this.fetchMetricsFromRelay(pubkey);
  }

  /**
   * Resolve relay URLs for fetching kind 30382 assertions.
   * Uses kind 10040 provider declarations if available, falls back to local setting.
   */
  private resolveRelayUrls(): string[] {
    // Check if user has kind 10040 providers configured for kind 30382
    if (this.trustProviderService.loaded()) {
      const providerRelays = this.trustProviderService.getRelayUrlsForKind(30382);
      if (providerRelays.length > 0) {
        return providerRelays;
      }
    }

    // Fall back to the local trust relay setting
    return [this.trustRelayUrl()];
  }

  /**
   * Fetch metrics from relay and save to database.
   * Resolves relay URLs from kind 10040 providers, falling back to local setting.
   */
  private async fetchMetricsFromRelay(pubkey: string): Promise<TrustMetrics | null> {
    try {
      const relayUrls = this.resolveRelayUrls();
      this.logger.debug(`Fetching trust metrics for ${pubkey} from ${relayUrls.join(', ')}`);

      // Create filter for kind 30382 events with d tag matching pubkey
      const filter: Filter = {
        kinds: [30382],
        '#d': [pubkey],
        limit: 1,
      };

      // Fetch events from all configured trust relays
      const events = await this.relayPool.query(relayUrls, filter);

      if (events.length === 0) {
        // Cache this as 'not found' to avoid repeated queries
        this.notFoundCache.add(pubkey);
        return null;
      }

      // Parse the most recent event
      const event = events[0];
      const metrics = this.parseMetrics(event);

      // Save to database
      await this.database.saveTrustMetrics(pubkey, metrics);

      // Cache in memory
      this.metricsCache.set(pubkey, metrics);
      this.loadedPubkeys.update(set => new Set(set).add(pubkey));

      // Notify FollowingService to update its cache (lazy inject to avoid circular dependency)
      this.notifyFollowingService(pubkey, metrics);

      this.logger.debug(`Trust metrics loaded from relay for ${pubkey}:`, metrics);
      return metrics;
    } catch (error) {
      this.logger.error(`Failed to fetch trust metrics from relay for ${pubkey}`, error);
      return null;
    }
  }

  /**
   * Get cached metrics synchronously (returns null if not in cache)
   * Use this when you want to avoid async operations if data isn't immediately available
   */
  getCachedMetrics(pubkey: string): TrustMetrics | null {
    if (!this.isEnabled()) {
      return null;
    }

    return this.metricsCache.get(pubkey) || null;
  }

  /**
   * Batch fetch trust metrics for multiple pubkeys
   * More efficient than calling fetchMetrics multiple times
   */
  async fetchMetricsBatch(pubkeys: string[]): Promise<Map<string, TrustMetrics | null>> {
    const results = new Map<string, TrustMetrics | null>();

    // Fetch all metrics in parallel
    await Promise.all(
      pubkeys.map(async (pubkey) => {
        try {
          const metrics = await this.fetchMetrics(pubkey);
          results.set(pubkey, metrics);
        } catch (error) {
          this.logger.error(`Failed to fetch metrics for ${pubkey}`, error);
          results.set(pubkey, null);
        }
      })
    );

    return results;
  }

  /**
   * Refresh metrics in background without blocking
   */
  private refreshMetricsInBackground(pubkey: string): void {
    queueMicrotask(async () => {
      try {
        await this.fetchMetricsFromRelay(pubkey);
        this.logger.debug(`Background refresh completed for ${pubkey}`);
      } catch (error) {
        this.logger.error(`Background refresh failed for ${pubkey}`, error);
      }
    });
  }

  /**
   * Notify FollowingService about trust metrics update
   * Uses lazy injection to avoid circular dependency
   */
  private notifyFollowingService(pubkey: string, metrics: TrustMetrics): void {
    // Use dynamic import pattern to avoid circular dependency
    runInInjectionContext(this.injector, () => {
      import('./following.service').then(({ FollowingService }) => {
        const followingService = this.injector.get(FollowingService);
        followingService.updateTrustMetrics(pubkey, metrics);
      });
    });
  }

  /**
   * Parse NIP-85 event tags into metrics object
   */
  private parseMetrics(event: NostrEvent): TrustMetrics {
    const metrics: TrustMetrics = {};

    for (const tag of event.tags) {
      const [tagName, value] = tag;

      // Skip the 'd' tag (pubkey identifier)
      if (tagName === 'd') {
        continue;
      }

      const numValue = parseFloat(value);

      switch (tagName) {
        case 'rank':
          metrics.rank = parseInt(value, 10);
          break;
        case 'followers':
          metrics.followers = parseInt(value, 10);
          break;
        case 'post_cnt':
          metrics.postCount = parseInt(value, 10);
          break;
        case 'zap_amt_recd':
          metrics.zapAmtRecd = parseInt(value, 10);
          break;
        case 'zap_amt_sent':
          metrics.zapAmtSent = parseInt(value, 10);
          break;
        case 'first_created_at':
          metrics.firstCreatedAt = parseInt(value, 10);
          break;
        case 'reply_cnt':
          metrics.replyCount = parseInt(value, 10);
          break;
        case 'reactions_cnt':
          metrics.reactionsCount = parseInt(value, 10);
          break;
        case 'zap_cnt_recd':
          metrics.zapCntRecd = parseInt(value, 10);
          break;
        case 'zap_cnt_sent':
          metrics.zapCntSent = parseInt(value, 10);
          break;
        case 'hops':
          metrics.hops = parseInt(value, 10);
          break;
        case 'personalizedGrapeRank_influence':
          metrics.personalizedGrapeRank_influence = numValue;
          break;
        case 'personalizedGrapeRank_average':
          metrics.personalizedGrapeRank_average = numValue;
          break;
        case 'personalizedGrapeRank_confidence':
          metrics.personalizedGrapeRank_confidence = numValue;
          break;
        case 'personalizedGrapeRank_input':
          metrics.personalizedGrapeRank_input = numValue;
          break;
        case 'personalizedPageRank':
          metrics.personalizedPageRank = numValue;
          break;
        case 'verifiedFollowerCount':
          metrics.verifiedFollowerCount = parseInt(value, 10);
          break;
        case 'verifiedMuterCount':
          metrics.verifiedMuterCount = parseInt(value, 10);
          break;
        case 'verifiedReporterCount':
          metrics.verifiedReporterCount = parseInt(value, 10);
          break;
      }
    }

    return metrics;
  }

  /**
   * Check if metrics are loaded for a pubkey
   */
  hasMetrics(pubkey: string): boolean {
    return this.metricsCache.has(pubkey);
  }

  /**
   * Clear cached metrics (both in-memory and database)
   */
  async clearCache(): Promise<void> {
    this.metricsCache.clear();
    this.loadedPubkeys.set(new Set());
    // Note: Database entries are kept for persistence
    // If you want to clear database too, call storage.deleteInfoByType('trust')
    this.logger.debug('Trust metrics in-memory cache cleared');
  }

  /**
   * Get pubkeys sorted by trust rank
   * @param minRank Optional minimum rank filter (e.g., 95 for high-trust only)
   * @param maxRank Optional maximum rank filter
   */
  async getPubkeysByTrustRank(minRank?: number, maxRank?: number): Promise<string[]> {
    return this.database.getPubkeysByTrustRank(minRank, maxRank);
  }

  /**
   * Get rank signal for a specific pubkey
   */
  getRankSignal(pubkey: string): number | undefined {
    return this.metricsCache.get(pubkey)?.rank;
  }
}
