import { Injectable, signal, effect, inject, untracked } from '@angular/core';
import {
  Event,
  EventTemplate,
  generateSecretKey,
  getPublicKey,
  UnsignedEvent,
} from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { nip19, nip98 } from 'nostr-tools';
import { LoggerService } from './logger.service';
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
import { PublishQueueService } from './publish-queue';
import { SharedRelayService } from './relays/shared-relay';
import { AccountRelayService } from './relays/account-relay';
import { DiscoveryRelayService } from './relays/discovery-relay';
import { LocalSettingsService } from './local-settings.service';

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
  hasActivated: boolean;
}

export interface UserMetadataWithPubkey extends NostrEventData<UserMetadata> {
  pubkey: string;
}

@Injectable({
  providedIn: 'root',
})
export class NostrService implements NostriaService {
  private readonly logger = inject(LoggerService);

  private readonly discoveryRelay = inject(DiscoveryRelayService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly sharedRelay = inject(SharedRelayService);

  private readonly storage = inject(StorageService);
  private readonly appState = inject(ApplicationStateService);
  private readonly accountState = inject(AccountStateService);
  private readonly localStorage = inject(LocalStorageService);
  private readonly region = inject(RegionService);
  private readonly data = inject(DataService);
  private readonly utilities = inject(UtilitiesService);
  private readonly publishQueueService = inject(PublishQueueService);
  private readonly settings = inject(LocalSettingsService);

  initialized = signal(false);
  MAX_WAIT_TIME = 2000;
  MAX_WAIT_TIME_METADATA = 2500;
  dataLoaded = false;
  publishQueue: any[] = [];
  accountSubscription: any = null;

  // These are cache-lookups for the metadata and relays of all users,
  // to avoid query the database all the time.
  // These lists will grow
  // usersMetadata = signal<Map<string, NostrRecord>>(new Map());
  usersRelays = signal<Map<string, Event>>(new Map());
  accountsRelays = signal<Event[]>([]);

  discoveryQueue: any = [];
  activeDiscoveries: any = [];
  MAX_CONCURRENT_DISCOVERIES = 10;

  discoveryPool: SimplePool | null = null;

  /** Used during discovery to reuse a single pool across many requests. This will eventually have many connections. */
  discoveryUserPool: SimplePool | null = null;

  constructor() {
    this.logger.info('Initializing NostrService');

    effect(async () => {
      const event = this.accountState.publish();

      if (event) {
        const signedEvent = await this.sign(event);
        await this.accountRelay.publish(signedEvent);
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

      this.logger.debug('Users collection effect triggered', {
        count: allUsers.length,
      });
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

      const accountsMetadataRecords = this.data.toRecords(accountsMetadata);

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
      this.logger.info('Account changed, loading data for new account', {
        pubkey,
      });

      let info: any = await this.storage.getInfo(pubkey, 'user');

      if (!info) {
        info = {};
      }

      // This will fail for brand new accounts, only for existing.
      const metadataEvent = await this.accountRelay.getEventByPubkeyAndKind(pubkey, kinds.Metadata);

      let metadata: NostrRecord | null | undefined = null;

      if (metadataEvent) {
        metadata = this.data.toRecord(metadataEvent);

        this.accountState.addToCache(metadata.event.pubkey, metadata);
        this.accountState.profile.set(metadata);

        this.logger.info('Found user metadata', { metadata });
        this.appState.loadingMessage.set('Found your profile! 👍');
        await this.storage.saveEvent(metadata.event);
      } else {
        this.logger.warn('No metadata found for user');
      }

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
      this.discoveryRelay.getEventByPubkeyAndKind(pubkey, kinds.RelayList).then(async evt => {
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
    // this.accountState.clearProfileCache();
    // this.accountsMetadata.set([]);
    // this.accountsRelays.set([]);
  }

  getAccountFromStorage() {
    // Check for pubkey query parameter first (for notification handling)
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const pubkeyParam = urlParams.get('pubkey');

      if (pubkeyParam) {
        this.logger.info('Found pubkey in query parameters, attempting to load account', {
          pubkey: pubkeyParam,
        });

        // Look for the account in our accounts list
        const targetAccount = this.accountState
          .accounts()
          .find(account => account.pubkey === pubkeyParam);

        if (targetAccount) {
          this.logger.info('Found matching account for pubkey from query parameter', {
            pubkey: pubkeyParam,
          });

          // Clean up the URL by removing the pubkey parameter
          const url = new URL(window.location.href);
          url.searchParams.delete('pubkey');
          window.history.replaceState({}, '', url.toString());

          return targetAccount;
        } else {
          this.logger.warn('No matching account found for pubkey from query parameter', {
            pubkey: pubkeyParam,
          });

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

  private async subscribeToAccountMetadata(pubkey: string) {
    this.logger.info('subscribeToAccountMetadata', { pubkey });

    const filter =
    {
      kinds: [kinds.Metadata, kinds.Contacts, kinds.RelayList],
      authors: [pubkey],
    };

    const onEvent = async (event: Event) => {
      console.log('Received event on the account subscription:', event);

      if (event.kind === kinds.Contacts) {
        // Refresh the following list in the account state
        this.accountState.parseFollowingList(event);
      }
    };

    const onEose = () => {
      console.log('onEose on account subscription.');
    };

    this.accountSubscription = this.accountRelay.subscribe(filter, onEvent, onEose);
  }

  private async loadAccountFollowing(pubkey: string) {
    let followingEvent = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.Contacts);

    if (!followingEvent) {
      followingEvent = await this.accountRelay.getEventByPubkeyAndKind(pubkey, kinds.Contacts);

      if (followingEvent) {
        await this.storage.saveEvent(followingEvent);
      }
    } else {
      // Queue up refresh of this event in the background
      this.accountRelay.getEventByPubkeyAndKind(pubkey, kinds.Contacts).then(async evt => {
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
      muteListEvent = await this.accountRelay.getEventByPubkeyAndKind(pubkey, kinds.Mutelist);

      if (muteListEvent) {
        await this.storage.saveEvent(muteListEvent);
      }
    } else {
      // Queue up refresh of this event in the background
      this.accountRelay.getEventByPubkeyAndKind(pubkey, kinds.Mutelist).then(async evt => {
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

  private async sign(event: EventTemplate | Event): Promise<Event> {
    const currentUser = this.accountState.account();

    if (!currentUser) {
      throw new Error('No user account found. Please log in or create an account first.');
    }

    let signedEvent: Event | EventTemplate | null = null;

    if (!('pubkey' in event) || !event.pubkey) {
      (event as any).pubkey = currentUser.pubkey;
    }

    // Remove id and signature, ensuring they are re-created upon signing.
    (event as any).id = undefined;
    (event as any).sig = undefined;

    // Let's update the created_at to ensure if this is old event being updated,
    // we have a fresh creation date.
    event.created_at = this.currentDate();

    switch (currentUser?.source) {
      case 'extension':
        if (!window.nostr) {
          throw new Error(
            'Nostr extension not found. Please install Alby, nos2x, or another NIP-07 compatible extension.'
          );
        }

        const extensionResult = await window.nostr.signEvent(event);

        signedEvent = {
          ...event,
          id: extensionResult.id,
          sig: extensionResult.sig,
        };

        break;
      case 'remote':
        const pool = new SimplePool();
        const bunker = BunkerSigner.fromBunker(
          hexToBytes(currentUser.privkey!),
          this.accountState.account()!.bunker!,
          { pool }
        );
        signedEvent = await bunker.signEvent(event);
        this.logger.info('Using remote signer account');
        break;

      case 'preview':
        throw new Error(
          'Preview accounts cannot sign events. Please use a different account type.'
        );
        break;
      case 'nsec':
        signedEvent = finalizeEvent(event, hexToBytes(currentUser.privkey!));
        break;
    }

    return signedEvent as Event;
  }

  async signAndPublish(event: UnsignedEvent): Promise<boolean> {
    if (!event) {
      throw new Error('Event parameter must not be null or undefined.');
    }
    const signedEvent = await this.signEvent(event);

    const publishPromises = await this.accountRelay.publish(signedEvent);

    if (publishPromises) {
      await Promise.allSettled(publishPromises);
      return true;
    } else {
      return false;
    }
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

  // NIP-09 Deletion Request / Retraction Event
  createRetractionEvent(eventToRetract: Event): UnsignedEvent {
    return this.createEvent(kinds.EventDeletion, '', [
      ['e', eventToRetract.id],
      ['k', String(eventToRetract.kind)],
    ]);
  }

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
  async getMetadataForUser(pubkey: string, refresh = false): Promise<NostrRecord | undefined> {
    // Check cache first
    const cachedMetadata = this.accountState.getCachedProfile(pubkey);

    if (cachedMetadata) {
      // If refresh is true, make sure to refresh the metadata in the background.
      if (refresh) {
        setTimeout(async () => {
          // Profile discovery not done yet, proceed with network discovery
          const metadata = await this.queueMetadataDiscovery(pubkey);

          if (metadata) {
            const record = this.data.toRecord(metadata);
            this.accountState.addToCache(pubkey, record);
          }
        }, 0);
      }

      return cachedMetadata;
    }

    // Not in cache, get from storage
    const events = await this.storage.getEventsByPubkeyAndKind(pubkey, kinds.Metadata);
    const records = this.data.toRecords(events);

    if (records.length > 0) {
      // Add to cache
      this.accountState.addToCache(pubkey, records[0]);
      return records[0];
    } else {
      // Profile discovery not done yet, proceed with network discovery
      const metadata = await this.queueMetadataDiscovery(pubkey);

      if (metadata) {
        const record = this.data.toRecord(metadata);
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
    // Get from storage
    let event = await this.storage.getEventByPubkeyAndKind(pubkey, 10063); // BUD-03: User Server List

    if (!event) {
      event = await this.accountRelay.getEventByPubkeyAndKind(pubkey, 10063);

      if (event) {
        this.storage.saveEvent(event as Event);
      }
    } else {
      // Queue up refresh of this event in the background
      this.accountRelay.getEventByPubkeyAndKind(pubkey, 10063).then(newEvent => {
        if (newEvent) {
          this.storage.saveEvent(newEvent as Event);
        }
      });
    }

    return event;
  }

  async retrieveMetadata(pubkey: string, relayUrls: string[], info: any) {
    let metadata: Event | null | undefined = null;

    // Reuse a reference to the discovery user pool if it exists.
    let userPool = this.discoveryUserPool;

    if (!userPool) {
      userPool = new SimplePool();
    }

    try {
      metadata = await userPool.get(
        relayUrls,
        {
          kinds: [kinds.Metadata],
          authors: [pubkey],
        },
        {
          maxWait: this.MAX_WAIT_TIME_METADATA,
        }
      );

      if (metadata) {
        this.logger.debug('Successfully retrieved metadata', { relayUrls });
        info.foundMetadataOnUserRelays = true;
      }

      // this.relayService.timeoutRelays(failedRelays);
    } catch (error) {
      this.logger.debug('Failed to fetch metadata from relay', { error });
    } finally {
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
    const data = await this.sharedRelay.get(pubkey, {
      authors: [pubkey],
      kinds: [kinds.Metadata],
    });
    return data;
  }

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
      const relayListEvent = await this.accountRelay.get(
        {
          authors: [pubkey],
          kinds: [kinds.RelayList],
        }
        // ,
        // undefined,
        // { timeout: this.MAX_WAIT_TIME }
      );

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
        //   this.logger.error('Failed to publish relay list to discovery relays', { error });
        // }

        await this.storage.saveEvent(relayListEvent);

        relayUrls = this.utilities.pickOptimalRelays(
          this.utilities.getRelayUrls(relayListEvent),
          this.settings.maxRelaysPerUser()
        );
      } else {
        const followingEvent = await this.accountRelay.get({
          authors: [pubkey],
          kinds: [kinds.Contacts],
        });

        if (followingEvent) {
          info.foundOnAccountRelays = true;
          this.logger.debug('Found following event', { followingEvent });

          if (relayUrls.length > 0) {
            info.hasFollowingList = true;

            // Make sure we publish Relay List to Discovery Relays if discovered on Account Relays.
            // We must do this before storage.saveEvent, which transforms the content to JSON.
            try {
              this.logger.info('Publishing following list to discovery relays', { followingEvent });
              await this.discoveryRelay.publish(followingEvent);
            } catch (error) {
              this.logger.error('Failed to publish relay list to discovery relays', { error });
            }
          }

          await this.storage.saveEvent(followingEvent);
          relayUrls = this.utilities.getRelayUrlsFromFollowing(followingEvent);
        } else {
          this.logger.warn('No relay list or following event found for user', {
            pubkey,
          });
          // We will make a last attempt at getting the metadata from the account relays.
        }
      }

      let userPool: SimplePool | null = null;

      let usingAccountPool = false;

      // No still no relay urls has been discovered, fall back to account pool.
      if (relayUrls.length === 0) {
        usingAccountPool = true;
        info.foundZeroRelaysOnAccountRelays = true;
        userPool = this.accountRelay.getPool();
        relayUrls = this.accountRelay.getRelayUrls();
      } else {
        userPool = new SimplePool();
      }

      try {
        const metadataEvent = await userPool.get(
          relayUrls,
          {
            authors: [pubkey],
            kinds: [kinds.Metadata],
          },
          { maxWait: this.MAX_WAIT_TIME }
        );

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
      } finally {
        // Only destroy if we created it here.
        if (!usingAccountPool) {
          userPool.destroy();
        }
      }
    } finally {
      await this.storage.saveInfo(pubkey, 'user', info);
    }
  }

  private async queueMetadataDiscovery(
    pubkey: string,
    disconnect = true
  ): Promise<Event | undefined> {
    return new Promise((resolve, reject) => {
      this.discoveryQueue.push({ pubkey, disconnect, resolve, reject });
      this.logger.debug('Queued metadata discovery', {
        pubkey,
        queueLength: this.discoveryQueue.length,
      });

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

      // Process all items sequentially
      for (const item of this.discoveryQueue) {
        try {
          let result = await this.discoverMetadata(item.pubkey, item.disconnect);

          if (!result) {
            this.logger.warn(
              'No metadata found during discovery, fallback to using current account relays.',
              { pubkey: item.pubkey }
            );
            result = await this.discoverMetadataFromAccountRelays(item.pubkey);
          }

          item.resolve(result);
        } catch (error) {
          this.logger.error('Error discovering metadata', {
            pubkey: item.pubkey,
            error,
          });
          item.reject(error);
        }
      }

      if (this.discoveryUserPool) {
        this.discoveryUserPool.destroy();
        this.discoveryUserPool = null;
      }
    } catch (err) {
      this.logger.error('Error processing discovery queue', { error: err });
    } finally {
      this.isProcessingQueue = false;
    }
  }

  async loginWithNostrConnect(remoteSigningUrl: string) {
    this.logger.info('Attempting to login with Nostr Connect', {
      url: remoteSigningUrl,
    });

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
        secret: `${secret?.substring(0, 4)}...`, // Log only prefix for security
      });

      const privateKey = generateSecretKey();

      const pool = new SimplePool();
      const bunker = BunkerSigner.fromBunker(privateKey, bunkerParsed!, { pool });
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
        hasActivated: true,
      };

      await this.setAccount(newUser);
      this.logger.debug('Remote signer account set successfully', {
        pubkey: remotePublicKey,
      });

      this.logger.info('Nostr Connect login successful', { pubkey });

      return {
        pubkey,
        relays,
        secret,
      };
    } catch (error) {
      this.logger.error('Error parsing Nostr Connect URL:', error);
      throw error;
    }
  }

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

  getTags(event: Event | UnsignedEvent, tagType: NostrTagKey): string[] {
    const tags = event.tags.filter(tag => tag.length >= 2 && tag[0] === tagType).map(tag => tag[1]);

    return tags;
  }

  setTags(
    event: Event | UnsignedEvent,
    tagType: NostrTagKey,
    values: string[]
  ): Event | UnsignedEvent {
    // Create a shallow copy of the event to avoid mutating the original
    const updatedEvent: Event | UnsignedEvent = {
      ...event,
      tags: [...event.tags],
    };

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

      return true;
    }

    this.logger.warn(`User with pubkey ${pubkey} not found`);
    return false;
  }

  async setAccount(user: NostrUser) {
    this.logger.debug('Updating user in collection', { pubkey: user.pubkey });

    // Update lastUsed timestamp
    user.lastUsed = Date.now();
    user.name ??= this.utilities.getTruncatedNpub(user.pubkey);

    const allUsers = this.accountState.accounts();
    const existingUserIndex = allUsers.findIndex(u => u.pubkey === user.pubkey);

    if (existingUserIndex >= 0) {
      // Update existing user
      this.logger.debug('Updating existing user in collection', {
        index: existingUserIndex,
      });
      this.accountState.accounts.update(u =>
        u.map(existingUser => (existingUser.pubkey === user.pubkey ? user : existingUser))
      );
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
      hasActivated: false,
    };

    this.logger.debug('New keypair generated successfully', { pubkey, region });

    // Configure the discovery relay based on the user's region
    if (region) {
      const discoveryRelay = this.region.getDiscoveryRelay(region);

      this.logger.info('Setting discovery relay for new user based on region', {
        region,
        discoveryRelay,
      });

      this.discoveryRelay.setDiscoveryRelays([discoveryRelay]);
    }

    const relayServerUrl = this.region.getRelayServer(region!, 0);
    const relayTags = this.createTags('r', [relayServerUrl!]);

    // Initialize the account relay so we can start using it.
    this.accountRelay.init([relayServerUrl!]);
    // Create Relay List event for the new user
    const relayListEvent: UnsignedEvent = {
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: kinds.RelayList,
      tags: relayTags,
      content: '',
    };

    const signedEvent = finalizeEvent(relayListEvent, secretKey);

    // Save locally first, then publish to discovery relays.
    await this.storage.saveEvent(signedEvent);
    await this.accountRelay.publish(signedEvent);
    await this.discoveryRelay.publish(signedEvent);

    const mediaServerUrl = this.region.getMediaServer(region!, 0);
    const mediaTags = this.createTags('server', [mediaServerUrl!]);

    // Create Media Server event for the new user, this we cannot publish yet, because account is not initialized.
    const mediaServerEvent: UnsignedEvent = {
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: MEDIA_SERVERS_EVENT_KIND,
      tags: mediaTags,
      content: '',
    };

    const signedMediaEvent = finalizeEvent(mediaServerEvent, secretKey);
    await this.storage.saveEvent(signedMediaEvent);
    await this.accountRelay.publish(signedMediaEvent);

    const relayDMTags = this.createTags('relay', [relayServerUrl!]);

    // Create DM Relay List event for the new user to support NIP-17.
    const relayDMListEvent: UnsignedEvent = {
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: kinds.DirectMessageRelaysList,
      tags: relayDMTags,
      content: '',
    };

    const signedDMEvent = finalizeEvent(relayDMListEvent, secretKey);
    await this.storage.saveEvent(signedDMEvent);
    await this.accountRelay.publish(signedDMEvent);

    await this.setAccount(newUser);

    return newUser;
  }

  async loginWithExtension(): Promise<void> {
    this.logger.info('Attempting to login with Nostr extension');
    try {
      // Check if NIP-07 extension is available
      if (!window.nostr) {
        const error =
          'No Nostr extension found. Please install Alby, nos2x, or another NIP-07 compatible extension.';
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

      // Set the user with the public key from the extension
      const newUser: NostrUser = {
        pubkey,
        name: this.utilities.getTruncatedNpub(pubkey),
        source: 'extension',
        lastUsed: Date.now(),
        hasActivated: true, // Assume activation is done via extension
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
        hasActivated: true, // Assume activation is done via nsec
      };

      this.logger.info('Login with nsec successful', { pubkey });
      await this.setAccount(newUser);
    } catch (error) {
      this.logger.error('Error decoding nsec:', error);
      throw new Error('Invalid nsec key provided. Please check and try again.');
    }
  }

  async usePreviewAccount(customPubkey?: string) {
    this.logger.info('Using preview account', { customPubkey });

    // Default to Jack's pubkey if no custom pubkey is provided
    let previewPubkey = '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2';

    // If a custom pubkey is provided in npub format, convert it to hex
    if (customPubkey && customPubkey.startsWith('npub')) {
      try {
        const decoded = nip19.decode(customPubkey);
        if (decoded.type === 'npub') {
          previewPubkey = decoded.data as string;
          this.logger.debug('Converted npub to hex for preview', {
            npub: customPubkey,
            hex: previewPubkey,
          });
        }
      } catch (e) {
        this.logger.error('Failed to convert npub to hex', {
          error: e,
          npub: customPubkey,
        });
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
      hasActivated: true, // Assume activation is done for preview accounts
    };

    await this.setAccount(newUser);
    this.logger.debug('Preview account set successfully', {
      pubkey: previewPubkey,
    });
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

    this.logger.debug('Account removed successfully');
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

  async getNIP98AuthToken({ url, method }: { url: string; method: string }) {
    const currentUser = this.accountState.account();

    // Check if preview account is trying to sign
    if (currentUser?.source === 'preview') {
      throw new Error('Preview accounts cannot sign events. Please use a different account type.');
    }

    return nip98.getToken(url, method, async e => {
      const event = await this.signEvent(e);
      return event;
    });
  }
}
