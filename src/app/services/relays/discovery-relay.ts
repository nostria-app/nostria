import { Injectable, inject } from '@angular/core';
import { RelayServiceBase } from './relay';
import { NostriaService } from '../../interfaces';
import { LocalStorageService } from '../local-storage.service';
import { ApplicationStateService } from '../application-state.service';
import { DatabaseService } from '../database.service';
import { kinds, UnsignedEvent, Event } from 'nostr-tools';
import { AccountRelayService } from './account-relay';
import { PoolService } from './pool.service';
import { RegionService } from '../region.service';

// Kind 10086 is the Relay Discovery List (indexer/discovery relays)
export const DiscoveryRelayListKind = 10086;

@Injectable({
  providedIn: 'root',
})
export class DiscoveryRelayService extends RelayServiceBase implements NostriaService {
  private readonly maxRelayCacheEntries = 256;
  private localStorage = inject(LocalStorageService);
  private appState = inject(ApplicationStateService);
  private database = inject(DatabaseService);
  private readonly region = inject(RegionService);
  private poolLoaded = false;
  private readonly relayCacheTtlMs = 5 * 60 * 1000;
  private readonly dmRelayCacheTtlMs = 10 * 60 * 1000;
  private readonly relayCache = new Map<string, { relayUrls: string[]; expiresAt: number }>();
  private readonly dmRelayCache = new Map<string, { relayUrls: string[]; expiresAt: number }>();
  private readonly inflightRelayRequests = new Map<string, Promise<string[]>>();
  private readonly inflightDmRelayRequests = new Map<string, Promise<string[]>>();

  private readonly DEFAULT_BOOTSTRAP_RELAYS = [
    'wss://indexer.openresist.com/',
    'wss://indexer.coracle.social/',
  ];

  constructor() {
    // Use the application-wide shared pool so that connections to discovery/indexer
    // relays are reused across DiscoveryRelayService, RelayPoolService and
    // SharedRelayService instead of opening duplicate WebSockets.
    super(inject(PoolService).pool);
  }

  private getCachedRelayUrls(
    cache: Map<string, { relayUrls: string[]; expiresAt: number }>,
    pubkey: string,
  ): string[] | null {
    const cached = cache.get(pubkey);
    if (!cached) {
      return null;
    }

    if (Date.now() > cached.expiresAt) {
      cache.delete(pubkey);
      return null;
    }

    return [...cached.relayUrls];
  }

  private setCachedRelayUrls(
    cache: Map<string, { relayUrls: string[]; expiresAt: number }>,
    pubkey: string,
    relayUrls: string[],
    ttlMs: number,
  ): string[] {
    cache.set(pubkey, {
      relayUrls: [...relayUrls],
      expiresAt: Date.now() + ttlMs,
    });

    while (cache.size > this.maxRelayCacheEntries) {
      const oldestKey = cache.keys().next().value;
      if (!oldestKey) {
        break;
      }
      cache.delete(oldestKey);
    }

    return relayUrls;
  }

  async getUserRelayUrls(pubkey: string): Promise<string[]> {
    const cachedRelayUrls = this.getCachedRelayUrls(this.relayCache, pubkey);
    if (cachedRelayUrls) {
      return cachedRelayUrls;
    }

    const existingRequest = this.inflightRelayRequests.get(pubkey);
    if (existingRequest) {
      return existingRequest;
    }

    const requestPromise = this.fetchUserRelayUrls(pubkey);
    this.inflightRelayRequests.set(pubkey, requestPromise);

    try {
      return await requestPromise;
    } finally {
      this.inflightRelayRequests.delete(pubkey);
    }
  }

  private async fetchUserRelayUrls(pubkey: string): Promise<string[]> {
    if (!this.poolLoaded) {
      await this.load();
    }

    // Query the Discovery Relays for user relay URLs.
    // Instead of doing duplicate kinds, we will query in order to get the user relay URLs. When the global network has moved
    // away from kind 3 relay lists, this will be more optimal.
    // Use a short timeout (2s) since discovery/indexer relays should respond quickly
    // for simple replaceable-event lookups.
    const discoveryTimeout = { timeout: 2000 };
    let relayUrls: string[] = [];
    let event = await this.getEventByPubkeyAndKind(pubkey, kinds.RelayList, discoveryTimeout);

    if (event) {
      // Use getOptimalRelayUrlsForFetching to prioritize WRITE relays per NIP-65
      // When fetching events FROM a user, we should prefer their WRITE relays
      relayUrls = this.utilities.getOptimalRelayUrlsForFetching(event);

      // Save the relay list event to the database only if it's newer than what we have stored
      // This prevents older relay lists from overwriting newer ones (NIP-65)
      try {
        await this.database.saveReplaceableEvent(event);
      } catch (error) {
        this.logger.warn(`Failed to save relay list event for pubkey ${pubkey}:`, error);
      }
    } else {
      event = await this.getEventByPubkeyAndKind(pubkey, kinds.Contacts, discoveryTimeout);

      if (event) {
        relayUrls = this.utilities.getRelayUrlsFromFollowing(event);
        // Save the contacts event to the database only if it's newer than what we have stored

        try {
          await this.database.saveReplaceableEvent(event);
        } catch (error) {
          this.logger.warn(`Failed to save contacts event for pubkey ${pubkey}:`, error);
        }
      }
    }

    if (this.localSettings.relayDiscoveryMode() === 'hybrid') {
      try {
        const accountRelayUrls = this.injector.get(AccountRelayService).getRelayUrls();
        if (accountRelayUrls.length > 0) {
          relayUrls = this.utilities.normalizeRelayUrls([...relayUrls, ...accountRelayUrls], false, {
            source: 'account-relays',
            ownerPubkey: pubkey,
            discoveryMode: this.localSettings.relayDiscoveryMode(),
            details: 'discovery relay hybrid merge with current account relays',
          });
          this.logger.debug(`[DiscoveryRelay] Hybrid mode enabled: merged ${accountRelayUrls.length} account relays for ${pubkey.slice(0, 16)}...`);
        }
      } catch (error) {
        this.logger.debug('[DiscoveryRelay] Unable to merge account relays in hybrid mode', error);
      }
    }

    return this.setCachedRelayUrls(this.relayCache, pubkey, relayUrls, this.relayCacheTtlMs);
  }

  /**
   * Get DM-specific relay URLs for a user (kind 10050 - NIP-17)
   * These are the relays where a user expects to receive direct messages.
   * Falls back to regular relay list (kind 10002) if no DM relays are found.
   */
  async getUserDmRelayUrls(pubkey: string): Promise<string[]> {
    const cachedRelayUrls = this.getCachedRelayUrls(this.dmRelayCache, pubkey);
    if (cachedRelayUrls) {
      return cachedRelayUrls;
    }

    const existingRequest = this.inflightDmRelayRequests.get(pubkey);
    if (existingRequest) {
      return existingRequest;
    }

    const requestPromise = this.fetchUserDmRelayUrls(pubkey);
    this.inflightDmRelayRequests.set(pubkey, requestPromise);

    try {
      return await requestPromise;
    } finally {
      this.inflightDmRelayRequests.delete(pubkey);
    }
  }

  private async fetchUserDmRelayUrls(pubkey: string): Promise<string[]> {
    if (!this.poolLoaded) {
      await this.load();
    }

    this.logger.debug(`[DiscoveryRelay] getUserDmRelayUrls called for pubkey: ${pubkey.slice(0, 16)}...`);

    // Discovery/indexer relays only serve kind 10002 and kind 3, NOT kind 10050.
    // To find a user's DM relay list (kind 10050), we must first resolve the user's
    // regular relays via discovery (kind 10002), then query those user relays for kind 10050.
    const userRelayUrls = await this.getUserRelayUrls(pubkey);

    if (userRelayUrls.length > 0) {
      // Query the user's own relays for kind 10050
      const dmRelayEvent = await this.getWithRelays<Event>(
        { authors: [pubkey], kinds: [kinds.DirectMessageRelaysList] },
        userRelayUrls,
      );

      this.logger.debug(`[DiscoveryRelay] DM relay event (kind 10050) found: ${!!dmRelayEvent}`);

      if (dmRelayEvent) {
        // Save the DM relay event to the database for offline/cached access
        try {
          await this.database.saveReplaceableEvent(dmRelayEvent);
        } catch (error) {
          this.logger.warn(`Failed to save DM relay list event for pubkey ${pubkey}:`, error);
        }

        // Extract relay URLs from the event tags
        // Format: ["relay", "wss://relay.example.com"]
        const relayUrls = dmRelayEvent.tags
          .filter((tag: string[]) => tag[0] === 'relay')
          .map((tag: string[]) => tag[1])
          .filter((url: string | undefined) => url && url.startsWith('wss://')); // Only allow secure wss:// relays

        const normalizedRelayUrls = this.utilities.normalizeRelayUrls(relayUrls, false, {
          source: 'account-relays',
          ownerPubkey: pubkey,
          eventKind: kinds.DirectMessageRelaysList,
          details: 'kind 10050 dm relay tags',
        });

        if (normalizedRelayUrls.length > 0) {
          this.logger.debug(`[DiscoveryRelay] Found ${normalizedRelayUrls.length} DM relays (kind 10050) for pubkey ${pubkey.slice(0, 16)}:`, normalizedRelayUrls);
          return this.setCachedRelayUrls(this.dmRelayCache, pubkey, normalizedRelayUrls, this.dmRelayCacheTtlMs);
        }
      }
    }

    // Fallback to regular relay list
    this.logger.debug(`[DiscoveryRelay] No DM relays found for pubkey ${pubkey.slice(0, 16)}, falling back to regular relays`);
    const fallbackRelays = userRelayUrls.length > 0 ? userRelayUrls : await this.getUserRelayUrls(pubkey);
    this.logger.debug(`[DiscoveryRelay] Fallback relays for pubkey ${pubkey.slice(0, 16)}:`, fallbackRelays);
    return this.setCachedRelayUrls(this.dmRelayCache, pubkey, fallbackRelays, this.dmRelayCacheTtlMs);
  }

  /**
   * Load discovery relays from storage or from the user's kind 10086 event.
   * 
   * @param pubkey Optional user's public key to check for kind 10086 event
   * @returns Promise<boolean> - True if user has a kind 10086 event, false otherwise
   * 
   * When pubkey is provided:
   * - Checks database for kind 10086 event
   * - If found, initializes with those relays and returns true
   * - If not found, initializes with bootstrap relays from storage and returns false
   * 
   * When pubkey is not provided:
   * - Initializes with bootstrap relays from storage
   * - Returns false (no event check performed)
   */
  async load(pubkey?: string): Promise<boolean> {
    // Load bootstrap relays from local storage or use default ones
    const bootstrapRelays = this.loadDiscoveryRelaysFromStorage();

    // If pubkey is provided, check if user has a kind 10086 event
    // If they don't have one, the defaults from storage or DEFAULT_BOOTSTRAP_RELAYS will be used
    // The actual publishing of defaults happens in ensureDefaultDiscoveryRelays()
    if (pubkey) {
      const relaysFromEvent = await this.loadFromEvent(pubkey);
      if (relaysFromEvent !== null) {
        this.logger.debug(`Loaded ${relaysFromEvent.length} discovery relays from kind 10086 event for user`);
        this.init(relaysFromEvent);

        this.poolLoaded = true;
        return true; // Event found
      }

      // No kind 10086 event found, use bootstrap relays from storage/defaults
      this.logger.debug('No kind 10086 event found for user, using bootstrap relays');
    }

    this.init(bootstrapRelays);
    this.poolLoaded = true;
    return false; // No event found (or no pubkey provided)
  }

  clear() {
    // No specific cleanup needed for discovery relays
    // The relay pool is managed by the base class
  }

  save(relayUrls: string[]) {
    // Save to local storage
    this.localStorage.setItem(
      this.appState.DISCOVERY_RELAYS_STORAGE_KEY,
      JSON.stringify(relayUrls)
    );
  }

  /**
   * Extract normalized relay URLs from a kind 10086 event.
   * Supports both "relay" and legacy "r" tags.
   */
  getRelayUrlsFromDiscoveryEvent(event: Event): string[] {
    return this.utilities.normalizeRelayUrls(
      event.tags
        .filter(tag => (tag[0] === 'relay' || tag[0] === 'r') && typeof tag[1] === 'string')
        .map(tag => tag[1]),
      false,
      {
        source: 'discovery-relays',
        ownerPubkey: event.pubkey,
        eventKind: event.kind,
        details: 'kind 10086 discovery event tags',
      }
    );
  }

  /**
   * Load discovery relays from kind 10086 event for a user.
   * Returns null if no event exists (to distinguish from empty list).
   */
  async loadFromEvent(pubkey: string): Promise<string[] | null> {
    try {
      // Try to get from database first
      const event = await this.database.getEventByPubkeyAndKind(pubkey, DiscoveryRelayListKind);

      if (event) {
        const relayUrls = this.getRelayUrlsFromDiscoveryEvent(event);

        this.logger.debug(`Loaded ${relayUrls.length} discovery relays from kind 10086 event`);
        return relayUrls;
      }
    } catch (error) {
      this.logger.error('Error loading discovery relays from event', error);
    }

    // No event found
    return null;
  }

  /**
   * Creates an unsigned kind 10086 event for publishing discovery relay list
   */
  createDiscoveryRelayListEvent(pubkey: string, relayUrls: string[]): UnsignedEvent {
    return {
      pubkey,
      kind: DiscoveryRelayListKind,
      created_at: Math.floor(Date.now() / 1000),
      tags: relayUrls.map(url => ['relay', url]),
      content: '',
    };
  }

  /**
   * Save discovery relay list event to database
   */
  async saveEvent(event: Event): Promise<void> {
    try {
      await this.database.saveEvent(event);
      this.logger.debug('Saved discovery relay list event to database');
    } catch (error) {
      this.logger.error('Error saving discovery relay list event', error);
    }
  }

  /**
   * Sets discovery relays and persists them to local storage
   */
  setDiscoveryRelays(relayUrls: string[]): void {
    try {
      const validRelays = this.utilities.normalizeRelayUrls(
        relayUrls.map(url => this.region.rewriteDiscoveryRelayUrl(url)),
        false,
        {
          source: 'discovery-relays',
          details: 'setDiscoveryRelays',
        }
      );

      this.save(validRelays);

      this.logger.debug(`Saved ${validRelays.length} discovery relays to storage`);

      // Reinitialize the service with new relays
      this.init(validRelays);
    } catch (error) {
      this.logger.error('Error saving discovery relays to storage', error);
    }
  }

  /**
   * Loads bootstrap relays from local storage
   */
  private loadDiscoveryRelaysFromStorage(): string[] {
    try {
      const storedRelays = this.localStorage.getItem(this.appState.DISCOVERY_RELAYS_STORAGE_KEY);
      if (storedRelays) {
        const parsedRelays = JSON.parse(storedRelays);
        if (Array.isArray(parsedRelays)) {
          const normalizedRelays = this.utilities.normalizeRelayUrls(
            parsedRelays.map(url => this.region.rewriteDiscoveryRelayUrl(String(url))),
            false,
            {
              source: 'discovery-relays',
              details: 'local storage bootstrap relays',
            }
          );
          this.logger.debug(`Loaded ${normalizedRelays.length} discovery relays from storage`);
          return normalizedRelays;
        }
      }
    } catch (error) {
      this.logger.error('Error loading discovery relays from storage', error);
    }
    return this.DEFAULT_BOOTSTRAP_RELAYS;
  }

  getDefaultDiscoveryRelays(): string[] {
    const defaultRelays = [...this.DEFAULT_BOOTSTRAP_RELAYS];

    this.logger.debug('Generated default discovery relays', defaultRelays);
    return defaultRelays;
  }
}
