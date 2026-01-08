import { inject, Injectable } from '@angular/core';
import { DataService } from './data.service';
import { DatabaseService } from './database.service';
import { NostrService } from './nostr.service';
import { Event as NostrEvent } from 'nostr-tools';
import { LoggerService } from './logger.service';

interface EmojiSet {
  id: string;
  title: string;
  emojis: Map<string, string>; // shortcode -> URL
  event: NostrEvent;
}

@Injectable({
  providedIn: 'root',
})
export class EmojiSetService {
  private readonly data = inject(DataService);
  private readonly database = inject(DatabaseService);
  private readonly nostr = inject(NostrService);
  private readonly logger = inject(LoggerService);

  // Cache for emoji sets by event ID
  private emojiSetCache = new Map<string, EmojiSet>();

  // Cache for user's preferred emoji sets (kind 10030)
  private userEmojiPreferences = new Map<string, Map<string, string>>();

  // Pending requests to prevent duplicate fetches
  private pendingRequests = new Map<string, Promise<EmojiSet | null>>();

  constructor() {
    // Clean up cache periodically
    setInterval(() => {
      if (this.emojiSetCache.size > 100) {
        this.logger.debug(`Emoji set cache size: ${this.emojiSetCache.size}`);
        // Clear half of the cache if it gets too large
        if (this.emojiSetCache.size > 200) {
          const keysToDelete = Array.from(this.emojiSetCache.keys()).slice(0, 100);
          keysToDelete.forEach(key => this.emojiSetCache.delete(key));
          this.logger.info('Cleared emoji set cache due to size limit');
        }
      }
    }, 60000);
  }

  /**
   * Fetch an emoji set by its addressable identifier (kind:pubkey:d-tag)
   */
  async getEmojiSet(pubkey: string, identifier: string): Promise<EmojiSet | null> {
    const cacheKey = `30030:${pubkey}:${identifier}`;

    // Check cache first
    if (this.emojiSetCache.has(cacheKey)) {
      return this.emojiSetCache.get(cacheKey)!;
    }

    // Check if we're already fetching this set
    if (this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey)!;
    }

    // Create new fetch promise
    const fetchPromise = this.fetchEmojiSet(pubkey, identifier);
    this.pendingRequests.set(cacheKey, fetchPromise);

    try {
      const result = await fetchPromise;
      return result;
    } finally {
      this.pendingRequests.delete(cacheKey);
    }
  }

  private async fetchEmojiSet(pubkey: string, identifier: string): Promise<EmojiSet | null> {
    try {
      const cacheKey = `30030:${pubkey}:${identifier}`;

      // Try to get from database first using DataService method
      const event = await this.data.getEventByPubkeyAndKindAndReplaceableEvent(
        pubkey,
        30030,
        identifier,
        { save: true, cache: false }
      );

      if (!event) {
        this.logger.warn(`Emoji set not found: ${cacheKey}`);
        return null;
      }

      // Parse emoji tags
      const emojis = new Map<string, string>();
      const title = event.event.tags.find(tag => tag[0] === 'title')?.[1] || event.event.tags.find(tag => tag[0] === 'd')?.[1] || 'Untitled';

      for (const tag of event.event.tags) {
        if (tag[0] === 'emoji' && tag[1] && tag[2]) {
          emojis.set(tag[1], tag[2]);
        }
      }

      const emojiSet: EmojiSet = {
        id: cacheKey,
        title,
        emojis,
        event: event.event,
      };

      // Cache the result
      this.emojiSetCache.set(cacheKey, emojiSet);

      return emojiSet;
    } catch (error) {
      this.logger.error('Error fetching emoji set:', error);
      return null;
    }
  }

  /**
   * Get user's preferred emoji sets from their kind 10030 list
   */
  async getUserEmojiSets(pubkey: string): Promise<Map<string, string>> {
    // Check cache first
    if (this.userEmojiPreferences.has(pubkey)) {
      this.logger.debug(`[getUserEmojiSets] Using cached emoji sets for ${pubkey.slice(0, 8)}, ${this.userEmojiPreferences.get(pubkey)!.size} emojis`);
      return this.userEmojiPreferences.get(pubkey)!;
    }

    try {
      this.logger.debug(`[getUserEmojiSets] Fetching emoji preferences (kind 10030) for ${pubkey.slice(0, 8)}`);
      // Kind 10030 is a replaceable event (10000-19999), not parameterized replaceable
      // It has no d-tag, just pubkey+kind
      const emojiListEvent = await this.database.getEventByPubkeyAndKind(pubkey, 10030);
      this.logger.debug(`[getUserEmojiSets] getEventByPubkeyAndKind returned:`, emojiListEvent);

      if (!emojiListEvent) {
        this.logger.debug(`[getUserEmojiSets] No emoji preferences found for ${pubkey.slice(0, 8)}`);
        this.logger.info(`No emoji preferences (kind 10030) event found. To use custom emojis, install an emoji set first.`);
        // Don't cache empty results - user might install an emoji set later
        return new Map();
      }

      this.logger.debug(`[getUserEmojiSets] Found emoji list event:`, emojiListEvent);
      this.logger.debug(`[getUserEmojiSets] Event tags:`, emojiListEvent.tags);

      const allEmojis = new Map<string, string>();

      // Process inline emoji tags
      for (const tag of emojiListEvent.tags) {
        if (tag[0] === 'emoji' && tag[1] && tag[2]) {
          allEmojis.set(tag[1], tag[2]);
          this.logger.debug(`[getUserEmojiSets] Found inline emoji: ${tag[1]} -> ${tag[2]}`);
        }
      }

      // Process emoji set references (a tags pointing to kind 30030)
      const emojiSetRefs = emojiListEvent.tags.filter(tag => tag[0] === 'a' && tag[1]?.startsWith('30030:'));
      this.logger.debug(`[getUserEmojiSets] Found ${emojiSetRefs.length} emoji set references`);

      for (const ref of emojiSetRefs) {
        const [kind, refPubkey, identifier] = ref[1].split(':');
        this.logger.debug(`[getUserEmojiSets] Processing emoji set reference: ${ref[1]}`);
        if (kind === '30030' && refPubkey && identifier) {
          const emojiSet = await this.getEmojiSet(refPubkey, identifier);
          if (emojiSet) {
            this.logger.debug(`[getUserEmojiSets] Loaded emoji set '${emojiSet.title}' with ${emojiSet.emojis.size} emojis`);
            // Merge emojis from the set
            for (const [shortcode, url] of emojiSet.emojis) {
              // Don't override inline emojis
              if (!allEmojis.has(shortcode)) {
                allEmojis.set(shortcode, url);
              }
            }
          } else {
            this.logger.warn(`[getUserEmojiSets] Failed to load emoji set: ${ref[1]}`);
          }
        }
      }

      // Cache the result
      this.userEmojiPreferences.set(pubkey, allEmojis);
      this.logger.debug(`[getUserEmojiSets] Total emojis loaded for ${pubkey.slice(0, 8)}: ${allEmojis.size}`);

      return allEmojis;
    } catch (error) {
      this.logger.error('Error fetching user emoji sets:', error);
      return new Map();
    }
  }

  /**
   * Clear emoji set cache for a specific user
   */
  clearUserCache(pubkey: string): void {
    this.userEmojiPreferences.delete(pubkey);
  }

  /**
   * Clear all emoji set caches
   */
  clearAllCaches(): void {
    this.emojiSetCache.clear();
    this.userEmojiPreferences.clear();
  }

  /**
   * Preload user's emoji sets in the background
   * This should be called when the app initializes or when the user logs in
   */
  async preloadUserEmojiSets(pubkey: string): Promise<void> {
    try {
      this.logger.info('Preloading emoji sets for user:', pubkey);
      const emojis = await this.getUserEmojiSets(pubkey);
      this.logger.info(`Preloaded ${emojis.size} emojis from user's sets`);
    } catch (error) {
      this.logger.error('Failed to preload user emoji sets:', error);
    }
  }
}
