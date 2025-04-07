import { Injectable, inject, signal, effect } from '@angular/core';
import { LoggerService } from './logger.service';
import { Relay } from './relay.service';
import { openDB, IDBPDatabase, DBSchema } from 'idb';

// Interface for NIP-11 relay information
export interface Nip11Info {
  name?: string;
  description?: string;
  pubkey?: string;
  contact?: string;
  supported_nips?: number[];
  software?: string;
  version?: string;
  limitation?: {
    max_message_length?: number;
    max_subscriptions?: number;
    max_filters?: number;
    max_limit?: number;
    max_subid_length?: number;
    min_prefix?: number;
    max_event_tags?: number;
    max_content_length?: number;
    min_pow_difficulty?: number;
    auth_required?: boolean;
    payment_required?: boolean;
  };
  relay_countries?: string[];
  language_tags?: string[];
  tags?: string[];
  posting_policy?: string;
  retention?: {
    events?: {
      max_bytes?: number;
      max_time?: number;
      count?: number;
    };
    kinds?: Record<number, {
      max_bytes?: number;
      max_time?: number;
      count?: number;
    }>;
  };
  icon?: string;
  last_checked?: number;
}

// Interface for user metadata
export interface UserMetadata {
  pubkey: string;
  name?: string;
  about?: string;
  picture?: string;
  nip05?: string;
  nip05valid?: boolean;
  lud16?: string;
  banner?: string;
  website?: string;
  last_updated?: number;
}

// Interface for user relays
export interface UserRelays {
  pubkey: string;
  relays: string[];
  last_updated: number;
}

// Schema for the IndexedDB database
interface NostriaDBSchema extends DBSchema {
  relays: {
    key: string;
    value: Relay & { nip11?: Nip11Info };
    indexes: { 'by-status': string };
  };
  userMetadata: {
    key: string; // pubkey
    value: UserMetadata;
    indexes: { 'by-updated': number };
  };
  userRelays: {
    key: string; // pubkey
    value: UserRelays;
    indexes: { 'by-updated': number };
  };
}

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private readonly logger = inject(LoggerService);
  private db?: IDBPDatabase<NostriaDBSchema>;
  private readonly DB_NAME = 'nostria-db';
  private readonly DB_VERSION = 1;
  
  // Signal to track database initialization status
  isInitialized = signal(false);
  
  // Database stats
  dbStats = signal<{
    relaysCount: number;
    userMetadataCount: number;
    userRelaysCount: number;
    estimatedSize: number;
  }>({
    relaysCount: 0,
    userMetadataCount: 0,
    userRelaysCount: 0,
    estimatedSize: 0
  });

  constructor() {
    this.initDatabase();
  }

  private async initDatabase(): Promise<void> {
    try {
      this.logger.info('Initializing IndexedDB storage');
      this.db = await openDB<NostriaDBSchema>(this.DB_NAME, this.DB_VERSION, {
        upgrade: (db) => {
          this.logger.info('Creating or upgrading database schema');
          
          // Create object stores if they don't exist
          if (!db.objectStoreNames.contains('relays')) {
            const relayStore = db.createObjectStore('relays', { keyPath: 'url' });
            relayStore.createIndex('by-status', 'status');
            this.logger.debug('Created relays object store');
          }
          
          if (!db.objectStoreNames.contains('userMetadata')) {
            const userMetadataStore = db.createObjectStore('userMetadata', { keyPath: 'pubkey' });
            userMetadataStore.createIndex('by-updated', 'last_updated');
            this.logger.debug('Created userMetadata object store');
          }
          
          if (!db.objectStoreNames.contains('userRelays')) {
            const userRelaysStore = db.createObjectStore('userRelays', { keyPath: 'pubkey' });
            userRelaysStore.createIndex('by-updated', 'last_updated');
            this.logger.debug('Created userRelays object store');
          }
        }
      });
      
      this.logger.info('IndexedDB initialization completed');
      await this.updateStats();
      
      // Set initialized status to true
      this.isInitialized.set(true);
    } catch (error) {
      this.logger.error('Failed to initialize IndexedDB', error);
      // Set initialized to false in case of error
      this.isInitialized.set(false);
    }
  }

  // Method to wait for database initialization
//   async waitForInitialization(): Promise<void> {
//     // If already initialized, return immediately
//     if (this.isInitialized()) {
//       return;
//     }
    
//     // Otherwise, wait for initialization to complete
//     return new Promise<void>((resolve) => {
//       const unsubscribe = effect(() => {
//         if (this.isInitialized()) {
//           // Clean up the effect when initialized
//           unsubscribe();
//           resolve();
//         }
//       });
//     });
//   }

  // Relay operations
  async saveRelay(relay: Relay, nip11Info?: Nip11Info): Promise<void> {
    if (!this.db) {
      this.logger.error('Database not initialized');
      return;
    }
    
    try {
      const enhancedRelay: any = { ...relay };
      
      if (nip11Info) {
        enhancedRelay['nip11'] = {
          ...nip11Info,
          last_checked: Date.now()
        };
      }
      
      await this.db.put('relays', enhancedRelay);
      this.logger.debug(`Saved relay to IndexedDB: ${relay.url}`);
      await this.updateStats();
    } catch (error) {
      this.logger.error(`Error saving relay ${relay.url}`, error);
    }
  }

  async getRelay(url: string): Promise<(Relay & { nip11?: Nip11Info }) | undefined> {
    if (!this.db) {
      this.logger.error('Database not initialized');
      return undefined;
    }
    
    try {
      return await this.db.get('relays', url);
    } catch (error) {
      this.logger.error(`Error getting relay ${url}`, error);
      return undefined;
    }
  }

  async getAllRelays(): Promise<(Relay & { nip11?: Nip11Info })[]> {
    if (!this.db) {
      this.logger.error('Database not initialized');
      return [];
    }
    
    try {
      return await this.db.getAll('relays');
    } catch (error) {
      this.logger.error('Error getting all relays', error);
      return [];
    }
  }

  async deleteRelay(url: string): Promise<void> {
    if (!this.db) {
      this.logger.error('Database not initialized');
      return;
    }
    
    try {
      await this.db.delete('relays', url);
      this.logger.debug(`Deleted relay from IndexedDB: ${url}`);
      await this.updateStats();
    } catch (error) {
      this.logger.error(`Error deleting relay ${url}`, error);
    }
  }

  // User metadata operations
  async saveUserMetadata(metadata: UserMetadata): Promise<void> {
    if (!this.db) {
      this.logger.error('Database not initialized');
      return;
    }
    
    try {
      const enhancedMetadata = {
        ...metadata,
        last_updated: Date.now()
      };
      
      await this.db.put('userMetadata', enhancedMetadata);
      this.logger.debug(`Saved user metadata to IndexedDB: ${metadata.pubkey}`);
      await this.updateStats();
    } catch (error) {
      this.logger.error(`Error saving user metadata for ${metadata.pubkey}`, error);
    }
  }

  async getUserMetadata(pubkey: string): Promise<UserMetadata | undefined> {
    if (!this.db) {
      this.logger.error('Database not initialized');
      return undefined;
    }
    
    try {
      return await this.db.get('userMetadata', pubkey);
    } catch (error) {
      this.logger.error(`Error getting user metadata for ${pubkey}`, error);
      return undefined;
    }
  }

  async getAllUserMetadata(): Promise<UserMetadata[]> {
    if (!this.db) {
      this.logger.error('Database not initialized');
      return [];
    }
    
    try {
      return await this.db.getAll('userMetadata');
    } catch (error) {
      this.logger.error('Error getting all user metadata', error);
      return [];
    }
  }

  async deleteUserMetadata(pubkey: string): Promise<void> {
    if (!this.db) {
      this.logger.error('Database not initialized');
      return;
    }
    
    try {
      await this.db.delete('userMetadata', pubkey);
      this.logger.debug(`Deleted user metadata from IndexedDB: ${pubkey}`);
      await this.updateStats();
    } catch (error) {
      this.logger.error(`Error deleting user metadata for ${pubkey}`, error);
    }
  }

  // User relays operations
  async saveUserRelays(userRelays: UserRelays): Promise<void> {
    if (!this.db) {
      this.logger.error('Database not initialized');
      return;
    }
    
    try {
      const enhancedUserRelays = {
        ...userRelays,
        last_updated: Date.now()
      };
      
      await this.db.put('userRelays', enhancedUserRelays);
      this.logger.debug(`Saved user relays to IndexedDB: ${userRelays.pubkey}`);
      await this.updateStats();
    } catch (error) {
      this.logger.error(`Error saving user relays for ${userRelays.pubkey}`, error);
    }
  }

  async getUserRelays(pubkey: string): Promise<UserRelays | undefined> {
    if (!this.db) {
      this.logger.error('Database not initialized');
      return undefined;
    }
    
    try {
      return await this.db.get('userRelays', pubkey);
    } catch (error) {
      this.logger.error(`Error getting user relays for ${pubkey}`, error);
      return undefined;
    }
  }

  async getAllUserRelays(): Promise<UserRelays[]> {
    if (!this.db) {
      this.logger.error('Database not initialized');
      return [];
    }
    
    try {
      return await this.db.getAll('userRelays');
    } catch (error) {
      this.logger.error('Error getting all user relays', error);
      return [];
    }
  }

  async deleteUserRelays(pubkey: string): Promise<void> {
    if (!this.db) {
      this.logger.error('Database not initialized');
      return;
    }
    
    try {
      await this.db.delete('userRelays', pubkey);
      this.logger.debug(`Deleted user relays from IndexedDB: ${pubkey}`);
      await this.updateStats();
    } catch (error) {
      this.logger.error(`Error deleting user relays for ${pubkey}`, error);
    }
  }

  // Clear cache operations (keeping current user data)
  async clearCache(currentUserPubkey: string): Promise<void> {
    if (!this.db) {
      this.logger.error('Database not initialized');
      return;
    }
    
    try {
      this.logger.info('Clearing cache while preserving current user data');
      
      // Get all user metadata and filter out the current user
      const allUserMetadata = await this.getAllUserMetadata();
      for (const metadata of allUserMetadata) {
        if (metadata.pubkey !== currentUserPubkey) {
          await this.deleteUserMetadata(metadata.pubkey);
        }
      }
      
      // Get all user relays and filter out the current user
      const allUserRelays = await this.getAllUserRelays();
      for (const userRelays of allUserRelays) {
        if (userRelays.pubkey !== currentUserPubkey) {
          await this.deleteUserRelays(userRelays.pubkey);
        }
      }
      
      // For relays, we keep them all since they're used by all users
      
      this.logger.info('Cache cleared successfully');
      await this.updateStats();
    } catch (error) {
      this.logger.error('Error clearing cache', error);
    }
  }

  // Database statistics
  async updateStats(): Promise<void> {
    if (!this.db) {
      this.logger.error('Database not initialized');
      return;
    }
    
    try {
      const relays = await this.getAllRelays();
      const userMetadata = await this.getAllUserMetadata();
      const userRelays = await this.getAllUserRelays();
      
      // Calculate approximate size
      const relaysSize = JSON.stringify(relays).length;
      const userMetadataSize = JSON.stringify(userMetadata).length;
      const userRelaysSize = JSON.stringify(userRelays).length;
      const totalSize = relaysSize + userMetadataSize + userRelaysSize;
      
      this.dbStats.set({
        relaysCount: relays.length,
        userMetadataCount: userMetadata.length,
        userRelaysCount: userRelays.length,
        estimatedSize: totalSize
      });
      
      this.logger.debug('Database stats updated', this.dbStats());
    } catch (error) {
      this.logger.error('Error updating database stats', error);
    }
  }
  
  // Format size for display
  formatSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
