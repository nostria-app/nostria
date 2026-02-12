import { Injectable, inject, signal } from '@angular/core';
import { LoggerService } from './logger.service';
import { Event } from 'nostr-tools';

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
export interface NostrEventData<T = unknown> {
  pubkey?: string; // Public key of the user
  content: Partial<T>; // Parsed JSON content
  tags: string[][]; // Original tags array
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

// Notification type enum
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

// Base notification interface
export interface Notification {
  id: string;
  type: NotificationType;
  timestamp: number;
  read: boolean;
  title: string;
  message?: string;
  recipientPubkey?: string; // The pubkey of the account that received this notification
}

// Relay publishing notification with event tracking
export interface RelayPublishingNotification extends Notification {
  event: Event;
  relayPromises?: RelayPublishPromise[];
  complete: boolean;
}

// Track status of publishing to an individual relay
export interface RelayPublishPromise {
  relayUrl: string;
  status: 'pending' | 'success' | 'failed';
  promise?: Promise<unknown>;
  error?: unknown;
}

// General notification with optional action
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
    customEmojiUrl?: string; // For reactions, the custom emoji image URL (NIP-30)
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

/**
 * Interface for stored direct messages
 */
export interface StoredDirectMessage {
  id: string; // composite key: accountPubkey::chatId::messageId
  accountPubkey: string; // The pubkey of the account that owns this message
  chatId: string; // The chat ID (format: otherPubkey, or legacy: otherPubkey-nip04 or otherPubkey-nip44)
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
  giftWrapId?: string; // For NIP-44 messages, the gift wrap event ID (used to skip re-decryption)
}

/**
 * Interface for cached feed events
 */
export interface CachedFeedEvent {
  id: string; // composite key: accountPubkey::columnId::eventId
  accountPubkey: string; // The pubkey of the account viewing this feed
  columnId: string; // The column ID this event belongs to
  eventId: string; // The event ID
  event: Event; // The actual event data
  cachedAt: number; // Timestamp when this was cached
}

/**
 * Interface for trust metrics data
 */
export interface TrustMetrics {
  authorPubkey?: string;
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
  lastUpdated?: number;
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

/**
 * Interface for info records
 */
export interface InfoRecord {
  key: string;
  type: string;
  updated: number;
  compositeKey?: string;
  [key: string]: unknown;
}

/**
 * Database configuration
 */
const SHARED_DB_NAME = 'nostria-shared';
const ACCOUNT_DB_PREFIX = 'nostria-account-';
const DB_VERSION = 1;

/** Legacy database names to delete during migration */
const LEGACY_DB_NAMES = ['nostria-db', 'nostria'];

/** localStorage key to track that migration to multi-DB has occurred */
const MULTI_DB_VERSION_KEY = 'nostria-multi-db-version';
const MULTI_DB_CURRENT_VERSION = 2;

/**
 * Event kinds that belong in the shared database.
 * Kind 0 = profiles, kind 3 = contacts, kind 10002 = relay lists
 */
const SHARED_EVENT_KINDS = new Set([0, 3, 10002]);

/**
 * Object store names
 */
const STORES = {
  EVENTS: 'events',
  INFO: 'info',
  RELAYS: 'relays',
  NOTIFICATIONS: 'notifications',
  OBSERVED_RELAYS: 'observedRelays',
  PUBKEY_RELAY_MAPPINGS: 'pubkeyRelayMappings',
  BADGE_DEFINITIONS: 'badgeDefinitions',
  EVENTS_CACHE: 'eventsCache',
  MESSAGES: 'messages',
} as const;

/** Stores that live in the shared database */
const SHARED_STORES = new Set([
  STORES.EVENTS,
  STORES.RELAYS,
  STORES.OBSERVED_RELAYS,
  STORES.PUBKEY_RELAY_MAPPINGS,
  STORES.BADGE_DEFINITIONS,
]);

/** Stores that live in the per-account database */
const ACCOUNT_STORES = new Set([
  STORES.EVENTS,
  STORES.INFO,
  STORES.NOTIFICATIONS,
  STORES.EVENTS_CACHE,
  STORES.MESSAGES,
]);

/**
 * Index names for the events store
 */
const EVENT_INDEXES = {
  BY_KIND: 'by-kind',
  BY_PUBKEY: 'by-pubkey',
  BY_CREATED: 'by-created',
  BY_PUBKEY_KIND: 'by-pubkey-kind',
  BY_PUBKEY_KIND_DTAG: 'by-pubkey-kind-d-tag',
} as const;

/**
 * Raw IndexedDB database service for Nostria
 * 
 * This service provides direct access to IndexedDB without using wrapper libraries
 * to avoid potential lock issues and improve performance.
 */
@Injectable({
  providedIn: 'root',
})
export class DatabaseService {
  private readonly logger = inject(LoggerService);

  /** Shared database connection (profiles, contacts, relay lists, badges, relays) */
  private sharedDb: IDBDatabase | null = null;

  /** Per-account database connection (feed events, trust, notifications, messages, cache) */
  private accountDb: IDBDatabase | null = null;

  /** The pubkey of the currently opened account database */
  private currentAccountPubkey: string | null = null;

  /**
   * Extract the d-tag value from a parameterized replaceable event
   * @param event The event to extract d-tag from
   * @returns The d-tag value or null if not found
   */
  private extractDTag(event: Event): string | null {
    // Check if event and tags exist
    if (!event || !event.tags || !Array.isArray(event.tags)) {
      return null;
    }
    const dTag = event.tags.find(tag => tag[0] === 'd');
    return dTag && dTag.length > 1 ? dTag[1] : null;
  }

  /**
   * Check if an event has expired according to NIP-40
   * @param event The event to check
   * @returns true if the event has expired, false otherwise
   */
  private isEventExpired(event: Event): boolean {
    // Check if event and tags exist
    if (!event || !event.tags || !Array.isArray(event.tags)) {
      return false; // No tags means the event doesn't expire
    }

    const expirationTag = event.tags.find(tag => tag[0] === 'expiration');

    if (!expirationTag || expirationTag.length < 2) {
      return false; // No expiration tag means the event doesn't expire
    }

    const expirationTimestamp = parseInt(expirationTag[1], 10);

    if (isNaN(expirationTimestamp)) {
      return false; // Invalid expiration timestamp
    }

    const currentTimestamp = Math.floor(Date.now() / 1000);
    return currentTimestamp >= expirationTimestamp;
  }

  /**
   * Filter out expired events from an array and delete them from the database
   * @param events Array of events to filter
   * @returns Array of non-expired events
   */
  private async filterAndDeleteExpiredEvents(events: Event[]): Promise<Event[]> {
    const validEvents: Event[] = [];
    const expiredEventIds: string[] = [];

    for (const event of events) {
      // Skip null/undefined events
      if (!event) {
        continue;
      }

      if (this.isEventExpired(event)) {
        expiredEventIds.push(event.id);
      } else {
        validEvents.push(event);
      }
    }

    // Delete expired events from database in background
    if (expiredEventIds.length > 0) {
      this.logger.info(`Cleaning up ${expiredEventIds.length} expired events from database`);
      this.deleteEvents(expiredEventIds).catch(err => {
        this.logger.error('Failed to delete expired events:', err);
      });
    }

    return validEvents;
  }
  private initPromise: Promise<void> | null = null;

  // Signal to track initialization status
  readonly initialized = signal(false);

  // Signal to track errors
  readonly lastError = signal<string | null>(null);

  /**
   * Initialize the shared database connection.
   * Call initAccount(pubkey) afterwards to open the per-account DB.
   */
  async init(): Promise<void> {
    // Return existing promise if already initializing
    if (this.initPromise) {
      return this.initPromise;
    }

    // Already initialized shared DB
    if (this.sharedDb) {
      return Promise.resolve();
    }

    this.initPromise = this.performInit();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  /**
   * Perform initialization — open the shared database and run migration if needed
   */
  private async performInit(): Promise<void> {
    // Run migration: delete legacy databases on first launch with multi-DB
    await this.migrateIfNeeded();

    await this.openSharedDatabase();
  }

  /**
   * Initialize the per-account database for the given pubkey.
   * Must be called after init(). Sets initialized to true once both DBs are open.
   */
  async initAccount(pubkey: string): Promise<void> {
    if (!this.sharedDb) {
      throw new Error('Shared database not initialized. Call init() first.');
    }

    // Same account already open
    if (this.currentAccountPubkey === pubkey && this.accountDb) {
      return;
    }

    // Close previous account DB if switching
    this.closeAccountDb();

    await this.openAccountDatabase(pubkey);
    this.currentAccountPubkey = pubkey;
    this.initialized.set(true);
    this.logger.info(`Account database opened for ${pubkey.slice(0, 8)}...`);
  }

  /**
   * Initialize in anonymous/preview mode (no per-account DB).
   * Per-account operations will return empty results / no-op.
   */
  initAnonymous(): void {
    this.currentAccountPubkey = null;
    this.accountDb = null;
    this.initialized.set(true);
    this.logger.info('Initialized in anonymous mode (no account database)');
  }

  /**
   * Switch account database — closes old account DB, opens new one.
   */
  async switchAccount(pubkey: string): Promise<void> {
    this.logger.info(`Switching account database to ${pubkey.slice(0, 8)}...`);
    this.closeAccountDb();
    await this.initAccount(pubkey);
  }

  /**
   * Delete the entire per-account database for a specific pubkey.
   * Useful when deleting an account.
   */
  async deleteAccountData(pubkey: string): Promise<void> {
    // Close if it's the current account
    if (this.currentAccountPubkey === pubkey) {
      this.closeAccountDb();
    }
    const dbName = ACCOUNT_DB_PREFIX + pubkey;
    await this.deleteDatabaseByName(dbName);
    this.logger.info(`Deleted account database for ${pubkey.slice(0, 8)}...`);
  }

  /**
   * Open the shared database
   */
  private openSharedDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.logger.info(`Opening shared database: ${SHARED_DB_NAME} v${DB_VERSION}`);

      const request = indexedDB.open(SHARED_DB_NAME, DB_VERSION);

      const timeout = setTimeout(() => {
        this.logger.error('Shared database open timeout after 10 seconds');
        this.lastError.set('Database open timeout');
        reject(new Error('Shared database open timeout after 10 seconds'));
      }, 10000);

      request.onerror = (event) => {
        clearTimeout(timeout);
        const error = (event.target as IDBOpenDBRequest).error;
        this.logger.error('Failed to open shared database', error);
        this.lastError.set(error?.message || 'Unknown database error');
        reject(error);
      };

      request.onsuccess = (event) => {
        clearTimeout(timeout);
        this.sharedDb = (event.target as IDBOpenDBRequest).result;

        this.sharedDb.onerror = (event) => {
          this.logger.error('Shared database error', (event.target as IDBDatabase)?.name);
        };

        this.sharedDb.onversionchange = () => {
          this.logger.warn('Shared database version changed in another tab, closing connection');
          this.sharedDb?.close();
          this.sharedDb = null;
          this.initialized.set(false);
        };

        this.logger.info('Shared database opened successfully');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        clearTimeout(timeout);
        const db = (event.target as IDBOpenDBRequest).result;
        this.createSharedSchema(db);
      };

      request.onblocked = () => {
        clearTimeout(timeout);
        this.logger.warn('Shared database upgrade blocked - close other tabs');
        this.lastError.set('Database blocked - close other tabs');
        reject(new Error('Database blocked by another tab. Please close all other Nostria tabs and try again.'));
      };
    });
  }

  /**
   * Open a per-account database
   */
  private openAccountDatabase(pubkey: string): Promise<void> {
    const dbName = ACCOUNT_DB_PREFIX + pubkey;

    return new Promise((resolve, reject) => {
      this.logger.info(`Opening account database: ${dbName} v${DB_VERSION}`);

      const request = indexedDB.open(dbName, DB_VERSION);

      const timeout = setTimeout(() => {
        this.logger.error('Account database open timeout after 10 seconds');
        this.lastError.set('Account database open timeout');
        reject(new Error('Account database open timeout after 10 seconds'));
      }, 10000);

      request.onerror = (event) => {
        clearTimeout(timeout);
        const error = (event.target as IDBOpenDBRequest).error;
        this.logger.error('Failed to open account database', error);
        this.lastError.set(error?.message || 'Unknown database error');
        reject(error);
      };

      request.onsuccess = (event) => {
        clearTimeout(timeout);
        this.accountDb = (event.target as IDBOpenDBRequest).result;

        this.accountDb.onerror = (event) => {
          this.logger.error('Account database error', (event.target as IDBDatabase)?.name);
        };

        this.accountDb.onversionchange = () => {
          this.logger.warn('Account database version changed in another tab, closing connection');
          this.accountDb?.close();
          this.accountDb = null;
        };

        this.logger.info('Account database opened successfully');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        clearTimeout(timeout);
        const db = (event.target as IDBOpenDBRequest).result;
        this.createAccountSchema(db);
      };

      request.onblocked = () => {
        clearTimeout(timeout);
        this.logger.warn('Account database upgrade blocked - close other tabs');
        this.lastError.set('Account database blocked - close other tabs');
        reject(new Error('Account database blocked by another tab. Please close all other Nostria tabs and try again.'));
      };
    });
  }

  /**
   * Create schema for the shared database.
   * Stores: events (shared kinds), relays, observedRelays, pubkeyRelayMappings, badgeDefinitions
   */
  private createSharedSchema(db: IDBDatabase): void {
    // Create events store (for shared event kinds: 0, 3, 10002)
    if (!db.objectStoreNames.contains(STORES.EVENTS)) {
      const eventsStore = db.createObjectStore(STORES.EVENTS, { keyPath: 'id' });
      eventsStore.createIndex(EVENT_INDEXES.BY_KIND, 'kind', { unique: false });
      eventsStore.createIndex(EVENT_INDEXES.BY_PUBKEY, 'pubkey', { unique: false });
      eventsStore.createIndex(EVENT_INDEXES.BY_CREATED, 'created_at', { unique: false });
      eventsStore.createIndex(EVENT_INDEXES.BY_PUBKEY_KIND, ['pubkey', 'kind'], { unique: false });
      eventsStore.createIndex(EVENT_INDEXES.BY_PUBKEY_KIND_DTAG, ['pubkey', 'kind', 'dTag'], { unique: false });
      this.logger.debug('Created shared events store');
    }

    // Create relays store
    if (!db.objectStoreNames.contains(STORES.RELAYS)) {
      const relaysStore = db.createObjectStore(STORES.RELAYS, { keyPath: 'url' });
      relaysStore.createIndex('by-status', 'status', { unique: false });
      this.logger.debug('Created relays store');
    }

    // Create observed relays store
    if (!db.objectStoreNames.contains(STORES.OBSERVED_RELAYS)) {
      const observedRelaysStore = db.createObjectStore(STORES.OBSERVED_RELAYS, { keyPath: 'url' });
      observedRelaysStore.createIndex('by-last-updated', 'lastUpdated', { unique: false });
      observedRelaysStore.createIndex('by-first-observed', 'firstObserved', { unique: false });
      observedRelaysStore.createIndex('by-events-received', 'eventsReceived', { unique: false });
      observedRelaysStore.createIndex('by-connection-status', 'isConnected', { unique: false });
      this.logger.debug('Created observedRelays store');
    }

    // Create pubkey relay mappings store
    if (!db.objectStoreNames.contains(STORES.PUBKEY_RELAY_MAPPINGS)) {
      const mappingsStore = db.createObjectStore(STORES.PUBKEY_RELAY_MAPPINGS, { keyPath: 'id' });
      mappingsStore.createIndex('by-pubkey', 'pubkey', { unique: false });
      mappingsStore.createIndex('by-relay-url', 'relayUrl', { unique: false });
      mappingsStore.createIndex('by-last-seen', 'lastSeen', { unique: false });
      mappingsStore.createIndex('by-source', 'source', { unique: false });
      this.logger.debug('Created pubkeyRelayMappings store');
    }

    // Create badge definitions store
    if (!db.objectStoreNames.contains(STORES.BADGE_DEFINITIONS)) {
      const badgeStore = db.createObjectStore(STORES.BADGE_DEFINITIONS, { keyPath: 'id' });
      badgeStore.createIndex('by-pubkey', 'pubkey', { unique: false });
      badgeStore.createIndex('by-updated', 'created_at', { unique: false });
      this.logger.debug('Created badgeDefinitions store');
    }
  }

  /**
   * Create schema for a per-account database.
   * Stores: events (non-shared kinds), info, notifications, eventsCache, messages
   */
  private createAccountSchema(db: IDBDatabase): void {
    // Create events store (for per-account event kinds)
    if (!db.objectStoreNames.contains(STORES.EVENTS)) {
      const eventsStore = db.createObjectStore(STORES.EVENTS, { keyPath: 'id' });
      eventsStore.createIndex(EVENT_INDEXES.BY_KIND, 'kind', { unique: false });
      eventsStore.createIndex(EVENT_INDEXES.BY_PUBKEY, 'pubkey', { unique: false });
      eventsStore.createIndex(EVENT_INDEXES.BY_CREATED, 'created_at', { unique: false });
      eventsStore.createIndex(EVENT_INDEXES.BY_PUBKEY_KIND, ['pubkey', 'kind'], { unique: false });
      eventsStore.createIndex(EVENT_INDEXES.BY_PUBKEY_KIND_DTAG, ['pubkey', 'kind', 'dTag'], { unique: false });
      this.logger.debug('Created account events store');
    }

    // Create info store
    if (!db.objectStoreNames.contains(STORES.INFO)) {
      const infoStore = db.createObjectStore(STORES.INFO, { keyPath: 'compositeKey' });
      infoStore.createIndex('by-type', 'type', { unique: false });
      infoStore.createIndex('by-key', 'key', { unique: false });
      infoStore.createIndex('by-updated', 'updated', { unique: false });
      this.logger.debug('Created info store');
    }

    // Create notifications store
    if (!db.objectStoreNames.contains(STORES.NOTIFICATIONS)) {
      const notificationsStore = db.createObjectStore(STORES.NOTIFICATIONS, { keyPath: 'id' });
      notificationsStore.createIndex('by-timestamp', 'timestamp', { unique: false });
      notificationsStore.createIndex('by-recipient', 'recipientPubkey', { unique: false });
      this.logger.debug('Created notifications store');
    }

    // Create events cache store
    if (!db.objectStoreNames.contains(STORES.EVENTS_CACHE)) {
      const cacheStore = db.createObjectStore(STORES.EVENTS_CACHE, { keyPath: 'id' });
      cacheStore.createIndex('by-account-column', ['accountPubkey', 'columnId'], { unique: false });
      cacheStore.createIndex('by-cached-at', 'cachedAt', { unique: false });
      cacheStore.createIndex('by-account', 'accountPubkey', { unique: false });
      this.logger.debug('Created eventsCache store');
    }

    // Create messages store
    if (!db.objectStoreNames.contains(STORES.MESSAGES)) {
      const messagesStore = db.createObjectStore(STORES.MESSAGES, { keyPath: 'id' });
      messagesStore.createIndex('by-account-chat', ['accountPubkey', 'chatId'], { unique: false });
      messagesStore.createIndex('by-created', 'created_at', { unique: false });
      messagesStore.createIndex('by-account', 'accountPubkey', { unique: false });
      messagesStore.createIndex('by-chat', 'chatId', { unique: false });
      this.logger.debug('Created messages store');
    }
  }

  /**
   * Get the correct database for the events store based on event kind.
   * Shared kinds (0, 3, 10002) → sharedDb, everything else → accountDb.
   */
  private getDbForEventKind(kind: number): IDBDatabase | null {
    return SHARED_EVENT_KINDS.has(kind) ? this.sharedDb : this.accountDb;
  }

  /**
   * Get the correct database for a named store.
   * Events store is special — it exists in both databases, so callers must use
   * getDbForEventKind() for event operations.
   */
  private getDbForStore(storeName: string): IDBDatabase {
    if (storeName === STORES.EVENTS) {
      throw new Error('Use getDbForEventKind() for the events store');
    }

    if ((SHARED_STORES as Set<string>).has(storeName)) {
      if (!this.sharedDb) {
        throw new Error('Shared database not initialized. Call init() first.');
      }
      return this.sharedDb;
    }

    if ((ACCOUNT_STORES as Set<string>).has(storeName)) {
      if (!this.accountDb) {
        throw new Error('Account database not initialized. Call initAccount() first.');
      }
      return this.accountDb;
    }

    throw new Error(`Unknown store: ${storeName}`);
  }

  /**
   * Ensure the shared database is initialized
   */
  private ensureSharedDb(): IDBDatabase {
    if (!this.sharedDb) {
      throw new Error('Shared database not initialized. Call init() first.');
    }
    return this.sharedDb;
  }

  /**
   * Ensure the account database is initialized.
   * Returns null if in anonymous mode (no account DB).
   */
  private getAccountDb(): IDBDatabase | null {
    return this.accountDb;
  }

  /**
   * Ensure the account database is initialized (throws if not).
   */
  private ensureAccountDb(): IDBDatabase {
    if (!this.accountDb) {
      throw new Error('Account database not initialized. Call initAccount() first.');
    }
    return this.accountDb;
  }

  /**
   * Run migration from legacy single database to multi-database setup.
   * Deletes old databases and lets data re-fetch from relays naturally.
   */
  private async migrateIfNeeded(): Promise<void> {
    const currentVersion = parseInt(localStorage.getItem(MULTI_DB_VERSION_KEY) || '0', 10);

    if (currentVersion >= MULTI_DB_CURRENT_VERSION) {
      return; // Already migrated
    }

    this.logger.info('Migrating to multi-database storage (start fresh)');

    // Delete all legacy databases
    for (const legacyName of LEGACY_DB_NAMES) {
      try {
        await this.deleteDatabaseByName(legacyName);
        this.logger.info(`Deleted legacy database: ${legacyName}`);
      } catch (error) {
        this.logger.warn(`Failed to delete legacy database ${legacyName}:`, error);
      }
    }

    localStorage.setItem(MULTI_DB_VERSION_KEY, String(MULTI_DB_CURRENT_VERSION));
    this.logger.info('Migration to multi-database storage complete');
  }

  /**
   * Close the account database connection
   */
  private closeAccountDb(): void {
    if (this.accountDb) {
      this.accountDb.close();
      this.accountDb = null;
      this.currentAccountPubkey = null;
      this.logger.info('Account database connection closed');
    }
  }

  /**
   * Close all database connections
   */
  close(): void {
    if (this.accountDb) {
      this.accountDb.close();
      this.accountDb = null;
      this.currentAccountPubkey = null;
    }
    if (this.sharedDb) {
      this.sharedDb.close();
      this.sharedDb = null;
    }
    this.initialized.set(false);
    this.logger.info('All database connections closed');
  }

  // ============================================================================
  // EVENT OPERATIONS
  // ============================================================================

  /**
   * Save a single event to the database.
   * Routes to shared DB for shared kinds (0, 3, 10002) or account DB for others.
   * Skips saving if the event has already expired (NIP-40)
   */
  async saveEvent(event: Event & { dTag?: string }): Promise<void> {
    // Validate event structure
    if (!event || !event.id || typeof event.kind !== 'number') {
      this.logger.warn('Attempted to save malformed event:', event);
      return;
    }

    // Ensure tags array exists
    if (!event.tags) {
      event.tags = [];
    }

    // Don't save expired events
    if (this.isEventExpired(event)) {
      this.logger.debug(`Skipping save for expired event: ${event.id}`);
      return;
    }

    // Extract and add dTag for parameterized replaceable events (kind 30000-39999)
    if (event.kind >= 30000 && event.kind < 40000) {
      const dTag = this.extractDTag(event);
      if (dTag) {
        event.dTag = dTag;
      }
    }

    const db = this.getDbForEventKind(event.kind);
    if (!db) {
      // Account DB not open (anonymous mode) and this is a per-account event — skip
      this.logger.debug(`Skipping save for event kind ${event.kind} — no account database`);
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS, 'readwrite');
      const store = transaction.objectStore(STORES.EVENTS);

      const request = store.put(event);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Save a replaceable event to the database only if it's newer than the existing one.
   * This is critical for replaceable events (kind 0, 3, 10000-19999) and parameterized
   * replaceable events (kind 30000-39999) to prevent older events from overwriting newer ones.
   *
   * @param event The event to save
   * @returns true if the event was saved, false if a newer event already exists
   */
  async saveReplaceableEvent(event: Event & { dTag?: string }): Promise<boolean> {
    // Validate event structure
    if (!event || !event.id || typeof event.kind !== 'number' || !event.pubkey) {
      this.logger.warn('Attempted to save malformed replaceable event:', event);
      return false;
    }

    // Ensure tags array exists
    if (!event.tags) {
      event.tags = [];
    }

    // Don't save expired events
    if (this.isEventExpired(event)) {
      this.logger.debug(`Skipping save for expired event: ${event.id}`);
      return false;
    }

    let storedEvent: Event | null = null;

    // For parameterized replaceable events (kind 30000-39999), check by pubkey+kind+dTag
    if (event.kind >= 30000 && event.kind < 40000) {
      const dTag = this.extractDTag(event);
      if (dTag) {
        storedEvent = await this.getParameterizedReplaceableEvent(event.pubkey, event.kind, dTag);
      } else {
        this.logger.warn(`Parameterized replaceable event (kind ${event.kind}) missing d-tag: ${event.id}`);
        // Still save it, but log the warning
      }
    } else {
      // For regular replaceable events (kind 0, 3, 10000-19999), check by pubkey+kind
      storedEvent = await this.getEventByPubkeyAndKind(event.pubkey, event.kind);
    }

    if (storedEvent && storedEvent.created_at >= event.created_at) {
      this.logger.debug(
        `Skipping save for older replaceable event (kind ${event.kind}) for pubkey ${event.pubkey.slice(0, 16)}... ` +
        `Stored: ${new Date(storedEvent.created_at * 1000).toISOString()}, ` +
        `Received: ${new Date(event.created_at * 1000).toISOString()}`
      );
      return false;
    }

    await this.saveEvent(event);
    this.logger.debug(
      `Saved replaceable event (kind ${event.kind}) for pubkey ${event.pubkey.slice(0, 16)}... ` +
      `Timestamp: ${new Date(event.created_at * 1000).toISOString()}`
    );
    return true;
  }

  /**
   * Save multiple events in a single transaction per database.
   * Groups events by shared vs per-account and saves them respectively.
   * Filters out expired events (NIP-40) before saving.
   */
  async saveEvents(events: (Event & { dTag?: string })[]): Promise<void> {
    // Filter out malformed and expired events
    const validEvents = events.filter(event => {
      if (!event || !event.id || typeof event.kind !== 'number') {
        this.logger.warn('Skipping malformed event in batch save:', event);
        return false;
      }
      if (!event.tags) {
        event.tags = [];
      }
      return !this.isEventExpired(event);
    });

    if (validEvents.length === 0) return;

    if (validEvents.length !== events.length) {
      this.logger.debug(`Filtered out ${events.length - validEvents.length} invalid/expired events before saving`);
    }

    // Group by destination database
    const sharedEvents: (Event & { dTag?: string })[] = [];
    const accountEvents: (Event & { dTag?: string })[] = [];

    for (const event of validEvents) {
      if (SHARED_EVENT_KINDS.has(event.kind)) {
        sharedEvents.push(event);
      } else {
        accountEvents.push(event);
      }
    }

    const promises: Promise<void>[] = [];

    // Save shared events
    if (sharedEvents.length > 0 && this.sharedDb) {
      promises.push(new Promise((resolve, reject) => {
        const transaction = this.sharedDb!.transaction(STORES.EVENTS, 'readwrite');
        const store = transaction.objectStore(STORES.EVENTS);
        for (const event of sharedEvents) {
          store.put(event);
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      }));
    }

    // Save account events
    if (accountEvents.length > 0 && this.accountDb) {
      promises.push(new Promise((resolve, reject) => {
        const transaction = this.accountDb!.transaction(STORES.EVENTS, 'readwrite');
        const store = transaction.objectStore(STORES.EVENTS);
        for (const event of accountEvents) {
          store.put(event);
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      }));
    }

    await Promise.all(promises);
  }

  /**
   * Get an event by ID.
   * Checks account DB first (more likely for feed content), falls back to shared DB.
   * Checks for expiration (NIP-40) and deletes if expired.
   */
  async getEvent(id: string): Promise<Event | undefined> {
    // Helper to get from a single DB
    const getFromDb = (db: IDBDatabase): Promise<Event | undefined> => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORES.EVENTS, 'readonly');
        const store = transaction.objectStore(STORES.EVENTS);
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    };

    let event: Event | undefined;

    // Check account DB first (most events are per-account)
    if (this.accountDb) {
      event = await getFromDb(this.accountDb);
    }

    // Fall back to shared DB
    if (!event && this.sharedDb) {
      event = await getFromDb(this.sharedDb);
    }

    if (event && this.isEventExpired(event)) {
      this.logger.info(`Event ${id} has expired, deleting from database`);
      this.deleteEvent(id).catch(err => {
        this.logger.error('Failed to delete expired event:', err);
      });
      return undefined;
    }

    return event;
  }

  /**
   * Get an event by ID (alias for getEvent for compatibility with StorageService)
   * Checks for expiration (NIP-40) and deletes if expired
   */
  async getEventById(id: string): Promise<Event | null> {
    const event = await this.getEvent(id);
    return event || null;
  }

  /**
   * Get a single event by pubkey and kind (returns the most recent one)
   * For compatibility with StorageService which returned a single event
   * Expiration filtering is handled by getEventsByPubkeyAndKind
   */
  async getEventByPubkeyAndKind(pubkey: string | string[], kind: number): Promise<Event | null> {
    const events = await this.getEventsByPubkeyAndKind(pubkey, kind);
    if (events.length === 0) {
      return null;
    }
    // Return the most recent event
    return events.sort((a, b) => b.created_at - a.created_at)[0];
  }

  /**
   * Get a parameterized replaceable event by pubkey, kind, and d-tag
   * Returns the most recent matching event
   * Expiration filtering is handled by getEventsByPubkeyKindAndDTag
   */
  async getParameterizedReplaceableEvent(
    pubkey: string,
    kind: number,
    dTagValue: string
  ): Promise<Event | null> {
    const events = await this.getEventsByPubkeyKindAndDTag(pubkey, kind, dTagValue);
    if (events.length === 0) {
      return null;
    }
    // Return the most recent event
    return events.sort((a, b) => b.created_at - a.created_at)[0];
  }

  /**
   * Delete an event by ID.
   * Tries to delete from both databases since we don't know which one holds it.
   */
  async deleteEvent(id: string): Promise<void> {
    const deleteFromDb = (db: IDBDatabase): Promise<void> => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORES.EVENTS, 'readwrite');
        const store = transaction.objectStore(STORES.EVENTS);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    };

    const promises: Promise<void>[] = [];
    if (this.sharedDb) promises.push(deleteFromDb(this.sharedDb));
    if (this.accountDb) promises.push(deleteFromDb(this.accountDb));
    await Promise.all(promises);
  }

  /**
   * Delete multiple events by ID.
   * Tries to delete from both databases.
   */
  async deleteEvents(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    const deleteFromDb = (db: IDBDatabase): Promise<void> => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORES.EVENTS, 'readwrite');
        const store = transaction.objectStore(STORES.EVENTS);
        for (const id of ids) {
          store.delete(id);
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    };

    const promises: Promise<void>[] = [];
    if (this.sharedDb) promises.push(deleteFromDb(this.sharedDb));
    if (this.accountDb) promises.push(deleteFromDb(this.accountDb));
    await Promise.all(promises);
  }

  /**
   * Get events by kind.
   * Routes to the correct database based on the kind.
   * Filters out expired events (NIP-40) and deletes them from the database.
   */
  async getEventsByKind(kind: number): Promise<Event[]> {
    const db = this.getDbForEventKind(kind);
    if (!db) return [];

    const events = await new Promise<Event[]>((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS, 'readonly');
      const store = transaction.objectStore(STORES.EVENTS);
      const index = store.index(EVENT_INDEXES.BY_KIND);

      const request = index.getAll(kind);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    return this.filterAndDeleteExpiredEvents(events);
  }

  /**
   * Get events by kind that have a specific e-tag.
   * Routes to the correct database based on the kind.
   * Filters out expired events (NIP-40).
   */
  async getEventsByKindAndEventTag(kind: number, eventTag: string): Promise<Event[]> {
    const db = this.getDbForEventKind(kind);
    if (!db) return [];

    const events = await new Promise<Event[]>((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS, 'readonly');
      const store = transaction.objectStore(STORES.EVENTS);
      const index = store.index(EVENT_INDEXES.BY_KIND);

      const results: Event[] = [];
      const request = index.openCursor(IDBKeyRange.only(kind));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const eventData = cursor.value as Event;
          if (eventData.tags?.some(tag => tag[0] === 'e' && tag[1] === eventTag)) {
            results.push(eventData);
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = () => reject(request.error);
    });

    return this.filterAndDeleteExpiredEvents(events);
  }

  /**
   * Get events by multiple kinds that have a specific e-tag.
   * May need to query both databases if kinds span shared and per-account.
   * Filters out expired events (NIP-40).
   */
  async getEventsByKindsAndEventTag(kinds: number[], eventTag: string): Promise<Event[]> {
    const queryDb = (db: IDBDatabase, kindsToQuery: number[]): Promise<Event[]> => {
      const kindPromises = kindsToQuery.map(kind => {
        return new Promise<Event[]>((resolve, reject) => {
          const transaction = db.transaction(STORES.EVENTS, 'readonly');
          const store = transaction.objectStore(STORES.EVENTS);
          const index = store.index(EVENT_INDEXES.BY_KIND);

          const results: Event[] = [];
          const request = index.openCursor(IDBKeyRange.only(kind));

          request.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
            if (cursor) {
              const eventData = cursor.value as Event;
              if (eventData.tags?.some(tag => tag[0] === 'e' && tag[1] === eventTag)) {
                results.push(eventData);
              }
              cursor.continue();
            } else {
              resolve(results);
            }
          };

          request.onerror = () => reject(request.error);
        });
      });
      return Promise.all(kindPromises).then(results => results.flat());
    };

    // Split kinds by database
    const sharedKinds = kinds.filter(k => SHARED_EVENT_KINDS.has(k));
    const accountKinds = kinds.filter(k => !SHARED_EVENT_KINDS.has(k));

    const promises: Promise<Event[]>[] = [];
    if (sharedKinds.length > 0 && this.sharedDb) {
      promises.push(queryDb(this.sharedDb, sharedKinds));
    }
    if (accountKinds.length > 0 && this.accountDb) {
      promises.push(queryDb(this.accountDb, accountKinds));
    }

    const allResults = await Promise.all(promises);
    const events = allResults.flat();

    return this.filterAndDeleteExpiredEvents(events);
  }

  /**
   * Get events by pubkey.
   * Queries both databases and merges results since events may be in either.
   * Filters out expired events (NIP-40) and deletes them from the database.
   */
  async getEventsByPubkey(pubkey: string): Promise<Event[]> {
    const queryDb = (db: IDBDatabase): Promise<Event[]> => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORES.EVENTS, 'readonly');
        const store = transaction.objectStore(STORES.EVENTS);
        const index = store.index(EVENT_INDEXES.BY_PUBKEY);
        const request = index.getAll(pubkey);
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    };

    const promises: Promise<Event[]>[] = [];
    if (this.sharedDb) promises.push(queryDb(this.sharedDb));
    if (this.accountDb) promises.push(queryDb(this.accountDb));

    const results = await Promise.all(promises);
    const events = results.flat();

    // Deduplicate by event ID
    const seen = new Set<string>();
    const unique = events.filter(e => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    return this.filterAndDeleteExpiredEvents(unique);
  }

  /**
   * Get events by pubkey and kind — routes to the correct database.
   * Handles both single pubkey and array of pubkeys efficiently.
   * Filters out expired events (NIP-40) and deletes them from the database.
   */
  async getEventsByPubkeyAndKind(pubkey: string | string[], kind: number): Promise<Event[]> {
    const db = this.getDbForEventKind(kind);
    if (!db) return [];

    const pubkeys = Array.isArray(pubkey) ? pubkey : [pubkey];

    // Filter out invalid pubkeys
    const validPubkeys = pubkeys.filter(pk => pk && pk !== 'undefined' && pk.trim());
    if (validPubkeys.length === 0) {
      return [];
    }

    const events = await new Promise<Event[]>((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS, 'readonly');
      const store = transaction.objectStore(STORES.EVENTS);
      const index = store.index(EVENT_INDEXES.BY_PUBKEY_KIND);

      const results: Event[] = [];
      let completed = 0;

      for (const pk of validPubkeys) {
        const request = index.getAll([pk, kind]);

        request.onsuccess = () => {
          if (request.result) {
            results.push(...request.result);
          }
          completed++;

          if (completed === validPubkeys.length) {
            resolve(results);
          }
        };

        request.onerror = () => {
          reject(request.error);
        };
      }

      if (validPubkeys.length === 0) {
        resolve([]);
      }

      transaction.onerror = () => reject(transaction.error);
    });

    return this.filterAndDeleteExpiredEvents(events);
  }

  /**
   * Get events by pubkey(s) and kind since a specific timestamp
   * Optimized to filter during retrieval when possible
   */
  async getEventsByPubkeyAndKindSince(
    pubkey: string | string[],
    kind: number,
    sinceTimestamp: number
  ): Promise<Event[]> {
    // Get all events for the pubkey(s) and kind
    const events = await this.getEventsByPubkeyAndKind(pubkey, kind);

    // Filter by timestamp
    return events.filter(event => event.created_at >= sinceTimestamp);
  }

  /**
   * Get events by pubkey, kind, and d-tag (for parameterized replaceable events).
   * Routes to the correct database based on the kind.
   * Filters out expired events (NIP-40) and deletes them from the database.
   */
  async getEventsByPubkeyKindAndDTag(
    pubkey: string | string[],
    kind: number,
    dTag: string
  ): Promise<Event[]> {
    const db = this.getDbForEventKind(kind);
    if (!db) return [];

    const pubkeys = Array.isArray(pubkey) ? pubkey : [pubkey];

    const validPubkeys = pubkeys.filter(pk => pk && pk !== 'undefined' && pk.trim());
    if (validPubkeys.length === 0) {
      return [];
    }

    const events = await new Promise<Event[]>((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS, 'readonly');
      const store = transaction.objectStore(STORES.EVENTS);
      const index = store.index(EVENT_INDEXES.BY_PUBKEY_KIND_DTAG);

      const results: Event[] = [];
      let completed = 0;

      for (const pk of validPubkeys) {
        const request = index.getAll([pk, kind, dTag]);

        request.onsuccess = () => {
          if (request.result) {
            results.push(...request.result);
          }
          completed++;

          if (completed === validPubkeys.length) {
            resolve(results);
          }
        };

        request.onerror = () => reject(request.error);
      }

      if (validPubkeys.length === 0) {
        resolve([]);
      }

      transaction.onerror = () => reject(transaction.error);
    });

    return this.filterAndDeleteExpiredEvents(events);
  }

  /**
   * Get all events from both databases (use with caution - can be slow for large datasets)
   */
  async getAllEvents(): Promise<Event[]> {
    const queryDb = (db: IDBDatabase): Promise<Event[]> => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORES.EVENTS, 'readonly');
        const store = transaction.objectStore(STORES.EVENTS);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    };

    const promises: Promise<Event[]>[] = [];
    if (this.sharedDb) promises.push(queryDb(this.sharedDb));
    if (this.accountDb) promises.push(queryDb(this.accountDb));

    const results = await Promise.all(promises);
    return results.flat();
  }

  /**
   * Count events in both databases
   */
  async countEvents(): Promise<number> {
    const countInDb = (db: IDBDatabase): Promise<number> => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORES.EVENTS, 'readonly');
        const store = transaction.objectStore(STORES.EVENTS);
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    };

    const promises: Promise<number>[] = [];
    if (this.sharedDb) promises.push(countInDb(this.sharedDb));
    if (this.accountDb) promises.push(countInDb(this.accountDb));

    const counts = await Promise.all(promises);
    return counts.reduce((sum, c) => sum + c, 0);
  }

  /**
   * Clear all cached data from all database stores (both shared and account)
   */
  async clearAllData(): Promise<void> {
    const clearStore = (db: IDBDatabase, storeName: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();
        request.onsuccess = () => {
          this.logger.debug(`Cleared store: ${storeName}`);
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    };

    const promises: Promise<void>[] = [];

    // Clear shared stores
    if (this.sharedDb) {
      for (const storeName of SHARED_STORES) {
        promises.push(clearStore(this.sharedDb, storeName));
      }
    }

    // Clear account stores
    if (this.accountDb) {
      for (const storeName of ACCOUNT_STORES) {
        promises.push(clearStore(this.accountDb, storeName));
      }
    }

    await Promise.all(promises);
    this.logger.info('Cleared all data from databases');
  }

  /**
   * Clear events stores in both databases, plus events cache in account DB
   */
  async clearEvents(): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.sharedDb) {
      promises.push(this.clearStoreInDb(this.sharedDb, STORES.EVENTS));
    }
    if (this.accountDb) {
      promises.push(this.clearStoreInDb(this.accountDb, STORES.EVENTS));
      promises.push(this.clearStoreInDb(this.accountDb, STORES.EVENTS_CACHE));
    }

    await Promise.all(promises);
    this.logger.info('Cleared events from databases');
  }

  /**
   * Clear relays-related stores (in shared DB)
   */
  async clearRelaysData(): Promise<void> {
    if (!this.sharedDb) return;

    await Promise.all([
      this.clearStoreInDb(this.sharedDb, STORES.RELAYS),
      this.clearStoreInDb(this.sharedDb, STORES.OBSERVED_RELAYS),
      this.clearStoreInDb(this.sharedDb, STORES.PUBKEY_RELAY_MAPPINGS),
    ]);
    this.logger.info('Cleared relays data from database');
  }

  /**
   * Helper to clear a specific store in a specific database
   */
  private clearStoreInDb(db: IDBDatabase, storeName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // ============================================================================
  // INFO RECORD OPERATIONS
  // ============================================================================

  /**
   * Save an info record (account DB)
   */
  async saveInfoRecord(record: { compositeKey: string; key: string; type: string; updated: number;[key: string]: unknown }): Promise<void> {
    const db = this.getAccountDb();
    if (!db) return;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.INFO, 'readwrite');
      const store = transaction.objectStore(STORES.INFO);
      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get an info record by composite key (account DB)
   */
  async getInfoRecord(compositeKey: string): Promise<Record<string, unknown> | undefined> {
    const db = this.getAccountDb();
    if (!db) return undefined;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.INFO, 'readonly');
      const store = transaction.objectStore(STORES.INFO);
      const request = store.get(compositeKey);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get info records by type (account DB)
   */
  async getInfoRecordsByType(type: string): Promise<Record<string, unknown>[]> {
    const db = this.getAccountDb();
    if (!db) return [];

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.INFO, 'readonly');
      const store = transaction.objectStore(STORES.INFO);
      const index = store.index('by-type');
      const request = index.getAll(type);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete an info record (account DB)
   */
  async deleteInfoRecord(compositeKey: string): Promise<void> {
    const db = this.getAccountDb();
    if (!db) return;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.INFO, 'readwrite');
      const store = transaction.objectStore(STORES.INFO);
      const request = store.delete(compositeKey);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // ============================================================================
  // INFO CONVENIENCE METHODS (Compatibility with StorageService)
  // ============================================================================

  /**
   * Save info data for a key and type
   */
  async saveInfo(key: string, type: string, data: Record<string, unknown>): Promise<void> {
    const compositeKey = `${key}:${type}`;
    await this.saveInfoRecord({
      compositeKey,
      key,
      type,
      updated: Date.now(),
      ...data,
    });
  }

  /**
   * Get info data for a key and type
   */
  async getInfo(key: string, type: string): Promise<Record<string, unknown> | null> {
    const compositeKey = `${key}:${type}`;
    const record = await this.getInfoRecord(compositeKey);
    return record || null;
  }

  /**
   * Get all info records of a specific type
   */
  async getInfoByType(type: string): Promise<Record<string, unknown>[]> {
    return this.getInfoRecordsByType(type);
  }

  /**
   * Delete info data for a key and type
   */
  async deleteInfoByKeyAndType(key: string, type: string): Promise<void> {
    const compositeKey = `${key}:${type}`;
    await this.deleteInfoRecord(compositeKey);
  }

  /**
   * Update an existing info record
   */
  async updateInfo(record: Record<string, unknown>): Promise<void> {
    record['updated'] = Date.now();
    await this.saveInfoRecord(record as { compositeKey: string; key: string; type: string; updated: number;[key: string]: unknown });
  }

  // ============================================================================
  // TRUST METRICS OPERATIONS
  // ============================================================================

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

      const metrics: TrustMetrics = {
        authorPubkey: record['authorPubkey'] as string | undefined,
        rank: record['rank'] as number | undefined,
        followers: record['followers'] as number | undefined,
        postCount: record['postCount'] as number | undefined,
        zapAmtRecd: record['zapAmtRecd'] as number | undefined,
        zapAmtSent: record['zapAmtSent'] as number | undefined,
        firstCreatedAt: record['firstCreatedAt'] as number | undefined,
        replyCount: record['replyCount'] as number | undefined,
        reactionsCount: record['reactionsCount'] as number | undefined,
        zapCntRecd: record['zapCntRecd'] as number | undefined,
        zapCntSent: record['zapCntSent'] as number | undefined,
        lastUpdated: record['lastUpdated'] as number | undefined,
        hops: record['hops'] as number | undefined,
        personalizedGrapeRank_influence: record['personalizedGrapeRank_influence'] as number | undefined,
        personalizedGrapeRank_average: record['personalizedGrapeRank_average'] as number | undefined,
        personalizedGrapeRank_confidence: record['personalizedGrapeRank_confidence'] as number | undefined,
        personalizedGrapeRank_input: record['personalizedGrapeRank_input'] as number | undefined,
        personalizedPageRank: record['personalizedPageRank'] as number | undefined,
        verifiedFollowerCount: record['verifiedFollowerCount'] as number | undefined,
        verifiedMuterCount: record['verifiedMuterCount'] as number | undefined,
        verifiedReporterCount: record['verifiedReporterCount'] as number | undefined,
      };

      return metrics;
    } catch (error) {
      this.logger.error(`Error getting trust metrics for ${pubkey}`, error);
      return null;
    }
  }

  /**
   * Get all pubkeys with trust metrics, sorted by rank (descending)
   */
  async getPubkeysByTrustRank(minRank?: number, maxRank?: number): Promise<string[]> {
    try {
      const records = await this.getInfoByType('trust');

      let filtered = records;

      if (minRank !== undefined || maxRank !== undefined) {
        filtered = records.filter(record => {
          const rank = record['rank'] as number | undefined;
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
      filtered.sort((a, b) => ((b['rank'] as number) || 0) - ((a['rank'] as number) || 0));

      return filtered.map(record => record['key'] as string);
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

  // ============================================================================
  // GENERIC STORE OPERATIONS
  // ============================================================================

  /**
   * Get a value from any store by key.
   * Routes to the correct database based on store name.
   * NOTE: For the events store, this checks account DB first, then shared DB.
   */
  async get<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
    if (storeName === STORES.EVENTS) {
      // Events store exists in both DBs — check account first, then shared
      const getFromDb = (db: IDBDatabase): Promise<T | undefined> => {
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(storeName, 'readonly');
          const store = transaction.objectStore(storeName);
          const request = store.get(key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      };

      if (this.accountDb) {
        const result = await getFromDb(this.accountDb);
        if (result !== undefined) return result;
      }
      if (this.sharedDb) {
        return getFromDb(this.sharedDb);
      }
      return undefined;
    }

    const db = this.getDbForStore(storeName);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Put a value into any store.
   * Routes to the correct database based on store name.
   * NOTE: Cannot be used for the events store — use saveEvent() instead.
   */
  async put<T>(storeName: string, value: T): Promise<void> {
    if (storeName === STORES.EVENTS) {
      throw new Error('Use saveEvent() for the events store');
    }

    const db = this.getDbForStore(storeName);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(value);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete a value from any store.
   * Routes to the correct database based on store name.
   * NOTE: For the events store, tries both DBs.
   */
  async delete(storeName: string, key: IDBValidKey): Promise<void> {
    if (storeName === STORES.EVENTS) {
      // Try both DBs
      const deleteFromDb = (db: IDBDatabase): Promise<void> => {
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(storeName, 'readwrite');
          const store = transaction.objectStore(storeName);
          const request = store.delete(key);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      };

      const promises: Promise<void>[] = [];
      if (this.sharedDb) promises.push(deleteFromDb(this.sharedDb));
      if (this.accountDb) promises.push(deleteFromDb(this.accountDb));
      await Promise.all(promises);
      return;
    }

    const db = this.getDbForStore(storeName);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all values from a store.
   * Routes to the correct database based on store name.
   * NOTE: For the events store, merges results from both DBs.
   */
  async getAll<T>(storeName: string): Promise<T[]> {
    if (storeName === STORES.EVENTS) {
      const queryDb = (db: IDBDatabase): Promise<T[]> => {
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(storeName, 'readonly');
          const store = transaction.objectStore(storeName);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
        });
      };

      const promises: Promise<T[]>[] = [];
      if (this.sharedDb) promises.push(queryDb(this.sharedDb));
      if (this.accountDb) promises.push(queryDb(this.accountDb));
      const results = await Promise.all(promises);
      return results.flat();
    }

    const db = this.getDbForStore(storeName);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all values from a store using an index.
   * Routes to the correct database based on store name.
   */
  async getAllFromIndex<T>(storeName: string, indexName: string, key: IDBValidKey): Promise<T[]> {
    if (storeName === STORES.EVENTS) {
      // Query both DBs and merge
      const queryDb = (db: IDBDatabase): Promise<T[]> => {
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(storeName, 'readonly');
          const store = transaction.objectStore(storeName);
          const index = store.index(indexName);
          const request = index.getAll(key);
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
        });
      };

      const promises: Promise<T[]>[] = [];
      if (this.sharedDb) promises.push(queryDb(this.sharedDb));
      if (this.accountDb) promises.push(queryDb(this.accountDb));
      const results = await Promise.all(promises);
      return results.flat();
    }

    const db = this.getDbForStore(storeName);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(key);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Wipe all databases (shared, all account DBs, and legacy DBs)
   */
  async wipe(): Promise<void> {
    this.logger.info('Wiping all IndexedDB databases');

    // Close all current connections
    this.close();

    const deletePromises: Promise<void>[] = [];

    // Delete shared database
    deletePromises.push(this.deleteDatabaseByName(SHARED_DB_NAME));

    // Delete legacy databases
    for (const legacyName of LEGACY_DB_NAMES) {
      deletePromises.push(this.deleteDatabaseByName(legacyName));
    }

    // Delete all account databases using indexedDB.databases() if available
    if ('databases' in indexedDB) {
      try {
        const allDbs = await (indexedDB as any).databases();
        for (const dbInfo of allDbs) {
          if (dbInfo.name && dbInfo.name.startsWith(ACCOUNT_DB_PREFIX)) {
            deletePromises.push(this.deleteDatabaseByName(dbInfo.name));
          }
        }
      } catch (error) {
        this.logger.warn('indexedDB.databases() not available, using localStorage fallback');
      }
    }

    try {
      await Promise.all(deletePromises);
      this.initialized.set(false);
      // Reset migration version so it runs again on next init
      localStorage.removeItem(MULTI_DB_VERSION_KEY);
      this.logger.info('All databases wiped successfully');
    } catch (error) {
      this.logger.error('Error wiping databases', error);
      throw error;
    }
  }

  /**
   * Helper to delete a specific database by name (internal use)
   */
  private deleteDatabaseByName(dbName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.logger.info(`Deleting database: ${dbName}`);
      const deleteRequest = indexedDB.deleteDatabase(dbName);

      deleteRequest.onsuccess = () => {
        this.logger.info(`Database '${dbName}' deleted successfully`);
        resolve();
      };

      deleteRequest.onerror = () => {
        this.logger.error(`Error deleting database '${dbName}':`, deleteRequest.error);
        reject(deleteRequest.error);
      };

      deleteRequest.onblocked = () => {
        this.logger.warn(`Database '${dbName}' deletion blocked - other connections may be open`);
        // Don't reject - the deletion will still happen once connections close
      };

      // Timeout to prevent hanging
      setTimeout(() => {
        this.logger.warn(`Database '${dbName}' deletion timed out`);
        reject(new Error(`Database '${dbName}' deletion timed out`));
      }, 5000);
    });
  }

  /**
   * Clear all data from a store.
   * For the events store, clears both databases.
   */
  async clear(storeName: string): Promise<void> {
    if (storeName === STORES.EVENTS) {
      const promises: Promise<void>[] = [];
      if (this.sharedDb) promises.push(this.clearStoreInDb(this.sharedDb, storeName));
      if (this.accountDb) promises.push(this.clearStoreInDb(this.accountDb, storeName));
      await Promise.all(promises);
      return;
    }

    const db = this.getDbForStore(storeName);
    return this.clearStoreInDb(db, storeName);
  }

  /**
   * Count items in a store.
   * For the events store, sums counts from both databases.
   */
  async count(storeName: string): Promise<number> {
    if (storeName === STORES.EVENTS) {
      const countInDb = (db: IDBDatabase): Promise<number> => {
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(storeName, 'readonly');
          const store = transaction.objectStore(storeName);
          const request = store.count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      };

      const promises: Promise<number>[] = [];
      if (this.sharedDb) promises.push(countInDb(this.sharedDb));
      if (this.accountDb) promises.push(countInDb(this.accountDb));
      const counts = await Promise.all(promises);
      return counts.reduce((sum, c) => sum + c, 0);
    }

    const db = this.getDbForStore(storeName);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ============================================================================
  // DATABASE MANAGEMENT
  // ============================================================================

  /**
   * Delete the shared database
   */
  async deleteDatabase(): Promise<void> {
    this.close();

    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(SHARED_DB_NAME);

      request.onsuccess = () => {
        this.logger.info('Shared database deleted successfully');
        resolve();
      };

      request.onerror = () => {
        this.logger.error('Failed to delete shared database', request.error);
        reject(request.error);
      };

      request.onblocked = () => {
        this.logger.warn('Database deletion blocked - close other tabs');
      };
    });
  }

  /**
   * Get database storage statistics
   */
  async getStorageEstimate(): Promise<{ usage?: number; quota?: number }> {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      try {
        return await navigator.storage.estimate();
      } catch (error) {
        this.logger.warn('Failed to get storage estimate', error);
      }
    }
    return {};
  }

  // ============================================================================
  // DIRECT MESSAGE OPERATIONS
  // ============================================================================

  /**
   * Save a direct message to the database (account DB)
   */
  async saveDirectMessage(message: StoredDirectMessage): Promise<void> {
    const db = this.getAccountDb();
    if (!db) return;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.MESSAGES, 'readwrite');
      const store = transaction.objectStore(STORES.MESSAGES);

      const request = store.put(message);

      request.onsuccess = () => {
        this.logger.debug(`Saved direct message ${message.messageId} to database`);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Save multiple direct messages in a single transaction (account DB)
   */
  async saveDirectMessages(messages: StoredDirectMessage[]): Promise<void> {
    if (messages.length === 0) return;

    const db = this.getAccountDb();
    if (!db) return;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.MESSAGES, 'readwrite');
      const store = transaction.objectStore(STORES.MESSAGES);

      for (const message of messages) {
        store.put(message);
      }

      transaction.oncomplete = () => {
        this.logger.debug(`Saved ${messages.length} direct messages to database`);
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Get all messages for a specific chat (account DB)
   */
  async getMessagesForChat(accountPubkey: string, chatId: string): Promise<StoredDirectMessage[]> {
    const db = this.getAccountDb();
    if (!db) return [];

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.MESSAGES, 'readonly');
      const store = transaction.objectStore(STORES.MESSAGES);
      const index = store.index('by-account-chat');

      const request = index.getAll([accountPubkey, chatId]);

      request.onsuccess = () => {
        const messages = request.result || [];
        messages.sort((a, b) => a.created_at - b.created_at);
        resolve(messages);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all chats for an account (account DB)
   */
  async getChatsForAccount(accountPubkey: string): Promise<{
    chatId: string;
    messageCount: number;
    lastMessageTime: number;
    unreadCount: number;
  }[]> {
    const db = this.getAccountDb();
    if (!db) return [];

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.MESSAGES, 'readonly');
      const store = transaction.objectStore(STORES.MESSAGES);
      const index = store.index('by-account');

      const request = index.getAll(accountPubkey);

      request.onsuccess = () => {
        const messages = request.result || [];

        // Group messages by chat
        const chatMap = new Map<string, {
          messageCount: number;
          lastMessageTime: number;
          unreadCount: number;
        }>();

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

        resolve(Array.from(chatMap.entries()).map(([chatId, stats]) => ({
          chatId,
          ...stats,
        })));
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Check if a message already exists in the database (account DB)
   */
  async messageExists(accountPubkey: string, chatId: string, messageId: string): Promise<boolean> {
    const db = this.getAccountDb();
    if (!db) return false;

    const id = `${accountPubkey}::${chatId}::${messageId}`;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.MESSAGES, 'readonly');
      const store = transaction.objectStore(STORES.MESSAGES);
      const request = store.get(id);
      request.onsuccess = () => resolve(!!request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Check if a gift wrap event has already been processed (account DB)
   */
  async giftWrapExists(accountPubkey: string, giftWrapId: string): Promise<boolean> {
    const db = this.getAccountDb();
    if (!db) return false;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.MESSAGES, 'readonly');
      const store = transaction.objectStore(STORES.MESSAGES);
      const index = store.index('by-account');
      const request = index.getAll(accountPubkey);

      request.onsuccess = () => {
        const messages = request.result || [];
        const exists = messages.some(msg => msg.giftWrapId === giftWrapId);
        resolve(exists);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Mark a message as read (account DB)
   */
  async markMessageAsRead(accountPubkey: string, chatId: string, messageId: string): Promise<void> {
    const db = this.getAccountDb();
    if (!db) return;

    const id = `${accountPubkey}::${chatId}::${messageId}`;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.MESSAGES, 'readwrite');
      const store = transaction.objectStore(STORES.MESSAGES);
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const message = getRequest.result;
        if (message) {
          message.read = true;
          const putRequest = store.put(message);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          resolve();
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Mark all messages in a chat as read (account DB)
   */
  async markChatAsRead(accountPubkey: string, chatId: string): Promise<void> {
    const messages = await this.getMessagesForChat(accountPubkey, chatId);
    const unreadMessages = messages.filter(msg => !msg.read && !msg.isOutgoing);

    if (unreadMessages.length === 0) return;

    const db = this.getAccountDb();
    if (!db) return;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.MESSAGES, 'readwrite');
      const store = transaction.objectStore(STORES.MESSAGES);

      for (const msg of unreadMessages) {
        msg.read = true;
        store.put(msg);
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Delete a specific message (account DB)
   */
  async deleteDirectMessage(accountPubkey: string, chatId: string, messageId: string): Promise<void> {
    const db = this.getAccountDb();
    if (!db) return;

    const id = `${accountPubkey}::${chatId}::${messageId}`;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.MESSAGES, 'readwrite');
      const store = transaction.objectStore(STORES.MESSAGES);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete all messages for a specific chat (account DB)
   */
  async deleteChat(accountPubkey: string, chatId: string): Promise<void> {
    const messages = await this.getMessagesForChat(accountPubkey, chatId);
    if (messages.length === 0) return;

    const db = this.getAccountDb();
    if (!db) return;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.MESSAGES, 'readwrite');
      const store = transaction.objectStore(STORES.MESSAGES);

      for (const msg of messages) {
        store.delete(msg.id);
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Delete all messages for an account (account DB)
   */
  async deleteAllMessagesForAccount(accountPubkey: string): Promise<void> {
    const db = this.getAccountDb();
    if (!db) return;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.MESSAGES, 'readwrite');
      const store = transaction.objectStore(STORES.MESSAGES);
      const index = store.index('by-account');

      const request = index.getAllKeys(accountPubkey);

      request.onsuccess = () => {
        const keys = request.result || [];
        for (const key of keys) {
          store.delete(key);
        }
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Get the most recent message timestamp for an account (account DB)
   */
  async getMostRecentMessageTimestamp(accountPubkey: string): Promise<number> {
    const db = this.getAccountDb();
    if (!db) return 0;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.MESSAGES, 'readonly');
      const store = transaction.objectStore(STORES.MESSAGES);
      const index = store.index('by-account');

      const request = index.getAll(accountPubkey);

      request.onsuccess = () => {
        const messages = request.result || [];
        if (messages.length === 0) {
          resolve(0);
        } else {
          resolve(Math.max(...messages.map(msg => msg.created_at)));
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all messages from the database (account DB)
   */
  async clearAllMessages(): Promise<void> {
    const db = this.getAccountDb();
    if (!db) return;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.MESSAGES, 'readwrite');
      const store = transaction.objectStore(STORES.MESSAGES);
      const request = store.clear();

      request.onsuccess = () => {
        this.logger.info('Cleared all messages from database');
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  // ============================================
  // Feed Event Caching Methods
  // ============================================

  // Keep events for 90 days (in seconds) to support infinite scrolling
  // Increased from 7 days to allow users to scroll back further in their feeds
  private readonly CACHE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

  /**
   * Save cached events for a feed column (account DB)
   */
  async saveCachedEvents(
    accountPubkey: string,
    columnId: string,
    events: Event[]
  ): Promise<void> {
    const db = this.getAccountDb();
    if (!db) return;

    const cachedAt = Date.now();
    const now = Math.floor(Date.now() / 1000);
    const cutoffTimestamp = now - this.CACHE_MAX_AGE_SECONDS;

    // Filter events to only include those within the last 90 days, sorted by created_at (newest first)
    const eventsToCache = [...events]
      .filter(e => (e.created_at || 0) >= cutoffTimestamp)
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    // First, delete existing cached events for this column
    await this.deleteCachedEventsForColumn(accountPubkey, columnId);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS_CACHE, 'readwrite');
      const store = transaction.objectStore(STORES.EVENTS_CACHE);

      for (const event of eventsToCache) {
        const cachedEvent: CachedFeedEvent = {
          id: `${accountPubkey}::${columnId}::${event.id}`,
          accountPubkey,
          columnId,
          eventId: event.id,
          event,
          cachedAt,
        };
        store.put(cachedEvent);
      }

      transaction.oncomplete = () => {
        this.logger.debug(`💾 Saved ${eventsToCache.length} events to cache for column ${columnId}`);
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Load cached events for a feed column (account DB)
   */
  async loadCachedEvents(accountPubkey: string, columnId: string): Promise<Event[]> {
    const db = this.getAccountDb();
    if (!db) return [];

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS_CACHE, 'readonly');
      const store = transaction.objectStore(STORES.EVENTS_CACHE);
      const index = store.index('by-account-column');

      const request = index.getAll([accountPubkey, columnId]);

      request.onsuccess = () => {
        const cachedEvents = request.result || [];

        // Extract and sort events by created_at (newest first)
        const events = cachedEvents
          .map((cached: CachedFeedEvent) => cached.event)
          .sort((a: Event, b: Event) => (b.created_at || 0) - (a.created_at || 0));

        if (events.length > 0) {
          this.logger.info(`✅ Loaded ${events.length} cached events for column ${columnId}`);
        }

        resolve(events);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete cached events for a specific column (account DB)
   */
  async deleteCachedEventsForColumn(
    accountPubkey: string,
    columnId: string
  ): Promise<void> {
    const db = this.getAccountDb();
    if (!db) return;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS_CACHE, 'readwrite');
      const store = transaction.objectStore(STORES.EVENTS_CACHE);
      const index = store.index('by-account-column');

      const keysRequest = index.getAllKeys([accountPubkey, columnId]);

      keysRequest.onsuccess = () => {
        const keys = keysRequest.result || [];
        for (const key of keys) {
          store.delete(key);
        }
      };

      transaction.oncomplete = () => {
        this.logger.debug(`Deleted cached events for column ${columnId}`);
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Delete all cached events for an account (account DB)
   */
  async deleteCachedEventsForAccount(accountPubkey: string): Promise<void> {
    const db = this.getAccountDb();
    if (!db) return;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS_CACHE, 'readwrite');
      const store = transaction.objectStore(STORES.EVENTS_CACHE);
      const index = store.index('by-account');

      const keysRequest = index.getAllKeys(accountPubkey);

      keysRequest.onsuccess = () => {
        const keys = keysRequest.result || [];
        for (const key of keys) {
          store.delete(key);
        }
      };

      transaction.oncomplete = () => {
        this.logger.debug(`Deleted cached events for account ${accountPubkey}`);
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Clean up old cached events (account DB)
   */
  async cleanupCachedEvents(): Promise<void> {
    const db = this.getAccountDb();
    if (!db) return;

    const now = Math.floor(Date.now() / 1000);
    const cutoffTimestamp = now - this.CACHE_MAX_AGE_SECONDS;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS_CACHE, 'readwrite');
      const store = transaction.objectStore(STORES.EVENTS_CACHE);

      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        const allCachedEvents: CachedFeedEvent[] = getAllRequest.result || [];
        let deletedCount = 0;

        // Delete events older than the cutoff
        for (const cached of allCachedEvents) {
          const eventTimestamp = cached.event?.created_at || 0;
          if (eventTimestamp < cutoffTimestamp) {
            store.delete(cached.id);
            deletedCount++;
          }
        }

        this.logger.debug(`Cleanup: found ${allCachedEvents.length} cached events, deleting ${deletedCount} older than 90 days`);
      };

      transaction.oncomplete = () => {
        this.logger.info('Cleaned up old cached events');
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Get the total count of cached events (account DB)
   */
  async getCachedEventsCount(): Promise<number> {
    const db = this.getAccountDb();
    if (!db) return 0;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS_CACHE, 'readonly');
      const store = transaction.objectStore(STORES.EVENTS_CACHE);
      const countRequest = store.count();

      countRequest.onsuccess = () => resolve(countRequest.result);
      countRequest.onerror = () => reject(countRequest.error);
    });
  }

  /**
   * Get cached events statistics (account DB)
   */
  async getCachedEventsStats(): Promise<{
    totalEvents: number;
    eventsByAccount: Map<string, number>;
    eventsByColumn: Map<string, number>;
  }> {
    const db = this.getAccountDb();
    if (!db) return { totalEvents: 0, eventsByAccount: new Map(), eventsByColumn: new Map() };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS_CACHE, 'readonly');
      const store = transaction.objectStore(STORES.EVENTS_CACHE);
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        const allCachedEvents: CachedFeedEvent[] = getAllRequest.result || [];
        const eventsByAccount = new Map<string, number>();
        const eventsByColumn = new Map<string, number>();

        for (const cached of allCachedEvents) {
          // Count by account
          eventsByAccount.set(
            cached.accountPubkey,
            (eventsByAccount.get(cached.accountPubkey) || 0) + 1
          );

          // Count by column
          eventsByColumn.set(
            cached.columnId,
            (eventsByColumn.get(cached.columnId) || 0) + 1
          );
        }

        resolve({
          totalEvents: allCachedEvents.length,
          eventsByAccount,
          eventsByColumn,
        });
      };

      getAllRequest.onerror = () => reject(getAllRequest.error);
    });
  }

  /**
   * Clear all cached events from the database (account DB)
   */
  async clearAllCachedEvents(): Promise<void> {
    const db = this.getAccountDb();
    if (!db) return;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS_CACHE, 'readwrite');
      const store = transaction.objectStore(STORES.EVENTS_CACHE);

      const request = store.clear();

      request.onsuccess = () => {
        this.logger.info('Cleared all cached events from database');
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get cached events by account, filtered by pubkeys, kind, and timestamp
   * This is used by the Summary page to query feed cache data
   */
  async getCachedEventsByPubkeyKindSince(
    accountPubkey: string,
    pubkeys: string[],
    kind: number,
    sinceTimestamp: number
  ): Promise<Event[]> {
    const db = this.getAccountDb();
    if (!db) return [];

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS_CACHE, 'readonly');
      const store = transaction.objectStore(STORES.EVENTS_CACHE);
      const index = store.index('by-account');

      const request = index.getAll(accountPubkey);

      request.onsuccess = () => {
        const allCachedEvents: CachedFeedEvent[] = request.result || [];

        // Create a set of valid pubkeys for faster lookup
        const pubkeySet = new Set(pubkeys);

        // Filter by pubkey, kind, and timestamp
        const events = allCachedEvents
          .map(cached => cached.event)
          .filter(event =>
            pubkeySet.has(event.pubkey) &&
            event.kind === kind &&
            event.created_at >= sinceTimestamp
          )
          // Remove duplicates by event ID
          .filter((event, index, self) =>
            self.findIndex(e => e.id === event.id) === index
          );

        this.logger.debug(`Found ${events.length} cached events for kind ${kind} since ${sinceTimestamp}`);

        resolve(events);
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all events from both events store and events cache, filtered by pubkeys, kind, and timestamp
   * This combines data from both sources for the Summary page
   */
  async getAllEventsByPubkeyKindSince(
    accountPubkey: string,
    pubkeys: string[],
    kind: number,
    sinceTimestamp: number
  ): Promise<Event[]> {
    // Get from both sources in parallel
    const [eventsStoreEvents, cachedEvents] = await Promise.all([
      this.getEventsByPubkeyAndKindSince(pubkeys, kind, sinceTimestamp),
      this.getCachedEventsByPubkeyKindSince(accountPubkey, pubkeys, kind, sinceTimestamp),
    ]);

    // Combine and deduplicate by event ID
    const eventMap = new Map<string, Event>();

    for (const event of eventsStoreEvents) {
      eventMap.set(event.id, event);
    }

    for (const event of cachedEvents) {
      if (!eventMap.has(event.id)) {
        eventMap.set(event.id, event);
      }
    }

    const allEvents = Array.from(eventMap.values());

    return allEvents;
  }

  // ============================================================================
  // NOTIFICATION METHODS
  // ============================================================================

  /**
   * Save a notification to the notifications store
   */
  async saveNotification(notification: Record<string, unknown>): Promise<void> {
    const db = this.getAccountDb();
    if (!db) return;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.NOTIFICATIONS, 'readwrite');
      const store = transaction.objectStore(STORES.NOTIFICATIONS);

      const request = store.put(notification);

      request.onsuccess = () => {
        this.logger.debug(`Saved notification to IndexedDB: ${notification['id']}`);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get a notification by ID
   */
  async getNotification(id: string): Promise<Record<string, unknown> | undefined> {
    const db = this.getAccountDb();
    if (!db) return undefined;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.NOTIFICATIONS, 'readonly');
      const store = transaction.objectStore(STORES.NOTIFICATIONS);

      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all notifications sorted by timestamp (newest first)
   */
  async getAllNotifications(): Promise<Record<string, unknown>[]> {
    const db = this.getAccountDb();
    if (!db) return [];

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.NOTIFICATIONS, 'readonly');
      const store = transaction.objectStore(STORES.NOTIFICATIONS);
      const index = store.index('by-timestamp');

      const request = index.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all notifications for a specific pubkey
   */
  async getAllNotificationsForPubkey(pubkey: string): Promise<Record<string, unknown>[]> {
    const db = this.getAccountDb();
    if (!db) return [];

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.NOTIFICATIONS, 'readonly');
      const store = transaction.objectStore(STORES.NOTIFICATIONS);
      const index = store.index('by-recipient');

      // Get notifications with matching recipientPubkey
      const indexRequest = index.getAll(pubkey);

      indexRequest.onsuccess = () => {
        const notificationsWithPubkey = indexRequest.result || [];

        // Also get notifications with undefined recipientPubkey (for backward compatibility)
        const allRequest = store.getAll();

        allRequest.onsuccess = () => {
          const allNotifications = allRequest.result || [];
          const notificationsWithoutPubkey = allNotifications.filter(
            (n: Record<string, unknown>) => !n['recipientPubkey']
          );

          // Combine both sets and deduplicate by ID
          const combinedNotifications = [...notificationsWithPubkey, ...notificationsWithoutPubkey];
          const uniqueNotifications = Array.from(
            new Map(combinedNotifications.map((n: Record<string, unknown>) => [n['id'], n])).values()
          );

          // Sort by timestamp (newest first)
          uniqueNotifications.sort(
            (a: Record<string, unknown>, b: Record<string, unknown>) =>
              (b['timestamp'] as number) - (a['timestamp'] as number)
          );

          resolve(uniqueNotifications);
        };

        allRequest.onerror = () => reject(allRequest.error);
      };

      indexRequest.onerror = () => reject(indexRequest.error);
    });
  }

  /**
   * Delete a notification by ID
   */
  async deleteNotification(id: string): Promise<void> {
    const db = this.getAccountDb();
    if (!db) return;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.NOTIFICATIONS, 'readwrite');
      const store = transaction.objectStore(STORES.NOTIFICATIONS);

      const request = store.delete(id);

      request.onsuccess = () => {
        this.logger.debug(`Deleted notification from IndexedDB: ${id}`);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all notifications
   */
  async clearAllNotifications(): Promise<void> {
    const db = this.getAccountDb();
    if (!db) return;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.NOTIFICATIONS, 'readwrite');
      const store = transaction.objectStore(STORES.NOTIFICATIONS);

      const request = store.clear();

      request.onsuccess = () => {
        this.logger.debug('Cleared all notifications from IndexedDB');
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  // ============================================================================
  // BADGE DEFINITION METHODS
  // ============================================================================

  /**
   * Save a badge definition event to IndexedDB
   * Uses composite key: pubkey::slug
   */
  async saveBadgeDefinition(badgeEvent: Event): Promise<void> {
    const db = this.ensureSharedDb();

    return new Promise((resolve, reject) => {
      // Extract the d-tag (slug)
      const dTag = badgeEvent.tags.find(tag => tag[0] === 'd');
      if (!dTag || !dTag[1]) {
        this.logger.warn('Badge definition missing d-tag (slug)');
        resolve();
        return;
      }

      const slug = dTag[1];
      const compositeKey = `${badgeEvent.pubkey}::${slug}`;

      const transaction = db.transaction(STORES.BADGE_DEFINITIONS, 'readwrite');
      const store = transaction.objectStore(STORES.BADGE_DEFINITIONS);

      // Check if an existing definition exists
      const getRequest = store.get(compositeKey);

      getRequest.onsuccess = () => {
        const existing = getRequest.result;

        // Only save if this is newer or doesn't exist
        if (!existing || badgeEvent.created_at > existing.created_at) {
          // Store with composite key as the id (required for in-line keyPath)
          const badgeRecord = {
            ...badgeEvent,
            id: compositeKey, // Override the event id with composite key for storage
            originalEventId: badgeEvent.id, // Preserve the original event id
          };
          const putRequest = store.put(badgeRecord);
          putRequest.onsuccess = () => {
            this.logger.debug(`Saved badge definition: ${compositeKey}`);
            resolve();
          };
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          resolve();
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Get a badge definition by pubkey and slug
   */
  async getBadgeDefinition(pubkey: string, slug: string): Promise<Event | null> {
    const db = this.ensureSharedDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.BADGE_DEFINITIONS, 'readonly');
      const store = transaction.objectStore(STORES.BADGE_DEFINITIONS);

      const compositeKey = `${pubkey}::${slug}`;
      const request = store.get(compositeKey);

      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          // Restore original event ID if present
          if (result.originalEventId) {
            result.id = result.originalEventId;
            delete result.originalEventId;
          }
        }
        resolve(result || null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all badge definitions by pubkey
   */
  async getBadgeDefinitionsByPubkey(pubkey: string): Promise<Event[]> {
    const db = this.ensureSharedDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.BADGE_DEFINITIONS, 'readonly');
      const store = transaction.objectStore(STORES.BADGE_DEFINITIONS);
      const index = store.index('by-pubkey');

      const request = index.getAll(pubkey);

      request.onsuccess = () => {
        const results = request.result || [];
        // Restore original event IDs
        for (const result of results) {
          if (result.originalEventId) {
            result.id = result.originalEventId;
            delete result.originalEventId;
          }
        }
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete a badge definition
   */
  async deleteBadgeDefinition(pubkey: string, slug: string): Promise<void> {
    const db = this.ensureSharedDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.BADGE_DEFINITIONS, 'readwrite');
      const store = transaction.objectStore(STORES.BADGE_DEFINITIONS);

      const compositeKey = `${pubkey}::${slug}`;
      const request = store.delete(compositeKey);

      request.onsuccess = () => {
        this.logger.debug(`Deleted badge definition: ${compositeKey}`);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  // ============================================================================
  // OBSERVED RELAY METHODS
  // ============================================================================

  /**
   * Save or update observed relay statistics
   */
  async saveObservedRelay(stats: Record<string, unknown>): Promise<void> {
    const db = this.ensureSharedDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.OBSERVED_RELAYS, 'readwrite');
      const store = transaction.objectStore(STORES.OBSERVED_RELAYS);

      const request = store.put(stats);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get observed relay statistics by URL
   */
  async getObservedRelay(url: string): Promise<Record<string, unknown> | undefined> {
    const db = this.ensureSharedDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.OBSERVED_RELAYS, 'readonly');
      const store = transaction.objectStore(STORES.OBSERVED_RELAYS);

      const request = store.get(url);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all observed relay statistics
   */
  async getAllObservedRelays(): Promise<Record<string, unknown>[]> {
    const db = this.ensureSharedDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.OBSERVED_RELAYS, 'readonly');
      const store = transaction.objectStore(STORES.OBSERVED_RELAYS);

      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Count observed relays
   */
  async countObservedRelays(): Promise<number> {
    const db = this.ensureSharedDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.OBSERVED_RELAYS, 'readonly');
      const store = transaction.objectStore(STORES.OBSERVED_RELAYS);

      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get observed relays sorted by a specific criterion
   */
  async getObservedRelaysSorted(
    sortBy: 'eventsReceived' | 'lastUpdated' | 'firstObserved' = 'lastUpdated'
  ): Promise<Record<string, unknown>[]> {
    const db = this.ensureSharedDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.OBSERVED_RELAYS, 'readonly');
      const store = transaction.objectStore(STORES.OBSERVED_RELAYS);

      const indexName =
        sortBy === 'eventsReceived'
          ? 'by-events-received'
          : sortBy === 'firstObserved'
            ? 'by-first-observed'
            : 'by-last-updated';

      const index = store.index(indexName);
      const request = index.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete observed relay statistics by URL
   */
  async deleteObservedRelay(url: string): Promise<void> {
    const db = this.ensureSharedDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.OBSERVED_RELAYS, 'readwrite');
      const store = transaction.objectStore(STORES.OBSERVED_RELAYS);

      const request = store.delete(url);

      request.onsuccess = () => {
        this.logger.debug(`Deleted observed relay stats for: ${url}`);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  // ============================================================================
  // PUBKEY-RELAY MAPPING METHODS
  // ============================================================================

  /**
   * Save or update a pubkey-relay mapping
   */
  async savePubkeyRelayMapping(mapping: Record<string, unknown>): Promise<void> {
    const db = this.ensureSharedDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.PUBKEY_RELAY_MAPPINGS, 'readwrite');
      const store = transaction.objectStore(STORES.PUBKEY_RELAY_MAPPINGS);

      const request = store.put(mapping);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get a specific pubkey-relay mapping
   */
  async getPubkeyRelayMapping(
    pubkey: string,
    relayUrl: string
  ): Promise<Record<string, unknown> | undefined> {
    const db = this.ensureSharedDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.PUBKEY_RELAY_MAPPINGS, 'readonly');
      const store = transaction.objectStore(STORES.PUBKEY_RELAY_MAPPINGS);

      const id = `${pubkey}::${relayUrl}`;
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all relay URLs for a pubkey (excluding kind 10002 relay lists)
   */
  async getRelayUrlsForPubkey(pubkey: string): Promise<string[]> {
    const db = this.ensureSharedDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.PUBKEY_RELAY_MAPPINGS, 'readonly');
      const store = transaction.objectStore(STORES.PUBKEY_RELAY_MAPPINGS);
      const index = store.index('by-pubkey');

      const request = index.getAll(pubkey);

      request.onsuccess = () => {
        const mappings = request.result || [];
        // Filter out user_list source since those are kind 10002 events which should not be included
        const urls = mappings
          .filter((mapping: Record<string, unknown>) => mapping['source'] !== 'user_list')
          .map((mapping: Record<string, unknown>) => mapping['relayUrl'] as string);
        resolve(urls);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update or create a pubkey-relay mapping from relay hint
   */
  async updatePubkeyRelayMappingFromHint(pubkey: string, relayUrl: string): Promise<void> {
    const existing = await this.getPubkeyRelayMapping(pubkey, relayUrl);
    const now = Math.floor(Date.now() / 1000); // Nostr uses seconds

    if (existing) {
      // Update existing mapping
      existing['lastSeen'] = now;
      existing['eventCount'] = ((existing['eventCount'] as number) || 0) + 1;
      await this.savePubkeyRelayMapping(existing);
    } else {
      // Create new mapping
      const id = `${pubkey}::${relayUrl}`;
      const newMapping: Record<string, unknown> = {
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
  }

  /**
   * Clean up old pubkey-relay mappings (older than specified days)
   */
  async cleanupOldPubkeyRelayMappings(olderThanDays = 30): Promise<number> {
    const db = this.ensureSharedDb();
    const cutoffTime = Math.floor(Date.now() / 1000) - olderThanDays * 24 * 60 * 60;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.PUBKEY_RELAY_MAPPINGS, 'readwrite');
      const store = transaction.objectStore(STORES.PUBKEY_RELAY_MAPPINGS);

      const request = store.getAll();

      request.onsuccess = async () => {
        const allMappings = request.result || [];
        let deletedCount = 0;

        for (const mapping of allMappings) {
          if ((mapping['lastSeen'] as number) < cutoffTime) {
            store.delete(mapping['id'] as string);
            deletedCount++;
          }
        }

        this.logger.debug(`Cleaned up ${deletedCount} old pubkey-relay mappings`);
        resolve(deletedCount);
      };

      request.onerror = () => reject(request.error);
    });
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Get all events by pubkey (queries both shared and account DBs, merges results)
   */
  async getUserEvents(pubkey: string): Promise<Event[]> {
    const results: Event[] = [];

    // Query shared DB
    const sharedDb = this.ensureSharedDb();
    const sharedEvents = await new Promise<Event[]>((resolve, reject) => {
      const transaction = sharedDb.transaction(STORES.EVENTS, 'readonly');
      const store = transaction.objectStore(STORES.EVENTS);
      const index = store.index('by-pubkey');
      const request = index.getAll(pubkey);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    results.push(...sharedEvents);

    // Query account DB if available
    const accountDb = this.getAccountDb();
    if (accountDb) {
      const accountEvents = await new Promise<Event[]>((resolve, reject) => {
        const transaction = accountDb.transaction(STORES.EVENTS, 'readonly');
        const store = transaction.objectStore(STORES.EVENTS);
        const index = store.index('by-pubkey');
        const request = index.getAll(pubkey);
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
      results.push(...accountEvents);
    }

    // Deduplicate by event ID
    const seen = new Set<string>();
    return results.filter(e => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  }

  /**
   * Search cached profile events (kind 0) by name, display_name, nip05, or about
   * Returns profile events that match the search query
   * Deduplicates by pubkey, keeping only the most recent profile event per user
   */
  async searchCachedProfiles(query: string): Promise<Event[]> {
    if (!query || query.trim() === '') {
      return [];
    }

    const searchTerm = query.toLowerCase().trim();

    // Get all kind 0 events (profile metadata)
    const profileEvents = await this.getEventsByKind(0);

    // First, deduplicate by pubkey - keep only the most recent profile event per user
    const latestByPubkey = new Map<string, Event>();
    for (const event of profileEvents) {
      const existing = latestByPubkey.get(event.pubkey);
      if (!existing || event.created_at > existing.created_at) {
        latestByPubkey.set(event.pubkey, event);
      }
    }

    // Filter profiles that match the search term
    return Array.from(latestByPubkey.values()).filter((event) => {
      try {
        const data = JSON.parse(event.content);
        const name = data.name?.toLowerCase() || '';
        const displayName = data.display_name?.toLowerCase() || '';
        const nip05Value = data.nip05;
        const nip05 = (Array.isArray(nip05Value) ? nip05Value[0] : nip05Value)?.toLowerCase() || '';
        const about = data.about?.toLowerCase() || '';

        return (
          name.includes(searchTerm) ||
          displayName.includes(searchTerm) ||
          nip05.includes(searchTerm) ||
          about.includes(searchTerm)
        );
      } catch {
        // Invalid JSON in content, skip this event
        return false;
      }
    });
  }

  /**
   * Format bytes to human readable size
   */
  formatSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
