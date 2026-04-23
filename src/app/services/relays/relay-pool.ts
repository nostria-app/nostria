import { Injectable, inject, Injector } from '@angular/core';
import { Event, Filter } from 'nostr-tools';
import { RelaysService, RelayStats } from './relays';
import { SubscriptionManagerService } from './subscription-manager';
import { LoggerService } from '../logger.service';
import { RelayAuthService } from './relay-auth.service';
import { LocalSettingsService } from '../local-settings.service';
import { PoolService } from './pool.service';
import { UtilitiesService } from '../utilities.service';

// Forward reference to avoid circular dependency
let EventProcessorServiceRef: any;

type RelayRequestPriority = 0 | 1 | 2 | 3;

interface PublishRelayResult {
  relayUrl: string;
  success: boolean;
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class RelayPoolService {
  readonly #poolService = inject(PoolService);
  get #pool() { return this.#poolService.pool; }
  private readonly relaysService = inject(RelaysService);
  private readonly subscriptionManager = inject(SubscriptionManagerService);
  private readonly logger = inject(LoggerService);
  private readonly relayAuth = inject(RelayAuthService);
  private readonly localSettings = inject(LocalSettingsService);
  private readonly utilities = inject(UtilitiesService);
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
  // Concurrency caps for outbound relay requests.
  //
  // strfry (the most widely deployed relay implementation) defaults to
  //   maxSubsPerConnection = 200
  // nostr-rs-relay and khatru typically allow 20+ concurrent subscriptions per
  // connection. Our previous 4/relay cap was extremely conservative and caused
  // severe queue backpressure during feed bootstrap (each visible event issues
  // 3-4 queries: reactions, replies, quotes, zaps).
  //
  // Values chosen to:
  //  - keep fan-out comfortably below strfry's 200 limit (100x margin)
  //  - stay under the strictest production relays (~20/conn) with a 20% buffer
  //  - let a single feed first-paint drain without queueing
  private readonly maxConcurrentRequests = 24;
  private readonly maxConcurrentRequestsPerRelay = 16;
  private activeRequestCount = 0;
  private readonly activeRequestsByRelay = new Map<string, number>();
  private readonly requestQueue: {
    id: string;
    type: 'get' | 'query';
    relayUrls: string[];
    priority: RelayRequestPriority;
    enqueuedAt: number;
    execute: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
  }[] = [];

  private getEffectivePriority(priority: RelayRequestPriority, enqueuedAt: number): number {
    const waitedMs = Date.now() - enqueuedAt;
    const agingBoost = Math.min(2, Math.floor(waitedMs / 1500));
    return Math.max(0, priority - agingBoost);
  }

  private inferRequestPriority(type: 'get' | 'query', filter: Filter): RelayRequestPriority {
    const kinds = filter.kinds || [];

    // Direct lookups and note/thread content should bypass lower-value background fetches.
    if ((filter.ids && filter.ids.length > 0) || kinds.includes(1)) {
      return 0;
    }

    // Reactions/reposts/zaps are still user-visible interactions and should stay responsive.
    if (kinds.some(kind => kind === 6 || kind === 7 || kind === 20 || kind === 9735)) {
      return 1;
    }

    // Metadata/profile refreshes are less urgent during feed bootstrap.
    if (kinds.includes(0)) {
      return 3;
    }

    return type === 'get' ? 1 : 2;
  }

  private canStartRequest(relayUrls: string[]): boolean {
    if (this.activeRequestCount >= this.maxConcurrentRequests) {
      return false;
    }

    return relayUrls.every(url => (this.activeRequestsByRelay.get(url) || 0) < this.maxConcurrentRequestsPerRelay);
  }

  private markRequestStarted(relayUrls: string[]): void {
    this.activeRequestCount++;

    relayUrls.forEach(url => {
      this.activeRequestsByRelay.set(url, (this.activeRequestsByRelay.get(url) || 0) + 1);
    });
  }

  private markRequestCompleted(relayUrls: string[]): void {
    this.activeRequestCount = Math.max(0, this.activeRequestCount - 1);

    relayUrls.forEach(url => {
      const nextCount = Math.max(0, (this.activeRequestsByRelay.get(url) || 0) - 1);
      if (nextCount === 0) {
        this.activeRequestsByRelay.delete(url);
      } else {
        this.activeRequestsByRelay.set(url, nextCount);
      }
    });
  }

  private processRequestQueue(): void {
    while (this.activeRequestCount < this.maxConcurrentRequests && this.requestQueue.length > 0) {
      const runnableEntries = this.requestQueue
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => this.canStartRequest(entry.relayUrls));

      if (runnableEntries.length === 0) {
        return;
      }

      runnableEntries.sort((a, b) => {
        const priorityDelta = this.getEffectivePriority(a.entry.priority, a.entry.enqueuedAt)
          - this.getEffectivePriority(b.entry.priority, b.entry.enqueuedAt);
        if (priorityDelta !== 0) {
          return priorityDelta;
        }

        return a.entry.enqueuedAt - b.entry.enqueuedAt;
      });

      const nextIndex = runnableEntries[0].index;
      if (nextIndex === -1) {
        return;
      }

      const [entry] = this.requestQueue.splice(nextIndex, 1);
      this.markRequestStarted(entry.relayUrls);

      const queueWaitMs = Date.now() - entry.enqueuedAt;
      if (queueWaitMs > 25) {
        this.logger.debug('[RelayPoolService] Dequeued relay request', {
          requestId: entry.id,
          type: entry.type,
          priority: entry.priority,
          relayCount: entry.relayUrls.length,
          queueWaitMs,
          remainingQueueLength: this.requestQueue.length,
          activeRequestCount: this.activeRequestCount,
        });
      }

      void entry.execute()
        .then(result => entry.resolve(result))
        .catch(error => entry.reject(error))
        .finally(() => {
          this.markRequestCompleted(entry.relayUrls);
          this.processRequestQueue();
        });
    }
  }

  private enqueueRequest<T>(
    requestId: string,
    type: 'get' | 'query',
    relayUrls: string[],
    priority: RelayRequestPriority,
    operation: () => Promise<T>
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.requestQueue.push({
        id: requestId,
        type,
        relayUrls,
        priority,
        enqueuedAt: Date.now(),
        execute: operation,
        resolve: value => resolve(value as T),
        reject,
      });

      if (this.requestQueue.length > 1 || !this.canStartRequest(relayUrls)) {
        this.logger.debug('[RelayPoolService] Queued relay request', {
          requestId,
          type,
          priority,
          relayCount: relayUrls.length,
          queueLength: this.requestQueue.length,
          activeRequestCount: this.activeRequestCount,
        });
      }

      this.processRequestQueue();
    });
  }

  getQueueLength(): number {
    return this.requestQueue.length;
  }

  getActiveRequestCount(): number {
    return this.activeRequestCount;
  }

  isBacklogged(queueThreshold = 100): boolean {
    return this.requestQueue.length >= queueThreshold;
  }

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

  private getConnectableRelayUrls(relayUrls: string[], operation: string): string[] {
    const normalizedRelayUrls = this.utilities.getUniqueNormalizedRelayUrls(relayUrls);

    if (normalizedRelayUrls.length < relayUrls.length) {
      this.logger.debug('[RelayPoolService] Filtered non-connectable relay URL(s)', {
        operation,
        requestedCount: relayUrls.length,
        connectableCount: normalizedRelayUrls.length,
      });
    }

    return normalizedRelayUrls;
  }

  /**
   * Get event from relays
   */
  async get(relayUrls: string[], filter: Filter, timeoutMs = 5000): Promise<Event | null> {
    const connectableRelayUrls = this.getConnectableRelayUrls(relayUrls, 'get');

    if (connectableRelayUrls.length === 0) {
      return null;
    }

    // Filter out insecure ws:// relays - they cannot be used from secure context
    const secureUrls = connectableRelayUrls.filter(url => !url.startsWith('ws://'));
    if (secureUrls.length === 0) {
      this.logger.warn('[RelayPoolService] All relays are insecure (ws://), cannot connect from secure context');
      return null;
    }

    // Filter out relays that have failed authentication
    const filteredUrls = this.relayAuth.filterAuthFailedRelays(secureUrls);
    if (filteredUrls.length === 0) {
      this.logger.warn('[RelayPoolService] All relays are unavailable, cannot execute get');
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

    const priority = this.inferRequestPriority('get', filter);
    return this.enqueueRequest(requestId, 'get', filteredUrls, priority, async () => {
      this.logger.debug('[RelayPoolService] Executing get request', {
        requestId,
        priority,
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
    });
  }

  /**
 * Get events from relays
 */
  async query(relayUrls: string[], filter: Filter, timeoutMs = 5000): Promise<Event[]> {
    const connectableRelayUrls = this.getConnectableRelayUrls(relayUrls, 'query');

    if (connectableRelayUrls.length === 0) {
      return [];
    }

    // Filter out insecure ws:// relays - they cannot be used from secure context
    const secureUrls = connectableRelayUrls.filter(url => !url.startsWith('ws://'));
    if (secureUrls.length === 0) {
      this.logger.warn('[RelayPoolService] All relays are insecure (ws://), cannot connect from secure context');
      return [];
    }

    // Filter out relays that have failed authentication
    const filteredUrls = this.relayAuth.filterAuthFailedRelays(secureUrls);
    if (filteredUrls.length === 0) {
      this.logger.warn('[RelayPoolService] All relays are unavailable, cannot execute query');
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

    const priority = this.inferRequestPriority('query', filter);
    return this.enqueueRequest(requestId, 'query', filteredUrls, priority, async () => {
      this.logger.debug('[RelayPoolService] Executing query request', {
        requestId,
        priority,
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
    });
  }

  /**
   * Subscribe to events
   */
  subscribe(relayUrls: string[], filter: Filter, onEvent: (event: Event) => void) {
    const connectableRelayUrls = this.getConnectableRelayUrls(relayUrls, 'subscribe');

    // Filter out insecure ws:// relays - they cannot be used from secure context
    const secureUrls = connectableRelayUrls.filter(url => !url.startsWith('ws://'));
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
      this.logger.warn('[RelayPoolService] All relays are unavailable, cannot subscribe');
      return {
        close: () => {
          this.logger.debug('[RelayPoolService] No subscription to close (all relays unavailable)');
        },
      };
    }

    // Add any new relays to the pool
    this.addRelays(filteredUrls);

    // Generate subscription ID
    const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const duplicateId = this.subscriptionManager.hasDuplicateSubscription(filter, filteredUrls);
    if (duplicateId) {
      this.logger.warn('[RelayPoolService] Duplicate subscription detected', {
        subscriptionId,
        duplicateId,
        filter,
        relayUrls: filteredUrls,
      });
    }

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
    let manuallyClosed = false;
    let unregistered = false;

    const unregisterSubscription = () => {
      if (unregistered) {
        return;
      }

      unregistered = true;
      this.subscriptionManager.unregisterSubscription(subscriptionId);
    };

    const shouldIgnoreCloseReason = (reasonEntry: string): boolean => {
      const normalized = reasonEntry.toLowerCase();
      return normalized.includes('closed automatically on eose') ||
        normalized.includes('closed by caller') ||
        normalized.includes('aborted by caller');
    };

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
          manuallyClosed,
        });

        if (!manuallyClosed && reason && reason.length > 0) {
          reason.forEach(reasonEntry => {
            if (!reasonEntry || shouldIgnoreCloseReason(reasonEntry)) {
              return;
            }
            this.logger.debug('[RelayPoolService] Subscription closed with reason:', reasonEntry);
          });
        }

        unregisterSubscription();
      }
    });

    return {
      close: () => {
        this.logger.info('[RelayPoolService] Closing subscription', {
          subscriptionId,
        });
        manuallyClosed = true;
        sub.close();
        unregisterSubscription();
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
    const connectableRelayUrls = this.getConnectableRelayUrls(relayUrls, 'publish');

    if (connectableRelayUrls.length === 0) {
      throw new Error('No relays provided');
    }

    // Filter out relays that have failed authentication
    const filteredUrls = this.relayAuth.filterAuthFailedRelays(connectableRelayUrls);
    if (filteredUrls.length === 0) {
      if (connectableRelayUrls.length === 1) {
        throw new Error(`${connectableRelayUrls[0]}: relay unavailable for publishing at the moment`);
      }

      throw new Error('No available relays for this publish attempt');
    }

    // Add any new relays to the pool
    this.addRelays(filteredUrls);

    // Get auth callback for NIP-42 authentication
    const authCallback = this.relayAuth.getAuthCallback();

    try {
      const publishPromises = this.#pool.publish(filteredUrls, event, { onauth: authCallback });

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

      const relayResults = this.handlePublishResults(filteredUrls, results);
      if (relayResults.length === 1 && !relayResults[0].success) {
        throw new Error(relayResults[0].error || `Failed to publish to ${relayResults[0].relayUrl}`);
      }

    } catch (error) {
      this.logger.error('[RelayPoolService] Error publishing event:', error);

      // Record connection issues for all relays
      filteredUrls.forEach(url => {
        this.relaysService.recordConnectionRetry(url);
        this.relaysService.updateRelayConnection(url, false);
      });

      throw error;
    }
  }

  /**
   * Publish an event and return the per-relay promise array without awaiting.
   * Use this when callers need to track individual relay publish results
   * (e.g. to display per-relay notifications).  The caller receives the raw
   * promises and is responsible for handling rejections.
   */
  publishWithTracking(relayUrls: string[], event: Event): Promise<string>[] {
    const connectableRelayUrls = this.getConnectableRelayUrls(relayUrls, 'publishWithTracking');
    const secureUrls = connectableRelayUrls.filter(url => !url.startsWith('ws://'));
    if (secureUrls.length === 0) {
      return [];
    }
    const filteredUrls = this.relayAuth.filterAuthFailedRelays(secureUrls);
    if (filteredUrls.length === 0) {
      return [];
    }
    this.addRelays(filteredUrls);
    const authCallback = this.relayAuth.getAuthCallback();
    return this.#pool.publish(filteredUrls, event, { onauth: authCallback });
  }

  private handlePublishResults(
    relayUrls: string[],
    results: PromiseSettledResult<string>[]
  ): PublishRelayResult[] {
    return results.map((result, index) => {
      const relayUrl = relayUrls[index];
      if (result.status === 'fulfilled') {
        this.relaysService.updateRelayConnection(relayUrl, true);
        return { relayUrl, success: true };
      }

      let errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      if (!errorMsg || errorMsg.trim() === '') {
        errorMsg = 'Unknown error (relay returned empty response)';
      }

      this.logger.warn('[RelayPoolService] Failed to publish to relay:', {
        relay: relayUrl,
        reason: errorMsg,
      });

      if (errorMsg.includes('auth-required:') || errorMsg.includes('restricted:')) {
        this.relayAuth.markAuthFailed(relayUrl, errorMsg);
      }

      this.relaysService.recordConnectionRetry(relayUrl);
      this.relaysService.updateRelayConnection(relayUrl, false);

      return { relayUrl, success: false, error: errorMsg };
    });
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
