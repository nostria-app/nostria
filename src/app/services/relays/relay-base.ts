import { inject } from '@angular/core';
import { LoggerService } from '../logger.service';
import { Event, SimplePool } from 'nostr-tools';

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

  // Basic concurrency control for base class
  protected readonly maxConcurrentRequests = 2;
  protected currentRequests = 0;
  protected requestQueue: (() => void)[] = [];

  constructor(pool: SimplePool) {
    this.#pool = pool;
  }

  /** Inits the relay URLs. Make sure URLs are normalized before setting. */
  init(relayUrls: string[]) {
    this.destroy();

    this.relayUrls = relayUrls;
    this.#pool = new SimplePool();
  }

  destroy() {
    this.#pool.destroy();
  }

  getRelayUrls(): string[] {
    return this.relayUrls;
  }

  /**
   * Acquires a semaphore slot for making a request
   */
  protected async acquireSemaphore(): Promise<void> {
    return new Promise<void>(resolve => {
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

  async getEventsByPubkeyAndKind(
    pubkey: string | string[],
    kind: number
  ): Promise<Event[]> {
    // Check if pubkey is already an array or a single string
    const authors = Array.isArray(pubkey) ? pubkey : [pubkey];

    return this.getMany({
      authors,
      kinds: [kind],
    });
  }

  async getEventsByKindAndEventTag(
    kind: number,
    eventTag: string | string[]
  ): Promise<Event[]> {
    const events = Array.isArray(eventTag) ? eventTag : [eventTag];

    return this.getMany({
      '#e': events,
      kinds: [kind],
    });
  }

  async getEventByPubkeyAndKind(
    pubkey: string | string[],
    kind: number
  ): Promise<Event | null> {
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

  async getEventsByKindAndPubKeyTag(
    pubkey: string | string[],
    kind: number
  ): Promise<Event[]> {
    const authors = Array.isArray(pubkey) ? pubkey : [pubkey];

    return this.getMany({
      '#p': authors,
      kinds: [kind],
    });
  }

  async getEventByPubkeyAndKindAndTag(
    pubkey: string,
    kind: number,
    tag: { key: string; value: string }
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
    options: { timeout?: number } = {}
  ): Promise<T | null> {
    const urls = this.relayUrls;

    this.logger.debug(
      'Getting events with filters (account-relay):',
      filter,
      urls
    );

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
    options: { timeout?: number } = {}
  ): Promise<T[]> {
    // Use provided relay URLs or default to the user's relays
    const urls = this.relayUrls;

    this.logger.debug(
      'Getting events with filters (account-relay):',
      filter,
      urls
    );

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
      return new Promise<T[]>(resolve => {
        const sub = this.#pool!.subscribeEose(urls, filter, {
          maxWait: timeout,
          onevent: event => {
            // Add the received event to our collection
            events.push(event as T);
          },
          onclose: reasons => {
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
      this.logger.error(
        'Cannot publish event: account pool is not initialized'
      );
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

      // Update lastUsed for all relays used in this publish operation
      // urls.forEach(url => this.updateRelayLastUsed(url));

      return publishResults;
    } catch (error) {
      this.logger.error('Error publishing event', error);
      return null;
    }
  }
}
