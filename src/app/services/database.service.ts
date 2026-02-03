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
const DB_NAME = 'nostria-db';
const DB_VERSION = 1;

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

  private db: IDBDatabase | null = null;

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

  // Old database name that was used before refactoring to DatabaseService
  private readonly OLD_DB_NAME = 'nostria';

  /**
   * Initialize the database connection
   * Returns a promise that resolves when the database is ready
   */
  async init(): Promise<void> {
    // Return existing promise if already initializing
    if (this.initPromise) {
      return this.initPromise;
    }

    // Already initialized
    if (this.db && this.initialized()) {
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
   * Perform initialization - open the database
   */
  private async performInit(): Promise<void> {
    await this.openDatabase();
  }

  /**
   * Open or create the IndexedDB database
   */
  private openDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.logger.info(`Opening database: ${DB_NAME} v${DB_VERSION}`);

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      // Set a timeout to prevent hanging
      const timeout = setTimeout(() => {
        this.logger.error('Database open timeout after 10 seconds');
        this.lastError.set('Database open timeout');
        reject(new Error('Database open timeout after 10 seconds'));
      }, 10000);

      request.onerror = (event) => {
        clearTimeout(timeout);
        const error = (event.target as IDBOpenDBRequest).error;
        this.logger.error('Failed to open database', error);
        this.lastError.set(error?.message || 'Unknown database error');
        reject(error);
      };

      request.onsuccess = (event) => {
        clearTimeout(timeout);
        this.db = (event.target as IDBOpenDBRequest).result;

        // Handle connection errors
        this.db.onerror = (event) => {
          this.logger.error('Database error', (event.target as IDBDatabase)?.name);
        };

        // Handle version change (another tab upgraded the database)
        this.db.onversionchange = () => {
          this.logger.warn('Database version changed in another tab, closing connection');
          this.db?.close();
          this.db = null;
          this.initialized.set(false);
        };

        this.initialized.set(true);
        this.logger.info('Database opened successfully');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        clearTimeout(timeout);
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = event.oldVersion;

        this.logger.info(`Upgrading database from version ${oldVersion} to ${DB_VERSION}`);
        this.createSchema(db);
      };

      request.onblocked = () => {
        clearTimeout(timeout);
        this.logger.warn('Database upgrade blocked - close other tabs');
        this.lastError.set('Database blocked - close other tabs');
        // Reject immediately when blocked - user needs to close other tabs
        reject(new Error('Database blocked by another tab. Please close all other Nostria tabs and try again.'));
      };
    });
  }

  /**
   * Create or upgrade the database schema
   * @param db The IDBDatabase instance
   */
  private createSchema(db: IDBDatabase): void {
    // Create events store
    if (!db.objectStoreNames.contains(STORES.EVENTS)) {
      const eventsStore = db.createObjectStore(STORES.EVENTS, { keyPath: 'id' });
      eventsStore.createIndex(EVENT_INDEXES.BY_KIND, 'kind', { unique: false });
      eventsStore.createIndex(EVENT_INDEXES.BY_PUBKEY, 'pubkey', { unique: false });
      eventsStore.createIndex(EVENT_INDEXES.BY_CREATED, 'created_at', { unique: false });
      eventsStore.createIndex(EVENT_INDEXES.BY_PUBKEY_KIND, ['pubkey', 'kind'], { unique: false });
      eventsStore.createIndex(EVENT_INDEXES.BY_PUBKEY_KIND_DTAG, ['pubkey', 'kind', 'dTag'], { unique: false });
      this.logger.debug('Created events store');
    }

    // Create info store
    if (!db.objectStoreNames.contains(STORES.INFO)) {
      const infoStore = db.createObjectStore(STORES.INFO, { keyPath: 'compositeKey' });
      infoStore.createIndex('by-type', 'type', { unique: false });
      infoStore.createIndex('by-key', 'key', { unique: false });
      infoStore.createIndex('by-updated', 'updated', { unique: false });
      this.logger.debug('Created info store');
    }

    // Create relays store
    if (!db.objectStoreNames.contains(STORES.RELAYS)) {
      const relaysStore = db.createObjectStore(STORES.RELAYS, { keyPath: 'url' });
      relaysStore.createIndex('by-status', 'status', { unique: false });
      this.logger.debug('Created relays store');
    }

    // Create notifications store
    if (!db.objectStoreNames.contains(STORES.NOTIFICATIONS)) {
      const notificationsStore = db.createObjectStore(STORES.NOTIFICATIONS, { keyPath: 'id' });
      notificationsStore.createIndex('by-timestamp', 'timestamp', { unique: false });
      notificationsStore.createIndex('by-recipient', 'recipientPubkey', { unique: false });
      this.logger.debug('Created notifications store');
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
   * Ensure database is initialized before operations
   */
  private ensureInitialized(): IDBDatabase {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    return this.db;
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized.set(false);
      this.logger.info('Database connection closed');
    }
  }

  // ============================================================================
  // EVENT OPERATIONS
  // ============================================================================

  /**
   * Save a single event to the database
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

    const db = this.ensureInitialized();

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
   * Save multiple events in a single transaction
   * Filters out expired events (NIP-40) before saving
   */
  async saveEvents(events: (Event & { dTag?: string })[]): Promise<void> {
    // Filter out malformed and expired events
    const validEvents = events.filter(event => {
      // Check if event is valid
      if (!event || !event.id || typeof event.kind !== 'number') {
        this.logger.warn('Skipping malformed event in batch save:', event);
        return false;
      }

      // Ensure tags array exists
      if (!event.tags) {
        event.tags = [];
      }

      // Check if event is expired
      return !this.isEventExpired(event);
    });

    if (validEvents.length === 0) return;

    if (validEvents.length !== events.length) {
      this.logger.debug(`Filtered out ${events.length - validEvents.length} invalid/expired events before saving`);
    }

    const db = this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS, 'readwrite');
      const store = transaction.objectStore(STORES.EVENTS);

      for (const event of validEvents) {
        store.put(event);
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Get an event by ID
   * Checks for expiration (NIP-40) and deletes if expired
   */
  async getEvent(id: string): Promise<Event | undefined> {
    const db = this.ensureInitialized();

    const event = await new Promise<Event | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS, 'readonly');
      const store = transaction.objectStore(STORES.EVENTS);

      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

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
   * Delete an event by ID
   */
  async deleteEvent(id: string): Promise<void> {
    const db = this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS, 'readwrite');
      const store = transaction.objectStore(STORES.EVENTS);

      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete multiple events by ID in a single transaction
   */
  async deleteEvents(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    const db = this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS, 'readwrite');
      const store = transaction.objectStore(STORES.EVENTS);

      for (const id of ids) {
        store.delete(id);
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Get events by kind
   * Filters out expired events (NIP-40) and deletes them from the database
   */
  async getEventsByKind(kind: number): Promise<Event[]> {
    const db = this.ensureInitialized();

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
   * Get events by kind that have a specific e-tag
   * Uses a cursor to filter efficiently without loading all events into memory
   * Filters out expired events (NIP-40)
   */
  async getEventsByKindAndEventTag(kind: number, eventTag: string): Promise<Event[]> {
    const db = this.ensureInitialized();

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
          // Check if event has the target e-tag
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
   * Get events by multiple kinds that have a specific e-tag
   * Uses cursors to filter efficiently without loading all events into memory
   * Filters out expired events (NIP-40)
   */
  async getEventsByKindsAndEventTag(kinds: number[], eventTag: string): Promise<Event[]> {
    const db = this.ensureInitialized();

    // Query each kind in parallel using cursors
    const kindPromises = kinds.map(kind => {
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
            // Check if event has the target e-tag
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

    const allResults = await Promise.all(kindPromises);
    const events = allResults.flat();

    return this.filterAndDeleteExpiredEvents(events);
  }

  /**
   * Get events by pubkey
   * Filters out expired events (NIP-40) and deletes them from the database
   */
  async getEventsByPubkey(pubkey: string): Promise<Event[]> {
    const db = this.ensureInitialized();

    const events = await new Promise<Event[]>((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS, 'readonly');
      const store = transaction.objectStore(STORES.EVENTS);
      const index = store.index(EVENT_INDEXES.BY_PUBKEY);

      const request = index.getAll(pubkey);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    return this.filterAndDeleteExpiredEvents(events);
  }

  /**
   * Get events by pubkey and kind - optimized for single transaction
   * Handles both single pubkey and array of pubkeys efficiently
   * Filters out expired events (NIP-40) and deletes them from the database
   */
  async getEventsByPubkeyAndKind(pubkey: string | string[], kind: number): Promise<Event[]> {
    const db = this.ensureInitialized();
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

          // All requests completed
          if (completed === validPubkeys.length) {
            resolve(results);
          }
        };

        request.onerror = () => {
          reject(request.error);
        };
      }

      // Handle empty pubkeys array
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
   * Get events by pubkey, kind, and d-tag (for parameterized replaceable events)
   * Filters out expired events (NIP-40) and deletes them from the database
   */
  async getEventsByPubkeyKindAndDTag(
    pubkey: string | string[],
    kind: number,
    dTag: string
  ): Promise<Event[]> {
    const db = this.ensureInitialized();
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
   * Get all events (use with caution - can be slow for large datasets)
   */
  async getAllEvents(): Promise<Event[]> {
    const db = this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS, 'readonly');
      const store = transaction.objectStore(STORES.EVENTS);

      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Count events in the database
   */
  async countEvents(): Promise<number> {
    const db = this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS, 'readonly');
      const store = transaction.objectStore(STORES.EVENTS);

      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all cached data from all database stores
   * This clears: events, eventsCache, badgeDefinitions, info, relays, 
   * notifications, observedRelays, pubkeyRelayMappings, and messages
   */
  async clearAllData(): Promise<void> {
    const db = this.ensureInitialized();

    const storesToClear = [
      STORES.EVENTS,
      STORES.EVENTS_CACHE,
      STORES.BADGE_DEFINITIONS,
      STORES.INFO,
      STORES.RELAYS,
      STORES.NOTIFICATIONS,
      STORES.OBSERVED_RELAYS,
      STORES.PUBKEY_RELAY_MAPPINGS,
      STORES.MESSAGES,
    ];

    for (const storeName of storesToClear) {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);

        const request = store.clear();

        request.onsuccess = () => {
          this.logger.debug(`Cleared store: ${storeName}`);
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    }

    this.logger.info('Cleared all data from database');
  }

  /**
   * Clear events store only
   */
  async clearEvents(): Promise<void> {
    await this.clear(STORES.EVENTS);
    await this.clear(STORES.EVENTS_CACHE);
    this.logger.info('Cleared events from database');
  }

  /**
   * Clear relays-related stores
   */
  async clearRelaysData(): Promise<void> {
    await this.clear(STORES.RELAYS);
    await this.clear(STORES.OBSERVED_RELAYS);
    await this.clear(STORES.PUBKEY_RELAY_MAPPINGS);
    this.logger.info('Cleared relays data from database');
  }

  // ============================================================================
  // INFO RECORD OPERATIONS
  // ============================================================================

  /**
   * Save an info record
   */
  async saveInfoRecord(record: { compositeKey: string; key: string; type: string; updated: number;[key: string]: unknown }): Promise<void> {
    const db = this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.INFO, 'readwrite');
      const store = transaction.objectStore(STORES.INFO);

      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get an info record by composite key
   */
  async getInfoRecord(compositeKey: string): Promise<Record<string, unknown> | undefined> {
    const db = this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.INFO, 'readonly');
      const store = transaction.objectStore(STORES.INFO);

      const request = store.get(compositeKey);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get info records by type
   */
  async getInfoRecordsByType(type: string): Promise<Record<string, unknown>[]> {
    const db = this.ensureInitialized();

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
   * Delete an info record
   */
  async deleteInfoRecord(compositeKey: string): Promise<void> {
    const db = this.ensureInitialized();

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
   * Get a value from any store by key
   */
  async get<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
    const db = this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);

      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Put a value into any store
   */
  async put<T>(storeName: string, value: T): Promise<void> {
    const db = this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);

      const request = store.put(value);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete a value from any store
   */
  async delete(storeName: string, key: IDBValidKey): Promise<void> {
    const db = this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);

      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all values from a store
   */
  async getAll<T>(storeName: string): Promise<T[]> {
    const db = this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);

      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all values from a store using an index
   */
  async getAllFromIndex<T>(storeName: string, indexName: string, key: IDBValidKey): Promise<T[]> {
    const db = this.ensureInitialized();

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
   * Wipe the entire database (both old and new)
   */
  async wipe(): Promise<void> {
    this.logger.info('Wiping IndexedDB databases');

    // Close the current database connection if it exists
    if (this.db) {
      this.db.close();
      this.db = null;
    }

    // Delete both the new and old databases
    const deletePromises: Promise<void>[] = [];

    // Delete new database
    deletePromises.push(this.deleteDatabaseByName(DB_NAME));

    // Delete old database (from before refactor)
    deletePromises.push(this.deleteDatabaseByName(this.OLD_DB_NAME));

    try {
      await Promise.all(deletePromises);
      this.initialized.set(false);
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
   * Clear all data from a store
   */
  async clear(storeName: string): Promise<void> {
    const db = this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);

      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Count items in a store
   */
  async count(storeName: string): Promise<number> {
    const db = this.ensureInitialized();

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
   * Delete the entire database
   */
  async deleteDatabase(): Promise<void> {
    // Close existing connection first
    this.close();

    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);

      request.onsuccess = () => {
        this.logger.info('Database deleted successfully');
        resolve();
      };

      request.onerror = () => {
        this.logger.error('Failed to delete database', request.error);
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
   * Save a direct message to the database
   */
  async saveDirectMessage(message: StoredDirectMessage): Promise<void> {
    const db = this.ensureInitialized();

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
   * Save multiple direct messages in a single transaction
   */
  async saveDirectMessages(messages: StoredDirectMessage[]): Promise<void> {
    if (messages.length === 0) return;

    const db = this.ensureInitialized();

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
   * Get all messages for a specific chat
   */
  async getMessagesForChat(accountPubkey: string, chatId: string): Promise<StoredDirectMessage[]> {
    const db = this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.MESSAGES, 'readonly');
      const store = transaction.objectStore(STORES.MESSAGES);
      const index = store.index('by-account-chat');

      const request = index.getAll([accountPubkey, chatId]);

      request.onsuccess = () => {
        const messages = request.result || [];
        // Sort by creation time ascending
        messages.sort((a, b) => a.created_at - b.created_at);
        resolve(messages);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all chats for an account (returns unique chat IDs with message counts)
   */
  async getChatsForAccount(accountPubkey: string): Promise<{
    chatId: string;
    messageCount: number;
    lastMessageTime: number;
    unreadCount: number;
  }[]> {
    const db = this.ensureInitialized();

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
   * Check if a message already exists in the database
   */
  async messageExists(accountPubkey: string, chatId: string, messageId: string): Promise<boolean> {
    const db = this.ensureInitialized();
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
   * Check if a gift wrap event has already been processed (message already decrypted and stored)
   * This is used to skip re-decryption of NIP-44 messages that were already processed.
   */
  async giftWrapExists(accountPubkey: string, giftWrapId: string): Promise<boolean> {
    const db = this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.MESSAGES, 'readonly');
      const store = transaction.objectStore(STORES.MESSAGES);
      const index = store.index('by-account');

      // Get all messages for this account and check if any have this giftWrapId
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
   * Mark a message as read
   */
  async markMessageAsRead(accountPubkey: string, chatId: string, messageId: string): Promise<void> {
    const db = this.ensureInitialized();
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
          putRequest.onsuccess = () => {
            this.logger.debug(`Marked message ${messageId} as read`);
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
   * Mark all messages in a chat as read
   */
  async markChatAsRead(accountPubkey: string, chatId: string): Promise<void> {
    const messages = await this.getMessagesForChat(accountPubkey, chatId);
    const unreadMessages = messages.filter(msg => !msg.read && !msg.isOutgoing);

    if (unreadMessages.length === 0) {
      return;
    }

    const db = this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.MESSAGES, 'readwrite');
      const store = transaction.objectStore(STORES.MESSAGES);

      for (const msg of unreadMessages) {
        msg.read = true;
        store.put(msg);
      }

      transaction.oncomplete = () => {
        this.logger.debug(`Marked ${unreadMessages.length} messages as read in chat ${chatId}`);
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Delete a specific message
   */
  async deleteDirectMessage(accountPubkey: string, chatId: string, messageId: string): Promise<void> {
    const db = this.ensureInitialized();
    const id = `${accountPubkey}::${chatId}::${messageId}`;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.MESSAGES, 'readwrite');
      const store = transaction.objectStore(STORES.MESSAGES);

      const request = store.delete(id);

      request.onsuccess = () => {
        this.logger.debug(`Deleted message ${messageId}`);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete all messages for a specific chat
   */
  async deleteChat(accountPubkey: string, chatId: string): Promise<void> {
    const messages = await this.getMessagesForChat(accountPubkey, chatId);

    if (messages.length === 0) {
      return;
    }

    const db = this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.MESSAGES, 'readwrite');
      const store = transaction.objectStore(STORES.MESSAGES);

      for (const msg of messages) {
        store.delete(msg.id);
      }

      transaction.oncomplete = () => {
        this.logger.debug(`Deleted ${messages.length} messages from chat ${chatId}`);
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Delete all messages for an account
   */
  async deleteAllMessagesForAccount(accountPubkey: string): Promise<void> {
    const db = this.ensureInitialized();

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

      transaction.oncomplete = () => {
        this.logger.debug(`Deleted messages for account ${accountPubkey}`);
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Get the most recent message timestamp for an account (used for pagination)
   */
  async getMostRecentMessageTimestamp(accountPubkey: string): Promise<number> {
    const db = this.ensureInitialized();

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
   * Clear all messages from the database (reset local messages cache)
   */
  async clearAllMessages(): Promise<void> {
    const db = this.ensureInitialized();

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
   * Save cached events for a feed column
   * Keeps events from the last 90 days to support infinite scrolling
   */
  async saveCachedEvents(
    accountPubkey: string,
    columnId: string,
    events: Event[]
  ): Promise<void> {
    const db = this.ensureInitialized();

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
   * Load cached events for a feed column
   */
  async loadCachedEvents(accountPubkey: string, columnId: string): Promise<Event[]> {
    const db = this.ensureInitialized();

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
   * Delete cached events for a specific column
   */
  async deleteCachedEventsForColumn(
    accountPubkey: string,
    columnId: string
  ): Promise<void> {
    const db = this.ensureInitialized();

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
   * Delete all cached events for an account
   */
  async deleteCachedEventsForAccount(accountPubkey: string): Promise<void> {
    const db = this.ensureInitialized();

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
   * Clean up old cached events across all accounts
   * This method is called periodically to prevent unbounded growth
   * Removes events older than 1 week
   */
  async cleanupCachedEvents(): Promise<void> {
    const db = this.ensureInitialized();
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
   * Get the total count of cached events
   */
  async getCachedEventsCount(): Promise<number> {
    const db = this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS_CACHE, 'readonly');
      const store = transaction.objectStore(STORES.EVENTS_CACHE);
      const countRequest = store.count();

      countRequest.onsuccess = () => resolve(countRequest.result);
      countRequest.onerror = () => reject(countRequest.error);
    });
  }

  /**
   * Get cached events statistics for debugging
   */
  async getCachedEventsStats(): Promise<{
    totalEvents: number;
    eventsByAccount: Map<string, number>;
    eventsByColumn: Map<string, number>;
  }> {
    const db = this.ensureInitialized();

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
   * Clear all cached events from the database
   */
  async clearAllCachedEvents(): Promise<void> {
    const db = this.ensureInitialized();

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
    const db = this.ensureInitialized();

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
    const db = this.ensureInitialized();

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
    const db = this.ensureInitialized();

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
    const db = this.ensureInitialized();

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
    const db = this.ensureInitialized();

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
    const db = this.ensureInitialized();

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
    const db = this.ensureInitialized();

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
    const db = this.ensureInitialized();

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
    const db = this.ensureInitialized();

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
    const db = this.ensureInitialized();

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
    const db = this.ensureInitialized();

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
    const db = this.ensureInitialized();

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
    const db = this.ensureInitialized();

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
    const db = this.ensureInitialized();

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
    const db = this.ensureInitialized();

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
    const db = this.ensureInitialized();

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
    const db = this.ensureInitialized();

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
    const db = this.ensureInitialized();

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
    const db = this.ensureInitialized();

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
    const db = this.ensureInitialized();

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
    const db = this.ensureInitialized();
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
   * Get all events by pubkey
   */
  async getUserEvents(pubkey: string): Promise<Event[]> {
    const db = this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS, 'readonly');
      const store = transaction.objectStore(STORES.EVENTS);
      const index = store.index('by-pubkey');

      const request = index.getAll(pubkey);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
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
