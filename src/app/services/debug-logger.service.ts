import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LoggerService } from './logger.service';

export interface RelayInstanceInfo {
  id: string;
  className: string;
  relayUrls: string[];
  createdAt: number;
  destroyedAt?: number;
  instance?: object; // Reference to the actual instance for debugging
}

export interface UserDataInstanceInfo {
  id: string;
  pubkey: string;
  createdAt: number;
  destroyedAt?: number;
  instance?: object; // Reference to the actual instance for debugging
}

export interface SubscriptionInfo {
  id: string;
  instanceId: string;
  filters: unknown[];
  relayUrls: string[];
  createdAt: number;
  closedAt?: number;
}

export interface CacheStats {
  cacheHits: number;
  cacheMisses: number;
  deduplicationHits: number;
  cachedEntries: number;
  pendingSubscriptions: number;
  hitRate: number;
}

export interface RelayDebugStats {
  instances: {
    total: number;
    active: number;
    destroyed: number;
    byClass: Record<string, { total: number; active: number; destroyed: number }>;
  };
  userDataInstances: {
    total: number;
    active: number;
    destroyed: number;
  };
  subscriptions: {
    total: number;
    active: number;
    closed: number;
  };
  cache?: CacheStats;
  relayUrls: {
    url: string;
    instances: string[];
    activeSubscriptions: number;
  }[];
}

@Injectable({
  providedIn: 'root',
})
export class DebugLoggerService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly logger = inject(LoggerService);
  private readonly isBrowser = signal(isPlatformBrowser(this.platformId));

  // Instance tracking
  private instances = new Map<string, RelayInstanceInfo>();
  private instanceCounter = 0;

  // UserData instance tracking
  private userDataInstances = new Map<string, UserDataInstanceInfo>();
  private userDataInstanceCounter = 0;

  // Subscription tracking
  private subscriptions = new Map<string, SubscriptionInfo>();
  private subscriptionCounter = 0;

  // Cache statistics (optional)
  private cacheStats?: CacheStats;

  // Statistics interval
  private statsInterval?: NodeJS.Timeout;
  private readonly STATS_INTERVAL_MS = 10000; // 10 seconds

  constructor() {
    if (this.isBrowser()) {
      this.startStatsLogging();
    }
  }

  /**
   * Normalize relay URL to ensure consistent identification
   */
  private normalizeRelayUrl(url: string): string {
    try {
      // Remove trailing slashes and ensure consistent format
      return url.replace(/\/+$/, '').toLowerCase();
    } catch {
      // If URL parsing fails, just return the cleaned string
      return url.replace(/\/+$/, '').toLowerCase();
    }
  }

  /**
   * Normalize an array of relay URLs
   */
  private normalizeRelayUrls(urls: string[]): string[] {
    return urls.map((url) => this.normalizeRelayUrl(url));
  }

  /**
   * Update cache statistics (called by SubscriptionCacheService)
   */
  updateCacheStats(stats: CacheStats): void {
    this.cacheStats = stats;
  }

  /**
   * Register a new relay instance
   */
  registerInstance(className: string, relayUrls: string[], instance?: object): string {
    const instanceId = `${className}-${++this.instanceCounter}`;
    const normalizedUrls = this.normalizeRelayUrls(relayUrls);
    const info: RelayInstanceInfo = {
      id: instanceId,
      className,
      relayUrls: normalizedUrls,
      createdAt: Date.now(),
      instance,
    };

    this.instances.set(instanceId, info);
    this.logger.debug(
      `[DebugLogger] Registered relay instance: ${instanceId} with URLs:`,
      normalizedUrls,
    );

    // Make instance available in global scope for debugging
    if (this.isBrowser() && instance) {
      (globalThis as Record<string, unknown>)[`relayInstance_${instanceId}`] = instance;
      console.log(`[DebugLogger] Relay instance available as: globalThis.relayInstance_${instanceId}`, instance);
    }

    return instanceId;
  }

  /**
   * Update relay URLs for an existing instance
   */
  updateInstanceRelayUrls(instanceId: string, relayUrls: string[]): void {
    const instance = this.instances.get(instanceId);
    if (instance) {
      const normalizedUrls = this.normalizeRelayUrls(relayUrls);
      instance.relayUrls = normalizedUrls;
      this.logger.debug(
        `[DebugLogger] Updated relay URLs for instance: ${instanceId}`,
        normalizedUrls,
      );
    }
  }

  /**
   * Mark an instance as destroyed
   */
  destroyInstance(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (instance && !instance.destroyedAt) {
      instance.destroyedAt = Date.now();
      this.logger.debug(`[DebugLogger] Destroyed relay instance: ${instanceId}`);

      // Close any active subscriptions for this instance
      this.subscriptions.forEach((sub, subId) => {
        if (sub.instanceId === instanceId && !sub.closedAt) {
          this.closeSubscription(subId);
        }
      });

      // Clean up global reference
      if (this.isBrowser()) {
        delete (globalThis as Record<string, unknown>)[`relayInstance_${instanceId}`];
      }
    }
  }

  /**
   * Register a new UserDataService instance
   */
  registerUserDataInstance(pubkey: string, instance?: object): string {
    const instanceId = `UserData-${++this.userDataInstanceCounter}`;
    const info: UserDataInstanceInfo = {
      id: instanceId,
      pubkey,
      createdAt: Date.now(),
      instance,
    };

    this.userDataInstances.set(instanceId, info);
    this.logger.debug(`[DebugLogger] Registered UserDataService instance: ${instanceId} for pubkey: ${pubkey}`);

    // Make instance available in global scope for debugging
    if (this.isBrowser() && instance) {
      (globalThis as Record<string, unknown>)[`userDataInstance_${instanceId}`] = instance;
      console.log(`[DebugLogger] UserDataService instance available as: globalThis.userDataInstance_${instanceId}`, instance);
    }

    return instanceId;
  }

  /**
   * Mark a UserDataService instance as destroyed
   */
  destroyUserDataInstance(instanceId: string): void {
    const instance = this.userDataInstances.get(instanceId);
    if (instance && !instance.destroyedAt) {
      instance.destroyedAt = Date.now();
      this.logger.debug(`[DebugLogger] Destroyed UserDataService instance: ${instanceId} for pubkey: ${instance.pubkey}`);

      // Clean up global reference
      if (this.isBrowser()) {
        delete (globalThis as Record<string, unknown>)[`userDataInstance_${instanceId}`];
      }
    }
  }

  /**
   * Register a new subscription
   */
  registerSubscription(instanceId: string, filters: unknown[], relayUrls: string[]): string {
    const subscriptionId = `sub-${++this.subscriptionCounter}`;
    const normalizedUrls = this.normalizeRelayUrls(relayUrls);
    const info: SubscriptionInfo = {
      id: subscriptionId,
      instanceId,
      filters: JSON.parse(JSON.stringify(filters)), // Deep copy
      relayUrls: normalizedUrls,
      createdAt: Date.now(),
    };

    this.subscriptions.set(subscriptionId, info);
    this.logger.debug(
      `[DebugLogger] Registered subscription: ${subscriptionId} for instance: ${instanceId}`,
    );

    return subscriptionId;
  }

  /**
   * Mark a subscription as closed
   */
  closeSubscription(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription && !subscription.closedAt) {
      subscription.closedAt = Date.now();
      this.logger.debug(`[DebugLogger] Closed subscription: ${subscriptionId}`);
    }
  }

  /**
   * Get current debug statistics
   */
  getStats(): RelayDebugStats {
    const stats: RelayDebugStats = {
      instances: {
        total: this.instances.size,
        active: 0,
        destroyed: 0,
        byClass: {},
      },
      userDataInstances: {
        total: this.userDataInstances.size,
        active: 0,
        destroyed: 0,
      },
      subscriptions: {
        total: this.subscriptions.size,
        active: 0,
        closed: 0,
      },
      relayUrls: [],
    };

    // Process instances
    this.instances.forEach((instance) => {
      const isActive = !instance.destroyedAt;

      if (isActive) {
        stats.instances.active++;
      } else {
        stats.instances.destroyed++;
      }

      // Track by class
      if (!stats.instances.byClass[instance.className]) {
        stats.instances.byClass[instance.className] = {
          total: 0,
          active: 0,
          destroyed: 0,
        };
      }

      stats.instances.byClass[instance.className].total++;
      if (isActive) {
        stats.instances.byClass[instance.className].active++;
      } else {
        stats.instances.byClass[instance.className].destroyed++;
      }
    });

    // Process UserDataService instances
    this.userDataInstances.forEach((instance) => {
      const isActive = !instance.destroyedAt;

      if (isActive) {
        stats.userDataInstances.active++;
      } else {
        stats.userDataInstances.destroyed++;
      }
    });

    // Process subscriptions
    this.subscriptions.forEach((subscription) => {
      if (!subscription.closedAt) {
        stats.subscriptions.active++;
      } else {
        stats.subscriptions.closed++;
      }
    });

    // Process relay URLs
    const relayUrlMap = new Map<string, { instances: string[]; activeSubscriptions: number }>();

    this.instances.forEach((instance) => {
      // Only active instances
      if (!instance.destroyedAt) {
        instance.relayUrls.forEach((url) => {
          if (!relayUrlMap.has(url)) {
            relayUrlMap.set(url, { instances: [], activeSubscriptions: 0 });
          }
          relayUrlMap.get(url)!.instances.push(instance.id);
        });
      }
    });

    this.subscriptions.forEach((subscription) => {
      // Only active subscriptions
      if (!subscription.closedAt) {
        subscription.relayUrls.forEach((url) => {
          if (relayUrlMap.has(url)) {
            relayUrlMap.get(url)!.activeSubscriptions++;
          }
        });
      }
    });

    stats.relayUrls = Array.from(relayUrlMap.entries()).map(([url, info]) => ({
      url,
      instances: info.instances,
      activeSubscriptions: info.activeSubscriptions,
    }));

    // Include cache statistics if available
    if (this.cacheStats) {
      stats.cache = { ...this.cacheStats };
    }

    return stats;
  }

  /**
   * Start periodic statistics logging
   */
  private startStatsLogging(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }

    this.statsInterval = setInterval(() => {
      this.logStats();
    }, this.STATS_INTERVAL_MS);

    this.logger.debug('[DebugLogger] Started periodic statistics logging');
  }

  /**
   * Stop periodic statistics logging
   */
  stopStatsLogging(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = undefined;
      this.logger.debug('[DebugLogger] Stopped periodic statistics logging');
    }
  }

  /**
   * Log current statistics as a formatted table
   */
  logStats(): void {
    const stats = this.getStats();

    this.logger.info('[DebugLogger] === Relay Debug Statistics ===');

    // Log instances table
    console.table({
      'Total Instances': stats.instances.total,
      'Active Instances': stats.instances.active,
      'Destroyed Instances': stats.instances.destroyed,
    });

    // Log instances by class
    if (Object.keys(stats.instances.byClass).length > 0) {
      this.logger.info('[DebugLogger] Instances by Class:');
      console.table(stats.instances.byClass);
    }

    // Log subscriptions table
    console.table({
      'Total Subscriptions': stats.subscriptions.total,
      'Active Subscriptions': stats.subscriptions.active,
      'Closed Subscriptions': stats.subscriptions.closed,
    });

    // Log cache statistics if available
    if (stats.cache) {
      this.logger.info('[DebugLogger] Subscription Cache Stats:');
      console.table({
        'Cache Hits': stats.cache.cacheHits,
        'Cache Misses': stats.cache.cacheMisses,
        'Deduplication Hits': stats.cache.deduplicationHits,
        'Hit Rate %': stats.cache.hitRate.toFixed(2),
        'Cached Entries': stats.cache.cachedEntries,
        'Pending Subscriptions': stats.cache.pendingSubscriptions,
      });
    }

    // Log relay URLs table
    if (stats.relayUrls.length > 0) {
      this.logger.info('[DebugLogger] Relay URLs:');
      const relayTable = stats.relayUrls.reduce(
        (acc, relay) => {
          acc[relay.url] = {
            'Instance Count': relay.instances.length,
            'Active Subscriptions': relay.activeSubscriptions,
            'Instance IDs': relay.instances.join(', '),
          };
          return acc;
        },
        {} as Record<string, unknown>,
      );
      console.table(relayTable);
    }

    this.logger.info('[DebugLogger] ================================');
  }

  /**
   * Clean up old destroyed instances and closed subscriptions
   */
  // Default 5 minutes
  cleanup(maxAgeMs = 300000): void {
    const now = Date.now();
    let cleanedInstances = 0;
    let cleanedSubscriptions = 0;

    // Clean up old destroyed instances
    this.instances.forEach((instance, id) => {
      if (instance.destroyedAt && now - instance.destroyedAt > maxAgeMs) {
        this.instances.delete(id);
        cleanedInstances++;
      }
    });

    // Clean up old closed subscriptions
    this.subscriptions.forEach((subscription, id) => {
      if (subscription.closedAt && now - subscription.closedAt > maxAgeMs) {
        this.subscriptions.delete(id);
        cleanedSubscriptions++;
      }
    });

    if (cleanedInstances > 0 || cleanedSubscriptions > 0) {
      this.logger.debug(
        `[DebugLogger] Cleaned up ${cleanedInstances} instances and ${cleanedSubscriptions} subscriptions`,
      );
    }
  }

  /**
   * Get detailed information about a specific instance
   */
  getInstanceInfo(instanceId: string): RelayInstanceInfo | undefined {
    return this.instances.get(instanceId);
  }

  /**
   * Get all active subscriptions for an instance
   */
  getInstanceSubscriptions(instanceId: string): SubscriptionInfo[] {
    return Array.from(this.subscriptions.values()).filter(
      (sub) => sub.instanceId === instanceId && !sub.closedAt,
    );
  }
}
