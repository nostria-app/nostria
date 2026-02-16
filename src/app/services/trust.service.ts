import { Injectable, inject, signal, computed, Injector, runInInjectionContext } from '@angular/core';
import { LocalSettingsService } from './local-settings.service';
import { LoggerService } from './logger.service';
import { RelayPoolService } from './relays/relay-pool';
import { DatabaseService, TrustMetrics } from './database.service';
import { TrustProviderService } from './trust-provider.service';
import type { Event as NostrEvent, Filter } from 'nostr-tools';

/** Pending relay fetch request waiting in the queue */
interface QueuedFetchRequest {
  pubkey: string;
  resolve: (value: TrustMetrics | null) => void;
  reject: (error: unknown) => void;
}

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

  // --- Aggregated relay fetch queue ---
  /** Max pubkeys per single relay query */
  private readonly QUEUE_BATCH_SIZE = 50;
  /** Time window (ms) to collect requests before flushing */
  private readonly QUEUE_FLUSH_DELAY = 100;
  /** Pending requests waiting to be batched */
  private fetchQueue: QueuedFetchRequest[] = [];
  /** Timer handle for the debounced flush */
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

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
   * @param forceRefresh If true, bypasses all caches and fetches directly from the relay
   */
  async fetchMetrics(pubkey: string, forceRefresh = false): Promise<TrustMetrics | null> {
    if (!this.isEnabled()) {
      return null;
    }

    // When force refreshing, clear caches for this pubkey and go directly to relay
    if (forceRefresh) {
      this.metricsCache.delete(pubkey);
      this.notFoundCache.delete(pubkey);
      return this.fetchMetricsFromRelay(pubkey);
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
   * Resolve relay URLs and author pubkeys for fetching kind 30382 assertions.
   * Uses kind 10040 provider declarations if available, falls back to local setting.
   * When providers are configured, returns their pubkeys as authors so queries
   * only return events from trusted providers.
   */
  private resolveProviderConfig(): { relayUrls: string[]; authors: string[] } {
    // Check if user has kind 10040 providers configured for kind 30382
    if (this.trustProviderService.loaded()) {
      const config = this.trustProviderService.getProviderConfigForKind(30382);
      if (config.relayUrls.length > 0) {
        return config;
      }
    }

    // Fall back to the local trust relay setting (no author filter)
    return { relayUrls: [this.trustRelayUrl()], authors: [] };
  }

  /**
   * Fetch metrics from relay and save to database.
   * Enqueues the request into an aggregated batch queue so multiple pubkeys
   * are fetched in a single relay subscription, avoiding "too many concurrent REQs".
   */
  private fetchMetricsFromRelay(pubkey: string): Promise<TrustMetrics | null> {
    return new Promise<TrustMetrics | null>((resolve, reject) => {
      this.fetchQueue.push({ pubkey, resolve, reject });
      this.scheduleFlush();
    });
  }

  /**
   * Schedule a queue flush after a short debounce window.
   * If the queue reaches QUEUE_BATCH_SIZE it flushes immediately.
   */
  private scheduleFlush(): void {
    // Flush immediately when the batch is full
    if (this.fetchQueue.length >= this.QUEUE_BATCH_SIZE) {
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      this.flushQueue();
      return;
    }

    // Otherwise wait for more requests to accumulate
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flushQueue();
      }, this.QUEUE_FLUSH_DELAY);
    }
  }

  /**
   * Drain the queue and process pubkeys in batches of QUEUE_BATCH_SIZE.
   * Each batch becomes a single relay query with multiple '#d' values.
   */
  private flushQueue(): void {
    if (this.fetchQueue.length === 0) return;

    // Take all pending items
    const items = this.fetchQueue.splice(0);

    // Split into batches
    for (let i = 0; i < items.length; i += this.QUEUE_BATCH_SIZE) {
      const batch = items.slice(i, i + this.QUEUE_BATCH_SIZE);
      this.processBatchFromRelay(batch);
    }
  }

  /**
   * Execute a single aggregated relay query for a batch of pubkeys.
   * Resolves/rejects each individual request promise with its result.
   */
  private async processBatchFromRelay(batch: QueuedFetchRequest[]): Promise<void> {
    const pubkeys = batch.map(r => r.pubkey);

    try {
      const { relayUrls, authors } = this.resolveProviderConfig();
      this.logger.debug(
        `Fetching trust metrics for ${pubkeys.length} pubkeys from ${relayUrls.join(', ')}`,
        { authors: authors.length > 0 ? authors : 'any' }
      );

      const filter: Filter = {
        kinds: [30382],
        '#d': pubkeys,
      };

      if (authors.length > 0) {
        filter.authors = authors;
      }

      const events = await this.relayPool.query(relayUrls, filter, 10_000);

      // Index events by their 'd' tag (the target pubkey)
      const eventByPubkey = new Map<string, NostrEvent>();
      for (const event of events) {
        const dTag = event.tags.find(t => t[0] === 'd')?.[1];
        if (dTag) {
          // Keep the most recent event per pubkey
          const existing = eventByPubkey.get(dTag);
          if (!existing || event.created_at > existing.created_at) {
            eventByPubkey.set(dTag, event);
          }
        }
      }

      // Resolve each queued request
      for (const req of batch) {
        try {
          const event = eventByPubkey.get(req.pubkey);
          if (!event) {
            this.notFoundCache.add(req.pubkey);
            req.resolve(null);
            continue;
          }

          const metrics = this.parseMetrics(event);

          // Save to database
          await this.database.saveTrustMetrics(req.pubkey, metrics);

          // Cache in memory
          this.metricsCache.set(req.pubkey, metrics);
          this.loadedPubkeys.update(set => new Set(set).add(req.pubkey));

          // Notify FollowingService
          this.notifyFollowingService(req.pubkey, metrics);

          this.logger.debug(`Trust metrics loaded (batch) for ${req.pubkey}:`, metrics);
          req.resolve(metrics);
        } catch (err) {
          this.logger.error(`Failed to process trust metrics for ${req.pubkey}`, err);
          req.resolve(null);
        }
      }
    } catch (error) {
      this.logger.error(`Batch trust metrics relay query failed`, error);
      // Reject all requests in this batch
      for (const req of batch) {
        req.resolve(null);
      }
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
   * Uses the aggregated queue so all pubkeys are fetched in minimal relay queries.
   * @param forceRefresh If true, bypasses all caches and fetches directly from the relay
   */
  async fetchMetricsBatch(pubkeys: string[], forceRefresh = false): Promise<Map<string, TrustMetrics | null>> {
    const results = new Map<string, TrustMetrics | null>();

    if (forceRefresh) {
      // Clear caches for all requested pubkeys
      for (const pubkey of pubkeys) {
        this.metricsCache.delete(pubkey);
        this.notFoundCache.delete(pubkey);
      }
    }

    // Separate cached from uncached
    const toFetch: string[] = [];
    for (const pubkey of pubkeys) {
      if (!forceRefresh && this.metricsCache.has(pubkey)) {
        results.set(pubkey, this.metricsCache.get(pubkey)!);
      } else if (!forceRefresh && this.notFoundCache.has(pubkey)) {
        results.set(pubkey, null);
      } else {
        toFetch.push(pubkey);
      }
    }

    if (toFetch.length === 0) return results;

    // Check database for uncached pubkeys first
    const stillNeedRelay: string[] = [];
    if (!forceRefresh) {
      for (const pubkey of toFetch) {
        try {
          const cached = await this.database.getTrustMetrics(pubkey);
          if (cached) {
            this.metricsCache.set(pubkey, cached);
            this.loadedPubkeys.update(set => new Set(set).add(pubkey));
            results.set(pubkey, cached);
            continue;
          }
        } catch { /* fall through to relay */ }
        stillNeedRelay.push(pubkey);
      }
    } else {
      stillNeedRelay.push(...toFetch);
    }

    if (stillNeedRelay.length === 0) return results;

    // Enqueue all remaining pubkeys — the queue aggregates them into batched relay queries
    await Promise.all(
      stillNeedRelay.map(async (pubkey) => {
        try {
          const metrics = await this.fetchMetricsFromRelay(pubkey);
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
    const metrics: TrustMetrics = {
      authorPubkey: event.pubkey,
      extraMetrics: {},
    };

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
        default:
          if (Number.isFinite(numValue)) {
            metrics.extraMetrics![tagName] = numValue;
          }
          break;
      }
    }

    if (metrics.extraMetrics && Object.keys(metrics.extraMetrics).length === 0) {
      delete metrics.extraMetrics;
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
