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

    // First, check if we have a cached relay list event in the database
    // This is crucial for new accounts where the discovery relays may not have indexed the event yet
    try {
      await this.database.init();
      const cachedEvents = await this.database.getEventsByPubkeyAndKind(pubkey, kinds.RelayList);
      if (cachedEvents.length > 0) {
        // Sort by created_at to get the most recent event
        const latestEvent = cachedEvents.reduce((latest, current) =>
          current.created_at > latest.created_at ? current : latest
        );
        const cachedRelayUrls = this.utilities.getOptimalRelayUrlsForFetching(latestEvent);
        if (cachedRelayUrls.length > 0) {
          this.logger.debug(`Found cached relay list (kind 10002) for pubkey ${pubkey} with ${cachedRelayUrls.length} relays`);
          return cachedRelayUrls;
        }
      }

      // Also check for kind 3 contacts event with relay info in the database
      const cachedContactsEvents = await this.database.getEventsByPubkeyAndKind(pubkey, kinds.Contacts);
      if (cachedContactsEvents.length > 0) {
        const latestContactsEvent = cachedContactsEvents.reduce((latest, current) =>
          current.created_at > latest.created_at ? current : latest
        );
        const cachedRelayUrls = this.utilities.getRelayUrlsFromFollowing(latestContactsEvent);
        if (cachedRelayUrls.length > 0) {
          this.logger.debug(`Found cached contacts event (kind 3) for pubkey ${pubkey} with ${cachedRelayUrls.length} relays`);
          return cachedRelayUrls;
        }
      }
    } catch (error) {
      this.logger.warn(`Error checking database for cached relay events: ${error}`);
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

      // Save the relay list event to the database for future use
      try {
        await this.database.saveEvent(event);
        this.logger.debug(`Saved relay list event (kind 10002) for pubkey ${pubkey} to database`);
      } catch (error) {
        this.logger.warn(`Failed to save relay list event for pubkey ${pubkey}:`, error);
      }
    } else {
      event = await this.getEventByPubkeyAndKind(pubkey, kinds.Contacts);

      if (event) {
        relayUrls = this.utilities.getRelayUrlsFromFollowing(event);
        // Save the contacts event to the database for future use

        try {
          await this.database.saveEvent(event);
          this.logger.debug(`Saved contacts event (kind 3) for pubkey ${pubkey} to database`);
        } catch (error) {
          this.logger.warn(`Failed to save contacts event for pubkey ${pubkey}:`, error);
        }
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
