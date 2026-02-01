import { Injectable, inject, signal } from '@angular/core';
import { LoggerService } from '../logger.service';
import type { Filter } from 'nostr-tools';

export interface SubscriptionInfo {
  id: string;
  filter: Filter;
  relayUrls: string[];
  createdAt: number;
  source: string; // Which service/component created this subscription
  active: boolean;
}

export interface ConnectionInfo {
  url: string;
  isConnected: boolean;
  activeSubscriptions: number;
  pendingRequests: number;
  lastActivity: number;
  poolInstance: string; // Identifier for which pool instance this belongs to
}

export interface RelayMetrics {
  totalSubscriptions: number;
  totalPendingRequests: number;
  totalConnections: number;
  subscriptionsBySource: Map<string, number>;
  connectionsByRelay: Map<string, ConnectionInfo>;
  subscriptions: SubscriptionInfo[];
  poolInstances: Set<string>;
}

/**
 * Centralized service to track and manage all relay subscriptions and connections
 * across the application. This helps prevent "too many concurrent REQs" errors
 * and provides detailed metrics for debugging relay usage.
 */
@Injectable({
  providedIn: 'root',
})
export class SubscriptionManagerService {
  private logger = inject(LoggerService);

  // Track all active subscriptions
  private subscriptions = new Map<string, SubscriptionInfo>();

  // Track connections per relay
  private connections = new Map<string, ConnectionInfo>();

  // Track pool instances
  private poolInstances = new Set<string>();

  // Global limits
  readonly MAX_CONCURRENT_SUBS_PER_RELAY = 10;
  readonly MAX_TOTAL_SUBSCRIPTIONS = 50;

  // Signals for reactive updates
  readonly metricsSignal = signal<RelayMetrics>(this.computeMetrics());

  // Throttling for connection status updates
  private readonly CONNECTION_STATUS_THROTTLE_MS = 1000; // 1 second
  private lastConnectionUpdate = new Map<string, number>();
  private pendingConnectionUpdates = new Map<string, NodeJS.Timeout>();

  /**
   * Result of attempting to register a subscription
   */
  /**
   * Register a new subscription
   * Returns the list of relays that can accept the subscription, or empty array if none can
   */
  registerSubscription(
    subscriptionId: string,
    filter: Filter,
    relayUrls: string[],
    source: string,
    poolInstance: string
  ): string[] {
    // Check if we're at the global limit
    if (this.subscriptions.size >= this.MAX_TOTAL_SUBSCRIPTIONS) {
      this.logger.warn(
        `[SubscriptionManager] Cannot register subscription: global limit of ${this.MAX_TOTAL_SUBSCRIPTIONS} reached`,
        {
          subscriptionId,
          source,
          currentCount: this.subscriptions.size,
          relayUrls,
        }
      );
      return [];
    }

    // Filter out relays that are at capacity
    const availableRelays: string[] = [];
    const excludedRelays: string[] = [];

    for (const relayUrl of relayUrls) {
      const conn = this.connections.get(relayUrl);
      if (conn && conn.activeSubscriptions >= this.MAX_CONCURRENT_SUBS_PER_RELAY) {
        excludedRelays.push(relayUrl);
      } else {
        availableRelays.push(relayUrl);
      }
    }

    // Log excluded relays if any
    if (excludedRelays.length > 0) {
      this.logger.warn(
        `[SubscriptionManager] Excluded ${excludedRelays.length} relay(s) at subscription limit`,
        {
          subscriptionId,
          source,
          excludedRelays,
          availableRelays,
          limit: this.MAX_CONCURRENT_SUBS_PER_RELAY,
        }
      );
    }

    // If no relays have capacity, fail the subscription
    if (availableRelays.length === 0) {
      this.logger.error(
        `[SubscriptionManager] Cannot register subscription: all relays at limit`,
        {
          subscriptionId,
          source,
          relayUrls,
          limit: this.MAX_CONCURRENT_SUBS_PER_RELAY,
        }
      );
      return [];
    }

    const now = Date.now();

    // Register the subscription with only the available relays
    this.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      filter,
      relayUrls: availableRelays,
      createdAt: now,
      source,
      active: true,
    });

    // Update connection info for each available relay
    for (const relayUrl of availableRelays) {
      const conn = this.connections.get(relayUrl) || {
        url: relayUrl,
        isConnected: false,
        activeSubscriptions: 0,
        pendingRequests: 0,
        lastActivity: now,
        poolInstance,
      };

      conn.activeSubscriptions++;
      conn.lastActivity = now;
      this.connections.set(relayUrl, conn);
    }

    // Track pool instance
    this.poolInstances.add(poolInstance);

    this.logger.debug(`[SubscriptionManager] Registered subscription`, {
      subscriptionId,
      source,
      relayCount: availableRelays.length,
      originalRelayCount: relayUrls.length,
      relayUrls: availableRelays,
      filter,
      poolInstance,
      totalSubscriptions: this.subscriptions.size,
    });

    this.updateMetrics();
    return availableRelays;
  }

  /**
   * Unregister a subscription
   */
  unregisterSubscription(subscriptionId: string): void {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) {
      this.logger.debug(`[SubscriptionManager] Subscription ${subscriptionId} not found for unregister`);
      return;
    }

    // Update connection info for each relay
    for (const relayUrl of sub.relayUrls) {
      const conn = this.connections.get(relayUrl);
      if (conn) {
        conn.activeSubscriptions = Math.max(0, conn.activeSubscriptions - 1);
        conn.lastActivity = Date.now();

        // Clean up connection if no longer in use
        if (conn.activeSubscriptions === 0 && conn.pendingRequests === 0) {
          this.connections.delete(relayUrl);
        } else {
          this.connections.set(relayUrl, conn);
        }
      }
    }

    this.subscriptions.delete(subscriptionId);

    this.logger.debug(`[SubscriptionManager] Unregistered subscription`, {
      subscriptionId,
      source: sub.source,
      relayCount: sub.relayUrls.length,
      totalSubscriptions: this.subscriptions.size,
    });

    this.updateMetrics();
  }

  /**
   * Register a pending request (for one-time queries)
   */
  registerRequest(relayUrls: string[], source: string, poolInstance: string): string {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    // Update connection info for each relay
    for (const relayUrl of relayUrls) {
      const conn = this.connections.get(relayUrl) || {
        url: relayUrl,
        isConnected: false,
        activeSubscriptions: 0,
        pendingRequests: 0,
        lastActivity: now,
        poolInstance,
      };

      conn.pendingRequests++;
      conn.lastActivity = now;
      this.connections.set(relayUrl, conn);
    }

    // Track pool instance
    this.poolInstances.add(poolInstance);

    // Reduced logging - only log summary periodically instead of every request
    // this.logger.debug(`[SubscriptionManager] Registered request`, {...});

    this.updateMetrics();
    return requestId;
  }

  /**
   * Unregister a pending request
   */
  unregisterRequest(requestId: string, relayUrls: string[]): void {
    const now = Date.now();

    // Update connection info for each relay
    for (const relayUrl of relayUrls) {
      const conn = this.connections.get(relayUrl);
      if (conn) {
        conn.pendingRequests = Math.max(0, conn.pendingRequests - 1);
        conn.lastActivity = now;

        // Clean up connection if no longer in use
        if (conn.activeSubscriptions === 0 && conn.pendingRequests === 0) {
          this.connections.delete(relayUrl);
        } else {
          this.connections.set(relayUrl, conn);
        }
      }
    }

    // Reduced logging - only log summary periodically instead of every unregister
    // this.logger.debug(`[SubscriptionManager] Unregistered request`, {...});

    this.updateMetrics();
  }

  /**
   * Update connection status for a relay with throttling
   */
  updateConnectionStatus(relayUrl: string, isConnected: boolean, poolInstance: string): void {
    const now = Date.now();
    const lastUpdate = this.lastConnectionUpdate.get(relayUrl) || 0;
    const timeSinceLastUpdate = now - lastUpdate;

    // Clear any pending update for this relay
    const existingTimeout = this.pendingConnectionUpdates.get(relayUrl);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Throttle connection status updates
    if (timeSinceLastUpdate < this.CONNECTION_STATUS_THROTTLE_MS) {
      // Schedule a delayed update
      const timeout = setTimeout(() => {
        this.performConnectionUpdate(relayUrl, isConnected, poolInstance);
        this.pendingConnectionUpdates.delete(relayUrl);
      }, this.CONNECTION_STATUS_THROTTLE_MS - timeSinceLastUpdate);

      this.pendingConnectionUpdates.set(relayUrl, timeout);
      return;
    }

    // Update immediately
    this.performConnectionUpdate(relayUrl, isConnected, poolInstance);
  }

  /**
   * Perform the actual connection status update
   */
  private performConnectionUpdate(relayUrl: string, isConnected: boolean, poolInstance: string): void {
    const conn = this.connections.get(relayUrl);
    if (conn) {
      conn.isConnected = isConnected;
      conn.lastActivity = Date.now();
      this.connections.set(relayUrl, conn);
    } else {
      // Create new connection entry if it doesn't exist
      this.connections.set(relayUrl, {
        url: relayUrl,
        isConnected,
        activeSubscriptions: 0,
        pendingRequests: 0,
        lastActivity: Date.now(),
        poolInstance,
      });
    }

    // Only log connection status updates occasionally to reduce noise
    // Removed debug log here as it's called very frequently

    this.lastConnectionUpdate.set(relayUrl, Date.now());
    this.updateMetrics();
  }

  /**
   * Check if a subscription with the same filter already exists for the given relays
   */
  hasDuplicateSubscription(filter: Filter, relayUrls: string[]): string | null {
    const filterStr = JSON.stringify(filter);
    const relayUrlsStr = JSON.stringify([...relayUrls].sort());

    for (const [id, sub] of this.subscriptions.entries()) {
      if (!sub.active) continue;

      const subFilterStr = JSON.stringify(sub.filter);
      const subRelayUrlsStr = JSON.stringify([...sub.relayUrls].sort());

      if (filterStr === subFilterStr && relayUrlsStr === subRelayUrlsStr) {
        return id;
      }
    }

    return null;
  }

  /**
   * Get total number of pending requests
   */
  private getTotalPendingRequests(): number {
    let total = 0;
    for (const conn of this.connections.values()) {
      total += conn.pendingRequests;
    }
    return total;
  }

  /**
   * Compute current metrics
   */
  private computeMetrics(): RelayMetrics {
    const subscriptionsBySource = new Map<string, number>();

    for (const sub of this.subscriptions.values()) {
      if (sub.active) {
        subscriptionsBySource.set(sub.source, (subscriptionsBySource.get(sub.source) || 0) + 1);
      }
    }

    return {
      totalSubscriptions: this.subscriptions.size,
      totalPendingRequests: this.getTotalPendingRequests(),
      totalConnections: this.connections.size,
      subscriptionsBySource,
      connectionsByRelay: new Map(this.connections),
      subscriptions: Array.from(this.subscriptions.values()),
      poolInstances: new Set(this.poolInstances),
    };
  }

  /**
   * Update metrics signal
   */
  private updateMetrics(): void {
    this.metricsSignal.set(this.computeMetrics());
  }

  /**
   * Get detailed metrics report as string
   */
  getMetricsReport(): string {
    const metrics = this.computeMetrics();
    const lines = [
      '=== Relay Subscription Metrics ===',
      `Total Subscriptions: ${metrics.totalSubscriptions}`,
      `Total Pending Requests: ${metrics.totalPendingRequests}`,
      `Total Connected Relays: ${metrics.totalConnections}`,
      `Pool Instances: ${metrics.poolInstances.size}`,
      '',
      '=== Subscriptions by Source ===',
    ];

    for (const [source, count] of metrics.subscriptionsBySource.entries()) {
      lines.push(`  ${source}: ${count}`);
    }

    lines.push('', '=== Connection Details ===');
    for (const [url, conn] of metrics.connectionsByRelay.entries()) {
      lines.push(
        `  ${url}:`,
        `    Status: ${conn.isConnected ? 'Connected' : 'Disconnected'}`,
        `    Active Subscriptions: ${conn.activeSubscriptions}`,
        `    Pending Requests: ${conn.pendingRequests}`,
        `    Pool Instance: ${conn.poolInstance}`,
        `    Last Activity: ${new Date(conn.lastActivity).toISOString()}`
      );
    }

    if (metrics.totalSubscriptions > 0) {
      lines.push('', '=== Active Subscriptions ===');
      for (const sub of metrics.subscriptions) {
        if (sub.active) {
          lines.push(
            `  ${sub.id}:`,
            `    Source: ${sub.source}`,
            `    Relays: ${sub.relayUrls.join(', ')}`,
            `    Filter: ${JSON.stringify(sub.filter)}`,
            `    Age: ${Math.round((Date.now() - sub.createdAt) / 1000)}s`
          );
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Log current metrics to console
   */
  logMetrics(): void {
    console.log(this.getMetricsReport());
  }

  /**
   * Clean up stale subscriptions (for debugging/maintenance)
   */
  cleanupStaleSubscriptions(maxAgeMs = 300000): number {
    // 5 minutes default
    const now = Date.now();
    let cleaned = 0;

    for (const [id, sub] of this.subscriptions.entries()) {
      if (now - sub.createdAt > maxAgeMs) {
        this.logger.warn(`[SubscriptionManager] Cleaning up stale subscription`, {
          subscriptionId: id,
          source: sub.source,
          age: Math.round((now - sub.createdAt) / 1000),
        });
        this.unregisterSubscription(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.info(`[SubscriptionManager] Cleaned up ${cleaned} stale subscriptions`);
    }

    return cleaned;
  }

  /**
   * Get active subscription count for a specific relay
   */
  getActiveSubscriptionCount(relayUrl: string): number {
    const conn = this.connections.get(relayUrl);
    return conn ? conn.activeSubscriptions : 0;
  }

  /**
   * Get all active subscriptions
   */
  getActiveSubscriptions(): SubscriptionInfo[] {
    return Array.from(this.subscriptions.values()).filter((sub) => sub.active);
  }

  /**
   * Reset all tracking (use with caution, mainly for testing)
   */
  reset(): void {
    this.logger.warn('[SubscriptionManager] Resetting all subscription tracking');
    this.subscriptions.clear();
    this.connections.clear();
    this.poolInstances.clear();
    this.updateMetrics();
  }
}
