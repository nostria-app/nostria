import { Injectable, signal, computed, effect, inject, untracked } from '@angular/core';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import * as nip19 from 'nostr-tools/nip19';
import { LoggerService } from './logger.service';
import { RelayService } from './relay.service';
import { NostrEventData, StorageService, UserMetadata } from './storage.service';

export interface NostrUser {
  pubkey: string;
  privkey?: string;
  name?: string;
  source: 'generated' | 'extension' | 'nsec' | 'preview';
  lastUsed?: number; // Timestamp when this account was last used
}

export interface UserMetadataWithPubkey extends NostrEventData<UserMetadata> {
  pubkey: string;
}

@Injectable({
  providedIn: 'root'
})
export class NostrService {
  
  private readonly USER_STORAGE_KEY = 'nostria-user';
  private readonly USERS_STORAGE_KEY = 'nostria-users';
  private readonly logger = inject(LoggerService);
  private readonly relayService = inject(RelayService);
  private readonly storage = inject(StorageService);

  private user = signal<NostrUser | null>(null);
  private users = signal<NostrUser[]>([]);

  // Signal to store metadata for all users - using array instead of Map
  private allUserMetadata = signal<UserMetadataWithPubkey[]>([]);

  isLoggedIn = computed(() => {
    const result = !!this.user();
    this.logger.debug('isLoggedIn computed value calculated', { isLoggedIn: result });
    return result;
  });

  currentUser = computed(() => {
    return this.user();
  });

  allUsers = computed(() => {
    return this.users();
  });

  hasUsers = computed(() => {
    return this.allUsers().length > 0;
  });

  // Expose the metadata as a computed property
  usersMetadata = computed(() => {
    return this.allUserMetadata();
  });

  // Method to easily find metadata by pubkey
  findUserMetadata(pubkey: string): UserMetadataWithPubkey | undefined {
    return this.allUserMetadata().find(meta => meta.pubkey === pubkey);
  }

  constructor() {
    this.logger.info('Initializing NostrService');

    effect(() => {
      if (this.storage.isInitialized()) {
        this.loadUsersFromStorage();
        this.loadActiveUserFromStorage();
      }
    });

    // Save user to localStorage whenever it changes
    effect(() => {
      if (this.storage.isInitialized()) {

        const currentUser = this.user();
        this.logger.debug('User change effect triggered', {
          hasUser: !!currentUser,
          pubkey: currentUser?.pubkey
        });

        if (currentUser) {
          this.logger.debug('Saving current user to localStorage', { pubkey: currentUser.pubkey });
          localStorage.setItem(this.USER_STORAGE_KEY, JSON.stringify(currentUser));

          // Load relays for this user from storage
          untracked(() => {
            this.relayService.loadRelaysForUser(currentUser.pubkey)
              .catch(err => this.logger.error('Failed to load relays for user', err));
          });
        }
      }
    });

    // Save all users to localStorage whenever they change
    effect(() => {
      const allUsers = this.users();

      if (allUsers.length === 0) {
        this.logger.debug('No users to save to localStorage');
        return;
      }

      this.logger.debug('Users collection effect triggered', { count: allUsers.length });

      this.logger.debug(`Saving ${allUsers.length} users to localStorage`);
      localStorage.setItem(this.USERS_STORAGE_KEY, JSON.stringify(allUsers));

      // When users change, ensure we have metadata for all of them
      untracked(() => {
        this.loadAllUsersMetadata().catch(err =>
          this.logger.error('Failed to load metadata for all users', err));
      });
    });

    this.logger.debug('NostrService initialization completed');

    // Initial load of metadata for all users
    // this.loadAllUsersMetadata().catch(err => 
    //   this.logger.error('Failed to load initial metadata for all users', err));
  }

  reset() {
    this.users.set([]);
    this.user.set(null);
    this.allUserMetadata.set([]);
  }

  private loadUsersFromStorage(): void {
    const usersJson = localStorage.getItem(this.USERS_STORAGE_KEY);
    if (usersJson) {
      try {
        const parsedUsers = JSON.parse(usersJson);
        this.logger.debug(`Loaded ${parsedUsers.length} users from localStorage`);
        this.users.set(parsedUsers);
      } catch (e) {
        this.logger.error('Failed to parse users from localStorage', e);
        this.users.set([]);
      }
    } else {
      this.logger.debug('No users found in localStorage');
    }
  }

  private loadActiveUserFromStorage(): void {
    const userJson = localStorage.getItem(this.USER_STORAGE_KEY);
    if (userJson) {
      try {
        const parsedUser = JSON.parse(userJson);
        this.logger.debug('Loaded active user from localStorage', { pubkey: parsedUser.pubkey });
        this.user.set(parsedUser);
      } catch (e) {
        this.logger.error('Failed to parse user from localStorage', e);
      }
    } else {
      this.logger.debug('No active user found in localStorage');
    }
  }

  /**
   * Loads metadata for all known users into the allUserMetadata signal
   */
  async loadAllUsersMetadata(): Promise<void> {
    const users = this.users();
    if (users.length === 0) {
      this.logger.debug('No users to load metadata for');
      return;
    }

    this.logger.debug(`Loading metadata for ${users.length} users`);
    const metadataArray: UserMetadataWithPubkey[] = [];

    for (const user of users) {
      try {
        const metadata = await this.storage.getUserMetadata(user.pubkey);
        if (metadata) {
          this.logger.debug(`Loaded metadata for user ${user.pubkey}`, { metadata });
          metadataArray.push({
            ...metadata,
            pubkey: user.pubkey
          });
        }
      } catch (error) {
        this.logger.error(`Failed to load metadata for user ${user.pubkey}`, error);
      }
    }

    this.allUserMetadata.set(metadataArray);
    this.logger.debug(`Loaded metadata for ${metadataArray.length} users`);
  }

  /**
   * Updates the metadata for a single user in the allUserMetadata signal
   */
  private updateUserMetadataInSignal(pubkey: string, metadata: NostrEventData<UserMetadata>): void {
    const userMetadataWithPubkey: UserMetadataWithPubkey = {
      ...metadata,
      pubkey
    };

    this.allUserMetadata.update(array => {
      const index = array.findIndex(m => m.pubkey === pubkey);
      if (index >= 0) {
        // Replace existing metadata
        return [
          ...array.slice(0, index),
          userMetadataWithPubkey,
          ...array.slice(index + 1)
        ];
      } else {
        // Add new metadata
        return [...array, userMetadataWithPubkey];
      }
    });
  }

  getTruncatedNpub(pubkey: string): string {
    const npub = this.getNpubFromPubkey(pubkey);
    return npub.length > 12
      ? `${npub.substring(0, 6)}...${npub.substring(npub.length - 6)}`
      : npub;
  }

  switchToUser(pubkey: string): boolean {
    this.logger.info(`Switching to user with pubkey: ${pubkey}`);
    const targetUser = this.users().find(u => u.pubkey === pubkey);

    if (targetUser) {
      // Update lastUsed timestamp
      targetUser.lastUsed = Date.now();

      this.user.set(targetUser);
      this.logger.debug('Successfully switched user');

      // Make sure we have the latest metadata for this user
      this.getUserMetadata(pubkey).catch(err =>
        this.logger.error(`Failed to refresh metadata for user ${pubkey}`, err));

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

    const allUsers = this.users();
    const existingUserIndex = allUsers.findIndex(u => u.pubkey === user.pubkey);

    if (existingUserIndex >= 0) {
      // Update existing user
      this.logger.debug('Updating existing user in collection', { index: existingUserIndex });
      this.users.update(u => u.map(existingUser => existingUser.pubkey === user.pubkey ? user : existingUser));
    } else {
      // Add new user
      this.logger.debug('Adding new user to collection');
      this.users.update(u => [...u, user]);
    }

    // Trigger the user signal which indicates user is logged on.
    this.user.set(user);

    // Make sure we have the latest metadata for this user
    this.getUserMetadata(user.pubkey).catch(err =>
      this.logger.error(`Failed to get metadata for new user ${user.pubkey}`, err));
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
      source: 'generated',
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
    localStorage.removeItem(this.USER_STORAGE_KEY);
    this.user.set(null);
    this.logger.debug('User logged out successfully');
  }

  removeAccount(pubkey: string): void {
    this.logger.info(`Removing account with pubkey: ${pubkey}`);
    const allUsers = this.users();
    const updatedUsers = allUsers.filter(u => u.pubkey !== pubkey);
    this.users.set(updatedUsers);

    // If we're removing the active user, set active user to null
    if (this.user()?.pubkey === pubkey) {
      this.logger.debug('Removed account was the active user, logging out');
      this.user.set(null);
    }

    // Remove the user's metadata from the metadata array
    this.allUserMetadata.update(array => array.filter(m => m.pubkey !== pubkey));

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

  /**
   * Save user metadata to storage
   */
  async saveUserMetadata(pubkey: string, metadata: NostrEventData<UserMetadata>): Promise<void> {
    try {
      // Check if we already have metadata for this user
      const existingData = await this.storage.getUserMetadata(pubkey);

      const updatedData: NostrEventData<UserMetadata> = {
        ...existingData,
        ...metadata,
        updated: Date.now()
      }

      await this.storage.saveUserMetadata(pubkey, updatedData);
      this.logger.debug(`Saved metadata for user ${pubkey} to storage`);

      // Update the metadata in our signal
      this.updateUserMetadataInSignal(pubkey, updatedData);

      // If this is the current user, trigger a metadata refresh
      if (this.currentUser()?.pubkey === pubkey) {
        this.logger.debug('Current user metadata updated');
      }
    } catch (error) {
      this.logger.error(`Error saving metadata for user ${pubkey}`, error);
    }
  }

  /**
   * Get user metadata from storage and update the metadata signal
   */
  async getUserMetadata(pubkey: string): Promise<NostrEventData<UserMetadata> | undefined> {
    try {
      // First check if we already have this metadata in our signal
      const currentMetadata = this.findUserMetadata(pubkey);

      // If we don't have it or it's older than 5 minutes, fetch from storage
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      if (!currentMetadata || (currentMetadata.updated && currentMetadata.updated < fiveMinutesAgo)) {
        this.logger.debug(`Fetching fresh metadata for ${pubkey}`);
        const metadata = await this.storage.getUserMetadata(pubkey);

        if (metadata) {
          this.updateUserMetadataInSignal(pubkey, metadata);
          return metadata;
        }
      }

      return currentMetadata;
    } catch (error) {
      this.logger.error(`Error getting metadata for user ${pubkey}`, error);
      return undefined;
    }
  }

  /**
   * Get user metadata from storage for multiple pubkeys
   */
  async getUsersMetadata(pubkeys: string[]): Promise<Map<string, NostrEventData<UserMetadata>>> {
    const metadataMap = new Map<string, NostrEventData<UserMetadata>>();

    for (const pubkey of pubkeys) {
      try {
        const metadata = await this.getUserMetadata(pubkey);
        if (metadata) {
          metadataMap.set(pubkey, metadata);
        }
      } catch (error) {
        this.logger.error(`Error getting metadata for user ${pubkey}`, error);
      }
    }

    return metadataMap;
  }

  /**
   * Clears the cache while preserving current user data
   */
  async clearCache(): Promise<void> {
    const currentUser = this.user();
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
