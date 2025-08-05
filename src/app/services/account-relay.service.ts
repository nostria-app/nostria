import {
  Injectable,
  inject,
  signal,
  computed,
  effect,
  untracked,
} from '@angular/core';
import { LoggerService } from './logger.service';
import { Event, kinds, SimplePool } from 'nostr-tools';
import { RelayService } from './relay.service';
import { UtilitiesService } from './utilities.service';
import { NostriaService } from '../interfaces';
import { LocalStorageService } from './local-storage.service';
import { ApplicationStateService } from './application-state.service';
import { StorageService } from './storage.service';
import { RelaysService } from './relays.service';

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
    this.logger.debug('Getting events with filters:', filter);

    const urls = this.relayUrls;

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
    this.logger.debug('Getting events with filters:', filter);

    // Use provided relay URLs or default to the user's relays
    const urls = this.relayUrls;

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

@Injectable({
  providedIn: 'root',
})
export class AccountRelayServiceEx extends RelayServiceBase {
  private storage = inject(StorageService);
  private utilities = inject(UtilitiesService);
  private discoveryRelay = inject(DiscoveryRelayServiceEx);

  constructor() {
    // TODO: We always create a new instance here that will be immediately destroyed by setAccount.
    super(new SimplePool());
  }

  async setAccount(pubkey: string) {
    this.destroy();

    // When the active user is changed, we need to discover their relay urls
    this.logger.debug(`Setting account relays for pubkey: ${pubkey}`);

    let relayUrls: string[] = [];

    // Get the relays URLs from storage, if available.
    let event = await this.storage.getEventByPubkeyAndKind(
      pubkey,
      kinds.RelayList
    );

    if (event) {
      this.logger.debug(`Found relay list for pubkey ${pubkey} in storage`);
      relayUrls = this.utilities.getRelayUrls(event);
    } else {
      event = await this.storage.getEventByPubkeyAndKind(
        pubkey,
        kinds.Contacts
      );

      if (event) {
        relayUrls = this.utilities.getRelayUrlsFromFollowing(event);
      }
    }

    if (relayUrls.length === 0) {
      relayUrls = await this.discoveryRelay.getUserRelayUrls(pubkey);
    }

    this.init(relayUrls);
  }

  clear() {}
}

@Injectable({
  providedIn: 'root',
})
export class UserRelayServiceEx extends RelayServiceBase {
  private discoveryRelay = inject(DiscoveryRelayServiceEx);
  private relaysService = inject(RelaysService);
  private pubkey = '';

  constructor() {
    super(new SimplePool());
  }

  /** When the active user is changed, we need to discover their relay urls */
  async setUser(pubkey: string) {
    if (this.pubkey === pubkey) {
      return;
    }

    this.pubkey = pubkey;
    const relayUrls = await this.discoveryRelay.getUserRelayUrls(pubkey);
    this.init(relayUrls);
  }

  async initialize(pubkey: string): Promise<void> {
    await this.setUser(pubkey);
  }
}

@Injectable({
  providedIn: 'root',
})
export class SharedRelayServiceEx {
  #pool = new SimplePool();
  private logger = inject(LoggerService);
  private discoveryRelay = inject(DiscoveryRelayServiceEx);
  private readonly relaysService = inject(RelaysService);

  // Semaphore for controlling concurrent requests
  private readonly maxConcurrentRequests = 3;
  private currentRequests = 0;
  private requestQueue: (() => void)[] = [];

  // Request deduplication cache
  private readonly requestCache = new Map<string, Promise<any>>();
  private readonly cacheTimeout = 1000; // 1 second cache

  constructor() {}

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
    timeout: number
  ): Promise<T | null> {
    await this.acquireSemaphore();

    try {
      const event = (await this.#pool.get(relayUrls, filter, {
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
    options: { timeout?: number } = {}
  ): Promise<T | null> {
    this.logger.debug('Getting events with filters:', filter);

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
    timeout: number
  ): Promise<T | null> {
    // Get optimal relays for the user
    const relayUrls = await this.relaysService.getOptimalUserRelays(pubkey, 3);
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
    options: { timeout?: number } = {}
  ): Promise<T[]> {
    this.logger.debug('Getting events with filters:', filter);

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
    const requestPromise = this.executeGetManyRequest<T>(
      pubkey,
      filter,
      timeout
    );

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
    timeout: number
  ): Promise<T[]> {
    const relayUrls = await this.relaysService.getOptimalUserRelays(pubkey, 3);

    if (relayUrls.length === 0) {
      this.logger.warn('No relays available for query');
      return [];
    }

    await this.acquireSemaphore();

    try {
      // Execute the query
      const events: T[] = [];
      return new Promise<T[]>(resolve => {
        const sub = this.#pool!.subscribeEose(relayUrls, filter, {
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
}

@Injectable({
  providedIn: 'root',
})
export class DiscoveryRelayServiceEx
  extends RelayServiceBase
  implements NostriaService
{
  private readonly utilities = inject(UtilitiesService);
  private localStorage = inject(LocalStorageService);
  private appState = inject(ApplicationStateService);
  private initialized = false;

  private readonly DEFAULT_BOOTSTRAP_RELAYS = [
    'wss://discovery.eu.nostria.app/',
  ];

  constructor() {
    super(new SimplePool());
  }

  async getUserRelayUrls(pubkey: string): Promise<string[]> {
    if (!this.initialized) {
      await this.load();
    }

    // Query the Discovery Relays for user relay URLs.
    // Instead of doing duplicate kinds, we will query in order to get the user relay URLs. When the global network has moved
    // away from kind 3 relay lists, this will be more optimal.
    let relayUrls: string[] = [];
    let event = await this.getEventByPubkeyAndKind(pubkey, kinds.RelayList);

    if (event) {
      relayUrls = this.utilities.getRelayUrls(event);
    } else {
      event = await this.getEventByPubkeyAndKind(pubkey, kinds.Contacts);

      if (event) {
        relayUrls = this.utilities.getRelayUrlsFromFollowing(event);
      }
    }

    // Fallback methods... should we attempt to get the relay URLs from the account relays?
    return relayUrls;
  }

  async load() {
    // Load bootstrap relays from local storage or use default ones
    const bootstrapRelays = this.loadDiscoveryRelaysFromStorage();
    this.init(bootstrapRelays);
    this.initialized = true;
  }

  clear() {}

  /**
   * Loads bootstrap relays from local storage
   */
  private loadDiscoveryRelaysFromStorage(): string[] {
    try {
      const storedRelays = this.localStorage.getItem(
        this.appState.DISCOVERY_RELAYS_STORAGE_KEY
      );
      if (storedRelays) {
        const parsedRelays = JSON.parse(storedRelays);
        if (Array.isArray(parsedRelays) && parsedRelays.length > 0) {
          this.logger.debug(
            `Loaded ${parsedRelays.length} discovery relays from storage`
          );
          return parsedRelays;
        }
      }
    } catch (error) {
      this.logger.error('Error loading discovery relays from storage', error);
    }
    return this.DEFAULT_BOOTSTRAP_RELAYS;
  }
}

@Injectable({
  providedIn: 'root',
})
export class AccountRelayService {
  private logger = inject(LoggerService);
  // private nostr = inject(NostrService);
  // private appState = inject(ApplicationStateService);
  // private notification = inject(NotificationService);
  // private localStorage = inject(LocalStorageService);
  private relay = inject(RelayService);
  userRelaysFound = signal<boolean>(true);
  pool = new SimplePool();

  // Signal to store the relays for the current user (account relays)
  // private relays = signal<Relay[]>([]);
  // relays: Relay[] = [];

  // relaysChanged = signal<Relay[]>([]);

  // /** Holds the metadata event for all accounts in the app. */
  // // accountsMetadata = signal<NostrRecord[]>([]);

  // accountRelays = computed(() => {
  //     return this.relaysChanged();
  // });

  // accountRelayUrls = computed(() => {
  //     return this.accountRelays().map((r) => r.url);
  // });

  constructor() {
    // // When relays change, sync with storage
    // effect(() => {
    //     if (this.relaysChanged()) {
    //         this.logger.debug(`Relay effect triggered with ${this.relays.length} relays`);
    //         if (this.relays.length > 0) {
    //             this.syncRelaysToStorage(this.relays);
    //         }
    //     }
    // });
  }

  // /**
  //  * Clears all relays (used when logging out)
  //  */
  // clearRelays(): void {
  //     this.logger.debug('Clearing all relays');
  //     this.relays = [];
  //     this.relaysChanged.set(this.relays);
  // }

  // /**
  //  * Adds a new relay to the list
  //  */
  // addRelay(url: string): void {
  //     this.logger.debug(`Adding new relay: ${url}`);

  //     const newRelay: Relay = {
  //         url,
  //         status: 'disconnected',
  //         lastUsed: Date.now()
  //     };

  //     this.relays.push(newRelay);
  //     this.relaysChanged.set(this.relays);

  //     // this.relays.update(relays => [...relays, newRelay]);
  // }

  // /**
  //  * Sets the list of relays for the current user
  //  */
  // setRelays(relayUrls: string[]): void {
  //     this.logger.debug(`Setting ${relayUrls.length} relays for current account`);

  //     // Convert simple URLs to Relay objects with default properties
  //     const relayObjects = relayUrls.map(url => ({
  //         url,
  //         status: 'connecting' as const,
  //         lastUsed: Date.now()
  //     }));

  //     // Before storing the relays, make sure that they have / at the end
  //     // if they are missing it. This ensures consistency in the relay URLs with SimplePool.
  //     relayObjects.forEach(relay => {
  //         if (!relay.url.endsWith('/')) {
  //             relay.url += '/';
  //         }
  //     });

  //     this.relays = relayObjects;
  //     this.logger.debug('Relays updated successfully');
  //     this.relaysChanged.set(this.relays);
  // }

  // /**
  //  * Gets the user pool
  //  */
  // // getUserPool(): SimplePool | null {
  // //   return this.accountPool;
  // // }

  // /**
  //  * Updates the status of a specific relay
  //  */
  // updateRelayStatus(url: string, status: Relay['status']): void {
  //     this.logger.debug(`Updating relay status for ${url} to ${status}`);

  //     const relay = this.relays.find(relay => relay.url === url);
  //     if (relay) {
  //         relay.status = status;
  //         relay.lastUsed = Date.now();
  //     }

  //     this.relaysChanged.set(this.relays);
  // }

  // /**
  //  * Helper method to update the lastUsed timestamp for a relay
  //  */
  // private updateRelayLastUsed(url: string): void {
  //     const relay = this.relays.find(relay => relay.url === url);
  //     if (relay) {
  //         relay.lastUsed = Date.now();
  //     }

  //     // this.relays.update(relays =>
  //     //   relays.map(relay =>
  //     //     relay.url === url
  //     //       ? { ...relay, lastUsed: Date.now() }
  //     //       : relay
  //     //   )
  //     // );
  // }

  // /**
  //  * Removes a relay from the list
  //  */
  // removeRelay(url: string): void {
  //     this.logger.debug(`Removing relay: ${url}`);

  //     this.relays = this.relays.filter(relay => relay.url !== url);
  //     // this.relays.update(relays => relays.filter(relay => relay.url !== url));

  //     this.relaysChanged.set(this.relays);
  // }

  // /**
  //  * Saves the current relays to storage for the current user
  //  */
  // private async syncRelaysToStorage(relays: Relay[]): Promise<void> {
  //     try {
  //         // Save each relay to the storage
  //         for (const relay of relays) {
  //             await this.storage.saveRelay(relay);
  //         }

  //         this.logger.debug(`Synchronized ${relays.length} relays to storage`);
  //     } catch (error) {
  //         this.logger.error('Error syncing relays to storage', error);
  //     }
  // }

  config: any = {};
  // relayUrls: string[] = [];

  // async initialize(pubkey: string, config?: { customConfig?: any, customRelays?: string[] }) {
  //     let relayUrls = await this.nostr.getRelays(pubkey);

  //     // If no relays were found, we will fall back to using the account relays. This is especially
  //     // important when the current logged-on user opens their own profile page and does NOT have
  //     // any relay list discovered yet.
  //     if (relayUrls.length === 0) {
  //         this.logger.warn(`No relays found for user ${pubkey}, falling back to account relays`);
  //         relayUrls = this.accountRelayUrls();
  //         this.userRelaysFound.set(false);

  //         // Log additional info for debugging
  //         this.logger.debug(`Using ${relayUrls.length} account relays as fallback:`, relayUrls);
  //     } else {
  //         this.logger.debug(`Found ${relayUrls.length} relays for user ${pubkey}:`, relayUrls);
  //     }

  //     this.relayUrls = relayUrls;
  // }

  /**
   * Sets the user pool
   */
  // setAccountPool(pool: SimplePool): void {
  //     this.pool = pool;

  //     // After setting the user pool, check the online status of the relays
  //     this.logger.debug('Account pool set, checking relay status...');

  //     const connectionStatuses = this.pool.listConnectionStatus();

  //     // Update relay statuses using a for...of loop
  //     for (const [url, status] of connectionStatuses) {
  //         const userRelay = this.accountRelays().find(r => r.url === url);

  //         if (!userRelay) {
  //             this.logger.warn(`Relay ${url} not found in account relays`);
  //             continue;
  //         }

  //         userRelay.status = status ? 'connected' : 'disconnected';
  //     }
  // }

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
   * Generic function to fetch Nostr events (one-time query)
   * @param filter Filter for the query
   * @param relayUrls Optional specific relay URLs to use (defaults to user's relays)
   * @param options Optional options for the query
   * @returns Promise that resolves to an array of events
   */
  async get<T extends Event = Event>(
    filter: {
      kinds?: number[];
      authors?: string[];
      '#e'?: string[];
      '#p'?: string[];
      since?: number;
      until?: number;
      limit?: number;
    },
    relayUrls?: string[],
    options: { timeout?: number } = {}
  ): Promise<T | null> {
    this.logger.debug('Getting events with filters:', filter);

    if (!this.pool) {
      this.logger.error('Cannot get events: user pool is not initialized');
      return null;
    }

    try {
      // Default timeout is 5 seconds if not specified
      const timeout = options.timeout || 5000;

      // Execute the query
      const event = (await this.pool.get(
        this.relay.getAccountRelayUrls(),
        filter,
        { maxWait: timeout }
      )) as T;

      this.logger.debug(`Received event from query`, event);

      return event;
    } catch (error) {
      this.logger.error('Error fetching events', error);
      return null;
    }
  }

  publish(event: Event): Promise<string>[] | undefined {
    this.logger.debug('Publishing event:', event);

    if (!this.pool) {
      this.logger.error('Cannot publish event: user pool is not initialized');
      return;
    }

    try {
      // Publish the event to all relays
      return this.pool.publish(this.relay.getAccountRelayUrls(), event);
    } catch (error) {
      this.logger.error('Error publishing event', error);
    }

    return;
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
    relayUrls?: string[]
  ) {
    this.logger.debug('Creating subscription with filters:', filters);

    if (!this.pool) {
      this.logger.error('Cannot subscribe: user pool is not initialized');
      return {
        unsubscribe: () => {
          this.logger.debug('No subscription to unsubscribe from');
        },
      };
    }

    // Use provided relay URLs or default to the user's relays
    if (this.relay.getAccountRelayUrls().length === 0) {
      this.logger.warn('No relays available for subscription');
      return {
        unsubscribe: () => {
          this.logger.debug('No subscription to unsubscribe from (no relays)');
        },
      };
    }

    try {
      // Create the subscription
      const sub = this.pool.subscribeMany(
        this.relay.getAccountRelayUrls(),
        filters,
        {
          onevent: evt => {
            this.logger.debug(`Received event of kind ${evt.kind}`);

            // Update the lastUsed timestamp for this relay
            // this.updateRelayLastUsed(relay);

            // Call the provided event handler
            onEvent(evt as T);

            // console.log('Event received', evt);

            // if (evt.kind === kinds.Contacts) {
            //   const followingList = this.storage.getPTagsValues(evt);
            //   console.log(followingList);
            // this.followingList.set(followingList);
            // this.profileState.followingList.set(followingList);

            // this.storage.saveEvent(evt);

            // Now you can use 'this' here
            // For example: this.handleContacts(evt);
            // }
          },
          onclose: reasons => {
            console.log('Pool closed', reasons);
            // Also changed this to an arrow function for consistency
          },
          oneose: () => {
            if (onEose) {
              this.logger.debug('End of stored events reached');
              onEose();
            }
          },
        }
      );

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

  // async getEventByPubkeyAndKindAndTag(pubkey: string | string[], kind: number, tag: string[]): Promise<NostrEvent | null> {
  //     return this.get({
  //         "#d": pubkey,
  //         kinds: [kind]
  //     });
  // }
}
