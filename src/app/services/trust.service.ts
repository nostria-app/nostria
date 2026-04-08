import { Injectable, inject, signal, computed, Injector, runInInjectionContext, effect } from '@angular/core';
import { LocalSettingsService } from './local-settings.service';
import { LoggerService } from './logger.service';
import { RelayPoolService } from './relays/relay-pool';
import { DatabaseService, TrustMetrics } from './database.service';
import { TrustProviderService } from './trust-provider.service';
import { RelayAuthService } from './relays/relay-auth.service';
import { AccountStateService } from './account-state.service';
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
  private relayAuth = inject(RelayAuthService);
  private accountState = inject(AccountStateService);
  private injector = inject(Injector);

  // In-memory cache for quick access
  private metricsCache = new Map<string, TrustMetrics>();

  // Cache for pending fetch promises to prevent duplicate concurrent requests
  private pendingFetches = new Map<string, Promise<TrustMetrics | null>>();

  // Track pubkeys that have no metrics (to avoid repeated relay queries)
  // Entries have a timestamp and expire after NOT_FOUND_TTL_MS to allow retries
  // when relay connectivity was temporarily unavailable.
  private notFoundCache = new Map<string, number>();

  /** How long a "not found" entry stays valid before retrying the relay */
  private readonly NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  /** How long cached metrics are considered fresh before background refresh */
  private readonly METRICS_REFRESH_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  /** Track the current account so personalized in-memory trust state never crosses accounts */
  private currentAccountPubkey: string | null = null;

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

    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey === this.currentAccountPubkey) {
        return;
      }

      this.currentAccountPubkey = pubkey;
      this.metricsCache.clear();
      this.pendingFetches.clear();
      this.notFoundCache.clear();
      this.loadedPubkeys.set(new Set());
    });
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
      this.database.deleteInfoByKeyAndType(pubkey, 'trust-notfound').catch(() => { });
      return this.fetchMetricsFromRelay(pubkey);
    }

    // Check in-memory cache first
    if (this.metricsCache.has(pubkey)) {
      const cached = this.metricsCache.get(pubkey);
      if (cached) {
        if (!this.isMetricsCompatibleWithCurrentProviders(cached)) {
          this.metricsCache.delete(pubkey);
        } else {
          const age = Date.now() - (cached.lastUpdated || 0);
          if (age > this.METRICS_REFRESH_MS) {
            // Refresh in background but return cached data immediately
            this.refreshMetricsInBackground(pubkey);
          }
          return cached;
        }
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
    // Check if we've already determined this pubkey has no metrics (with TTL)
    if (this.isInNotFoundCache(pubkey)) {
      return null;
    }

    // Check database for persisted not-found record
    try {
      const notFoundRecord = await this.database.getInfo(pubkey, 'trust-notfound');
      if (notFoundRecord) {
        const checkedAt = notFoundRecord['lastChecked'] as number;
        if (checkedAt && (Date.now() - checkedAt) < this.NOT_FOUND_TTL_MS) {
          this.notFoundCache.set(pubkey, checkedAt);
          return null;
        }
      }
    } catch { /* fall through */ }

    // Check database cache
    try {
      const cachedMetrics = await this.database.getTrustMetrics(pubkey);
      if (cachedMetrics) {
        if (!this.isMetricsCompatibleWithCurrentProviders(cachedMetrics)) {
          this.logger.debug(`Ignoring stale trust metrics from previous provider for ${pubkey}`, {
            authorPubkey: cachedMetrics.authorPubkey,
          });
        } else {
          // Cache in memory for quick access
          this.metricsCache.set(pubkey, cachedMetrics);
          this.loadedPubkeys.update(set => new Set(set).add(pubkey));

          const age = Date.now() - (cachedMetrics.lastUpdated || 0);
          if (age > this.METRICS_REFRESH_MS) {
            this.refreshMetricsInBackground(pubkey);
          }

          return cachedMetrics;
        }
      }
    } catch (error) {
      this.logger.error(`Failed to load trust metrics from database for ${pubkey}`, error);
    }

    // Fetch from relay if not in cache
    return this.fetchMetricsFromRelay(pubkey);
  }

  /**
   * Resolve relay URLs and author pubkeys for fetching kind 30382 assertions.
   * Uses kind 10040 provider declarations for the active account.
   * If no provider is configured yet, trust metrics are unavailable.
   */
  private resolveProviderConfig(): { relayUrls: string[]; authors: string[] } {
    if (!this.trustProviderService.loaded()) {
      return { relayUrls: [], authors: [] };
    }

    const config = this.trustProviderService.getProviderConfigForKind(30382);
    if (config.relayUrls.length > 0) {
      return config;
    }

    return { relayUrls: [], authors: [] };
  }

  /**
   * Fetch metrics from relay and save to database.
   * Enqueues the request into an aggregated batch queue so multiple pubkeys
   * are fetched in a single relay subscription, avoiding "too many concurrent REQs".
   */
  private fetchMetricsFromRelay(pubkey: string): Promise<TrustMetrics | null> {
    const { relayUrls } = this.resolveProviderConfig();
    if (relayUrls.length === 0) {
      return Promise.resolve(null);
    }

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

      // Trust relays are essential infrastructure — clear any auth-failures
      // that may have accumulated (e.g., transient WebSocket failures in WKWebView).
      for (const url of relayUrls) {
        if (this.relayAuth.hasAuthFailed(url)) {
          this.relayAuth.resetAuthFailure(url);
        }
      }

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

      if (events.length === 0) {
        this.logger.debug(
          `Trust relay returned 0 events for ${pubkeys.length} pubkeys from ${relayUrls.join(', ')}`
        );
      } else {
        this.logger.debug(
          `Trust relay returned ${events.length} events for ${pubkeys.length} pubkeys`
        );
      }

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
            const now = Date.now();
            this.notFoundCache.set(req.pubkey, now);
            // Persist to database so not-found survives page reloads
            this.database.saveInfo(req.pubkey, 'trust-notfound', { lastChecked: now }).catch(() => { });
            req.resolve(null);
            continue;
          }

          const metrics = this.parseMetrics(event);

          // Save to database and clear any stale not-found record
          await this.database.saveTrustMetrics(req.pubkey, metrics);
          this.notFoundCache.delete(req.pubkey);
          this.database.deleteInfoByKeyAndType(req.pubkey, 'trust-notfound').catch(() => { });

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
      this.logger.error(`Batch trust metrics relay query failed for ${pubkeys.length} pubkeys`, {
        error,
        relayUrls: this.resolveProviderConfig().relayUrls,
      });
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

    const { relayUrls } = this.resolveProviderConfig();
    if (relayUrls.length === 0) {
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
        this.database.deleteInfoByKeyAndType(pubkey, 'trust-notfound').catch(() => { });
      }
    }

    // Separate cached from uncached
    const toFetch: string[] = [];
    for (const pubkey of pubkeys) {
      if (!forceRefresh && this.metricsCache.has(pubkey)) {
        results.set(pubkey, this.metricsCache.get(pubkey)!);
      } else if (!forceRefresh && this.isInNotFoundCache(pubkey)) {
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
        // Check DB for persisted not-found record
        try {
          const notFoundRecord = await this.database.getInfo(pubkey, 'trust-notfound');
          if (notFoundRecord) {
            const checkedAt = notFoundRecord['lastChecked'] as number;
            if (checkedAt && (Date.now() - checkedAt) < this.NOT_FOUND_TTL_MS) {
              this.notFoundCache.set(pubkey, checkedAt);
              results.set(pubkey, null);
              continue;
            }
          }
        } catch { /* fall through */ }

        try {
          const cached = await this.database.getTrustMetrics(pubkey);
          if (cached && this.isMetricsCompatibleWithCurrentProviders(cached)) {
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
   * Force or warm-load trust metrics for a list of pubkeys in bounded chunks.
   * Reuses the same batch relay path as normal profile and hover-card lookups.
   */
  async preloadTrustRanks(
    pubkeys: string[],
    options?: {
      forceRefresh?: boolean;
      chunkSize?: number;
      onProgress?: (completed: number, total: number) => void;
      shouldAbort?: () => boolean;
    },
  ): Promise<void> {
    const uniquePubkeys = [...new Set(pubkeys.filter(Boolean))];
    if (uniquePubkeys.length === 0) {
      options?.onProgress?.(0, 0);
      return;
    }

    const total = uniquePubkeys.length;
    const forceRefresh = options?.forceRefresh ?? false;
    const chunkSize = Math.max(1, options?.chunkSize ?? this.QUEUE_BATCH_SIZE);
    let completed = 0;

    options?.onProgress?.(completed, total);

    for (let index = 0; index < total; index += chunkSize) {
      if (options?.shouldAbort?.()) {
        break;
      }

      const chunk = uniquePubkeys.slice(index, index + chunkSize);
      await this.fetchMetricsBatch(chunk, forceRefresh);
      completed += chunk.length;
      options?.onProgress?.(completed, total);
    }
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
   * Check if a pubkey is in the not-found cache and the entry hasn't expired.
   * Expired entries are automatically removed.
   */
  private isInNotFoundCache(pubkey: string): boolean {
    const timestamp = this.notFoundCache.get(pubkey);
    if (timestamp === undefined) {
      return false;
    }
    if (Date.now() - timestamp > this.NOT_FOUND_TTL_MS) {
      this.notFoundCache.delete(pubkey);
      return false;
    }
    return true;
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

  /**
   * Check if cached metrics were produced by one of the currently configured trust providers.
   * If no provider authors are configured, we accept any cached metrics.
   */
  private isMetricsCompatibleWithCurrentProviders(metrics: TrustMetrics): boolean {
    const { relayUrls, authors } = this.resolveProviderConfig();
    if (relayUrls.length === 0) {
      return false;
    }

    if (authors.length === 0) {
      return true;
    }

    if (!metrics.authorPubkey) {
      return false;
    }

    return authors.includes(metrics.authorPubkey);
  }
}
