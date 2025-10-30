import { Injectable, inject } from '@angular/core';
import { SimplePool, Event, Filter } from 'nostr-tools';
import { RelaysService, RelayStats } from './relays';
import { SubscriptionManagerService } from './subscription-manager';
import { LoggerService } from '../logger.service';

@Injectable({
  providedIn: 'root'
})
export class RelayPoolService {
  #pool = new SimplePool();
  private readonly relaysService = inject(RelaysService);
  private readonly subscriptionManager = inject(SubscriptionManagerService);
  private readonly logger = inject(LoggerService);

  // Pool instance identifier
  private readonly poolInstanceId = `RelayPoolService_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  /**
   * Add relays to the pool and register them with RelaysService
   */
  private addRelays(relayUrls: string[]): void {
    // Get current relays from RelaysService
    const allRelayStats = this.relaysService.getAllRelayStats();
    const currentRelays = Array.from(allRelayStats.keys());
    const newRelays = relayUrls.filter(url => !currentRelays.includes(url));

    if (newRelays.length > 0) {
      // Register each new relay with the RelaysService for tracking
      newRelays.forEach(url => {
        this.relaysService.addRelay(url);
      });
    }
  }

  /**
   * Get event from relays
   */
  async get(relayUrls: string[], filter: Filter, timeoutMs = 5000): Promise<Event | null> {
    if (relayUrls.length === 0) {
      return null;
    }

    // Add any new relays to the pool
    this.addRelays(relayUrls);

    // Register the request
    const requestId = this.subscriptionManager.registerRequest(
      relayUrls,
      'RelayPoolService',
      this.poolInstanceId
    );

    this.logger.debug('[RelayPoolService] Executing get request', {
      requestId,
      relayCount: relayUrls.length,
      filter,
      timeout: timeoutMs,
    });

    try {
      const event = await this.#pool.get(relayUrls, filter, { maxWait: timeoutMs });

      // Track successful event retrieval
      if (event) {
        relayUrls.forEach(url => {
          this.relaysService.incrementEventCount(url);
          this.subscriptionManager.updateConnectionStatus(url, true, this.poolInstanceId);
        });
      } else {
        relayUrls.forEach(url => {
          this.subscriptionManager.updateConnectionStatus(url, true, this.poolInstanceId);
        });
      }

      return event;
    } catch (error) {
      this.logger.error('[RelayPoolService] Error fetching events:', error);

      // Record connection issues for all relays
      relayUrls.forEach(url => {
        this.relaysService.recordConnectionRetry(url);
        this.subscriptionManager.updateConnectionStatus(url, false, this.poolInstanceId);
      });

      return null;
    } finally {
      this.subscriptionManager.unregisterRequest(requestId, relayUrls);
    }
  }

  /**
 * Get events from relays
 */
  async query(relayUrls: string[], filter: Filter, timeoutMs = 5000): Promise<Event[]> {
    if (relayUrls.length === 0) {
      return [];
    }

    // Add any new relays to the pool
    this.addRelays(relayUrls);

    // Register the request
    const requestId = this.subscriptionManager.registerRequest(
      relayUrls,
      'RelayPoolService',
      this.poolInstanceId
    );

    this.logger.debug('[RelayPoolService] Executing query request', {
      requestId,
      relayCount: relayUrls.length,
      filter,
      timeout: timeoutMs,
    });

    try {
      const events = await this.#pool.querySync(relayUrls, filter, { maxWait: timeoutMs });

      // Track successful event retrieval
      if (events.length > 0) {
        relayUrls.forEach(url => {
          this.relaysService.incrementEventCount(url);
          this.subscriptionManager.updateConnectionStatus(url, true, this.poolInstanceId);
        });
      } else {
        relayUrls.forEach(url => {
          this.subscriptionManager.updateConnectionStatus(url, true, this.poolInstanceId);
        });
      }

      return events;
    } catch (error) {
      this.logger.error('[RelayPoolService] Error fetching events:', error);

      // Record connection issues for all relays
      relayUrls.forEach(url => {
        this.relaysService.recordConnectionRetry(url);
        this.subscriptionManager.updateConnectionStatus(url, false, this.poolInstanceId);
      });

      return [];
    } finally {
      this.subscriptionManager.unregisterRequest(requestId, relayUrls);
    }
  }

  /**
   * Subscribe to events
   */
  subscribe(relayUrls: string[], filter: Filter, onEvent: (event: Event) => void) {
    // Add any new relays to the pool
    this.addRelays(relayUrls);

    // Generate subscription ID
    const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Try to register the subscription
    const registered = this.subscriptionManager.registerSubscription(
      subscriptionId,
      filter,
      relayUrls,
      'RelayPoolService',
      this.poolInstanceId
    );

    if (!registered) {
      this.logger.error('[RelayPoolService] Cannot create subscription: limits reached', {
        subscriptionId,
        filter,
        relayUrls,
      });
      return {
        close: () => {
          this.logger.debug('[RelayPoolService] Attempted to close rejected subscription');
        },
      };
    }

    this.logger.info('[RelayPoolService] Creating subscription', {
      subscriptionId,
      relayCount: relayUrls.length,
      filter,
    });

    const sub = this.#pool.subscribe(relayUrls, filter, {
      onevent: (event) => {
        // Track event received for all relays in this subscription
        // Note: We don't know which specific relay sent this event, so we increment all
        relayUrls.forEach(url => {
          this.relaysService.incrementEventCount(url);
          this.subscriptionManager.updateConnectionStatus(url, true, this.poolInstanceId);
        });
        onEvent(event);
      },
      onclose: (reason) => {
        this.logger.info('[RelayPoolService] Subscription closed', {
          subscriptionId,
          reason,
        });
        this.subscriptionManager.unregisterSubscription(subscriptionId);
      }
    });

    return {
      close: () => {
        this.logger.info('[RelayPoolService] Closing subscription', {
          subscriptionId,
        });
        sub.close();
        this.subscriptionManager.unregisterSubscription(subscriptionId);
      },
    };
  }

  /**
   * Publish an event to relays
   */
  async publish(relayUrls: string[], event: Event): Promise<void> {
    if (relayUrls.length === 0) {
      throw new Error('No relays provided');
    }

    console.log('[RelayPoolService] DEBUG publish called:', {
      relayCount: relayUrls.length,
      relayUrls: relayUrls,
      eventKind: event.kind,
      eventId: event.id,
    });

    // Add any new relays to the pool
    this.addRelays(relayUrls);

    try {
      const publishPromises = this.#pool.publish(relayUrls, event);

      console.log('[RelayPoolService] DEBUG: Got publish promises:', {
        promiseCount: publishPromises.length,
      });

      const results = await Promise.allSettled(publishPromises);

      console.log('[RelayPoolService] DEBUG: Publish results:', {
        totalResults: results.length,
        fulfilled: results.filter(r => r.status === 'fulfilled').length,
        rejected: results.filter(r => r.status === 'rejected').length,
        details: results.map((r, i) => ({
          relay: relayUrls[i],
          status: r.status,
          reason: r.status === 'rejected' ? r.reason : undefined,
        })),
      });

      // Track publish results
      results.forEach((result, index) => {
        const relayUrl = relayUrls[index];
        if (result.status === 'fulfilled') {
          // Successful publish - update connection status
          this.relaysService.updateRelayConnection(relayUrl, true);
        } else {
          // Failed publish - record retry attempt
          console.warn('[RelayPoolService] Failed to publish to relay:', {
            relay: relayUrl,
            reason: result.reason,
          });
          this.relaysService.recordConnectionRetry(relayUrl);
          this.relaysService.updateRelayConnection(relayUrl, false);
        }
      });

    } catch (error) {
      console.error('[RelayPoolService] Error publishing event:', error);

      // Record connection issues for all relays
      relayUrls.forEach(url => {
        this.relaysService.recordConnectionRetry(url);
        this.relaysService.updateRelayConnection(url, false);
      });

      throw error;
    }
  }

  /**
   * Get a single event by ID
   */
  async getEventById(relayUrls: string[], id: string, timeoutMs = 3000): Promise<Event | null> {
    const filter: Filter = { ids: [id] };
    const event = await this.get(relayUrls, filter, timeoutMs);
    return event;
  }

  /**
   * Close all connections and cleanup
   */
  close(): void {
    // Get all relay URLs from RelaysService to close connections
    const allRelayStats = this.relaysService.getAllRelayStats();
    const relayUrls = Array.from(allRelayStats.keys());
    this.#pool.close(relayUrls);
  }

  /**
   * Get relay statistics for all tracked relays
   */
  getRelayStats(): Map<string, RelayStats> {
    return this.relaysService.getAllRelayStats();
  }

  /**
   * Get performance score for a specific relay
   */
  getRelayPerformanceScore(url: string): number {
    return this.relaysService.getRelayPerformanceScore(url);
  }

  /**
   * Get optimal relays from the current pool based on performance
   */
  getOptimalRelays(limit?: number): string[] {
    // Get current relays from RelaysService
    const allRelayStats = this.relaysService.getAllRelayStats();
    const currentRelays = Array.from(allRelayStats.keys());
    return this.relaysService.getOptimalRelays(currentRelays, limit);
  }

  /**
   * Get connected relays
   */
  getConnectedRelays(): string[] {
    return this.relaysService.getConnectedRelays();
  }

  /**
   * Update connection status for a relay
   */
  updateRelayConnectionStatus(url: string, isConnected: boolean): void {
    this.relaysService.updateRelayConnection(url, isConnected);
  }

  /**
   * Record a connection retry attempt for a relay
   */
  recordConnectionRetry(url: string): void {
    this.relaysService.recordConnectionRetry(url);
  }

  /**
   * Monitor relay connection status
   */
  private monitorConnections(): void {
    // Note: SimplePool doesn't expose connection events directly
    // This is a placeholder for connection monitoring logic
    // You might need to implement custom connection tracking
  }
}