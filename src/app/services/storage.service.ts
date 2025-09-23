import { Injectable, inject, signal } from '@angular/core';
import { LoggerService } from './logger.service';
import { Relay } from './relays/relay';
import { openDB, IDBPDatabase, DBSchema, deleteDB } from 'idb';
import { Event } from 'nostr-tools';
import { UtilitiesService } from './utilities.service';

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
    kinds?: Record<
      number,
      {
        max_bytes?: number;
        max_time?: number;
        count?: number;
      }
    >;
  };
  icon?: string;
  last_checked?: number;
}

// Interface for raw event data storage
export interface NostrEventData<T = any> {
  pubkey?: string; // Public key of the user
  content: Partial<T>; // Parsed JSON content
  tags: string[][]; // Original tags array
  // raw?: string;        // Optional original JSON string
  updated?: number; // Timestamp of the last update
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
  tags?: string[][]; // Add tags field to store event tags
  eventData?: NostrEventData; // New field to store full content and tags
  last_updated?: number;
}

// Interface for user relays
export interface UserRelays {
  pubkey: string;
  relays: string[];
  updated: number;
}

// Interface for the dynamic info records
export interface InfoRecord {
  key: string; // URL or hex pubkey
  type: string; // 'user', 'relay', 'media', 'server', etc.
  updated: number; // Timestamp of last update
  compositeKey?: string; // Composite key for storage (key + type)
  [key: string]: any; // Dynamic entries
}

// Interface for notifications
// export interface Notification {
//   id: string;
//   message: string;
//   timestamp: number;
// }

export enum NotificationType {
  RELAY_PUBLISHING = 'relaypublishing',
  GENERAL = 'general',
  ERROR = 'error',
  SUCCESS = 'success',
  WARNING = 'warning',
}

// User-facing notification types for push notifications
export enum UserNotificationType {
  DIRECT_MESSAGES = 'directmessages',
  REPLIES = 'replies',
  MENTIONS = 'mentions',
  REPOSTS = 'reposts',
  ZAPS = 'zaps',
  NEWS = 'news',
  APP_UPDATES = 'appupdates',
}

// Interface for device notification preferences
export interface DeviceNotificationPreferences {
  deviceId: string;
  preferences: Record<UserNotificationType, boolean>;
}

export interface Notification {
  id: string;
  type: NotificationType;
  timestamp: number;
  read: boolean;
  title: string;
  message?: string;
}

export interface RelayPublishingNotification extends Notification {
  event: Event;
  relayPromises?: RelayPublishPromise[];
  complete: boolean;
}

// Track status of publishing to an individual relay
export interface RelayPublishPromise {
  relayUrl: string;
  status: 'pending' | 'success' | 'failed';
  promise?: Promise<any>;
  error?: any;
}

// General notification
export interface GeneralNotification extends Notification {
  action?: {
    label: string;
    callback: () => void;
  };
}

// Interface for observed relay statistics stored in IndexedDB
export interface ObservedRelayStats {
  url: string; // Primary key
  isConnected: boolean;
  isOffline: boolean;
  eventsReceived: number;
  lastConnectionRetry: number; // timestamp in seconds
  lastSuccessfulConnection: number; // timestamp in seconds
  connectionAttempts: number;
  firstObserved: number; // timestamp when first discovered
  lastUpdated: number; // timestamp of last update
  nip11?: Nip11Info; // NIP-11 relay information if available
}

// Interface for pubkey-relay mapping stored in IndexedDB
export interface PubkeyRelayMapping {
  id: string; // composite key: pubkey::relayUrl
  pubkey: string;
  relayUrl: string;
  source: 'hint' | 'user_list' | 'discovery'; // How this mapping was discovered
  firstSeen: number; // timestamp when first discovered
  lastSeen: number; // timestamp when last seen
  eventCount: number; // Number of events seen from this pubkey on this relay
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
    value: NostrEventData<UserMetadata>;
    indexes: { 'by-updated': number };
  };
  userRelays: {
    key: string; // pubkey
    value: UserRelays;
    indexes: { 'by-updated': number };
  };
  events: {
    key: string; // event id
    value: Event;
    indexes: {
      'by-kind': number;
      'by-pubkey': string;
      'by-created': number;
      'by-pubkey-kind': [string, number];
      'by-pubkey-kind-d-tag': [string, number, string]; // For parameterized replaceable events
    };
  };
  info: {
    key: string; // composite key (key::type)
    value: InfoRecord;
    indexes: {
      'by-type': string;
      'by-key': string;
      'by-updated': number;
    };
  };
  notifications: {
    key: string; // notification id
    value: Notification;
    indexes: { 'by-timestamp': number };
  };
  // @ts-ignore TypeScript issue with IndexedDB schema value types
  observedRelays: {
    key: string;
    value: ObservedRelayStats;
    indexes: {
      'by-last-updated': number;
      'by-first-observed': number;
      'by-events-received': number;
      'by-connection-status': boolean;
    };
  };
  // @ts-ignore TypeScript issue with IndexedDB schema value types
  pubkeyRelayMappings: {
    key: string;
    value: PubkeyRelayMapping;
    indexes: {
      'by-pubkey': string;
      'by-relay-url': string;
      'by-last-seen': number;
      'by-source': string;
    };
  };
}

@Injectable({
  providedIn: 'root',
})
export class StorageService {
  private readonly logger = inject(LoggerService);
  private readonly utilities = inject(UtilitiesService);
  private db!: IDBPDatabase<NostriaDBSchema>;
  private readonly DB_NAME = 'nostria';
  private readonly DB_VERSION = 2;

  // Signal to track database initialization status
  initialized = signal(false);

  // Signal to track storage capabilities and issues
  storageInfo = signal<{
    isIndexedDBAvailable: boolean;
    isPrivateMode: boolean;
    quotaInfo: any;
    initializationAttempts: number;
    lastError?: string;
  }>({
    isIndexedDBAvailable: false,
    isPrivateMode: false,
    quotaInfo: null,
    initializationAttempts: 0,
    lastError: undefined,
  });

  // Database stats
  dbStats = signal<{
    relaysCount: number;
    // userMetadataCount: number;
    // userRelaysCount: number;
    eventsCount: number;
    infoCount: number; // Added for info records
    estimatedSize: number;
  }>({
    relaysCount: 0,
    // userMetadataCount: 0,
    // userRelaysCount: 0,
    eventsCount: 0,
    infoCount: 0,
    estimatedSize: 0,
  });

  // Fallback storage using localStorage when IndexedDB fails
  private fallbackStorage = new Map<string, any>();
  useFallbackMode = signal(false);

  constructor() { }

  async init(): Promise<void> {
    this.logger.info('StorageService.init() called');

    if (this.initialized()) {
      this.logger.info('Database already initialized, skipping initialization');
      return;
    }

    try {
      this.logger.info('Starting IndexedDB availability check');

      // Update storage info
      this.storageInfo.update((info) => ({
        ...info,
        isIndexedDBAvailable: 'indexedDB' in window,
        isPrivateMode: this.detectPrivateMode(),
        initializationAttempts: info.initializationAttempts + 1,
      }));

      // Check if IndexedDB is available
      if (!('indexedDB' in window)) {
        throw new Error('IndexedDB is not supported in this browser');
      }

      this.logger.info('IndexedDB is available, proceeding with initialization');

      // Get quota info
      const quotaInfo = await this.getStorageQuotaInfo();
      this.storageInfo.update((info) => ({ ...info, quotaInfo }));

      // Initialize the database
      await this.initDatabase();

      this.logger.info('StorageService initialization completed successfully');
    } catch (error: any) {
      this.logger.error('StorageService initialization failed', {
        error: error?.message || 'Unknown error',
        name: error?.name || 'Unknown',
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
      });

      // Update storage info with error
      this.storageInfo.update((info) => ({
        ...info,
        lastError: error?.message || 'Unknown error',
      }));

      // Still mark as initialized to prevent blocking the app
      this.initialized.set(true);
      throw error; // Re-throw so the app can handle it
    }
  }

  private async initDatabase(): Promise<void> {
    try {
      this.logger.info('Initializing IndexedDB storage');

      // Add timeout to prevent hanging
      const initPromise = this.createDatabase();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('IndexedDB initialization timeout after 10 seconds'));
        }, 10000); // 10 second timeout
      });

      this.db = await Promise.race([initPromise, timeoutPromise]);

      this.logger.info('IndexedDB initialization completed');

      // Set initialized status to true
      this.initialized.set(true);
    } catch (error) {
      this.logger.error('Failed to initialize IndexedDB', error);
      this.handleInitializationError(error);
    }
  }

  private async createDatabase(): Promise<IDBPDatabase<NostriaDBSchema>> {
    this.logger.debug('Starting IndexedDB database creation/opening');

    return await openDB<NostriaDBSchema>(this.DB_NAME, this.DB_VERSION, {
      upgrade: async (db, oldVersion, newVersion) => {
        this.logger.info('Creating database schema', {
          oldVersion,
          newVersion,
        });

        // Create object stores if they don't exist
        if (!db.objectStoreNames.contains('relays')) {
          const relayStore = db.createObjectStore('relays', { keyPath: 'url' });
          relayStore.createIndex('by-status', 'status');
          this.logger.debug('Created relays object store');
        }

        if (!db.objectStoreNames.contains('events')) {
          const eventsStore = db.createObjectStore('events', { keyPath: 'id' });
          eventsStore.createIndex('by-kind', 'kind');
          eventsStore.createIndex('by-pubkey', 'pubkey');
          eventsStore.createIndex('by-created', 'created_at');
          eventsStore.createIndex('by-pubkey-kind', ['pubkey', 'kind']);
          eventsStore.createIndex('by-pubkey-kind-d-tag', ['pubkey', 'kind', 'dTag']);
          this.logger.debug('Created events object store');
        }

        if (!db.objectStoreNames.contains('info')) {
          const infoStore = db.createObjectStore('info', {
            keyPath: 'compositeKey',
          });
          infoStore.createIndex('by-type', 'type');
          infoStore.createIndex('by-key', 'key');
          infoStore.createIndex('by-updated', 'updated');
          this.logger.debug('Created info object store');
        }

        if (!db.objectStoreNames.contains('notifications')) {
          const notificationsStore = db.createObjectStore('notifications', {
            keyPath: 'id',
          });
          notificationsStore.createIndex('by-timestamp', 'timestamp');
          this.logger.debug('Created notifications object store');
        }

        // Create new observed relays object store
        if (!db.objectStoreNames.contains('observedRelays')) {
          const observedRelaysStore = db.createObjectStore('observedRelays', {
            keyPath: 'url',
          });
          observedRelaysStore.createIndex('by-last-updated', 'lastUpdated');
          observedRelaysStore.createIndex('by-first-observed', 'firstObserved');
          observedRelaysStore.createIndex('by-events-received', 'eventsReceived');
          observedRelaysStore.createIndex('by-connection-status', 'isConnected');
          this.logger.debug('Created observedRelays object store');
        }

        // Create new pubkey-relay mappings object store
        if (!db.objectStoreNames.contains('pubkeyRelayMappings')) {
          const pubkeyRelayMappingsStore = db.createObjectStore('pubkeyRelayMappings', {
            keyPath: 'id',
          });
          pubkeyRelayMappingsStore.createIndex('by-pubkey', 'pubkey');
          pubkeyRelayMappingsStore.createIndex('by-relay-url', 'relayUrl');
          pubkeyRelayMappingsStore.createIndex('by-last-seen', 'lastSeen');
          pubkeyRelayMappingsStore.createIndex('by-source', 'source');
          this.logger.debug('Created pubkeyRelayMappings object store');
        }
      },
      blocked: (currentVersion, blockedVersion, event) => {
        this.logger.warn('IndexedDB upgrade blocked', {
          currentVersion,
          blockedVersion,
        });
      },
      blocking: (currentVersion, blockedVersion, event) => {
        this.logger.warn('IndexedDB blocking other connections', {
          currentVersion,
          blockedVersion,
        });
      },
      terminated: () => {
        this.logger.error('IndexedDB connection terminated unexpectedly');
      },
    });
  }

  private handleInitializationError(error: any): void {
    this.logger.error('IndexedDB initialization failed', {
      error: error.message,
      name: error.name,
      stack: error.stack,
      userAgent: navigator.userAgent,
      isPrivateMode: this.detectPrivateMode(),
      storageQuota: this.getStorageQuotaInfo(),
    });

    // Set initialized to false in case of error
    this.initialized.set(false);

    // Attempt to fall back to a simpler database or memory storage
    this.attemptFallbackInitialization();
  }

  private detectPrivateMode(): boolean {
    try {
      // Simple test for private mode
      const testKey = '__test_storage__';
      localStorage.setItem(testKey, 'test');
      localStorage.removeItem(testKey);
      return false;
    } catch {
      return true;
    }
  }

  private async getStorageQuotaInfo(): Promise<any> {
    try {
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        return {
          quota: estimate.quota,
          usage: estimate.usage,
          available: estimate.quota ? estimate.quota - (estimate.usage || 0) : 'unknown',
        };
      }
    } catch (error) {
      this.logger.debug('Could not get storage quota info', error);
    }
    return null;
  }

  private async attemptFallbackInitialization(): Promise<void> {
    this.logger.info('Attempting fallback IndexedDB initialization');

    try {
      // Try to delete and recreate the database
      this.logger.info('Deleting corrupted database');
      await deleteDB(this.DB_NAME);

      // Wait a bit before recreating
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Try again with a simplified approach
      this.logger.info('Recreating database with simplified schema');
      this.db = await openDB<NostriaDBSchema>(this.DB_NAME, 1, {
        upgrade: async (db) => {
          this.logger.info('Creating minimal database schema');

          // Create only essential stores
          if (!db.objectStoreNames.contains('events')) {
            const eventsStore = db.createObjectStore('events', {
              keyPath: 'id',
            });
            eventsStore.createIndex('by-kind', 'kind');
            eventsStore.createIndex('by-pubkey', 'pubkey');
            this.logger.debug('Created minimal events store');
          }
        },
      });

      this.logger.info('Fallback IndexedDB initialization successful');
      this.initialized.set(true);
    } catch (fallbackError) {
      this.logger.error('Fallback initialization also failed', fallbackError);

      // Final fallback: enable memory-only storage mode
      this.logger.warn('Enabling memory-only storage mode due to IndexedDB failure');
      this.useFallbackMode.set(true);
      this.initialized.set(true);

      // Update storage info
      this.storageInfo.update((info) => ({
        ...info,
        lastError: 'Complete IndexedDB failure - using memory storage',
        initializationAttempts: info.initializationAttempts + 1,
      }));
    }
  }

  // Generate a composite key from key and type
  private generateCompositeKey(key: string, type: string): string {
    return `${key}::${type}`;
  }

  // Parse a composite key back into key and type
  private parseCompositeKey(compositeKey: string): {
    key: string;
    type: string;
  } {
    const parts = compositeKey.split('::');
    if (parts.length === 2) {
      return { key: parts[0], type: parts[1] };
    }
    // Fallback in case of invalid format
    return { key: compositeKey, type: 'unknown' };
  }

  // Event classification helper methods
  private isReplaceableEvent(kind: number): boolean {
    return kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000);
  }

  private isRegularEvent(kind: number): boolean {
    return kind === 1 || kind === 2 || (kind >= 4 && kind < 45) || (kind >= 1000 && kind < 10000);
  }

  private isEphemeralEvent(kind: number): boolean {
    return kind >= 20000 && kind < 30000;
  }

  private isParameterizedReplaceableEvent(kind: number): boolean {
    return kind >= 30000 && kind < 40000;
  }

  // Generic event storage methods
  async saveEvent(event: Event): Promise<void> {
    if (this.useFallbackMode()) {
      return this.saveEventToFallback(event);
    }

    try {
      const { kind } = event;

      // Handle according to event classification
      if (this.isReplaceableEvent(kind)) {
        await this.saveReplaceableEvent(event);
      } else if (this.isParameterizedReplaceableEvent(kind)) {
        await this.saveParameterizedReplaceableEvent(event);
      } else {
        // Regular or ephemeral events are stored directly
        const eventToStore: any = { ...event };

        // Add dTag field for indexing if it's a parameterized replaceable event
        if (this.isParameterizedReplaceableEvent(kind)) {
          eventToStore.dTag = this.utilities.getDTagValueFromEvent(event) || '';
        }

        await this.db.put('events', eventToStore);
        this.logger.debug(`Saved event to IndexedDB: ${event.id} (kind: ${event.kind})`);
      }

      await this.updateStats();
    } catch (error) {
      this.logger.error(`Error saving event`, error);
      // Fall back to in-memory storage
      this.saveEventToFallback(event);
    }
  }

  private async saveEventToFallback(event: Event): Promise<void> {
    try {
      const key = `event_${event.id}`;
      this.fallbackStorage.set(key, event);
      this.logger.debug(`Saved event to fallback storage: ${event.id}`);
    } catch (error) {
      this.logger.error(`Failed to save event to fallback storage`, error);
    }
  }

  private async saveReplaceableEvent(event: Event): Promise<void> {
    // For replaceable events, find any existing events from the same pubkey and kind
    const index = this.db.transaction('events', 'readonly').store.index('by-pubkey-kind');

    const existingEvents = await index.getAll([event.pubkey, event.kind]);

    // Only keep the newest event
    if (existingEvents.length > 0) {
      // Sort by created_at to find the most recent one
      existingEvents.sort((a, b) => b.created_at - a.created_at);

      // If this new event is newer than the most recent one, replace it
      if (event.created_at > existingEvents[0].created_at) {
        // Delete all older events
        const tx = this.db.transaction('events', 'readwrite');
        for (const oldEvent of existingEvents) {
          await tx.store.delete(oldEvent.id);
        }

        // Add the new event
        await this.db.put('events', event);
        this.logger.debug(
          `Replaced older event with newer event ${event.id} (kind: ${event.kind})`,
        );
      } else {
        this.logger.debug(
          `Skipped saving older replaceable event ${event.id} (kind: ${event.kind})`,
        );
      }
    } else {
      // No existing event, just add this one
      await this.db.put('events', event);
      this.logger.debug(`Saved new replaceable event ${event.id} (kind: ${event.kind})`);
    }
  }

  private async saveParameterizedReplaceableEvent(event: Event): Promise<void> {
    const dTagValue = this.utilities.getDTagValueFromEvent(event);

    if (!dTagValue) {
      this.logger.debug(
        `Parameterized replaceable event ${event.id} has no d tag, storing as regular event`,
      );
      await this.db.put('events', event);
      return;
    }

    // For parameterized replaceable events, we need pubkey + kind + d-tag value
    const enhancedEvent: any = { ...event, dTag: dTagValue };

    // Find any existing events with the same pubkey, kind, and d-tag
    const index = this.db.transaction('events', 'readonly').store.index('by-pubkey-kind-d-tag');

    const existingEvents = await index.getAll([event.pubkey, event.kind, dTagValue]);

    // Only keep the newest event
    if (existingEvents.length > 0) {
      // Sort by created_at to find the most recent one
      existingEvents.sort((a, b) => b.created_at - a.created_at);

      // If this new event is newer than the most recent one, replace it
      if (event.created_at > existingEvents[0].created_at) {
        // Delete all older events
        const tx = this.db.transaction('events', 'readwrite');
        for (const oldEvent of existingEvents) {
          await tx.store.delete(oldEvent.id);
        }

        // Add the new event
        await this.db.put('events', enhancedEvent);
        this.logger.debug(
          `Replaced older parameterized event with newer event ${event.id} (kind: ${event.kind}, d: ${dTagValue})`,
        );
      } else {
        this.logger.debug(
          `Skipped saving older parameterized replaceable event ${event.id} (kind: ${event.kind}, d: ${dTagValue})`,
        );
      }
    } else {
      // No existing event, just add this one
      await this.db.put('events', enhancedEvent);
      this.logger.debug(
        `Saved new parameterized replaceable event ${event.id} (kind: ${event.kind}, d: ${dTagValue})`,
      );
    }
  }

  async getEvent(id: string): Promise<Event | undefined> {
    if (this.useFallbackMode()) {
      return this.fallbackStorage.get(`event_${id}`);
    }

    try {
      return await this.db.get('events', id);
    } catch (error) {
      this.logger.error(`Error getting event ${id}`, error);
      // Try fallback storage as last resort
      return this.fallbackStorage.get(`event_${id}`);
    }
  }

  async getEventsByKind(kind: number): Promise<Event[]> {
    try {
      return await this.db.getAllFromIndex('events', 'by-kind', kind);
    } catch (error) {
      this.logger.error(`Error getting events by kind ${kind}`, error);
      return [];
    }
  }

  async getEventsByPubkey(pubkey: string | string[]): Promise<Event[]> {
    try {
      // Validate pubkey parameter
      if (!pubkey || (Array.isArray(pubkey) && pubkey.length === 0)) {
        this.logger.warn('getEventsByPubkey called with invalid pubkey:', pubkey);
        return [];
      }

      if (Array.isArray(pubkey) && pubkey.some((pk) => !pk || pk === 'undefined')) {
        this.logger.warn('getEventsByPubkey called with invalid pubkey in array:', pubkey);
        return [];
      }

      if (typeof pubkey === 'string' && (pubkey === 'undefined' || !pubkey.trim())) {
        this.logger.warn('getEventsByPubkey called with invalid pubkey string:', pubkey);
        return [];
      }

      if (Array.isArray(pubkey)) {
        // Handle array of pubkeys
        const allEvents: Event[] = [];
        for (const pk of pubkey) {
          const events = await this.db.getAllFromIndex('events', 'by-pubkey', pk);
          allEvents.push(...events);
        }
        return allEvents;
      } else {
        // Handle single pubkey (original behavior)
        return await this.db.getAllFromIndex('events', 'by-pubkey', pubkey);
      }
    } catch (error) {
      const pubkeyDisplay = Array.isArray(pubkey) ? `[multiple keys: ${pubkey.length}]` : pubkey;
      this.logger.error(`Error getting events by pubkey ${pubkeyDisplay}`, error);
      return [];
    }
  }

  async getEventById(id: string): Promise<Event | null> {
    try {
      const event = await this.db.get('events', id);
      return event || null;
    } catch (error) {
      this.logger.error(`Error getting event by ID ${id}`, error);
      return null;
    }
  }

  async getEventByPubkeyAndKind(pubkey: string | string[], kind: number): Promise<Event | null> {
    // Validate pubkey parameter
    if (!pubkey || (Array.isArray(pubkey) && pubkey.length === 0)) {
      this.logger.warn('getEventByPubkeyAndKind called with invalid pubkey:', pubkey);
      return null;
    }

    if (Array.isArray(pubkey) && pubkey.some((pk) => !pk || pk === 'undefined')) {
      this.logger.warn('getEventByPubkeyAndKind called with invalid pubkey in array:', pubkey);
      return null;
    }

    if (typeof pubkey === 'string' && (pubkey === 'undefined' || !pubkey.trim())) {
      this.logger.warn('getEventByPubkeyAndKind called with invalid pubkey string:', pubkey);
      return null;
    }

    const events = await this.getEventsByPubkeyAndKind(pubkey, kind);

    if (events && events.length > 0) {
      return events[0];
    } else {
      return null;
    }
  }

  async getEventsByPubkeyAndKind(pubkey: string | string[], kind: number): Promise<Event[]> {
    try {
      // Validate pubkey parameter
      if (!pubkey || (Array.isArray(pubkey) && pubkey.length === 0)) {
        this.logger.warn('getEventsByPubkeyAndKind called with invalid pubkey:', pubkey);
        return [];
      }

      if (Array.isArray(pubkey) && pubkey.some((pk) => !pk || pk === 'undefined')) {
        this.logger.warn('getEventsByPubkeyAndKind called with invalid pubkey in array:', pubkey);
        return [];
      }

      if (typeof pubkey === 'string' && (pubkey === 'undefined' || !pubkey.trim())) {
        this.logger.warn('getEventsByPubkeyAndKind called with invalid pubkey string:', pubkey);
        return [];
      }

      if (Array.isArray(pubkey)) {
        // Handle array of pubkeys
        const allEvents: Event[] = [];
        for (const pk of pubkey) {
          const events = await this.db.getAllFromIndex('events', 'by-pubkey-kind', [pk, kind]);
          allEvents.push(...events);
        }
        return allEvents;
      } else {
        // Handle single pubkey (original behavior)
        return await this.db.getAllFromIndex('events', 'by-pubkey-kind', [pubkey, kind]);
      }
    } catch (error) {
      const pubkeyDisplay = Array.isArray(pubkey) ? `[multiple keys: ${pubkey.length}]` : pubkey;
      this.logger.error(`Error getting events by pubkey ${pubkeyDisplay} and kind ${kind}`, error);
      return [];
    }
  }

  async getParameterizedReplaceableEvent(
    pubkey: string | string[],
    kind: number,
    dTagValue: string,
  ): Promise<Event | undefined> {
    try {
      // Validate pubkey parameter
      if (!pubkey || (Array.isArray(pubkey) && pubkey.length === 0)) {
        this.logger.warn('getParameterizedReplaceableEvent called with invalid pubkey:', pubkey);
        return undefined;
      }

      if (Array.isArray(pubkey) && pubkey.some((pk) => !pk || pk === 'undefined')) {
        this.logger.warn(
          'getParameterizedReplaceableEvent called with invalid pubkey in array:',
          pubkey,
        );
        return undefined;
      }

      if (typeof pubkey === 'string' && (pubkey === 'undefined' || !pubkey.trim())) {
        this.logger.warn(
          'getParameterizedReplaceableEvent called with invalid pubkey string:',
          pubkey,
        );
        return undefined;
      }

      if (Array.isArray(pubkey)) {
        // For arrays, get events from all pubkeys and return the most recent one
        const allEvents: Event[] = [];
        for (const pk of pubkey) {
          const events = await this.db.getAllFromIndex('events', 'by-pubkey-kind-d-tag', [
            pk,
            kind,
            dTagValue,
          ]);
          allEvents.push(...events);
        }

        if (allEvents.length > 0) {
          // Return the most recent one across all pubkeys
          return allEvents.sort((a, b) => b.created_at - a.created_at)[0];
        }
        return undefined;
      } else {
        // Original behavior for single pubkey
        const events = await this.db.getAllFromIndex('events', 'by-pubkey-kind-d-tag', [
          pubkey,
          kind,
          dTagValue,
        ]);
        if (events.length > 0) {
          // Return the most recent one
          return events.sort((a, b) => b.created_at - a.created_at)[0];
        }
        return undefined;
      }
    } catch (error) {
      const pubkeyDisplay = Array.isArray(pubkey) ? `[multiple keys: ${pubkey.length}]` : pubkey;
      this.logger.error(
        `Error getting parameterized replaceable event for pubkey ${pubkeyDisplay}, kind ${kind}, and d-tag ${dTagValue}`,
        error,
      );
      return undefined;
    }
  }

  async deleteEvent(id: string): Promise<void> {
    try {
      await this.db.delete('events', id);
      this.logger.debug(`Deleted event from IndexedDB: ${id}`);
      await this.updateStats();
    } catch (error) {
      this.logger.error(`Error deleting event ${id}`, error);
    }
  }

  async saveRelay(relay: Relay, nip11Info?: Nip11Info): Promise<void> {
    try {
      // Create a new object with the clone as the base
      const enhancedRelay: any = { ...relay };

      if (nip11Info) {
        enhancedRelay['nip11'] = {
          ...nip11Info,
          last_checked: Date.now(),
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
    try {
      return await this.db.get('relays', url);
    } catch (error) {
      this.logger.error(`Error getting relay ${url}`, error);
      return undefined;
    }
  }

  async getAllRelays(): Promise<(Relay & { nip11?: Nip11Info })[]> {
    try {
      return await this.db.getAll('relays');
    } catch (error) {
      this.logger.error('Error getting all relays', error);
      return [];
    }
  }

  async deleteRelay(url: string): Promise<void> {
    try {
      await this.db.delete('relays', url);
      this.logger.debug(`Deleted relay from IndexedDB: ${url}`);
      await this.updateStats();
    } catch (error) {
      this.logger.error(`Error deleting relay ${url}`, error);
    }
  }

  async getUserEvents(pubkey: string): Promise<Event[]> {
    try {
      if (!this.db) {
        throw new Error('Database not initialized');
      }

      // Get events by pubkey
      const events = await this.db.getAllFromIndex('events', 'by-pubkey', pubkey);

      return events || [];
    } catch (error) {
      this.logger.error('Failed to get user events', error);
      return [];
    }
  }

  /**
   * Save info with unique key+type combination
   * @param key The key of the info record
   * @param type The type of the info record
   * @param data Additional data to store
   */
  async saveInfo(
    key: string,
    type: 'user' | 'relay' | 'metric',
    data: Record<string, any>,
  ): Promise<void> {
    try {
      const compositeKey = this.generateCompositeKey(key, type);

      // Check if record already exists to update it
      const existingRecord = await this.db.get('info', compositeKey);

      const infoRecord: InfoRecord = {
        key,
        type,
        compositeKey,
        updated: Date.now(),
        ...(existingRecord || {}), // Keep existing data if any
        ...data, // Override with new data
      };

      await this.db.put('info', infoRecord);
      this.logger.debug(`Saved info record to IndexedDB: ${key} (type: ${type})`);
      await this.updateStats();
    } catch (error) {
      this.logger.error(`Error saving info record ${key} (type: ${type})`, error);
    }
  }

  async updateInfo(record: InfoRecord): Promise<void> {
    try {
      record.updated = Date.now();
      await this.db.put('info', record);
      this.logger.debug(`Updated info record to IndexedDB: ${record.key} (type: ${record.type})`);
      await this.updateStats();
    } catch (error) {
      this.logger.error(`Error saving info record ${record.key} (type: ${record.type})`, error);
    }
  }

  /**
   * Get info record by key
   */
  async getInfo(key: string, type: 'user' | 'relay' | 'metric') {
    try {
      const compositeKey = this.generateCompositeKey(key, type);

      // Return all records with the specified key, regardless of type
      return await this.db.get('info', compositeKey);
    } catch (error) {
      this.logger.error(`Error getting info records with key ${key}`, error);
      return undefined;
    }
  }

  /**
   * Get info records by type, optionally filtering by key pattern
   */
  async getInfoByType(type: string, keyPattern?: string): Promise<InfoRecord[]> {
    try {
      const records = await this.db.getAllFromIndex('info', 'by-type', type);

      // If keyPattern is provided, filter the results
      if (keyPattern) {
        return records.filter((record) => record.key.includes(keyPattern));
      }

      return records;
    } catch (error) {
      this.logger.error(`Error getting info records by type ${type}`, error);
      return [];
    }
  }

  async getAllInfo(): Promise<InfoRecord[]> {
    try {
      return await this.db.getAll('info');
    } catch (error) {
      this.logger.error('Error getting all info records', error);
      return [];
    }
  }

  /**
   * Delete a specific info record by key and type
   */
  async deleteInfoByKeyAndType(key: string, type: string): Promise<void> {
    try {
      const compositeKey = this.generateCompositeKey(key, type);
      await this.db.delete('info', compositeKey);
      this.logger.debug(`Deleted info record with key ${key} and type ${type}`);
      await this.updateStats();
    } catch (error) {
      this.logger.error(`Error deleting info record with key ${key} and type ${type}`, error);
    }
  }

  async clearCache(currentUserPubkey: string): Promise<void> {
    try {
      this.logger.info('Clearing cache while preserving current user data');

      // Get all user metadata and filter out the current user
      // const allUserMetadata = await this.getAllUserMetadata();
      // for (const metadata of allUserMetadata) {
      //   if (metadata.pubkey !== currentUserPubkey) {
      //     await this.deleteUserMetadata(metadata.pubkey!);
      //   }
      // }

      // Get all user relays and filter out the current user
      // const allUserRelays = await this.getAllUserRelays();
      // for (const userRelays of allUserRelays) {
      //   if (userRelays.pubkey !== currentUserPubkey) {
      //     await this.deleteUserRelays(userRelays.pubkey);
      //   }
      // }

      // For events, remove all except the current user's
      const tx = this.db.transaction('events', 'readwrite');
      const index = tx.store.index('by-pubkey');
      const events = await index.getAllKeys();

      for (const eventKey of events) {
        const event = await tx.store.get(eventKey as string);
        if (event && event.pubkey !== currentUserPubkey) {
          await tx.store.delete(eventKey as string);
        }
      }

      // For info records, we might want to keep some based on type
      // For example, keep media info for better user experience
      const infoRecords = await this.getAllInfo();
      for (const record of infoRecords) {
        if (
          record.type !== 'media' &&
          !(record.type === 'user' && record.key === currentUserPubkey)
        ) {
          await this.deleteInfoByKeyAndType(record.key, record.type);
        }
      }

      this.logger.info('Cache cleared successfully');
      await this.updateStats();
    } catch (error) {
      this.logger.error('Error clearing cache', error);
    }
  }

  async updateStats(): Promise<void> {
    return;
    // try {
    //   const relays = await this.getAllRelays();
    //   // const userMetadata = await this.getAllUserMetadata();
    //   // const userRelays = await this.getAllUserRelays();
    //   const info = await this.getAllInfo();
    //   const notifications = await this.getAllNotifications();

    //   // Count events (may need optimization for large datasets)
    //   let eventsCount = 0;
    //   try {
    //     // Just get the count without loading all events
    //     const tx = this.db.transaction('events', 'readonly');
    //     eventsCount = await tx.store.count();
    //   } catch (error) {
    //     this.logger.error('Error counting events', error);
    //   }

    //   // Calculate approximate size
    //   const relaysSize = JSON.stringify(relays).length;
    //   // const userMetadataSize = JSON.stringify(userMetadata).length;
    //   // const userRelaysSize = JSON.stringify(userRelays).length;
    //   const infoSize = JSON.stringify(info).length;
    //   const notificationsSize = JSON.stringify(notifications).length;
    //   const eventsSize = eventsCount * 500; // Rough estimation of average event size
    //   const totalSize = relaysSize + eventsSize + infoSize + notificationsSize;

    //   this.dbStats.set({
    //     relaysCount: relays.length,
    //     // userMetadataCount: userMetadata.length,
    //     // userRelaysCount: userRelays.length,
    //     eventsCount,
    //     infoCount: info.length,
    //     estimatedSize: totalSize
    //   });

    //   this.logger.debug('Database stats updated', this.dbStats());
    // } catch (error) {
    //   this.logger.error('Error updating database stats', error);
    // }
  }

  formatSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async wipe(): Promise<void> {
    try {
      this.logger.info('Wiping IndexedDB database');

      // Close the current database connection if it exists
      if (this.db) {
        this.db.close();
      }

      // Delete the entire database
      await deleteDB(this.DB_NAME);

      // Reset initialization status
      this.initialized.set(false);

      // Reset stats
      this.dbStats.set({
        relaysCount: 0,
        // userMetadataCount: 0,
        // userRelaysCount: 0,
        eventsCount: 0,
        infoCount: 0,
        estimatedSize: 0,
      });

      this.logger.info('Database wiped successfully');

      // Re-initialize the database
      await this.initDatabase();
    } catch (error) {
      this.logger.error('Error wiping database', error);
      // Attempt to re-initialize in case of error
      this.initDatabase();
    }
  }

  // Methods for notification storage
  async saveNotification(notification: Notification): Promise<void> {
    try {
      await this.db.put('notifications', notification);
      this.logger.debug(`Saved notification to IndexedDB: ${notification.id}`);
      await this.updateStats();
    } catch (error) {
      this.logger.error(`Error saving notification ${notification.id}`, error);
    }
  }

  async getNotification(id: string): Promise<Notification | undefined> {
    try {
      return await this.db.get('notifications', id);
    } catch (error) {
      this.logger.error(`Error getting notification ${id}`, error);
      return undefined;
    }
  }

  async getAllNotifications(): Promise<Notification[]> {
    try {
      // Get all notifications sorted by timestamp (newest first)
      const tx = this.db.transaction('notifications', 'readonly');
      const index = tx.store.index('by-timestamp');
      return await index.getAll(undefined, 100); // Limit to 100 most recent notifications
    } catch (error) {
      this.logger.error('Error getting all notifications', error);
      return [];
    }
  }

  async deleteNotification(id: string): Promise<void> {
    try {
      await this.db.delete('notifications', id);
      this.logger.debug(`Deleted notification from IndexedDB: ${id}`);
      await this.updateStats();
    } catch (error) {
      this.logger.error(`Error deleting notification ${id}`, error);
    }
  }

  async clearAllNotifications(): Promise<void> {
    try {
      const tx = this.db.transaction('notifications', 'readwrite');
      await tx.store.clear();
      this.logger.debug('Cleared all notifications from IndexedDB');
      await this.updateStats();
    } catch (error) {
      this.logger.error('Error clearing all notifications', error);
    }
  }

  // Diagnostic methods
  async getDiagnosticInfo(): Promise<any> {
    const info = {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      indexedDBSupported: 'indexedDB' in window,
      isPrivateMode: this.detectPrivateMode(),
      quotaInfo: await this.getStorageQuotaInfo(),
      currentStorageInfo: this.storageInfo(),
      initialized: this.initialized(),
      dbConnection: !!this.db,
      platform: {
        isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
          navigator.userAgent,
        ),
        isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent),
        isAndroid: /Android/.test(navigator.userAgent),
        isWebView:
          /(iPhone|iPod|iPad).*AppleWebKit(?!.*Safari)/i.test(navigator.userAgent) ||
          /; wv\)/.test(navigator.userAgent),
      },
      storage: {
        localStorage: this.testLocalStorage(),
        sessionStorage: this.testSessionStorage(),
      },
    };

    this.logger.info('Storage diagnostic info collected', info);
    return info;
  }

  private testLocalStorage(): boolean {
    try {
      const test = '__storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch {
      return false;
    }
  }

  private testSessionStorage(): boolean {
    try {
      const test = '__storage_test__';
      sessionStorage.setItem(test, test);
      sessionStorage.removeItem(test);
      return true;
    } catch {
      return false;
    }
  }

  async checkStorageHealth(): Promise<boolean> {
    try {
      if (!this.db) {
        this.logger.warn('Database connection not available');
        return false;
      }

      // Try a simple operation
      const tx = this.db.transaction('events', 'readonly');
      await tx.store.count();

      this.logger.debug('Storage health check passed');
      return true;
    } catch (error: any) {
      this.logger.error('Storage health check failed', error);
      return false;
    }
  }

  // Methods for observed relay statistics

  /**
   * Save or update observed relay statistics
   */
  async saveObservedRelay(stats: ObservedRelayStats): Promise<void> {
    try {
      // Check if database is initialized
      if (!this.db || !this.initialized()) {
        this.logger.debug(
          `Database not initialized yet, cannot save observed relay stats for ${stats.url}`,
        );
        return;
      }

      await this.db.put('observedRelays', stats);
      this.logger.debug(`Saved observed relay stats for: ${stats.url}`);
    } catch (error) {
      this.logger.error(`Error saving observed relay stats for ${stats.url}`, error);
    }
  }

  /**
   * Get observed relay statistics by URL
   */
  async getObservedRelay(url: string): Promise<ObservedRelayStats | undefined> {
    try {
      // Check if database is initialized
      if (!this.db || !this.initialized()) {
        this.logger.debug(`Database not initialized yet, cannot get observed relay for ${url}`);
        return undefined;
      }

      return await this.db.get('observedRelays', url);
    } catch (error) {
      this.logger.error(`Error getting observed relay stats for ${url}`, error);
      return undefined;
    }
  }

  /**
   * Get all observed relay statistics
   */
  async getAllObservedRelays(): Promise<ObservedRelayStats[]> {
    try {
      // Check if database is initialized
      if (!this.db || !this.initialized()) {
        this.logger.debug('Database not initialized yet, cannot get all observed relays');
        return [];
      }

      return await this.db.getAll('observedRelays');
    } catch (error) {
      this.logger.error('Error getting all observed relay stats', error);
      return [];
    }
  }

  /**
   * Delete observed relay statistics
   */
  async deleteObservedRelay(url: string): Promise<void> {
    try {
      // Check if database is initialized
      if (!this.db || !this.initialized()) {
        this.logger.debug(
          `Database not initialized yet, cannot delete observed relay stats for ${url}`,
        );
        return;
      }

      await this.db.delete('observedRelays', url);
      this.logger.debug(`Deleted observed relay stats for: ${url}`);
    } catch (error) {
      this.logger.error(`Error deleting observed relay stats for ${url}`, error);
    }
  }

  /**
   * Get observed relays sorted by a specific criterion
   */
  async getObservedRelaysSorted(
    sortBy: 'eventsReceived' | 'lastUpdated' | 'firstObserved' = 'lastUpdated',
  ): Promise<ObservedRelayStats[]> {
    try {
      const index =
        sortBy === 'eventsReceived'
          ? 'by-events-received'
          : sortBy === 'firstObserved'
            ? 'by-first-observed'
            : 'by-last-updated';
      return await this.db.getAllFromIndex('observedRelays', index);
    } catch (error) {
      this.logger.error(`Error getting sorted observed relay stats by ${sortBy}`, error);
      return [];
    }
  }

  // Methods for pubkey-relay mappings

  /**
   * Save or update a pubkey-relay mapping
   */
  async savePubkeyRelayMapping(mapping: PubkeyRelayMapping): Promise<void> {
    try {
      await this.db.put('pubkeyRelayMappings', mapping);
      this.logger.debug(`Saved pubkey-relay mapping: ${mapping.pubkey} -> ${mapping.relayUrl}`);
    } catch (error) {
      this.logger.error(
        `Error saving pubkey-relay mapping for ${mapping.pubkey} -> ${mapping.relayUrl}`,
        error,
      );
    }
  }

  /**
   * Get a specific pubkey-relay mapping
   */
  async getPubkeyRelayMapping(
    pubkey: string,
    relayUrl: string,
  ): Promise<PubkeyRelayMapping | undefined> {
    try {
      const id = `${pubkey}::${relayUrl}`;
      return await this.db.get('pubkeyRelayMappings', id);
    } catch (error) {
      this.logger.error(`Error getting pubkey-relay mapping for ${pubkey} -> ${relayUrl}`, error);
      return undefined;
    }
  }

  /**
   * Get all relay URLs for a pubkey (excluding kind 10002 relay lists)
   */
  async getRelayUrlsForPubkey(pubkey: string): Promise<string[]> {
    try {
      const mappings = await this.db.getAllFromIndex('pubkeyRelayMappings', 'by-pubkey', pubkey);
      // Filter out user_list source since those are kind 10002 events which should not be included
      return mappings
        .filter((mapping) => mapping.source !== 'user_list')
        .map((mapping) => mapping.relayUrl);
    } catch (error) {
      this.logger.error(`Error getting relay URLs for pubkey ${pubkey}`, error);
      return [];
    }
  }

  /**
   * Get all pubkeys for a relay URL
   */
  async getPubkeysForRelay(relayUrl: string): Promise<string[]> {
    try {
      const mappings = await this.db.getAllFromIndex(
        'pubkeyRelayMappings',
        'by-relay-url',
        relayUrl,
      );
      return mappings.map((mapping) => mapping.pubkey);
    } catch (error) {
      this.logger.error(`Error getting pubkeys for relay ${relayUrl}`, error);
      return [];
    }
  }

  /**
   * Update or create a pubkey-relay mapping from relay hint
   */
  async updatePubkeyRelayMappingFromHint(pubkey: string, relayUrl: string): Promise<void> {
    try {
      const id = `${pubkey}::${relayUrl}`;
      const existing = await this.getPubkeyRelayMapping(pubkey, relayUrl);
      const now = Math.floor(Date.now() / 1000); // Nostr uses seconds

      if (existing) {
        // Update existing mapping
        existing.lastSeen = now;
        existing.eventCount++;
        await this.savePubkeyRelayMapping(existing);
      } else {
        // Create new mapping
        const newMapping: PubkeyRelayMapping = {
          id,
          pubkey,
          relayUrl,
          source: 'hint',
          firstSeen: now,
          lastSeen: now,
          eventCount: 1,
        };
        await this.savePubkeyRelayMapping(newMapping);
      }
    } catch (error) {
      this.logger.error(
        `Error updating pubkey-relay mapping from hint for ${pubkey} -> ${relayUrl}`,
        error,
      );
    }
  }

  /**
   * Clean up old pubkey-relay mappings (older than specified days)
   */
  async cleanupOldPubkeyRelayMappings(olderThanDays = 30): Promise<number> {
    try {
      const cutoffTime = Math.floor(Date.now() / 1000) - olderThanDays * 24 * 60 * 60;
      const allMappings = await this.db.getAll('pubkeyRelayMappings');

      let deletedCount = 0;
      for (const mapping of allMappings) {
        if (mapping.lastSeen < cutoffTime) {
          await this.db.delete('pubkeyRelayMappings', mapping.id);
          deletedCount++;
        }
      }

      this.logger.debug(`Cleaned up ${deletedCount} old pubkey-relay mappings`);
      return deletedCount;
    } catch (error) {
      this.logger.error('Error cleaning up old pubkey-relay mappings', error);
      return 0;
    }
  }
}
