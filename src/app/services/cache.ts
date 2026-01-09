import { Injectable, signal, computed } from '@angular/core';

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  expiresAt: number | null; // null means never expires
  lastAccessed: number;
}

export interface CacheOptions {
  maxSize?: number;
  ttl?: number; // Time to live in milliseconds
  persistent?: boolean; // Never expires if true
}

export interface CacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  evictions: number;
}

@Injectable({
  providedIn: 'root',
})
export class Cache {
  private readonly cache = new Map<string, CacheEntry<any>>();

  private readonly defaultOptions: Required<CacheOptions> = {
    maxSize: 10000, // Increased to support large following lists
    ttl: 5 * 60 * 1000, // 5 minutes
    persistent: false,
  };

  // Signals for reactive cache statistics
  private readonly _stats = signal<CacheStats>({
    size: 0,
    maxSize: this.defaultOptions.maxSize,
    hits: 0,
    misses: 0,
    evictions: 0,
  });

  public readonly stats = computed(() => this._stats());

  constructor() {
    // Cleanup expired entries every minute
    this.scheduleCleanup();
  }

  /**
   * Sets a value in the cache with optional configuration
   */
  set<T>(key: string, value: T, options: CacheOptions = {}): void {
    const config = { ...this.defaultOptions, ...options };
    const now = Date.now();

    const entry: CacheEntry<T> = {
      value,
      timestamp: now,
      expiresAt: config.persistent ? null : now + config.ttl,
      lastAccessed: now,
    };

    // If cache is at max size, remove least recently used item
    if (this.cache.size >= config.maxSize && !this.cache.has(key)) {
      this.evictLeastRecentlyUsed();
    }

    this.cache.set(key, entry);
    this.scheduleStatsUpdate({ size: this.cache.size });
  }

  /**
   * Gets a value from the cache
   */
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      this.scheduleStatsUpdate({ misses: this._stats().misses + 1 });
      return undefined;
    }

    // Check if entry has expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.scheduleStatsUpdate({
        size: this.cache.size,
        misses: this._stats().misses + 1,
      });
      return undefined;
    }

    // Update last accessed time
    entry.lastAccessed = Date.now();
    this.scheduleStatsUpdate({ hits: this._stats().hits + 1 });

    return entry.value;
  }

  /**
   * Checks if a key exists in the cache and is not expired
   */
  has(key: string): boolean {
    // Check for both undefined and null.
    return this.get(key) != null;
  }

  /**
   * Gets the cache entry with metadata (for staleness checking)
   */
  getEntry<T>(key: string): CacheEntry<T> | undefined {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    
    if (!entry) {
      return undefined;
    }

    // Check if entry has expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry;
  }

  /**
   * Removes a specific key from the cache
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.scheduleStatsUpdate({ size: this.cache.size });
    }
    return deleted;
  }

  /**
   * Clears all entries from the cache
   */
  clear(): void {
    this.cache.clear();
    this.updateStats({
      size: 0,
      hits: 0,
      misses: 0,
      evictions: 0,
    });
  }

  /**
   * Gets all keys in the cache
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Gets all values in the cache
   */
  values<T>(): T[] {
    return Array.from(this.cache.values()).map(entry => entry.value);
  }

  /**
   * Gets all entries with their metadata
   */
  entries<T>(): [string, CacheEntry<T>][] {
    return Array.from(this.cache.entries());
  }

  /**
   * Sets multiple values at once
   */
  setMany<T>(entries: [string, T][], options: CacheOptions = {}): void {
    entries.forEach(([key, value]) => {
      this.set(key, value, options);
    });
  }

  /**
   * Gets multiple values at once
   */
  getMany<T>(keys: string[]): [string, T | undefined][] {
    return keys.map(key => [key, this.get<T>(key)]);
  }

  /**
   * Removes expired entries manually
   */
  cleanup(): number {
    const now = Date.now();
    let removedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.cache.delete(key);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.scheduleStatsUpdate({ size: this.cache.size });
    }

    return removedCount;
  }

  /**
   * Updates cache configuration
   */
  configure(options: Partial<CacheOptions>): void {
    Object.assign(this.defaultOptions, options);
    this.scheduleStatsUpdate({ maxSize: this.defaultOptions.maxSize });
  }

  /**
   * Gets cache usage percentage
   */
  getUsagePercentage(): number {
    const stats = this._stats();
    return stats.maxSize > 0 ? (stats.size / stats.maxSize) * 100 : 0;
  }

  /**
   * Gets cache hit rate
   */
  getHitRate(): number {
    const stats = this._stats();
    const total = stats.hits + stats.misses;
    return total > 0 ? (stats.hits / total) * 100 : 0;
  }

  private evictLeastRecentlyUsed(): void {
    let lruKey: string | null = null;
    let lruTime = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < lruTime) {
        lruTime = entry.lastAccessed;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey);
      this.scheduleStatsUpdate({
        size: this.cache.size,
        evictions: this._stats().evictions + 1,
      });
    }
  }

  private updateStats(updates: Partial<CacheStats>): void {
    this._stats.update(current => ({ ...current, ...updates }));
  }

  private scheduleStatsUpdate(updates: Partial<CacheStats>): void {
    // Use setTimeout to defer the signal update until after the current rendering cycle
    setTimeout(() => {
      this.updateStats(updates);
    }, 0);
  }

  private scheduleCleanup(): void {
    const cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000); // Every minute

    // Cleanup on page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        clearInterval(cleanupInterval);
      });
    }
  }
}
