import { Injectable, inject, Injector } from '@angular/core';
import { Event } from 'nostr-tools';
import { LoggerService } from '../logger.service';
import { DiscoveryRelayService } from './discovery-relay';
import { RelaysService } from './relays';
import { RelayBlockService } from './relay-block.service';
import { LocalSettingsService } from '../local-settings.service';
import { PoolService } from './pool.service';

// Forward reference to avoid circular dependency
let EventProcessorServiceRef: any;

@Injectable({
  providedIn: 'root',
})
export class SharedRelayService {
  readonly #poolService = inject(PoolService);
  get #pool() { return this.#poolService.pool; }
  private logger = inject(LoggerService);
  private discoveryRelay = inject(DiscoveryRelayService);
  private readonly relaysService = inject(RelaysService);
  private readonly relayBlock = inject(RelayBlockService);
  private readonly localSettings = inject(LocalSettingsService);
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

  // Semaphore for controlling concurrent requests
  private readonly maxConcurrentRequests = 50; // Increased from 3 to handle many concurrent users
  private currentRequests = 0;
  private requestQueue: (() => void)[] = [];

  // Request deduplication cache
  private readonly requestCache = new Map<string, Promise<any>>();
  private readonly cacheTimeout = 5000; // 5 seconds cache - increased from 1s to reduce redundant requests

  /**
   * Creates a unique cache key for request deduplication
   * Only uses the filter for metadata requests since that's what we're actually querying
   * The pubkey parameter is only used for relay selection and shouldn't affect dedup
   */
  private createCacheKey(pubkey: string, filter: any, timeout: number, mode: 'single' | 'many' = 'single'): string {
    // For metadata requests (kind 0), only use the author being queried
    // This ensures we deduplicate even if called from different contexts
    if (filter.kinds?.includes(0) && filter.authors?.length === 1) {
      return `metadata-${mode}-${filter.authors[0]}`;
    }
    // For other requests, include all parameters
    return JSON.stringify({ mode, filter, timeout });
  }

  /**
   * Acquires a semaphore slot for making a request
   */
  private async acquireSemaphore(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.currentRequests < this.maxConcurrentRequests) {
        this.currentRequests++;
        resolve();
      } else {
        this.requestQueue.push(() => {
          this.currentRequests++;
          resolve();
        });
      }
    });
  }

  /**
   * Releases a semaphore slot and processes the next queued request
   */
  private releaseSemaphore(): void {
    this.currentRequests--;
    const nextRequest = this.requestQueue.shift();
    if (nextRequest) {
      nextRequest();
    }
  }

  /**
   * Internal method that performs the actual relay request with concurrency control
   */
  private async performRequest<T extends Event = Event>(
    relayUrls: string[],
    filter: any,
    timeout: number,
  ): Promise<T | null> {
    // Filter out insecure ws:// relays - they cannot be used from secure context
    const secureUrls = relayUrls.filter(url => !url.startsWith('ws://'));
    if (secureUrls.length === 0) {
      this.logger.warn('[SharedRelayService] All relays are insecure (ws://), cannot connect from secure context');
      return null;
    }

    const filteredUrls = this.relayBlock.filterBlockedRelays(secureUrls);
    if (filteredUrls.length === 0) {
      this.logger.warn('[SharedRelayService] All relays are unavailable, skipping request');
      return null;
    }

    await this.acquireSemaphore();

    try {
      // Track that we're attempting to connect to these relays
      filteredUrls.forEach((url) => {
        this.relaysService.updateRelayConnection(url, true);
      });

      const event = (await this.#pool.get(filteredUrls, filter, {
        maxWait: timeout,
      })) as unknown as T;

      if (event) {
        this.logger.debug(`Received event from query`, event);
      } else {
        this.logger.debug(`No event received from query`);
      }

      // If we received an event, increment the count for all relays that could have provided it
      if (event) {
        filteredUrls.forEach((url) => {
          this.relaysService.incrementEventCount(url);
        });
      }

      return event;
    } catch (error) {
      this.logger.error('Error fetching events', error);

      // Track connection retry for failed connections
      const errorMessage = error instanceof Error ? error.message : String(error);
      filteredUrls.forEach((url) => {
        this.relayBlock.recordFailure(url, errorMessage, this.localSettings.autoRelayAuth());
        this.relaysService.recordConnectionRetry(url);
        this.relaysService.updateRelayConnection(url, false);
      });

      return null;
    } finally {
      this.releaseSemaphore();
    }
  }

  /**
   * Generic function to fetch Nostr events (one-time query) with concurrency control
   * @param pubkey The public key of the user
   * @param filter Filter for the query
   * @param options Optional options for the query
   * @returns Promise that resolves to a single event
   */
  async get<T extends Event = Event>(
    pubkey: string,
    filter: {
      ids?: string[];
      kinds?: number[];
      authors?: string[];
      '#e'?: string[];
      '#p'?: string[];
      since?: number;
      until?: number;
      limit?: number;
    },
    options: { timeout?: number } = {},
  ): Promise<T | null> {
    // Only log for non-metadata requests to reduce console noise
    if (!filter.kinds?.includes(0)) {
      this.logger.debug('Getting events with filters (shared-relay):', filter);
    }

    // Default timeout is 5 seconds if not specified
    const timeout = options.timeout || 5000;

    // Create cache key for request deduplication
    const cacheKey = this.createCacheKey(pubkey, filter, timeout, 'single');

    // CRITICAL: Check cache synchronously before any async work
    if (this.requestCache.has(cacheKey)) {
      // Log deduplication for metadata requests too during debugging
      if (filter.kinds?.includes(0)) {
        this.logger.debug(`[Relay Dedup] Returning cached metadata request for: ${pubkey.substring(0, 8)}...`);
      }
      return this.requestCache.get(cacheKey) as Promise<T | null>;
    }

    // CRITICAL: Create a deferred promise and cache it SYNCHRONOUSLY before any async work
    // This prevents race conditions where multiple calls slip through before the promise is cached
    let resolvePromise: (value: T | null) => void;
    let rejectPromise: (error: unknown) => void;
    const requestPromise = new Promise<T | null>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    // Cache the promise IMMEDIATELY (synchronously)
    this.requestCache.set(cacheKey, requestPromise);

    // Only log when cache is getting large (indicates potential issue)
    if (filter.kinds?.includes(0) && this.requestCache.size > 20) {
      this.logger.debug(`[Relay] Metadata request for: ${pubkey.substring(0, 8)}... (cache: ${this.requestCache.size})`);
    }

    // Clean up cache after timeout
    setTimeout(() => {
      this.requestCache.delete(cacheKey);
    }, this.cacheTimeout);

    // Now do the async work
    try {
      const result = await this.executeGetRequest<T>(pubkey, filter, timeout);
      resolvePromise!(result);
      return result;
    } catch (error) {
      rejectPromise!(error as unknown);
      throw error;
    }
  }

  /**
   * Internal method to execute the actual get request
   */
  private async executeGetRequest<T extends Event = Event>(
    pubkey: string,
    filter: any,
    timeout: number,
  ): Promise<T | null> {
    // Get optimal relays for the user
    let relayUrls = await this.discoveryRelay.getUserRelayUrls(pubkey);
    relayUrls = this.relayBlock.filterBlockedRelays(
      this.relaysService.getOptimalRelays(relayUrls)
    );

    // Reduced logging for metadata requests to prevent console spam
    if (!filter.kinds?.includes(0)) {
      this.logger.debug('Using relay URLs:', relayUrls);
    }

    if (relayUrls.length === 0) {
      this.logger.warn('No relays available for query');
      return null;
    }

    try {
      // Execute the query with concurrency control
      return await this.performRequest<T>(relayUrls, filter, timeout);
    } catch (error) {
      this.logger.error('Error fetching events', error);
      return null;
    }
  }

  /**
   * Generic function to fetch Nostr events (one-time query) with concurrency control
   * @param pubkey The public key of the user
   * @param filter Filter for the query
   * @param options Optional options for the query
   * @returns Promise that resolves to an array of events
   */
  async getMany<T extends Event = Event>(
    pubkey: string,
    filter: {
      kinds?: number[];
      authors?: string[];
      '#e'?: string[];
      '#p'?: string[];
      since?: number;
      until?: number;
      limit?: number;
    },
    options: { timeout?: number } = {},
  ): Promise<T[]> {
    this.logger.debug('Getting events with filters (account-relay):', filter);

    // Default timeout is 5 seconds if not specified
    const timeout = options.timeout || 5000;

    // Create cache key for request deduplication
    const cacheKey = this.createCacheKey(pubkey, filter, timeout, 'many');

    // Check if we already have a pending request for the same parameters
    if (this.requestCache.has(cacheKey)) {
      this.logger.debug('Returning cached request for duplicate getMany query');
      return this.requestCache.get(cacheKey) as Promise<T[]>;
    }

    // Create the request promise
    const requestPromise = this.executeGetManyRequest<T>(pubkey, filter, timeout);

    // Cache the promise
    this.requestCache.set(cacheKey, requestPromise);

    // Clean up cache after timeout
    setTimeout(() => {
      this.requestCache.delete(cacheKey);
    }, this.cacheTimeout);

    return requestPromise;
  }

  /**
   * Internal method to execute the actual getMany request
   */
  private async executeGetManyRequest<T extends Event = Event>(
    pubkey: string,
    filter: any,
    timeout: number,
  ): Promise<T[]> {
    let relayUrls = await this.discoveryRelay.getUserRelayUrls(pubkey);
    relayUrls = this.relayBlock.filterBlockedRelays(
      this.relaysService.getOptimalRelays(relayUrls)
    );

    if (relayUrls.length === 0) {
      this.logger.warn('No relays available for query');
      return [];
    }

    await this.acquireSemaphore();

    try {
      // Execute the query
      const events: T[] = [];
      return new Promise<T[]>((resolve) => {
        let completed = false;
        const complete = (result: T[]) => {
          if (completed) {
            return;
          }
          completed = true;
          resolve(result);
        };

        const hardTimeout = setTimeout(() => {
          this.logger.warn('[SharedRelayService] getMany hard timeout reached, resolving with partial results', {
            relayCount: relayUrls.length,
            eventCount: events.length,
            timeout,
          });
          complete(events);
        }, timeout + 1000);

        this.#pool.subscribeEose(relayUrls, filter, {
          maxWait: timeout,
          onevent: (event) => {
            // Filter event through centralized processor (expiration, deletion, muting)
            if (!this.eventProcessor.shouldAcceptEvent(event)) {
              return;
            }
            // Add the received event to our collection
            events.push(event as T);
          },
          onclose: (reasons) => {
            if (!reasons.includes('closed automatically on eose')) {
              this.logger.error('Subscriptions closed unexpectedly', reasons);
            }
            reasons.forEach(reason => {
              if (reason) {
                relayUrls.forEach(url => {
                  this.relayBlock.recordFailure(url, reason, this.localSettings.autoRelayAuth());
                });
              }
            });

            clearTimeout(hardTimeout);
            complete(events);
          },
        });
      });
    } catch (error) {
      this.logger.error('Error fetching events', error);
      return [];
    } finally {
      this.releaseSemaphore();
    }
  }
}
