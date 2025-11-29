import { Injectable, inject, signal } from '@angular/core';
import { LoggerService } from './logger.service';
import { Event } from 'nostr-tools';

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
  private initPromise: Promise<void> | null = null;

  // Signal to track initialization status
  readonly initialized = signal(false);

  // Signal to track errors
  readonly lastError = signal<string | null>(null);

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

    this.initPromise = this.openDatabase();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
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
        this.logger.warn('Database upgrade blocked - close other tabs');
        this.lastError.set('Database blocked - close other tabs');
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
   */
  async saveEvent(event: Event & { dTag?: string }): Promise<void> {
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
   * Save multiple events in a single transaction
   */
  async saveEvents(events: (Event & { dTag?: string })[]): Promise<void> {
    if (events.length === 0) return;

    const db = this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS, 'readwrite');
      const store = transaction.objectStore(STORES.EVENTS);

      for (const event of events) {
        store.put(event);
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Get an event by ID
   */
  async getEvent(id: string): Promise<Event | undefined> {
    const db = this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS, 'readonly');
      const store = transaction.objectStore(STORES.EVENTS);

      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
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
   * Get events by kind
   */
  async getEventsByKind(kind: number): Promise<Event[]> {
    const db = this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS, 'readonly');
      const store = transaction.objectStore(STORES.EVENTS);
      const index = store.index(EVENT_INDEXES.BY_KIND);

      const request = index.getAll(kind);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get events by pubkey
   */
  async getEventsByPubkey(pubkey: string): Promise<Event[]> {
    const db = this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS, 'readonly');
      const store = transaction.objectStore(STORES.EVENTS);
      const index = store.index(EVENT_INDEXES.BY_PUBKEY);

      const request = index.getAll(pubkey);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get events by pubkey and kind - optimized for single transaction
   * Handles both single pubkey and array of pubkeys efficiently
   */
  async getEventsByPubkeyAndKind(pubkey: string | string[], kind: number): Promise<Event[]> {
    const db = this.ensureInitialized();
    const pubkeys = Array.isArray(pubkey) ? pubkey : [pubkey];

    // Filter out invalid pubkeys
    const validPubkeys = pubkeys.filter(pk => pk && pk !== 'undefined' && pk.trim());
    if (validPubkeys.length === 0) {
      return [];
    }

    return new Promise((resolve, reject) => {
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

    return new Promise((resolve, reject) => {
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
   * Clear all events from the database
   */
  async clearEvents(): Promise<void> {
    const db = this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.EVENTS, 'readwrite');
      const store = transaction.objectStore(STORES.EVENTS);

      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
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
}
