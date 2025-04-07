import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import * as nip19 from 'nostr-tools/nip19';

export interface NostrUser {
  pubkey: string;
  privkey?: string;
  name?: string;
  source: 'generated' | 'extension' | 'nsec' | 'preview';
  lastUsed?: number; // Timestamp when this account was last used
}

@Injectable({
  providedIn: 'root'
})
export class NostrService {
  #bootStrapRelays = ['wss://relay.damus.io', 'wss://relay.primal.net', 'wss://nos.lol'];
  private readonly USER_STORAGE_KEY = 'nostria-user';
  private readonly USERS_STORAGE_KEY = 'nostria-users';
  
  private user = signal<NostrUser | null>(null);
  private users = signal<NostrUser[]>([]);
  
  isLoggedIn = computed(() => !!this.user());
  currentUser = computed(() => this.user());
  allUsers = computed(() => this.users());

  constructor() {
    this.loadUsersFromStorage();
    this.loadActiveUserFromStorage();

    // Save user to localStorage whenever it changes
    effect(() => {
      const currentUser = this.user();
      if (currentUser) {
        localStorage.setItem(this.USER_STORAGE_KEY, JSON.stringify(currentUser));
        this.updateUserInCollection(currentUser);
      }
    });

    // Save all users to localStorage whenever they change
    effect(() => {
      const allUsers = this.users();
      if (allUsers.length > 0) {
        localStorage.setItem(this.USERS_STORAGE_KEY, JSON.stringify(allUsers));
      }
    });
  }

  get bootStrapRelays() {
    return this.#bootStrapRelays;
  }

  private loadUsersFromStorage(): void {
    const usersJson = localStorage.getItem(this.USERS_STORAGE_KEY);
    if (usersJson) {
      try {
        this.users.set(JSON.parse(usersJson));
      } catch (e) {
        console.error('Failed to parse users from localStorage', e);
        this.users.set([]);
      }
    }
  }

  private loadActiveUserFromStorage(): void {
    const userJson = localStorage.getItem(this.USER_STORAGE_KEY);
    if (userJson) {
      try {
        this.user.set(JSON.parse(userJson));
      } catch (e) {
        console.error('Failed to parse user from localStorage', e);
      }
    }
  }

  private updateUserInCollection(updatedUser: NostrUser): void {
    // Update lastUsed timestamp
    updatedUser.lastUsed = Date.now();
    
    const allUsers = this.users();
    const existingUserIndex = allUsers.findIndex(u => u.pubkey === updatedUser.pubkey);
    
    if (existingUserIndex >= 0) {
      // Update existing user
      const updatedUsers = [...allUsers];
      updatedUsers[existingUserIndex] = updatedUser;
      this.users.set(updatedUsers);
    } else {
      // Add new user
      this.users.set([...allUsers, updatedUser]);
    }
  }

  switchToUser(pubkey: string): boolean {
    const allUsers = this.users();
    const targetUser = allUsers.find(u => u.pubkey === pubkey);
    
    if (targetUser) {
      // Update lastUsed timestamp
      targetUser.lastUsed = Date.now();
      this.user.set(targetUser);
      return true;
    }
    
    return false;
  }

  generateNewKey(): void {
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

    this.user.set(newUser);
  }

  async loginWithExtension(): Promise<void> {
    try {
      // Check if NIP-07 extension is available
      if (!window.nostr) {
        throw new Error('No Nostr extension found. Please install Alby, nos2x, or another NIP-07 compatible extension.');
      }

      // Get the public key from the extension
      const pubkey = await window.nostr.getPublicKey();

      if (!pubkey) {
        throw new Error('Failed to get public key from extension');
      }

      // Get user metadata if available
      let name: string | undefined = undefined;
      try {
        // Some extensions may provide user metadata like name
        const userInfo = await window.nostr.getUserMetadata();
        name = userInfo?.name;
      } catch (error) {
        // Ignore errors for metadata, it's optional
        console.warn('Could not get user metadata from extension', error);
      }

      // Set the user with the public key from the extension
      const newUser: NostrUser = {
        pubkey,
        name,
        source: 'extension',
        lastUsed: Date.now()
      };
      
      this.user.set(newUser);

      return;
    } catch (error) {
      console.error('Error connecting to Nostr extension:', error);
      throw error; // Re-throw to handle in the UI
    }
  }

  loginWithNsec(nsec: string): void {
    try {
      // Validate and decode the nsec
      if (!nsec.startsWith('nsec')) {
        throw new Error('Invalid nsec format. Must start with "nsec"');
      }

      // Decode the nsec to get the private key bytes
      const { type, data } = nip19.decode(nsec);
      
      if (type !== 'nsec') {
        throw new Error(`Expected nsec but got ${type}`);
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
      
      this.user.set(newUser);
    } catch (error) {
      console.error('Error decoding nsec:', error);
      throw new Error('Invalid nsec key provided. Please check and try again.');
    }
  }

  usePreviewAccount(): void {
    // jack
    const previewPubkey = '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2';
    const newUser: NostrUser = {
      pubkey: previewPubkey,
      name: 'Preview User',
      source: 'preview',
      lastUsed: Date.now()
    };
    
    this.user.set(newUser);
  }

  logout(): void {
    localStorage.removeItem(this.USER_STORAGE_KEY);
    this.user.set(null);
  }

  removeAccount(pubkey: string): void {
    const allUsers = this.users();
    const updatedUsers = allUsers.filter(u => u.pubkey !== pubkey);
    this.users.set(updatedUsers);
    
    // If we're removing the active user, set active user to null
    if (this.user()?.pubkey === pubkey) {
      this.user.set(null);
    }
  }

  getNsecFromPrivkey(privkey: string): string {
    // Convert the hex private key to a Nostr secret key (nsec)
    const bytes = hexToBytes(privkey);
    const nsec = nip19.nsecEncode(bytes);
    return nsec;
  }

  getNpubFromPubkey(pubkey: string): string {
    // Convert the hex public key to a Nostr public key (npub)
    const npub = nip19.npubEncode(pubkey);
    return npub;
  }
}
