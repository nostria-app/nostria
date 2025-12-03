import { Injectable, signal } from '@angular/core';

interface PendingSubscription {
  key: string;
  promise: Promise<unknown>;
  timestamp: number;
  eventIds: string[];
  type: 'reactions' | 'reposts' | 'reports' | 'event' | 'replies' | 'interactions' | 'quotes';
}

interface CachedResult {
  data: unknown;
  timestamp: number;
  expiresAt: number;
}

/**
 * Service to prevent duplicate subscriptions and cache results for event-related queries.
 * This helps reduce the number of concurrent relay subscriptions and prevents redundant requests.
 */
@Injectable({
  providedIn: 'root',
})
export class SubscriptionCacheService {
  private pendingSubscriptions = new Map<string, PendingSubscription>();
  private resultCache = new Map<string, CachedResult>();
  private readonly cacheTimeout = 5 * 60 * 1000; // 5 minutes
  private readonly deduplicationWindow = 10 * 1000; // 10 seconds

  // Debug statistics
  private readonly cacheHits = signal(0);
  private readonly cacheMisses = signal(0);
  private readonly deduplicationHits = signal(0);

  constructor() {
    // Clean up expired cache entries every minute
    setInterval(() => this.cleanupExpiredEntries(), 60 * 1000);
  }

  /**
   * Get or create a subscription with deduplication.
   * If a similar request is already pending, returns that promise instead of creating a new one.
   */
  async getOrCreateSubscription<T>(
    key: string,
    eventIds: string[],
    type: PendingSubscription['type'],
    subscriptionFactory: () => Promise<T>,
  ): Promise<T> {
    // Check if we have a cached result first
    const cachedResult = this.getCachedResult<T>(key);
    if (cachedResult !== null) {
      this.cacheHits.update((count) => count + 1);
      return cachedResult;
    }

    // Check if there's already a pending subscription
    const pendingKey = this.generatePendingKey(key, eventIds, type);
    const existing = this.pendingSubscriptions.get(pendingKey);

    if (existing && Date.now() - existing.timestamp < this.deduplicationWindow) {
      this.deduplicationHits.update((count) => count + 1);
      console.log(`[SubscriptionCache] Deduplicating request for ${type}: ${eventIds.join(', ')}`);
      return existing.promise as Promise<T>;
    }

    // Create new subscription
    this.cacheMisses.update((count) => count + 1);
    const promise = subscriptionFactory();

    // Store pending subscription
    const pendingSubscription: PendingSubscription = {
      key: pendingKey,
      promise,
      timestamp: Date.now(),
      eventIds: [...eventIds],
      type,
    };

    this.pendingSubscriptions.set(pendingKey, pendingSubscription);

    // Handle completion
    promise
      .then((result) => {
        // Cache the result
        this.setCachedResult(key, result);

        // Remove from pending
        this.pendingSubscriptions.delete(pendingKey);

        return result;
      })
      .catch((error) => {
        // Remove from pending on error
        this.pendingSubscriptions.delete(pendingKey);
        throw error;
      });

    return promise;
  }

  /**
   * Get cached result if available and not expired
   */
  getCachedResult<T>(key: string): T | null {
    const cached = this.resultCache.get(key);
    if (!cached) {
      return null;
    }

    if (Date.now() > cached.expiresAt) {
      this.resultCache.delete(key);
      return null;
    }

    return cached.data as T;
  }

  /**
   * Store result in cache
   */
  setCachedResult(key: string, data: unknown): void {
    const cached: CachedResult = {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.cacheTimeout,
    };

    this.resultCache.set(key, cached);
  }

  /**
   * Invalidate cache entries for specific event IDs
   */
  invalidateEventCache(eventIds: string[]): void {
    const keysToDelete: string[] = [];

    for (const [key] of this.resultCache.entries()) {
      if (eventIds.some((eventId) => key.includes(eventId))) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.resultCache.delete(key));
    console.log(`[SubscriptionCache] Invalidated ${keysToDelete.length} cache entries`);
  }

  /**
   * Generate cache key for event-related queries
   */
  generateCacheKey(type: string, eventIds: string[], userPubkey?: string): string {
    const sortedEventIds = [...eventIds].sort();
    return `${type}:${sortedEventIds.join(',')}${userPubkey ? ':' + userPubkey : ''}`;
  }

  /**
   * Generate key for pending subscription tracking
   */
  private generatePendingKey(cacheKey: string, eventIds: string[], type: string): string {
    return `pending:${type}:${cacheKey}`;
  }

  /**
   * Clean up expired cache entries and old pending subscriptions
   */
  private cleanupExpiredEntries(): void {
    const now = Date.now();
    let cleanedCache = 0;
    let cleanedPending = 0;

    // Clean expired cache entries
    for (const [key, cached] of this.resultCache.entries()) {
      if (now > cached.expiresAt) {
        this.resultCache.delete(key);
        cleanedCache++;
      }
    }

    // Clean old pending subscriptions (older than deduplication window)
    for (const [key, pending] of this.pendingSubscriptions.entries()) {
      if (now - pending.timestamp > this.deduplicationWindow * 2) {
        this.pendingSubscriptions.delete(key);
        cleanedPending++;
      }
    }

    if (cleanedCache > 0 || cleanedPending > 0) {
      console.log(
        `[SubscriptionCache] Cleaned up ${cleanedCache} cached entries and ${cleanedPending} pending subscriptions`,
      );
    }
  }

  /**
   * Get debug statistics
   */
  getStatistics() {
    return {
      cacheHits: this.cacheHits(),
      cacheMisses: this.cacheMisses(),
      deduplicationHits: this.deduplicationHits(),
      cachedEntries: this.resultCache.size,
      pendingSubscriptions: this.pendingSubscriptions.size,
      hitRate: (this.cacheHits() / (this.cacheHits() + this.cacheMisses())) * 100,
    };
  }

  /**
   * Clear all cache and pending subscriptions (for testing/debugging)
   */
  clearAll(): void {
    this.resultCache.clear();
    this.pendingSubscriptions.clear();
    this.cacheHits.set(0);
    this.cacheMisses.set(0);
    this.deduplicationHits.set(0);
  }
}
