import { Injectable, inject } from '@angular/core';
import { RelayServiceBase } from './relay';
import { NostriaService } from '../../interfaces';
import { LocalStorageService } from '../local-storage.service';
import { ApplicationStateService } from '../application-state.service';
import { DatabaseService } from '../database.service';
import { SimplePool, UnsignedEvent, Event } from 'nostr-tools';

// Kind 10007 is not exported from nostr-tools, so we define it here
export const SearchRelayListKind = 10007;

@Injectable({
  providedIn: 'root',
})
export class SearchRelayService extends RelayServiceBase implements NostriaService {
  private localStorage = inject(LocalStorageService);
  private appState = inject(ApplicationStateService);
  private database = inject(DatabaseService);
  private initialized = false;

  private readonly DEFAULT_SEARCH_RELAYS = ['wss://relay.nostr.band/'];

  constructor() {
    super(new SimplePool());
  }

  async load() {
    // Load search relays from local storage or use default ones
    const searchRelays = this.loadSearchRelaysFromStorage();
    this.init(searchRelays);
    this.initialized = true;
  }

  clear() {
    // Reset to default relays when clearing
    this.init(this.DEFAULT_SEARCH_RELAYS);
  }

  save(relayUrls: string[]) {
    // Save to local storage
    this.localStorage.setItem(
      this.appState.SEARCH_RELAYS_STORAGE_KEY,
      JSON.stringify(relayUrls)
    );
  }

  /**
   * Sets search relays and persists them to local storage
   */
  setSearchRelays(relayUrls: string[]): void {
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
        this.localStorage.removeItem(this.appState.SEARCH_RELAYS_STORAGE_KEY);
        return;
      }

      this.save(validRelays);

      this.logger.debug(`Saved ${validRelays.length} search relays to storage`);

      // Reinitialize the service with new relays
      this.init(validRelays);
    } catch (error) {
      this.logger.error('Error saving search relays to storage', error);
    }
  }

  /**
   * Loads search relays from local storage
   */
  private loadSearchRelaysFromStorage(): string[] {
    try {
      const storedRelays = this.localStorage.getItem(this.appState.SEARCH_RELAYS_STORAGE_KEY);
      if (storedRelays) {
        const parsedRelays = JSON.parse(storedRelays);
        if (Array.isArray(parsedRelays) && parsedRelays.length > 0) {
          this.logger.debug(`Loaded ${parsedRelays.length} search relays from storage`);
          return parsedRelays;
        }
      }
    } catch (error) {
      this.logger.error('Error loading search relays from storage', error);
    }
    return this.DEFAULT_SEARCH_RELAYS;
  }

  /**
   * Load search relays from kind 10007 event for a user
   */
  async loadFromEvent(pubkey: string): Promise<string[]> {
    try {
      // Try to get from database first
      const event = await this.database.getEventByPubkeyAndKind(pubkey, SearchRelayListKind);
      
      if (event) {
        const relayUrls = event.tags
          .filter(tag => tag[0] === 'relay' && tag[1])
          .map(tag => tag[1]);
        
        if (relayUrls.length > 0) {
          this.logger.debug(`Loaded ${relayUrls.length} search relays from kind 10007 event`);
          return relayUrls;
        }
      }
    } catch (error) {
      this.logger.error('Error loading search relays from event', error);
    }
    
    return this.DEFAULT_SEARCH_RELAYS;
  }

  /**
   * Creates an unsigned kind 10007 event for publishing search relay list
   */
  createSearchRelayListEvent(pubkey: string, relayUrls: string[]): UnsignedEvent {
    return {
      pubkey,
      kind: SearchRelayListKind,
      created_at: Math.floor(Date.now() / 1000),
      tags: relayUrls.map(url => ['relay', url]),
      content: '',
    };
  }

  /**
   * Save search relay list event to database
   */
  async saveEvent(event: Event): Promise<void> {
    try {
      await this.database.saveEvent(event);
      this.logger.debug('Saved search relay list event to database');
    } catch (error) {
      this.logger.error('Error saving search relay list event', error);
    }
  }
}
