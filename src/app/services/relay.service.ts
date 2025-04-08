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
  // TODO: Allow the user to set their own bootstrap relays in the settings.
  // TODO: The Nostr ecosystem should have a list of bootstrap relays that are reliable and fast, potentially only storing kind:10002.
  #bootStrapRelays = ['wss://relay.damus.io/', 'wss://relay.primal.net/', 'wss://nos.lol/'];
  bootStrapRelays = signal(this.#bootStrapRelays);

  // TODO: Allow the user to set their own default relays in the settings?
  // TODO: Decided on a good default relay list.
  #defaultRelays = ['wss://relay.damus.io/', 'wss://relay.primal.net/'];
  defaultRelays = signal(this.#defaultRelays);

  private readonly logger = inject(LoggerService);
  private readonly storage = inject(StorageService);

  // Signal to store the relays for the current user
  private relays = signal<Relay[]>([]);

  // Computed value for public access to relays
  userRelays = computed(() => this.relays());

  private userPool: SimplePool | null = null;

  constructor() {
    this.logger.info('Initializing RelayService');

    // When relays change, sync with storage
    effect(() => {
      const currentRelays = this.relays();
      this.logger.debug(`Relay effect triggered with ${currentRelays.length} relays`);

      // Since this is an effect, we don't want to persist on initialization
      if (currentRelays.length > 0) {
        this.syncRelaysToStorage();
      }
    });
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

    // In case we need access to the relays in the pool, we can use this code:
    // const poolRelays: Map<string, any> = (this.userPool as any).relays;
    // if (poolRelays instanceof Map) {
    //   for (const relay of this.relays()) {
    //     const poolRelay = poolRelays.get(relay.url);
    //     // const userRelay = this.relays().find(r => r.url === relay.url);

    //     if (!poolRelay) {
    //       this.logger.warn(`Relay ${relay.url} not found in user relays`);
    //       continue;
    //     }

    //     debugger;

    //     if (poolRelay._connected) {
    //       relay.status = 'connected';
    //     } else {
    //       relay.status = 'disconnected';
    //     }
    //   }
    // }
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
   * Load relays from storage by pubkey
   */
  async loadRelaysForUser(pubkey: string): Promise<void> {
    try {
      const userRelays = await this.storage.getUserRelays(pubkey);

      if (userRelays && userRelays.relays.length > 0) {
        this.logger.debug(`Found ${userRelays.relays.length} relays for user ${pubkey} in storage`);
        this.setRelays(userRelays.relays);
        return;
      }

      this.logger.debug(`No relays found for user ${pubkey} in storage`);
    } catch (error) {
      this.logger.error(`Error loading relays for user ${pubkey}`, error);
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

  async fetchUserMetadata(pubkey: string): Promise<any> {
    const userPool = new SimplePool();
    let relayUrls: string[] = [];

    // First fetch the relays for the user, if we don't have it.
    const userRelays = await this.storage.getUserRelays(pubkey);

    if (!userRelays || userRelays.relays.length === 0) {
      this.logger.warn(`No relays found for user ${pubkey}`);

      const bootstrapPool = new SimplePool();
      this.logger.debug('Connecting to user relays to fetch metadata');

      // Get and updated list of relays for the user from bootstrap relays.
      const relays = await bootstrapPool.get(this.#bootStrapRelays, {
        kinds: [kinds.RelayList],
        authors: [pubkey],
      });

      bootstrapPool.close(this.#bootStrapRelays);

      if (relays) {
        relayUrls = this.getRelaysFromRelayEvent(relays);
      } else {
        this.logger.warn('No relay list found for user!');
        // TODO: Should we look for kind 3 and use that?
      }
    }

    const metadata = await userPool.get(relayUrls, {
      kinds: [kinds.Metadata],
      authors: [pubkey],
    });

    if (metadata) {
      this.logger.info('Found user metadata', { metadata });

      try {
        // Parse the content field which should be JSON
        const metadataContent = JSON.parse(metadata.content);
        this.logger.debug('Parsed metadata content', { metadataContent });

        // Create a NostrEventData object to store the full content and tags
        const eventData: NostrEventData<UserMetadata> = {
          content: metadataContent,  // Store the parsed JSON object 
          tags: metadata.tags,       // Store the original tags
          // raw: metadata.content      // Optionally store the raw JSON string
        };

        // Save to storage with all fields and the full event data
        await this.storage.saveUserMetadata(pubkey, eventData);

        return eventData;

      } catch (e) {
        this.logger.error('Failed to parse metadata content', e);
      }
    } else {
      this.logger.warn('No metadata found for user');
    }

    return undefined;

    // Get an updated list of relays from the user's relays.

    // Fetch the user metadata from the user's relays.


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
