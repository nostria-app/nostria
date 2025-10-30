import { Injectable, inject, signal, computed } from '@angular/core';
import { LocalSettingsService } from './local-settings.service';
import { LoggerService } from './logger.service';
import { RelayPoolService } from './relays/relay-pool';
import type { Event as NostrEvent, Filter } from 'nostr-tools';

interface TrustMetrics {
  rank?: number;
  followers?: number;
  postCount?: number;
  zapAmtRecd?: number;
  zapAmtSent?: number;
  firstCreatedAt?: number;
  replyCount?: number;
  reactionsCount?: number;
  zapCntRecd?: number;
  zapCntSent?: number;
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

  // Cache of trust metrics by pubkey
  private metricsCache = new Map<string, TrustMetrics>();

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
   * Returns cached data if available
   */
  async fetchMetrics(pubkey: string): Promise<TrustMetrics | null> {
    if (!this.isEnabled()) {
      return null;
    }

    // Return cached data if available
    if (this.metricsCache.has(pubkey)) {
      return this.metricsCache.get(pubkey) || null;
    }

    try {
      const relay = this.trustRelayUrl();
      this.logger.debug(`Fetching trust metrics for ${pubkey} from ${relay}`);

      // Create filter for kind 30382 events with d tag matching pubkey
      const filter: Filter = {
        kinds: [30382],
        '#d': [pubkey],
        limit: 1,
      };

      // Fetch events from the trust relay
      const events = await this.relayPool.query([relay], filter);

      if (events.length === 0) {
        this.logger.debug(`No trust metrics found for ${pubkey}`);
        return null;
      }

      // Parse the most recent event
      const event = events[0];
      const metrics = this.parseMetrics(event);

      // Cache the metrics
      this.metricsCache.set(pubkey, metrics);
      this.loadedPubkeys.update(set => new Set(set).add(pubkey));

      this.logger.debug(`Trust metrics loaded for ${pubkey}:`, metrics);
      return metrics;
    } catch (error) {
      this.logger.error(`Failed to fetch trust metrics for ${pubkey}`, error);
      return null;
    }
  }

  /**
   * Parse NIP-85 event tags into metrics object
   */
  private parseMetrics(event: NostrEvent): TrustMetrics {
    const metrics: TrustMetrics = {};

    for (const tag of event.tags) {
      const [tagName, value] = tag;
      const numValue = parseInt(value, 10);

      switch (tagName) {
        case 'rank':
          metrics.rank = numValue;
          break;
        case 'followers':
          metrics.followers = numValue;
          break;
        case 'post_cnt':
          metrics.postCount = numValue;
          break;
        case 'zap_amt_recd':
          metrics.zapAmtRecd = numValue;
          break;
        case 'zap_amt_sent':
          metrics.zapAmtSent = numValue;
          break;
        case 'first_created_at':
          metrics.firstCreatedAt = numValue;
          break;
        case 'reply_cnt':
          metrics.replyCount = numValue;
          break;
        case 'reactions_cnt':
          metrics.reactionsCount = numValue;
          break;
        case 'zap_cnt_recd':
          metrics.zapCntRecd = numValue;
          break;
        case 'zap_cnt_sent':
          metrics.zapCntSent = numValue;
          break;
      }
    }

    return metrics;
  }

  /**
   * Get cached metrics for a pubkey (synchronous)
   */
  getCachedMetrics(pubkey: string): TrustMetrics | null {
    return this.metricsCache.get(pubkey) || null;
  }

  /**
   * Check if metrics are loaded for a pubkey
   */
  hasMetrics(pubkey: string): boolean {
    return this.metricsCache.has(pubkey);
  }

  /**
   * Clear cached metrics
   */
  clearCache(): void {
    this.metricsCache.clear();
    this.loadedPubkeys.set(new Set());
    this.logger.debug('Trust metrics cache cleared');
  }

  /**
   * Get rank signal for a specific pubkey
   */
  getRankSignal(pubkey: string): number | undefined {
    return this.metricsCache.get(pubkey)?.rank;
  }
}
