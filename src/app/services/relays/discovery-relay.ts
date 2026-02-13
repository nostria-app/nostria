import { Injectable, inject } from '@angular/core';
import { RelayServiceBase } from './relay';
import { NostriaService } from '../../interfaces';
import { LocalStorageService } from '../local-storage.service';
import { ApplicationStateService } from '../application-state.service';
import { DatabaseService } from '../database.service';
import { RegionService } from '../region.service';
import { AccountStateService } from '../account-state.service';
import { kinds, SimplePool, UnsignedEvent, Event } from 'nostr-tools';

// Kind 10086 is the Relay Discovery List (indexer/discovery relays)
export const DiscoveryRelayListKind = 10086;

@Injectable({
  providedIn: 'root',
})
export class DiscoveryRelayService extends RelayServiceBase implements NostriaService {
  private localStorage = inject(LocalStorageService);
  private appState = inject(ApplicationStateService);
  private database = inject(DatabaseService);
  private region = inject(RegionService);
  private accountState = inject(AccountStateService);
  private initialized = false;

  private readonly DEFAULT_BOOTSTRAP_RELAYS = ['wss://discovery.eu.nostria.app/', 'wss://indexer.coracle.social/'];

  constructor() {
    super(new SimplePool({ enablePing: true, enableReconnect: true }));
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
      event = await this.getEventByPubkeyAndKind(pubkey, kinds.Contacts);

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

    // Fallback methods... should we attempt to get the relay URLs from the account relays?
    return relayUrls;
  }

  /**
   * Get DM-specific relay URLs for a user (kind 10050 - NIP-17)
   * These are the relays where a user expects to receive direct messages.
   * Falls back to regular relay list (kind 10002) if no DM relays are found.
   */
  async getUserDmRelayUrls(pubkey: string): Promise<string[]> {
    if (!this.initialized) {
      await this.load();
    }

    this.logger.debug(`[DiscoveryRelay] getUserDmRelayUrls called for pubkey: ${pubkey.slice(0, 16)}...`);

    // First try to get DM relays (kind 10050)
    const dmRelayEvent = await this.getEventByPubkeyAndKind(pubkey, kinds.DirectMessageRelaysList);

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

      if (relayUrls.length > 0) {
        this.logger.debug(`[DiscoveryRelay] Found ${relayUrls.length} DM relays (kind 10050) for pubkey ${pubkey.slice(0, 16)}:`, relayUrls);
        return relayUrls;
      }
    }

    // Fallback to regular relay list
    this.logger.debug(`[DiscoveryRelay] No DM relays found for pubkey ${pubkey.slice(0, 16)}, falling back to regular relays`);
    const fallbackRelays = await this.getUserRelayUrls(pubkey);
    this.logger.debug(`[DiscoveryRelay] Fallback relays for pubkey ${pubkey.slice(0, 16)}:`, fallbackRelays);
    return fallbackRelays;
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
      if (relaysFromEvent !== null && relaysFromEvent.length > 0) {
        // User has a kind 10086 event, use those relays
        this.logger.debug(`Loaded ${relaysFromEvent.length} discovery relays from kind 10086 event for user`);
        this.init(relaysFromEvent);
        this.initialized = true;
        return true; // Event found
      }
      // If relaysFromEvent is null or empty, we'll use the bootstrap relays from storage/defaults
      this.logger.debug('No kind 10086 event found for user, using bootstrap relays');
    }
    
    this.init(bootstrapRelays);
    this.initialized = true;
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
   * Load discovery relays from kind 10086 event for a user.
   * Returns null if no event exists (to distinguish from empty list).
   */
  async loadFromEvent(pubkey: string): Promise<string[] | null> {
    try {
      // Try to get from database first
      const event = await this.database.getEventByPubkeyAndKind(pubkey, DiscoveryRelayListKind);

      if (event) {
        const relayUrls = event.tags
          .filter(tag => tag[0] === 'relay' && tag[1])
          .map(tag => tag[1]);

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
      // Validate that all URLs are valid relay URLs
      const validRelays = relayUrls.filter(url => {
        try {
          const parsed = new URL(url);
          return parsed.protocol === 'wss:' || parsed.protocol === 'ws:';
        } catch {
          return false;
        }
      });

      if (validRelays.length === 0) {
        this.logger.warn('No valid relay URLs provided, using default relays');
        this.localStorage.removeItem(this.appState.DISCOVERY_RELAYS_STORAGE_KEY);
        return;
      }

      // Ensure the required relay is always included
      const relaysWithRequired = this.ensureRequiredRelay(validRelays);

      this.save(relaysWithRequired);

      this.logger.debug(`Saved ${relaysWithRequired.length} discovery relays to storage`);

      // Reinitialize the service with new relays
      this.init(relaysWithRequired);
    } catch (error) {
      this.logger.error('Error saving discovery relays to storage', error);
    }
  }

  // This relay MUST always be included for profile discovery to work well
  private readonly REQUIRED_DISCOVERY_RELAY = 'wss://indexer.coracle.social/';

  /**
   * Loads bootstrap relays from local storage
   */
  private loadDiscoveryRelaysFromStorage(): string[] {
    try {
      const storedRelays = this.localStorage.getItem(this.appState.DISCOVERY_RELAYS_STORAGE_KEY);
      if (storedRelays) {
        const parsedRelays = JSON.parse(storedRelays);
        if (Array.isArray(parsedRelays) && parsedRelays.length > 0) {
          this.logger.debug(`Loaded ${parsedRelays.length} discovery relays from storage`);
          // Always ensure indexer.coracle.social is included for profile discovery
          return this.ensureRequiredRelay(parsedRelays);
        }
      }
    } catch (error) {
      this.logger.error('Error loading discovery relays from storage', error);
    }
    return this.DEFAULT_BOOTSTRAP_RELAYS;
  }

  /**
   * Ensures the required discovery relay (indexer.coracle.social) is always included
   * This relay is essential for profile discovery to work well
   */
  private ensureRequiredRelay(relays: string[]): string[] {
    const normalizedRequired = this.REQUIRED_DISCOVERY_RELAY.replace(/\/$/, '');
    const hasRequired = relays.some(relay =>
      relay.replace(/\/$/, '') === normalizedRequired
    );

    if (!hasRequired) {
      this.logger.debug(`Adding required discovery relay: ${this.REQUIRED_DISCOVERY_RELAY}`);
      return [...relays, this.REQUIRED_DISCOVERY_RELAY];
    }

    return relays;
  }

  /**
   * Get default discovery relays based on user's region
   * Falls back to EU region if user has no region set
   */
  getDefaultDiscoveryRelays(): string[] {
    const region = this.accountState.account()?.region || 'eu';
    const regionalDiscoveryRelay = this.region.getDiscoveryRelay(region);
    
    // Always include both regional relay and indexer.coracle.social for best profile discovery
    const defaultRelays = [regionalDiscoveryRelay, 'wss://indexer.coracle.social/'];
    
    this.logger.debug(`Generated default discovery relays for region ${region}:`, defaultRelays);
    return defaultRelays;
  }
}
