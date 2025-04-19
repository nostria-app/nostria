import { Injectable, signal, computed, effect, inject, untracked } from '@angular/core';
import { Event, generateSecretKey, getPublicKey, UnsignedEvent, VerifiedEvent } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import * as nip19 from 'nostr-tools/nip19';
import { LoggerService } from './logger.service';
import { RelayService } from './relay.service';
import { NostrEventData, StorageService, UserMetadata } from './storage.service';
import { kinds, SimplePool } from 'nostr-tools';
import { NostrEvent } from '../interfaces';
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import { BunkerPointer, BunkerSigner, parseBunkerInput } from 'nostr-tools/nip46';
import { NostrTagKey, StandardizedTagType } from '../standardized-tags';
import { ApplicationStateService } from './application-state.service';

export interface NostrUser {
  pubkey: string;
  privkey?: string;
  name?: string;
  source: 'extension' | 'nsec' | 'preview' | 'remote';
  lastUsed?: number; // Timestamp when this account was last used
  bunker?: BunkerPointer;
}

export interface UserMetadataWithPubkey extends NostrEventData<UserMetadata> {
  pubkey: string;
}

@Injectable({
  providedIn: 'root'
})
export class NostrService {
  private readonly ACCOUNT_STORAGE_KEY = 'nostria-account';
  private readonly ACCOUNTS_STORAGE_KEY = 'nostria-accounts';
  private readonly logger = inject(LoggerService);
  private readonly relayService = inject(RelayService);
  private readonly storage = inject(StorageService);
  private readonly appState = inject(ApplicationStateService);

  private account = signal<NostrUser | null>(null);
  private accounts = signal<NostrUser[]>([]);

  // Signal to store metadata for all users - using array instead of Map
  // private allUserMetadata = signal<UserMetadataWithPubkey[]>([]);

  /** Holds the metadata event for all accounts in the app. */
  accountsMetadata = signal<NostrEvent[]>([]);
  accountsRelays = signal<NostrEvent[]>([]);

  // These are cache-lookups for the metadata and relays of all users,
  // to avoid query the database all the time.
  // These lists will grow
  usersMetadata = signal<Map<string, NostrEvent>>(new Map());
  usersRelays = signal<Map<string, NostrEvent>>(new Map());

  isLoggedIn = computed(() => {
    const result = !!this.account();
    this.logger.debug('isLoggedIn computed value calculated', { isLoggedIn: result });
    return result;
  });

  pubkey = computed(() => {
    const currentUser = this.account();
    return currentUser!.pubkey;
  });

  activeAccount = computed(() => {
    return this.account();
  });

  allAccounts = computed(() => {
    return this.accounts();
  });

  hasAccounts = computed(() => {
    return this.allAccounts().length > 0;
  });

  discoveryQueue: any = [];
  activeDiscoveries: any = [];
  MAX_CONCURRENT_DISCOVERIES = 1;

  // Expose the metadata as a computed property
  // usersMetadata = computed(() => {
  //   return this.allUserMetadata();
  // });

  // Method to easily find metadata by pubkey
  getMetadataForAccount(pubkey: string): NostrEvent | undefined {
    return this.accountsMetadata().find(meta => meta.pubkey === pubkey);
  }

  initialized = signal(false);

  constructor() {
    this.logger.info('Initializing NostrService');

    effect(async () => {
      if (this.storage.initialized()) {

        try {
          untracked(async () => {
            await this.loadData();
          });

          this.loadAccountsFromStorage();
          this.loadActiveAccountFromStorage();

          // We keep an in-memory copy of the user metadata and relay list for all accounts,
          // they won't take up too much memory space.
          await this.loadAccountsMetadata();
          await this.loadAccountsRelays();

          this.initialized.set(true);
        } catch (err) {
          console.log('FAILED TO LOAD DATA!!');
          console.error(err);
        }

      }
    });

    // Save user to localStorage whenever it changes
    effect(() => {
      if (this.storage.initialized()) {

        const currentUser = this.account();
        this.logger.debug('User change effect triggered', {
          hasUser: !!currentUser,
          pubkey: currentUser?.pubkey
        });

        if (currentUser) {
          this.logger.debug('Saving current user to localStorage', { pubkey: currentUser.pubkey });
          localStorage.setItem(this.ACCOUNT_STORAGE_KEY, JSON.stringify(currentUser));

          // Load relays for this user from storage
          // untracked(() => {
          //   this.relayService.loadRelaysForUser(currentUser.pubkey)
          //     .catch(err => this.logger.error('Failed to load relays for user', err));
          // });
        }
      }
    });

    // Save all users to localStorage whenever they change
    effect(() => {
      const allUsers = this.accounts();

      if (allUsers.length === 0) {
        this.logger.debug('No users to save to localStorage');
        return;
      }

      this.logger.debug('Users collection effect triggered', { count: allUsers.length });

      this.logger.debug(`Saving ${allUsers.length} users to localStorage`);
      localStorage.setItem(this.ACCOUNTS_STORAGE_KEY, JSON.stringify(allUsers));

      // When users change, ensure we have metadata for all of them
      // untracked(() => {
      //   this.loadAllUsersMetadata().catch(err =>
      //     this.logger.error('Failed to load metadata for all users', err));
      // });
    });

    this.logger.debug('NostrService initialization completed');

    // Initial load of metadata for all users
    // this.loadAllUsersMetadata().catch(err => 
    //   this.logger.error('Failed to load initial metadata for all users', err));
  }

  reset() {
    this.accounts.set([]);
    this.account.set(null);
    this.accountsMetadata.set([]);
    this.accountsRelays.set([]);
  }

  async loadData(): Promise<void> {
    if (!this.activeAccount()) {
      this.logger.warn('Cannot load data: No user is logged in');
      return;
    }

    debugger;

    this.appState.loadingMessage.set('Retrieving your relay list...');
    this.appState.isLoading.set(true);
    this.appState.showSuccess.set(false);
    this.logger.info('Starting data loading process');

    const pubkey = this.pubkey();
    this.logger.debug('Loading data for pubkey', { pubkey });

    let profile = null;
    let metadata = null;

    // First check if we have metadata in storage
    metadata = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.Metadata);

    if (metadata) {
      this.logger.info('Found user metadata in storage', { metadata });
      this.appState.loadingMessage.set('Found your profile in local storage! 👍');

      // Process and update metadata for UI refresh
      this.updateAccountMetadata(metadata);

      // Also store in userMetadata for legacy support
      // try {
      //   // Parse the content field which should be JSON
      //   const metadataContent = typeof metadata.content === 'string' 
      //     ? JSON.parse(metadata.content) 
      //     : metadata.content;

      //   // Create a NostrEventData object to store the full content and tags
      //   const eventData: NostrEventData<UserMetadata> = {
      //     pubkey: metadata.pubkey,
      //     content: metadataContent,  // Store the parsed JSON object 
      //     tags: metadata.tags,       // Store the original tags
      //     updated: Date.now()
      //   };

      //   // Save to storage with all fields and the full event data
      //   await this.storage.saveUserMetadata(pubkey, eventData);
      // } catch (e) {
      //   this.logger.error('Failed to parse metadata content', e);
      // }
    }

    // Get existing Relay List in storage
    let relays = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.RelayList);

    if (relays) {
      this.logger.info('Found user relays in storage', { relays });
      this.appState.loadingMessage.set('Found your relays in local storage! ✔️');
    }

    let bootstrapPool: SimplePool | null = null;

    if (!relays) {
      // To properly scale Nostr, the first step is simply getting the user's relay list and nothing more.
      bootstrapPool = new SimplePool();
      this.logger.debug('Connecting to bootstrap relays', { relays: this.relayService.bootStrapRelays() });

      this.logger.time('fetchRelayList');
      relays = await bootstrapPool.get(this.relayService.bootStrapRelays(), {
        kinds: [kinds.RelayList],
        authors: [pubkey],
      });
      this.logger.timeEnd('fetchRelayList');

      if (relays) {
        this.logger.info('Found your relays on network', { relays });
        this.appState.loadingMessage.set('Found your relays on the network! ✔️');
        await this.storage.saveEvent(relays);
      }
    }

    let relayUrls: string[] = [];

    if (relays) {
      relayUrls = this.getRelayUrls(relays);
      this.logger.info(`Found ${relayUrls.length} relays for user`, { relayUrls });

      // Store the relays in the relay service
      this.relayService.setRelays(relayUrls);
    }

    // If there is no relayUrls (the kind:10002 might miss it), use default for fallback:
    if (!relayUrls || relayUrls.length == 0) {
      this.logger.warn('No relay list found for user');
      // Set default bootstrap relays if no custom relays found
      const defaultRelays = [...this.relayService.defaultRelays()];
      this.relayService.setRelays(defaultRelays);
      relayUrls = defaultRelays;
    }

    const userPool = new SimplePool();
    this.logger.debug('Connecting to user relays to fetch metadata');

    // Attempt to connect to the user's defined relays, to help Nostr with
    // scaling, we don't use the default relays here.
    if (metadata) {
      this.appState.loadingMessage.set(`Found your ${relayUrls.length} relays, refreshing your metadata...`);
    } else {
      this.appState.loadingMessage.set(`Found your ${relayUrls.length} relays, retrieving your metadata...`);

      this.logger.time('fetchMetadata');
      metadata = await userPool.get(relayUrls, {
        kinds: [kinds.Metadata],
        authors: [pubkey],
      });
      this.logger.timeEnd('fetchMetadata');

      if (metadata) {
        this.logger.info('Found user metadata', { metadata });
        this.appState.loadingMessage.set('Found your profile! 👍');
        await this.storage.saveEvent(metadata);

        // Update the metadata in NostrService
        this.updateAccountMetadata(metadata);

        try {
          // Parse the content field which should be JSON
          const metadataContent = typeof metadata.content === 'string'
            ? JSON.parse(metadata.content)
            : metadata.content;

          // Create a NostrEventData object to store the full content and tags
          const eventData: NostrEventData<UserMetadata> = {
            pubkey: metadata.pubkey,
            content: metadataContent,  // Store the parsed JSON object 
            tags: metadata.tags,       // Store the original tags
            updated: Date.now()
          };

          // Save to storage with all fields and the full event data
          await this.storage.saveUserMetadata(pubkey, eventData);
        } catch (e) {
          this.logger.error('Failed to parse metadata content', e);
        }
      } else {
        this.logger.warn('No metadata found for user');
      }
    }

    // Attach the userPool to the relay service for further use.
    this.relayService.setUserPool(userPool);

    if (bootstrapPool) {
      this.logger.debug('Closing bootstrap relay pool connections');
      bootstrapPool.close(this.relayService.bootStrapRelays());
    }

    this.appState.loadingMessage.set('Loading completed!');
    this.logger.info('Data loading process completed');

    // Show success animation instead of waiting
    this.appState.isLoading.set(false);
    this.appState.showSuccess.set(true);

    // Hide success animation after 1.5 seconds
    setTimeout(() => {
      this.appState.showSuccess.set(false);
    }, 1500);
  }

  async signEvent(event: UnsignedEvent) {
    return this.sign(event);
  }

  private async sign(event: UnsignedEvent): Promise<NostrEvent> {
    const currentUser = this.account();

    if (!currentUser) {
      throw new Error('No user account found. Please log in or create an account first.');
    }

    let signedEvent: NostrEvent | null = null;

    switch (currentUser?.source) {
      case 'extension':
        if (!window.nostr) {
          throw new Error('Nostr extension not found. Please install Alby, nos2x, or another NIP-07 compatible extension.');
        }

        const extensionResult = await window.nostr.signEvent(event);

        signedEvent = {
          ...event,
          id: extensionResult.id,
          sig: extensionResult.sig,
        };

        break;
      case 'remote':
        debugger;
        const pool = new SimplePool()
        const bunker = new BunkerSigner(hexToBytes(currentUser.privkey!), this.account()!.bunker!, { pool });
        signedEvent = await bunker.signEvent(event);
        this.logger.info('Using remote signer account');
        break;

      case 'preview':
        throw new Error('Preview accounts cannot sign events. Please use a different account type.');
        break;
      case 'nsec':
        signedEvent = finalizeEvent(event, hexToBytes(currentUser.privkey!));
        break;
    }

    return signedEvent;
  }

  currentDate() {
    return Math.floor(Date.now() / 1000);
  }

  futureDate(minutes: number) {
    return Math.floor((Date.now() + minutes * 60 * 1000) / 1000);
  }

  createEvent(kind: number, content: string, tags: string[][]): UnsignedEvent {
    const event: UnsignedEvent = {
      kind: kind,
      created_at: this.currentDate(),
      tags,
      content,
      pubkey: this.pubkey(),
    };

    return event;
  }

  /**
 * Adds or updates an entry in the metadata cache with LRU behavior
 */
  private updateMetadataCache(pubkey: string, event: NostrEvent): void {
    // Get the current cache
    const cache = this.usersMetadata();

    // If the pubkey exists, delete it first (to update position in Map)
    if (cache.has(pubkey)) {
      cache.delete(pubkey);
    }

    // Add to the end (newest position)
    cache.set(pubkey, event);

    // Enforce size limit (100 items)
    if (cache.size > 100) {
      // Delete oldest item (first in the Map)
      const oldestKey = cache.keys().next().value;

      if (oldestKey) {
        cache.delete(oldestKey);
      }
    }

    // Update signal
    this.usersMetadata.set(new Map(cache));
  }

  /**
   * Adds or updates an entry in the relays cache with LRU behavior
   */
  private updateRelaysCache(pubkey: string, event: NostrEvent): void {
    // Get the current cache
    const cache = this.usersRelays();

    // If the pubkey exists, delete it first (to update position in Map)
    if (cache.has(pubkey)) {
      cache.delete(pubkey);
    }

    // Add to the end (newest position)
    cache.set(pubkey, event);

    // Enforce size limit (100 items)
    if (cache.size > 100) {
      // Delete oldest item (first in the Map)
      const oldestKey = cache.keys().next().value;

      if (oldestKey) {
        cache.delete(oldestKey);
      }
    }

    // Update signal
    this.usersRelays.set(new Map(cache));
  }

  /**
   * Get metadata from cache or load it from storage
   */
  async getMetadataForUser(pubkey: string, disconnect = true): Promise<NostrEvent | undefined> {
    // Check cache first
    const cachedMetadata = this.usersMetadata().get(pubkey);
    if (cachedMetadata) {
      // Move to end of LRU cache
      this.updateMetadataCache(pubkey, cachedMetadata);
      return cachedMetadata;
    }

    // Not in cache, get from storage
    const events = await this.storage.getEventsByPubkeyAndKind(pubkey, kinds.Metadata);

    if (events.length > 0) {
      // Add to cache
      this.updateMetadataCache(pubkey, events[0]);
      return events[0];
    } else {
      // const metadata = await this.discoverMetadata(pubkey, disconnect);
      const metadata = await this.queueMetadataDiscovery(pubkey, disconnect);

      if (metadata) {
        this.updateMetadataCache(pubkey, metadata);
      }

      return metadata;
    }
  }

  /** Get the BUD-03: User Server List */
  async getMediaServers(pubkey: string): Promise<NostrEvent | null> {
    // Check cache first
    // const cachedMetadata = this.usersMetadata().get(pubkey);
    // if (cachedMetadata) {
    //   // Move to end of LRU cache
    //   this.updateMetadataCache(pubkey, cachedMetadata);
    //   return cachedMetadata;
    // }

    // Get from storage
    let event = await this.storage.getEventByPubkeyAndKind(pubkey, 10063); // BUD-03: User Server List

    if (!event) {
      event = await this.relayService.getEventByPubkeyAndKind(pubkey, 10063);
    } else {
      // Queue up refresh of this event in the background
      this.relayService.getEventByPubkeyAndKind(pubkey, 10063).then((newEvent) => {
        this.storage.saveEvent(newEvent as NostrEvent);
      });
    }

    return event;
  }

  currentProfileUserPool: SimplePool | null = null;
  currentProfileRelayUrls: string[] = [];

  async discoverMetadata(pubkey: string, disconnect = true): Promise<NostrEvent | undefined> {
    // FLOW: Find the user's relays first. Save it.
    // Connect to their relays and get metadata. Save it.
    const event = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.RelayList);

    if (!event) {
      // TODO: Duplicate code from data-loading service. Refactor and improve!!
      let bootstrapPool = new SimplePool();
      this.logger.debug('Connecting to bootstrap relays', { relays: this.relayService.bootStrapRelays() });

      const relays = await bootstrapPool.get(this.relayService.bootStrapRelays(), {
        kinds: [kinds.RelayList],
        authors: [pubkey],
      });

      bootstrapPool.close(this.relayService.bootStrapRelays());

      if (relays) {
        await this.storage.saveEvent(relays);

        const relayUrls = this.getRelayUrls(relays);

        let metadata = null;

        this.logger.debug('Trying to fetch metadata from individual relays', { relayCount: relayUrls.length });

        // Try each relay individually until we find metadata
        for (const relayUrl of relayUrls) {
          let userPool = new SimplePool();

          try {
            this.logger.debug('Attempting to fetch metadata from relay', { relay: relayUrl });
            metadata = await userPool.get([relayUrl], {
              kinds: [kinds.Metadata],
              authors: [pubkey],
            }, {
              maxWait: 3000
            });

            userPool.close([relayUrl]); // Close the pool for this relay

            if (metadata) {
              this.logger.debug('Successfully retrieved metadata', { relay: relayUrl });
              break; // Stop trying more relays once we've found metadata
            }
          } catch (error) {
            this.logger.debug('Failed to fetch metadata from relay', { relay: relayUrl, error });
            // Continue to the next relay on failure
          }
        }

        if (metadata) {
          await this.storage.saveEvent(metadata);
        }

        // this.currentProfileUserPool = userPool;
        // this.currentProfileRelayUrls = relayUrls;

        // if (disconnect) {
        //   userPool.close(relayUrls);
        // }

        return metadata as NostrEvent;
      }
    }

    return undefined;
  }

  private async queueMetadataDiscovery(pubkey: string, disconnect = true): Promise<NostrEvent | undefined> {
    return new Promise((resolve, reject) => {
      this.discoveryQueue.push({ pubkey, disconnect, resolve, reject });
      this.logger.debug('Queued metadata discovery', { pubkey, queueLength: this.discoveryQueue.length });

      this.processDiscoveryQueue();
    });
  }

  private async processDiscoveryQueue(): Promise<void> {
    if (this.activeDiscoveries >= this.MAX_CONCURRENT_DISCOVERIES) {
      return;
    }

    const next = this.discoveryQueue.shift();
    if (!next) {
      return;
    }

    this.activeDiscoveries++;
    this.logger.debug('Starting metadata discovery', {
      pubkey: next.pubkey,
      activeDiscoveries: this.activeDiscoveries,
      queueRemaining: this.discoveryQueue.length
    });

    try {
      const result = await this.discoverMetadata(next.pubkey, next.disconnect);
      next.resolve(result);
    } catch (error) {
      this.logger.error('Error discovering metadata', { pubkey: next.pubkey, error });
      next.reject(error);
    } finally {
      this.activeDiscoveries--;
      this.logger.debug('Completed metadata discovery', {
        pubkey: next.pubkey,
        activeDiscoveries: this.activeDiscoveries,
        queueRemaining: this.discoveryQueue.length
      });

      this.processDiscoveryQueue();
    }
  }

  async loginWithNostrConnect(remoteSigningUrl: string) {
    this.logger.info('Attempting to login with Nostr Connect', { url: remoteSigningUrl });

    const bunkerParsed = await parseBunkerInput(remoteSigningUrl);

    console.log(bunkerParsed);

    try {
      // Parse the URL
      if (!remoteSigningUrl.startsWith('bunker://')) {
        throw new Error('Invalid Nostr Connect URL format. Must start with bunker://');
      }

      // Extract components from the URL properly
      // The format is bunker://PUBKEY?relay=URL&relay=URL&secret=SECRET
      const withoutProtocol = remoteSigningUrl.substring('bunker://'.length);

      // Find the first ? which separates pubkey from params
      const questionMarkIndex = withoutProtocol.indexOf('?');
      if (questionMarkIndex === -1) {
        throw new Error('Invalid Nostr Connect URL: missing parameters');
      }

      // Extract pubkey (everything before ?)
      const pubkey = withoutProtocol.substring(0, questionMarkIndex);

      // Parse the query parameters
      const searchParams = new URLSearchParams(withoutProtocol.substring(questionMarkIndex));

      // Get all relay parameters
      const relays = searchParams.getAll('relay');

      // Get the secret
      const secret = searchParams.get('secret');

      if (!pubkey || !secret || relays.length === 0) {
        throw new Error('Invalid Nostr Connect URL: missing required components');
      }

      this.logger.debug('Parsed Nostr Connect URL', {
        pubkey,
        relayCount: relays.length,
        secret: `${secret?.substring(0, 4)}...` // Log only prefix for security
      });

      // Create a connection pool for Nostr Connect
      const connectPool = new SimplePool();

      let privateKey = generateSecretKey();
      let publicKey = getPublicKey(privateKey);

      // const connToken = "bunker://deadbeef...?relay=wss%3A%2F%2Frelay.nsecbunker.com&secret=..."
      // const { signer, session } = await Nip46RemoteSigner.connectToRemote(remoteSigningUrl, { encryptionAlgorithm: 'nip44' });

      // console.log('SESSION:', session);
      // console.log('SIGNER:', signer);
      // debugger;

      // store session data to LocalStorage
      // localStorage.setItem("nostr_connect_session", JSON.stringify(session));

      const pool = new SimplePool()
      const bunker = new BunkerSigner(privateKey, bunkerParsed!, { pool });
      await bunker.connect();

      const remotePublicKey = await bunker.getPublicKey();
      console.log('Remote Public Key:', remotePublicKey);

      this.logger.info('Using remote signer account');
      // jack
      const newUser: NostrUser = {
        privkey: bytesToHex(privateKey),
        pubkey: remotePublicKey,
        name: 'Remote Signer',
        source: 'remote', // With 'remote' type, the actually stored pubkey is not connected with the prvkey.
        bunker: bunkerParsed!,
        lastUsed: Date.now()
      };

      this.setAccount(newUser);
      this.logger.debug('Remote signer account set successfully', { pubkey: remotePublicKey });

      // let event = finalizeEvent({
      //   kind: kinds.NostrConnect,
      //   created_at: Math.floor(Date.now() / 1000),
      //   tags: [["p", pubkey]],
      //   content: 'hello',
      // }, privateKey);

      // let isGood = verifyEvent(event)

      // console.log('Event is good:', isGood, event, privateKey, publicKey);

      // const result = await connectPool.publish(relays, event);
      // console.log('Result:', result);

      // Store connection information
      // const newUser: NostrUser = {
      //   pubkey,
      //   name: this.getTruncatedNpub(pubkey),
      //   source: 'extension', // Using extension as source type for remote signer
      //   lastUsed: Date.now()
      // };

      // // Add the user to our accounts
      // this.setAccount(newUser);

      // TODO: Implement actual NIP-46 protocol communication
      // This would establish WebSocket connections to the relays
      // and implement the remote signing protocol

      this.logger.info('Nostr Connect login successful', { pubkey });

      return {
        pubkey,
        relays,
        secret
      };
    } catch (error) {
      this.logger.error('Error parsing Nostr Connect URL:', error);
      throw error;
    }
  }

  // async discoverRelays(pubkey: string, disconnect = true): Promise<NostrEvent | undefined> {
  //   // FLOW: Find the user's relays first. Save it.
  //   // Connect to their relays and get metadata. Save it.
  //   const event = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.RelayList);

  //   if (!event) {
  //     // TODO: Duplicate code from data-loading service. Refactor and improve!!
  //     let bootstrapPool = new SimplePool();
  //     this.logger.debug('Connecting to bootstrap relays', { relays: this.relayService.bootStrapRelays() });

  //     const relays = await bootstrapPool.get(this.relayService.bootStrapRelays(), {
  //       kinds: [kinds.RelayList],
  //       authors: [pubkey],
  //     });

  //     bootstrapPool.close(this.relayService.bootStrapRelays());

  //     if (relays) {
  //       await this.storage.saveEvent(relays);

  //       const relayUrls = this.getRelayUrls(relays);

  //       let userPool = new SimplePool();

  //       const metadata = await userPool.get(relayUrls, {
  //         kinds: [kinds.Metadata],
  //         authors: [pubkey],
  //       });

  //       if (metadata) {
  //         await this.storage.saveEvent(metadata);
  //       }

  //       this.currentProfileUserPool = userPool;
  //       this.currentProfileRelayUrls = relayUrls;

  //       if (disconnect) {
  //         userPool.close(relayUrls);
  //       }

  //       return metadata as NostrEvent;
  //     }
  //   }

  //   return undefined;
  // }

  /**
   * Get relays from cache or load from storage
   */
  async getRelaysForUser(pubkey: string, disconnect = true): Promise<Event | undefined> {
    // Check cache first
    const cachedRelays = this.usersRelays().get(pubkey);
    if (cachedRelays) {
      // Move to end of LRU cache
      this.updateRelaysCache(pubkey, cachedRelays);
      return cachedRelays;
    }

    // Not in cache, get from storage
    const events = await this.storage.getEventsByPubkeyAndKind(pubkey, kinds.RelayList);
    if (events.length > 0) {
      // Add to cache
      this.updateRelaysCache(pubkey, events[0]);
      return events[0];
    } else {
      // This should never happen, relays should be discovered while getting metadata
      // and stored in database.
      debugger;

      // TODO!! and use "disconnect" paramter.
      // TODO: Implement this.
      // Go get the relay list for the user from the nostr relays.
      // const relays = await this.discoverRelays(pubkey, disconnect);

      // if (relays) {
      //   this.updateRelaysCache(pubkey, relays);
      // }

      // return relays;
    }

    return undefined;
  }

  private loadAccountsFromStorage(): void {
    const usersJson = localStorage.getItem(this.ACCOUNTS_STORAGE_KEY);
    if (usersJson) {
      try {
        const parsedUsers = JSON.parse(usersJson);
        this.logger.debug(`Loaded ${parsedUsers.length} users from localStorage`);
        this.accounts.set(parsedUsers);
      } catch (e) {
        this.logger.error('Failed to parse users from localStorage', e);
        this.accounts.set([]);
      }
    } else {
      this.logger.debug('No users found in localStorage');
    }
  }

  private loadActiveAccountFromStorage(): void {
    const userJson = localStorage.getItem(this.ACCOUNT_STORAGE_KEY);
    if (userJson) {
      try {
        const parsedUser = JSON.parse(userJson);
        this.logger.debug('Loaded active user from localStorage', { pubkey: parsedUser.pubkey });
        this.account.set(parsedUser);
      } catch (e) {
        this.logger.error('Failed to parse user from localStorage', e);
      }
    } else {
      this.logger.debug('No active user found in localStorage');
    }
  }

  async loadAccountsMetadata() {
    const pubkeys = this.accounts().map(user => user.pubkey);
    const events = await this.storage.getEventsByPubkeyAndKind(pubkeys, kinds.Metadata);

    // Process each event to ensure content is parsed
    const processedEvents = events.map(event => {
      if (event.content && typeof event.content === 'string') {
        try {
          const parsedEvent = { ...event };
          parsedEvent.content = JSON.parse(event.content);
          return parsedEvent;
        } catch (e) {
          this.logger.error('Failed to parse event content in loadUsersMetadata', e);
        }
      }
      return event;
    });

    this.accountsMetadata.set(processedEvents);
    return processedEvents;
  }

  async loadAccountsRelays() {
    const pubkeys = this.accounts().map(user => user.pubkey);
    const relays = await this.storage.getEventsByPubkeyAndKind(pubkeys, kinds.RelayList);
    this.accountsRelays.set(relays);
  }

  async updateAccountMetadata(event: Event) {
    const pubkey = event.pubkey;

    // Ensure content is properly parsed
    if (event.content && typeof event.content === 'string') {
      try {
        event.content = JSON.parse(event.content);
      } catch (e) {
        this.logger.error('Failed to parse event content in updateAccountMetadata', e);
      }
    }

    // Add to the metadata array
    const existingMetadata = this.accountsMetadata().find(meta => meta.pubkey === pubkey);

    if (existingMetadata) {
      this.logger.debug('Updating existing metadata', { pubkey });
      this.accountsMetadata.update(array =>
        array.map(meta => meta.pubkey === pubkey ? event : meta));
    } else {
      this.logger.debug('Adding new metadata', { pubkey });
      this.accountsMetadata.update(array => [...array, event]);
    }

    // Also update the cache for getMetadataForUser
    if (this.usersMetadata().has(pubkey)) {
      this.updateMetadataCache(pubkey, event);
    }
  }

  getTruncatedNpub(pubkey: string): string {
    const npub = this.getNpubFromPubkey(pubkey);
    return npub.length > 12
      ? `${npub.substring(0, 6)}...${npub.substring(npub.length - 6)}`
      : npub;
  }

  getRelayUrls(event: Event): string[] {
    return event.tags.filter(tag => tag.length >= 2 && tag[0] === 'r').map(tag => tag[1]);
  }

  getTags(event: Event, tagType: NostrTagKey): string[] {
    return event.tags.filter(tag => tag.length >= 2 && tag[0] === tagType).map(tag => tag[1]);
  }

  switchToUser(pubkey: string): boolean {
    this.logger.info(`Switching to user with pubkey: ${pubkey}`);
    const targetUser = this.accounts().find(u => u.pubkey === pubkey);

    if (targetUser) {
      // Update lastUsed timestamp
      targetUser.lastUsed = Date.now();

      this.account.set(targetUser);
      this.logger.debug('Successfully switched user');

      // Make sure we have the latest metadata for this user
      // this.getUserMetadata(pubkey).catch(err =>
      //   this.logger.error(`Failed to refresh metadata for user ${pubkey}`, err));

      return true;
    }

    this.logger.warn(`User with pubkey ${pubkey} not found`);
    return false;
  }

  setAccount(user: NostrUser) {
    this.logger.debug('Updating user in collection', { pubkey: user.pubkey });

    // Update lastUsed timestamp
    user.lastUsed = Date.now();
    user.name ??= this.getTruncatedNpub(user.pubkey);

    const allUsers = this.accounts();
    const existingUserIndex = allUsers.findIndex(u => u.pubkey === user.pubkey);

    if (existingUserIndex >= 0) {
      // Update existing user
      this.logger.debug('Updating existing user in collection', { index: existingUserIndex });
      this.accounts.update(u => u.map(existingUser => existingUser.pubkey === user.pubkey ? user : existingUser));
    } else {
      // Add new user
      this.logger.debug('Adding new user to collection');
      this.accounts.update(u => [...u, user]);
    }

    // Trigger the user signal which indicates user is logged on.
    this.account.set(user);

    // Make sure we have the latest metadata for this user
    // this.getUserMetadata(user.pubkey).catch(err =>
    //   this.logger.error(`Failed to get metadata for new user ${user.pubkey}`, err));
  }

  generateNewKey(): void {
    this.logger.info('Generating new Nostr keypair');
    // Generate a proper Nostr key pair using nostr-tools
    const secretKey = generateSecretKey(); // Returns a Uint8Array
    const pubkey = getPublicKey(secretKey); // Converts to hex string

    // We'll store the hex string representation of the private key
    // In a real app, you might want to encrypt this before storing
    const privkeyHex = bytesToHex(secretKey);

    const newUser: NostrUser = {
      pubkey,
      privkey: privkeyHex,
      source: 'nsec',
      lastUsed: Date.now()
    };

    this.logger.debug('New keypair generated successfully', { pubkey });
    this.setAccount(newUser);
  }

  async loginWithExtension(): Promise<void> {
    this.logger.info('Attempting to login with Nostr extension');
    try {
      // Check if NIP-07 extension is available
      if (!window.nostr) {
        const error = 'No Nostr extension found. Please install Alby, nos2x, or another NIP-07 compatible extension.';
        this.logger.error(error);
        throw new Error(error);
      }

      // Get the public key from the extension
      this.logger.debug('Requesting public key from extension');
      const pubkey = await window.nostr.getPublicKey();

      if (!pubkey) {
        const error = 'Failed to get public key from extension';
        this.logger.error(error);
        throw new Error(error);
      }

      this.logger.debug('Received public key from extension', { pubkey });

      // Get user metadata if available
      let name: string | undefined = undefined;
      try {
        // Some extensions may provide user metadata like name
        this.logger.debug('Requesting user metadata from extension');
        const userInfo = await window.nostr.getUserMetadata();
        name = userInfo?.name;
        this.logger.debug('Received user metadata', { name });
      } catch (error) {
        // Ignore errors for metadata, it's optional
        this.logger.warn('Could not get user metadata from extension', error);
      }

      // Set the user with the public key from the extension
      const newUser: NostrUser = {
        pubkey,
        name,
        source: 'extension',
        lastUsed: Date.now()
      };

      this.logger.info('Login with extension successful', { pubkey });
      this.setAccount(newUser);

      return;
    } catch (error) {
      this.logger.error('Error connecting to Nostr extension:', error);
      throw error; // Re-throw to handle in the UI
    }
  }

  loginWithNsec(nsec: string): void {
    try {
      this.logger.info('Attempting to login with nsec');
      // Validate and decode the nsec
      if (!nsec.startsWith('nsec')) {
        const error = 'Invalid nsec format. Must start with "nsec"';
        this.logger.error(error);
        throw new Error(error);
      }

      // Decode the nsec to get the private key bytes
      const { type, data } = nip19.decode(nsec);

      if (type !== 'nsec') {
        const error = `Expected nsec but got ${type}`;
        this.logger.error(error);
        throw new Error(error);
      }

      // Convert the private key bytes to hex string
      const privkeyHex = bytesToHex(data);

      // Generate the public key from the private key
      const pubkey = getPublicKey(data);

      // Store the user info
      const newUser: NostrUser = {
        pubkey,
        privkey: privkeyHex,
        source: 'nsec',
        lastUsed: Date.now()
      };

      this.logger.info('Login with nsec successful', { pubkey });
      this.setAccount(newUser);
    } catch (error) {
      this.logger.error('Error decoding nsec:', error);
      throw new Error('Invalid nsec key provided. Please check and try again.');
    }
  }

  usePreviewAccount(): void {
    this.logger.info('Using preview account');
    // jack
    const previewPubkey = '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2';
    const newUser: NostrUser = {
      pubkey: previewPubkey,
      name: 'Preview User',
      source: 'preview',
      lastUsed: Date.now()
    };

    this.setAccount(newUser);
    this.logger.debug('Preview account set successfully', { pubkey: previewPubkey });
  }

  logout(): void {
    this.logger.info('Logging out current user');
    localStorage.removeItem(this.ACCOUNT_STORAGE_KEY);
    this.account.set(null);
    this.logger.debug('User logged out successfully');
  }

  removeAccount(pubkey: string): void {
    this.logger.info(`Removing account with pubkey: ${pubkey}`);
    const allUsers = this.accounts();
    const updatedUsers = allUsers.filter(u => u.pubkey !== pubkey);
    this.accounts.set(updatedUsers);

    // If we're removing the active user, set active user to null
    if (this.account()?.pubkey === pubkey) {
      this.logger.debug('Removed account was the active user, logging out');
      this.account.set(null);
    }

    // Remove the user's metadata from the metadata array
    // this.accountsMetadata().update(array => array.filter(m => m.pubkey !== pubkey));
    // this.accountsMetadata()
    this.accountsMetadata.update(array => array.filter(m => m.pubkey !== pubkey));
    this.logger.debug('Account removed successfully');
  }

  getNsecFromPrivkey(privkey: string): string {
    this.logger.debug('Converting private key to nsec');
    // Convert the hex private key to a Nostr secret key (nsec)
    const bytes = hexToBytes(privkey);
    const nsec = nip19.nsecEncode(bytes);
    return nsec;
  }

  getNpubFromPubkey(pubkey: string): string {
    this.logger.debug('Converting public key to npub');
    // Convert the hex public key to a Nostr public key (npub)
    const npub = nip19.npubEncode(pubkey);
    return npub;
  }

  getPubkeyFromNpub(npub: string): string {
    this.logger.debug('Converting npub to pub key');
    // Convert the hex public key to a Nostr public key (npub)
    const result = nip19.decode(npub).data;
    return result as string;
  }

  decode(value: string) {
    return nip19.decode(value);
  }

  /**
   * Save user metadata to storage
   */
  // async saveUserMetadata(pubkey: string, metadata: NostrEventData<UserMetadata>): Promise<void> {
  //   try {
  //     // Check if we already have metadata for this user
  //     const existingData = await this.storage.getUserMetadata(pubkey);

  //     const updatedData: NostrEventData<UserMetadata> = {
  //       ...existingData,
  //       ...metadata,
  //       updated: Date.now()
  //     }

  //     await this.storage.saveUserMetadata(pubkey, updatedData);
  //     this.logger.debug(`Saved metadata for user ${pubkey} to storage`);

  //     // Update the metadata in our signal
  //     this.updateUserMetadataInSignal(pubkey, updatedData);

  //     // If this is the current user, trigger a metadata refresh
  //     if (this.currentUser()?.pubkey === pubkey) {
  //       this.logger.debug('Current user metadata updated');
  //     }
  //   } catch (error) {
  //     this.logger.error(`Error saving metadata for user ${pubkey}`, error);
  //   }
  // }

  /**
   * Get user metadata from storage and update the metadata signal
   */
  // async getUserMetadata(pubkey: string): Promise<NostrEventData<UserMetadata> | undefined> {
  //   try {
  //     // First check if we already have this metadata in our signal
  //     const currentMetadata = this.findUserMetadata(pubkey);

  //     // If we don't have it or it's older than 5 minutes, fetch from storage
  //     const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  //     if (!currentMetadata || (currentMetadata.updated && currentMetadata.updated < fiveMinutesAgo)) {
  //       this.logger.debug(`Fetching fresh metadata for ${pubkey}`);
  //       const metadata = await this.storage.getUserMetadata(pubkey);

  //       if (metadata) {
  //         this.updateUserMetadataInSignal(pubkey, metadata);
  //         return metadata;
  //       }
  //     }

  //     return currentMetadata;
  //   } catch (error) {
  //     this.logger.error(`Error getting metadata for user ${pubkey}`, error);
  //     return undefined;
  //   }
  // }

  /**
   * Get user metadata from storage for multiple pubkeys
   */
  // async getUsersMetadata(pubkeys: string[]): Promise<Map<string, NostrEventData<UserMetadata>>> {
  //   const metadataMap = new Map<string, NostrEventData<UserMetadata>>();

  //   for (const pubkey of pubkeys) {
  //     try {
  //       const metadata = await this.getUserMetadata(pubkey);
  //       if (metadata) {
  //         metadataMap.set(pubkey, metadata);
  //       }
  //     } catch (error) {
  //       this.logger.error(`Error getting metadata for user ${pubkey}`, error);
  //     }
  //   }

  //   return metadataMap;
  // }

  /**
   * Clears the cache while preserving current user data
   */
  async clearCache(): Promise<void> {
    const currentUser = this.account();
    if (!currentUser) {
      this.logger.warn('Cannot clear cache: No user is logged in');
      return;
    }

    try {
      await this.storage.clearCache(currentUser.pubkey);
      this.logger.info('Cache cleared successfully');
    } catch (error) {
      this.logger.error('Error clearing cache', error);
    }
  }
}
