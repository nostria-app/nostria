import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { LoggerService } from './logger.service';
import { StorageService, Nip11Info, NostrEventData, UserMetadata } from './storage.service';
import { Event, kinds, SimplePool } from 'nostr-tools';

export interface Relay {
  url: string;
  status?: 'connected' | 'disconnected' | 'connecting' | 'error';
  lastUsed?: number;
}

@Injectable({
  providedIn: 'root'
})
export class RelayService {
  private readonly BOOTSTRAP_RELAYS_STORAGE_KEY = 'nostria-bootstrap-relays';
  
  // Default bootstrap relays
  private readonly DEFAULT_BOOTSTRAP_RELAYS = ['wss://purplepag.es/'];
  
  private readonly logger = inject(LoggerService);
  private readonly storage = inject(StorageService);
  
  // Initialize signals with empty arrays first, then populate in constructor
  #bootStrapRelays: string[] = [];
  bootStrapRelays = signal<string[]>([]);
  
  // TODO: Allow the user to set their own default relays in the settings?
  // TODO: Decided on a good default relay list.
  #defaultRelays = ['wss://relay.damus.io/', 'wss://relay.primal.net/'];
  defaultRelays = signal(this.#defaultRelays);

  // Signal to store the relays for the current user
  private relays = signal<Relay[]>([]);

  // Computed value for public access to relays
  userRelays = computed(() => this.relays());

  private userPool: SimplePool | null = null;

  constructor() {
    this.logger.info('Initializing RelayService');
    
    // Move bootstrap relay initialization to constructor
    this.#bootStrapRelays = this.loadBootstrapRelaysFromStorage() || this.DEFAULT_BOOTSTRAP_RELAYS;
    this.bootStrapRelays.set(this.#bootStrapRelays);

    // When relays change, sync with storage
    effect(() => {
      const currentRelays = this.relays();
      this.logger.debug(`Relay effect triggered with ${currentRelays.length} relays`);

      // Since this is an effect, we don't want to persist on initialization
      if (currentRelays.length > 0) {
        this.syncRelaysToStorage();
      }
    });
    
    // When bootstrap relays change, save to local storage
    effect(() => {
      const currentBootstrapRelays = this.bootStrapRelays();
      this.logger.debug(`Bootstrap relays effect triggered with ${currentBootstrapRelays.length} relays`);
      
      // Save to local storage
      localStorage.setItem(this.BOOTSTRAP_RELAYS_STORAGE_KEY, JSON.stringify(currentBootstrapRelays));
    });
  }
  
  /**
   * Loads bootstrap relays from local storage
   */
  private loadBootstrapRelaysFromStorage(): string[] | null {
    try {
      const storedRelays = localStorage.getItem(this.BOOTSTRAP_RELAYS_STORAGE_KEY);
      if (storedRelays) {
        const parsedRelays = JSON.parse(storedRelays);
        if (Array.isArray(parsedRelays)) {
          this.logger.debug(`Loaded ${parsedRelays.length} bootstrap relays from storage`);
          return parsedRelays;
        }
      }
    } catch (error) {
      this.logger.error('Error loading bootstrap relays from storage', error);
    }
    return null;
  }
  
  /**
   * Adds a bootstrap relay
   */
  addBootstrapRelay(url: string): void {
    this.logger.debug(`Adding bootstrap relay: ${url}`);
    
    // Make sure URL ends with /
    if (!url.endsWith('/')) {
      url += '/';
    }
    
    this.bootStrapRelays.update(relays => [...relays, url]);
  }
  
  /**
   * Removes a bootstrap relay
   */
  removeBootstrapRelay(url: string): void {
    this.logger.debug(`Removing bootstrap relay: ${url}`);
    this.bootStrapRelays.update(relays => relays.filter(relay => relay !== url));
  }
  
  /**
   * Resets bootstrap relays to defaults
   */
  resetBootstrapRelays(): void {
    this.logger.debug('Resetting bootstrap relays to defaults');
    this.bootStrapRelays.set(this.DEFAULT_BOOTSTRAP_RELAYS);
  }

  /**
   * Sets the list of relays for the current user
   */
  setRelays(relayUrls: string[]): void {
    this.logger.debug(`Setting ${relayUrls.length} relays for current user`);

    // Convert simple URLs to Relay objects with default properties
    const relayObjects = relayUrls.map(url => ({
      url,
      status: 'disconnected' as const,
      lastUsed: Date.now()
    }));

    // Before storing the relays, make sure that they have / at the end
    // if they are missing it. This ensures consistency in the relay URLs with SimplePool.
    relayObjects.forEach(relay => {
      if (!relay.url.endsWith('/')) {
        relay.url += '/';
      }
    });

    this.relays.set(relayObjects);
    this.logger.debug('Relays updated successfully');
  }

  /**
   * Sets the user pool
   */
  setUserPool(pool: SimplePool): void {
    this.userPool = pool;

    // After setting the user pool, check the online status of the relays
    this.logger.debug('User pool set, checking relay status...');

    const connectionStatuses = this.userPool.listConnectionStatus();

    // Update relay statuses using a for...of loop
    for (const [url, status] of connectionStatuses) {
      const userRelay = this.relays().find(r => r.url === url);

      if (!userRelay) {
        this.logger.warn(`Relay ${url} not found in user relays`);
        continue;
      }

      userRelay.status = status ? 'connected' : 'disconnected';
    }
  }

  /**
   * Gets the user pool
   */
  getUserPool(): SimplePool | null {
    return this.userPool;
  }

  /**
   * Updates the status of a specific relay
   */
  updateRelayStatus(url: string, status: Relay['status']): void {
    this.logger.debug(`Updating relay status for ${url} to ${status}`);

    this.relays.update(relays =>
      relays.map(relay =>
        relay.url === url
          ? { ...relay, status, lastUsed: Date.now() }
          : relay
      )
    );
  }

  /**
   * Adds a new relay to the list
   */
  addRelay(url: string): void {
    this.logger.debug(`Adding new relay: ${url}`);

    const newRelay: Relay = {
      url,
      status: 'disconnected',
      lastUsed: Date.now()
    };

    this.relays.update(relays => [...relays, newRelay]);
  }

  /**
   * Removes a relay from the list
   */
  removeRelay(url: string): void {
    this.logger.debug(`Removing relay: ${url}`);
    this.relays.update(relays => relays.filter(relay => relay.url !== url));
  }

  /**
   * Clears all relays (used when logging out)
   */
  clearRelays(): void {
    this.logger.debug('Clearing all relays');
    this.relays.set([]);
  }

  /**
   * Saves the current relays to storage for the current user
   */
  private async syncRelaysToStorage(): Promise<void> {
    try {
      const currentRelays = this.relays();

      // Save each relay to the storage
      for (const relay of currentRelays) {
        await this.storage.saveRelay(relay);
      }

      this.logger.debug(`Synchronized ${currentRelays.length} relays to storage`);
    } catch (error) {
      this.logger.error('Error syncing relays to storage', error);
    }
  }

  /**
   * Save user relays to storage
   */
  async saveUserRelays(pubkey: string): Promise<void> {
    try {
      const currentRelays = this.relays();
      const relayUrls = currentRelays.map(relay => relay.url);

      await this.storage.saveUserRelays({
        pubkey,
        relays: relayUrls,
        updated: Date.now()
      });

      this.logger.debug(`Saved ${relayUrls.length} relays for user ${pubkey} to storage`);
    } catch (error) {
      this.logger.error(`Error saving relays for user ${pubkey}`, error);
    }
  }

  getRelaysFromRelayEvent(relayEvent: Event): string[] {
    return relayEvent.tags.filter(tag => tag.length >= 2 && tag[0] === 'r').map(tag => tag[1]);
  }

  /**
   * Fetch NIP-11 information for a relay
   */
  async fetchNip11Info(relayUrl: string): Promise<Nip11Info | undefined> {
    try {
      this.logger.debug(`Fetching NIP-11 info for relay: ${relayUrl}`);

      // First check if we have cached NIP-11 info
      const storedRelay = await this.storage.getRelay(relayUrl);

      // If we have recent info (less than 24 hours old), use it
      if (storedRelay?.nip11 &&
        storedRelay.nip11.last_checked &&
        (Date.now() - storedRelay.nip11.last_checked) < 86400000) {
        this.logger.debug(`Using cached NIP-11 info for ${relayUrl}`);
        return storedRelay.nip11;
      }

      // Convert WebSocket URL to HTTP for NIP-11 document
      const httpUrl = relayUrl.replace(/^wss?:\/\//, 'https://');

      const response = await fetch(`${httpUrl}`, {
        headers: {
          'Accept': 'application/nostr+json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch NIP-11 info: ${response.status} ${response.statusText}`);
      }

      const nip11Data = await response.json();
      this.logger.debug(`Received NIP-11 info for ${relayUrl}`, nip11Data);

      // Save to storage
      const relayToSave: Relay = {
        url: relayUrl,
        lastUsed: Date.now(),
        status: storedRelay?.status || 'disconnected'
      };

      await this.storage.saveRelay(relayToSave, nip11Data);

      return nip11Data;
    } catch (error) {
      this.logger.error(`Error fetching NIP-11 info for ${relayUrl}`, error);
      return undefined;
    }
  }
}
