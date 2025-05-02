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
import { AccountStateService } from './account-state.service';
import { LocalStorageService } from './local-storage.service';

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
  private readonly logger = inject(LoggerService);
  private readonly relayService = inject(RelayService);
  private readonly storage = inject(StorageService);
  private readonly appState = inject(ApplicationStateService);
  private readonly accountState = inject(AccountStateService);
  private readonly localStorage = inject(LocalStorageService);

  initialized = signal(false);

  account = signal<NostrUser | null>(null);
  accounts = signal<NostrUser[]>([]);

  accountChanging = signal<NostrUser | null>(null);
  accountChanged = signal<NostrUser | null>(null);

  /** Holds the metadata event for all accounts in the app. */
  accountsMetadata = signal<NostrEvent[]>([]);
  accountsRelays = signal<NostrEvent[]>([]);

  // These are cache-lookups for the metadata and relays of all users,
  // to avoid query the database all the time.
  // These lists will grow
  usersMetadata = signal<Map<string, NostrEvent>>(new Map());
  usersRelays = signal<Map<string, NostrEvent>>(new Map());

  pubkey = computed(() => {
    return this.account()!.pubkey;
  });

  hasAccounts = computed(() => {
    return this.accounts().length > 0;
  });

  discoveryQueue: any = [];
  activeDiscoveries: any = [];
  MAX_CONCURRENT_DISCOVERIES = 1;

  constructor() {
    this.logger.info('Initializing NostrService');

    effect(async () => {
      if (this.storage.initialized()) {
        this.logger.info('Storage initialized, loading Nostr Service');

        try {
          debugger;
          const accounts = await this.getAccountsFromStorage();
          this.accounts.set(accounts);

          // We keep an in-memory copy of the user metadata and relay list for all accounts,
          // they won't take up too much memory space.
          const accountsMetadata = await this.getAccountsMetadata();
          this.accountsMetadata.set(accountsMetadata);

          const accountsRelays = await this.getAccountsRelays();
          this.accountsRelays.set(accountsRelays);

          const account = this.getAccountFromStorage();
          this.accountChanging.set(account);
          this.account.set(account);
          this.accountChanged.set(account);

          // if (account) {
          //   this.logger.info('Found account in localStorage, loading data.', { pubkey: account.pubkey });
          //   // If there is an account, ensure we load data before initialized is set.
          //   await this.loadData();
          // }

          // if (account) {
          //   this.account.set(account);
          // }


        } catch (err) {
          this.logger.error('Failed to load data during initialization', err);
        }
      }
    });

    effect(async () => {
      const account = this.accountChanged();
      debugger;
      // If the account is changing and it has a value (it will be empty on logout).
      if (account) {
        const pubkey = account.pubkey;
        // When the account changes, check what data we have and get if missing.
        this.logger.info('Account changed, loading data for new account', { pubkey });

        let info: any = await this.storage.getInfo(pubkey, 'user');

        if (!info) {
          info = {};
        }

        // Get the metadata from in-memory if exists.
        let metadata: NostrEvent | null | undefined = this.getMetadataForAccount(pubkey);

        // If there was metadata, also push it into the 
        if (metadata) {
          // Also update the cache for getMetadataForUser
          if (this.usersMetadata().has(pubkey)) {
            this.updateMetadataCache(pubkey, metadata);
          }
        }

        // Get existing Relay List in storage
        let relays = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.RelayList);
        let relayUrls: string[] = [];

        if (relays) {
          relayUrls = this.getRelayUrls(relays, false); // Make sure to pass false to avoid ignoring automatic banned relays

          this.logger.info('Found user relays in storage', { relays });
          this.appState.loadingMessage.set('Found your relays in local storage! ✔️');
        }

        if (relayUrls.length === 0) {
          // We need to discovery the relays of the user.
          this.logger.info('No relays found in storage, performing discovery', { pubkey });
          relayUrls = await this.findRelays(pubkey, info);
        }

        // Store the relays in the relay service
        this.relayService.setRelays(relayUrls);

        const userPool = new SimplePool();
        userPool.trackRelays = true;

        // Attach the userPool to the relay service for further use.
        this.relayService.setAccountPool(userPool);

        metadata = await this.relayService.getEventByPubkeyAndKind(pubkey, kinds.Metadata);

        if (metadata) {
          this.updateAccountMetadata(metadata);

          // Also update the cache for getMetadataForUser
          if (this.usersMetadata().has(pubkey)) {
            this.updateMetadataCache(pubkey, metadata);
          }

          this.logger.info('Found user metadata', { metadata });
          this.appState.loadingMessage.set('Found your profile! 👍');
          await this.storage.saveEvent(metadata);
        } else {
          this.logger.warn('No metadata found for user');
        }

        // After loading the relays and setting them, we load the following list:
        await this.loadAccountFollowing(pubkey);
        await this.loadAccountMuteList(pubkey);
        await this.subscribeToAccountMetadata(pubkey);

        this.appState.loadingMessage.set('Loading completed!');
        this.logger.info('Data loading process completed');

        await this.storage.saveInfo(pubkey, 'user', info);

        // Show success animation instead of waiting
        this.appState.isLoading.set(false);
        this.appState.showSuccess.set(true);
        this.initialized.set(true);

        // Schedule a refresh of the relays in the background. For now this won't be reflected until
        // the user refreshes the app.
        this.relayService.getEventByPubkeyAndKind(pubkey, kinds.RelayList).then(async (evt) => {
          if (evt) {
            this.storage.saveEvent(evt);
          }
        });

        // Hide success animation after 1.5 seconds
        setTimeout(() => {
          this.appState.showSuccess.set(false);
        }, 1500);

        // await this.loadData();
      } else {
        this.appState.isLoading.set(false);
        this.appState.showSuccess.set(false);
        this.initialized.set(true);
      }
    });

    // effect(async () => {
    //   // const accountChanging = this.accountChanging();
    //   // const preInitialized = this.preInitialized();
    //   // const account = this.account();

    //   // if (preInitialized && account) {
    //   //   await this.loadData(this.account()!);
    //   //   this.initialized.set(true);
    //   // } else if (preInitialized) {
    //   //   this.initialized.set(true);
    //   // } else if (accountChanging) {
    //   // }

    //   if (this.account() && this.preInitialized()) {
    //     debugger;
    //     // Load data from the active account.
    //     // await this.loadData(this.account()!);
    //     this.initialized.set(true);
    //   } else if (!this.account() && this.preInitialized()) {
    //     debugger;
    //     this.initialized.set(true);
    //   }
    // });

    // Save user to localStorage whenever it changes
    // effect(async () => {
    //   if (this.storage.initialized()) {

    //     debugger;

    //     const currentUser = this.account();
    //     this.logger.debug('User change effect triggered', {
    //       hasUser: !!currentUser,
    //       pubkey: currentUser?.pubkey
    //     });

    //     if (currentUser) {
    //       this.logger.debug('Saving current user to localStorage', { pubkey: currentUser.pubkey });
    //       this.localStorage.setItem(this.appState.ACCOUNT_STORAGE_KEY, JSON.stringify(currentUser));

    //       this.logger.debug('Load data for current user', { pubkey: currentUser.pubkey });
    //       await this.loadData();

    //       this.accountLoaded.set(true);

    //       // Load relays for this user from storage
    //       // untracked(() => {
    //       //   this.relayService.loadRelaysForUser(currentUser.pubkey)
    //       //     .catch(err => this.logger.error('Failed to load relays for user', err));
    //       // });
    //     }
    //   }
    // });

    // Save all users to localStorage whenever they change
    effect(() => {
      const allUsers = this.accounts();

      if (allUsers.length === 0) {
        this.logger.debug('No users to save to localStorage');
        return;
      }

      this.logger.debug('Users collection effect triggered', { count: allUsers.length });

      this.logger.debug(`Saving ${allUsers.length} users to localStorage`);
      this.localStorage.setItem(this.appState.ACCOUNTS_STORAGE_KEY, JSON.stringify(allUsers));

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

  // Method to easily find metadata by pubkey
  getMetadataForAccount(pubkey: string): NostrEvent | undefined {
    return this.accountsMetadata().find(meta => meta.pubkey === pubkey);
  }

  getAccountFromStorage() {
    // Initialize account from localStorage if available.
    try {
      const userJson = this.localStorage.getItem(this.appState.ACCOUNT_STORAGE_KEY);
      if (userJson) {
        return JSON.parse(userJson) as NostrUser;
      }
    } catch (e) {
      this.logger.error('Failed to parse user from localStorage during initialization', e);
    }
    return null;
  }

  /** Get relays for a user, will first read locally and then query the network if not found. */
  async getRelays(pubkey: string) {
    // First discovery the relays for the user.
    let relayUrls: string[] = [];
    const relayListEvent = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.RelayList);

    if (relayListEvent) {
      relayUrls = this.getRelayUrls(relayListEvent, true);
    }

    const followingEvent = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.Contacts);

    if (followingEvent) {
      relayUrls = this.getRelayUrlsFromFollowing(followingEvent, true);
    }

    if (relayUrls.length > 0) {
      return relayUrls;
    }

    const result = await this.discoverRelays(pubkey);

    if (result.relayUrls.length === 0) {
      throw new Error('No relays found for user');
    }

    return result.relayUrls;
  }

  /** Will attempt to discover relays for a pubkey. Will persist the event to database. */
  async discoverRelays(pubkey: string): Promise<{ relayUrls: string[], relayList: boolean, followingList: boolean }> {
    // Perform relay discovery for the given pubkey
    const discoveryPool = new SimplePool();
    const discoveryRelays = this.relayService.discoveryRelays;

    const result = {
      relayUrls: [] as string[],
      relayList: false,
      followingList: false,
    };

    try {
      const relays = await discoveryPool.get(discoveryRelays, {
        kinds: [kinds.RelayList],
        authors: [pubkey],
      });

      if (relays) {
        this.logger.info('Found your relays on network', { relays });
        await this.storage.saveEvent(relays);
        const relayUrls = this.getRelayUrls(relays, false); // Make sure to pass false to avoid ignoring automatic banned relays
        this.logger.info(`Found ${relayUrls.length} relays for user`, { relayUrls });

        if (relayUrls.length > 0) {
          result.relayUrls = relayUrls;
          result.relayList = true;
        }
      } else {
        this.logger.warn('No relay list found on discovery relays.');

        // Fallback to metadata discovery if no relay list found.
        const contacts = await discoveryPool.get(this.relayService.discoveryRelays, {
          kinds: [kinds.Contacts],
          authors: [pubkey],
        });

        if (contacts) {
          this.storage.saveEvent(contacts);
          const relayUrls = this.getRelayUrlsFromFollowing(contacts, false);

          if (relayUrls.length > 0) {
            result.relayUrls = relayUrls;
            result.followingList = true;
          }
        }
      }
    } catch (err) {
      this.logger.error('Error during relay discovery', err);
    } finally {
      discoveryPool.close(discoveryRelays);
    }

    return result;
  }

  async findRelays(pubkey: string, info: any) {
    // Perform relay discovery for the given pubkey
    const discoveryPool = new SimplePool();
    const discoveryRelays = this.relayService.discoveryRelays;

    const relays = await discoveryPool.get(discoveryRelays, {
      kinds: [kinds.RelayList],
      authors: [pubkey],
    });

    if (relays) {
      this.logger.info('Found your relays on network', { relays });
      await this.storage.saveEvent(relays);
      const relayUrls = this.getRelayUrls(relays, false); // Make sure to pass false to avoid ignoring automatic banned relays
      this.logger.info(`Found ${relayUrls.length} relays for user`, { relayUrls });

      if (relayUrls.length > 0) {
        info.hasRelayList = true;
        discoveryPool.close(discoveryRelays);
        return relayUrls;
      }
    } else {
      this.logger.warn('No relay list found on discovery relays.');

      // Fallback to metadata discovery if no relay list found.
      const contacts = await discoveryPool.get(this.relayService.discoveryRelays, {
        kinds: [kinds.Contacts],
        authors: [pubkey],
      });

      if (contacts) {
        this.storage.saveEvent(contacts);
        const relayUrls = this.getRelayUrlsFromFollowing(contacts, false);

        if (relayUrls.length > 0) {
          info.hasFollowingListRelays = true;
          discoveryPool.close(discoveryRelays);
          return relayUrls;
        }
      }
    }

    discoveryPool.close(discoveryRelays);

    // If there is no relayUrls, set default relays.
    const defaultRelays = [...this.relayService.defaultRelays];
    return defaultRelays;
  }


  // async loadData(): Promise<void> {
  //   // 1. Get the relays for current account. Perform discovery if needed.
  //   // 2. Get the metadata for current account. Schedule update for new metadata.

  //   const pubkey = this.pubkey();

  //   let info: any = await this.storage.getInfo(pubkey, 'user');

  //   if (!info) {
  //     info = {};
  //   }

  //   try {
  //     this.appState.loadingMessage.set('Retrieving your relay list...');
  //     this.appState.isLoading.set(true);
  //     this.appState.showSuccess.set(false);
  //     this.logger.info('Starting data loading process for pubkey', { pubkey });

  //     let profile = null;
  //     let metadata = null;
  //     let relayList = null;

  //     // First check if we have metadata in storage
  //     metadata = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.Metadata);

  //     if (metadata) {
  //       this.logger.info('Found user metadata in storage', { metadata });
  //       this.appState.loadingMessage.set('Found your profile in local storage! 👍');

  //       // Process and update metadata for UI refresh
  //       // this.updateAccountMetadata(metadata);

  //       // Also store in userMetadata for legacy support
  //       // try {
  //       //   // Parse the content field which should be JSON
  //       //   const metadataContent = typeof metadata.content === 'string' 
  //       //     ? JSON.parse(metadata.content) 
  //       //     : metadata.content;

  //       //   // Create a NostrEventData object to store the full content and tags
  //       //   const eventData: NostrEventData<UserMetadata> = {
  //       //     pubkey: metadata.pubkey,
  //       //     content: metadataContent,  // Store the parsed JSON object 
  //       //     tags: metadata.tags,       // Store the original tags
  //       //     updated: Date.now()
  //       //   };

  //       //   // Save to storage with all fields and the full event data
  //       //   await this.storage.saveUserMetadata(pubkey, eventData);
  //       // } catch (e) {
  //       //   this.logger.error('Failed to parse metadata content', e);
  //       // }
  //     }

  //     // Get existing Relay List in storage
  //     let relays = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.RelayList);

  //     if (relays) {
  //       this.logger.info('Found user relays in storage', { relays });
  //       this.appState.loadingMessage.set('Found your relays in local storage! ✔️');
  //     }

  //     let bootstrapPool: SimplePool | null = null;

  //     if (!relays) {
  //       // To properly scale Nostr, the first step is simply getting the user's relay list and nothing more.
  //       bootstrapPool = new SimplePool();

  //       this.logger.debug('Connecting to bootstrap relays', { relays: this.relayService.discoveryRelays() });

  //       this.logger.time('fetchRelayList');
  //       relays = await bootstrapPool.get(this.relayService.discoveryRelays(), {
  //         kinds: [kinds.RelayList],
  //         authors: [pubkey],
  //       });
  //       this.logger.timeEnd('fetchRelayList');

  //       if (relays) {
  //         info.hasRelayList = true;
  //         this.logger.info('Found your relays on network', { relays });
  //         this.appState.loadingMessage.set('Found your relays on the network! ✔️');
  //         await this.storage.saveEvent(relays);
  //       }
  //     }

  //     let relayUrls: string[] = [];

  //     if (relays) {
  //       relayUrls = this.getRelayUrls(relays);
  //       this.logger.info(`Found ${relayUrls.length} relays for user`, { relayUrls });

  //       // Store the relays in the relay service
  //       this.relayService.setRelays(relayUrls);
  //     }

  //     // If there is no relayUrls (the kind:10002 might miss it), use default for fallback:
  //     if (!relayUrls || relayUrls.length == 0) {
  //       this.logger.warn('No relay list found for user');
  //       // Set default bootstrap relays if no custom relays found
  //       const defaultRelays = [...this.relayService.defaultRelays()];
  //       this.relayService.setRelays(defaultRelays);
  //       relayUrls = defaultRelays;
  //     }

  //     const userPool = new SimplePool();
  //     userPool.trackRelays = true;
  //     this.logger.debug('Connecting to user relays to fetch metadata');

  //     // Attempt to connect to the user's defined relays, to help Nostr with
  //     // scaling, we don't use the default relays here.
  //     if (metadata) {
  //       this.appState.loadingMessage.set(`Found your ${relayUrls.length} relays, refreshing your metadata...`);
  //     } else {
  //       this.appState.loadingMessage.set(`Found your ${relayUrls.length} relays, retrieving your metadata...`);

  //       this.logger.time('fetchMetadata');
  //       metadata = await userPool.get(relayUrls, {
  //         kinds: [kinds.Metadata],
  //         authors: [pubkey],
  //       });
  //       this.logger.timeEnd('fetchMetadata');

  //       if (metadata) {
  //         this.logger.info('Found user metadata', { metadata });
  //         this.appState.loadingMessage.set('Found your profile! 👍');
  //         await this.storage.saveEvent(metadata);

  //         // Update the metadata in NostrService
  //         this.updateAccountMetadata(metadata);

  //         try {
  //           // Parse the content field which should be JSON
  //           // const metadataContent = typeof metadata.content === 'string'
  //           //   ? JSON.parse(metadata.content)
  //           //   : metadata.content;

  //           // Create a NostrEventData object to store the full content and tags
  //           // const eventData: NostrEventData<UserMetadata> = {
  //           //   pubkey: metadata.pubkey,
  //           //   content: metadataContent,  // Store the parsed JSON object 
  //           //   tags: metadata.tags,       // Store the original tags
  //           //   updated: Date.now()
  //           // };

  //           // Save to storage with all fields and the full event data
  //           // await this.storage.saveUserMetadata(pubkey, eventData);
  //         } catch (e) {
  //           this.logger.error('Failed to parse metadata content', e);
  //         }
  //       } else {
  //         this.logger.warn('No metadata found for user');
  //       }
  //     }


  //   } catch (err) {
  //     console.log('FAILURE IN LOAD DATA!');
  //     console.error(err);
  //   }


  // }

  accountSubscription: any = null;

  private async subscribeToAccountMetadata(pubkey: string) {
    this.logger.info('subscribeToAccountMetadata', { pubkey });

    const filters = [{
      kinds: [kinds.Metadata, kinds.Contacts, kinds.RelayList],
      authors: [pubkey],
    }];

    const onEvent = (event: NostrEvent) => {
      console.log('Received event on the account subscription:', event);
    }

    const onEose = () => {
      console.log('onEose on account subscription.');
    }

    this.accountSubscription = this.relayService.subscribe(filters, onEvent, onEose);
  }

  private async loadAccountFollowing(pubkey: string) {
    let followingEvent = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.Contacts);

    if (!followingEvent) {
      followingEvent = await this.relayService.getEventByPubkeyAndKind(pubkey, kinds.Contacts);

      if (followingEvent) {
        await this.storage.saveEvent(followingEvent);
      }
    } else {
      // Queue up refresh of this event in the background
      this.relayService.getEventByPubkeyAndKind(pubkey, kinds.Contacts).then(async (evt) => {
        if (evt) {
          const followingTags = this.getTags(evt, 'p');
          this.accountState.followingList.set(followingTags);
          await this.storage.saveEvent(evt);
        }
      });
    }

    if (followingEvent) {
      const followingTags = this.getTags(followingEvent, 'p');
      this.accountState.followingList.set(followingTags);
    }
  }

  private async loadAccountMuteList(pubkey: string) {
    let muteListEvent = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.Mutelist);

    if (!muteListEvent) {
      muteListEvent = await this.relayService.getEventByPubkeyAndKind(pubkey, kinds.Mutelist);

      if (muteListEvent) {
        await this.storage.saveEvent(muteListEvent);
      }
    } else {
      // Queue up refresh of this event in the background
      this.relayService.getEventByPubkeyAndKind(pubkey, kinds.Mutelist).then(async (evt) => {
        if (evt) {
          this.accountState.muteList.set(evt);
          await this.storage.saveEvent(evt);
        }
      });
    }

    if (muteListEvent) {
      this.accountState.muteList.set(muteListEvent);

    }
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

  async getMetadataForUsers(pubkey: string[], disconnect = true): Promise<NostrEvent[] | undefined> {
    const metadataList: NostrEvent[] = [];

    for (const p of pubkey) {
      const metadata = await this.getMetadataForUser(p, disconnect);
      if (metadata) {
        metadataList.push(metadata);
        // this.updateMetadataCache(p, metadata);
      }
    }

    return metadataList;
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

  async retrieveMetadata(pubkey: string, relayUrls: string[]) {
    let metadata: NostrEvent | null | undefined = null;
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

        if (metadata) {
          this.logger.debug('Successfully retrieved metadata', { relay: relayUrl });
          break; // Stop trying more relays once we've found metadata
        }
      } catch (error) {
        this.logger.debug('Failed to fetch metadata from relay', { relay: relayUrl, error });
        // Continue to the next relay on failure
      }
      finally {
        userPool.close([relayUrl]); // Close the pool for this relay
      }
    }

    if (metadata) {
      await this.storage.saveEvent(metadata);
    }

    return metadata;
  }

  async discoverMetadata(pubkey: string, disconnect = true): Promise<NostrEvent | undefined> {
    let info: any = await this.storage.getInfo(pubkey, 'user');

    if (!info) {
      info = {};
    }

    // FLOW: Find the user's relays first. Save it.
    // Connect to their relays and get metadata. Save it.
    const event = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.RelayList);

    if (!event) {
      let bootstrapPool = new SimplePool();

      this.logger.debug('Connecting to bootstrap relays', { relays: this.relayService.discoveryRelays });

      const relays = await bootstrapPool.get(this.relayService.discoveryRelays, {
        kinds: [kinds.RelayList],
        authors: [pubkey],
      });

      if (relays) {
        bootstrapPool.close(this.relayService.discoveryRelays);

        await this.storage.saveEvent(relays);

        info.hasRelayList = true;

        const relayUrls = this.getRelayUrls(relays);

        let metadata = null;

        this.logger.debug('Trying to fetch metadata from individual relays', { relayCount: relayUrls.length });

        metadata = await this.retrieveMetadata(pubkey, relayUrls);

        // this.currentProfileUserPool = userPool;
        // this.currentProfileRelayUrls = relayUrls;

        // if (disconnect) {
        //   userPool.close(relayUrls);
        // }

        await this.storage.saveInfo(pubkey, 'user', info);

        return metadata as NostrEvent;
      } else {

        const followingEvent = await bootstrapPool.get(this.relayService.discoveryRelays, {
          kinds: [kinds.Contacts],
          authors: [pubkey],
        });

        if (followingEvent) {
          await this.storage.saveEvent(followingEvent);

          // After saving, the .content should be parsed to JSON.
          console.log('FOLLOWING:', followingEvent);

          const followingRelayUrls = this.getRelayUrlsFromFollowing(followingEvent);
          console.log('USER FOLLOWING RELAY URLS:', followingRelayUrls);

          if (followingRelayUrls.length === 0) {
            this.logger.warn('No relays found in following list. User does not have Relay List nor relays in following list.');
            this.logger.warn('Getting metadata from Discovery Relays... not an ideal situation.');

            info.hasRelayList = false;
            info.hasFollowingListRelays = false;

            const metadataFromDiscoveryRelays = await bootstrapPool.get(this.relayService.discoveryRelays, {
              kinds: [kinds.Metadata],
              authors: [pubkey],
            });

            if (metadataFromDiscoveryRelays) {
              this.logger.warn('Found metadata on discovery relays.');
              info.metadataFromDiscoveryRelays = true;
              await this.storage.saveEvent(metadataFromDiscoveryRelays);
              await this.storage.saveInfo(pubkey, 'user', info);
              return metadataFromDiscoveryRelays as NostrEvent;
            } else {
              this.logger.error('Did not find metadata on discovery relays. Giving up.');
              info.metadataFromDiscoveryRelays = false;
              await this.storage.saveInfo(pubkey, 'user', info);
              return undefined;
            }
          }

          // After getting relays from the following list, we will do another attempt at getting the Relay List for the user.
          // and if that fails, we will fall back to using this list.

          const followingPool = new SimplePool();
          const relayList = await followingPool.get(followingRelayUrls, {
            kinds: [kinds.RelayList],
            authors: [pubkey],
          });

          // A lot of user's have tens of relays, and many old ones. If we can't connect to them, put them into an 
          const connectionStatuses = followingPool.listConnectionStatus();
          const failedRelays = Array.from(connectionStatuses.entries())
            .filter(([_, status]) => status === false)
            .map(([url, _]) => url);

          this.relayService.timeoutRelays(failedRelays);

          if (relayList) {
            followingPool.close(followingRelayUrls);
            await this.storage.saveEvent(relayList);
            const relayListUrls = this.getRelayUrls(relayList);
            console.log('WE FOUND RELAYS!!!!');

            info.hasFollowingListRelays = true;
            await this.storage.saveInfo(pubkey, 'user', info);

            let metadata = null;
            this.logger.debug('Trying to fetch metadata from individual relays', { relayCount: relayListUrls.length });

            metadata = await this.retrieveMetadata(pubkey, relayListUrls)

            // this.currentProfileUserPool = userPool;
            // this.currentProfileRelayUrls = relayUrls;

            // if (disconnect) {
            //   userPool.close(relayUrls);
            // }

            return metadata as NostrEvent;

          } else {
            console.log('DID NOT Find relays...');
            // Capitulate and get profile from the following list relays:
            let metadata = await this.retrieveMetadata(pubkey, followingRelayUrls)

            followingPool.close(followingRelayUrls);

            info.hasFollowingListRelays = false;
            info.hasRelayList = false;
            await this.storage.saveInfo(pubkey, 'user', info);

            return metadata as NostrEvent;
          }
        }

        bootstrapPool.close(this.relayService.discoveryRelays);
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

      let privateKey = generateSecretKey();

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

      await this.setAccount(newUser);
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

  private getAccountsFromStorage() {
    const usersJson = this.localStorage.getItem(this.appState.ACCOUNTS_STORAGE_KEY);
    if (usersJson) {
      try {
        const parsedUsers = JSON.parse(usersJson);
        this.logger.debug(`Loaded ${parsedUsers.length} users from localStorage`);
        return parsedUsers;
      } catch (e) {
        this.logger.error('Failed to parse users from localStorage', e);
      }
    } else {
      this.logger.debug('No users found in localStorage');
    }

    return [];
  }

  // private loadActiveAccountFromStorage(): void {
  //   const userJson = this.localStorage.getItem(this.appState.ACCOUNT_STORAGE_KEY);
  //   this.logger.info('Loading active user from localStorage', userJson);
  //   if (userJson) {
  //     try {
  //       const parsedUser = JSON.parse(userJson);
  //       this.logger.debug('Loaded active user from localStorage', { pubkey: parsedUser.pubkey });
  //       this.account.set(parsedUser);
  //     } catch (e) {
  //       this.logger.error('Failed to parse user from localStorage', e);
  //     }
  //   } else {
  //     this.logger.debug('No active user found in localStorage');
  //   }
  // }

  async getAccountsMetadata() {
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

    return processedEvents;
  }

  async getAccountsRelays() {
    const pubkeys = this.accounts().map(user => user.pubkey);
    const relays = await this.storage.getEventsByPubkeyAndKind(pubkeys, kinds.RelayList);
    return relays;
  }

  // async updateAccountMetadata(event: Event) {
  //   const pubkey = event.pubkey;

  //   // Ensure content is properly parsed
  //   if (event.content && typeof event.content === 'string') {
  //     try {
  //       event.content = JSON.parse(event.content);
  //     } catch (e) {
  //       this.logger.error('Failed to parse event content in updateAccountMetadata', e);
  //     }
  //   }

  //   // Add to the metadata array
  //   const existingMetadata = this.accountsMetadata().find(meta => meta.pubkey === pubkey);

  //   if (existingMetadata) {
  //     this.logger.debug('Updating existing metadata', { pubkey });
  //     this.accountsMetadata.update(array =>
  //       array.map(meta => meta.pubkey === pubkey ? event : meta));
  //   } else {
  //     this.logger.debug('Adding new metadata', { pubkey });
  //     this.accountsMetadata.update(array => [...array, event]);
  //   }

  //   // Also update the cache for getMetadataForUser
  //   if (this.usersMetadata().has(pubkey)) {
  //     this.updateMetadataCache(pubkey, event);
  //   }
  // }

  updateAccountMetadata(event: Event) {
    const existingMetadata = this.accountsMetadata().find(meta => meta.pubkey === event.pubkey);

    if (existingMetadata) {
      this.accountsMetadata.update(array => array.map(meta => meta.pubkey === event.pubkey ? event : meta));
    } else {
      this.accountsMetadata.update(array => [...array, event]);
    }
  }

  getTruncatedNpub(pubkey: string): string {
    console.debug('LOCATION 7:', pubkey);
    const npub = this.getNpubFromPubkey(pubkey);
    return npub.length > 12
      ? `${npub.substring(0, 6)}...${npub.substring(npub.length - 6)}`
      : npub;
  }

  /** Parses the URLs and cleans up, ensuring only wss:// instances are returned. */
  getRelayUrlsFromFollowing(event: Event, timeouts: boolean = true): string[] {
    let relayUrls = Object.keys(event.content).map(url => {
      const wssIndex = url.indexOf('wss://');
      return wssIndex >= 0 ? url.substring(wssIndex) : url;
    });

    // Filter out timed out relays if timeouts parameter is true
    if (timeouts) {
      const timedOutRelays = this.relayService.timeouts().map(relay => relay.url);
      relayUrls = relayUrls.filter(relay => !timedOutRelays.includes(this.relayService.normalizeRelayUrl(relay)));
    }

    return relayUrls;
  }

  /** Parses the URLs and cleans up, ensuring only wss:// instances are returned. */
  getRelayUrls(event: Event, timeouts: boolean = true): string[] {
    let relayUrls = event.tags
      .filter(tag => tag.length >= 2 && tag[0] === 'r')
      .map(tag => {
        const url = tag[1];
        const wssIndex = url.indexOf('wss://');
        return wssIndex >= 0 ? url.substring(wssIndex) : url;
      });

    // Filter out timed out relays if timeouts parameter is true
    if (timeouts) {
      const timedOutRelays = this.relayService.timeouts().map(relay => relay.url);
      relayUrls = relayUrls.filter(relay => !timedOutRelays.includes(this.relayService.normalizeRelayUrl(relay)));
    }

    return relayUrls;
  }

  getTags(event: Event | UnsignedEvent, tagType: NostrTagKey, timeouts: boolean = false): string[] {
    let tags = event.tags
      .filter(tag => tag.length >= 2 && tag[0] === tagType)
      .map(tag => tag[1]);

    // If this is filtering relay tags ('r') and timeouts is true, 
    // filter out the timed out relays
    if (tagType === 'r' && timeouts) {
      const timedOutRelays = this.relayService.timeouts().map(relay => relay.url);
      tags = tags.filter(url => !timedOutRelays.includes(url));
    }

    return tags;
  }

  setTags(event: Event | UnsignedEvent, tagType: NostrTagKey, values: string[]): Event | UnsignedEvent {
    // Create a shallow copy of the event to avoid mutating the original
    const updatedEvent: Event | UnsignedEvent = { ...event, tags: [...event.tags] };

    // Filter out values that already exist in tags of this type to avoid duplicates
    const existingValues = this.getTags(event, tagType);
    const newValues = values.filter(value => !existingValues.includes(value));

    // Add new tags for each unique value that doesn't already exist
    for (const value of newValues) {
      updatedEvent.tags.push([tagType, value]);
    }

    return updatedEvent;
  }

  createTags(tagType: NostrTagKey, values: string[]): string[][] {
    const tags: string[][] = [];

    for (const value of values) {
      tags.push([tagType, value]);
    }

    return tags;
  }

  async switchToUser(pubkey: string) {
    this.logger.info(`Switching to user with pubkey: ${pubkey}`);
    const targetUser = this.accounts().find(u => u.pubkey === pubkey);
    debugger;
    if (targetUser) {
      // Update lastUsed timestamp
      targetUser.lastUsed = Date.now();

      debugger;

      this.accountChanging.set(targetUser);
      debugger;
      this.account.set(targetUser);
      this.accountChanged.set(targetUser);
      this.logger.debug('Successfully switched user');

      // Persist the account to local storage.
      this.localStorage.setItem(this.appState.ACCOUNT_STORAGE_KEY, JSON.stringify(targetUser));

      // Make sure we have the latest metadata for this user
      // this.getUserMetadata(pubkey).catch(err =>
      //   this.logger.error(`Failed to refresh metadata for user ${pubkey}`, err));

      return true;
    }

    this.logger.warn(`User with pubkey ${pubkey} not found`);
    return false;
  }

  async setAccount(user: NostrUser) {
    debugger;
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

    this.accountChanging.set(user);

    // Trigger the user signal which indicates user is logged on.
    this.account.set(user);

    // Persist the account to local storage.
    this.localStorage.setItem(this.appState.ACCOUNT_STORAGE_KEY, JSON.stringify(user));

    this.accountChanged.set(user);

    // Make sure we have the latest metadata for this user
    // this.getUserMetadata(user.pubkey).catch(err =>
    //   this.logger.error(`Failed to get metadata for new user ${user.pubkey}`, err));
  }

  async generateNewKey() {
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
    await this.setAccount(newUser);
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
      // let name: string | undefined = undefined;
      // try {
      //   // Some extensions may provide user metadata like name
      //   this.logger.debug('Requesting user metadata from extension');
      //   const userInfo = await window.nostr.getUserMetadata();
      //   name = userInfo?.name;
      //   this.logger.debug('Received user metadata', { name });
      // } catch (error) {
      //   // Ignore errors for metadata, it's optional
      //   this.logger.warn('Could not get user metadata from extension', error);
      // }

      // Set the user with the public key from the extension
      const newUser: NostrUser = {
        pubkey,
        name: this.getTruncatedNpub(pubkey),
        source: 'extension',
        lastUsed: Date.now()
      };

      this.logger.info('Login with extension successful', { pubkey });
      await this.setAccount(newUser);

      return;
    } catch (error) {
      this.logger.error('Error connecting to Nostr extension:', error);
      throw error; // Re-throw to handle in the UI
    }
  }

  async loginWithNsec(nsec: string) {
    try {
      this.logger.info('Attempting to login with nsec');

      // Allow usage of hex and nsec.
      // Validate and decode the nsec
      // if (!nsec.startsWith('nsec')) {
      //   const error = 'Invalid nsec format. Must start with "nsec"';
      //   this.logger.error(error);
      //   throw new Error(error);
      // }

      let privkeyHex = '';
      let privkeyArray: Uint8Array;

      debugger;

      if (nsec.startsWith('nsec')) {
        // Decode the nsec to get the private key bytes
        const { type, data } = nip19.decode(nsec);
        privkeyArray = data as Uint8Array;

        if (type !== 'nsec') {
          const error = `Expected nsec but got ${type}`;
          this.logger.error(error);
          throw new Error(error);
        }

        // Convert the private key bytes to hex string
        privkeyHex = bytesToHex(data);
      } else {
        privkeyHex = nsec; // Assume it's already in hex format
        privkeyArray = hexToBytes(privkeyHex);
      }

      // Generate the public key from the private key
      const pubkey = getPublicKey(privkeyArray);

      // Store the user info
      const newUser: NostrUser = {
        pubkey,
        privkey: privkeyHex,
        source: 'nsec',
        lastUsed: Date.now()
      };

      this.logger.info('Login with nsec successful', { pubkey });
      await this.setAccount(newUser);
    } catch (error) {
      this.logger.error('Error decoding nsec:', error);
      throw new Error('Invalid nsec key provided. Please check and try again.');
    }
  }

  async usePreviewAccount() {
    this.logger.info('Using preview account');
    // jack
    const previewPubkey = '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2';
    const newUser: NostrUser = {
      pubkey: previewPubkey,
      name: 'Preview User',
      source: 'preview',
      lastUsed: Date.now()
    };

    await this.setAccount(newUser);
    this.logger.debug('Preview account set successfully', { pubkey: previewPubkey });
  }

  logout(): void {
    this.logger.info('Logging out current user');
    this.localStorage.removeItem(this.appState.ACCOUNT_STORAGE_KEY);
    debugger;
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
      debugger;
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
    console.debug('LOCATION 6:', pubkey);
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

  getIdFromNevent(nevent: string): string {
    try {
      if (nevent.startsWith('nevent')) {
        const { type, data } = this.decode(nevent);
        if (type === 'nevent') {
          // Nevent data contains: id, relays, author
          return data.id;
        }
      }
      return nevent; // Return as is if not nevent format
    } catch (error) {
      this.logger.error('Error decoding nevent:', error);
      return nevent; // Return the original value in case of error
    }
  }

  async getEvent(id: string): Promise<NostrEvent | undefined> {
    // First try to get from storage
    let event = await this.storage.getEventById(id);

    if (event) {
      return event;
    }

    // If not in storage, try to fetch from relays
    try {
      await this.storage.clearCache(this.pubkey());
      this.logger.info('Cache cleared successfully');

      // TODO: Improve this to discover if needed.
      const relayUrls = this.relayService.defaultRelays; // .activeRelays();

      if (!relayUrls.length) {
        return undefined;
      }

      const pool = new SimplePool();
      event = await pool.get(relayUrls, {
        ids: [id],
      }, {
        maxWait: 3000
      });

      pool.close(relayUrls);

      if (event) {
        // Save to storage for future use
        await this.storage.saveEvent(event);
        return event;
      }
    } catch (error) {
      this.logger.error('Error clearing cache', error);
      this.logger.error('Error fetching event:', error);
    }

    return undefined;
  }
}
