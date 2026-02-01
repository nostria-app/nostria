import { inject, signal, Signal, Injector } from '@angular/core';
import { LoggerService } from '../logger.service';
import { Event, SimplePool, Filter } from 'nostr-tools';
import { RelaysService } from './relays';
import { UtilitiesService } from '../utilities.service';
import { SubscriptionManagerService } from './subscription-manager';
import { RelayAuthService } from './relay-auth.service';

// Forward reference to avoid circular dependency
let EventProcessorServiceRef: any;

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
  protected relayAuth = inject(RelayAuthService);
  // Lazy-loaded to avoid circular dependency (relay.ts -> EventProcessorService -> DeletionFilterService -> AccountRelayService -> relay.ts)
  private _eventProcessor?: any;
  protected get eventProcessor(): any {
    if (!this._eventProcessor) {
      if (!EventProcessorServiceRef) {
        EventProcessorServiceRef = require('../event-processor.service').EventProcessorService;
      }
      this._eventProcessor = this.injector.get(EventProcessorServiceRef);
    }
    return this._eventProcessor;
  }
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
  protected readonly maxConcurrentRequests = 10;
  protected currentRequests = 0;
  protected requestQueue: (() => void)[] = [];

  // Request deduplication cache for get() requests
  // Key: JSON stringified filter, Value: Promise of the request
  protected readonly getRequestCache = new Map<string, Promise<Event | null>>();
  protected readonly GET_CACHE_TIMEOUT = 5000; // 5 seconds cache

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
   * Check if the relay service has been initialized with relay URLs.
   * @returns true if relay URLs have been set, false otherwise
   */
  isInitialized(): boolean {
    return this.relayUrls.length > 0 && !this._destroyed;
  }

  /**
   * Initialize (or re-initialize) relay URLs. Avoid leaking websockets by ensuring
   * the previous SimplePool is explicitly destroyed before creating a new one.
   * If only the URL list changes we just update internal state without recreating the pool.
   * @param relayUrls New relay URL list
   * @param forceRecreate When true always destroy the existing pool and create a new one
   */
  init(relayUrls: string[], forceRecreate = false) {
    // Filter out insecure ws:// relays - they cannot be used from secure context
    const secureUrls = relayUrls.filter(url => !url.startsWith('ws://'));
    if (secureUrls.length < relayUrls.length) {
      const filtered = relayUrls.length - secureUrls.length;
      this.logger.warn(`[${this.constructor.name}] Filtered out ${filtered} insecure ws:// relay(s) - secure context requires wss://`);
    }

    const urlsChanged = this.relayUrls.length !== secureUrls.length || this.relayUrls.some((u, i) => u !== secureUrls[i]);

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

    this.relayUrls = secureUrls;
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
   * Filter relay URLs to exclude those that have failed authentication.
   * Returns the filtered URLs and logs a warning if all relays were filtered out.
   * 
   * @param urls Array of relay URLs to filter
   * @returns Object with filtered URLs and whether the operation should proceed
   */
  protected filterAuthFailedRelays(urls: string[]): { urls: string[]; shouldProceed: boolean } {
    const filteredUrls = this.relayAuth.filterAuthFailedRelays(urls);
    if (filteredUrls.length === 0) {
      this.logger.warn(`[${this.constructor.name}] All relays have failed authentication, cannot execute operation`);
      return { urls: [], shouldProceed: false };
    }
    if (filteredUrls.length < urls.length) {
      this.logger.debug(`[${this.constructor.name}] Filtered out ${urls.length - filteredUrls.length} auth-failed relays`);
    }
    return { urls: filteredUrls, shouldProceed: true };
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
   * Move a relay from one position to another
   * @param fromIndex The current index of the relay
   * @param toIndex The target index for the relay
   */
  moveRelay(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= this.relayUrls.length ||
      toIndex < 0 || toIndex >= this.relayUrls.length) {
      this.logger.warn('Invalid relay move indices:', { fromIndex, toIndex, length: this.relayUrls.length });
      return;
    }
    const [movedRelay] = this.relayUrls.splice(fromIndex, 1);
    this.relayUrls.splice(toIndex, 0, movedRelay);
    this.updateRelaysSignal();
    this.notifyRelaysModified();
    this.logger.debug('Moved relay:', { fromIndex, toIndex, relay: movedRelay });
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
      limit: 500, // Max limit allowed by most relays
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

    if (urls.length === 0) {
      this.logger.warn(`[${this.constructor.name}] No relays available for query`);
      return null;
    }

    // Create cache key for request deduplication
    const cacheKey = JSON.stringify({ filter, urls: urls.sort() });

    // Check for existing pending request SYNCHRONOUSLY
    if (this.getRequestCache.has(cacheKey)) {
      if (filter.kinds?.includes(0)) {
        this.logger.debug(`[${this.constructor.name}] Dedup: returning cached request for authors: ${filter.authors?.[0]?.substring(0, 8)}...`);
      }
      return this.getRequestCache.get(cacheKey) as Promise<T | null>;
    }

    // Create deferred promise and cache it SYNCHRONOUSLY before any async work
    let resolvePromise: (value: T | null) => void;
    let rejectPromise: (error: unknown) => void;
    const requestPromise = new Promise<T | null>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    // Cache the promise IMMEDIATELY (synchronously)
    this.getRequestCache.set(cacheKey, requestPromise as Promise<Event | null>);

    // Clean up cache after timeout
    setTimeout(() => {
      this.getRequestCache.delete(cacheKey);
    }, this.GET_CACHE_TIMEOUT);

    // Now do the async work
    try {
      const result = await this.executeGetWithRelays<T>(filter, urls, options);
      resolvePromise!(result);
      return result;
    } catch (error) {
      rejectPromise!(error as unknown);
      throw error;
    }
  }

  /**
   * Internal method to execute the actual relay request
   */
  private async executeGetWithRelays<T extends Event = Event>(
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
    urls: string[],
    options: { timeout?: number } = {},
  ): Promise<T | null> {
    // Filter out relays that have failed authentication
    const authResult = this.filterAuthFailedRelays(urls);
    if (!authResult.shouldProceed) {
      return null;
    }
    urls = authResult.urls;

    // Don't apply optimization to explicit relay URLs - use them as provided
    // if (this.useOptimizedRelays) {
    //   urls = this.relaysService.getOptimalRelays(relayUrls);
    // }

    // Check if the value of "authors" array starts with "npub" or not.
    const isNpub = filter.authors?.some((author) => author && author.startsWith('npub'));

    if (isNpub) {
      // TODO: Handle npub format if needed
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

      // Process event through central event processor
      // This handles: expiration (NIP-40), deletion (NIP-09), muting (NIP-51)
      if (event && !this.eventProcessor.shouldAcceptEvent(event)) {
        this.logger.debug(
          `[${this.constructor.name}] Event filtered out: ${event.id} (kind: ${event.kind})`
        );
        return null;
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
   * @param filter Filter for the query (supports all nostr-tools filter properties including tag filters like #t, #e, #p)
   * @param options Optional options for the query
   * @returns Promise that resolves to an array of events
   */
  async getMany<T extends Event = Event>(
    filter: Filter,
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
   * @param filter Filter for the query (supports all nostr-tools filter properties including tag filters like #t, #e, #p)
   * @param relayUrls Explicit relay URLs to use
   * @param options Optional options for the query
   * @returns Promise that resolves to an array of events
   */
  async getManyWithRelays<T extends Event = Event>(
    filter: Filter,
    relayUrls: string[],
    options: { timeout?: number } = {},
  ): Promise<T[]> {
    // Filter out relays that have failed authentication
    const authResult = this.filterAuthFailedRelays(relayUrls);
    if (!authResult.shouldProceed) {
      return [];
    }
    const urls = authResult.urls;

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

    // Get auth callback for NIP-42 authentication
    const authCallback = this.relayAuth.getAuthCallback();

    try {
      // Default timeout is 5 seconds if not specified
      const timeout = options.timeout || 5000;

      // Execute the query
      const events: T[] = [];
      return new Promise<T[]>((resolve) => {
        this.#pool!.subscribeEose(urls, filter, {
          maxWait: timeout,
          onauth: authCallback,
          onevent: (event) => {
            // Process event through centralized filter (expiration, deletion, muting)
            if (!this.eventProcessor.shouldAcceptEvent(event)) {
              return; // Event was filtered out
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

    // Filter out relays that have failed authentication
    const authResult = this.filterAuthFailedRelays(this.relayUrls);
    if (!authResult.shouldProceed) {
      return null;
    }
    const urls = authResult.urls;

    // Get auth callback for NIP-42 authentication
    const authCallback = this.relayAuth.getAuthCallback();

    try {
      // Publish the event with auth support
      const publishResults = this.#pool.publish(urls, event, { onauth: authCallback });
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
              let errorMsg = error instanceof Error ? error.message : 'Failed';
              // Handle empty error messages - likely auth-required but relay doesn't follow NIP-42 properly
              if (!errorMsg || errorMsg.trim() === '') {
                errorMsg = 'auth-required: relay returned empty response (likely requires authentication)';
                this.logger.warn(`Relay ${relayUrl} returned empty error - treating as auth-required`);
              }
              this.logger.error(`Relay ${relayUrl} failed: ${errorMsg}`);
              // Check for NIP-42 auth failures using proper prefixes
              // auth-required: means client needs to authenticate first
              // restricted: means client authenticated but key is not authorized (e.g., not paid, not whitelisted)
              if (errorMsg.includes('auth-required:') || errorMsg.includes('restricted:')) {
                this.relayAuth.markAuthFailed(relayUrl, errorMsg);
              }
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

    const inputUrls = Array.isArray(relayUrls) ? relayUrls : [relayUrls];

    // Filter out relays that have failed authentication
    const authResult = this.filterAuthFailedRelays(inputUrls);
    if (!authResult.shouldProceed) {
      return null;
    }
    const urls = authResult.urls;

    // Get auth callback for NIP-42 authentication
    const authCallback = this.relayAuth.getAuthCallback();

    try {
      // Publish the event with auth support
      const publishResults = this.#pool.publish(urls, event, { onauth: authCallback });
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

    // Filter out relays that have failed authentication
    const authResult = this.filterAuthFailedRelays(urls);
    if (!authResult.shouldProceed) {
      return {
        close: () => {
          this.logger.debug(`[${this.constructor.name}] No subscription to close (all relays auth-failed)`);
        },
      };
    }
    urls = authResult.urls;

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

    // Try to register the subscription - returns available relays (those not at limit)
    const availableRelays = this.subscriptionManager.registerSubscription(
      subscriptionId,
      filter,
      urls,
      this.constructor.name,
      this.poolInstanceId
    );

    if (availableRelays.length === 0) {
      this.logger.error(
        `[${this.constructor.name}] Cannot create subscription: all relays at limit`,
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

    // Get auth callback for NIP-42 authentication
    const authCallback = this.relayAuth.getAuthCallback();

    try {
      this.logger.info(`[${this.constructor.name}] Creating subscription`, {
        subscriptionId,
        poolInstance: this.poolInstanceId,
        relayCount: availableRelays.length,
        originalRelayCount: urls.length,
        filter,
      });

      // Create the subscription with auth support, using only available relays
      const sub = this.#pool.subscribeMany(availableRelays, filter, {
        onauth: authCallback,
        onevent: (evt) => {
          // Process event through central event processor
          // This handles: expiration (NIP-40), deletion (NIP-09), muting (NIP-51)
          const result = this.eventProcessor.processEvent(evt);
          if (!result.accepted) {
            this.logger.debug(
              `[${this.constructor.name}] Event filtered out: ${evt.id} (kind: ${evt.kind}), reason: ${result.reason}`
            );
            return;
          }

          this.logger.debug(`[${this.constructor.name}] Received event of kind ${evt.kind}`, {
            subscriptionId,
            eventId: evt.id,
          });

          // Update the lastUsed timestamp for available relays
          availableRelays.forEach((url) => {
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
      // Get auth callback for NIP-42 authentication
      const authCallback = this.relayAuth.getAuthCallback();

      // Create the subscription with auth support
      const sub = this.#pool.subscribeManyEose(urls, filter, {
        onauth: authCallback,
        onevent: (evt) => {
          // Process event through centralized filter (expiration, deletion, muting)
          if (!this.eventProcessor.shouldAcceptEvent(evt)) {
            return; // Event was filtered out
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
