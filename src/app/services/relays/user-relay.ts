import { Injectable, inject } from '@angular/core';
import { SimplePool, Event, Filter } from 'nostr-tools';
import { DiscoveryRelayService } from './discovery-relay';
import { LoggerService } from '../logger.service';
import { RelaysService } from './relays';

@Injectable({
  providedIn: 'root',
})
export class UserRelayService {
  private discoveryRelay = inject(DiscoveryRelayService);
  private logger = inject(LoggerService);
  private relaysService = inject(RelaysService);

  // Map from pubkey to relay URLs
  private pubkeyRelayMap = new Map<string, string[]>();

  // Single shared pool for all relay operations
  private pool = new SimplePool();
  private useOptimizedRelays = true;

  /**
   * Ensure relay URLs are discovered and cached for a pubkey
   */
  async ensureRelaysForPubkey(pubkey: string): Promise<void> {
    if (this.pubkeyRelayMap.has(pubkey)) {
      return; // Already discovered
    }

    const relayUrls = await this.discoveryRelay.getUserRelayUrls(pubkey);
    this.pubkeyRelayMap.set(pubkey, relayUrls);
    this.logger.debug(`[UserRelayService] Discovered ${relayUrls.length} relays for pubkey: ${pubkey.slice(0, 16)}...`);
  }

  /**
   * Get relay URLs for a specific pubkey
   */
  getRelaysForPubkey(pubkey: string): string[] {
    return this.pubkeyRelayMap.get(pubkey) || [];
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
    const allRelayUrls = new Set<string>();

    for (const pk of pubkeys) {
      await this.ensureRelaysForPubkey(pk);
      const relayUrls = this.getRelaysForPubkey(pk);
      relayUrls.forEach(url => allRelayUrls.add(url));
    }

    const relayUrls = this.getEffectiveRelayUrls(Array.from(allRelayUrls));

    if (relayUrls.length === 0) {
      this.logger.warn(`[UserRelayService] No relays available for pubkeys: ${pubkeys.map(pk => pk.slice(0, 16)).join(', ')}...`);
      return [];
    }

    const authors = Array.isArray(pubkey) ? pubkey : [pubkey];
    return this.getEventsWithSubscription(relayUrls, { authors, kinds: [kind] });
  }

  /**
   * Get events by kind and event tag (using broader relay set for better discovery)
   */
  async getEventsByKindAndEventTag(kind: number, eventTag: string | string[]): Promise<Event[]> {
    // For reactions and reposts, we need to cast a wider net across relays
    // Start with discovery relays
    const discoveryRelays = this.discoveryRelay.getRelayUrls();
    
    // Get relays from all cached pubkeys (these are users we've interacted with)
    const allUserRelays = new Set<string>(discoveryRelays);
    
    // Add relays from cached pubkeys to get better coverage
    this.pubkeyRelayMap.forEach((relays) => {
      relays.forEach(relay => allUserRelays.add(relay));
    });
    
    // Get optimal relays from the combined set
    const combinedRelays = Array.from(allUserRelays);
    const relayUrls = this.getEffectiveRelayUrls(combinedRelays);

    if (relayUrls.length === 0) {
      this.logger.warn(`[UserRelayService] No relays available for getEventsByKindAndEventTag`);
      return [];
    }

    const events = Array.isArray(eventTag) ? eventTag : [eventTag];
    
    this.logger.debug(`[UserRelayService] Searching for kind ${kind} events across ${relayUrls.length} relays`);
    
    return this.getEventsWithSubscription(relayUrls, { '#e': events, kinds: [kind] });
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
    const filter = {
      authors,
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
    return new Promise<Event[]>((resolve) => {
      const events: Event[] = [];
      const timeout = 8000; // Increased timeout to 8 seconds for better results

      this.logger.debug(`[UserRelayService] Starting subscription with filter:`, filter, `on ${relayUrls.length} relays`);

      this.pool.subscribeEose(relayUrls, filter, {
        maxWait: timeout,
        onevent: (event) => {
          events.push(event);
          this.logger.debug(`[UserRelayService] Received event kind ${event.kind} from subscription`);
        },
        onclose: () => {
          this.logger.debug(`[UserRelayService] Subscription closed, received ${events.length} events`);
          resolve(events);
        },
      });

      // Add timeout fallback in case onclose is not called
      setTimeout(() => {
        this.logger.debug(`[UserRelayService] Subscription timeout reached, resolving with ${events.length} events`);
        resolve(events);
      }, timeout + 1000);
    });
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
    this.pubkeyRelayMap.delete(pubkey);
  }

  /**
   * Get all cached pubkeys
   */
  getCachedPubkeys(): string[] {
    return Array.from(this.pubkeyRelayMap.keys());
  }

  /**
   * Get all cached relay URLs from all pubkeys
   */
  getAllCachedRelayUrls(): string[] {
    const allRelays = new Set<string>();
    
    // Add discovery relays
    this.discoveryRelay.getRelayUrls().forEach(relay => allRelays.add(relay));
    
    // Add relays from all cached pubkeys
    this.pubkeyRelayMap.forEach((relays) => {
      relays.forEach(relay => allRelays.add(relay));
    });
    
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
    await this.ensureRelaysForPubkey(pubkey);
    const relayUrls = this.getEffectiveRelayUrls(this.getRelaysForPubkey(pubkey));

    if (relayUrls.length === 0) {
      this.logger.warn(`[UserRelayService] No relays available for publishing for pubkey: ${pubkey.slice(0, 16)}...`);
      return;
    }

    this.pool.publish(relayUrls, event);
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
    onEvent: (event: Event) => void,
    onEose?: () => void
  ): Promise<unknown> {
    await this.ensureRelaysForPubkey(pubkey);
    const relayUrls = this.getEffectiveRelayUrls(this.getRelaysForPubkey(pubkey));

    if (relayUrls.length === 0) {
      this.logger.warn(`[UserRelayService] No relays available for subscription for pubkey: ${pubkey.slice(0, 16)}...`);
      return null;
    }

    return this.pool.subscribeMany(relayUrls, filter, {
      onevent: onEvent,
      oneose: onEose,
    });
  }

  /**
   * Subscribe with EOSE for a specific pubkey
   */
  async subscribeEose(
    pubkey: string,
    filter: Filter,
    onEvent: (event: Event) => void,
    onEose?: () => void
  ): Promise<unknown> {
    await this.ensureRelaysForPubkey(pubkey);
    const relayUrls = this.getEffectiveRelayUrls(this.getRelaysForPubkey(pubkey));

    if (relayUrls.length === 0) {
      this.logger.warn(`[UserRelayService] No relays available for subscribeEose for pubkey: ${pubkey.slice(0, 16)}...`);
      return null;
    }

    return this.pool.subscribeEose(relayUrls, filter, {
      onevent: onEvent,
      onclose: onEose,
    });
  }
}
