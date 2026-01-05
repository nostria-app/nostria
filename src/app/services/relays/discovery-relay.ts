import { Injectable, inject } from '@angular/core';
import { RelayServiceBase } from './relay';
import { NostriaService } from '../../interfaces';
import { LocalStorageService } from '../local-storage.service';
import { ApplicationStateService } from '../application-state.service';
import { DatabaseService } from '../database.service';
import { kinds, SimplePool } from 'nostr-tools';

@Injectable({
  providedIn: 'root',
})
export class DiscoveryRelayService extends RelayServiceBase implements NostriaService {
  private localStorage = inject(LocalStorageService);
  private appState = inject(ApplicationStateService);
  private database = inject(DatabaseService);
  private initialized = false;

  private readonly DEFAULT_BOOTSTRAP_RELAYS = ['wss://discovery.eu.nostria.app/'];

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
      // Extract relay URLs from the event tags
      // Format: ["relay", "wss://relay.example.com"]
      const relayUrls = dmRelayEvent.tags
        .filter((tag: string[]) => tag[0] === 'relay')
        .map((tag: string[]) => tag[1])
        .filter((url: string | undefined) => url && (url.startsWith('wss://') || url.startsWith('ws://')));

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

  async load() {
    // Load bootstrap relays from local storage or use default ones
    const bootstrapRelays = this.loadDiscoveryRelaysFromStorage();
    this.init(bootstrapRelays);
    this.initialized = true;
  }

  clear() { }

  save(relayUrls: string[]) {
    // Save to local storage
    this.localStorage.setItem(
      this.appState.DISCOVERY_RELAYS_STORAGE_KEY,
      JSON.stringify(relayUrls)
    );
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
        if (Array.isArray(parsedRelays) && parsedRelays.length > 0) {
          this.logger.debug(`Loaded ${parsedRelays.length} discovery relays from storage`);
          return parsedRelays;
        }
      }
    } catch (error) {
      this.logger.error('Error loading discovery relays from storage', error);
    }
    return this.DEFAULT_BOOTSTRAP_RELAYS;
  }
}
