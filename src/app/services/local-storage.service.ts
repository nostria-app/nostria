import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal, DOCUMENT } from '@angular/core';
import { LoggerService } from './logger.service';

/**
 * Service for interacting with browser localStorage with SSR compatibility
 */
@Injectable({
  providedIn: 'root',
})
export class LocalStorageService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly logger = inject(LoggerService);

  // Signal to track if we're running in browser (as opposed to server)
  private readonly isBrowser = signal(isPlatformBrowser(this.platformId));

  // Memory storage for SSR fallback
  private readonly memoryStore = signal<Record<string, string>>({});

  // Computed state that checks if local storage is available
  readonly isAvailable = computed(() => {
    if (!this.isBrowser()) return false;

    try {
      const testKey = '___test___';
      localStorage.setItem(testKey, testKey);
      localStorage.removeItem(testKey);
      return true;
    } catch (e) {
      this.logger.warn('LocalStorage is not available:', e);
      return false;
    }
  });

  /**
   * Get an item from localStorage or memory fallback
   * @param key The key to retrieve
   * @returns The stored value or null if not found
   */
  getItem(key: string) {
    try {
      if (this.isAvailable()) {
        const value = localStorage.getItem(key);
        // Removed debug logging to reduce console spam
        return value;
      } else {
        const value = this.memoryStore()[key] ?? null;
        this.logger.debug(`Retrieved "${key}" from memory store (SSR or localStorage unavailable)`);
        return value;
      }
    } catch (error) {
      this.logger.error(`Error getting "${key}" from storage:`, error);
      return null;
    }
  }

  /**
   * Set an item in localStorage or memory fallback
   * @param key The key to set
   * @param value The value to store
   * @returns True if successful, false otherwise
   */
  setItem(key: string, value: string) {
    try {
      if (this.isAvailable()) {
        localStorage.setItem(key, value);
        this.logger.debug(`Stored "${key}" in localStorage`);
        return true;
      } else {
        // Update memory store for SSR
        this.memoryStore.update(store => ({
          ...store,
          [key]: value,
        }));
        this.logger.debug(`Stored "${key}" in memory store (SSR or localStorage unavailable)`);
        return true;
      }
    } catch (error) {
      this.logger.error(`Error setting "${key}" in storage:`, error);
      return false;
    }
  }

  /**
   * Remove an item from localStorage or memory fallback
   * @param key The key to remove
   * @returns True if successful, false otherwise
   */
  removeItem(key: string) {
    try {
      if (this.isAvailable()) {
        localStorage.removeItem(key);
        this.logger.debug(`Removed "${key}" from localStorage`);
        return true;
      } else {
        // Update memory store for SSR
        this.memoryStore.update(store => {
          const { [key]: removed, ...rest } = store;
          return rest;
        });
        this.logger.debug(`Removed "${key}" from memory store (SSR or localStorage unavailable)`);
        return true;
      }
    } catch (error) {
      this.logger.error(`Error removing "${key}" from storage:`, error);
      return false;
    }
  }

  /**
   * Clear all items from localStorage or memory fallback
   * @returns True if successful, false otherwise
   */
  clear() {
    try {
      if (this.isAvailable()) {
        localStorage.clear();
        this.logger.debug('Cleared localStorage');
        return true;
      } else {
        // Clear memory store
        this.memoryStore.set({});
        this.logger.debug('Cleared memory store (SSR or localStorage unavailable)');
        return true;
      }
    } catch (error) {
      this.logger.error('Error clearing storage:', error);
      return false;
    }
  }

  /**
   * Get all keys stored in localStorage or memory fallback
   * @returns Array of storage keys
   */
  getKeys() {
    try {
      if (this.isAvailable()) {
        return Object.keys(localStorage);
      } else {
        return Object.keys(this.memoryStore());
      }
    } catch (error) {
      this.logger.error('Error getting storage keys:', error);
      return [];
    }
  }

  /**
   * Store an object in localStorage or memory fallback by serializing it to JSON
   * @param key The key to store
   * @param value The object to store
   * @returns True if successful, false otherwise
   */
  setObject<T>(key: string, value: T) {
    try {
      const serialized = JSON.stringify(value);
      return this.setItem(key, serialized);
    } catch (error) {
      this.logger.error(`Error storing object for "${key}":`, error);
      return false;
    }
  }

  /**
   * Get an object from localStorage or memory fallback and deserialize it
   * @param key The key to retrieve
   * @returns The deserialized object or null if not found or invalid
   */
  getObject<T>(key: string) {
    try {
      const value = this.getItem(key);
      if (!value) return null;

      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.error(`Error retrieving object for "${key}":`, error);
      return null;
    }
  }
}
