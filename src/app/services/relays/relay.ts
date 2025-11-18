import { inject, signal, Signal, Injector } from '@angular/core';
import { LoggerService } from '../logger.service';
import { Event, SimplePool } from 'nostr-tools';
import { RelaysService } from './relays';
import { UtilitiesService } from '../utilities.service';
import { SubscriptionManagerService } from './subscription-manager';

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
  protected utilities = inject(UtilitiesService);
  protected injector = inject(Injector);
  protected subscriptionManager = inject(SubscriptionManagerService);
  protected useOptimizedRelays = false;

  // Pool instance identifier for tracking
  protected poolInstanceId: string;

  // Activity tracking
  protected lastActivityTime = Date.now();
  protected activeSubscriptions = new Set<string>();
  protected pendingRequests = 0;

  // Signal to notify when relays have been modified
  protected relaysModified = signal<string[]>([]);

  // Basic concurrency control for base class
  protected readonly maxConcurrentRequests = 2;
  protected currentRequests = 0;
  protected requestQueue: (() => void)[] = [];

  // Signal to store the relays
  // relays: Relay[] = [];
  relays = signal<Relay[]>([]);
  // Idempotent destroy flag
  private _destroyed = false;

  constructor(pool: SimplePool) {
    this.#pool = pool;
    // Generate unique identifier for this pool instance
    this.poolInstanceId = `${this.constructor.name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.logger.debug(`[${this.constructor.name}] Created pool instance: ${this.poolInstanceId}`);
  }

  getPool(): SimplePool {
    return this.#pool;
  }

  /**
   * Initialize (or re-initialize) relay URLs. Avoid leaking websockets by ensuring
   * the previous SimplePool is explicitly destroyed before creating a new one.
   * If only the URL list changes we just update internal state without recreating the pool.
   * @param relayUrls New relay URL list
   * @param forceRecreate When true always destroy the existing pool and create a new one
   */
  init(relayUrls: string[], forceRecreate = false) {
    const urlsChanged = this.relayUrls.length !== relayUrls.length || this.relayUrls.some((u, i) => u !== relayUrls[i]);

    // Decide whether to recreate pool
    const shouldRecreate = forceRecreate || !this.#pool || this._destroyed || urlsChanged;

    if (shouldRecreate && this.#pool && !this._destroyed) {
      // Destroy the previous pool to close underlying sockets
      try {
        this.#pool.destroy();
      } catch (e) {
        this.logger.debug(`[${this.constructor.name}] Suppressed destroy error during re-init:`, e);
      }
    }

    // Assign new pool if required
    if (shouldRecreate) {
      this.#pool = new SimplePool();
      this._destroyed = false; // Reset destroyed flag for new pool lifecycle
      this.logger.debug(`[${this.constructor.name}] Created new SimplePool (recreate=${forceRecreate}, urlsChanged=${urlsChanged})`);
    }

    this.relayUrls = relayUrls;
    this.updateRelaysSignal();
    this.notifyRelaysModified();
  }

  destroy() {
    if (this._destroyed) {
      return; // Already destroyed
    }
    this.logger.debug(`[${this.constructor.name}] destroy() called`);
    try {
      this.#pool?.destroy();
    } catch (e) {
      this.logger.debug(`[${this.constructor.name}] Suppressed destroy error:`, e);
    }
    this._destroyed = true;
    this.logger.debug(`[${this.constructor.name}] Pool destroyed`);
  }

  getRelayUrls(): string[] {
    return this.relayUrls;
  }

  /**
   * Update last activity time when instance is used
   */
  protected updateActivity(): void {
    this.lastActivityTime = Date.now();
  }

  /**
   * Track a subscription as active
   */
  protected addActiveSubscription(subscriptionId: string): void {
    this.activeSubscriptions.add(subscriptionId);
    this.updateActivity();
  }

  /**
   * Remove a subscription from active tracking
   */
  protected removeActiveSubscription(subscriptionId: string): void {
    this.activeSubscriptions.delete(subscriptionId);
    this.updateActivity();
  }

  /**
   * Track a pending request
   */
  protected incrementPendingRequests(): void {
    this.pendingRequests++;
    this.updateActivity();
  }

  /**
   * Remove a pending request
   */
  protected decrementPendingRequests(): void {
    this.pendingRequests = Math.max(0, this.pendingRequests - 1);
    this.updateActivity();
  }

  /**
   * Check if this instance is idle (no active subscriptions or pending requests)
   */
  isIdle(): boolean {
    const idle = this.activeSubscriptions.size === 0 && this.pendingRequests === 0;
    return idle;
  }

  /**
   * Get the time since last activity in milliseconds
   */
  getTimeSinceLastActivity(): number {
    return Date.now() - this.lastActivityTime;
  }

  /**
   * Check if this instance should be cleaned up due to inactivity
   */
  shouldCleanup(maxIdleTimeMs = 30000): boolean {
    // 30 seconds default
    return this.isIdle() && this.getTimeSinceLastActivity() > maxIdleTimeMs;
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
    const pubkeys = Array.isArray(pubkey) ? pubkey : [pubkey];
    // Filter out any undefined or invalid values
    const authors = pubkeys.filter(pk => pk && typeof pk === 'string');

    if (authors.length === 0) {
      this.logger.warn('getEventByPubkeyAndKind called with no valid pubkeys');
      return null;
    }

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
    const pubkeys = Array.isArray(pubkey) ? pubkey : [pubkey];
    // Filter out any undefined or invalid values
    const authors = pubkeys.filter(pk => pk && typeof pk === 'string');

    if (authors.length === 0) {
      this.logger.warn('getEventsByKindAndPubKeyTag called with no valid pubkeys');
      return [];
    }

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
   * Get effective relay URLs (with optimization if enabled)
   */
  private getEffectiveRelayUrls(): string[] {
    if (this.useOptimizedRelays) {
      return this.relaysService.getOptimalRelays(this.relayUrls);
    }
    return this.relayUrls;
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
    const urls = this.getEffectiveRelayUrls();
    if (urls.length === 0) {
      return null;
    }
    return this.getWithRelays(filter, urls, options);
  }

  /**
   * Generic function to fetch Nostr events with explicit relay URLs
   * @param filter Filter for the query
   * @param relayUrls Explicit relay URLs to use
   * @param options Optional options for the query
   * @returns Promise that resolves to a single event
   */
  async getWithRelays<T extends Event = Event>(
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
    relayUrls: string[],
    options: { timeout?: number } = {},
  ): Promise<T | null> {
    const urls = relayUrls;

    // Don't apply optimization to explicit relay URLs - use them as provided
    // if (this.useOptimizedRelays) {
    //   urls = this.relaysService.getOptimalRelays(relayUrls);
    // }

    // Check if the value of "authors" array starts with "npub" or not.
    const isNpub = filter.authors?.some((author) => author && author.startsWith('npub'));

    if (isNpub) {
      // TODO: Handle npub format if needed
    }

    // Reduced logging - only log for non-metadata and when needed
    // if (!filter.kinds?.includes(0)) {
    //   this.logger.debug(
    //     `[${this.constructor.name}] Getting events with filters (explicit relays):`,
    //     filter,
    //     urls
    //   );
    // }

    if (urls.length === 0) {
      this.logger.warn(`[${this.constructor.name}] No relays available for query`);
      return null;
    }

    // Register the request with the subscription manager
    const requestId = this.subscriptionManager.registerRequest(
      urls,
      this.constructor.name,
      this.poolInstanceId
    );

    await this.acquireSemaphore();

    // Track pending request
    this.incrementPendingRequests();

    try {
      // Default timeout is 5 seconds if not specified
      const timeout = options.timeout || 5000;

      // Reduced logging - only log for non-metadata and when needed
      // this.logger.debug(`[${this.constructor.name}] Executing query - Request ID: ${requestId}`, {...});

      // Execute the query
      const event = (await this.#pool.get(urls, filter, {
        maxWait: timeout,
      })) as T;

      // Check if event has expired according to NIP-40
      if (event && this.utilities.isEventExpired(event)) {
        this.logger.debug(
          `[${this.constructor.name}] Dropping expired event from relay: ${event.id} (kind: ${event.kind})`
        );
        return null; // Don't return expired events
      }

      // Reduced logging - removed "Received event from query" as it's too verbose
      // if (!filter.kinds?.includes(0)) {
      //   this.logger.debug(`[${this.constructor.name}] Received event from query`, event);
      // }

      // Update lastUsed for all relays used in this query
      if (event) {
        urls.forEach((url) => {
          this.updateRelayLastUsed(url);
          // Track relay statistics: mark as connected and increment event count
          this.relaysService.updateRelayConnection(url, true);
          this.relaysService.incrementEventCount(url);
          this.subscriptionManager.updateConnectionStatus(url, true, this.poolInstanceId);
        });
      } else {
        // No event received, but relays were contacted
        urls.forEach((url) => {
          this.relaysService.updateRelayConnection(url, true);
          this.subscriptionManager.updateConnectionStatus(url, true, this.poolInstanceId);
        });
      }

      return event;
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] Error fetching events`, error);

      // Track connection retries for failed connections
      urls.forEach((url) => {
        this.relaysService.recordConnectionRetry(url);
        this.relaysService.updateRelayConnection(url, false);
        this.subscriptionManager.updateConnectionStatus(url, false, this.poolInstanceId);
      });

      return null;
    } finally {
      this.releaseSemaphore();
      // Remove pending request tracking
      this.decrementPendingRequests();
      // Unregister the request
      this.subscriptionManager.unregisterRequest(requestId, urls);
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
    const urls = this.getEffectiveRelayUrls();
    if (urls.length === 0) {
      return [];
    }
    return this.getManyWithRelays(filter, urls, options);
  }

  /**
   * Generic function to fetch Nostr events with explicit relay URLs
   * @param filter Filter for the query
   * @param relayUrls Explicit relay URLs to use
   * @param options Optional options for the query
   * @returns Promise that resolves to an array of events
   */
  async getManyWithRelays<T extends Event = Event>(
    filter: {
      kinds?: number[];
      authors?: string[];
      '#e'?: string[];
      '#p'?: string[];
      since?: number;
      until?: number;
      limit?: number;
    },
    relayUrls: string[],
    options: { timeout?: number } = {},
  ): Promise<T[]> {
    const urls = relayUrls;

    // Check if the value of "authors" array starts with "npub" or not.
    const isNpub = filter.authors?.some((author) => author.startsWith('npub'));

    if (isNpub) {
      // TODO: Handle npub format if needed
    }

    // Reduced logging - only log for non-metadata and when needed
    // if (!filter.kinds?.includes(0)) {
    //   this.logger.debug('Getting events with filters (explicit relays):', filter, urls);
    // }

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
            // Check if event has expired according to NIP-40
            if (this.utilities.isEventExpired(event)) {
              this.logger.debug(`Dropping expired event from relay: ${event.id} (kind: ${event.kind})`);
              return; // Don't add expired events
            }
            // Add the received event to our collection
            events.push(event as T);
          },
          onclose: (reasons) => {
            // Check the reasons is other than "closed automatically on eose", if it is, log the error as error.
            if (!reasons.includes('closed automatically on eose')) {
              this.logger.error('Subscriptions closed unexpectedly', reasons);
            }

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

      // Lazy-load NotificationService to avoid circular dependency
      // This only creates the notification if NotificationService is available
      try {
        // Dynamically import to break circular dependency at module load time
        const { NotificationService } = await import('../notification.service');
        const notificationService = this.injector.get(NotificationService);

        // Create relay promises map for notification tracking
        const relayPromises = new Map<Promise<string>, string>();

        this.logger.debug(`Creating notification for ${publishResults.length} relay promises`);

        publishResults.forEach((promise, index) => {
          const relayUrl = urls[index];
          this.logger.debug(`Adding relay promise for: ${relayUrl}`);
          const wrappedPromise = promise
            .then(() => {
              this.logger.debug(`Relay ${relayUrl} resolved successfully`);
              return relayUrl;
            })
            .catch((error: unknown) => {
              const errorMsg = error instanceof Error ? error.message : 'Failed';
              this.logger.error(`Relay ${relayUrl} failed: ${errorMsg}`);
              throw new Error(`${relayUrl}: ${errorMsg}`);
            });
          relayPromises.set(wrappedPromise, relayUrl);
        });

        this.logger.debug(`Created relay promises map with ${relayPromises.size} entries`);

        // Create notification for tracking (don't await to not block publish)
        notificationService.addRelayPublishingNotification(event, relayPromises).catch(err => {
          this.logger.warn('Failed to create publish notification', err);
        });
      } catch (notifError) {
        // If notification service is not available or fails, just log and continue
        this.logger.debug('Could not create publish notification', notifError);
      }

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
    filter: {
      kinds?: number[];
      authors?: string[];
      ids?: string[]; // Add IDs filter support for NIP-01 prefix matching
      '#e'?: string[];
      '#p'?: string[];
      since?: number;
      until?: number;
      limit?: number;
    },
    onEvent: (event: T) => void,
    onEose?: () => void,
  ) {
    this.logger.debug(`[${this.constructor.name}] Creating subscription with filters:`, filter);

    let urls = this.relayUrls;

    if (this.useOptimizedRelays) {
      urls = this.relaysService.getOptimalRelays(this.relayUrls);
    }

    if (!this.#pool) {
      this.logger.error(`[${this.constructor.name}] Cannot subscribe: user pool is not initialized`);
      return {
        unsubscribe: () => {
          this.logger.debug(`[${this.constructor.name}] No subscription to unsubscribe from`);
        },
      };
    }

    // Use provided relay URLs or default to the user's relays
    if (urls.length === 0) {
      this.logger.warn(`[${this.constructor.name}] No relays available for subscription`);
      return {
        unsubscribe: () => {
          this.logger.debug(`[${this.constructor.name}] No subscription to unsubscribe from (no relays)`);
        },
      };
    }

    // Generate subscription ID
    const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Check for duplicate subscriptions
    const duplicateId = this.subscriptionManager.hasDuplicateSubscription(filter, urls);
    if (duplicateId) {
      this.logger.warn(
        `[${this.constructor.name}] Duplicate subscription detected, reusing existing: ${duplicateId}`,
        {
          filter,
          relayUrls: urls,
        }
      );
      // Still return a valid subscription object but log the duplication
    }

    // Try to register the subscription
    const registered = this.subscriptionManager.registerSubscription(
      subscriptionId,
      filter,
      urls,
      this.constructor.name,
      this.poolInstanceId
    );

    if (!registered) {
      this.logger.error(
        `[${this.constructor.name}] Cannot create subscription: limits reached or relay constraints violated`,
        {
          subscriptionId,
          filter,
          relayUrls: urls,
        }
      );
      return {
        close: () => {
          this.logger.debug(`[${this.constructor.name}] Attempted to close rejected subscription`);
        },
      };
    }

    try {
      this.logger.info(`[${this.constructor.name}] Creating subscription`, {
        subscriptionId,
        poolInstance: this.poolInstanceId,
        relayCount: urls.length,
        filter,
      });

      // Create the subscription
      const sub = this.#pool.subscribeMany(urls, filter, {
        onevent: (evt) => {
          // Check if event has expired according to NIP-40
          if (this.utilities.isEventExpired(evt)) {
            this.logger.debug(
              `[${this.constructor.name}] Dropping expired event from relay: ${evt.id} (kind: ${evt.kind})`
            );
            return; // Don't process expired events
          }

          this.logger.debug(`[${this.constructor.name}] Received event of kind ${evt.kind}`, {
            subscriptionId,
            eventId: evt.id,
          });

          // Update the lastUsed timestamp for all relays (since we don't know which relay sent this event)
          urls.forEach((url) => {
            this.updateRelayLastUsed(url);
            // Track relay statistics: mark as connected and increment event count
            this.relaysService.updateRelayConnection(url, true);
            this.relaysService.incrementEventCount(url);
            this.subscriptionManager.updateConnectionStatus(url, true, this.poolInstanceId);
          });

          // Call the provided event handler
          onEvent(evt as T);
        },
        onclose: (reasons) => {
          this.logger.info(`[${this.constructor.name}] Subscription closed`, {
            subscriptionId,
            reasons,
          });
          if (onEose) {
            this.logger.debug(`[${this.constructor.name}] End of stored events reached`, {
              subscriptionId,
            });
            onEose();
          }
          // Unregister the subscription
          this.subscriptionManager.unregisterSubscription(subscriptionId);
        },
        oneose: () => {
          if (onEose) {
            this.logger.debug(`[${this.constructor.name}] End of stored events reached`, {
              subscriptionId,
            });
            onEose();
          }
        },
      });

      // Track the subscription
      this.addActiveSubscription(subscriptionId);

      // Return an object with close method
      return {
        close: () => {
          this.logger.info(`[${this.constructor.name}] Closing subscription`, {
            subscriptionId,
          });
          sub.close();
          this.removeActiveSubscription(subscriptionId);
          this.subscriptionManager.unregisterSubscription(subscriptionId);
        },
      };
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] Error creating subscription`, error);
      // Make sure to unregister if subscription creation failed
      this.subscriptionManager.unregisterSubscription(subscriptionId);
      return {
        close: () => {
          this.logger.debug(`[${this.constructor.name}] Error subscription close called`);
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
    filter: {
      kinds?: number[];
      authors?: string[];
      '#e'?: string[];
      '#p'?: string[];
      since?: number;
      until?: number;
      limit?: number;
    },
    onEvent: (event: T) => void,
    onEose?: () => void,
  ) {
    this.logger.debug('Creating subscription with filters:', filter);

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
      const sub = this.#pool.subscribeManyEose(urls, filter, {
        onevent: (evt) => {
          // Check if event has expired according to NIP-40
          if (this.utilities.isEventExpired(evt)) {
            this.logger.debug(`Dropping expired event from relay: ${evt.id} (kind: ${evt.kind})`);
            return; // Don't process expired events
          }

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
