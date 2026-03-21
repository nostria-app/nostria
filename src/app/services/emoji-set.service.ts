import { inject, Injectable, OnDestroy, signal } from '@angular/core';
import { DataService } from './data.service';
import { DatabaseService } from './database.service';
import { UserDataService } from './user-data.service';
import { NostrService } from './nostr.service';
import { Event as NostrEvent } from 'nostr-tools';
import { LoggerService } from './logger.service';

interface EmojiSet {
  id: string;
  title: string;
  emojis: Map<string, string>; // shortcode -> URL
  event: NostrEvent;
}

export interface EmojiSetGroup {
  id: string;
  title: string;
  emojis: { shortcode: string; url: string }[];
}

@Injectable({
  providedIn: 'root',
})
export class EmojiSetService implements OnDestroy {
  private readonly data = inject(DataService);
  private readonly database = inject(DatabaseService);
  private readonly userData = inject(UserDataService);
  private readonly nostr = inject(NostrService);
  private readonly logger = inject(LoggerService);

  // Cache for emoji sets by event ID
  private emojiSetCache = new Map<string, EmojiSet>();

  // Cache for user's preferred emoji sets (kind 10030)
  private userEmojiPreferences = new Map<string, Map<string, string>>();

  // Pending requests to prevent duplicate fetches
  private pendingRequests = new Map<string, Promise<EmojiSet | null>>();

  // Store interval handle for cleanup
  private cacheCleanupIntervalHandle: ReturnType<typeof setInterval> | null = null;

  /**
   * Signal that increments whenever the user's emoji preferences change.
   * Components can use this in an effect() to reload emoji data.
   */
  readonly preferencesChanged = signal(0);

  constructor() {
    // Clean up cache periodically
    this.cacheCleanupIntervalHandle = setInterval(() => {
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

  ngOnDestroy(): void {
    if (this.cacheCleanupIntervalHandle) {
      clearInterval(this.cacheCleanupIntervalHandle);
      this.cacheCleanupIntervalHandle = null;
    }
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
   * Fetches from local database first, then from user's relays if not found
   */
  async getUserEmojiSets(pubkey: string): Promise<Map<string, string>> {
    // Check cache first
    if (this.userEmojiPreferences.has(pubkey)) {
      return this.userEmojiPreferences.get(pubkey)!;
    }

    try {
      // Kind 10030 is a replaceable event (10000-19999), not parameterized replaceable
      // It has no d-tag, just pubkey+kind
      // Use UserDataService to fetch from database first, then from user's relays if not found
      const emojiListRecord = await this.userData.getEventByPubkeyAndKind(pubkey, 10030, { save: true });

      if (!emojiListRecord) {
        // Don't cache empty results - user might install an emoji set later
        return new Map();
      }

      const emojiListEvent = emojiListRecord.event;
      const allEmojis = new Map<string, string>();

      // Process inline emoji tags
      for (const tag of emojiListEvent.tags) {
        if (tag[0] === 'emoji' && tag[1] && tag[2]) {
          allEmojis.set(tag[1], tag[2]);
        }
      }

      // Process emoji set references (a tags pointing to kind 30030)
      const emojiSetRefs = emojiListEvent.tags.filter(tag => tag[0] === 'a' && tag[1]?.startsWith('30030:'));

      for (const ref of emojiSetRefs) {
        const [kind, refPubkey, identifier] = ref[1].split(':');
        if (kind === '30030' && refPubkey && identifier) {
          const emojiSet = await this.getEmojiSet(refPubkey, identifier);
          if (emojiSet) {
            // Merge emojis from the set
            for (const [shortcode, url] of emojiSet.emojis) {
              // Don't override inline emojis
              if (!allEmojis.has(shortcode)) {
                allEmojis.set(shortcode, url);
              }
            }
          } else {
            this.logger.warn(`Failed to load emoji set: ${ref[1]}`);
          }
        }
      }

      // Cache the result
      this.userEmojiPreferences.set(pubkey, allEmojis);

      return allEmojis;
    } catch (error) {
      this.logger.error('Error fetching user emoji sets:', error);
      return new Map();
    }
  }

  /**
   * Get user's emoji sets grouped by set for tabbed display.
   * Returns inline emojis as "My Emojis" plus each referenced kind 30030 set.
   */
  async getUserEmojiSetsGrouped(pubkey: string): Promise<EmojiSetGroup[]> {
    try {
      const emojiListRecord = await this.userData.getEventByPubkeyAndKind(pubkey, 10030, { save: true });

      if (!emojiListRecord) {
        return [];
      }

      const emojiListEvent = emojiListRecord.event;
      const sets: EmojiSetGroup[] = [];

      // Inline emojis as "My Emojis"
      const inlineEmojis: { shortcode: string; url: string }[] = [];
      for (const tag of emojiListEvent.tags) {
        if (tag[0] === 'emoji' && tag[1] && tag[2]) {
          inlineEmojis.push({ shortcode: tag[1], url: tag[2] });
        }
      }
      if (inlineEmojis.length > 0) {
        sets.push({ id: 'inline', title: 'My Emojis', emojis: inlineEmojis });
      }

      // Emoji set references (a tags pointing to kind 30030)
      const emojiSetRefs = emojiListEvent.tags.filter(tag => tag[0] === 'a' && tag[1]?.startsWith('30030:'));
      for (const ref of emojiSetRefs) {
        const [kind, refPubkey, identifier] = ref[1].split(':');
        if (kind === '30030' && refPubkey && identifier) {
          const emojiSet = await this.getEmojiSet(refPubkey, identifier);
          if (emojiSet) {
            const emojis = Array.from(emojiSet.emojis.entries()).map(([shortcode, url]) => ({ shortcode, url }));
            sets.push({ id: emojiSet.id, title: emojiSet.title, emojis });
          }
        }
      }

      return sets;
    } catch (error) {
      this.logger.error('Failed to load emoji sets grouped:', error);
      return [];
    }
  }

  /**
   * Look up the emoji-set-address (kind:pubkey:d-tag) for a given shortcode in the user's installed sets.
   * Returns the address string if the emoji belongs to a known set, or undefined.
   */
  async getEmojiSetAddressForShortcode(userPubkey: string, shortcode: string): Promise<string | undefined> {
    try {
      const emojiListRecord = await this.userData.getEventByPubkeyAndKind(userPubkey, 10030, { save: true });
      if (!emojiListRecord) return undefined;

      const emojiSetRefs = emojiListRecord.event.tags.filter(tag => tag[0] === 'a' && tag[1]?.startsWith('30030:'));
      for (const ref of emojiSetRefs) {
        const [kind, refPubkey, identifier] = ref[1].split(':');
        if (kind === '30030' && refPubkey && identifier) {
          const emojiSet = await this.getEmojiSet(refPubkey, identifier);
          if (emojiSet?.emojis.has(shortcode)) {
            return ref[1];
          }
        }
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Clear emoji set cache for a specific user and notify listeners
   */
  clearUserCache(pubkey: string): void {
    this.userEmojiPreferences.delete(pubkey);
    this.preferencesChanged.update(v => v + 1);
  }

  /**
   * Clear all emoji set caches
   */
  clearAllCaches(): void {
    this.emojiSetCache.clear();
    this.userEmojiPreferences.clear();
    this.preferencesChanged.update(v => v + 1);
  }

  /**
   * Check if a specific emoji set is installed in the user's kind 10030 preferences.
   * @param pubkey The user's pubkey
   * @param setATagValue The 'a' tag value, e.g. '30030:<author>:<d-tag>'
   */
  async isEmojiSetInstalled(pubkey: string, setATagValue: string): Promise<boolean> {
    try {
      const emojiListRecord = await this.database.getEventByPubkeyAndKind(pubkey, 10030);
      if (!emojiListRecord) return false;

      return emojiListRecord.tags.some(
        tag => tag[0] === 'a' && tag[1] === setATagValue
      );
    } catch (error) {
      this.logger.error('Error checking emoji set installation:', error);
      return false;
    }
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
