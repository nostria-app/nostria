import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LoggerService } from './logger.service';

export interface RelayInstanceInfo {
  id: string;
  className: string;
  relayUrls: string[];
  createdAt: number;
  destroyedAt?: number;
}

export interface SubscriptionInfo {
  id: string;
  instanceId: string;
  filters: unknown[];
  relayUrls: string[];
  createdAt: number;
  closedAt?: number;
}

export interface RelayDebugStats {
  instances: {
    total: number;
    active: number;
    destroyed: number;
    byClass: Record<string, { total: number; active: number; destroyed: number }>;
  };
  subscriptions: {
    total: number;
    active: number;
    closed: number;
  };
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

  // Subscription tracking
  private subscriptions = new Map<string, SubscriptionInfo>();
  private subscriptionCounter = 0;

  // Statistics interval
  private statsInterval?: NodeJS.Timeout;
  private readonly STATS_INTERVAL_MS = 10000; // 10 seconds

  constructor() {
    if (this.isBrowser()) {
      this.startStatsLogging();
    }
  }

  /**
   * Register a new relay instance
   */
  registerInstance(className: string, relayUrls: string[]): string {
    const instanceId = `${className}-${++this.instanceCounter}`;
    const info: RelayInstanceInfo = {
      id: instanceId,
      className,
      relayUrls: [...relayUrls],
      createdAt: Date.now(),
    };

    this.instances.set(instanceId, info);
    this.logger.debug(
      `[DebugLogger] Registered relay instance: ${instanceId} with URLs:`,
      relayUrls,
    );

    return instanceId;
  }

  /**
   * Update relay URLs for an existing instance
   */
  updateInstanceRelayUrls(instanceId: string, relayUrls: string[]): void {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.relayUrls = [...relayUrls];
      this.logger.debug(`[DebugLogger] Updated relay URLs for instance: ${instanceId}`, relayUrls);
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
    }
  }

  /**
   * Register a new subscription
   */
  registerSubscription(instanceId: string, filters: unknown[], relayUrls: string[]): string {
    const subscriptionId = `sub-${++this.subscriptionCounter}`;
    const info: SubscriptionInfo = {
      id: subscriptionId,
      instanceId,
      filters: JSON.parse(JSON.stringify(filters)), // Deep copy
      relayUrls: [...relayUrls],
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
