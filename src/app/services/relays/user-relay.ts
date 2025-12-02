import { Injectable, inject, Injector } from '@angular/core';
import { Event, Filter, SimplePool } from 'nostr-tools';
import { DiscoveryRelayService } from './discovery-relay';
import { LoggerService } from '../logger.service';
import { RelaysService } from './relays';
import { RelayPoolService } from './relay-pool';
import { UserRelaysService } from './user-relays';
import { AccountRelayService } from './account-relay';

@Injectable({
  providedIn: 'root',
})
export class UserRelayService {
  private discoveryRelay = inject(DiscoveryRelayService);
  private pool = inject(RelayPoolService);
  private logger = inject(LoggerService);
  private relaysService = inject(RelaysService);
  private userRelaysService = inject(UserRelaysService);
  private accountRelay = inject(AccountRelayService);
  private injector = inject(Injector);

  // Private SimplePool instance for publishing with notification support
  private publishPool = new SimplePool();

  private useOptimizedRelays = true;

  /**
   * Ensure relay URLs are discovered and cached for a pubkey
   * Delegates to UserRelaysService for efficient caching
   */
  async ensureRelaysForPubkey(pubkey: string): Promise<void> {
    await this.userRelaysService.ensureRelaysForPubkey(pubkey);
  }

  /**
   * Get relay URLs for a specific pubkey
   * Uses UserRelaysService cache for high performance
   */
  getRelaysForPubkey(pubkey: string): string[] {
    return this.userRelaysService.getRelaysForPubkey(pubkey);
  }

  /**
   * Get effective relay URLs with optimization if enabled
   */
  private getEffectiveRelayUrls(relayUrls: string[]): string[] {
    if (this.useOptimizedRelays) {
      return this.relaysService.getOptimalRelays(relayUrls);
    }
    return relayUrls;
  }

  /**
   * Get a single event by ID using discovery relays (no specific pubkey)
   * @deprecated Use getEventById(pubkey, id) when possible
   */
  async getEventByIdGlobal(id: string): Promise<Event | null> {
    const relayUrls = this.getEffectiveRelayUrls(this.discoveryRelay.getRelayUrls());

    if (relayUrls.length === 0) {
      this.logger.warn(`[UserRelayService] No default relays available for getEventByIdGlobal`);
      return null;
    }

    return this.pool.get(relayUrls, { ids: [id] });
  }

  async getEventById(pubkey: string, id: string): Promise<Event | null> {
    await this.ensureRelaysForPubkey(pubkey);
    const relayUrls = this.getEffectiveRelayUrls(this.getRelaysForPubkey(pubkey));

    if (relayUrls.length === 0) {
      this.logger.warn(`[UserRelayService] No relays available for pubkey: ${pubkey.slice(0, 16)}...`);
      return null;
    }

    return this.pool.get(relayUrls, { ids: [id] });
  }

  /**
   * Get a single event by pubkey and kind
   */
  async getEventByPubkeyAndKind(pubkey: string | string[], kind: number): Promise<Event | null> {
    // For multiple pubkeys, we need to get relays for each one
    const pubkeys = Array.isArray(pubkey) ? pubkey : [pubkey];
    const allRelayUrls = new Set<string>();

    for (const pk of pubkeys) {
      await this.ensureRelaysForPubkey(pk);
      const relayUrls = this.getRelaysForPubkey(pk);
      relayUrls.forEach(url => allRelayUrls.add(url));
    }

    const relayUrls = this.getEffectiveRelayUrls(Array.from(allRelayUrls));

    if (relayUrls.length === 0) {
      this.logger.warn(`[UserRelayService] No relays available for pubkeys: ${pubkeys.map(pk => pk.slice(0, 16)).join(', ')}...`);
      return null;
    }

    const authors = Array.isArray(pubkey) ? pubkey : [pubkey];
    return this.pool.get(relayUrls, { authors, kinds: [kind] });
  }

  /**
   * Get multiple events by pubkey and kind
   */
  async getEventsByPubkeyAndKind(pubkey: string | string[], kind: number): Promise<Event[]> {
    // For multiple pubkeys, we need to get relays for each one
    const pubkeys = Array.isArray(pubkey) ? pubkey : [pubkey];
    // Filter out any undefined or invalid values
    const validPubkeys = pubkeys.filter(pk => pk && typeof pk === 'string');
    if (validPubkeys.length === 0) {
      this.logger.warn('[UserRelayService] getEventsByPubkeyAndKind called with no valid pubkeys');
      return [];
    }

    const allRelayUrls = new Set<string>();

    for (const pk of validPubkeys) {
      await this.ensureRelaysForPubkey(pk);
      const relayUrls = this.getRelaysForPubkey(pk);
      relayUrls.forEach(url => allRelayUrls.add(url));
    }

    const relayUrls = this.getEffectiveRelayUrls(Array.from(allRelayUrls));

    if (relayUrls.length === 0) {
      this.logger.warn(`[UserRelayService] No relays available for pubkeys: ${validPubkeys.map(pk => pk.slice(0, 16)).join(', ')}...`);
      return [];
    }

    return this.getEventsWithSubscription(relayUrls, { authors: validPubkeys, kinds: [kind], limit: 1000 });
  }

  /**
   * Get events by pubkey and kind with pagination support (until parameter for infinite scroll)
   */
  async getEventsByPubkeyAndKindPaginated(
    pubkey: string | string[],
    kind: number,
    until?: number,
    limit = 20
  ): Promise<Event[]> {
    const pubkeys = Array.isArray(pubkey) ? pubkey : [pubkey];
    // Filter out any undefined or invalid values
    const validPubkeys = pubkeys.filter(pk => pk && typeof pk === 'string');

    if (validPubkeys.length === 0) {
      this.logger.warn('[UserRelayService] getEventsByPubkeyAndKindPaginated called with no valid pubkeys');
      return [];
    }

    const allRelayUrls = new Set<string>();

    for (const pk of validPubkeys) {
      await this.ensureRelaysForPubkey(pk);
      const relayUrls = this.getRelaysForPubkey(pk);
      relayUrls.forEach(url => allRelayUrls.add(url));
    }

    const relayUrls = this.getEffectiveRelayUrls(Array.from(allRelayUrls));

    if (relayUrls.length === 0) {
      this.logger.warn(`[UserRelayService] No relays available for pubkeys: ${validPubkeys.map(pk => pk.slice(0, 16)).join(', ')}...`);
      return [];
    }

    const filter = { authors: validPubkeys, kinds: [kind], limit };

    // Add until parameter if provided for pagination
    if (until !== undefined) {
      (filter as { until?: number }).until = until;
      // Debug: Log pagination request
      const untilDate = new Date(until * 1000).toISOString();
      this.logger.debug(`[Pagination] Fetching kind ${kind} for ${validPubkeys.length} users until ${untilDate} (timestamp: ${until})`);
    } else {
      this.logger.debug(`[Pagination] Fetching recent kind ${kind} events (no until parameter)`);
    }

    const events = await this.getEventsWithSubscription(relayUrls, filter);

    if (events.length > 0) {
      const oldestEvent = events.reduce((oldest, e) =>
        (e.created_at || 0) < (oldest.created_at || 0) ? e : oldest
      );
      const oldestDate = new Date((oldestEvent.created_at || 0) * 1000).toISOString();
      this.logger.debug(`[Pagination] Received ${events.length} events, oldest: ${oldestDate}`);
    } else {
      this.logger.debug(`[Pagination] No events received from relays`);
    }

    return events;
  }

  /**
   * Get events by kind and event tag (using broader relay set for better discovery)
   * @param pubkey The pubkey(s) whose relays to query
   * @param kind The event kind to search for
   * @param eventTag The event tag(s) to filter by
   * @param includeAccountRelays If true, also include the current logged-in account's relays for better event discovery
   */
  async getEventsByKindAndEventTag(
    pubkey: string | string[],
    kind: number,
    eventTag: string | string[],
    includeAccountRelays = false
  ): Promise<Event[]> {
    // For multiple pubkeys, we need to get relays for each one
    const pubkeys = Array.isArray(pubkey) ? pubkey : [pubkey];
    const allRelayUrls = new Set<string>();

    for (const pk of pubkeys) {
      await this.ensureRelaysForPubkey(pk);
      const relayUrls = this.getRelaysForPubkey(pk);
      relayUrls.forEach(url => allRelayUrls.add(url));
    }

    // Include account relays for better discovery of interactions (replies, reactions, etc.)
    if (includeAccountRelays) {
      const accountRelayUrls = this.accountRelay.getRelayUrls();
      accountRelayUrls.forEach(url => allRelayUrls.add(url));
      this.logger.debug(`[UserRelayService] Including ${accountRelayUrls.length} account relays for broader discovery`);
    }

    const relayUrls = this.getEffectiveRelayUrls(Array.from(allRelayUrls));

    if (relayUrls.length === 0) {
      this.logger.warn(`[UserRelayService] No relays available for pubkeys: ${pubkeys.map(pk => pk.slice(0, 16)).join(', ')}...`);
      return [];
    }

    const events = Array.isArray(eventTag) ? eventTag : [eventTag];

    this.logger.debug(`[UserRelayService] Searching for kind ${kind} events across ${relayUrls.length} relays`);

    return this.getEventsWithSubscription(relayUrls, { '#e': events, kinds: [kind] });
  }

  /**
   * Get events by multiple kinds and event tag (optimized for fetching reactions, reposts, reports in one query)
   * @param pubkey The pubkey(s) whose relays to query
   * @param kinds The event kinds to search for
   * @param eventTag The event tag(s) to filter by
   * @param includeAccountRelays If true, also include the current logged-in account's relays for better event discovery
   */
  async getEventsByKindsAndEventTag(
    pubkey: string | string[],
    kinds: number[],
    eventTag: string | string[],
    includeAccountRelays = false
  ): Promise<Event[]> {
    // For multiple pubkeys, we need to get relays for each one
    const pubkeys = Array.isArray(pubkey) ? pubkey : [pubkey];
    // Filter out any undefined or invalid values
    const validPubkeys = pubkeys.filter(pk => pk && typeof pk === 'string');

    if (validPubkeys.length === 0) {
      this.logger.warn('[UserRelayService] getEventsByKindsAndEventTag called with no valid pubkeys');
      return [];
    }

    const allRelayUrls = new Set<string>();

    for (const pk of validPubkeys) {
      await this.ensureRelaysForPubkey(pk);
      const relayUrls = this.getRelaysForPubkey(pk);
      relayUrls.forEach(url => allRelayUrls.add(url));
    }

    // Include account relays for better discovery of interactions (replies, reactions, etc.)
    if (includeAccountRelays) {
      const accountRelayUrls = this.accountRelay.getRelayUrls();
      accountRelayUrls.forEach(url => allRelayUrls.add(url));
      this.logger.debug(`[UserRelayService] Including ${accountRelayUrls.length} account relays for broader discovery`);
    }

    const relayUrls = this.getEffectiveRelayUrls(Array.from(allRelayUrls));

    if (relayUrls.length === 0) {
      this.logger.warn(`[UserRelayService] No relays available for pubkeys: ${validPubkeys.map(pk => pk.slice(0, 16)).join(', ')}...`);
      return [];
    }

    const events = Array.isArray(eventTag) ? eventTag : [eventTag];

    this.logger.debug(`[UserRelayService] Searching for kinds ${kinds.join(', ')} events across ${relayUrls.length} relays`);

    return this.getEventsWithSubscription(relayUrls, { '#e': events, kinds });
  }

  /**
   * Get a single event by pubkey, kind and tag
   */
  async getEventByPubkeyAndKindAndTag(
    pubkey: string | string[],
    kind: number,
    tag: { key: string; value: string },
  ): Promise<Event | null> {
    // For multiple pubkeys, we need to get relays for each one
    const pubkeys = Array.isArray(pubkey) ? pubkey : [pubkey];
    // Filter out any undefined or invalid values
    const validPubkeys = pubkeys.filter(pk => pk && typeof pk === 'string');

    if (validPubkeys.length === 0) {
      this.logger.warn('[UserRelayService] getEventByPubkeyAndKindAndTag called with no valid pubkeys');
      return null;
    }

    const allRelayUrls = new Set<string>();

    for (const pk of validPubkeys) {
      await this.ensureRelaysForPubkey(pk);
      const relayUrls = this.getRelaysForPubkey(pk);
      relayUrls.forEach(url => allRelayUrls.add(url));
    }

    const relayUrls = this.getEffectiveRelayUrls(Array.from(allRelayUrls));

    if (relayUrls.length === 0) {
      this.logger.warn(`[UserRelayService] No relays available for pubkeys: ${validPubkeys.map(pk => pk.slice(0, 16)).join(', ')}...`);
      return null;
    }

    const filter = {
      authors: validPubkeys,
      kinds: [kind],
    } as {
      authors: string[];
      kinds: number[];
      '#e'?: string[];
      '#p'?: string[];
      '#d'?: string[];
    };

    if (tag.key === 'e') {
      filter['#e'] = [tag.value];
    } else if (tag.key === 'p') {
      filter['#p'] = [tag.value];
    } else if (tag.key === 'd') {
      filter['#d'] = [tag.value];
    }

    return this.pool.get(relayUrls, filter);
  }

  /**
   * Helper method to get multiple events using subscription
   */
  private async getEventsWithSubscription(
    relayUrls: string[],
    filter: {
      authors?: string[];
      kinds?: number[];
      '#e'?: string[];
      '#p'?: string[];
      since?: number;
      until?: number;
      limit?: number;
    }
  ): Promise<Event[]> {
    return this.pool.query(relayUrls, filter);
  }

  /**
   * Check if the service is idle (always false for singleton)
   */
  isIdle(): boolean {
    return false; // Singleton service is never considered idle
  }

  /**
   * Legacy initialize method - now just ensures relays are discovered
   * @deprecated Use ensureRelaysForPubkey instead
   */
  async initialize(pubkey: string): Promise<void> {
    await this.ensureRelaysForPubkey(pubkey);
  }

  /**
   * Clear cached relays for a pubkey (force re-discovery)
   */
  clearRelaysForPubkey(pubkey: string): void {
    this.userRelaysService.clearUserRelaysCache(pubkey);
  }

  /**
   * Get all cached pubkeys
   */
  getCachedPubkeys(): string[] {
    // UserRelaysService doesn't expose this currently, return empty array
    // This method is likely not used much, but kept for compatibility
    return [];
  }

  /**
   * Get all cached relay URLs from all pubkeys
   */
  getAllCachedRelayUrls(): string[] {
    const allRelays = new Set<string>();

    // Add discovery relays
    this.discoveryRelay.getRelayUrls().forEach(relay => allRelays.add(relay));

    // Note: UserRelaysService doesn't expose all cached relays
    // This is acceptable as this method is primarily for diagnostics

    return Array.from(allRelays);
  }

  /**
   * Destroy method for compatibility (no-op for singleton)
   */
  destroy(): void {
    // No-op for singleton service - it should persist throughout app lifecycle
    this.logger.debug('[UserRelayService] destroy() called on singleton (no-op)');
  }

  /**
   * Get relay URLs for the current instance (legacy compatibility)
   * @deprecated Use getRelaysForPubkey(pubkey) instead
   */
  getRelayUrls(): string[] {
    this.logger.warn('[UserRelayService] getRelayUrls() called without pubkey - this is deprecated');
    return [];
  }

  /**
   * Initialize method for compatibility
   * @deprecated Use ensureRelaysForPubkey(pubkey) instead
   */
  async init(relayUrls?: string[]): Promise<void> {
    if (relayUrls) {
      this.logger.warn('[UserRelayService] init() called with explicit relay URLs - use ensureRelaysForPubkey() instead');
    }
  }

  /**
   * Publish an event to relays for a specific pubkey
   */
  async publish(pubkey: string, event: Event): Promise<void> {
    // Use getUserRelaysForPublishing to get ALL relays (not optimized/limited)
    // This ensures maximum distribution for important events like DMs
    const relayUrls = await this.userRelaysService.getUserRelaysForPublishing(pubkey);

    if (relayUrls.length === 0) {
      this.logger.warn(`[UserRelayService] No relays available for publishing for pubkey: ${pubkey.slice(0, 16)}...`);
      return;
    }

    this.logger.info(`[UserRelayService] Publishing to ${relayUrls.length} relays for pubkey: ${pubkey.slice(0, 16)}...`);

    // Use the SimplePool directly to get publish promises for notification tracking
    const publishResults = this.publishPool.publish(relayUrls, event);
    this.logger.debug('[UserRelayService] Publish results count:', publishResults.length);

    // Create notifications for tracking (same pattern as RelayServiceBase)
    try {
      // Dynamically import to break circular dependency at module load time
      const { NotificationService } = await import('../notification.service');
      const notificationService = this.injector.get(NotificationService);

      // Create relay promises map for notification tracking
      const relayPromises = new Map<Promise<string>, string>();

      this.logger.debug(`[UserRelayService] Creating notification for ${publishResults.length} relay promises`);

      publishResults.forEach((promise: Promise<string>, index: number) => {
        const relayUrl = relayUrls[index];
        this.logger.debug(`[UserRelayService] Adding relay promise for: ${relayUrl}`);
        const wrappedPromise = promise
          .then((result) => {
            this.logger.debug(`[UserRelayService] Relay ${relayUrl} resolved successfully with: ${result}`);
            return relayUrl;
          })
          .catch((error: unknown) => {
            const errorMsg = error instanceof Error ? error.message : 'Failed';
            this.logger.error(`[UserRelayService] Relay ${relayUrl} failed: ${errorMsg}`);
            throw new Error(`${relayUrl}: ${errorMsg}`);
          });
        relayPromises.set(wrappedPromise, relayUrl);
      });

      this.logger.debug(`[UserRelayService] Created relay promises map with ${relayPromises.size} entries`);

      // Create notification for tracking (don't await to not block publish)
      notificationService.addRelayPublishingNotification(event, relayPromises).catch(err => {
        this.logger.warn('[UserRelayService] Failed to create publish notification', err);
      });
    } catch (notifError) {
      // If notification service is not available or fails, just log and continue
      this.logger.debug('[UserRelayService] Could not create publish notification', notifError);
    }

    // Wait for all publish attempts to complete (but notifications are already tracking them)
    await Promise.allSettled(publishResults);
  }

  /**
   * Legacy publish method (tries to use default relays)
   * @deprecated Use publish(pubkey, event) instead
   */
  async publishLegacy(event: Event): Promise<void> {
    const relayUrls = this.discoveryRelay.getRelayUrls();
    this.pool.publish(relayUrls, event);
  }

  /**
   * Subscribe to events for a specific pubkey
   */
  async subscribe(
    pubkey: string,
    filter: Filter,
    onEvent: (event: Event) => void
  ): Promise<unknown> {
    await this.ensureRelaysForPubkey(pubkey);
    const relayUrls = this.getEffectiveRelayUrls(this.getRelaysForPubkey(pubkey));

    if (relayUrls.length === 0) {
      this.logger.warn(`[UserRelayService] No relays available for subscription for pubkey: ${pubkey.slice(0, 16)}...`);
      return null;
    }

    return this.pool.subscribe(relayUrls, filter, onEvent);
  }

  /**
   * Subscribe with EOSE for a specific pubkey
   */
  async subscribeEose(
    pubkey: string,
    filter: Filter
  ): Promise<Event[] | null> {
    await this.ensureRelaysForPubkey(pubkey);
    const relayUrls = this.getEffectiveRelayUrls(this.getRelaysForPubkey(pubkey));

    if (relayUrls.length === 0) {
      this.logger.warn(`[UserRelayService] No relays available for subscribeEose for pubkey: ${pubkey.slice(0, 16)}...`);
      return null;
    }

    return this.pool.query(relayUrls, filter);
  }

  async query(
    pubkey: string,
    filter: Filter
  ): Promise<Event[] | null> {
    await this.ensureRelaysForPubkey(pubkey);
    const relayUrls = this.getEffectiveRelayUrls(this.getRelaysForPubkey(pubkey));

    if (relayUrls.length === 0) {
      this.logger.warn(`[UserRelayService] No relays available for subscribeEose for pubkey: ${pubkey.slice(0, 16)}...`);
      return null;
    }

    return this.pool.query(relayUrls, filter);
  }
}
