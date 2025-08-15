import {
  Injectable,
  inject,
  signal,
  computed,
  effect,
  untracked,
} from '@angular/core';
import { LoggerService } from './logger.service';
import {
  StorageService,
  Nip11Info,
  NostrEventData,
  UserMetadata,
} from './storage.service';
import { Event, kinds, SimplePool } from 'nostr-tools';
import { ApplicationStateService } from './application-state.service';
import { NotificationService } from './notification.service';
import { LocalStorageService } from './local-storage.service';
import { LayoutService } from './layout.service';
import { UtilitiesService } from './utilities.service';

export interface Relay {
  url: string;
  status?: 'connected' | 'disconnected' | 'connecting' | 'error';
  lastUsed?: number;
  timeout?: number;
}

/** THIS IS DEPRECATED! */
@Injectable({
  providedIn: 'root',
})
export class RelayService {
  // Default relay timeout duration in milliseconds (10 minute)

  readonly RELAY_TIMEOUT_COUNT = 2;
  readonly RELAY_TIMEOUT_DURATION_MINUTES = 10;
  readonly RELAY_TIMEOUT_DURATION = 60000 * this.RELAY_TIMEOUT_DURATION_MINUTES;
  // Cleanup interval for checking timeouts (every 10 seconds)
  private readonly TIMEOUT_CLEANUP_INTERVAL = 10000;

  // Default bootstrap relays
  private readonly DEFAULT_BOOTSTRAP_RELAYS = [
    'wss://discovery.eu.nostria.app/',
  ];

  private readonly logger = inject(LoggerService);
  private readonly storage = inject(StorageService);
  private readonly appState = inject(ApplicationStateService);
  private readonly notificationService = inject(NotificationService);
  private readonly localStorage = inject(LocalStorageService);
  private readonly layout = inject(LayoutService);
  private readonly utilities = inject(UtilitiesService);

  // Initialize signals with empty arrays first, then populate in constructor
  discoveryRelays: string[] = [];
  private _discoveryRelaysChanged = signal<number>(0);

  // TODO: Allow the user to set their own default relays in the settings?
  // TODO: Decided on a good default relay list.
  defaultRelays = ['wss://relay.damus.io/', 'wss://relay.primal.net/'];
  // defaultRelays = signal(this.#defaultRelays);

  // Signal to store the relays for the current user (account relays)
  // private relays = signal<Relay[]>([]);
  relays: Relay[] = [];

  relaysChanged = signal<Relay[]>([]);

  /** Relays that have received a timeout and we won't connect to before timeout completes. */
  timeouts = signal<Relay[]>([]);

  /** As relays received multiple timeouts, they will eventually be disabled and ignored. */
  disabled = signal<Relay[]>([]);

  // Computed value for public access to relays
  // userRelays = computed(() => this.relays());

  private accountPool: SimplePool | null = null;

  constructor() {
    this.logger.info('Initializing RelayService');

    // Move bootstrap relay initialization to constructor
    this.discoveryRelays = this.loadDiscoveryRelaysFromStorage();
    // this.discoveryRelays.set(this.#discoveryRelays);

    // When relays change, sync with storage
    effect(() => {
      if (this.relaysChanged()) {
        this.logger.debug(
          `Relay effect triggered with ${this.relays.length} relays`
        );

        if (this.relays.length > 0) {
          this.syncRelaysToStorage(this.relays);
        }
      }
    });

    // Set up interval to clean expired timeouts
    setInterval(() => this.cleanupTimeouts(), this.TIMEOUT_CLEANUP_INTERVAL);
  }

  getAccountPool(): SimplePool {
    return this.accountPool!;
  }

  saveDiscoveryRelays() {
    this.logger.debug(
      `Saving Discovery Relays with ${this.discoveryRelays.length} relays`
    );

    // Save to local storage
    this.localStorage.setItem(
      this.appState.DISCOVERY_RELAYS_STORAGE_KEY,
      JSON.stringify(this.discoveryRelays)
    );
  }

  createPool() {
    const pool = new SimplePool();
    return pool;
  }

  async timeoutRelays(relayUrls: string[]) {
    for (const relayUrl of relayUrls) {
      await this.timeoutRelay(relayUrl);
    }
  }

  async timeoutRelay(relayUrl: string) {
    // Don't give timeouts if the app is offline.
    if (!this.appState.isOnline()) {
      this.logger.debug('The app is offline. Do not timeout the relay.');
      return;
    }

    // Normalize URL: add trailing slash if it's a root URL without path
    const normalizedUrl = this.utilities.normalizeRelayUrl(relayUrl);

    // Some user's have "coracle" as their relay URL, which is not a valid relay URL. Disable the relay immediately.
    if (!normalizedUrl) {
      await this.storage.saveInfo(relayUrl, 'relay', {
        disabled: true,
        suspendedCount: 1,
      });
      return;
    }

    let suspendedCount = 1;

    const relayInfo = await this.storage.getInfo(normalizedUrl, 'relay');

    if (relayInfo) {
      if (relayInfo['disabled']) {
        return;
      }

      suspendedCount = relayInfo['suspendedCount'] + 1 || 1;
      relayInfo['suspendedCount'] = suspendedCount;

      if (suspendedCount >= this.RELAY_TIMEOUT_COUNT) {
        this.logger.info(
          `Relay ${normalizedUrl} timed out ${suspendedCount} times, disabling it.`
        );
        await this.storage.saveInfo(normalizedUrl, 'relay', {
          disabled: true,
          suspendedCount: suspendedCount,
        });
        return;
      }
    } else {
      await this.storage.saveInfo(normalizedUrl, 'relay', {
        disabled: false,
        suspendedCount: suspendedCount,
      });
    }

    this.logger.info(
      `Relay ${normalizedUrl} timed out ${suspendedCount} times.`
    );

    this.logger.debug(`Timeout relay: ${normalizedUrl}`);

    // Check if the relay is already in the timeouts array
    const existingRelay = this.timeouts().find(
      relay => relay.url === normalizedUrl
    );
    if (existingRelay) {
      this.logger.debug(`Relay ${normalizedUrl} is already timed out`);
      return;
    }

    const now = Date.now();

    // Add the relay to the timeouts array with specific timeout duration
    this.timeouts.update(timeouts => [
      ...timeouts,
      {
        url: normalizedUrl,
        status: 'disconnected',
        lastUsed: now,
        timeout: now + this.RELAY_TIMEOUT_DURATION,
      },
    ]);

    this.logger.debug(
      `Relay ${normalizedUrl} timed out until ${new Date(now + this.RELAY_TIMEOUT_DURATION).toISOString()}`
    );
  }

  /**
   * Removes expired timeouts from the timeouts array
   */
  private cleanupTimeouts(): void {
    const now = Date.now();
    const initialCount = this.timeouts.length;

    // Filter out expired timeouts
    this.timeouts.set(
      this.timeouts().filter(relay => {
        const isExpired = relay.timeout && relay.timeout < now;
        if (isExpired) {
          this.logger.debug(`Timeout expired for relay: ${relay.url}`);
        }
        return !isExpired;
      })
    );

    const removedCount = initialCount - this.timeouts.length;
    if (removedCount > 0) {
      this.logger.debug(`Cleaned up ${removedCount} expired relay timeouts`);
    }
  }

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
        if (Array.isArray(parsedRelays)) {
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

  getAccountRelayUrls(): string[] {
    return this.relays.map(relay => relay.url);
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

    if (!this.accountPool) {
      this.logger.error('Cannot subscribe: account pool is not initialized');
      return undefined;
    }

    // Use provided relay URLs or default to the user's relays
    const urls = relayUrls || this.getAccountRelayUrls();

    if (urls.length === 0) {
      this.logger.warn('No relays available for subscription');
      return undefined;
    }

    try {
      // Create the subscription
      const sub = this.accountPool.subscribeMany(urls, filters, {
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
        // oneose: (eose) => {
        //   if (onEose) {
        //     this.logger.debug('End of stored events reached');
        //     onEose();
        //   }
        // }
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
      ids?: string[];
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

    if (!this.accountPool) {
      this.logger.error('Cannot get events: account pool is not initialized');
      return null;
    }

    // Use provided relay URLs or default to the user's relays
    const urls = relayUrls || this.getAccountRelayUrls();

    if (urls.length === 0) {
      this.logger.warn('No relays available for query');
      return null;
    }

    try {
      // Default timeout is 5 seconds if not specified
      const timeout = options.timeout || 5000;

      // Execute the query
      const event = (await this.accountPool.get(urls, filter, {
        maxWait: timeout,
      })) as T;

      this.logger.debug(`Received event from query`, event);

      // Update lastUsed for all relays used in this query
      urls.forEach(url => this.updateRelayLastUsed(url));

      return event;
    } catch (error) {
      this.logger.error('Error fetching events', error);
      return null;
    }
  }

  /**
   * Generic function to fetch Nostr events (one-time query)
   * @param filter Filter for the query
   * @param relayUrls Optional specific relay URLs to use (defaults to user's relays)
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
    relayUrls?: string[],
    options: { timeout?: number } = {}
  ): Promise<T[]> {
    this.logger.debug('Getting events with filters:', filter);

    if (!this.accountPool) {
      this.logger.error('Cannot get events: account pool is not initialized');
      return [];
    }

    // Use provided relay URLs or default to the user's relays
    const urls = relayUrls || this.getAccountRelayUrls();

    if (urls.length === 0) {
      this.logger.warn('No relays available for query');
      return [];
    }

    try {
      // Default timeout is 5 seconds if not specified
      const timeout = options.timeout || 5000;

      // Execute the query
      const events: T[] = [];
      return new Promise<T[]>(resolve => {
        const sub = this.accountPool!.subscribeEose(urls, filter, {
          maxWait: timeout,
          onevent: event => {
            // Add the received event to our collection
            events.push(event as T);
          },
          onclose: reasons => {
            console.log('Subscriptions closed', reasons);

            // When subscription closes, resolve the promise with all collected events
            // Update lastUsed for all relays used in this query
            //urls.forEach(url => this.updateRelayLastUsed(url));

            resolve(events);
          },
        });
      });

      // this.logger.debug(`Received event from query`, event);

      // Update lastUsed for all relays used in this query
      // urls.forEach(url => this.updateRelayLastUsed(url));

      // return event;
    } catch (error) {
      this.logger.error('Error fetching events', error);
      return [];
    }
  }

  /**
   * Generic function to publish a Nostr event to specified relays
   * @param event The Nostr event to publish
   * @param relayUrls Optional specific relay URLs to use (defaults to user's relays)
   * @param options Optional options for publishing
   * @returns Promise that resolves to an object with status for each relay
   */
  async publish(event: Event, relayUrls?: string[]) {
    this.logger.debug('Publishing event:', event);

    if (!this.accountPool) {
      this.logger.error(
        'Cannot publish event: account pool is not initialized'
      );
      return null;
    }

    // Use provided relay URLs or default to the user's relays
    const urls = relayUrls || this.getAccountRelayUrls();

    if (urls.length === 0) {
      this.logger.warn('No relays available for publishing');
      return null;
    }

    try {
      // Publish the event
      const publishResults = this.accountPool.publish(urls, event);
      this.logger.debug('Publish results:', publishResults);

      // Update lastUsed for all relays used in this publish operation
      urls.forEach(url => this.updateRelayLastUsed(url));

      return publishResults;
    } catch (error) {
      this.logger.error('Error publishing event', error);
      return null;
    }
  }

  discoveryPool = new SimplePool();

  /**
   * Generic function to publish a Nostr event to specified relays
   * @param event The Nostr event to publish
   * @param relayUrls Optional specific relay URLs to use (defaults to user's relays)
   * @param options Optional options for publishing
   * @returns Promise that resolves to an object with status for each relay
   */
  async publishToDiscoveryRelays(event: Event) {
    // for (const relay of this.discoveryRelays) {
    //   await this.discoveryPool.ensureRelay(relay);
    // }

    this.logger.debug('Publishing event to Discovery Relays:', event);

    if (this.discoveryRelays.length === 0) {
      this.logger.warn('No discovery relays available for publishing');
      return null;
    }

    try {
      // Publish the event
      const publishResults = await this.discoveryPool.publish(
        this.discoveryRelays,
        event
      );
      this.logger.debug('Publish results:', publishResults);
      await this.layout.showPublishResults(publishResults, 'Relay List');

      // Update lastUsed for all relays used in this publish operation
      // urls.forEach(url => this.updateRelayLastUsed(url));

      return publishResults;
    } catch (error) {
      this.logger.error('Error publishing event', error);
      return null;
    }
  }

  /**
   * Publish an event to multiple relays with status tracking
   */
  // async publishWithTracking(event: NostrEvent, relays: string[]): Promise<void> {
  //   // Create an array of promises for publishing to each relay
  //   const promises = relays.map(relay => this.publishToRelay(relay, event));

  //   // Create a notification to track publishing status
  //   this.notificationService.addRelayPublishingNotification(
  //     event.id,
  //     event,
  //     promises,
  //     relays
  //   );
  // }

  /**
   * Publish an event to a single relay
   */
  async publishToRelay(event: Event, relayUrl: string) {
    try {
      // Your relay publishing implementation
      this.logger.debug(`Successfully published to ${relayUrl}`);
      return this.publish(event, [relayUrl]);
    } catch (error) {
      this.logger.error(`Failed to publish to ${relayUrl}:`, error);
      throw error; // Important to throw for notification tracking
    }
  }

  /**
   * Adds a bootstrap relay
   */
  addDiscoveryRelay(url: string): void {
    this.logger.debug(`Adding bootstrap relay: ${url}`);
    const normalizedUrl = this.utilities.normalizeRelayUrl(url);

    if (normalizedUrl) {
      this.discoveryRelays.push(normalizedUrl);
      this._discoveryRelaysChanged.update(val => val + 1); // Trigger change detection
    }
  }

  /**
   * Removes a bootstrap relay
   */
  removeDiscoveryRelay(url: string): void {
    this.logger.debug(`Removing bootstrap relay: ${url}`);
    this.discoveryRelays = this.discoveryRelays.filter(relay => relay !== url);
    this._discoveryRelaysChanged.update(val => val + 1); // Trigger change detection
  }

  /**
   * Resets bootstrap relays to defaults
   */
  resetDiscoveryRelays(): void {
    this.logger.debug('Resetting bootstrap relays to defaults');
    // this.discoveryRelays = this.DEFAULT_BOOTSTRAP_RELAYS;
    this._discoveryRelaysChanged.update(val => val + 1); // Trigger change detection
  }

  /**
   * Sets the list of relays for the current user
   */
  setRelays(relayUrls: string[]): void {
    this.logger.debug(`Setting ${relayUrls.length} relays for current account`);

    // Convert simple URLs to Relay objects with default properties
    const relayObjects = relayUrls.map(url => ({
      url,
      status: 'connecting' as const,
      lastUsed: Date.now(),
    }));

    // Before storing the relays, make sure that they have / at the end
    // if they are missing it. This ensures consistency in the relay URLs with SimplePool.
    relayObjects.forEach(relay => {
      if (!relay.url.endsWith('/')) {
        relay.url += '/';
      }
    });

    this.relays = relayObjects;
    this.logger.debug('Relays updated successfully');
    this.relaysChanged.set(this.relays);
  }

  /**
   * Sets the user pool
   */
  setAccountPool(pool: SimplePool): void {
    this.accountPool = pool;

    // After setting the user pool, check the online status of the relays
    this.logger.debug('User pool set, checking relay status...');

    const connectionStatuses = this.accountPool.listConnectionStatus();

    // Update relay statuses using a for...of loop
    for (const [url, status] of connectionStatuses) {
      const userRelay = this.relays.find(r => r.url === url);

      if (!userRelay) {
        this.logger.warn(`Relay ${url} not found in user relays`);
        continue;
      }

      userRelay.status = status ? 'connected' : 'disconnected';
    }
  }

  /**
   * Gets the user pool
   */
  getUserPool(): SimplePool | null {
    return this.accountPool;
  }

  /**
   * Updates the status of a specific relay
   */
  updateRelayStatus(url: string, status: Relay['status']): void {
    this.logger.debug(`Updating relay status for ${url} to ${status}`);

    const relay = this.relays.find(relay => relay.url === url);
    if (relay) {
      relay.status = status;
      relay.lastUsed = Date.now();
    }

    this.relaysChanged.set(this.relays);
  }

  /**
   * Helper method to update the lastUsed timestamp for a relay
   */
  private updateRelayLastUsed(url: string): void {
    const relay = this.relays.find(relay => relay.url === url);
    if (relay) {
      relay.lastUsed = Date.now();
    }

    // this.relays.update(relays =>
    //   relays.map(relay =>
    //     relay.url === url
    //       ? { ...relay, lastUsed: Date.now() }
    //       : relay
    //   )
    // );
  }

  /**
   * Adds a new relay to the list
   */
  addRelay(url: string): void {
    this.logger.debug(`Adding new relay: ${url}`);

    const newRelay: Relay = {
      url,
      status: 'disconnected',
      lastUsed: Date.now(),
    };

    this.relays.push(newRelay);
    this.relaysChanged.set(this.relays);

    // this.relays.update(relays => [...relays, newRelay]);
  }

  /**
   * Removes a relay from the list
   */
  removeRelay(url: string): void {
    this.logger.debug(`Removing relay: ${url}`);

    this.relays = this.relays.filter(relay => relay.url !== url);
    // this.relays.update(relays => relays.filter(relay => relay.url !== url));

    this.relaysChanged.set(this.relays);
  }

  /**
   * Clears all relays (used when logging out)
   */
  clearRelays(): void {
    this.logger.debug('Clearing all relays');
    this.relays = [];
    this.relaysChanged.set(this.relays);
  }

  /**
   * Saves the current relays to storage for the current user
   */
  private async syncRelaysToStorage(relays: Relay[]): Promise<void> {
    try {
      // Save each relay to the storage
      for (const relay of relays) {
        await this.storage.saveRelay(relay);
      }

      this.logger.debug(`Synchronized ${relays.length} relays to storage`);
    } catch (error) {
      this.logger.error('Error syncing relays to storage', error);
    }
  }

  /**
   * Save user relays to storage
   */
  // async saveUserRelays(pubkey: string): Promise<void> {
  //   try {
  //     const currentRelays = this.relays();
  //     const relayUrls = currentRelays.map(relay => relay.url);

  //     await this.storage.saveUserRelays({
  //       pubkey,
  //       relays: relayUrls,
  //       updated: Date.now()
  //     });

  //     this.logger.debug(`Saved ${relayUrls.length} relays for user ${pubkey} to storage`);
  //   } catch (error) {
  //     this.logger.error(`Error saving relays for user ${pubkey}`, error);
  //   }
  // }

  getRelaysFromRelayEvent(relayEvent: Event): string[] {
    return relayEvent.tags
      .filter(tag => tag.length >= 2 && tag[0] === 'r')
      .map(tag => tag[1]);
  }

  /**
   * Fetch NIP-11 information for a relay
   */
  async fetchNip11Info(relayUrl: string): Promise<Nip11Info | undefined> {
    try {
      this.logger.debug(`Fetching NIP-11 info for relay: ${relayUrl}`);

      // First check if we have cached NIP-11 info
      const storedRelay = await this.storage.getRelay(relayUrl);

      // If we have recent info (less than 24 hours old), use it
      if (
        storedRelay?.nip11 &&
        storedRelay.nip11.last_checked &&
        Date.now() - storedRelay.nip11.last_checked < 86400000
      ) {
        this.logger.debug(`Using cached NIP-11 info for ${relayUrl}`);
        return storedRelay.nip11;
      }

      // Convert WebSocket URL to HTTP for NIP-11 document
      const httpUrl = relayUrl.replace(/^wss?:\/\//, 'https://');

      const response = await fetch(`${httpUrl}`, {
        headers: {
          Accept: 'application/nostr+json',
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch NIP-11 info: ${response.status} ${response.statusText}`
        );
      }

      const nip11Data = await response.json();
      this.logger.debug(`Received NIP-11 info for ${relayUrl}`, nip11Data);

      // Save to storage
      const relayToSave: Relay = {
        url: relayUrl,
        lastUsed: Date.now(),
        status: storedRelay?.status || 'disconnected',
      };

      await this.storage.saveRelay(relayToSave, nip11Data);

      return nip11Data;
    } catch (error) {
      this.logger.error(`Error fetching NIP-11 info for ${relayUrl}`, error);
      return undefined;
    }
  }

  public discoveryRelaysChanged() {
    // Return a copy of the array to ensure change detection works properly
    return [...this.discoveryRelays];
  }

  async setDiscoveryRelays(relays: string[]): Promise<void> {
    this.discoveryRelays = relays;
    this._discoveryRelaysChanged.update(val => val + 1); // Trigger change detection
  }
}
