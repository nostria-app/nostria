import { Injectable, inject, Injector } from '@angular/core';
import { SimplePool, Event, Filter } from 'nostr-tools';
import { RelaysService, RelayStats } from './relays';
import { SubscriptionManagerService } from './subscription-manager';
import { LoggerService } from '../logger.service';
import { RelayAuthService } from './relay-auth.service';

// Forward reference to avoid circular dependency
let EventProcessorServiceRef: any;

@Injectable({
  providedIn: 'root'
})
export class RelayPoolService {
  #pool = new SimplePool();
  private readonly relaysService = inject(RelaysService);
  private readonly subscriptionManager = inject(SubscriptionManagerService);
  private readonly logger = inject(LoggerService);
  private readonly relayAuth = inject(RelayAuthService);
  private readonly injector = inject(Injector);
  // Lazy-loaded to avoid circular dependency
  private _eventProcessor?: any;
  private get eventProcessor(): any {
    if (!this._eventProcessor) {
      if (!EventProcessorServiceRef) {
        EventProcessorServiceRef = require('../event-processor.service').EventProcessorService;
      }
      this._eventProcessor = this.injector.get(EventProcessorServiceRef);
    }
    return this._eventProcessor;
  }

  // Pool instance identifier
  private readonly poolInstanceId = `RelayPoolService_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  /**
   * Add relays to the pool and register them with RelaysService
   */
  private addRelays(relayUrls: string[]): void {
    // Filter out insecure ws:// relays - they cannot be used from secure context
    const secureRelays = relayUrls.filter(url => !url.startsWith('ws://'));

    if (secureRelays.length < relayUrls.length) {
      const filtered = relayUrls.length - secureRelays.length;
      this.logger.warn(`[RelayPoolService] Filtered out ${filtered} insecure ws:// relay(s) - secure context requires wss://`);
    }

    // Get current relays from RelaysService
    const allRelayStats = this.relaysService.getAllRelayStats();
    const currentRelays = Array.from(allRelayStats.keys());
    const newRelays = secureRelays.filter(url => !currentRelays.includes(url));

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

    // Filter out insecure ws:// relays - they cannot be used from secure context
    const secureUrls = relayUrls.filter(url => !url.startsWith('ws://'));
    if (secureUrls.length === 0) {
      this.logger.warn('[RelayPoolService] All relays are insecure (ws://), cannot connect from secure context');
      return null;
    }

    // Filter out relays that have failed authentication
    const filteredUrls = this.relayAuth.filterAuthFailedRelays(secureUrls);
    if (filteredUrls.length === 0) {
      this.logger.warn('[RelayPoolService] All relays have failed authentication, cannot execute get');
      return null;
    }

    // Add any new relays to the pool
    this.addRelays(filteredUrls);

    // Register the request
    const requestId = this.subscriptionManager.registerRequest(
      filteredUrls,
      'RelayPoolService',
      this.poolInstanceId
    );

    this.logger.debug('[RelayPoolService] Executing get request', {
      requestId,
      relayCount: filteredUrls.length,
      filter,
      timeout: timeoutMs,
    });

    try {
      let event = await this.#pool.get(filteredUrls, filter, { maxWait: timeoutMs });

      // Filter event through centralized processor (expiration, deletion, muting)
      if (event && !this.eventProcessor.shouldAcceptEvent(event)) {
        event = null;
      }

      // Track successful event retrieval
      if (event) {
        filteredUrls.forEach(url => {
          this.relaysService.incrementEventCount(url);
          this.subscriptionManager.updateConnectionStatus(url, true, this.poolInstanceId);
        });
      } else {
        filteredUrls.forEach(url => {
          this.subscriptionManager.updateConnectionStatus(url, true, this.poolInstanceId);
        });
      }

      return event;
    } catch (error) {
      this.logger.error('[RelayPoolService] Error fetching events:', error);

      // Record connection issues for all relays
      filteredUrls.forEach(url => {
        this.relaysService.recordConnectionRetry(url);
        this.subscriptionManager.updateConnectionStatus(url, false, this.poolInstanceId);
      });

      return null;
    } finally {
      this.subscriptionManager.unregisterRequest(requestId, filteredUrls);
    }
  }

  /**
 * Get events from relays
 */
  async query(relayUrls: string[], filter: Filter, timeoutMs = 5000): Promise<Event[]> {
    if (relayUrls.length === 0) {
      return [];
    }

    // Filter out insecure ws:// relays - they cannot be used from secure context
    const secureUrls = relayUrls.filter(url => !url.startsWith('ws://'));
    if (secureUrls.length === 0) {
      this.logger.warn('[RelayPoolService] All relays are insecure (ws://), cannot connect from secure context');
      return [];
    }

    // Filter out relays that have failed authentication
    const filteredUrls = this.relayAuth.filterAuthFailedRelays(secureUrls);
    if (filteredUrls.length === 0) {
      this.logger.warn('[RelayPoolService] All relays have failed authentication, cannot execute query');
      return [];
    }

    // Add any new relays to the pool
    this.addRelays(filteredUrls);

    // Register the request
    const requestId = this.subscriptionManager.registerRequest(
      filteredUrls,
      'RelayPoolService',
      this.poolInstanceId
    );

    this.logger.debug('[RelayPoolService] Executing query request', {
      requestId,
      relayCount: filteredUrls.length,
      filter: JSON.stringify(filter),
      timeout: timeoutMs,
    });

    try {
      let events = await this.#pool.querySync(filteredUrls, filter, { maxWait: timeoutMs });

      // Filter events through centralized processor (expiration, deletion, muting)
      events = this.eventProcessor.filterEvents(events);

      // Debug: Log pagination results
      if (filter.until) {
        const untilDate = new Date(filter.until * 1000).toISOString();
        this.logger.debug(`[RelayPoolService] Pagination query returned ${events.length} events (until: ${untilDate})`);
        if (events.length > 0) {
          const oldestEvent = events.reduce((oldest, e) => (e.created_at || 0) < (oldest.created_at || 0) ? e : oldest);
          const newestEvent = events.reduce((newest, e) => (e.created_at || 0) > (newest.created_at || 0) ? e : newest);
          this.logger.debug(`[RelayPoolService] Event range: ${new Date((oldestEvent.created_at || 0) * 1000).toISOString()} to ${new Date((newestEvent.created_at || 0) * 1000).toISOString()}`);
        }
      }

      // Track successful event retrieval
      if (events.length > 0) {
        filteredUrls.forEach(url => {
          this.relaysService.incrementEventCount(url);
          this.subscriptionManager.updateConnectionStatus(url, true, this.poolInstanceId);
        });
      } else {
        filteredUrls.forEach(url => {
          this.subscriptionManager.updateConnectionStatus(url, true, this.poolInstanceId);
        });
      }

      return events;
    } catch (error) {
      this.logger.error('[RelayPoolService] Error fetching events:', error);

      // Record connection issues for all relays
      filteredUrls.forEach(url => {
        this.relaysService.recordConnectionRetry(url);
        this.subscriptionManager.updateConnectionStatus(url, false, this.poolInstanceId);
      });

      return [];
    } finally {
      this.subscriptionManager.unregisterRequest(requestId, filteredUrls);
    }
  }

  /**
   * Subscribe to events
   */
  subscribe(relayUrls: string[], filter: Filter, onEvent: (event: Event) => void) {
    // Filter out insecure ws:// relays - they cannot be used from secure context
    const secureUrls = relayUrls.filter(url => !url.startsWith('ws://'));
    if (secureUrls.length === 0) {
      this.logger.warn('[RelayPoolService] All relays are insecure (ws://), cannot connect from secure context');
      return {
        close: () => {
          this.logger.debug('[RelayPoolService] No subscription to close (all relays insecure)');
        },
      };
    }

    // Filter out relays that have failed authentication
    const filteredUrls = this.relayAuth.filterAuthFailedRelays(secureUrls);
    if (filteredUrls.length === 0) {
      this.logger.warn('[RelayPoolService] All relays have failed authentication, cannot subscribe');
      return {
        close: () => {
          this.logger.debug('[RelayPoolService] No subscription to close (all relays auth-failed)');
        },
      };
    }

    // Add any new relays to the pool
    this.addRelays(filteredUrls);

    // Generate subscription ID
    const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Try to register the subscription - returns available relays (those not at limit)
    const availableRelays = this.subscriptionManager.registerSubscription(
      subscriptionId,
      filter,
      filteredUrls,
      'RelayPoolService',
      this.poolInstanceId
    );

    if (availableRelays.length === 0) {
      this.logger.error('[RelayPoolService] Cannot create subscription: all relays at limit', {
        subscriptionId,
        filter,
        relayUrls: filteredUrls,
      });
      return {
        close: () => {
          this.logger.debug('[RelayPoolService] Attempted to close rejected subscription');
        },
      };
    }

    this.logger.info('[RelayPoolService] Creating subscription', {
      subscriptionId,
      relayCount: availableRelays.length,
      originalRelayCount: filteredUrls.length,
      filter,
    });

    // Get auth callback for NIP-42 authentication
    const authCallback = this.relayAuth.getAuthCallback();

    // Use only the available relays (those not at the subscription limit)
    const sub = this.#pool.subscribe(availableRelays, filter, {
      onauth: authCallback,
      onevent: (event) => {
        // Filter event through centralized processor (expiration, deletion, muting)
        if (!this.eventProcessor.shouldAcceptEvent(event)) {
          return;
        }

        // Track event received for all relays in this subscription
        // Note: We don't know which specific relay sent this event, so we increment all
        availableRelays.forEach(url => {
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
   * Publish an event to relays with timeout support
   * @param relayUrls Array of relay URLs to publish to
   * @param event Event to publish
   * @param timeoutMs Timeout in milliseconds (default: 10000)
   */
  async publish(relayUrls: string[], event: Event, timeoutMs = 10000): Promise<void> {
    if (relayUrls.length === 0) {
      throw new Error('No relays provided');
    }

    // Filter out relays that have failed authentication
    const filteredUrls = this.relayAuth.filterAuthFailedRelays(relayUrls);
    if (filteredUrls.length === 0) {
      throw new Error('All relays have failed authentication, cannot publish');
    }

    console.log('[RelayPoolService] DEBUG publish called:', {
      relayCount: filteredUrls.length,
      relayUrls: filteredUrls,
      eventKind: event.kind,
      eventId: event.id,
      timeout: timeoutMs,
    });

    // Add any new relays to the pool
    this.addRelays(filteredUrls);

    // Get auth callback for NIP-42 authentication
    const authCallback = this.relayAuth.getAuthCallback();

    try {
      const publishPromises = this.#pool.publish(filteredUrls, event, { onauth: authCallback });

      console.log('[RelayPoolService] DEBUG: Got publish promises:', {
        promiseCount: publishPromises.length,
      });

      // Add timeout to the publish operation
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Publish timeout')), timeoutMs)
      );

      const results = await Promise.race([
        Promise.allSettled(publishPromises),
        timeoutPromise
      ]).catch(async () => {
        // Timeout occurred - collect whatever results we have
        this.logger.warn('[RelayPoolService] Publish timeout, collecting results', {
          timeout: timeoutMs,
          relayCount: filteredUrls.length
        });

        // Give a small grace period to collect results
        await new Promise(resolve => setTimeout(resolve, 100));
        return await Promise.allSettled(publishPromises);
      });

      console.log('[RelayPoolService] DEBUG: Publish results:', {
        totalResults: results.length,
        fulfilled: results.filter(r => r.status === 'fulfilled').length,
        rejected: results.filter(r => r.status === 'rejected').length,
        details: results.map((r, i) => ({
          relay: filteredUrls[i],
          status: r.status,
          reason: r.status === 'rejected' ? r.reason : undefined,
        })),
      });

      // Track publish results
      results.forEach((result, index) => {
        const relayUrl = filteredUrls[index];
        if (result.status === 'fulfilled') {
          // Successful publish - update connection status
          this.relaysService.updateRelayConnection(relayUrl, true);
        } else {
          // Failed publish - record retry attempt
          let errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
          // Handle empty error messages
          if (!errorMsg || errorMsg.trim() === '') {
            errorMsg = 'Unknown error (relay returned empty response)';
          }
          console.warn('[RelayPoolService] Failed to publish to relay:', {
            relay: relayUrl,
            reason: errorMsg,
          });
          // Check for NIP-42 auth failures using proper prefixes
          // auth-required: means client needs to authenticate first
          // restricted: means client authenticated but key is not authorized (e.g., not paid, not whitelisted)
          if (errorMsg.includes('auth-required:') || errorMsg.includes('restricted:')) {
            this.relayAuth.markAuthFailed(relayUrl, errorMsg);
          }
          this.relaysService.recordConnectionRetry(relayUrl);
          this.relaysService.updateRelayConnection(relayUrl, false);
        }
      });

    } catch (error) {
      console.error('[RelayPoolService] Error publishing event:', error);

      // Record connection issues for all relays
      filteredUrls.forEach(url => {
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