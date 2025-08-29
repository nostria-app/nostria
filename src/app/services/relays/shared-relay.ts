import { Injectable, inject } from '@angular/core';
import { SimplePool, Event } from 'nostr-tools';
import { LoggerService } from '../logger.service';
import { DiscoveryRelayService } from './discovery-relay';
import { RelaysService } from './relays';

@Injectable({
  providedIn: 'root',
})
export class SharedRelayService {
  #pool = new SimplePool();
  private logger = inject(LoggerService);
  private discoveryRelay = inject(DiscoveryRelayService);
  private readonly relaysService = inject(RelaysService);

  // Semaphore for controlling concurrent requests
  private readonly maxConcurrentRequests = 3;
  private currentRequests = 0;
  private requestQueue: (() => void)[] = [];

  // Request deduplication cache
  private readonly requestCache = new Map<string, Promise<any>>();
  private readonly cacheTimeout = 1000; // 1 second cache

  /**
   * Creates a unique cache key for request deduplication
   */
  private createCacheKey(pubkey: string, filter: any, timeout: number): string {
    return JSON.stringify({ pubkey, filter, timeout });
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
    await this.acquireSemaphore();

    try {
      const event = (await this.#pool.get(relayUrls, filter, {
        maxWait: timeout,
      })) as unknown as T;
      this.logger.debug(`Received event from query`, event);
      return event;
    } catch (error) {
      this.logger.error('Error fetching events', error);
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
    this.logger.debug('Getting events with filters (account-relay):', filter);

    // Default timeout is 5 seconds if not specified
    const timeout = options.timeout || 5000;

    // Create cache key for request deduplication
    const cacheKey = this.createCacheKey(pubkey, filter, timeout);

    // Check if we already have a pending request for the same parameters
    if (this.requestCache.has(cacheKey)) {
      this.logger.debug('Returning cached request for duplicate query');
      return this.requestCache.get(cacheKey) as Promise<T | null>;
    }

    // Create the request promise
    const requestPromise = this.executeGetRequest<T>(pubkey, filter, timeout);

    // Cache the promise
    this.requestCache.set(cacheKey, requestPromise);

    // Clean up cache after timeout
    setTimeout(() => {
      this.requestCache.delete(cacheKey);
    }, this.cacheTimeout);

    return requestPromise;
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
    relayUrls = this.relaysService.getOptimalRelays(relayUrls);

    console.log('relayUrls', relayUrls);

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
    const cacheKey = this.createCacheKey(pubkey + '_many', filter, timeout);

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
    relayUrls = this.relaysService.getOptimalRelays(relayUrls);

    if (relayUrls.length === 0) {
      this.logger.warn('No relays available for query');
      return [];
    }

    await this.acquireSemaphore();

    try {
      // Execute the query
      const events: T[] = [];
      return new Promise<T[]>((resolve) => {
        const sub = this.#pool!.subscribeEose(relayUrls, filter, {
          maxWait: timeout,
          onevent: (event) => {
            // Add the received event to our collection
            events.push(event as T);
          },
          onclose: (reasons) => {
            console.log('Subscriptions closed', reasons);
            resolve(events);
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
