import { inject, signal, Signal } from '@angular/core';
import { LoggerService } from '../logger.service';
import { Event, SimplePool } from 'nostr-tools';
import { RelaysService } from './relays';

export interface Relay {
  url: string;
  status?: 'connected' | 'disconnected' | 'connecting' | 'error';
  lastUsed?: number;
  timeout?: number;
}

export abstract class RelayServiceBase {
  #pool!: SimplePool;
  protected relayUrls: string[] = [];
  protected logger = inject(LoggerService);
  protected relaysService = inject(RelaysService);
  protected useOptimizedRelays = false;

  // Signal to notify when relays have been modified
  protected relaysModified = signal<string[]>([]);

  // Basic concurrency control for base class
  protected readonly maxConcurrentRequests = 2;
  protected currentRequests = 0;
  protected requestQueue: (() => void)[] = [];

  // Signal to store the relays
  // relays: Relay[] = [];
  relays = signal<Relay[]>([]);

  constructor(pool: SimplePool) {
    this.#pool = pool;
  }

  getPool(): SimplePool {
    return this.#pool;
  }

  /** Inits the relay URLs. Make sure URLs are normalized before setting. */
  init(relayUrls: string[], destroy = false) {
    if (destroy) {
      this.destroy();
    }

    this.relayUrls = relayUrls;
    this.#pool = new SimplePool();
    this.updateRelaysSignal();
    this.notifyRelaysModified();
  }

  destroy() {
    this.#pool.destroy();
  }

  getRelayUrls(): string[] {
    return this.relayUrls;
  }

  /**
   * Get the relays modified signal for subscribing to changes
   */
  get relaysModifiedSignal(): Signal<string[]> {
    return this.relaysModified.asReadonly();
  }

  /**
   * Get the relays signal for subscribing to relay information changes
   */
  get relaysSignal(): Signal<Relay[]> {
    return this.relays.asReadonly();
  }

  /**
   * Add a relay URL to the existing list
   * @param relayUrl The relay URL to add
   */
  addRelay(relayUrl: string): void {
    if (!this.relayUrls.includes(relayUrl)) {
      this.relayUrls.push(relayUrl);
      this.updateRelaysSignal();
      this.notifyRelaysModified();
      this.logger.debug('Added relay:', relayUrl);
    }
  }

  /**
   * Remove a relay URL from the existing list
   * @param relayUrl The relay URL to remove
   */
  removeRelay(relayUrl: string): void {
    const index = this.relayUrls.indexOf(relayUrl);
    if (index > -1) {
      this.relayUrls.splice(index, 1);
      this.updateRelaysSignal();
      this.notifyRelaysModified();
      this.logger.debug('Removed relay:', relayUrl);
    }
  }

  /**
   * Update the entire relay list
   * @param relayUrls The new array of relay URLs
   */
  updateRelays(relayUrls: string[]): void {
    this.relayUrls = [...relayUrls];
    this.updateRelaysSignal();
    this.notifyRelaysModified();
    this.logger.debug('Updated relays:', relayUrls);
  }

  /**
   * Clear all relays
   */
  clearRelays(): void {
    this.relayUrls = [];
    this.updateRelaysSignal();
    this.notifyRelaysModified();
    this.logger.debug('Cleared all relays');
  }

  /**
   * Check if a relay URL exists in the list
   * @param relayUrl The relay URL to check
   */
  hasRelay(relayUrl: string): boolean {
    return this.relayUrls.includes(relayUrl);
  }

  /**
   * Get the count of current relays
   */
  getRelayCount(): number {
    return this.relayUrls.length;
  }

  /**
   * Notify subscribers that relays have been modified
   */
  private notifyRelaysModified(): void {
    this.relaysModified.set([...this.relayUrls]);
  }

  /**
   * Update the relays signal with current relay information
   */
  private updateRelaysSignal(): void {
    const relayObjects: Relay[] = this.relayUrls.map((url) => ({
      url,
      status: 'disconnected', // Default status, can be updated by connection monitoring
      lastUsed: undefined,
      timeout: undefined,
    }));
    this.relays.set(relayObjects);
  }

  /**
   * Update the status of a specific relay
   * @param relayUrl The relay URL
   * @param status The new status
   */
  updateRelayStatus(
    relayUrl: string,
    status: 'connected' | 'disconnected' | 'connecting' | 'error',
  ): void {
    const currentRelays = this.relays();
    const updatedRelays = currentRelays.map((relay) =>
      relay.url === relayUrl ? { ...relay, status } : relay,
    );
    this.relays.set(updatedRelays);
  }

  /**
   * Update the lastUsed timestamp of a specific relay
   * @param relayUrl The relay URL
   * @param timestamp The timestamp (in seconds, as per Nostr protocol)
   */
  updateRelayLastUsed(relayUrl: string, timestamp?: number): void {
    const currentRelays = this.relays();
    const lastUsed = timestamp || Math.floor(Date.now() / 1000);
    const updatedRelays = currentRelays.map((relay) =>
      relay.url === relayUrl ? { ...relay, lastUsed } : relay,
    );
    this.relays.set(updatedRelays);
  }

  /**
   * Update the timeout of a specific relay
   * @param relayUrl The relay URL
   * @param timeout The timeout value in milliseconds
   */
  updateRelayTimeout(relayUrl: string, timeout: number): void {
    const currentRelays = this.relays();
    const updatedRelays = currentRelays.map((relay) =>
      relay.url === relayUrl ? { ...relay, timeout } : relay,
    );
    this.relays.set(updatedRelays);
  }

  /**
   * Acquires a semaphore slot for making a request
   */
  protected async acquireSemaphore(): Promise<void> {
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
  protected releaseSemaphore(): void {
    this.currentRequests--;
    const nextRequest = this.requestQueue.shift();
    if (nextRequest) {
      nextRequest();
    }
  }

  async getEventsByPubkeyAndKind(pubkey: string | string[], kind: number): Promise<Event[]> {
    // Check if pubkey is already an array or a single string
    const authors = Array.isArray(pubkey) ? pubkey : [pubkey];

    return this.getMany({
      authors,
      kinds: [kind],
    });
  }

  async getEventsByKindAndEventTag(kind: number, eventTag: string | string[]): Promise<Event[]> {
    const events = Array.isArray(eventTag) ? eventTag : [eventTag];

    return this.getMany({
      '#e': events,
      kinds: [kind],
    });
  }

  async getEventByPubkeyAndKind(pubkey: string | string[], kind: number): Promise<Event | null> {
    // Check if pubkey is already an array or a single string
    const authors = Array.isArray(pubkey) ? pubkey : [pubkey];

    return this.get({
      authors,
      kinds: [kind],
    });
  }

  async getEventById(id: string): Promise<Event | null> {
    return this.get({
      ids: [id],
    });
  }

  async getEventsByKindAndPubKeyTag(pubkey: string | string[], kind: number): Promise<Event[]> {
    const authors = Array.isArray(pubkey) ? pubkey : [pubkey];

    return this.getMany({
      '#p': authors,
      kinds: [kind],
    });
  }

  async getEventByPubkeyAndKindAndTag(
    pubkey: string,
    kind: number,
    tag: { key: string; value: string },
  ): Promise<Event | null> {
    const authors = Array.isArray(pubkey) ? pubkey : [pubkey];

    return this.get({
      authors,
      [`#${tag.key}`]: [tag.value],
      kinds: [kind],
    });
  }

  /**
   * Generic function to fetch Nostr events (one-time query) with concurrency control
   * @param filter Filter for the query
   * @param options Optional options for the query
   * @returns Promise that resolves to a single event
   */
  async get<T extends Event = Event>(
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
    let urls = this.relayUrls;

    if (this.useOptimizedRelays) {
      urls = this.relaysService.getOptimalRelays(this.relayUrls);
    }

    // Check if the value of "authors" array starts with "npub" or not.
    const isNpub = filter.authors?.some((author) => author.startsWith('npub'));

    if (isNpub) {
    }

    this.logger.debug('Getting events with filters (account-relay):', filter, urls);

    if (urls.length === 0) {
      this.logger.warn('No relays available for query');
      return null;
    }

    await this.acquireSemaphore();

    try {
      // Default timeout is 5 seconds if not specified
      const timeout = options.timeout || 5000;

      // Execute the query
      const event = (await this.#pool.get(urls, filter, {
        maxWait: timeout,
      })) as T;

      this.logger.debug(`Received event from query`, event);

      // Update lastUsed for all relays used in this query
      if (event) {
        urls.forEach((url) => {
          this.updateRelayLastUsed(url);
          // Track relay statistics: mark as connected and increment event count
          this.relaysService.updateRelayConnection(url, true);
          this.relaysService.incrementEventCount(url);
        });
      } else {
        // No event received, but relays were contacted
        urls.forEach((url) => {
          this.relaysService.updateRelayConnection(url, true);
        });
      }

      return event;
    } catch (error) {
      this.logger.error('Error fetching events', error);

      // Track connection retries for failed connections
      urls.forEach((url) => {
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
   * @param filter Filter for the query
   * @param options Optional options for the query
   * @returns Promise that resolves to an array of events
   */
  async getMany<T extends Event = Event>(
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
    let urls = this.relayUrls;

    if (this.useOptimizedRelays) {
      urls = this.relaysService.getOptimalRelays(this.relayUrls);
    }

    // Check if the value of "authors" array starts with "npub" or not.
    const isNpub = filter.authors?.some((author) => author.startsWith('npub'));

    if (isNpub) {
    }

    this.logger.debug('Getting events with filters (account-relay):', filter, urls);

    if (urls.length === 0) {
      this.logger.warn('No relays available for query');
      return [];
    }

    await this.acquireSemaphore();

    try {
      // Default timeout is 5 seconds if not specified
      const timeout = options.timeout || 5000;

      // Execute the query
      const events: T[] = [];
      return new Promise<T[]>((resolve) => {
        this.#pool!.subscribeEose(urls, filter, {
          maxWait: timeout,
          onevent: (event) => {
            // Add the received event to our collection
            events.push(event as T);
          },
          onclose: (reasons) => {
            console.log('Subscriptions closed', reasons);
            // Update lastUsed for all relays used in this query if we received events
            if (events.length > 0) {
              urls.forEach((url) => this.updateRelayLastUsed(url));
            }
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

  /**
   * Generic function to publish a Nostr event to specified relays
   * @param event The Nostr event to publish
   * @param relayUrls Optional specific relay URLs to use (defaults to user's relays)
   * @param options Optional options for publishing
   * @returns Promise that resolves to an object with status for each relay
   */
  async publish(event: Event) {
    this.logger.debug('Publishing event:', event);

    if (!this.#pool) {
      this.logger.error('Cannot publish event: account pool is not initialized');
      return null;
    }

    // Use provided relay URLs or default to the user's relays
    const urls = this.relayUrls;

    if (urls.length === 0) {
      this.logger.warn('No relays available for publishing');
      return null;
    }

    try {
      // Publish the event
      const publishResults = this.#pool.publish(urls, event);
      this.logger.debug('Publish results:', publishResults);

      const result1 = await publishResults[0];
      console.log('Publish result for first relay:', result1);

      // Update lastUsed for all relays used in this publish operation
      urls.forEach((url) => this.updateRelayLastUsed(url));

      return publishResults;
    } catch (error) {
      this.logger.error('Error publishing event', error);
      return null;
    }
  }

  /**
   * Generic function to publish a Nostr event to specified relays
   * @param event The Nostr event to publish
   * @param relayUrls Optional specific relay URLs to use (defaults to user's relays)
   * @param options Optional options for publishing
   * @returns Promise that resolves to an object with status for each relay
   */
  async publishToRelay(event: Event, relayUrls: string | string[]) {
    this.logger.debug('Publishing event:', event);

    if (!this.#pool) {
      this.logger.error('Cannot publish event: account pool is not initialized');
      return null;
    }

    const urls = Array.isArray(relayUrls) ? relayUrls : [relayUrls];

    if (urls.length === 0) {
      this.logger.warn('No relays available for publishing');
      return null;
    }

    try {
      // Publish the event
      const publishResults = this.#pool.publish(urls, event);
      this.logger.debug('Publish results:', publishResults);

      // Update lastUsed for all relays used in this publish operation
      urls.forEach((url) => this.updateRelayLastUsed(url));

      return publishResults;
    } catch (error) {
      this.logger.error('Error publishing event', error);
      return null;
    }
  }

  /**
   * Generic function to subscribe to Nostr events
   * @param filters Array of filter objects for the subscription
   * @param onEvent Callback function that will be called for each event received
   * @param onEose Callback function that will be called when EOSE (End Of Stored Events) is received
   * @param relayUrls Optional specific relay URLs to use (defaults to user's relays)
   * @returns Subscription object with unsubscribe method
   */
  subscribe<T extends Event = Event>(
    filters: {
      kinds?: number[];
      authors?: string[];
      '#e'?: string[];
      '#p'?: string[];
      since?: number;
      until?: number;
      limit?: number;
    }[],
    onEvent: (event: T) => void,
    onEose?: () => void,
  ) {
    this.logger.debug('Creating subscription with filters:', filters);

    let urls = this.relayUrls;

    if (this.useOptimizedRelays) {
      urls = this.relaysService.getOptimalRelays(this.relayUrls);
    }

    if (!this.#pool) {
      this.logger.error('Cannot subscribe: user pool is not initialized');
      return {
        unsubscribe: () => {
          this.logger.debug('No subscription to unsubscribe from');
        },
      };
    }

    // Use provided relay URLs or default to the user's relays
    if (urls.length === 0) {
      this.logger.warn('No relays available for subscription');
      return {
        unsubscribe: () => {
          this.logger.debug('No subscription to unsubscribe from (no relays)');
        },
      };
    }

    try {
      // Create the subscription
      const sub = this.#pool.subscribeMany(urls, filters, {
        onevent: (evt) => {
          this.logger.debug(`Received event of kind ${evt.kind}`);

          // Update the lastUsed timestamp for all relays (since we don't know which relay sent this event)
          urls.forEach((url) => {
            this.updateRelayLastUsed(url);
            // Track relay statistics: mark as connected and increment event count
            this.relaysService.updateRelayConnection(url, true);
            this.relaysService.incrementEventCount(url);
          });

          // Call the provided event handler
          onEvent(evt as T);
        },
        onclose: (reasons) => {
          console.log('Pool closed', reasons);
          if (onEose) {
            this.logger.debug('End of stored events reached');
            onEose();
          }
          // Also changed this to an arrow function for consistency
        },
        oneose: () => {
          if (onEose) {
            this.logger.debug('End of stored events reached');
            onEose();
          }
        },
      });

      // Return an object with close method
      return {
        close: () => {
          this.logger.debug('Close from events');
          sub.close();
        },
      };
    } catch (error) {
      this.logger.error('Error creating subscription', error);
      return {
        close: () => {
          this.logger.debug('Error subscription close called');
        },
      };
    }
  }

  /**
   * Generic function to subscribe to Nostr events
   * @param filters Array of filter objects for the subscription
   * @param onEvent Callback function that will be called for each event received
   * @param onEose Callback function that will be called when EOSE (End Of Stored Events) is received
   * @param relayUrls Optional specific relay URLs to use (defaults to user's relays)
   * @returns Subscription object with unsubscribe method
   */
  subscribeEose<T extends Event = Event>(
    filters: {
      kinds?: number[];
      authors?: string[];
      '#e'?: string[];
      '#p'?: string[];
      since?: number;
      until?: number;
      limit?: number;
    }[],
    onEvent: (event: T) => void,
    onEose?: () => void,
  ) {
    this.logger.debug('Creating subscription with filters:', filters);

    let urls = this.relayUrls;

    if (this.useOptimizedRelays) {
      urls = this.relaysService.getOptimalRelays(this.relayUrls);
    }

    if (!this.#pool) {
      this.logger.error('Cannot subscribe: user pool is not initialized');
      return {
        unsubscribe: () => {
          this.logger.debug('No subscription to unsubscribe from');
        },
      };
    }

    // Use provided relay URLs or default to the user's relays
    if (urls.length === 0) {
      this.logger.warn('No relays available for subscription');
      return {
        unsubscribe: () => {
          this.logger.debug('No subscription to unsubscribe from (no relays)');
        },
      };
    }

    try {
      // Create the subscription
      const sub = this.#pool.subscribeManyEose(urls, filters, {
        onevent: (evt) => {
          this.logger.debug(`Received event of kind ${evt.kind}`);

          // Update the lastUsed timestamp for all relays (since we don't know which relay sent this event)
          urls.forEach((url) => {
            this.updateRelayLastUsed(url);
            // Track relay statistics: mark as connected and increment event count
            this.relaysService.updateRelayConnection(url, true);
            this.relaysService.incrementEventCount(url);
          });

          // Call the provided event handler
          onEvent(evt as T);
        },
        onclose: (reasons) => {
          console.log('Pool closed', reasons);
          if (onEose) {
            this.logger.debug('End of stored events reached');
            onEose();
          }
        },
      });

      // Return an object with close method
      return {
        close: () => {
          this.logger.debug('Close from events');
          sub.close();
        },
      };
    } catch (error) {
      this.logger.error('Error creating subscription', error);
      return {
        close: () => {
          this.logger.debug('Error subscription close called');
        },
      };
    }
  }
}
