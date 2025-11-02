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
import { PublishService } from './publish.service';
import { MatDialog } from '@angular/material/dialog';
import { SigningDialogComponent } from '../components/signing-dialog/signing-dialog.component';
import { CryptoEncryptionService, EncryptedData } from './crypto-encryption.service';
import { PinPromptService } from './pin-prompt.service';

export interface NostrUser {
  pubkey: string;
  /** 
   * Private key storage - can be either:
   * - Plain hex string (legacy, backwards compatible)
   * - JSON string of EncryptedData (encrypted with PIN)
   */
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

  /** 
   * Indicates if the private key is encrypted with a PIN
   * If true, privkey contains JSON-stringified EncryptedData
   * If false or undefined, privkey is plain hex (backwards compatible)
   */
  isEncrypted?: boolean;
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
  private readonly publishService = inject(PublishService);
  private readonly dialog = inject(MatDialog);
  private readonly crypto = inject(CryptoEncryptionService);
  private readonly pinPrompt = inject(PinPromptService);

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

    // Backwards compatibility: handle signal-based publishing
    // This maintains the old pattern while using the new PublishService internally
    effect(async () => {
      const event = this.accountState.publish();

      if (event) {
        console.log('[NostrService] DEBUG: Publish effect triggered:', {
          eventKind: event.kind,
          eventCreatedAt: event.created_at,
          currentTime: Math.floor(Date.now() / 1000),
          newlyFollowedPubkeys: this.accountState.newlyFollowedPubkeys(),
        });

        try {
          const signedEvent = await this.sign(event);

          console.log('[NostrService] DEBUG: Event signed:', {
            signedEventKind: signedEvent.kind,
            signedEventCreatedAt: signedEvent.created_at,
            signedEventId: signedEvent.id,
          });

          // Get newly followed pubkeys for kind 3 events
          const newlyFollowedPubkeys = signedEvent.kind === kinds.Contacts
            ? this.accountState.newlyFollowedPubkeys()
            : undefined;

          console.log('[NostrService] DEBUG: Preparing to publish:', {
            isKind3: signedEvent.kind === kinds.Contacts,
            newlyFollowedPubkeys: newlyFollowedPubkeys,
            newlyFollowedCount: newlyFollowedPubkeys?.length || 0,
          });

          // IMPORTANT: ALL events from the current account must go to ALL configured relays
          // to prevent data fragmentation. This ensures complete data redundancy and 
          // availability across the user's entire relay network.

          // Use the new PublishService with appropriate options
          const options = signedEvent.kind === kinds.Contacts
            ? {
              notifyFollowed: true,
              useOptimizedRelays: false,
              newlyFollowedPubkeys  // Pass the newly followed pubkeys
            }
            : { useOptimizedRelays: false }; // Always use all relays for all events

          console.log('[NostrService] DEBUG: Publishing with options:', {
            options: options,
          });

          await this.publishService.publish(signedEvent, options);
        } catch (error) {
          this.logger.error('[NostrService] Error in publish effect', error);
        }
      }

      untracked(() => {
        this.accountState.publish.set(undefined);
        // Clear newly followed pubkeys after publish
        this.accountState.newlyFollowedPubkeys.set([]);
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

  /**
   * Gets the decrypted private key from a NostrUser
   * Handles both encrypted and plaintext (legacy) private keys
   * 
   * @param user The NostrUser to get the private key from
   * @param pin The PIN for encrypted keys (defaults to DEFAULT_PIN)
   * @returns Decrypted private key in hex format
   * @throws Error if decryption fails or privkey is missing
   */
  async getDecryptedPrivateKey(user: NostrUser, pin: string = this.crypto.DEFAULT_PIN): Promise<string> {
    if (!user.privkey) {
      throw new Error('No private key available for this account');
    }

    // Check if the private key is encrypted
    if (user.isEncrypted) {
      try {
        // Parse the encrypted data
        const encryptedData: EncryptedData = JSON.parse(user.privkey);
        // Decrypt and return
        return await this.crypto.decryptPrivateKey(encryptedData, pin);
      } catch (error) {
        this.logger.error('Failed to decrypt private key', error);
        throw new Error('Failed to decrypt private key. Incorrect PIN or corrupted data.');
      }
    }

    // Legacy plaintext private key - return as-is
    return user.privkey;
  }

  /**
   * Gets the decrypted private key with automatic PIN prompting if needed.
   * This method first tries the default PIN, and if that fails, prompts the user
   * for their custom PIN.
   * 
   * @param user The NostrUser whose private key to decrypt
   * @returns The decrypted private key as hex string, or null if user cancelled
   */
  async getDecryptedPrivateKeyWithPrompt(user: NostrUser): Promise<string | null> {
    if (!user.privkey) {
      throw new Error('No private key available for this account');
    }

    // If not encrypted, return plaintext key
    if (!user.isEncrypted) {
      return user.privkey;
    }

    try {
      // Try with default PIN first (cached PIN would be tried by PinPromptService)
      return await this.getDecryptedPrivateKey(user, this.crypto.DEFAULT_PIN);
    } catch {
      // Default PIN failed, prompt user for their custom PIN
      const pin = await this.pinPrompt.promptForPin();

      if (!pin) {
        // User cancelled
        return null;
      }

      try {
        // Try decryption with user-provided PIN
        return await this.getDecryptedPrivateKey(user, pin);
      } catch {
        // Wrong PIN
        this.logger.error('Incorrect PIN provided by user');
        throw new Error('Incorrect PIN. Please try again.');
      }
    }
  }

  /**
   * Migrates an account from plaintext to encrypted private key
   * Uses the default PIN for initial encryption
   * 
   * @param user The NostrUser to migrate
   * @returns Updated NostrUser with encrypted private key
   */
  async migrateAccountToEncrypted(user: NostrUser): Promise<NostrUser> {
    // Skip if already encrypted or no privkey
    if (user.isEncrypted || !user.privkey || user.source !== 'nsec') {
      return user;
    }

    try {
      this.logger.info('Migrating account to encrypted storage', { pubkey: user.pubkey });

      // Encrypt the private key with default PIN
      const encryptedData = await this.crypto.encryptPrivateKey(user.privkey, this.crypto.DEFAULT_PIN);

      // Update the user object
      const updatedUser: NostrUser = {
        ...user,
        privkey: JSON.stringify(encryptedData),
        isEncrypted: true,
      };

      this.logger.info('Account migration completed', { pubkey: user.pubkey });
      return updatedUser;
    } catch (error) {
      this.logger.error('Failed to migrate account to encrypted storage', error);
      // Return original user on error - don't break existing functionality
      return user;
    }
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

      // MIGRATION: Encrypt any plaintext private keys with default PIN
      let accountsNeedUpdate = false;
      const migratedAccounts = await Promise.all(
        accounts.map(async (account: NostrUser) => {
          const migrated = await this.migrateAccountToEncrypted(account);
          if (migrated !== account) {
            accountsNeedUpdate = true;
          }
          return migrated;
        })
      );

      // Save migrated accounts if any were updated
      if (accountsNeedUpdate) {
        this.logger.info('Saving migrated accounts to storage');
        this.localStorage.setItem(
          this.appState.ACCOUNTS_STORAGE_KEY,
          JSON.stringify(migratedAccounts)
        );
      }

      this.accountState.accounts.set(migratedAccounts);

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

    if (!account) {
      this.appState.isLoading.set(false);
      return;
    }

    try {
      const pubkey = account.pubkey;
      this.logger.info('Account changed, loading data for new account', { pubkey });

      let info: any = await this.storage.getInfo(pubkey, 'user');
      if (!info) {
        info = {};
      }

      // Load cached data from storage immediately for instant display
      this.logger.info('Loading cached account data from storage', { pubkey });

      const storedMetadata = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.Metadata);
      if (storedMetadata) {
        const metadata = this.data.toRecord(storedMetadata);
        this.accountState.addToCache(metadata.event.pubkey, metadata);
        this.accountState.profile.set(metadata);
        // Removed loading message to improve perceived performance
      }

      const storedFollowing = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.Contacts);
      if (storedFollowing) {
        const followingTags = this.getTags(storedFollowing, 'p');
        this.accountState.followingList.set(followingTags);
      }

      const storedMuteList = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.Mutelist);
      if (storedMuteList) {
        this.accountState.muteList.set(storedMuteList);
      }

      // Start live subscription - this will fetch fresh data from relays
      // and keep us updated with any changes in real-time
      await this.subscribeToAccountMetadata(pubkey);

      await this.storage.saveInfo(pubkey, 'user', info);

      if (!this.initialized()) {
        this.initialized.set(true);
      }

      // The subscription will handle setting isLoading to false in its EOSE handler
    } catch (error) {
      this.logger.error('Error during account data loading', error);
      this.appState.isLoading.set(false);
      this.appState.loadingMessage.set('Error loading account data');

      if (!this.initialized()) {
        this.initialized.set(true);
      }
      this.accountState.initialized.set(true);
    }
  }

  reset() {
    this.accountState.accounts.set([]);
    this.accountState.changeAccount(null);
  }

  clear() {
    // Clean up the account subscription if it exists
    if (this.accountSubscription) {
      this.logger.debug('Unsubscribing from account metadata subscription');
      try {
        this.accountSubscription.close();
      } catch (error) {
        this.logger.warn('Error closing account subscription', error);
      }
      this.accountSubscription = null;
    }
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

    // Subscribe to all account metadata kinds for both initial data and real-time updates
    const filter = {
      kinds: [
        kinds.Metadata,      // 0 - profile
        kinds.Contacts,      // 3 - following list
        kinds.Mutelist,      // 10000 - mute list
        10001,               // 10001 - pinned notes
        kinds.RelayList,     // 10002 - relay configuration
        kinds.BookmarkList,  // 10003 - bookmarks
        10063,               // Media server list (BUD-03)
      ],
      authors: [pubkey],
    };

    const onEvent = async (event: Event) => {
      console.log('Received event on account subscription:', event);

      // Save all events to storage
      try {
        await this.storage.saveEvent(event);
        this.logger.debug(`Saved event from account subscription: ${event.id} (kind: ${event.kind})`);
      } catch (error) {
        this.logger.warn(`Failed to save event from account subscription: ${event.id}`, error);
      }

      // Process each event type
      switch (event.kind) {
        case kinds.Metadata: {
          const metadata = this.data.toRecord(event);
          this.accountState.addToCache(metadata.event.pubkey, metadata);
          this.accountState.profile.set(metadata);
          this.logger.info('Updated profile metadata from subscription', { pubkey });
          break;
        }

        case kinds.Contacts: {
          const followingTags = this.getTags(event, 'p');
          this.accountState.followingList.set(followingTags);
          this.logger.info('Updated following list from subscription', {
            pubkey,
            followingCount: followingTags.length,
          });
          break;
        }

        case kinds.Mutelist: {
          this.accountState.muteList.set(event);
          this.logger.info('Updated mute list from subscription', {
            pubkey,
            mutedCount: event.tags.filter(t => t[0] === 'p').length,
          });
          break;
        }

        case kinds.RelayList: {
          this.logger.info('Updated relay list from subscription', {
            pubkey,
            relayCount: event.tags.filter(t => t[0] === 'r').length,
          });
          break;
        }

        case kinds.BookmarkList: {
          this.logger.info('Updated bookmark list from subscription', {
            pubkey,
            bookmarkCount: event.tags.length,
          });
          break;
        }

        case 10063: {
          this.logger.info('Updated media server list from subscription', {
            pubkey,
            serverCount: event.tags.filter(t => t[0] === 'server').length,
          });
          break;
        }
      }
    };

    const onEose = () => {
      console.log('EOSE on account subscription - initial data loaded');
      this.logger.info('Account subscription EOSE - fresh data loaded from relays');

      // Mark as initialized without showing loading overlay
      this.appState.isLoading.set(false);
      this.accountState.initialized.set(true);
    };

    this.accountSubscription = this.accountRelay.subscribe(filter, onEvent, onEose);
  }

  private async loadAccountFollowing(pubkey: string) {
    // CRITICAL: Always fetch from relay first to get the latest following list
    // This prevents overwriting changes made in other Nostria instances
    let followingEvent = await this.accountRelay.getEventByPubkeyAndKind(pubkey, kinds.Contacts);

    if (followingEvent) {
      // Save the latest event to storage
      await this.storage.saveEvent(followingEvent);
      this.logger.info('Loaded fresh following list from relay', {
        pubkey,
        followingCount: followingEvent.tags.filter(t => t[0] === 'p').length,
      });
    } else {
      // Fallback to storage only if relay fetch completely fails
      this.logger.warn('Could not fetch following list from relay, falling back to storage');
      followingEvent = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.Contacts);
    }

    if (followingEvent) {
      const followingTags = this.getTags(followingEvent, 'p');
      this.accountState.followingList.set(followingTags);
    }
  }

  private async loadAccountMuteList(pubkey: string) {
    // CRITICAL: Always fetch from relay first to get the latest mute list
    // This prevents overwriting changes made in other Nostria instances
    let muteListEvent = await this.accountRelay.getEventByPubkeyAndKind(pubkey, kinds.Mutelist);

    if (muteListEvent) {
      // Save the latest event to storage
      await this.storage.saveEvent(muteListEvent);
      this.logger.info('Loaded fresh mute list from relay', {
        pubkey,
        mutedCount: muteListEvent.tags.filter(t => t[0] === 'p').length,
      });
    } else {
      // Fallback to storage only if relay fetch completely fails
      this.logger.warn('Could not fetch mute list from relay, falling back to storage');
      muteListEvent = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.Mutelist);
    }

    if (muteListEvent) {
      this.accountState.muteList.set(muteListEvent);
    }
  }

  async signEvent(event: EventTemplate | UnsignedEvent) {
    return this.sign(event);
  }

  private async sign(event: EventTemplate | Event | UnsignedEvent): Promise<Event> {
    const currentUser = this.accountState.account();

    if (!currentUser) {
      throw new Error('No user account found. Please log in or create an account first.');
    }

    let signedEvent: Event | EventTemplate | null = null;

    // Get the pubkey - either from the event if it's an Event, or use current user's
    const eventPubkey = ('pubkey' in event) ? event.pubkey : currentUser.pubkey;

    switch (currentUser?.source) {
      case 'extension': {
        if (!window.nostr) {
          throw new Error(
            'Nostr extension not found. Please install Alby, nos2x, or another NIP-07 compatible extension.'
          );
        }

        // Open signing dialog
        const dialogRef = this.dialog.open(SigningDialogComponent, {
          disableClose: true,
          hasBackdrop: true,
          panelClass: 'signing-dialog',
          backdropClass: 'signing-dialog-backdrop',
        });

        try {
          // Create EventTemplate WITHOUT pubkey for NIP-07 extensions
          // Extensions will add the pubkey themselves
          // Preserve created_at if already set (important for PoW)
          // For PoW events, we need to include the pre-calculated ID
          const eventTemplate: any = {
            kind: event.kind,
            created_at: event.created_at ?? this.currentDate(),
            tags: event.tags,
            content: event.content,
          };

          // If this is a mined PoW event (has nonce tag and pubkey), include the ID
          const hasNonceTag = event.tags.some(tag => tag[0] === 'nonce');
          if (hasNonceTag && 'pubkey' in event) {
            // Calculate and include the event ID for PoW events
            const { getEventHash } = await import('nostr-tools');
            eventTemplate.id = getEventHash(event as UnsignedEvent);
            eventTemplate.pubkey = (event as UnsignedEvent).pubkey;
          }

          // Pass event template to extension
          const extensionResult = await window.nostr.signEvent(eventTemplate);
          signedEvent = extensionResult as Event;
        } finally {
          // Always close the dialog when signing completes (success or error)
          dialogRef.close();
        }

        break;
      }
      case 'remote': {
        // For remote signing, we need to include pubkey
        // Preserve created_at if already set (important for PoW)
        const cleanEvent: UnsignedEvent = {
          kind: event.kind,
          created_at: event.created_at ?? this.currentDate(),
          tags: event.tags,
          content: event.content,
          pubkey: eventPubkey,
        };

        // Get the decrypted private key
        const decryptedPrivkey = await this.getDecryptedPrivateKey(currentUser);

        const pool = new SimplePool();
        const bunker = BunkerSigner.fromBunker(
          hexToBytes(decryptedPrivkey),
          this.accountState.account()!.bunker!,
          { pool }
        );
        signedEvent = await bunker.signEvent(cleanEvent);
        this.logger.info('Using remote signer account');
        break;
      }
      case 'preview':
        throw new Error(
          'Preview accounts cannot sign events. Please use a different account type.'
        );
        break;
      case 'nsec': {
        // For nsec signing, we need to include pubkey
        // Preserve created_at if already set (important for PoW)
        const cleanEvent: UnsignedEvent = {
          kind: event.kind,
          created_at: event.created_at ?? this.currentDate(),
          tags: event.tags,
          content: event.content,
          pubkey: eventPubkey,
        };

        // Get the decrypted private key (will prompt for PIN if needed)
        const decryptedPrivkey = await this.getDecryptedPrivateKeyWithPrompt(currentUser);

        if (!decryptedPrivkey) {
          throw new Error('Failed to unlock private key. PIN required.');
        }

        signedEvent = finalizeEvent(cleanEvent, hexToBytes(decryptedPrivkey));
        break;
      }
    }

    return signedEvent as Event;
  }

  async signAndPublish(event: UnsignedEvent): Promise<{ success: boolean; event?: Event }> {
    if (!event) {
      throw new Error('Event parameter must not be null or undefined.');
    }

    try {
      const signedEvent = await this.signEvent(event);

      // IMPORTANT: ALL events must go to ALL configured relays to prevent data fragmentation
      // For replies, reactions, and reposts, we also publish to mentioned users' relays
      const options = signedEvent.kind === kinds.Contacts
        ? { notifyFollowed: true, useOptimizedRelays: false } // For follows, notify all
        : { notifyMentioned: true, useOptimizedRelays: false }; // For all other events, notify mentioned users

      const result = await this.publishService.publish(signedEvent, options);

      return { success: result.success, event: signedEvent };
    } catch (error) {
      this.logger.error('[NostrService] Error in signAndPublish', error);
      return { success: false };
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
    // Media server list (kind 10063) is already fetched in the consolidated account query
    // in the load() method, so we just retrieve from storage
    const event = await this.storage.getEventByPubkeyAndKind(pubkey, 10063);

    if (!event) {
      this.logger.warn('No media server list found in storage for pubkey:', pubkey);
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

    // Store the hex string representation of the private key
    const privkeyHex = bytesToHex(secretKey);

    // Encrypt the private key with default PIN
    const encryptedData = await this.crypto.encryptPrivateKey(privkeyHex, this.crypto.DEFAULT_PIN);

    const newUser: NostrUser = {
      pubkey,
      privkey: JSON.stringify(encryptedData),
      source: 'nsec',
      lastUsed: Date.now(),
      region: region,
      hasActivated: false,
      isEncrypted: true,
    };

    this.logger.debug('New keypair generated successfully (encrypted)', { pubkey, region });

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

  async setupNewAccountWithDefaults(user: NostrUser, region?: string): Promise<void> {
    this.logger.info('Setting up new account with default configuration', {
      pubkey: user.pubkey,
      region,
    });

    // If region is not provided, try to get it from the user or use a default
    const accountRegion = region || user.region || 'us';

    // Configure the discovery relay based on the user's region
    const discoveryRelay = this.region.getDiscoveryRelay(accountRegion);
    this.logger.info('Setting discovery relay for new user based on region', {
      region: accountRegion,
      discoveryRelay,
    });
    this.discoveryRelay.setDiscoveryRelays([discoveryRelay]);

    const relayServerUrl = this.region.getRelayServer(accountRegion, 0);
    const relayTags = this.createTags('r', [relayServerUrl!]);

    // Initialize the account relay so we can start using it
    this.accountRelay.init([relayServerUrl!]);

    // Create and publish Relay List event
    const relayListEvent: UnsignedEvent = {
      pubkey: user.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: kinds.RelayList,
      tags: relayTags,
      content: '',
    };

    // Use the existing sign method which handles all account types properly
    const signedRelayEvent = await this.signEvent(relayListEvent);

    await this.storage.saveEvent(signedRelayEvent);
    await this.accountRelay.publish(signedRelayEvent);
    await this.discoveryRelay.publish(signedRelayEvent);

    // Create and publish Media Server event
    const mediaServerUrl = this.region.getMediaServer(accountRegion, 0);
    const mediaTags = this.createTags('server', [mediaServerUrl!]);

    const mediaServerEvent: UnsignedEvent = {
      pubkey: user.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: MEDIA_SERVERS_EVENT_KIND,
      tags: mediaTags,
      content: '',
    };

    const signedMediaEvent = await this.signEvent(mediaServerEvent);

    await this.storage.saveEvent(signedMediaEvent);
    await this.accountRelay.publish(signedMediaEvent);

    // Create and publish DM Relay List event
    const relayDMTags = this.createTags('relay', [relayServerUrl!]);

    const relayDMListEvent: UnsignedEvent = {
      pubkey: user.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: kinds.DirectMessageRelaysList,
      tags: relayDMTags,
      content: '',
    };

    const signedDMEvent = await this.signEvent(relayDMListEvent);

    await this.storage.saveEvent(signedDMEvent);
    await this.accountRelay.publish(signedDMEvent);

    // Update the user to mark as activated
    user.hasActivated = true;
    user.region = accountRegion;

    this.logger.info('New account setup completed successfully', {
      pubkey: user.pubkey,
    });
  }

  /**
   * Check if the user has any relay configuration discovered
   * Returns true if relays were found, false otherwise
   */
  async hasRelayConfiguration(pubkey: string): Promise<boolean> {
    this.logger.debug('Checking relay configuration for user', { pubkey });

    // First check local storage
    const relayListEvent = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.RelayList);
    if (relayListEvent) {
      const relayUrls = this.utilities.getRelayUrls(relayListEvent);
      if (relayUrls.length > 0) {
        this.logger.debug('Found relay list in storage', {
          pubkey,
          relayCount: relayUrls.length,
        });
        return true;
      }
    }

    // Check contacts event (kind 3) in storage
    const contactsEvent = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.Contacts);
    if (contactsEvent) {
      const relayUrls = this.utilities.getRelayUrlsFromFollowing(contactsEvent);
      if (relayUrls.length > 0) {
        this.logger.debug('Found relays in contacts event in storage', {
          pubkey,
          relayCount: relayUrls.length,
        });
        return true;
      }
    }

    // Try to discover relays from discovery relays
    try {
      const discoveredRelays = await this.discoveryRelay.getUserRelayUrls(pubkey);
      if (discoveredRelays.length > 0) {
        this.logger.debug('Found relays via discovery', {
          pubkey,
          relayCount: discoveredRelays.length,
        });
        return true;
      }
    } catch (error) {
      this.logger.warn('Failed to discover relays from discovery relay', error);
    }

    this.logger.info('No relay configuration found for user', { pubkey });
    return false;
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

      // Encrypt the private key with default PIN
      const encryptedData = await this.crypto.encryptPrivateKey(privkeyHex, this.crypto.DEFAULT_PIN);

      // Store the user info
      const newUser: NostrUser = {
        pubkey,
        privkey: JSON.stringify(encryptedData),
        source: 'nsec',
        lastUsed: Date.now(),
        hasActivated: true, // Assume activation is done via nsec
        isEncrypted: true,
      };

      this.logger.info('Login with nsec successful (encrypted)', { pubkey });
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
    // Clear cached PIN for security
    this.pinPrompt.clearCache();
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
