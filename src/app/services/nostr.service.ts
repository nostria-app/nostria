import { Injectable, signal, computed, effect, inject, untracked } from '@angular/core';
import { Event, EventTemplate, generateSecretKey, getPublicKey, UnsignedEvent, VerifiedEvent } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { nip19, nip98 } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { RelayService } from './relay.service';
import { NostrEventData, StorageService, UserMetadata } from './storage.service';
import { kinds, SimplePool } from 'nostr-tools';
import { finalizeEvent } from 'nostr-tools/pure';
import { BunkerPointer, BunkerSigner, parseBunkerInput } from 'nostr-tools/nip46';
import { NostrTagKey } from '../standardized-tags';
import { ApplicationStateService } from './application-state.service';
import { AccountStateService } from './account-state.service';
import { LocalStorageService } from './local-storage.service';
import { RegionService } from './region.service';
import { MEDIA_SERVERS_EVENT_KIND, NostriaService, NostrRecord } from '../interfaces';
import { DataService } from './data.service';
import { UtilitiesService } from './utilities.service';
import { Tier } from '../api/models';

export interface NostrUser {
  pubkey: string;
  privkey?: string;
  name?: string;
  source: 'extension' | 'nsec' | 'preview' | 'remote';
  lastUsed?: number; // Timestamp when this account was last used
  bunker?: BunkerPointer;
  region?: string; // Add this new property

  // TODO: Not needed anymore, remove.
  /** Indicates if this account has been "activated". This means the account has published it's relay list. For brand new accounts,
   * we won't publish Relay List until the user has performed their first signing action. When that happens, we will set this to true,
   * and publish Relay List + other events, like Profile Edit or publishing a post.
   */
  hasActivated: boolean
}

export interface UserMetadataWithPubkey extends NostrEventData<UserMetadata> {
  pubkey: string;
}

@Injectable({
  providedIn: 'root'
})
export class NostrService implements NostriaService {
  private readonly logger = inject(LoggerService);
  private readonly relayService = inject(RelayService);
  private readonly storage = inject(StorageService);
  private readonly appState = inject(ApplicationStateService);
  private readonly accountState = inject(AccountStateService);
  private readonly localStorage = inject(LocalStorageService);
  private readonly region = inject(RegionService);
  private readonly data = inject(DataService);
  private readonly utilities = inject(UtilitiesService);

  initialized = signal(false);
  MAX_WAIT_TIME = 2000;
  MAX_WAIT_TIME_METADATA = 2500;
  MAX_RELAY_COUNT = 2;
  dataLoaded = false;

  // account = signal<NostrUser | null>(null);
  // accountChanging = signal<NostrUser | null>(null);
  // accountChanged = signal<NostrUser | null>(null);

  // These are cache-lookups for the metadata and relays of all users,
  // to avoid query the database all the time.
  // These lists will grow
  // usersMetadata = signal<Map<string, NostrRecord>>(new Map());
  usersRelays = signal<Map<string, Event>>(new Map());
  accountsRelays = signal<Event[]>([]);

  discoveryQueue: any = [];
  activeDiscoveries: any = [];
  MAX_CONCURRENT_DISCOVERIES = 10;

  constructor() {
    this.logger.info('Initializing NostrService');

    effect(async () => {
      debugger;
      const event = this.accountState.publish();

      if (event) {
        await this.publish(event);
      }

      untracked(() => {
        this.accountState.publish.set(undefined);
      });
    });

    effect(async () => {
      if (this.storage.initialized()) {
        this.logger.info('Storage initialized, loading Nostr Service');
        await this.initialize();
      }
    });

    // Save all users to localStorage whenever they change
    effect(() => {
      const allUsers = this.accountState.accounts();

      if (allUsers.length === 0) {
        this.logger.debug('No users to save to localStorage');
        return;
      }

      this.logger.debug('Users collection effect triggered', { count: allUsers.length });
      this.logger.debug(`Saving ${allUsers.length} users to localStorage`);
      this.localStorage.setItem(this.appState.ACCOUNTS_STORAGE_KEY, JSON.stringify(allUsers));
    });

    this.logger.debug('NostrService initialization completed');
  }

  async initialize() {
    try {
      const accounts = await this.getAccountsFromStorage();

      if (accounts.length === 0) {
        // Show success animation instead of waiting
        this.appState.isLoading.set(false);
        this.appState.showSuccess.set(false);
        this.initialized.set(true);
        return;
      }

      this.accountState.accounts.set(accounts);

      // We keep an in-memory copy of the user metadata and relay list for all accounts,
      // they won't take up too much memory space.
      const accountsMetadata = await this.getAccountsMetadata();

      const accountsMetadataRecords = this.data.getRecords(accountsMetadata);

      for (const metadata of accountsMetadataRecords) {
        this.accountState.addToAccounts(metadata.event.pubkey, metadata);
        this.accountState.addToCache(metadata.event.pubkey, metadata);
      }

      // Also make it available in the general cache.
      // this.accountState.setCachedProfiles(accountsMetadata);
      // this.accountsMetadata.set(accountsMetadata);

      const accountsRelays = await this.getAccountsRelays();
      this.accountsRelays.set(accountsRelays);

      const account = this.getAccountFromStorage();

      // If no account, finish the loading.
      if (!account) {
        // Show success animation instead of waiting
        this.appState.isLoading.set(false);
        this.appState.showSuccess.set(false);
        this.initialized.set(true);
      } else {
        this.accountState.changeAccount(account);
      }
    } catch (err) {
      this.logger.error('Failed to load data during initialization', err);
    }
  }

  async load() {
    this.appState.isLoading.set(true);
    const account = this.accountState.account();

    if (account) {
      const pubkey = account.pubkey;
      // When the account changes, check what data we have and get if missing.
      this.logger.info('Account changed, loading data for new account', { pubkey });

      let info: any = await this.storage.getInfo(pubkey, 'user');

      if (!info) {
        info = {};
      }

      // Get the metadata from in-memory if exists.
      // let metadata: NostrRecord | null | undefined = this.accountState.getAccountProfile(pubkey);

      if (this.relayService.discoveryRelays.length === 0) {
        // We need to ensure that we have Discovery Relay.
        // If there are no Discovery in local storage, we'll pick it based on the region of the account.
        const region = account.region || 'eu';
        const discoveryRelay = this.region.getDiscoveryRelay(region);
        this.relayService.setDiscoveryRelays([discoveryRelay]);
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

      // This will happen if account is brand new. We make a selection based upon their region.
      if (relayUrls.length === 0) {
        const relayUrl = this.region.getRelayServer(account.region || 'eu', 0);
        relayUrls.push(relayUrl!);
      }

      // Store the relays in the relay service
      this.relayService.setRelays(relayUrls);

      const accountPool = new SimplePool();
      accountPool.trackRelays = true;

      // Attach the userPool to the relay service for further use.
      this.relayService.setAccountPool(accountPool);

      const metadataEvent = await this.relayService.getEventByPubkeyAndKind(pubkey, kinds.Metadata);

      let metadata: NostrRecord | null | undefined = null;

      if (metadataEvent) {
        metadata = this.data.getRecord(metadataEvent);

        this.accountState.addToCache(metadata.event.pubkey, metadata);

        this.accountState.profile.set(metadata);

        this.logger.info('Found user metadata', { metadata });
        this.appState.loadingMessage.set('Found your profile! 👍');
        await this.storage.saveEvent(metadata.event);
      } else {
        this.logger.warn('No metadata found for user');
      }

      debugger;

      // After loading the relays and setting them, we load the following list:
      await this.loadAccountFollowing(pubkey);
      await this.loadAccountMuteList(pubkey);
      await this.subscribeToAccountMetadata(pubkey);

      // await this.bookmark.initialize();

      this.appState.loadingMessage.set('Loading completed!');
      this.logger.info('Data loading process completed');

      await this.storage.saveInfo(pubkey, 'user', info);

      // Schedule a refresh of the relays in the background. For now this won't be reflected until
      // the user refreshes the app.
      this.relayService.getEventByPubkeyAndKind(pubkey, kinds.RelayList).then(async (evt) => {
        if (evt) {
          this.storage.saveEvent(evt);
        }
      });

      if (!this.initialized()) {
        this.initialized.set(true);
      }

      this.appState.isLoading.set(false);
      this.appState.showSuccess.set(true);
      this.accountState.initialized.set(true);

      // this.accountState.changeAccount(pubkey);

      // Hide success animation after 1.5 seconds
      setTimeout(() => {
        this.appState.showSuccess.set(false);
      }, 1500);
    }
  }

  reset() {
    this.accountState.accounts.set([]);
    this.accountState.changeAccount(null);
  }

  clear() {
    this.accountState.clearProfileCache();
    // this.accountsMetadata.set([]);
    // this.accountsRelays.set([]);
  }

  // Method to easily find metadata by pubkey
  // getMetadataForAccount(pubkey: string): NostrRecord | undefined {
  //   return this.accountsMetadata().find(meta => meta.event.pubkey === pubkey);
  // }
  getAccountFromStorage() {
    // Check for pubkey query parameter first (for notification handling)
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const pubkeyParam = urlParams.get('pubkey');

      if (pubkeyParam) {
        this.logger.info('Found pubkey in query parameters, attempting to load account', { pubkey: pubkeyParam });

        // Look for the account in our accounts list
        const targetAccount = this.accountState.accounts().find(account => account.pubkey === pubkeyParam);

        if (targetAccount) {
          this.logger.info('Found matching account for pubkey from query parameter', { pubkey: pubkeyParam });

          // Clean up the URL by removing the pubkey parameter
          const url = new URL(window.location.href);
          url.searchParams.delete('pubkey');
          window.history.replaceState({}, '', url.toString());

          return targetAccount;
        } else {
          this.logger.warn('No matching account found for pubkey from query parameter', { pubkey: pubkeyParam });

          // Clean up the URL even if account not found
          const url = new URL(window.location.href);
          url.searchParams.delete('pubkey');
          window.history.replaceState({}, '', url.toString());
        }
      }
    }

    // Fallback to default account from localStorage if no query parameter or account not found
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

    return result.relayUrls;
  }

  /** Will attempt to discover relays for a pubkey. Will persist the event to database. */
  async discoverRelays(pubkey: string, persist = false): Promise<{ relayUrls: string[], relayList: boolean, followingList: boolean }> {
    // Perform relay discovery for the given pubkey
    const discoveryPool = new SimplePool();
    const discoveryRelays = this.relayService.discoveryRelays;

    const result = {
      relayUrls: [] as string[],
      relayList: false,
      followingList: false,
    };

    try {
      console.log('Starting relay discovery for pubkey', pubkey, discoveryRelays);

      discoveryPool.subscribe(discoveryRelays, {
        kinds: [kinds.RelayList],
        authors: [pubkey],
      }, {
        onevent: (event: Event) => {
          console.log('Received event on discovery relays:', event);
        }
      });

      console.log('Waiting for relay discovery to complete...');

      const relays = await discoveryPool.get(discoveryRelays, {
        kinds: [kinds.RelayList],
        authors: [pubkey],
      });

      console.log('FOUND ANYTHING', relays);

      if (relays) {
        this.logger.info('Found your relays on network', { relays });

        if (persist) {
          await this.storage.saveEvent(relays);
        }

        const relayUrls = this.getRelayUrls(relays, false); // Make sure to pass false to avoid ignoring automatic banned relays
        this.logger.info(`Found ${relayUrls.length} relays for user`, { relayUrls });

        if (relayUrls.length > 0) {
          result.relayUrls = this.utilities.normalizeRelayUrls(relayUrls);
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
          if (persist) {
            this.storage.saveEvent(contacts);
          }

          const relayUrls = this.getRelayUrlsFromFollowing(contacts, false);

          if (relayUrls.length > 0) {
            result.relayUrls = this.utilities.normalizeRelayUrls(relayUrls);
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

    return [];

    // If there is no relayUrls, set default relays.
    // const defaultRelays = [...this.relayService.defaultRelays];
    // return defaultRelays;
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
    debugger;
    this.logger.info('subscribeToAccountMetadata', { pubkey });

    const filters = [{
      kinds: [kinds.Metadata, kinds.Contacts, kinds.RelayList],
      authors: [pubkey],
    }];

    const onEvent = async (event: Event) => {
      console.log('Received event on the account subscription:', event);

      if (event.kind === kinds.Contacts) {
        // Refresh the following list in the account state
        this.accountState.parseFollowingList(event);
      }
    }

    const onEose = () => {
      console.log('onEose on account subscription.');
    }

    this.accountSubscription = this.relayService.subscribe(filters, onEvent, onEose);
  }



  private async loadAccountFollowing(pubkey: string) {
    debugger;
    let followingEvent = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.Contacts);

    if (!followingEvent) {
      followingEvent = await this.relayService.getEventByPubkeyAndKind(pubkey, kinds.Contacts);

      if (followingEvent) {
        await this.storage.saveEvent(followingEvent);
      }
    } else {
      // Queue up refresh of this event in the background
      this.relayService.getEventByPubkeyAndKind(pubkey, kinds.Contacts).then(async (evt) => {
        debugger;
        if (evt) {
          this.accountState.parseFollowingList(evt);
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

  async signEvent(event: EventTemplate) {
    return this.sign(event);
  }

  private async sign(event: EventTemplate): Promise<Event> {
    const currentUser = this.accountState.account();

    if (!currentUser) {
      throw new Error('No user account found. Please log in or create an account first.');
    }

    let signedEvent: Event | EventTemplate | null = null;

    if (!('pubkey' in event) || !event.pubkey) {
      (event as any).pubkey = currentUser.pubkey;
    }

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
        const pool = new SimplePool()
        const bunker = new BunkerSigner(hexToBytes(currentUser.privkey!), this.accountState.account()!.bunker!, { pool });
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

    return signedEvent as Event;
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
      pubkey: this.accountState.pubkey(),
    };

    return event;
  }

  /**
 * Adds or updates an entry in the metadata cache with LRU behavior
 */
  // private updateMetadataCache(pubkey: string, record: NostrRecord): void {
  //   // Get the current cache
  //   const cache = this.usersMetadata();

  //   // If the pubkey exists, delete it first (to update position in Map)
  //   if (cache.has(pubkey)) {
  //     cache.delete(pubkey);
  //   }

  //   // Add to the end (newest position)
  //   cache.set(pubkey, record);

  //   // Enforce size limit (100 items)
  //   if (cache.size > 100) {
  //     // Delete oldest item (first in the Map)
  //     const oldestKey = cache.keys().next().value;

  //     if (oldestKey) {
  //       cache.delete(oldestKey);
  //     }
  //   }

  //   // Update signal
  //   this.usersMetadata.set(new Map(cache));
  // }

  /**
   * Adds or updates an entry in the relays cache with LRU behavior
   */
  private updateRelaysCache(pubkey: string, event: Event): void {
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
  async getMetadataForUser(pubkey: string, refresh: boolean = false): Promise<NostrRecord | undefined> {
    console.log('There are X number in cache:', this.accountState.cachedUserProfiles().size);

    // Check cache first
    const cachedMetadata = this.accountState.getCachedProfile(pubkey);
    if (cachedMetadata) {
      // Move to end of LRU cache
      // this.logger.time('getMetadataForUser - cache hit' + pubkey);
      // this.updateMetadataCache(pubkey, cachedMetadata);
      // this.logger.time('getMetadataForUser - cache hit' + pubkey);

      // If refresh is true, make sure to refresh the metadata in the background.
      if (refresh) {
        setTimeout(async () => {
          // Profile discovery not done yet, proceed with network discovery
          const metadata = await this.queueMetadataDiscovery(pubkey);

          if (metadata) {
            const record = this.data.getRecord(metadata);
            this.accountState.addToCache(pubkey, record);
          }
        }, 0);
      }

      return cachedMetadata;
    }

    // Not in cache, get from storage
    const events = await this.storage.getEventsByPubkeyAndKind(pubkey, kinds.Metadata);
    const records = this.data.getRecords(events);

    if (records.length > 0) {
      // Add to cache
      this.accountState.addToCache(pubkey, records[0]);
      return records[0];
    } else {
      // Check if profile discovery has been completed for the current account
      // const currentAccount = this.account();
      // debugger;
      // if (currentAccount && this.accountState.hasProfileDiscoveryBeenDone(currentAccount.pubkey)) {
      //   // Profile discovery has been done, but no metadata found in storage
      //   // Don't attempt network discovery, return undefined
      //   this.logger.debug('Profile discovery completed but no metadata in storage', { pubkey });
      //   return undefined;
      // }

      // Profile discovery not done yet, proceed with network discovery
      const metadata = await this.queueMetadataDiscovery(pubkey);

      if (metadata) {
        const record = this.data.getRecord(metadata);
        this.accountState.addToCache(pubkey, record);
        // this.updateMetadataCache(pubkey, record);
        return record;
      }

      return undefined;
    }
  }

  async getMetadataForUsers(pubkey: string[]): Promise<NostrRecord[] | undefined> {
    const metadataList: NostrRecord[] = [];

    for (const p of pubkey) {
      const metadata = await this.getMetadataForUser(p);
      if (metadata) {
        metadataList.push(metadata);
        // this.updateMetadataCache(p, metadata);
      }
    }

    return metadataList;
  }

  /** Get the BUD-03: User Server List */
  async getMediaServers(pubkey: string): Promise<Event | null> {
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

      if (event) {
        this.storage.saveEvent(event as Event);
      }
    } else {
      // Queue up refresh of this event in the background
      this.relayService.getEventByPubkeyAndKind(pubkey, 10063).then((newEvent) => {
        if (newEvent) {
          this.storage.saveEvent(newEvent as Event);
        }
      });
    }

    return event;
  }

  // currentProfileUserPool: SimplePool | null = null;
  // currentProfileRelayUrls: string[] = [];
  discoveryPool: SimplePool | null = null;

  /** Used during discovery to reuse a single pool across many requests. This will eventually have many connections. */
  discoveryUserPool: SimplePool | null = null;

  async retrieveMetadata(pubkey: string, relayUrls: string[], info: any) {
    let metadata: Event | null | undefined = null;

    // Reuse a reference to the discovery user pool if it exists.
    let userPool = this.discoveryUserPool;

    if (!userPool) {
      userPool = new SimplePool();
    }

    try {
      metadata = await userPool.get(relayUrls, {
        kinds: [kinds.Metadata],
        authors: [pubkey],
      }, {
        maxWait: this.MAX_WAIT_TIME_METADATA
      });

      if (metadata) {
        this.logger.debug('Successfully retrieved metadata', { relayUrls });
        info.foundMetadataOnUserRelays = true;
      }

      // TODO: Improve this a bit, we don't want to end up giving timeout to actually good relays.
      // A lot of user's have tens of relays, and many old ones. If we can't connect to them, give them a timeout.
      // const connectionStatuses = userPool.listConnectionStatus();
      // const failedRelays = Array.from(connectionStatuses.entries())
      //   .filter(([_, status]) => status === false)
      //   .map(([url, _]) => url);

      // this.relayService.timeoutRelays(failedRelays);
    } catch (error) {
      this.logger.debug('Failed to fetch metadata from relay', { error });
    }
    finally {
      // Only close the pool if we created it here.
      if (!this.discoveryUserPool) {
        userPool.destroy();
        userPool = null;
      }
      // userPool.close(relayUrls);
    }

    if (metadata) {
      await this.storage.saveEvent(metadata);
    }

    return metadata;
  }

  async discoverMetadata(pubkey: string, disconnect = true): Promise<Event | undefined | null> {
    this.logger.time('getinfo' + pubkey);
    let info: any = await this.storage.getInfo(pubkey, 'user');
    this.logger.timeEnd('getinfo' + pubkey);

    if (!info) {
      info = {};
    }

    // if (info.lastDiscovery && info.lastDiscovery > this.currentDate() - 60) {
    //   // Skip discovery if it happened in the last 60 seconds
    //   this.logger.debug('Skipping discovery, last discovery was less than 60 seconds ago', {
    //     pubkey,
    //     lastDiscovery: info.lastDiscovery,
    //     secondsAgo: this.currentDate() - info.lastDiscovery
    //   });

    //   // Return previously discovered metadata if available
    //   const metadata = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.Metadata);
    //   return metadata;
    // }

    info.lastDiscovery = this.currentDate();

    // FLOW: Find the user's relays first. Save it.
    // Connect to their relays and get metadata. Save it.
    const event = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.RelayList);

    // If we already have a relay list, go grab the metadata from it.
    if (event) {
      const relayUrls = this.getRelayUrls(event);
      const selectedRelayUrls = this.utilities.pickOptimalRelays(relayUrls, this.MAX_RELAY_COUNT);

      // It can happen that accounts does not have any valid relays, return undefined
      // and then attempt to look up profile using account relays.
      if (selectedRelayUrls.length === 0) {
        debugger;
        this.logger.warn('No valid relays found in relay list. Unable to find user.');
        info.hasNoValidRelays = true
        await this.storage.saveInfo(pubkey, 'user', info);
        return undefined;
      }

      let metadata = await this.retrieveMetadata(pubkey, selectedRelayUrls, info);

      // Since this is not inside the try/catch, we must save info explicitly here.
      await this.storage.saveInfo(pubkey, 'user', info);
      return metadata as Event;
    }
    else {
      const relays = await this.discoveryPool!.get(this.relayService.discoveryRelays, {
        kinds: [kinds.RelayList],
        authors: [pubkey],
      }, { maxWait: this.MAX_WAIT_TIME });

      try {
        if (relays) {
          await this.storage.saveEvent(relays);

          info.foundOnDiscoveryRelays = true;
          info.hasRelayList = true;

          const relayUrls = this.getRelayUrls(relays);

          let metadata = null;

          this.logger.debug('Trying to fetch metadata from individual relays', { relayCount: relayUrls.length });

          const selectedRelayUrls = this.utilities.pickOptimalRelays(relayUrls, this.MAX_RELAY_COUNT);

          if (selectedRelayUrls.length === 0) {
            debugger;
            this.logger.warn('No valid relays found in relay list. Unable to find user.');
            info.hasNoValidRelays = true
            await this.storage.saveInfo(pubkey, 'user', info);
            return undefined;
          }

          metadata = await this.retrieveMetadata(pubkey, selectedRelayUrls, info);

          if (!metadata) {
            this.logger.warn('Failed to retrieve metadata from relay list. Unable to find user.');
            return undefined;
          }

          return metadata as Event;
        } else {
          info.hasRelayList = false;

          const followingEvent = await this.discoveryPool!.get(this.relayService.discoveryRelays, {
            kinds: [kinds.Contacts],
            authors: [pubkey],
          }, {
            maxWait: this.MAX_WAIT_TIME
          });

          if (followingEvent) {
            info.foundOnDiscoveryRelays = true;
            await this.storage.saveEvent(followingEvent);

            // After saving, the .content should be parsed to JSON.
            console.log('FOLLOWING:', followingEvent);

            const followingRelayUrls = this.getRelayUrlsFromFollowing(followingEvent);

            if (followingRelayUrls.length > 30) {
              debugger;
            }

            if (followingRelayUrls.length === 0) {
              this.logger.warn('No relays found in following list. User does not have Relay List nor relays in following list.');
              this.logger.warn('Getting metadata from Discovery Relays... not an ideal situation.');

              info.hasEmptyFollowingList = true;

              this.logger.warn('Failed to retrieve following list from discovery relay. Unable to find user.');
              return undefined;

              // const metadataFromDiscoveryRelays = await bootstrapPool.get(this.relayService.discoveryRelays, {
              //   kinds: [kinds.Metadata],
              //   authors: [pubkey],
              // });

              // if (metadataFromDiscoveryRelays) {
              //   this.logger.warn('Found metadata on discovery relays.');
              //   info.metadataFromDiscoveryRelays = true;
              //   await this.storage.saveEvent(metadataFromDiscoveryRelays);
              //   await this.storage.saveInfo(pubkey, 'user', info);
              //   return metadataFromDiscoveryRelays as NostrEvent;
              // } else {
              //   this.logger.error('Did not find metadata on discovery relays. Giving up.');
              //   info.metadataFromDiscoveryRelays = false;
              //   await this.storage.saveInfo(pubkey, 'user', info);
              //   return undefined;
              // }
            }

            // Previously we attempted to get Relay List from the user's relays, but instead we require user's to publish their
            // latest relay lists to the Discovery relays. This is a more optimal approach.

            // Some user's have massive amount of relays, this is completely not needed. Let's grab maximum of 3 and attempt to 
            // get their profile from them. If the profile is not accessible on 3 of them because the relays are dead, they will
            // eventually be removed from the list returned and next round we will attempt another 3.

            // After some testing, the performance between 1 and 3 seems similar. Using all relays adds a lot of extra time for loading.

            // Filter out any relays that are not reachable
            // const filteredRelays = this.filterRelayUrls(followingRelayUrls);
            const selectedRelayUrls = this.utilities.pickOptimalRelays(followingRelayUrls, this.MAX_RELAY_COUNT)
            let metadata = await this.retrieveMetadata(pubkey, selectedRelayUrls, info);

            return metadata as Event;
            // const followingPool = new SimplePool();
            // const relayList = await followingPool.get(selectedRelayUrls, {
            //   kinds: [kinds.RelayList],
            //   authors: [pubkey],
            // });

            // A lot of user's have tens of relays, and many old ones. If we can't connect to them, put them into an 
            // const connectionStatuses = followingPool.listConnectionStatus();
            // const failedRelays = Array.from(connectionStatuses.entries())
            //   .filter(([_, status]) => status === false)
            //   .map(([url, _]) => url);

            // this.relayService.timeoutRelays(failedRelays);

            // if (relayList) {
            //   followingPool.close(followingRelayUrls);
            //   await this.storage.saveEvent(relayList);
            //   const relayListUrls = this.getRelayUrls(relayList);
            //   console.log('WE FOUND RELAYS!!!!');

            //   info.hasFollowingListRelays = true;
            //   await this.storage.saveInfo(pubkey, 'user', info);

            //   let metadata = null;
            //   this.logger.debug('Trying to fetch metadata from individual relays', { relayCount: relayListUrls.length });

            //   metadata = await this.retrieveMetadata(pubkey, relayListUrls)

            //   // this.currentProfileUserPool = userPool;
            //   // this.currentProfileRelayUrls = relayUrls;

            //   // if (disconnect) {
            //   //   userPool.close(relayUrls);
            //   // }

            //   return metadata as NostrEvent;

            // } else {
            //   console.log('DID NOT Find relays...');
            //   // Capitulate and get profile from the following list relays:
            //   let metadata = await this.retrieveMetadata(pubkey, followingRelayUrls)

            //   followingPool.close(followingRelayUrls);

            //   info.hasFollowingListRelays = false;
            //   info.hasRelayList = false;
            //   await this.storage.saveInfo(pubkey, 'user', info);

            //   return metadata as NostrEvent;
            // }
          }
        }
      }
      finally {
        await this.storage.saveInfo(pubkey, 'user', info);
      }
    }

    return undefined;
  }

  publishQueue: any[] = [];

  /** Used to get Relay List, Following List and Metadata for a user from the account relays. This is a fallback if discovery fails. */
  async discoverMetadataFromAccountRelays(pubkey: string) {
    // First get the relay list if exists.
    // Second get the following list if exists.
    // Get the metadata from the user's relays, not from the account relays. We truly do not want to fall back to get metadata
    // from the current account relays.

    let info: any = await this.storage.getInfo(pubkey, 'user');

    if (!info) {
      info = {};
    }

    try {
      let relayListEvent = await this.relayService.get({
        authors: [pubkey],
        kinds: [kinds.RelayList],
      }, undefined, { timeout: this.MAX_WAIT_TIME });

      let relayUrls: string[] = [];

      if (relayListEvent) {
        info.foundOnAccountRelays = true;
        info.hasRelayList = true;
        this.logger.debug('Found relay list event', { relayListEvent });

        // Make sure we publish Relay List to Discovery Relays if discovered on Account Relays.
        // We must do this before storage.saveEvent, which transforms the content to JSON.

        // TODO: Temporary disabled during active development.
        // try {
        //   this.logger.info('Publishing relay list to discovery relays', { relayListEvent });
        //   await this.relayService.publishToDiscoveryRelays(relayListEvent);
        // } catch (error) {
        //   debugger;
        //   this.logger.error('Failed to publish relay list to discovery relays', { error });
        // }

        await this.storage.saveEvent(relayListEvent);
        relayUrls = this.utilities.pickOptimalRelays(this.getRelayUrls(relayListEvent), this.MAX_RELAY_COUNT);
      } else {
        let followingEvent = await this.relayService.get({
          authors: [pubkey],
          kinds: [kinds.Contacts],
        });

        if (followingEvent) {
          info.foundOnAccountRelays = true;
          this.logger.debug('Found following event', { followingEvent });

          if (relayUrls.length > 0) {
            info.hasFollwingList = true;

            // Make sure we publish Relay List to Discovery Relays if discovered on Account Relays.
            // We must do this before storage.saveEvent, which transforms the content to JSON.
            try {
              this.logger.info('Publishing following list to discovery relays', { followingEvent });
              await this.relayService.publishToDiscoveryRelays(followingEvent);
            } catch (error) {
              this.logger.error('Failed to publish relay list to discovery relays', { error });
            }
          }

          await this.storage.saveEvent(followingEvent);
          relayUrls = this.getRelayUrlsFromFollowing(followingEvent);
        } else {
          this.logger.warn('No relay list or following event found for user', { pubkey });
          // We will make a last attempt at getting the metadata from the account relays.
        }
      }

      let userPool: SimplePool | null = null;

      let usingAccountPool = false;

      // No still no relay urls has been discovered, fall back to account pool.
      if (relayUrls.length === 0) {
        usingAccountPool = true;
        info.foundZeroRelaysOnAccountRelays = true;
        userPool = this.relayService.getAccountPool();
        relayUrls = this.relayService.getAccountRelayUrls();
      } else {
        userPool = new SimplePool();
      }

      try {
        let metadataEvent = await userPool.get(relayUrls, {
          authors: [pubkey],
          kinds: [kinds.Metadata],
        }, { maxWait: this.MAX_WAIT_TIME });

        if (metadataEvent) {
          this.logger.debug('Found metadata event', { metadataEvent });

          if (usingAccountPool) {
            info.foundMetadataOnAccountRelays = true;
          } else {
            info.foundMetadataOnUserRelays = true;
          }

          await this.storage.saveEvent(metadataEvent);
          return metadataEvent;
        } else {
          this.logger.warn('No metadata event found for user', { pubkey });
          return undefined;
        }
      }
      finally {
        // Only destroy if we created it here.
        if (!usingAccountPool) {
          userPool.destroy();
        }
      }

    } finally {
      await this.storage.saveInfo(pubkey, 'user', info);
    }
  }

  private async queueMetadataDiscovery(pubkey: string, disconnect = true): Promise<Event | undefined> {
    return new Promise((resolve, reject) => {
      this.discoveryQueue.push({ pubkey, disconnect, resolve, reject });
      this.logger.debug('Queued metadata discovery', { pubkey, queueLength: this.discoveryQueue.length });

      this.processDiscoveryQueue();
    });
  }

  private isProcessingQueue = false;

  private async processDiscoveryQueue(): Promise<void> {
    // Prevent multiple queue processing instances
    if (this.isProcessingQueue) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      if (!this.discoveryPool) {
        this.discoveryPool = new SimplePool();
      }

      if (!this.discoveryUserPool) {
        this.discoveryUserPool = new SimplePool();
      }

      // Process all items in the queue
      // while (this.discoveryQueue.length > 0) {
      //   debugger;
      // Take all items from the queue
      // const items = this.discoveryQueue.splice(0, this.discoveryQueue.length);

      // this.activeDiscoveries += items.length;
      // this.logger.debug('Starting metadata discovery', {
      //   itemCount: items.length,
      //   activeDiscoveries: this.activeDiscoveries
      // });

      // Process all items sequentially
      for (const item of this.discoveryQueue) {
        try {
          let result = await this.discoverMetadata(item.pubkey, item.disconnect);

          if (!result) {
            this.logger.warn('No metadata found during discovery, fallback to using current account relays.', { pubkey: item.pubkey });
            result = await this.discoverMetadataFromAccountRelays(item.pubkey);
          }

          item.resolve(result);
        } catch (error) {
          this.logger.error('Error discovering metadata', { pubkey: item.pubkey, error });
          item.reject(error);
        } finally {
          // this.activeDiscoveries--;
          // this.logger.debug('Completed metadata discovery', {
          //   pubkey: item.pubkey,
          //   activeDiscoveries: this.activeDiscoveries
          // });
        }
      }

      // Check if all discoveries are complete
      // if (this.activeDiscoveries === 0) {
      // All discoveries complete and queue is empty
      if (this.discoveryUserPool) {
        this.discoveryUserPool.destroy();
        this.discoveryUserPool = null;
      }
      // }
      // }
    }
    catch (err) {
      this.logger.error('Error processing discovery queue', { error: err });
    }
    finally {
      this.isProcessingQueue = false;
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
        lastUsed: Date.now(),
        hasActivated: true
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
    const pubkeys = this.accountState.accounts().map(user => user.pubkey);

    // Get metadata for all accounts from storage, we have not initialized accounts pool yet so cannot get from relays.
    const events = await this.storage.getEventsByPubkeyAndKind(pubkeys, kinds.Metadata);
    // const events = await this.data.getEventsByPubkeyAndKind(pubkeys, kinds.Metadata);
    return events;
  }

  async getAccountsRelays() {
    const pubkeys = this.accountState.accounts().map(user => user.pubkey);
    const relays = await this.storage.getEventsByPubkeyAndKind(pubkeys, kinds.RelayList);
    return relays;
  }

  // async updateAccountMetadata(event: Event) {
  //   const pubkey = event.pubkey;

  //   // Ensure content is properly parsed
  //   if (event.content && event.content !== 'null' && typeof event.content === 'string') {
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

  // updateAccountMetadata(record: NostrRecord) {
  //   this.accountState.addToCache(record.event.pubkey, record);
  // }

  /** Parses the URLs and cleans up, ensuring only wss:// instances are returned. */
  getRelayUrlsFromFollowing(event: Event, timeouts: boolean = true): string[] {
    let relayUrls = this.utilities.getRelayUrlsFromFollowing(event);

    // Filter out timed out relays if timeouts parameter is true
    if (timeouts) {
      const timedOutRelays = this.relayService.timeouts().map(relay => relay.url);
      relayUrls = relayUrls.filter(relay => !timedOutRelays.includes(this.utilities.normalizeRelayUrl(relay)));
    }

    return relayUrls;
  }

  /** Parses the URLs and cleans up, ensuring only wss:// instances are returned. */
  getRelayUrls(event: Event, timeouts: boolean = true): string[] {
    let relayUrls = this.utilities.getRelayUrls(event);

    // Filter out timed out relays if timeouts parameter is true
    if (timeouts) {
      const timedOutRelays = this.relayService.timeouts().map(relay => relay.url);
      relayUrls = relayUrls.filter(relay => !timedOutRelays.includes(this.utilities.normalizeRelayUrl(relay)));
    }

    return relayUrls;
  }

  /** Filters out timed out or banned relays. */
  filterRelayUrls(relayUrls: string[]): string[] {
    const timedOutRelays = this.relayService.timeouts().map(relay => relay.url);
    relayUrls = relayUrls.filter(relay => !timedOutRelays.includes(this.utilities.normalizeRelayUrl(relay)));
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
    const targetUser = this.accountState.accounts().find(u => u.pubkey === pubkey);
    if (targetUser) {
      // Update lastUsed timestamp
      targetUser.lastUsed = Date.now();

      // Persist the account to local storage.
      this.localStorage.setItem(this.appState.ACCOUNT_STORAGE_KEY, JSON.stringify(targetUser));

      // This will trigger a lot of effects.
      this.accountState.changeAccount(targetUser);
      this.logger.debug('Successfully switched user');

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
    user.name ??= this.utilities.getTruncatedNpub(user.pubkey);

    const allUsers = this.accountState.accounts();
    const existingUserIndex = allUsers.findIndex(u => u.pubkey === user.pubkey);

    if (existingUserIndex >= 0) {
      // Update existing user
      this.logger.debug('Updating existing user in collection', { index: existingUserIndex });
      this.accountState.accounts.update(u => u.map(existingUser => existingUser.pubkey === user.pubkey ? user : existingUser));
    } else {
      // Add new user
      this.logger.debug('Adding new user to collection');
      this.accountState.accounts.update(u => [...u, user]);
    }

    // Persist the account to local storage.
    this.localStorage.setItem(this.appState.ACCOUNT_STORAGE_KEY, JSON.stringify(user));

    // Trigger the user signal which indicates user is logged on.
    // This will trigger a lot of effects.
    this.accountState.changeAccount(user);
  }

  async generateNewKey(region?: string) {
    debugger;
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
      lastUsed: Date.now(),
      region: region,
      hasActivated: false
    };

    this.logger.debug('New keypair generated successfully', { pubkey, region });

    const relayServerUrl = this.region.getRelayServer(region!, 0);
    const relayTags = this.createTags('r', [relayServerUrl!]);

    // Create Relay List event for the new user
    const relayListEvent: UnsignedEvent = {
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: kinds.RelayList,
      tags: relayTags,
      content: ''
    };

    const signedEvent = finalizeEvent(relayListEvent, secretKey);

    // Save locally first, then publish to discovery relays.
    await this.storage.saveEvent(signedEvent);
    await this.relayService.publishToDiscoveryRelays(signedEvent);

    const mediaServerUrl = this.region.getMediaServer(region!, 0);
    const mediaTags = this.createTags('server', [mediaServerUrl!]);

    // Create Media Server event for the new user, this we cannot publish yet, because account is not initialized.
    const mediaServerEvent: UnsignedEvent = {
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: MEDIA_SERVERS_EVENT_KIND,
      tags: mediaTags,
      content: ''
    };

    const signedMediaEvent = finalizeEvent(mediaServerEvent, secretKey);
    await this.storage.saveEvent(signedMediaEvent);

    // TODO: The media server event should be published to discovery relays, but we cannot do that yet, implement
    // a queue for event publishing.
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
        name: this.utilities.getTruncatedNpub(pubkey),
        source: 'extension',
        lastUsed: Date.now(),
        hasActivated: true // Assume activation is done via extension
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
        lastUsed: Date.now(),
        hasActivated: true // Assume activation is done via nsec
      };

      this.logger.info('Login with nsec successful', { pubkey });
      await this.setAccount(newUser);
    } catch (error) {
      this.logger.error('Error decoding nsec:', error);
      throw new Error('Invalid nsec key provided. Please check and try again.');
    }
  } async usePreviewAccount(customPubkey?: string) {
    this.logger.info('Using preview account', { customPubkey });

    // Default to Jack's pubkey if no custom pubkey is provided
    let previewPubkey = '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2';

    // If a custom pubkey is provided in npub format, convert it to hex
    if (customPubkey && customPubkey.startsWith('npub')) {
      try {
        const decoded = nip19.decode(customPubkey);
        if (decoded.type === 'npub') {
          previewPubkey = decoded.data as string;
          this.logger.debug('Converted npub to hex for preview', { npub: customPubkey, hex: previewPubkey });
        }
      } catch (e) {
        this.logger.error('Failed to convert npub to hex', { error: e, npub: customPubkey });
      }
    }
    // If custom pubkey is provided in hex format, use it directly
    else if (customPubkey && customPubkey.length === 64) {
      previewPubkey = customPubkey;
    }

    const newUser: NostrUser = {
      pubkey: previewPubkey,
      name: customPubkey ? 'Custom Preview' : 'Preview User',
      source: 'preview',
      lastUsed: Date.now(),
      hasActivated: true // Assume activation is done for preview accounts
    };

    await this.setAccount(newUser);
    this.logger.debug('Preview account set successfully', { pubkey: previewPubkey });
  }

  logout(): void {
    this.logger.info('Logging out current user');
    this.localStorage.removeItem(this.appState.ACCOUNT_STORAGE_KEY);
    this.accountState.changeAccount(null);
    this.logger.debug('User logged out successfully');
  }

  removeAccount(pubkey: string): void {
    this.logger.info(`Removing account with pubkey: ${pubkey}`);
    const allUsers = this.accountState.accounts();
    const updatedUsers = allUsers.filter(u => u.pubkey !== pubkey);
    this.accountState.accounts.set(updatedUsers);

    // If we're removing the active user, set active user to null
    if (this.accountState.account()?.pubkey === pubkey) {
      this.logger.debug('Removed account was the active user, logging out');
      this.accountState.changeAccount(null);
    }

    // Remove the user's metadata from the metadata array
    // this.accountsMetadata().update(array => array.filter(m => m.pubkey !== pubkey));
    // this.accountsMetadata()
    // this.accountsMetadata.update(array => array.filter(m => m.event.pubkey !== pubkey));
    this.logger.debug('Account removed successfully');
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
    const currentUser = this.accountState.account();
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
        const { type, data } = this.utilities.decode(nevent);
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

  async getEvent(id: string): Promise<Event | undefined> {
    // First try to get from storage
    let event = await this.storage.getEventById(id);

    if (event) {
      return event;
    }

    // If not in storage, try to fetch from relays
    try {
      await this.storage.clearCache(this.accountState.pubkey());
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

  async publish(event: UnsignedEvent | Event | any) {
    // Clone the bookmark event and remove id and sig
    const eventToSign = { ...event };
    eventToSign.id = '';
    eventToSign.sig = '';
    eventToSign.created_at = Math.floor(Date.now() / 1000);

    // Sign the event
    const signedEvent = await this.signEvent(eventToSign);

    // Publish to relays and get array of promises
    const publishPromises = await this.relayService.publish(signedEvent);

    return signedEvent;
  }

  async getNIP98AuthToken({ url, method }: { url: string, method: string }) {
    return nip98.getToken(url, method, async (e) => {
      const event = await this.signEvent(e);
      return event;
    })
  }
}
