import { Injectable, signal, effect, inject, NgZone, Injector, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  Event,
  EventTemplate,
  generateSecretKey,
  getPublicKey,
  UnsignedEvent,
  getEventHash,
} from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { nip19, nip98, nip04, nip44 } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { NostrEventData, UserMetadata } from './database.service';
import { DatabaseService } from './database.service';
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
import { DiscoveryRelayService, DiscoveryRelayListKind } from './relays/discovery-relay';
import { LocalSettingsService } from './local-settings.service';
import { PublishService } from './publish.service';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { SigningDialogComponent } from '../components/signing-dialog/signing-dialog.component';
import { ExternalSignerDialogComponent } from '../components/external-signer-dialog/external-signer-dialog.component';
import { CryptoEncryptionService, EncryptedData } from './crypto-encryption.service';
import { PinPromptService } from './pin-prompt.service';
import { MnemonicService } from './mnemonic.service';
import { RelayAuthService } from './relays/relay-auth.service';
import { RelayWebSocketService } from './relays/relay-websocket.service';
import { AccountLocalStateService } from './account-local-state.service';
import { FollowSetsService } from './follow-sets.service';
import { TrustProviderService, TRUST_PROVIDER_LIST_KIND } from './trust-provider.service';

export interface NostrUser {
  pubkey: string;
  /** 
   * Private key storage - can be either:
   * - Plain hex string (legacy, backwards compatible)
   * - JSON string of EncryptedData (encrypted with PIN)
   */
  privkey?: string;
  /** 
   * Mnemonic phrase storage (BIP39)
   * - JSON string of EncryptedData (encrypted with PIN)
   * - Only present for accounts created with mnemonic support (NIP-06)
   */
  mnemonic?: string;
  name?: string;
  source: 'extension' | 'nsec' | 'preview' | 'remote' | 'external';
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

  /** 
   * Indicates if the mnemonic is encrypted with a PIN
   * If true, mnemonic contains JSON-stringified EncryptedData
   */
  isMnemonicEncrypted?: boolean;

  /**
   * Preferred signing method when both local key and remote signer are available
   * - 'local': Use local private key for signing
   * - 'remote': Use remote signer (bunker) for signing
   * Defaults to 'local' if not specified
   */
  preferredSigningMethod?: 'local' | 'remote';

  /**
   * Client secret key (hex) for NIP-46 bunker communication
   * This is the client's key used to communicate with the remote signer
   * Required for pure remote signer accounts (source='remote')
   */
  bunkerClientKey?: string;
}

export interface UserMetadataWithPubkey extends NostrEventData<UserMetadata> {
  pubkey: string;
}

@Injectable({
  providedIn: 'root',
})
export class NostrService implements NostriaService {
  private readonly logger = inject(LoggerService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private readonly discoveryRelay = inject(DiscoveryRelayService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly sharedRelay = inject(SharedRelayService);

  private readonly database = inject(DatabaseService);
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
  private readonly mnemonicService = inject(MnemonicService);
  private readonly relayAuth = inject(RelayAuthService);
  private readonly relayWebSocket = inject(RelayWebSocketService);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly followSetsService = inject(FollowSetsService);
  private readonly ngZone = inject(NgZone);
  private readonly injector = inject(Injector);
  private encryptionServiceInstance?: import('./encryption.service').EncryptionService;

  initialized = signal(false);
  private accountsInitialized = false;
  MAX_WAIT_TIME = 2000;
  MAX_WAIT_TIME_METADATA = 2500;
  dataLoaded = false;

  // Extension signing queue to prevent concurrent signing dialogs
  private extensionSigningQueue: {
    event: EventTemplate | Event | UnsignedEvent;
    resolve: (event: Event) => void;
    reject: (error: Error) => void;
  }[] = [];
  private isExtensionSigning = false;
  private currentSigningDialogRef: MatDialogRef<SigningDialogComponent> | null = null;

  // Default relays for new user accounts
  private readonly DEFAULT_RELAYS = [
    'wss://relay.damus.io/',
    'wss://nos.lol/',
    'wss://relay.primal.net/',
  ];
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

    if (!this.isBrowser) {
      this.initialized.set(true);
      this.accountsInitialized = true;
      this.logger.debug('[NostrService] SSR context detected, skipping browser-only initialization');
      return;
    }

    // Set the signing function in AccountStateService to avoid circular dependency
    this.accountState.setSignFunction((event: UnsignedEvent) => this.sign(event));

    // Set the signing function for FollowSetsService to avoid circular dependency
    try {
      this.followSetsService.setSignFunction((event: UnsignedEvent) => this.sign(event));
    } catch (error) {
      this.logger.error('Failed to set signing function for FollowSetsService:', error);
    }

    // Set the signing function for NIP-42 relay authentication
    this.relayAuth.setSignFunction((event: EventTemplate) => this.signEvent(event));

    // Ensure nostr-tools uses our relay-aware WebSocket implementation
    this.relayWebSocket.initialize();

    // DEPRECATED: Old signal-based publishing removed
    // The accountState.publish signal has been replaced with direct publishEvent() calls
    // This eliminates circular dependencies and simplifies the publishing flow

    effect(async () => {
      if (this.database.initialized()) {
        this.logger.info('Storage initialized, loading Nostr Service');
        try {
          await this.initialize();
          // Load relay authentication state from storage
          await this.relayAuth.loadAuthStateFromStorage();
        } catch (err) {
          this.logger.error('[NostrService] Initialization failed in effect, setting initialized to unblock UI', err);
          if (!this.initialized()) {
            this.initialized.set(true);
          }
        }
      }
    });

    // Save all users to localStorage whenever they change
    effect(() => {
      const allUsers = this.accountState.accounts();

      this.logger.debug('Users collection effect triggered', {
        count: allUsers.length,
        initialized: this.accountsInitialized,
      });

      // Don't auto-save during initialization to avoid wiping accounts
      if (!this.accountsInitialized) {
        this.logger.debug('Skipping auto-save during initialization');
        return;
      }

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
    // Safety timeout: ensure initialized is set even if something hangs
    const safetyTimeout = setTimeout(() => {
      if (!this.initialized()) {
        this.logger.warn('[NostrService] Safety timeout (15s) reached during initialization, forcing initialized=true');
        this.initialized.set(true);
        this.accountsInitialized = true;
      }
    }, 15000);

    try {
      const startTime = Date.now();
      const accounts = await this.getAccountsFromStorage();

      if (accounts.length === 0) {
        // Show success animation instead of waiting
        this.appState.showSuccess.set(false);
        this.initialized.set(true);
        // Mark accounts as initialized even when empty to enable auto-save
        this.accountsInitialized = true;
        clearTimeout(safetyTimeout);
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

      // Mark accounts as initialized to enable auto-save
      this.accountsInitialized = true;

      // OPTIMIZATION: Get the current account EARLY and trigger the account change
      // This allows other services to start loading cached data immediately
      // Metadata/relay fetching will happen in the background
      const account = this.getAccountFromStorage();

      // Load cached metadata from database FIRST (fast, synchronous to database)
      // This provides immediate profile data without waiting for network
      const pubkeys = migratedAccounts.map(user => user.pubkey);
      const cachedMetadata = await this.database.getEventsByPubkeyAndKind(pubkeys, kinds.Metadata);
      const cachedRelays = await this.database.getEventsByPubkeyAndKind(pubkeys, kinds.RelayList);

      // Set cached data immediately
      const accountsMetadataRecords = this.data.toRecords(cachedMetadata);
      for (const metadata of accountsMetadataRecords) {
        this.accountState.addToAccounts(metadata.event.pubkey, metadata);
        this.accountState.addToCache(metadata.event.pubkey, metadata);
      }
      this.accountsRelays.set(cachedRelays);

      this.logger.info(`[NostrService] Loaded cached account data in ${Date.now() - startTime}ms`);

      // If no account, finish the loading.
      if (!account) {
        // Show success animation instead of waiting
        this.appState.showSuccess.set(false);
        this.initialized.set(true);
      } else {
        // TRIGGER ACCOUNT CHANGE NOW - don't wait for network fetches
        await this.accountState.changeAccount(account);
      }

      // BACKGROUND: Fetch any missing metadata/relay lists from discovery relays
      // This runs after the account is set, so the UI can start immediately
      this.fetchMissingAccountDataInBackground(pubkeys, cachedMetadata, cachedRelays);

      clearTimeout(safetyTimeout);
    } catch (err) {
      clearTimeout(safetyTimeout);
      this.logger.error('Failed to load data during initialization', err);
      // Ensure initialized is set even on error to unblock the UI
      if (!this.initialized()) {
        this.initialized.set(true);
      }
      this.accountsInitialized = true;
    }
  }

  /**
   * Fetch missing account metadata and relay lists from discovery relays in the background.
   * This doesn't block initialization - the UI can show cached data while this runs.
   */
  private async fetchMissingAccountDataInBackground(
    pubkeys: string[],
    cachedMetadata: Event[],
    cachedRelays: Event[]
  ): Promise<void> {
    const startTime = Date.now();

    // Find pubkeys without cached metadata
    const metadataFoundPubkeys = new Set(cachedMetadata.map(e => e.pubkey));
    const missingMetadataPubkeys = pubkeys.filter(pk => !metadataFoundPubkeys.has(pk));

    // Find pubkeys without cached relay lists
    const relaysFoundPubkeys = new Set(cachedRelays.map(e => e.pubkey));
    const missingRelaysPubkeys = pubkeys.filter(pk => !relaysFoundPubkeys.has(pk));

    // Only fetch if there's missing data
    if (missingMetadataPubkeys.length === 0 && missingRelaysPubkeys.length === 0) {
      this.logger.debug('[NostrService] All account data cached, no background fetch needed');
      return;
    }

    this.logger.info(`[NostrService] Background fetch: ${missingMetadataPubkeys.length} missing profiles, ${missingRelaysPubkeys.length} missing relay lists`);

    // Ensure discovery relay is initialized
    await this.discoveryRelay.load();

    const fetchPromises: Promise<void>[] = [];

    // Fetch missing metadata
    if (missingMetadataPubkeys.length > 0) {
      fetchPromises.push((async () => {
        try {
          const fetchedMetadata = await this.discoveryRelay.getEventsByPubkeyAndKind(missingMetadataPubkeys, kinds.Metadata);
          if (fetchedMetadata.length > 0) {
            this.logger.info(`[NostrService] Fetched ${fetchedMetadata.length} profiles from discovery relays`);
            const records = this.data.toRecords(fetchedMetadata);
            for (const metadata of records) {
              this.accountState.addToAccounts(metadata.event.pubkey, metadata);
              this.accountState.addToCache(metadata.event.pubkey, metadata);
              await this.database.saveEvent(metadata.event);
            }
          }
        } catch (error) {
          this.logger.warn('[NostrService] Failed to fetch profiles in background:', error);
        }
      })());
    }

    // Fetch missing relay lists
    if (missingRelaysPubkeys.length > 0) {
      fetchPromises.push((async () => {
        try {
          const fetchedRelays = await this.discoveryRelay.getEventsByPubkeyAndKind(missingRelaysPubkeys, kinds.RelayList);
          if (fetchedRelays.length > 0) {
            this.logger.info(`[NostrService] Fetched ${fetchedRelays.length} relay lists from discovery relays`);
            const currentRelays = this.accountsRelays();
            this.accountsRelays.set([...currentRelays, ...fetchedRelays]);
            for (const relayList of fetchedRelays) {
              await this.database.saveEvent(relayList);
            }
          }
        } catch (error) {
          this.logger.warn('[NostrService] Failed to fetch relay lists in background:', error);
        }
      })());
    }

    await Promise.all(fetchPromises);
    this.logger.info(`[NostrService] Background fetch completed in ${Date.now() - startTime}ms`);
  }

  /**
   * Load cached account data from storage immediately.
   * This is fast (database only) and should run early in the startup sequence
   * to make cached following list, profile, etc. available immediately.
   *
   * Call loadFromRelays() separately after relay setup is complete.
   */
  async loadCachedData() {
    const account = this.accountState.account();

    if (!account) {
      return;
    }

    try {
      const pubkey = account.pubkey;
      this.logger.info('[NostrService] Loading cached account data from storage', { pubkey });

      let info: any = await this.database.getInfo(pubkey, 'user');
      if (!info) {
        info = {};
      }

      const storedMetadata = await this.database.getEventByPubkeyAndKind(pubkey, kinds.Metadata);
      if (storedMetadata) {
        const metadata = this.data.toRecord(storedMetadata);

        // Check if this is newer than current profile before updating
        const currentProfile = this.accountState.profile();
        const shouldUpdate = !currentProfile ||
          (storedMetadata.created_at > (currentProfile.event.created_at || 0));

        if (shouldUpdate) {
          this.accountState.addToCache(metadata.event.pubkey, metadata);
          this.accountState.profile.set(metadata);
        }
      }

      const storedFollowing = await this.database.getEventByPubkeyAndKind(pubkey, kinds.Contacts);
      if (storedFollowing) {
        const followingTags = this.getTags(storedFollowing, 'p');
        this.accountState.followingList.set(followingTags);
        this.accountState.followingListLoaded.set(true);
        this.logger.info(`[NostrService] Loaded ${followingTags.length} following from cache`);
      }
      // Note: If no stored following found, we wait for background relay fetch before marking as loaded

      const storedMuteList = await this.database.getEventByPubkeyAndKind(pubkey, kinds.Mutelist);
      if (storedMuteList) {
        this.accountState.muteList.set(storedMuteList);
      }

      // Mark as initialized immediately after loading cached data
      // This allows the UI to render with cached data while relay sync happens in background
      if (!this.initialized()) {
        this.logger.info('[NostrService] Setting initialized=true after loading cached data');
        this.initialized.set(true);
      }

      await this.database.saveInfo(pubkey, 'user', info);
    } catch (error) {
      this.logger.error('[NostrService] Error loading cached data', error);

      if (!this.initialized()) {
        this.initialized.set(true);
      }
      this.accountState.initialized.set(true);
    }
  }

  /**
   * Start relay subscriptions and fetch fresh data from relays.
   * This requires accountRelay to be initialized first.
   * Should be called after relay setup is complete.
   */
  async loadFromRelays() {
    const account = this.accountState.account();

    if (!account) {
      return;
    }

    try {
      const pubkey = account.pubkey;
      this.logger.info('[NostrService] Starting relay subscriptions for account', { pubkey });

      // Start live subscription - this will fetch fresh data from relays
      // and keep us updated with any changes in real-time (runs in background)
      this.subscribeToAccountMetadata(pubkey);

      // Actively fetch fresh data from relays to ensure we have the latest
      // This is important for syncing data across multiple devices
      // Note: These run in background - UI is already showing with cached data
      this.loadAccountFollowing(pubkey);
      this.loadAccountMuteList(pubkey);

      // The subscription will handle setting loading state in its EOSE handler
    } catch (error) {
      this.logger.error('[NostrService] Error starting relay subscriptions', error);
    }
  }

  /**
   * Load all account data - both cached and from relays.
   * This is the original load() method for backwards compatibility.
   */
  async load() {
    await this.loadCachedData();
    await this.loadFromRelays();
  }

  async reset() {
    this.accountState.accounts.set([]);
    await this.accountState.changeAccount(null);
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
        10007,               // Search relay list
        TRUST_PROVIDER_LIST_KIND, // 10040 - NIP-85 Trusted Service Providers
        kinds.DirectMessageRelaysList, // 10050 - DM relays
        10063,               // Media server list (BUD-03)
        DiscoveryRelayListKind, // 10086 - Discovery relay list
      ],
      authors: [pubkey],
    };

    const onEvent = async (event: Event) => {
      this.logger.debug('Received event on account subscription:', event);

      // Save all events to storage using new DatabaseService
      try {
        await this.database.init();
        await this.database.saveEvent(event);
        this.logger.debug(`Saved event from account subscription: ${event.id} (kind: ${event.kind})`);
      } catch (error) {
        this.logger.warn(`Failed to save event from account subscription: ${event.id}`, error);
      }

      // Process each event type
      switch (event.kind) {
        case kinds.Metadata: {
          const metadata = this.data.toRecord(event);

          // Check if this is a newer version before updating
          const currentProfile = this.accountState.profile();
          const shouldUpdate = !currentProfile ||
            (event.created_at > (currentProfile.event.created_at || 0));

          if (shouldUpdate) {
            this.accountState.addToCache(metadata.event.pubkey, metadata);
            this.accountState.profile.set(metadata);
            this.logger.info('Updated profile metadata from subscription', {
              pubkey,
              timestamp: event.created_at,
              wasNewer: true
            });
          } else {
            this.logger.info('Skipped older profile metadata from subscription', {
              pubkey,
              receivedTimestamp: event.created_at,
              currentTimestamp: currentProfile.event.created_at,
            });
          }
          break;
        }

        case kinds.Contacts: {
          // Use parseFollowingList to only update if the list has actually changed
          await this.accountState.parseFollowingList(event);
          this.logger.info('Processed following list from subscription', {
            pubkey,
            eventTimestamp: event.created_at,
          });
          break;
        }

        case kinds.Mutelist: {
          // Only update if this is a newer mute list event to avoid duplicate signal updates
          const currentMuteList = this.accountState.muteList();
          if (!currentMuteList || event.created_at >= currentMuteList.created_at) {
            if (!currentMuteList || event.id !== currentMuteList.id) {
              this.accountState.muteList.set(event);
              this.logger.info('Updated mute list from subscription', {
                pubkey,
                mutedCount: event.tags.filter(t => t[0] === 'p').length,
              });
            }
          } else {
            this.logger.debug('Skipped older mute list from subscription', {
              receivedTimestamp: event.created_at,
              currentTimestamp: currentMuteList.created_at,
            });
          }
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

        case 10007: {
          this.logger.info('Updated search relay list from subscription', {
            pubkey,
            searchRelayCount: event.tags.filter(t => t[0] === 'relay').length,
          });
          break;
        }

        case kinds.DirectMessageRelaysList: {
          this.logger.info('Updated DM relay list from subscription', {
            pubkey,
            dmRelayCount: event.tags.filter(t => t[0] === 'relay').length,
          });
          break;
        }

        case TRUST_PROVIDER_LIST_KIND: {
          // Load NIP-85 trusted service provider declarations
          const trustProviderService = this.injector.get(TrustProviderService);
          trustProviderService.loadFromEvent(event);
          this.logger.info('Updated trust provider list from subscription', {
            pubkey,
            providerCount: event.tags.length,
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

        case DiscoveryRelayListKind: {
          // Load discovery relays from the event and update local storage
          const discoveryRelayUrls = event.tags
            .filter(t => t[0] === 'relay' && t[1])
            .map(t => t[1]);

          if (discoveryRelayUrls.length > 0) {
            this.discoveryRelay.setDiscoveryRelays(discoveryRelayUrls);
          }

          this.logger.info('Updated discovery relay list from subscription', {
            pubkey,
            discoveryRelayCount: discoveryRelayUrls.length,
          });
          break;
        }
      }
    };

    const onEose = () => {
      this.logger.debug('EOSE on account subscription - initial data loaded');
      this.logger.info('Account subscription EOSE - fresh data loaded from relays');

      // Mark as initialized without showing loading overlay
      this.accountState.initialized.set(true);
    };

    this.accountSubscription = this.accountRelay.subscribe(filter, onEvent, onEose);
  }

  private async loadAccountFollowing(pubkey: string) {
    // CRITICAL: Always fetch from relay first to get the latest following list
    // This prevents overwriting changes made in other Nostria instances
    const followingEvent = await this.accountRelay.getEventByPubkeyAndKind(pubkey, kinds.Contacts);
    const storedEvent = await this.database.getEventByPubkeyAndKind(pubkey, kinds.Contacts);

    // Use the newer event (compare timestamps)
    let newestEvent = followingEvent;
    if (storedEvent && (!followingEvent || storedEvent.created_at > followingEvent.created_at)) {
      newestEvent = storedEvent;
    }

    if (followingEvent && (!storedEvent || followingEvent.created_at >= storedEvent.created_at)) {
      // Save the relay event to storage only if it's newer or equal
      await this.database.saveEvent(followingEvent);
      this.logger.info('Loaded fresh following list from relay', {
        pubkey,
        followingCount: followingEvent.tags.filter(t => t[0] === 'p').length,
      });
    } else if (!followingEvent && storedEvent) {
      this.logger.warn('Could not fetch following list from relay, using stored data');
    }

    if (newestEvent) {
      const followingTags = this.getTags(newestEvent, 'p');
      this.accountState.followingList.set(followingTags);
    }

    // Mark following list as loaded regardless of whether data was found
    // This allows UI to distinguish between "still loading" and "loaded but empty"
    this.accountState.followingListLoaded.set(true);
  }

  private async loadAccountMuteList(pubkey: string) {
    // CRITICAL: Always fetch from relay first to get the latest mute list
    // This prevents overwriting changes made in other Nostria instances
    const muteListEvent = await this.accountRelay.getEventByPubkeyAndKind(pubkey, kinds.Mutelist);
    const storedEvent = await this.database.getEventByPubkeyAndKind(pubkey, kinds.Mutelist);

    // Use the newer event (compare timestamps)
    let newestEvent = muteListEvent;
    if (storedEvent && (!muteListEvent || storedEvent.created_at > muteListEvent.created_at)) {
      newestEvent = storedEvent;
    }

    if (muteListEvent && (!storedEvent || muteListEvent.created_at >= storedEvent.created_at)) {
      // Save the relay event to storage only if it's newer or equal
      await this.database.saveEvent(muteListEvent);
      this.logger.info('Loaded fresh mute list from relay', {
        pubkey,
        mutedCount: muteListEvent.tags.filter(t => t[0] === 'p').length,
      });
    } else if (!muteListEvent && storedEvent) {
      this.logger.warn('Could not fetch mute list from relay, using stored data');
    }

    if (newestEvent) {
      // Only update if different from current to avoid redundant signal updates
      const currentMuteList = this.accountState.muteList();
      if (!currentMuteList || currentMuteList.id !== newestEvent.id) {
        this.accountState.muteList.set(newestEvent);
      }
    }
  }

  /**
   * Queue extension signing requests to prevent concurrent signing dialogs.
   * This serializes signing operations so only one dialog is shown at a time.
   */
  private queueExtensionSigning(event: EventTemplate | Event | UnsignedEvent): Promise<Event> {
    return new Promise((resolve, reject) => {
      this.extensionSigningQueue.push({ event, resolve, reject });
      this.logger.debug(`[Extension Signing] Queued signing request, queue length: ${this.extensionSigningQueue.length}`);

      // Start processing if not already processing
      if (!this.isExtensionSigning) {
        this.processExtensionSigningQueue();
      }
    });
  }

  /**
   * Process the extension signing queue one request at a time.
   * Shows only one signing dialog at a time to prevent multiple concurrent dialogs.
   */
  private async processExtensionSigningQueue(): Promise<void> {
    if (this.isExtensionSigning || this.extensionSigningQueue.length === 0) {
      return;
    }

    this.isExtensionSigning = true;

    while (this.extensionSigningQueue.length > 0) {
      const request = this.extensionSigningQueue.shift()!;

      try {
        this.logger.debug('[Extension Signing] Processing queue item, calling performExtensionSigning');
        const signedEvent = await this.performExtensionSigning(request.event);
        this.logger.debug('[Extension Signing] performExtensionSigning returned', { eventId: signedEvent?.id });
        request.resolve(signedEvent);
        this.logger.debug('[Extension Signing] Request resolved successfully');
      } catch (error) {
        this.logger.error('[Extension Signing] Error during signing', error);
        request.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }

    this.isExtensionSigning = false;
  }

  /**
   * Perform the actual extension signing with dialog management.
   */
  private async performExtensionSigning(event: EventTemplate | Event | UnsignedEvent): Promise<Event> {
    // Wait for window.nostr to be available (extensions inject it asynchronously)
    if (!window.nostr) {
      await this.utilities.waitForNostrExtension();
    }

    if (!window.nostr) {
      throw new Error(
        'Nostr extension not found. Please install Alby, nos2x, or another NIP-07 compatible extension, or re-login with your nsec key.'
      );
    }

    // Close any existing signing dialog (shouldn't happen, but safety check)
    if (this.currentSigningDialogRef) {
      this.logger.warn('[Extension Signing] Closing stale signing dialog');
      this.currentSigningDialogRef.close();
      this.currentSigningDialogRef = null;
    }

    // Open signing dialog
    this.currentSigningDialogRef = this.dialog.open(SigningDialogComponent, {
      disableClose: false, // Allow user to close the dialog to cancel
      hasBackdrop: true,
      panelClass: 'signing-dialog',
      backdropClass: 'signing-dialog-backdrop',
    });

    // Capture a local reference so the afterClosed handler can verify it's still the
    // active dialog.  Without this, a previous dialog's afterClosed (which fires
    // asynchronously after dialog.close()) could null-out currentSigningDialogRef that
    // already points to a *new* dialog, causing the new dialog to never be closed.
    const localDialogRef = this.currentSigningDialogRef;

    // Create a promise that rejects if the user closes the dialog
    const dialogClosedPromise = new Promise<never>((_, reject) => {
      localDialogRef.afterClosed().subscribe(() => {
        // Only reject if THIS dialog is still the active one and was closed by user
        // action, not by our code. We set currentSigningDialogRef to null before
        // closing programmatically, so if it still matches, the user dismissed it.
        if (this.currentSigningDialogRef === localDialogRef) {
          this.currentSigningDialogRef = null;
          reject(new Error('Signing cancelled by user'));
        }
      });
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

      // Pass event template to extension, race against dialog close.
      // IMPORTANT: window.nostr.signEvent() resolves outside Angular's zone (it's a browser
      // extension API). We must bring the resolution back into the zone so that the dialog
      // close triggers change detection and the UI actually updates. Without this, the dialog
      // can visually "hang" even though signing completed successfully underneath.
      this.logger.debug('[Extension Signing] Calling window.nostr.signEvent');

      const zonedSignEvent = new Promise<Event>((resolve, reject) => {
        window.nostr!.signEvent(eventTemplate).then(
          (result) => {
            this.ngZone.run(() => {
              this.logger.debug('[Extension Signing] Extension returned result', { hasResult: !!result, resultId: (result as Event)?.id });
              resolve(result as Event);
            });
          },
          (err: Error) => {
            this.ngZone.run(() => {
              this.logger.error('[Extension Signing] Extension signEvent threw error', err);
              reject(err);
            });
          }
        );
      });

      const extensionResult = await Promise.race([
        zonedSignEvent,
        dialogClosedPromise,
      ]);
      this.logger.debug('[Extension Signing] Extension signing completed', { resultId: (extensionResult as Event)?.id });
      return extensionResult as Event;
    } finally {
      // Always close the dialog when signing completes (success or error).
      // Run inside NgZone to ensure Angular processes the dialog removal.
      if (this.currentSigningDialogRef) {
        const dialogRef = this.currentSigningDialogRef;
        this.currentSigningDialogRef = null; // Clear before closing to prevent rejection
        this.ngZone.run(() => dialogRef.close());
      }
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

    // Apply global event expiration if enabled and no expiration tag already exists
    const globalExpiration = this.accountLocalState.getGlobalEventExpiration(currentUser.pubkey);
    if (globalExpiration !== null && !event.tags.some(tag => tag[0] === 'expiration')) {
      // Calculate expiration timestamp: current time + hours in seconds
      const expirationTimestamp = Math.floor(Date.now() / 1000) + (globalExpiration * 3600);
      event = {
        ...event,
        tags: [...event.tags, ['expiration', expirationTimestamp.toString()]],
      };
    }

    let signedEvent: Event | EventTemplate | null = null;

    // Get the pubkey - either from the event if it's an Event, or use current user's
    const eventPubkey = ('pubkey' in event) ? event.pubkey : currentUser.pubkey;

    // Determine the effective signing method
    // If source is 'nsec' but user has bunker configured and prefers remote signing, use remote
    let effectiveSource = currentUser.source;
    if (currentUser.source === 'nsec' && currentUser.bunker && currentUser.preferredSigningMethod === 'remote') {
      effectiveSource = 'remote';
    }

    switch (effectiveSource) {
      case 'external': {
        // Create the event object with pubkey
        // Order fields so content appears before tags for easier user review when signing
        const unsignedEvent: UnsignedEvent = {
          kind: event.kind,
          content: event.content,
          created_at: event.created_at ?? this.currentDate(),
          tags: event.tags,
          pubkey: eventPubkey,
        };

        // Generate ID if not present (important for signing)
        const eventId = getEventHash(unsignedEvent);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (unsignedEvent as any).id = eventId;

        const eventJson = JSON.stringify(unsignedEvent);
        const encodedJson = encodeURIComponent(eventJson);

        // Construct the nostrsigner URL
        // compressionType=none&returnType=signature&type=sign_event
        const url = `nostrsigner:${encodedJson}?compressionType=none&returnType=signature&type=sign_event&appName=Nostria`;

        // Open the dialog
        const dialogRef = this.dialog.open(ExternalSignerDialogComponent, {
          disableClose: true,
          hasBackdrop: true,
          data: {
            eventJson: eventJson,
            nostrSignerUrl: url
          }
        });

        const result = await dialogRef.afterClosed().toPromise();

        if (!result) {
          throw new Error('Signing cancelled');
        }

        // The result can be either:
        // 1. A full signed event JSON (with 'sig' field)
        // 2. Just the signature string (64 bytes hex = 128 characters)
        // Per NIP-55, the signer returns the 'result' field which contains either format
        const resultData = result.trim();

        // Check if it's a JSON object (full signed event)
        if (resultData.startsWith('{')) {
          try {
            const parsedEvent = JSON.parse(resultData);
            // Validate it's a properly signed event
            if (parsedEvent.sig && typeof parsedEvent.sig === 'string') {
              signedEvent = parsedEvent;
            }
          } catch {
            // Not valid JSON, assume it's a raw signature string
          }
        }

        if (!signedEvent) {
          // It's a raw signature string - construct the signed event
          signedEvent = {
            ...unsignedEvent,
            id: eventId,
            sig: resultData
          };
        }

        break;
      }
      case 'extension': {
        // Queue extension signing requests to prevent concurrent dialogs
        signedEvent = await this.queueExtensionSigning(event);
        break;
      }
      case 'remote': {
        // For remote signing, we need to include pubkey
        // Preserve created_at if already set (important for PoW)
        // Order fields so content appears before tags for easier user review when signing
        const cleanEvent: UnsignedEvent = {
          kind: event.kind,
          content: event.content,
          created_at: event.created_at ?? this.currentDate(),
          tags: event.tags,
          pubkey: eventPubkey,
        };

        // Route through EncryptionService's cached BunkerSigner so the single
        // connect() handshake is reused across sign_event, encrypt, and decrypt.
        if (!this.encryptionServiceInstance) {
          const { EncryptionService } = await import('./encryption.service');
          this.encryptionServiceInstance = this.injector.get(EncryptionService);
        }
        signedEvent = await this.encryptionServiceInstance.signRemoteEvent(cleanEvent);
        this.logger.info('Event signed via remote signer');
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
        // Order fields so content appears before tags for easier user review when signing
        const cleanEvent: UnsignedEvent = {
          kind: event.kind,
          content: event.content,
          created_at: event.created_at ?? this.currentDate(),
          tags: event.tags,
          pubkey: eventPubkey,
        };

        // Get the decrypted private key (will prompt for PIN if needed)
        const decryptedPrivkey = await this.getDecryptedPrivateKeyWithPrompt(currentUser);

        if (!decryptedPrivkey) {
          throw new Error('Failed to unlock private key. PIN required.');
        }

        signedEvent = finalizeEvent(cleanEvent, hexToBytes(decryptedPrivkey));

        // Increment signing count for backup prompt tracking
        this.accountLocalState.incrementSigningCount(currentUser.pubkey);

        break;
      }
    }

    return signedEvent as Event;
  }

  async signAndPublish(event: UnsignedEvent): Promise<{ success: boolean; event?: Event; error?: string }> {
    if (!event) {
      throw new Error('Event parameter must not be null or undefined.');
    }

    try {
      const signedEvent = await this.signEvent(event);

      try {
        await this.database.saveEvent(signedEvent);
      } catch (saveError) {
        this.logger.warn('[NostrService] Failed to save signed event locally before publish', saveError);
      }

      // IMPORTANT: ALL events must go to ALL configured relays to prevent data fragmentation
      // For replies, reactions, and reposts, we also publish to mentioned users' relays
      const options = signedEvent.kind === kinds.Contacts
        ? { notifyFollowed: true, useOptimizedRelays: false } // For follows, notify all
        : { notifyMentioned: true, useOptimizedRelays: false }; // For all other events, notify mentioned users

      const result = await this.publishService.publish(signedEvent, options);

      return { success: result.success, event: signedEvent };
    } catch (error) {
      this.logger.error('[NostrService] Error in signAndPublish', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get the current timestamp in seconds (Nostr format).
   * @deprecated Use UtilitiesService.currentDate() or this.utilities.currentDate() instead
   */
  currentDate() {
    return this.utilities.currentDate();
  }

  /**
   * Get a future timestamp by adding minutes to the current time.
   * @deprecated Use UtilitiesService.futureDate() or this.utilities.futureDate() instead
   */
  futureDate(minutes: number) {
    return this.utilities.futureDate(minutes);
  }

  createEvent(kind: number, content: string, tags: string[][]): UnsignedEvent {
    // Order fields so content appears before tags for easier user review when signing
    const event: UnsignedEvent = {
      kind: kind,
      content,
      created_at: this.currentDate(),
      tags,
      pubkey: this.accountState.pubkey(),
    };

    return event;
  }

  /**
   * NIP-62: Request to Vanish
   *
   * Creates a kind 62 event requesting relays to delete all events from this pubkey.
   * - For targeted vanish: include specific relay URLs in `relay` tags.
   * - For global vanish: use `['relay', 'ALL_RELAYS']`.
   *
   * @param relayUrls Array of relay URLs to target, or `['ALL_RELAYS']` for global vanish
   * @param reason Optional reason or legal notice for the relay operator
   */
  createVanishEvent(relayUrls: string[], reason = ''): UnsignedEvent {
    const tags = relayUrls.map(url => ['relay', url]);
    return this.createEvent(62, reason, tags);
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
            // Save refreshed metadata to database for Summary queries
            await this.database.saveEvent(metadata);
          }
        }, 0);
      }

      return cachedMetadata;
    }

    // Not in cache, get from storage using new DatabaseService
    await this.database.init();
    const events = await this.database.getEventsByPubkeyAndKind(pubkey, kinds.Metadata);
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
        // Save discovered metadata to database for Summary queries
        await this.database.saveEvent(metadata);
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
    const event = await this.database.getEventByPubkeyAndKind(pubkey, 10063);

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
      userPool = new SimplePool({ enablePing: true, enableReconnect: true });
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
      await this.database.saveEvent(metadata);
    }

    return metadata;
  }

  async discoverMetadata(pubkey: string, disconnect = true): Promise<Event | undefined | null> {
    // Get or create info object for this user
    let info: any = await this.database.getInfo(pubkey, 'user');
    if (!info) {
      info = {};
    }

    // Check if we have a relay list in storage (it may have been fetched by discoveryRelay.getUserRelayUrls)
    const relayListEvent = await this.database.getEventByPubkeyAndKind(pubkey, kinds.RelayList);
    if (relayListEvent) {
      info.hasRelayList = true;
      info.foundOnDiscoveryRelays = true;
      this.logger.debug('Found existing relay list for user during discovery', { pubkey });
    }

    // Fetch metadata
    const data = await this.sharedRelay.get(pubkey, {
      authors: [pubkey],
      kinds: [kinds.Metadata],
    });

    if (data) {
      info.foundMetadataOnUserRelays = true;
    }

    // Save updated info
    await this.database.saveInfo(pubkey, 'user', info);

    return data;
  }

  /** Used to get Relay List, Following List and Metadata for a user from the account relays. This is a fallback if discovery fails. */
  async discoverMetadataFromAccountRelays(pubkey: string) {
    // First get the relay list if exists.
    // Second get the following list if exists.
    // Get the metadata from the user's relays, not from the account relays. We truly do not want to fall back to get metadata
    // from the current account relays.

    let info: any = await this.database.getInfo(pubkey, 'user');

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

        await this.database.saveEvent(relayListEvent);
        // Also save to new DatabaseService for Summary queries
        await this.database.saveEvent(relayListEvent);

        relayUrls = this.utilities.pickOptimalRelays(
          this.utilities.getOptimalRelayUrlsForFetching(relayListEvent),
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

          await this.database.saveEvent(followingEvent);
          // Also save to new DatabaseService for Summary queries
          await this.database.saveEvent(followingEvent);
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
        userPool = new SimplePool({ enablePing: true, enableReconnect: true });
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

          await this.database.saveEvent(metadataEvent);
          // Also save to new DatabaseService for Summary queries
          await this.database.saveEvent(metadataEvent);
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
      await this.database.saveInfo(pubkey, 'user', info);
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
        this.discoveryPool = new SimplePool({ enablePing: true, enableReconnect: true });
      }

      if (!this.discoveryUserPool) {
        this.discoveryUserPool = new SimplePool({ enablePing: true, enableReconnect: true });
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

      if (!pubkey || relays.length === 0) {
        throw new Error('Invalid Nostr Connect URL: missing required components');
      }

      this.logger.debug('Parsed Nostr Connect URL', {
        pubkey,
        relayCount: relays.length,
        secret: `${secret?.substring(0, 4)}...`, // Log only prefix for security
      });

      const privateKey = generateSecretKey();
      const clientPubkey = getPublicKey(privateKey);

      const pool = new SimplePool({ enablePing: true, enableReconnect: true });

      // Create a promise that rejects if we receive an error response
      let errorListener: (reason?: any) => void;
      const errorPromise = new Promise((_, reject) => {
        errorListener = reject;
      });

      // Monitor for error messages; use 'since' to avoid replaying stale signer events
      const connectSince = Math.floor(Date.now() / 1000) - 30;
      const sub = pool.subscribeMany(
        bunkerParsed!.relays,
        {
          kinds: [24133],
          authors: [bunkerParsed!.pubkey],
          '#p': [clientPubkey],
          since: connectSince,
        },
        {
          onevent: async (event) => {
            try {
              let response: { error?: string };

              if (event.content.includes('?iv=')) {
                const decrypted = await nip04.decrypt(bytesToHex(privateKey), bunkerParsed!.pubkey, event.content);
                response = JSON.parse(decrypted);
              } else {
                // Try NIP-44 decryption first
                try {
                  const conversationKey = nip44.getConversationKey(privateKey, bunkerParsed!.pubkey);
                  const decrypted = nip44.decrypt(event.content, conversationKey);
                  response = JSON.parse(decrypted);
                } catch {
                  // Not NIP-44 or failed, try plain JSON
                  try {
                    response = JSON.parse(event.content);
                  } catch {
                    // Assume content is the error message itself if it's not JSON
                    response = { error: event.content };
                  }
                }
              }

              if (response.error) {
                this.logger.error('Nostr Connect Error:', response.error);
                if (errorListener) {
                  errorListener(new Error(response.error));
                }
              }
            } catch (e) {
              this.logger.error('Error processing NIP-46 response:', e);
            }
          }
        }
      );

      const bunker = BunkerSigner.fromBunker(privateKey, bunkerParsed!, { pool });

      try {
        // Race between connection/getPublicKey and error response
        await Promise.race([bunker.connect(), errorPromise]);

        const remotePublicKey = await Promise.race([bunker.getPublicKey(), errorPromise]) as string;

        await Promise.race([
          bunker.sendRequest('switch_relays', bunkerParsed!.relays),
          errorPromise,
        ]) as string;
        const bunkerRelays = bunkerParsed!.relays;
        const bunkerPointer: BunkerPointer = {
          ...bunkerParsed!,
          relays: bunkerRelays,
        };

        this.logger.info('Using remote signer account');
        const newUser: NostrUser = {
          privkey: bytesToHex(privateKey),
          bunkerClientKey: bytesToHex(privateKey), // Store explicitly so encryption.service doesn't need fallback
          pubkey: remotePublicKey,
          name: 'Remote Signer',
          source: 'remote', // With 'remote' type, the actually stored pubkey is not connected with the prvkey.
          bunker: bunkerPointer,
          lastUsed: Date.now(),
          hasActivated: true,
        };

        await this.setAccount(newUser);
        this.logger.debug('Remote signer account set successfully', {
          pubkey: remotePublicKey,
          remoteSignerPubkey: bunkerParsed!.pubkey,
          relayCount: bunkerRelays.length,
        });

        this.logger.info('Nostr Connect login successful', { pubkey });

        return {
          pubkey,
          relays,
          secret,
        };
      } finally {
        // Always close the subscription
        sub.close();
      }
    } catch (error) {
      this.logger.error('Login with Nostr Connect failed:', error);
      throw error;
    }
  }

  private parseNip46SwitchRelays(result: string): string[] | null {
    const trimmed = result.trim();

    if (!trimmed || trimmed === 'null') {
      return null;
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every(relay => typeof relay === 'string')) {
        return parsed;
      }
    } catch {
      return null;
    }

    return null;
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

    // Not in cache, get from storage using new DatabaseService
    await this.database.init();
    const events = await this.database.getEventsByPubkeyAndKind(pubkey, kinds.RelayList);
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

      // Recovery: Check if there's a single account stored in the old ACCOUNT_STORAGE_KEY
      const singleAccountJson = this.localStorage.getItem(this.appState.ACCOUNT_STORAGE_KEY);
      if (singleAccountJson) {
        try {
          const singleAccount = JSON.parse(singleAccountJson);
          this.logger.info('Found single account in storage, recovering to accounts list', {
            pubkey: singleAccount.pubkey,
          });

          // Restore the accounts list with this single account
          const recoveredAccounts = [singleAccount];
          this.localStorage.setItem(
            this.appState.ACCOUNTS_STORAGE_KEY,
            JSON.stringify(recoveredAccounts)
          );

          return recoveredAccounts;
        } catch (e) {
          this.logger.error('Failed to recover account from single account storage', e);
        }
      }
    }

    return [];
  }

  async getAccountsMetadata() {
    const pubkeys = this.accountState.accounts().map(user => user.pubkey);

    // Get metadata for all accounts from storage using new DatabaseService
    await this.database.init();
    const events = await this.database.getEventsByPubkeyAndKind(pubkeys, kinds.Metadata);

    // Find pubkeys that don't have metadata in storage
    const foundPubkeys = new Set(events.map(e => e.pubkey));
    const missingPubkeys = pubkeys.filter(pk => !foundPubkeys.has(pk));

    // If some profiles are missing (e.g., after cache wipe), fetch from discovery relays in batch
    if (missingPubkeys.length > 0) {
      this.logger.info(`[NostrService] Batch fetching ${missingPubkeys.length} missing account profiles from discovery relays`);

      // Ensure discovery relay is initialized
      await this.discoveryRelay.load();

      try {
        // Batch fetch all missing profiles in a single query
        const fetchedEvents = await this.discoveryRelay.getEventsByPubkeyAndKind(missingPubkeys, kinds.Metadata);

        if (fetchedEvents.length > 0) {
          this.logger.info(`[NostrService] Fetched ${fetchedEvents.length} profiles from discovery relays`);

          // Save all fetched events to database in parallel
          await Promise.all(fetchedEvents.map(async (metadata) => {
            events.push(metadata);
            await this.database.saveEvent(metadata);
          }));
        }
      } catch (error) {
        this.logger.warn(`[NostrService] Failed to batch fetch profiles:`, error);
      }
    }

    return events;
  }

  async getAccountsRelays() {
    const pubkeys = this.accountState.accounts().map(user => user.pubkey);

    // Use new DatabaseService for relay queries
    await this.database.init();
    const relays = await this.database.getEventsByPubkeyAndKind(pubkeys, kinds.RelayList);

    // Find pubkeys that don't have relay list in storage
    const foundPubkeys = new Set(relays.map(e => e.pubkey));
    const missingPubkeys = pubkeys.filter(pk => !foundPubkeys.has(pk));

    // If some relay lists are missing (e.g., after cache wipe), fetch from discovery relays in batch
    if (missingPubkeys.length > 0) {
      this.logger.info(`[NostrService] Batch fetching ${missingPubkeys.length} missing account relay lists from discovery relays`);

      // Ensure discovery relay is initialized
      await this.discoveryRelay.load();

      try {
        // Batch fetch all missing relay lists in a single query
        const fetchedEvents = await this.discoveryRelay.getEventsByPubkeyAndKind(missingPubkeys, kinds.RelayList);

        if (fetchedEvents.length > 0) {
          this.logger.info(`[NostrService] Fetched ${fetchedEvents.length} relay lists from discovery relays`);

          // Save all fetched events to database in parallel
          await Promise.all(fetchedEvents.map(async (relayList) => {
            relays.push(relayList);
            await this.database.saveEvent(relayList);
          }));
        }
      } catch (error) {
        this.logger.warn(`[NostrService] Failed to batch fetch relay lists:`, error);
      }
    }

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

      // Update the accounts signal with the new lastUsed timestamp
      this.accountState.accounts.update(accounts =>
        accounts.map(account => account.pubkey === pubkey ? targetUser : account)
      );

      // Persist updated accounts to local storage
      this.localStorage.setItem(this.appState.ACCOUNTS_STORAGE_KEY, JSON.stringify(this.accountState.accounts()));

      // Persist the current account to local storage
      this.localStorage.setItem(this.appState.ACCOUNT_STORAGE_KEY, JSON.stringify(targetUser));

      // This will trigger a lot of effects.
      await this.accountState.changeAccount(targetUser);
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
    await this.accountState.changeAccount(user);
  }

  async generateNewKey(region?: string) {
    this.logger.info('Generating new Nostr keypair with BIP39 mnemonic (NIP-06)');

    // Generate a BIP39 mnemonic phrase
    const mnemonic = this.mnemonicService.generateMnemonic();
    this.logger.debug('Generated 12-word mnemonic phrase, deriving keypair via NIP-06 path m/44\'/1237\'/0\'/0/0');

    // Derive the private key from the mnemonic using NIP-06
    const privkeyHex = this.mnemonicService.derivePrivateKeyFromMnemonic(mnemonic);

    // Get the public key from the derived private key
    const secretKey = hexToBytes(privkeyHex);
    const pubkey = getPublicKey(secretKey);

    // Try to encrypt the private key with default PIN
    // Fall back to plaintext storage if encryption fails (e.g., on HTTP connections)
    let storedPrivkey: string;
    let isEncrypted: boolean;

    try {
      const encryptedData = await this.crypto.encryptPrivateKey(privkeyHex, this.crypto.DEFAULT_PIN);
      storedPrivkey = JSON.stringify(encryptedData);
      isEncrypted = true;
      this.logger.info('Private key encrypted successfully');
    } catch (encryptError) {
      this.logger.warn('Failed to encrypt private key, storing in plaintext. This may occur on HTTP connections.', encryptError);
      storedPrivkey = privkeyHex;
      isEncrypted = false;
    }

    // Try to encrypt the mnemonic with default PIN
    let storedMnemonic: string;
    let isMnemonicEncrypted: boolean;

    try {
      const encryptedMnemonic = await this.mnemonicService.encryptMnemonic(mnemonic, this.crypto.DEFAULT_PIN);
      storedMnemonic = JSON.stringify(encryptedMnemonic);
      isMnemonicEncrypted = true;
      this.logger.info('Mnemonic encrypted successfully');
    } catch (encryptError) {
      this.logger.warn('Failed to encrypt mnemonic, storing in plaintext. This may occur on HTTP connections.', encryptError);
      storedMnemonic = mnemonic;
      isMnemonicEncrypted = false;
    }

    const newUser: NostrUser = {
      pubkey,
      privkey: storedPrivkey,
      mnemonic: storedMnemonic,
      source: 'nsec',
      lastUsed: Date.now(),
      region: region,
      hasActivated: false,
      isEncrypted,
      isMnemonicEncrypted,
    };

    this.logger.debug(`New keypair generated successfully (${isEncrypted ? 'encrypted' : 'plaintext'})`, { pubkey, region });

    // Setup the account with defaults (relays, etc.)
    // We pass the secretKey so it can sign events without the account being set yet
    await this.setupNewAccountWithDefaults(newUser, region, secretKey);

    // Set the account after setup is complete
    await this.setAccount(newUser);

    return newUser;
  }

  async setupNewAccountWithDefaults(user: NostrUser, region?: string, secretKey?: Uint8Array): Promise<void> {
    this.logger.info('Setting up new account with default configuration', {
      pubkey: user.pubkey,
      region,
    });

    // Helper to sign events either with secret key or via signEvent method
    const sign = async (event: UnsignedEvent) => {
      if (secretKey) {
        return finalizeEvent(event, secretKey);
      } else {
        return this.signEvent(event);
      }
    };

    // If region is not provided, try to get it from the user or use a default
    const accountRegion = region || user.region || 'us';

    // Configure the discovery relays based on the user's region
    // Use both regional Nostria relay and indexer.coracle.social for better lookup performance
    const regionalDiscoveryRelay = this.region.getDiscoveryRelay(accountRegion);
    const discoveryRelays = [regionalDiscoveryRelay, 'wss://indexer.coracle.social/', 'wss://purplepag.es/'];
    this.logger.info('Setting discovery relays for new user based on region', {
      region: accountRegion,
      discoveryRelays,
    });
    this.discoveryRelay.setDiscoveryRelays(discoveryRelays);

    const relayServerUrl = this.region.getRelayServer(accountRegion, 0);
    // Build the complete list of account relays (regional + defaults)
    const allAccountRelays = [relayServerUrl!, ...this.DEFAULT_RELAYS];

    const relayTags = this.createTags('r', [relayServerUrl!]);

    // Add these 3 default relays, most popular ones.
    this.DEFAULT_RELAYS.forEach(relay => relayTags.push(['r', relay]));

    // Initialize the account relay with all relays so we can start using them
    this.accountRelay.init(allAccountRelays);

    // Create and publish Relay List event
    const relayListEvent: UnsignedEvent = {
      pubkey: user.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: kinds.RelayList,
      tags: relayTags,
      content: '',
    };

    // Use the existing sign method which handles all account types properly
    const signedRelayEvent = await sign(relayListEvent);

    await this.database.saveEvent(signedRelayEvent);
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

    const signedMediaEvent = await sign(mediaServerEvent);

    await this.database.saveEvent(signedMediaEvent);
    await this.accountRelay.publish(signedMediaEvent);

    // Create and publish DM Relay List event
    const relayDMTags = this.createTags('relay', [relayServerUrl!]);

    // Add these 3 default relays to match account relays
    this.DEFAULT_RELAYS.forEach(relay => relayDMTags.push(['relay', relay]));

    const relayDMListEvent: UnsignedEvent = {
      pubkey: user.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: kinds.DirectMessageRelaysList,
      tags: relayDMTags,
      content: '',
    };

    const signedDMEvent = await sign(relayDMListEvent);

    await this.database.saveEvent(signedDMEvent);
    await this.accountRelay.publish(signedDMEvent);

    // Create and publish Discovery Relay List event (kind 10086)
    const discoveryRelayListEvent = this.discoveryRelay.createDiscoveryRelayListEvent(
      user.pubkey,
      discoveryRelays,
    );

    const signedDiscoveryRelayEvent = await sign(discoveryRelayListEvent);

    await this.discoveryRelay.saveEvent(signedDiscoveryRelayEvent);
    await this.accountRelay.publish(signedDiscoveryRelayEvent);
    await this.discoveryRelay.publish(signedDiscoveryRelayEvent);

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
    const relayListEvent = await this.database.getEventByPubkeyAndKind(pubkey, kinds.RelayList);
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
    const contactsEvent = await this.database.getEventByPubkeyAndKind(pubkey, kinds.Contacts);
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
      // Wait for extension to be available (it's injected asynchronously)
      if (!window.nostr) {
        this.logger.info('Extension not immediately available, waiting...');
        const extensionAvailable = await this.utilities.waitForNostrExtension();
        if (!extensionAvailable) {
          const error =
            'No Nostr extension found. Please install Alby, nos2x, or another NIP-07 compatible extension.';
          this.logger.error(error);
          throw new Error(error);
        }
        this.logger.info('Extension became available');
      }

      // Double-check extension is available (for TypeScript)
      if (!window.nostr) {
        throw new Error('No Nostr extension found after waiting');
      }

      // Get the public key from the extension with a timeout
      // The extension may show a popup for user approval which takes time
      this.logger.debug('Requesting public key from extension');

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Extension did not respond in time. Please check if your browser extension popup is visible and approve the request.'));
        }, 60000); // 60 second timeout - extensions can take time if user needs to approve
      });

      const pubkey = await Promise.race([
        window.nostr.getPublicKey(),
        timeoutPromise,
      ]);

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

  async loginWithNsec(nsecOrMnemonic: string) {
    try {
      const trimmed = nsecOrMnemonic.trim();
      this.logger.info('Attempting to login with nsec or mnemonic');

      let privkeyHex = '';
      let privkeyArray: Uint8Array;
      let mnemonic: string | undefined;
      let storedMnemonic: string | undefined;
      let isMnemonicEncrypted: boolean | undefined;

      // Check if it's a mnemonic phrase
      if (this.mnemonicService.isMnemonic(trimmed)) {
        this.logger.info('Detected mnemonic phrase, deriving key (NIP-06)');

        // Normalize the mnemonic
        mnemonic = this.mnemonicService.normalizeMnemonic(trimmed);

        // Derive the private key from the mnemonic
        privkeyHex = this.mnemonicService.derivePrivateKeyFromMnemonic(mnemonic);
        privkeyArray = hexToBytes(privkeyHex);

        // Try to encrypt the mnemonic with default PIN
        try {
          const encryptedMnemonic = await this.mnemonicService.encryptMnemonic(mnemonic, this.crypto.DEFAULT_PIN);
          storedMnemonic = JSON.stringify(encryptedMnemonic);
          isMnemonicEncrypted = true;
          this.logger.info('Mnemonic encrypted successfully');
        } catch (encryptError) {
          this.logger.warn('Failed to encrypt mnemonic, storing in plaintext. This may occur on HTTP connections.', encryptError);
          storedMnemonic = mnemonic;
          isMnemonicEncrypted = false;
        }
      } else if (trimmed.startsWith('nsec')) {
        this.logger.info('Detected nsec format');
        // Decode the nsec to get the private key bytes
        const { type, data } = nip19.decode(trimmed);
        privkeyArray = data as Uint8Array;

        if (type !== 'nsec') {
          const error = `Expected nsec but got ${type}`;
          this.logger.error(error);
          throw new Error(error);
        }

        // Convert the private key bytes to hex string
        privkeyHex = bytesToHex(data);
      } else {
        // Validate hex format: must be 64 characters and valid hex
        const hexRegex = /^[0-9a-fA-F]{64}$/;
        if (!hexRegex.test(trimmed)) {
          throw new Error('Invalid input. Must be nsec (nsec1...), 12-word mnemonic phrase, or 64-character hex private key.');
        }

        this.logger.info('Detected hex private key');
        privkeyHex = trimmed.toLowerCase(); // Normalize to lowercase
        privkeyArray = hexToBytes(privkeyHex);
      }

      // Generate the public key from the private key
      const pubkey = getPublicKey(privkeyArray);

      // Try to encrypt the private key with default PIN
      // Fall back to plaintext storage if encryption fails (e.g., on HTTP connections)
      let storedPrivkey: string;
      let isEncrypted: boolean;

      try {
        const encryptedData = await this.crypto.encryptPrivateKey(privkeyHex, this.crypto.DEFAULT_PIN);
        storedPrivkey = JSON.stringify(encryptedData);
        isEncrypted = true;
        this.logger.info('Private key encrypted successfully');
      } catch (encryptError) {
        this.logger.warn('Failed to encrypt private key, storing in plaintext. This may occur on HTTP connections.', encryptError);
        storedPrivkey = privkeyHex;
        isEncrypted = false;
      }

      // Store the user info
      const newUser: NostrUser = {
        pubkey,
        privkey: storedPrivkey,
        mnemonic: storedMnemonic,
        source: 'nsec',
        lastUsed: Date.now(),
        hasActivated: true, // Assume activation is done via nsec
        isEncrypted,
        isMnemonicEncrypted,
      };

      this.logger.info(`Login successful (${isEncrypted ? 'encrypted' : 'plaintext'})`, { pubkey });
      await this.setAccount(newUser);
    } catch (error) {
      this.logger.error('Error during private key login:', error);

      // Re-throw the original error if it's already an Error object with a message
      if (error instanceof Error) {
        throw error;
      }

      // Otherwise, wrap it with a generic message
      throw new Error('Invalid private key. Please check and try again.');
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
      name: customPubkey ? '...' : 'Preview User',
      source: 'preview',
      lastUsed: Date.now(),
      hasActivated: true, // Assume activation is done for preview accounts
    };

    await this.setAccount(newUser);
    this.logger.debug('Preview account set successfully', {
      pubkey: previewPubkey,
    });
  }

  async logout(): Promise<void> {
    this.logger.info('Logging out current user');
    this.localStorage.removeItem(this.appState.ACCOUNT_STORAGE_KEY);
    await this.accountState.changeAccount(null);
    // Clear cached PIN for security
    this.pinPrompt.clearCache();
    this.logger.debug('User logged out successfully');
  }

  async removeAccount(pubkey: string): Promise<void> {
    this.logger.info(`Removing account with pubkey: ${pubkey}`);
    const allUsers = this.accountState.accounts();
    const updatedUsers = allUsers.filter(u => u.pubkey !== pubkey);
    this.accountState.accounts.set(updatedUsers);

    // Explicitly save to localStorage to ensure persistence
    this.logger.debug(`Saving ${updatedUsers.length} accounts to localStorage after removal`);
    this.localStorage.setItem(this.appState.ACCOUNTS_STORAGE_KEY, JSON.stringify(updatedUsers));

    // If we're removing the active user, set active user to null
    if (this.accountState.account()?.pubkey === pubkey) {
      this.logger.debug('Removed account was the active user, logging out');
      await this.accountState.changeAccount(null);
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
