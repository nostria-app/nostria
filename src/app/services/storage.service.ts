import { Injectable, inject, signal } from '@angular/core';
import { LoggerService } from './logger.service';
import { Relay } from './relays/relay';
import { openDB, IDBPDatabase, DBSchema, deleteDB } from 'idb';
import { Event, kinds } from 'nostr-tools';
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
  type: string; // 'user', 'relay', 'media', 'server', 'trust', etc.
  updated: number; // Timestamp of last update
  compositeKey?: string; // Composite key for storage (key + type)
  [key: string]: any; // Dynamic entries
}

// Interface for NIP-85 Web of Trust metrics
export interface TrustMetrics {
  rank?: number;
  followers?: number;
  postCount?: number;
  zapAmtRecd?: number;
  zapAmtSent?: number;
  firstCreatedAt?: number;
  replyCount?: number;
  reactionsCount?: number;
  zapCntRecd?: number;
  zapCntSent?: number;
  lastUpdated?: number; // When this data was fetched

  // Additional NIP-85 metrics
  hops?: number;
  personalizedGrapeRank_influence?: number;
  personalizedGrapeRank_average?: number;
  personalizedGrapeRank_confidence?: number;
  personalizedGrapeRank_input?: number;
  personalizedPageRank?: number;
  verifiedFollowerCount?: number;
  verifiedMuterCount?: number;
  verifiedReporterCount?: number;
}

// Interface for notifications
// export interface Notification {
//   id: string;
//   message: string;
//   timestamp: number;
// }

export enum NotificationType {
  // System notifications (technical, not counted in badge)
  RELAY_PUBLISHING = 'relaypublishing',
  GENERAL = 'general',
  ERROR = 'error',
  SUCCESS = 'success',
  WARNING = 'warning',

  // Content notifications (social interactions, counted in badge)
  NEW_FOLLOWER = 'newfollower',
  MENTION = 'mention',
  REPOST = 'repost',
  REPLY = 'reply',
  REACTION = 'reaction',
  ZAP = 'zap',
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
  recipientPubkey?: string; // The pubkey of the account that received this notification
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

// Content notification (social interactions)
export interface ContentNotification extends Notification {
  // The pubkey of the user who triggered the notification (follower, reposter, etc.)
  authorPubkey: string;
  // Optional: the event ID that triggered this notification
  eventId?: string;
  // Optional: the kind of the event that triggered this notification
  kind?: number;
  // Optional: additional metadata
  metadata?: {
    content?: string; // For mentions/replies, the text content
    reactionContent?: string; // For reactions, the emoji/content
    reactionEventId?: string; // For reactions, the reaction event ID (kind 7)
    zapAmount?: number; // For zaps, the amount in sats
    zappedEventId?: string; // For zaps, the event that was zapped (if any)
    zapReceiptId?: string; // For zaps, the zap receipt event ID (kind 9735)
    recipientPubkey?: string; // For profile zaps, the recipient's pubkey
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
  // NIP-42 authentication tracking
  authenticationFailed?: boolean; // If true, relay required auth and we failed to authenticate
  authenticationRequired?: boolean; // If true, relay indicated it requires authentication
  lastAuthAttempt?: number; // timestamp of last authentication attempt in seconds
  authFailureReason?: string; // Reason for authentication failure (e.g., "rejected", "timeout", "no_signer")
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

// Interface for cached feed events stored in IndexedDB
export interface CachedFeedEvent {
  id: string; // composite key: accountPubkey::columnId::eventId
  accountPubkey: string; // The pubkey of the account viewing this feed
  columnId: string; // The column ID this event belongs to
  eventId: string; // The event ID
  event: Event; // The actual event data
  cachedAt: number; // Timestamp when this was cached
}

// Interface for stored direct messages
export interface StoredDirectMessage {
  id: string; // composite key: accountPubkey::chatId::messageId
  accountPubkey: string; // The pubkey of the account that owns this message
  chatId: string; // The chat ID (format: otherPubkey-nip04 or otherPubkey-nip44)
  messageId: string; // The original event ID
  pubkey: string; // The author's pubkey
  created_at: number; // Timestamp in seconds
  content: string; // Decrypted message content
  isOutgoing: boolean; // Whether this is an outgoing message
  tags: string[][]; // Original event tags
  encryptionType: 'nip04' | 'nip44'; // Which encryption was used
  read: boolean; // Whether the message has been read
  received: boolean; // Whether the message was successfully received
  pending?: boolean; // Whether the message is still being sent
  failed?: boolean; // Whether the message failed to send
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
    indexes: {
      'by-timestamp': number;
      'by-recipient': string; // Filter notifications by recipient pubkey
    };
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
  badgeDefinitions: {
    key: string; // composite key: pubkey:d-tag (unique identifier for badge definition)
    value: Event;
    indexes: {
      'by-pubkey': string;
      'by-updated': number;
    };
  };
  eventsCache: {
    key: string; // composite key: accountPubkey::columnId::eventId
    value: CachedFeedEvent;
    indexes: {
      'by-account-column': [string, string]; // [accountPubkey, columnId] for efficient column queries
      'by-cached-at': number; // For cleanup operations
      'by-account': string; // For account-wide operations
    };
  };
  messages: {
    key: string; // composite key: accountPubkey::chatId::messageId
    value: StoredDirectMessage;
    indexes: {
      'by-account-chat': [string, string]; // [accountPubkey, chatId] for efficient chat queries
      'by-created': number; // For sorting by timestamp
      'by-account': string; // For account-wide operations
      'by-chat': string; // For chat-wide operations
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
  private readonly DEFAULT_DB_NAME = 'nostria';
  private readonly DB_NAME_STORAGE_KEY = 'nostria_db_name';
  private readonly DB_VERSION = 9; // Updated for messages table
  private currentDbName: string;

  // Get the database name from localStorage or use default
  private getDbName(): string {
    try {
      const storedName = localStorage.getItem(this.DB_NAME_STORAGE_KEY);
      return storedName || this.DEFAULT_DB_NAME;
    } catch {
      return this.DEFAULT_DB_NAME;
    }
  }

  // Set a new database name in localStorage
  private setDbName(name: string): void {
    try {
      localStorage.setItem(this.DB_NAME_STORAGE_KEY, name);
      this.currentDbName = name;
    } catch (error) {
      this.logger.error('Failed to save database name to localStorage', error);
    }
  }

  // Signal to track database initialization status
  initialized = signal(false);

  // Signal to track storage capabilities and issues
  storageInfo = signal<{
    isIndexedDBAvailable: boolean;
    isPrivateMode: boolean;
    quotaInfo: any;
    initializationAttempts: number;
    lastError?: string;
    isPermanentFailure?: boolean;
  }>({
    isIndexedDBAvailable: false,
    isPrivateMode: false,
    quotaInfo: null,
    initializationAttempts: 0,
    lastError: undefined,
    isPermanentFailure: false,
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

  constructor() {
    this.currentDbName = this.getDbName();
  }

  async init(): Promise<void> {
    this.logger.info('StorageService.init() called');

    if (this.initialized()) {
      this.logger.info('Database already initialized, skipping initialization');
      return;
    }

    try {
      this.logger.info('Starting IndexedDB availability check');

      // Update storage info
      this.storageInfo.update(info => ({
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
      this.storageInfo.update(info => ({ ...info, quotaInfo }));

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
      this.storageInfo.update(info => ({
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
      // Attempt fallback and propagate any errors
      await this.handleInitializationError(error);
    }
  }

  private async createDatabase(): Promise<IDBPDatabase<NostriaDBSchema>> {
    this.logger.debug('Starting IndexedDB database creation/opening', { dbName: this.currentDbName });

    return await openDB<NostriaDBSchema>(this.currentDbName, this.DB_VERSION, {
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
        } else if (oldVersion < 3) {
          // For version 3 upgrade, recreate the events store to ensure all indexes exist
          db.deleteObjectStore('events');
          const eventsStore = db.createObjectStore('events', { keyPath: 'id' });
          eventsStore.createIndex('by-kind', 'kind');
          eventsStore.createIndex('by-pubkey', 'pubkey');
          eventsStore.createIndex('by-created', 'created_at');
          eventsStore.createIndex('by-pubkey-kind', ['pubkey', 'kind']);
          eventsStore.createIndex('by-pubkey-kind-d-tag', ['pubkey', 'kind', 'dTag']);
          this.logger.debug('Recreated events object store with all indexes');
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
          notificationsStore.createIndex('by-recipient', 'recipientPubkey');
          this.logger.debug('Created notifications object store');
        } else if (oldVersion < 6 && db.objectStoreNames.contains('notifications')) {
          // For version 6 upgrade, recreate the notifications store to ensure by-recipient index exists
          // This is needed because some users may have version 5 without the index
          this.logger.info('Upgrading notifications store to version 6 - recreating with proper indexes');
          db.deleteObjectStore('notifications');
          const notificationsStore = db.createObjectStore('notifications', {
            keyPath: 'id',
          });
          notificationsStore.createIndex('by-timestamp', 'timestamp');
          notificationsStore.createIndex('by-recipient', 'recipientPubkey');
          this.logger.debug('Recreated notifications object store with all required indexes');
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

        // Create badge definitions object store
        if (!db.objectStoreNames.contains('badgeDefinitions')) {
          const badgeDefinitionsStore = db.createObjectStore('badgeDefinitions');
          badgeDefinitionsStore.createIndex('by-pubkey', 'pubkey');
          badgeDefinitionsStore.createIndex('by-updated', 'created_at');
          this.logger.debug('Created badgeDefinitions object store');
        }

        // Create events cache object store for feed caching
        if (!db.objectStoreNames.contains('eventsCache')) {
          const eventsCacheStore = db.createObjectStore('eventsCache', {
            keyPath: 'id',
          });
          eventsCacheStore.createIndex('by-account-column', ['accountPubkey', 'columnId']);
          eventsCacheStore.createIndex('by-cached-at', 'cachedAt');
          eventsCacheStore.createIndex('by-account', 'accountPubkey');
          this.logger.debug('Created eventsCache object store');
        }

        // Create messages object store for direct message persistence
        if (!db.objectStoreNames.contains('messages')) {
          const messagesStore = db.createObjectStore('messages', {
            keyPath: 'id',
          });
          messagesStore.createIndex('by-account-chat', ['accountPubkey', 'chatId']);
          messagesStore.createIndex('by-created', 'created_at');
          messagesStore.createIndex('by-account', 'accountPubkey');
          messagesStore.createIndex('by-chat', 'chatId');
          this.logger.debug('Created messages object store');
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

  private async handleInitializationError(error: any): Promise<void> {
    this.logger.error('IndexedDB initialization failed', {
      error: error.message,
      name: error.name,
      stack: error.stack,
      userAgent: navigator.userAgent,
      isPrivateMode: this.detectPrivateMode(),
      storageQuota: this.getStorageQuotaInfo(),
    });

    // Set initialized to false
    this.initialized.set(false);

    // Mark as permanent failure
    this.storageInfo.update(info => ({
      ...info,
      lastError: 'IndexedDB permanently locked or blocked',
      isPermanentFailure: true,
      initializationAttempts: info.initializationAttempts + 1,
    }));

    // Throw error to propagate to app initialization
    throw new Error(
      'IndexedDB is permanently locked or blocked. Please close all browser tabs running Nostria and restart your browser.'
    );
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
    // Check if event has expired according to NIP-40
    if (this.utilities.isEventExpired(event)) {
      this.logger.debug(`Dropping expired event: ${event.id} (kind: ${event.kind})`);
      // If the event already exists in storage, delete it
      await this.deleteEvent(event.id);
      return;
    }

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
          `✅ [Storage] Replaced older event with newer event ${event.id} (kind: ${event.kind}, pubkey: ${event.pubkey.substring(0, 8)}..., old: ${existingEvents[0].created_at}, new: ${event.created_at})`
        );
      } else {
        this.logger.debug(
          `⏭️ [Storage] Skipped saving older replaceable event ${event.id} (kind: ${event.kind}, pubkey: ${event.pubkey.substring(0, 8)}..., existing: ${existingEvents[0].created_at}, received: ${event.created_at})`
        );
      }
    } else {
      // No existing event, just add this one
      await this.db.put('events', event);
      this.logger.debug(`✅ [Storage] Saved new replaceable event ${event.id} (kind: ${event.kind}, pubkey: ${event.pubkey.substring(0, 8)}...)`);
    }
  }

  private async saveParameterizedReplaceableEvent(event: Event): Promise<void> {
    const dTagValue = this.utilities.getDTagValueFromEvent(event);

    if (!dTagValue) {
      this.logger.debug(
        `Parameterized replaceable event ${event.id} has no d tag, storing as regular event`
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
          `Replaced older parameterized event with newer event ${event.id} (kind: ${event.kind}, d: ${dTagValue})`
        );
      } else {
        // this.logger.debug(
        //   `Skipped saving older parameterized replaceable event ${event.id} (kind: ${event.kind}, d: ${dTagValue})`
        // );
      }
    } else {
      // No existing event, just add this one
      await this.db.put('events', enhancedEvent);
      this.logger.debug(
        `Saved new parameterized replaceable event ${event.id} (kind: ${event.kind}, d: ${dTagValue})`
      );
    }
  }

  async getEvent(id: string): Promise<Event | undefined> {
    if (this.useFallbackMode()) {
      const event = this.fallbackStorage.get(`event_${id}`);
      // Check if event has expired and delete it if so
      if (event && this.utilities.isEventExpired(event)) {
        this.logger.debug(`Deleting expired event from fallback: ${id}`);
        this.fallbackStorage.delete(`event_${id}`);
        return undefined;
      }
      return event;
    }

    try {
      const event = await this.db.get('events', id);
      // Check if event has expired and delete it if so
      if (event && this.utilities.isEventExpired(event)) {
        this.logger.debug(`Deleting expired event: ${id} (kind: ${event.kind})`);
        await this.deleteEvent(id);
        return undefined;
      }
      return event;
    } catch (error) {
      this.logger.error(`Error getting event ${id}`, error);
      // Try fallback storage as last resort
      const event = this.fallbackStorage.get(`event_${id}`);
      if (event && this.utilities.isEventExpired(event)) {
        this.fallbackStorage.delete(`event_${id}`);
        return undefined;
      }
      return event;
    }
  }

  async getEventsByKind(kind: number): Promise<Event[]> {
    try {
      const events = await this.db.getAllFromIndex('events', 'by-kind', kind);
      // Filter out expired events and delete them
      const validEvents: Event[] = [];
      for (const event of events) {
        if (this.utilities.isEventExpired(event)) {
          this.logger.debug(`Deleting expired event: ${event.id} (kind: ${event.kind})`);
          await this.deleteEvent(event.id);
        } else {
          validEvents.push(event);
        }
      }
      return validEvents;
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

      if (Array.isArray(pubkey) && pubkey.some(pk => !pk || pk === 'undefined')) {
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
        // Filter out expired events and delete them
        const validEvents: Event[] = [];
        for (const event of allEvents) {
          if (this.utilities.isEventExpired(event)) {
            this.logger.debug(`Deleting expired event: ${event.id} (kind: ${event.kind})`);
            await this.deleteEvent(event.id);
          } else {
            validEvents.push(event);
          }
        }
        return validEvents;
      } else {
        // Handle single pubkey (original behavior)
        const events = await this.db.getAllFromIndex('events', 'by-pubkey', pubkey);
        // Filter out expired events and delete them
        const validEvents: Event[] = [];
        for (const event of events) {
          if (this.utilities.isEventExpired(event)) {
            this.logger.debug(`Deleting expired event: ${event.id} (kind: ${event.kind})`);
            await this.deleteEvent(event.id);
          } else {
            validEvents.push(event);
          }
        }
        return validEvents;
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
      if (!event) {
        return null;
      }
      // Check if event has expired and delete it if so
      if (this.utilities.isEventExpired(event)) {
        this.logger.debug(`Deleting expired event: ${id} (kind: ${event.kind})`);
        await this.deleteEvent(id);
        return null;
      }
      return event;
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

    if (Array.isArray(pubkey) && pubkey.some(pk => !pk || pk === 'undefined')) {
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

      if (Array.isArray(pubkey) && pubkey.some(pk => !pk || pk === 'undefined')) {
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
        // Filter out expired events and delete them
        const validEvents: Event[] = [];
        for (const event of allEvents) {
          if (this.utilities.isEventExpired(event)) {
            this.logger.debug(`Deleting expired event: ${event.id} (kind: ${event.kind})`);
            await this.deleteEvent(event.id);
          } else {
            validEvents.push(event);
          }
        }
        return validEvents;
      } else {
        // Handle single pubkey (original behavior)
        const events = await this.db.getAllFromIndex('events', 'by-pubkey-kind', [pubkey, kind]);
        // Filter out expired events and delete them
        const validEvents: Event[] = [];
        for (const event of events) {
          if (this.utilities.isEventExpired(event)) {
            this.logger.debug(`Deleting expired event: ${event.id} (kind: ${event.kind})`);
            await this.deleteEvent(event.id);
          } else {
            validEvents.push(event);
          }
        }
        return validEvents;
      }
    } catch (error) {
      const pubkeyDisplay = Array.isArray(pubkey) ? `[multiple keys: ${pubkey.length}]` : pubkey;
      this.logger.error(`Error getting events by pubkey ${pubkeyDisplay} and kind ${kind}`, error);
      return [];
    }
  }

  /**
   * Get events by pubkey(s) and kind since a specific timestamp
   * @param pubkey Single pubkey or array of pubkeys
   * @param kind Event kind
   * @param sinceTimestamp Timestamp in seconds (Nostr format)
   * @returns Array of events created after the timestamp
   */
  async getEventsByPubkeyAndKindSince(
    pubkey: string | string[],
    kind: number,
    sinceTimestamp: number
  ): Promise<Event[]> {
    try {
      // Get all events by pubkey and kind
      const events = await this.getEventsByPubkeyAndKind(pubkey, kind);
      
      // Filter events since the timestamp
      return events.filter(event => event.created_at >= sinceTimestamp);
    } catch (error) {
      const pubkeyDisplay = Array.isArray(pubkey) ? `[multiple keys: ${pubkey.length}]` : pubkey;
      this.logger.error(
        `Error getting events by pubkey ${pubkeyDisplay} and kind ${kind} since ${sinceTimestamp}`,
        error
      );
      return [];
    }
  }

  async getParameterizedReplaceableEvent(
    pubkey: string | string[],
    kind: number,
    dTagValue: string
  ): Promise<Event | undefined> {
    try {
      // Validate pubkey parameter
      if (!pubkey || (Array.isArray(pubkey) && pubkey.length === 0)) {
        this.logger.warn('getParameterizedReplaceableEvent called with invalid pubkey:', pubkey);
        return undefined;
      }

      if (Array.isArray(pubkey) && pubkey.some(pk => !pk || pk === 'undefined')) {
        this.logger.warn(
          'getParameterizedReplaceableEvent called with invalid pubkey in array:',
          pubkey
        );
        return undefined;
      }

      if (typeof pubkey === 'string' && (pubkey === 'undefined' || !pubkey.trim())) {
        this.logger.warn(
          'getParameterizedReplaceableEvent called with invalid pubkey string:',
          pubkey
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
          // Filter out expired events and delete them
          const validEvents: Event[] = [];
          for (const event of allEvents) {
            if (this.utilities.isEventExpired(event)) {
              this.logger.debug(`Deleting expired event: ${event.id} (kind: ${event.kind})`);
              await this.deleteEvent(event.id);
            } else {
              validEvents.push(event);
            }
          }
          // Return the most recent one across all pubkeys
          if (validEvents.length > 0) {
            return validEvents.sort((a, b) => b.created_at - a.created_at)[0];
          }
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
          // Filter out expired events and delete them
          const validEvents: Event[] = [];
          for (const event of events) {
            if (this.utilities.isEventExpired(event)) {
              this.logger.debug(`Deleting expired event: ${event.id} (kind: ${event.kind})`);
              await this.deleteEvent(event.id);
            } else {
              validEvents.push(event);
            }
          }
          // Return the most recent one
          if (validEvents.length > 0) {
            return validEvents.sort((a, b) => b.created_at - a.created_at)[0];
          }
        }
        return undefined;
      }
    } catch (error) {
      const pubkeyDisplay = Array.isArray(pubkey) ? `[multiple keys: ${pubkey.length}]` : pubkey;
      this.logger.error(
        `Error getting parameterized replaceable event for pubkey ${pubkeyDisplay}, kind ${kind}, and d-tag ${dTagValue}`,
        error
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
    type: 'user' | 'relay' | 'metric' | 'trust',
    data: Record<string, any>
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
  async getInfo(key: string, type: 'user' | 'relay' | 'metric' | 'trust') {
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
        return records.filter(record => record.key.includes(keyPattern));
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

  /**
   * Save trust metrics for a pubkey
   */
  async saveTrustMetrics(pubkey: string, metrics: TrustMetrics): Promise<void> {
    try {
      const data = {
        ...metrics,
        lastUpdated: Date.now(),
      };
      await this.saveInfo(pubkey, 'trust', data);
      this.logger.debug(`Saved trust metrics for pubkey ${pubkey}`);
    } catch (error) {
      this.logger.error(`Error saving trust metrics for ${pubkey}`, error);
    }
  }

  /**
   * Get trust metrics for a pubkey
   */
  async getTrustMetrics(pubkey: string): Promise<TrustMetrics | null> {
    try {
      const record = await this.getInfo(pubkey, 'trust');
      if (!record) {
        return null;
      }

      // Extract trust metrics from the record using bracket notation
      const metrics: TrustMetrics = {
        rank: record['rank'],
        followers: record['followers'],
        postCount: record['postCount'],
        zapAmtRecd: record['zapAmtRecd'],
        zapAmtSent: record['zapAmtSent'],
        firstCreatedAt: record['firstCreatedAt'],
        replyCount: record['replyCount'],
        reactionsCount: record['reactionsCount'],
        zapCntRecd: record['zapCntRecd'],
        zapCntSent: record['zapCntSent'],
        lastUpdated: record['lastUpdated'],
        hops: record['hops'],
        personalizedGrapeRank_influence: record['personalizedGrapeRank_influence'],
        personalizedGrapeRank_average: record['personalizedGrapeRank_average'],
        personalizedGrapeRank_confidence: record['personalizedGrapeRank_confidence'],
        personalizedGrapeRank_input: record['personalizedGrapeRank_input'],
        personalizedPageRank: record['personalizedPageRank'],
        verifiedFollowerCount: record['verifiedFollowerCount'],
        verifiedMuterCount: record['verifiedMuterCount'],
        verifiedReporterCount: record['verifiedReporterCount'],
      };

      return metrics;
    } catch (error) {
      this.logger.error(`Error getting trust metrics for ${pubkey}`, error);
      return null;
    }
  }

  /**
   * Get all pubkeys with trust metrics, sorted by rank (descending)
   * @param minRank Optional minimum rank filter
   * @param maxRank Optional maximum rank filter
   */
  async getPubkeysByTrustRank(minRank?: number, maxRank?: number): Promise<string[]> {
    try {
      const records = await this.getInfoByType('trust');

      let filtered = records;

      // Apply rank filters if provided
      if (minRank !== undefined || maxRank !== undefined) {
        filtered = records.filter(record => {
          const rank = record['rank'];
          if (rank === undefined) {
            return false;
          }
          if (minRank !== undefined && rank < minRank) {
            return false;
          }
          if (maxRank !== undefined && rank > maxRank) {
            return false;
          }
          return true;
        });
      }

      // Sort by rank (descending - higher rank first)
      filtered.sort((a, b) => (b['rank'] || 0) - (a['rank'] || 0));

      // Return pubkeys
      return filtered.map(record => record.key);
    } catch (error) {
      this.logger.error('Error getting pubkeys by trust rank', error);
      return [];
    }
  }

  /**
   * Delete trust metrics for a pubkey
   */
  async deleteTrustMetrics(pubkey: string): Promise<void> {
    await this.deleteInfoByKeyAndType(pubkey, 'trust');
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
      await deleteDB(this.currentDbName);

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

  /**
   * Recreate the cache database with a new unique name
   * This is useful when the current database is locked and inaccessible
   */
  async recreateCacheDatabase(): Promise<void> {
    try {
      this.logger.info('Recreating cache database with new name');

      // Close the current database connection if it exists
      if (this.db) {
        this.db.close();
      }

      // Generate a new unique database name
      const timestamp = Date.now();
      const newDbName = `${this.DEFAULT_DB_NAME}_${timestamp}`;

      this.logger.info('New database name:', newDbName);

      // Update the database name in localStorage
      this.setDbName(newDbName);

      // Reset initialization status
      this.initialized.set(false);

      // Reset storage info
      this.storageInfo.update(info => ({
        ...info,
        isPermanentFailure: false,
        lastError: undefined,
      }));

      // Initialize the new database
      await this.initDatabase();

      this.logger.info('Cache database recreated successfully with name:', newDbName);
    } catch (error) {
      this.logger.error('Error recreating cache database', error);
      throw error;
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
      return await index.getAll(); // No limit - retrieve all stored notifications
    } catch (error) {
      this.logger.error('Error getting all notifications', error);
      return [];
    }
  }

  async getAllNotificationsForPubkey(pubkey: string): Promise<Notification[]> {
    try {
      this.logger.info(`[getAllNotificationsForPubkey] Querying notifications for pubkey: ${pubkey}`);

      // Get notifications for a specific pubkey, sorted by timestamp (newest first)
      const tx = this.db.transaction('notifications', 'readonly');

      // Get notifications with matching recipientPubkey
      const index = tx.store.index('by-recipient');
      const notificationsWithPubkey = await index.getAll(pubkey);

      this.logger.info(
        `[getAllNotificationsForPubkey] Index query returned ${notificationsWithPubkey.length} notifications`
      );

      if (notificationsWithPubkey.length > 0) {
        this.logger.debug(
          `[getAllNotificationsForPubkey] Sample notification:`,
          notificationsWithPubkey[0]
        );
      }

      // Also get notifications with undefined recipientPubkey (for backward compatibility)
      // These are older notifications or notifications created when account wasn't set
      const allNotifications = await tx.store.getAll();
      const notificationsWithoutPubkey = allNotifications.filter(n => !n.recipientPubkey);

      this.logger.info(
        `[getAllNotificationsForPubkey] Total notifications in DB: ${allNotifications.length}, ` +
        `without pubkey: ${notificationsWithoutPubkey.length}`
      );

      // Combine both sets and deduplicate by ID
      const combinedNotifications = [...notificationsWithPubkey, ...notificationsWithoutPubkey];
      const uniqueNotifications = Array.from(
        new Map(combinedNotifications.map(n => [n.id, n])).values()
      );

      // Sort by timestamp (newest first)
      uniqueNotifications.sort((a, b) => b.timestamp - a.timestamp);

      this.logger.info(
        `[getAllNotificationsForPubkey] Returning ${uniqueNotifications.length} total unique notifications`
      );

      return uniqueNotifications;
    } catch (error) {
      this.logger.error(`Error getting notifications for pubkey ${pubkey}`, error);
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
          navigator.userAgent
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
          `Database not initialized yet, cannot save observed relay stats for ${stats.url}`
        );
        return;
      }

      await this.db.put('observedRelays', stats);
      // Removed debug log to reduce console noise - saves are now throttled
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
          `Database not initialized yet, cannot delete observed relay stats for ${url}`
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
    sortBy: 'eventsReceived' | 'lastUpdated' | 'firstObserved' = 'lastUpdated'
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
        error
      );
    }
  }

  /**
   * Get a specific pubkey-relay mapping
   */
  async getPubkeyRelayMapping(
    pubkey: string,
    relayUrl: string
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
        .filter(mapping => mapping.source !== 'user_list')
        .map(mapping => mapping.relayUrl);
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
        relayUrl
      );
      return mappings.map(mapping => mapping.pubkey);
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
        error
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

  /**
   * Save a badge definition event to IndexedDB
   * Uses composite key: pubkey::slug
   */
  async saveBadgeDefinition(badgeEvent: Event): Promise<void> {
    try {
      if (badgeEvent.kind !== kinds.BadgeDefinition) {
        throw new Error('Event is not a badge definition');
      }

      // Extract the d-tag (slug)
      const dTag = badgeEvent.tags.find(tag => tag[0] === 'd');
      if (!dTag || !dTag[1]) {
        throw new Error('Badge definition missing d-tag (slug)');
      }

      const slug = dTag[1];
      const compositeKey = `${badgeEvent.pubkey}::${slug}`;

      // Check if an existing definition exists
      const existing = await this.db.get('badgeDefinitions', compositeKey);

      // Only save if this is newer or doesn't exist
      if (!existing || badgeEvent.created_at > existing.created_at) {
        await this.db.put('badgeDefinitions', badgeEvent, compositeKey);
        this.logger.debug(`Saved badge definition: ${compositeKey}`);
      }
    } catch (error) {
      this.logger.error('Error saving badge definition', error);
    }
  }

  /**
   * Get a badge definition by pubkey and slug
   */
  async getBadgeDefinition(pubkey: string, slug: string): Promise<Event | null> {
    try {
      const compositeKey = `${pubkey}::${slug}`;
      const badge = await this.db.get('badgeDefinitions', compositeKey);
      return badge || null;
    } catch (error) {
      this.logger.error(`Error getting badge definition ${pubkey}::${slug}`, error);
      return null;
    }
  }

  /**
   * Get all badge definitions by pubkey
   */
  async getBadgeDefinitionsByPubkey(pubkey: string): Promise<Event[]> {
    try {
      const index = this.db.transaction('badgeDefinitions', 'readonly')
        .objectStore('badgeDefinitions')
        .index('by-pubkey');

      const badges = await index.getAll(pubkey);
      return badges || [];
    } catch (error) {
      this.logger.error(`Error getting badge definitions for ${pubkey}`, error);
      return [];
    }
  }

  /**
   * Delete a badge definition
   */
  async deleteBadgeDefinition(pubkey: string, slug: string): Promise<void> {
    try {
      const compositeKey = `${pubkey}::${slug}`;
      await this.db.delete('badgeDefinitions', compositeKey);
      this.logger.debug(`Deleted badge definition: ${compositeKey}`);
    } catch (error) {
      this.logger.error(`Error deleting badge definition ${pubkey}::${slug}`, error);
    }
  }

  // Methods for feed event caching

  /**
   * Save cached events for a feed column
   * Limits to approximately 200 events per column to prevent unbounded growth
   */
  async saveCachedEvents(
    accountPubkey: string,
    columnId: string,
    events: Event[]
  ): Promise<void> {
    try {
      if (!this.initialized()) {
        this.logger.warn('Database not initialized, cannot save cached events');
        return;
      }

      const CACHE_LIMIT = 200;
      const cachedAt = Date.now();

      // Sort events by created_at (newest first) and take the top CACHE_LIMIT
      const eventsToCache = [...events]
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
        .slice(0, CACHE_LIMIT);

      // First, delete existing cached events for this column
      await this.deleteCachedEventsForColumn(accountPubkey, columnId);

      // Then save the new events
      const tx = this.db.transaction('eventsCache', 'readwrite');
      const store = tx.objectStore('eventsCache');

      for (const event of eventsToCache) {
        const cachedEvent: CachedFeedEvent = {
          id: `${accountPubkey}::${columnId}::${event.id}`,
          accountPubkey,
          columnId,
          eventId: event.id,
          event,
          cachedAt,
        };

        await store.put(cachedEvent);
      }

      await tx.done;

      this.logger.debug(
        `💾 Saved ${eventsToCache.length} events to cache for column ${columnId}`
      );
    } catch (error) {
      this.logger.error('Error saving cached events:', error);
    }
  }

  /**
   * Load cached events for a feed column
   */
  async loadCachedEvents(accountPubkey: string, columnId: string): Promise<Event[]> {
    try {
      if (!this.initialized()) {
        this.logger.warn('Database not initialized, cannot load cached events');
        return [];
      }

      const index = this.db
        .transaction('eventsCache', 'readonly')
        .objectStore('eventsCache')
        .index('by-account-column');

      const cachedEvents = await index.getAll([accountPubkey, columnId]);

      // Extract and sort events by created_at (newest first)
      const events = cachedEvents
        .map(cached => cached.event)
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

      if (events.length > 0) {
        this.logger.info(
          `✅ Loaded ${events.length} cached events for column ${columnId}`
        );
      }

      return events;
    } catch (error) {
      this.logger.error('Error loading cached events:', error);
      return [];
    }
  }

  /**
   * Delete cached events for a specific column
   */
  async deleteCachedEventsForColumn(
    accountPubkey: string,
    columnId: string
  ): Promise<void> {
    try {
      if (!this.initialized()) {
        return;
      }

      const index = this.db
        .transaction('eventsCache', 'readonly')
        .objectStore('eventsCache')
        .index('by-account-column');

      const cachedEvents = await index.getAllKeys([accountPubkey, columnId]);

      if (cachedEvents.length === 0) {
        return;
      }

      const tx = this.db.transaction('eventsCache', 'readwrite');
      const store = tx.objectStore('eventsCache');

      for (const key of cachedEvents) {
        await store.delete(key);
      }

      await tx.done;

      this.logger.debug(
        `Deleted ${cachedEvents.length} cached events for column ${columnId}`
      );
    } catch (error) {
      this.logger.error('Error deleting cached events for column:', error);
    }
  }

  /**
   * Delete all cached events for an account
   */
  async deleteCachedEventsForAccount(accountPubkey: string): Promise<void> {
    try {
      if (!this.initialized()) {
        return;
      }

      const index = this.db
        .transaction('eventsCache', 'readonly')
        .objectStore('eventsCache')
        .index('by-account');

      const cachedEvents = await index.getAllKeys(accountPubkey);

      if (cachedEvents.length === 0) {
        return;
      }

      const tx = this.db.transaction('eventsCache', 'readwrite');
      const store = tx.objectStore('eventsCache');

      for (const key of cachedEvents) {
        await store.delete(key);
      }

      await tx.done;

      this.logger.debug(
        `Deleted ${cachedEvents.length} cached events for account ${accountPubkey}`
      );
    } catch (error) {
      this.logger.error('Error deleting cached events for account:', error);
    }
  }

  /**
   * Clean up old cached events across all accounts
   * This method is called periodically to prevent unbounded growth
   * Keeps only the most recent 200 events per column
   */
  async cleanupCachedEvents(): Promise<void> {
    try {
      if (!this.initialized()) {
        return;
      }

      this.logger.info('Starting cleanup of cached events');

      // Get all cached events
      const allCachedEvents = await this.db.getAll('eventsCache');

      // Group by account and column
      const eventsByAccountColumn = new Map<string, CachedFeedEvent[]>();

      for (const cached of allCachedEvents) {
        const key = `${cached.accountPubkey}::${cached.columnId}`;
        if (!eventsByAccountColumn.has(key)) {
          eventsByAccountColumn.set(key, []);
        }
        eventsByAccountColumn.get(key)!.push(cached);
      }

      let totalDeleted = 0;
      const CACHE_LIMIT = 200;

      // For each account-column combination, keep only the newest CACHE_LIMIT events
      for (const [key, events] of eventsByAccountColumn) {
        if (events.length > CACHE_LIMIT) {
          // Sort by event creation time (newest first)
          events.sort((a, b) => (b.event.created_at || 0) - (a.event.created_at || 0));

          // Delete events beyond the limit
          const eventsToDelete = events.slice(CACHE_LIMIT);

          const tx = this.db.transaction('eventsCache', 'readwrite');
          const store = tx.objectStore('eventsCache');

          for (const cached of eventsToDelete) {
            await store.delete(cached.id);
            totalDeleted++;
          }

          await tx.done;

          this.logger.debug(
            `Cleaned up ${eventsToDelete.length} old events for ${key}`
          );
        }
      }

      if (totalDeleted > 0) {
        this.logger.info(`Cleanup complete: removed ${totalDeleted} old cached events`);
      } else {
        this.logger.debug('Cleanup complete: no old events to remove');
      }
    } catch (error) {
      this.logger.error('Error cleaning up cached events:', error);
    }
  }

  /**
   * Get the total count of cached events
   */
  async getCachedEventsCount(): Promise<number> {
    try {
      if (!this.initialized()) {
        return 0;
      }

      return await this.db.count('eventsCache');
    } catch (error) {
      this.logger.error('Error getting cached events count:', error);
      return 0;
    }
  }

  /**
   * Get cached events statistics for debugging
   */
  async getCachedEventsStats(): Promise<{
    totalEvents: number;
    eventsByAccount: Map<string, number>;
    eventsByColumn: Map<string, number>;
  }> {
    try {
      if (!this.initialized()) {
        return {
          totalEvents: 0,
          eventsByAccount: new Map(),
          eventsByColumn: new Map(),
        };
      }

      const allCachedEvents = await this.db.getAll('eventsCache');
      const eventsByAccount = new Map<string, number>();
      const eventsByColumn = new Map<string, number>();

      for (const cached of allCachedEvents) {
        // Count by account
        const accountCount = eventsByAccount.get(cached.accountPubkey) || 0;
        eventsByAccount.set(cached.accountPubkey, accountCount + 1);

        // Count by column (with account prefix)
        const columnKey = `${cached.accountPubkey}::${cached.columnId}`;
        const columnCount = eventsByColumn.get(columnKey) || 0;
        eventsByColumn.set(columnKey, columnCount + 1);
      }

      return {
        totalEvents: allCachedEvents.length,
        eventsByAccount,
        eventsByColumn,
      };
    } catch (error) {
      this.logger.error('Error getting cached events stats:', error);
      return {
        totalEvents: 0,
        eventsByAccount: new Map(),
        eventsByColumn: new Map(),
      };
    }
  }

  /**
   * Migrate feed cache from localStorage to IndexedDB
   * This is a one-time migration for existing users
   */
  async migrateFeedCacheFromLocalStorage(): Promise<{
    success: boolean;
    migratedAccounts: number;
    migratedColumns: number;
    migratedEvents: number;
    errors: string[];
  }> {
    const result = {
      success: true,
      migratedAccounts: 0,
      migratedColumns: 0,
      migratedEvents: 0,
      errors: [] as string[],
    };

    try {
      const CACHE_STORAGE_KEY = 'nostria-feed-cache';
      const MIGRATION_COMPLETE_KEY = 'nostria-feed-cache-migrated';

      // Check if migration already completed
      const migrationComplete = localStorage.getItem(MIGRATION_COMPLETE_KEY);
      if (migrationComplete === 'true') {
        this.logger.info('Feed cache migration already completed, skipping');
        return result;
      }

      // Get old cache data from localStorage
      const oldCacheJson = localStorage.getItem(CACHE_STORAGE_KEY);
      if (!oldCacheJson) {
        this.logger.info('No feed cache data found in localStorage, marking migration complete');
        localStorage.setItem(MIGRATION_COMPLETE_KEY, 'true');
        return result;
      }

      this.logger.info('Starting feed cache migration from localStorage to IndexedDB');

      // Parse old cache structure: { pubkey: { columnId: Event[] } }
      let oldCache: Record<string, Record<string, Event[]>>;
      try {
        oldCache = JSON.parse(oldCacheJson);
      } catch (parseError) {
        const errorMsg = 'Failed to parse localStorage cache data';
        this.logger.error(errorMsg, parseError);
        result.errors.push(errorMsg);
        result.success = false;
        return result;
      }

      // Migrate each account's cached events
      for (const [accountPubkey, columnData] of Object.entries(oldCache)) {
        result.migratedAccounts++;

        for (const [columnId, events] of Object.entries(columnData)) {
          if (!Array.isArray(events) || events.length === 0) {
            continue;
          }

          result.migratedColumns++;

          try {
            // Save to IndexedDB using the new cache method
            await this.saveCachedEvents(accountPubkey, columnId, events);
            result.migratedEvents += events.length;

            this.logger.debug(
              `Migrated ${events.length} events for account ${accountPubkey}, column ${columnId}`
            );
          } catch (error) {
            const errorMsg = `Failed to migrate column ${columnId} for account ${accountPubkey}`;
            this.logger.error(errorMsg, error);
            result.errors.push(errorMsg);
            result.success = false;
          }
        }
      }

      // Mark migration as complete
      localStorage.setItem(MIGRATION_COMPLETE_KEY, 'true');

      // Clean up old localStorage cache
      localStorage.removeItem(CACHE_STORAGE_KEY);

      this.logger.info('Feed cache migration completed', {
        accounts: result.migratedAccounts,
        columns: result.migratedColumns,
        events: result.migratedEvents,
        errors: result.errors.length,
      });
    } catch (error) {
      const errorMsg = 'Unexpected error during feed cache migration';
      this.logger.error(errorMsg, error);
      result.errors.push(errorMsg);
      result.success = false;
    }

    return result;
  }

  // ============================================================================
  // Direct Messages Storage Methods
  // ============================================================================

  /**
   * Save a direct message to the database
   */
  async saveDirectMessage(message: StoredDirectMessage): Promise<void> {
    try {
      if (!this.initialized()) {
        this.logger.warn('Storage not initialized, cannot save direct message');
        return;
      }

      await this.db.put('messages', message);
      this.logger.debug(`Saved direct message ${message.messageId} to database`);
    } catch (error) {
      this.logger.error('Error saving direct message:', error);
      throw error;
    }
  }

  /**
   * Save multiple direct messages in batch
   */
  async saveDirectMessages(messages: StoredDirectMessage[]): Promise<void> {
    try {
      if (!this.initialized()) {
        this.logger.warn('Storage not initialized, cannot save direct messages');
        return;
      }

      const tx = this.db.transaction('messages', 'readwrite');
      await Promise.all([...messages.map(msg => tx.store.put(msg)), tx.done]);

      this.logger.debug(`Saved ${messages.length} direct messages to database`);
    } catch (error) {
      this.logger.error('Error saving direct messages:', error);
      throw error;
    }
  }

  /**
   * Get all messages for a specific chat
   */
  async getMessagesForChat(
    accountPubkey: string,
    chatId: string
  ): Promise<StoredDirectMessage[]> {
    try {
      if (!this.initialized()) {
        this.logger.warn('Storage not initialized, cannot get messages');
        return [];
      }

      const messages = await this.db.getAllFromIndex('messages', 'by-account-chat', [
        accountPubkey,
        chatId,
      ]);

      return messages.sort((a, b) => a.created_at - b.created_at);
    } catch (error) {
      this.logger.error('Error getting messages for chat:', error);
      return [];
    }
  }

  /**
   * Get all chats for an account (returns unique chat IDs with message counts)
   */
  async getChatsForAccount(accountPubkey: string): Promise<
    {
      chatId: string;
      messageCount: number;
      lastMessageTime: number;
      unreadCount: number;
    }[]
  > {
    try {
      if (!this.initialized()) {
        this.logger.warn('Storage not initialized, cannot get chats');
        return [];
      }

      const messages = await this.db.getAllFromIndex('messages', 'by-account', accountPubkey);

      // Group messages by chat
      const chatMap = new Map<
        string,
        {
          messageCount: number;
          lastMessageTime: number;
          unreadCount: number;
        }
      >();

      for (const message of messages) {
        const existing = chatMap.get(message.chatId);
        if (!existing) {
          chatMap.set(message.chatId, {
            messageCount: 1,
            lastMessageTime: message.created_at,
            unreadCount: !message.read && !message.isOutgoing ? 1 : 0,
          });
        } else {
          existing.messageCount++;
          existing.lastMessageTime = Math.max(existing.lastMessageTime, message.created_at);
          if (!message.read && !message.isOutgoing) {
            existing.unreadCount++;
          }
        }
      }

      return Array.from(chatMap.entries()).map(([chatId, stats]) => ({
        chatId,
        ...stats,
      }));
    } catch (error) {
      this.logger.error('Error getting chats for account:', error);
      return [];
    }
  }

  /**
   * Mark a message as read
   */
  async markMessageAsRead(accountPubkey: string, chatId: string, messageId: string): Promise<void> {
    try {
      if (!this.initialized()) {
        this.logger.warn('Storage not initialized, cannot mark message as read');
        return;
      }

      const id = `${accountPubkey}::${chatId}::${messageId}`;
      const message = await this.db.get('messages', id);

      if (message) {
        message.read = true;
        await this.db.put('messages', message);
        this.logger.debug(`Marked message ${messageId} as read`);
      }
    } catch (error) {
      this.logger.error('Error marking message as read:', error);
    }
  }

  /**
   * Mark all messages in a chat as read
   */
  async markChatAsRead(accountPubkey: string, chatId: string): Promise<void> {
    try {
      if (!this.initialized()) {
        this.logger.warn('Storage not initialized, cannot mark chat as read');
        return;
      }

      const messages = await this.getMessagesForChat(accountPubkey, chatId);
      const unreadMessages = messages.filter(msg => !msg.read && !msg.isOutgoing);

      if (unreadMessages.length === 0) {
        return;
      }

      const tx = this.db.transaction('messages', 'readwrite');
      await Promise.all([
        ...unreadMessages.map(msg => {
          msg.read = true;
          return tx.store.put(msg);
        }),
        tx.done,
      ]);

      this.logger.debug(`Marked ${unreadMessages.length} messages as read in chat ${chatId}`);
    } catch (error) {
      this.logger.error('Error marking chat as read:', error);
    }
  }

  /**
   * Delete a specific message
   */
  async deleteDirectMessage(accountPubkey: string, chatId: string, messageId: string): Promise<void> {
    try {
      if (!this.initialized()) {
        this.logger.warn('Storage not initialized, cannot delete message');
        return;
      }

      const id = `${accountPubkey}::${chatId}::${messageId}`;
      await this.db.delete('messages', id);
      this.logger.debug(`Deleted message ${messageId}`);
    } catch (error) {
      this.logger.error('Error deleting message:', error);
    }
  }

  /**
   * Delete all messages for a specific chat
   */
  async deleteChat(accountPubkey: string, chatId: string): Promise<void> {
    try {
      if (!this.initialized()) {
        this.logger.warn('Storage not initialized, cannot delete chat');
        return;
      }

      const messages = await this.getMessagesForChat(accountPubkey, chatId);

      const tx = this.db.transaction('messages', 'readwrite');
      await Promise.all([...messages.map(msg => tx.store.delete(msg.id)), tx.done]);

      this.logger.debug(`Deleted ${messages.length} messages from chat ${chatId}`);
    } catch (error) {
      this.logger.error('Error deleting chat:', error);
    }
  }

  /**
   * Delete all messages for an account
   */
  async deleteAllMessagesForAccount(accountPubkey: string): Promise<void> {
    try {
      if (!this.initialized()) {
        this.logger.warn('Storage not initialized, cannot delete messages');
        return;
      }

      const messages = await this.db.getAllFromIndex('messages', 'by-account', accountPubkey);

      const tx = this.db.transaction('messages', 'readwrite');
      await Promise.all([...messages.map(msg => tx.store.delete(msg.id)), tx.done]);

      this.logger.debug(`Deleted ${messages.length} messages for account ${accountPubkey}`);
    } catch (error) {
      this.logger.error('Error deleting messages for account:', error);
    }
  }

  /**
   * Get the most recent message timestamp for an account (used for pagination)
   */
  async getMostRecentMessageTimestamp(accountPubkey: string): Promise<number> {
    try {
      if (!this.initialized()) {
        return 0;
      }

      const messages = await this.db.getAllFromIndex('messages', 'by-account', accountPubkey);

      if (messages.length === 0) {
        return 0;
      }

      return Math.max(...messages.map(msg => msg.created_at));
    } catch (error) {
      this.logger.error('Error getting most recent message timestamp:', error);
      return 0;
    }
  }

  /**
   * Check if a message already exists in the database
   */
  async messageExists(accountPubkey: string, chatId: string, messageId: string): Promise<boolean> {
    try {
      if (!this.initialized()) {
        return false;
      }

      const id = `${accountPubkey}::${chatId}::${messageId}`;
      const message = await this.db.get('messages', id);
      return !!message;
    } catch (error) {
      this.logger.error('Error checking if message exists:', error);
      return false;
    }
  }
}
