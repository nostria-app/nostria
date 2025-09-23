import { Injectable, inject } from '@angular/core';
import { RelayServiceBase } from './relay';
import { NostriaService } from '../../interfaces';
import { UtilitiesService } from '../utilities.service';
import { LocalStorageService } from '../local-storage.service';
import { ApplicationStateService } from '../application-state.service';
import { kinds, SimplePool } from 'nostr-tools';

@Injectable({
  providedIn: 'root',
})
export class DiscoveryRelayService extends RelayServiceBase implements NostriaService {
  private readonly utilities = inject(UtilitiesService);
  private localStorage = inject(LocalStorageService);
  private appState = inject(ApplicationStateService);
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
