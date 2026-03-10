import { Injectable, inject, signal, computed, effect, untracked } from '@angular/core';
import { LocalStorageService } from './local-storage.service';
import { LoggerService } from './logger.service';
import { FeedService, FeedConfig } from './feed.service';
import { AccountStateService } from './account-state.service';
import { AccountLocalStateService, ANONYMOUS_PUBKEY } from './account-local-state.service';
import { SettingsService } from './settings.service';
import { ApplicationService } from './application.service';

// FeedDefinition is now the same as FeedConfig - no more separate column definitions
export type FeedDefinition = FeedConfig;

// Default feed ID for new users - "For You" is optimized for quick rendering
const DEFAULT_FEED_ID = 'default-feed-for-you';
const ACTIVE_FEED_STORAGE_KEY = 'nostria-active-feed-by-account';
const LAST_ACTIVE_FEED_STORAGE_KEY = 'nostria-last-active-feed';

@Injectable({
  providedIn: 'root',
})
export class FeedsCollectionService {
  private readonly localStorageService = inject(LocalStorageService);
  private readonly logger = inject(LoggerService);
  private readonly feedService = inject(FeedService);
  private readonly accountState = inject(AccountStateService);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly settingsService = inject(SettingsService);
  private readonly app = inject(ApplicationService);

  // Signal for active feed ID
  private readonly _activeFeedId = signal<string | null>(null);

  // Flag to track if a dynamic feed is active (prevents auto-restore from overriding)
  private readonly _dynamicFeedActive = signal<boolean>(false);

  // Flag to track if user has manually changed the feed (prevents auto-restore from overriding)
  private userChangedFeed = false;

  // Track the last account pubkey to detect account switches
  private lastAccountPubkey: string | null = null;

  // Track which account has had its saved feed restored for the current session.
  // This prevents the default feed auto-selection from overwriting a saved custom feed
  // before restoration runs.
  private readonly _restoredActiveFeedForPubkey = signal<string | null>(null);

  // Public computed signals that use FeedService as source of truth
  // Since FeedDefinition is now the same as FeedConfig, no conversion needed
  readonly feeds = computed(() => this.feedService.feeds());
  readonly activeFeedId = computed(() => this._activeFeedId());
  readonly activeFeedSelectionResolved = computed(() => {
    const pubkey = this.accountState.pubkey();
    const authenticated = this.app.authenticated();

    if (authenticated && !pubkey) {
      return false;
    }

    if (!pubkey) {
      return true;
    }

    return this._restoredActiveFeedForPubkey() === pubkey;
  });
  readonly activeFeed = computed(() => {
    const feedId = this._activeFeedId();
    return feedId ? this.feeds().find(f => f.id === feedId) ?? null : null;
  });

  private getActiveFeedStorageAccountKey(pubkey: string | null | undefined): string {
    return pubkey || ANONYMOUS_PUBKEY;
  }

  private getPersistedActiveFeedId(pubkey: string | null | undefined): string | null {
    try {
      const storageKey = this.getActiveFeedStorageAccountKey(pubkey);
      const activeFeedByAccount = this.localStorageService.getObject<Record<string, string>>(
        ACTIVE_FEED_STORAGE_KEY
      ) || {};

      return activeFeedByAccount[storageKey]
        || this.localStorageService.getItem(LAST_ACTIVE_FEED_STORAGE_KEY)
        || null;
    } catch (error) {
      this.logger.error('Error reading persisted active feed:', error);
      return null;
    }
  }

  private persistActiveFeedId(pubkey: string | null | undefined, feedId: string | null): void {
    try {
      const storageKey = this.getActiveFeedStorageAccountKey(pubkey);
      const activeFeedByAccount = this.localStorageService.getObject<Record<string, string>>(
        ACTIVE_FEED_STORAGE_KEY
      ) || {};

      if (feedId) {
        activeFeedByAccount[storageKey] = feedId;
        this.localStorageService.setObject(ACTIVE_FEED_STORAGE_KEY, activeFeedByAccount);
        this.localStorageService.setItem(LAST_ACTIVE_FEED_STORAGE_KEY, feedId);
      } else {
        delete activeFeedByAccount[storageKey];
        this.localStorageService.setObject(ACTIVE_FEED_STORAGE_KEY, activeFeedByAccount);
      }
    } catch (error) {
      this.logger.error('Error persisting active feed:', error);
    }
  }

  private getSavedActiveFeedId(pubkey: string | null | undefined): string | null {
    if (!pubkey) {
      return null;
    }

    return this.accountLocalState.getActiveFeed(pubkey)
      ?? this.getPersistedActiveFeedId(pubkey);
  }

  constructor() {
    // Prime the active feed from per-account state as soon as the pubkey is known.
    // This prevents startup fallback logic from briefly selecting "For You" before
    // the previously selected custom feed can be validated against the loaded feed list.
    effect(() => {
      const pubkey = this.accountState.pubkey();

      untracked(() => {
        if (!pubkey) {
          this.lastAccountPubkey = null;
          this._restoredActiveFeedForPubkey.set(null);
          this._activeFeedId.set(null);
          return;
        }

        if (this.lastAccountPubkey === pubkey) {
          return;
        }

        this.lastAccountPubkey = pubkey;
        this.userChangedFeed = false;
        this._restoredActiveFeedForPubkey.set(null);

        const savedFeedId = this.getSavedActiveFeedId(pubkey);
        this._activeFeedId.set(savedFeedId);
      });
    });

    // Reload active feed when account changes
    effect(() => {
      const pubkey = this.accountState.pubkey();
      const feedsLoaded = this.feedService.feedsLoaded(); // Wait for feeds to be loaded
      const feeds = this.feeds(); // Get current feeds to validate saved feed
      const settingsLoaded = this.settingsService.settingsLoaded();
      const restoredActiveFeedForPubkey = this._restoredActiveFeedForPubkey();

      untracked(() => {
        if (pubkey && feedsLoaded) {
          // Restore the saved feed exactly once per account after feeds have finished loading.
          // Without this guard, the default auto-selection effect can run first and overwrite
          // the previously saved custom feed in account-local storage.
          if (restoredActiveFeedForPubkey === pubkey) {
            return;
          }

          const savedFeedId = this.getSavedActiveFeedId(pubkey);

          // Validate that the saved feed still exists
          // If not, fall back to "For You" feed for optimal new user experience
          let feedIdToSet: string | null = null;

          if (savedFeedId && feeds.some(f => f.id === savedFeedId)) {
            // Saved feed exists, use it
            feedIdToSet = savedFeedId;
          } else if (savedFeedId && !settingsLoaded) {
            // A saved feed exists, but settings/synced feeds may still be loading.
            // Keep the selector unresolved instead of temporarily falling back to
            // "For You" and flashing the wrong selection.
            return;
          } else if (feeds.length > 0) {
            // Saved feed doesn't exist or is invalid - use "For You" as default
            // Fall back to first feed if "For You" doesn't exist
            const forYouFeed = feeds.find(f => f.id === DEFAULT_FEED_ID);
            feedIdToSet = forYouFeed ? forYouFeed.id : feeds[0].id;
            this.logger.debug(`Saved feed ${savedFeedId} not found, falling back to ${feedIdToSet}`);
          }

          if (feedIdToSet) {
            this._activeFeedId.set(feedIdToSet);
            // Sync with FeedService
            this.feedService.setActiveFeed(feedIdToSet);
            // Only persist fallback when there was no previously saved preference.
            // If a saved custom feed is temporarily missing during startup, never
            // overwrite that preference with "For You".
            if (!savedFeedId && feedIdToSet !== savedFeedId) {
              this.saveActiveFeed();
            }
          }

          this._restoredActiveFeedForPubkey.set(pubkey);
          // If account hasn't changed and user has manually selected a feed,
          // don't override their selection
        }
      });
    });

    // If a saved feed becomes available after the initial restore pass, switch to it.
    // This handles late feed-list population without permanently falling back to For You.
    effect(() => {
      const pubkey = this.accountState.pubkey();
      const feeds = this.feeds();
      const activeFeedId = this._activeFeedId();
      const restoredActiveFeedForPubkey = this._restoredActiveFeedForPubkey();

      untracked(() => {
        if (!pubkey || restoredActiveFeedForPubkey !== pubkey || this.userChangedFeed) {
          return;
        }

        const savedFeedId = this.getSavedActiveFeedId(pubkey);

        if (!savedFeedId || activeFeedId === savedFeedId) {
          return;
        }

        if (!feeds.some(feed => feed.id === savedFeedId)) {
          return;
        }

        this.logger.debug(`Late-restoring saved active feed ${savedFeedId}`);
        this._activeFeedId.set(savedFeedId);
        this.feedService.setActiveFeed(savedFeedId);
      });
    });

    // Sync with FeedService - if FeedService has feeds but we don't have an active feed, set one
    effect(() => {
      const authenticated = this.app.authenticated();
      const pubkey = this.accountState.pubkey();
      const feedsLoaded = this.feedService.feedsLoaded();
      const feeds = this.feeds();
      const activeFeedId = this._activeFeedId();
      const dynamicFeedActive = this._dynamicFeedActive();
      const restoredActiveFeedForPubkey = this._restoredActiveFeedForPubkey();

      // Use untracked to prevent reactive loops when updating signals
      untracked(() => {
        // Don't auto-select a feed if a dynamic feed is active
        if (dynamicFeedActive) {
          this.logger.debug('Dynamic feed active - skipping auto-selection');
          return;
        }

        // For authenticated users, never auto-select a default feed until the
        // account pubkey is available and the saved selection can be restored.
        if (authenticated && !pubkey) {
          return;
        }

        // Wait until the saved feed has been restored for the current account.
        // Otherwise a default feed can be selected and persisted too early,
        // overwriting the user's previous custom feed selection.
        if (pubkey && restoredActiveFeedForPubkey !== pubkey) {
          return;
        }

        if (feeds.length > 0 && !activeFeedId) {
          // Prefer "For You" feed for new users as it's optimized for quick rendering
          // Fall back to first feed if "For You" doesn't exist
          const forYouFeed = feeds.find(f => f.id === DEFAULT_FEED_ID);
          const defaultFeedId = forYouFeed ? forYouFeed.id : feeds[0].id;

          this._activeFeedId.set(defaultFeedId);
          // Persist active feed only when an account exists.
          if (this.accountState.account()) {
            this.saveActiveFeed();
          }
          // Also set in FeedService
          this.feedService.setActiveFeed(defaultFeedId);
        }
        // Removed: the else-if branch that always synced with FeedService
        // This was causing duplicate subscription attempts. FeedService is already
        // synced through the first effect and through setActiveFeed calls.
      });
    });
  }

  /**
   * Save active feed ID to storage
   */
  private saveActiveFeed(): void {
    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        return;
      }

      const activeFeedId = this._activeFeedId();
      if (activeFeedId) {
        this.accountLocalState.setActiveFeed(pubkey, activeFeedId);
        this.persistActiveFeedId(pubkey, activeFeedId);
      } else {
        this.accountLocalState.setActiveFeed(pubkey, null);
        this.persistActiveFeedId(pubkey, null);
      }
    } catch (error) {
      this.logger.error('Error saving active feed to storage:', error);
    }
  }

  /**
   * Add a new feed (delegates to FeedService)
   */
  async addFeed(
    feedData: Omit<FeedDefinition, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<FeedDefinition> {
    const feedConfig = await this.feedService.addFeed(feedData);
    return feedConfig;
  }

  /**
   * Update a feed (delegates to FeedService)
   */
  async updateFeed(
    id: string,
    updates: Partial<Omit<FeedDefinition, 'id' | 'createdAt'>>
  ): Promise<boolean> {
    // Only include properties that are actually being updated to avoid overwriting with undefined
    const feedConfig: Partial<Omit<FeedConfig, 'id' | 'createdAt'>> = {};

    if (updates.label !== undefined) feedConfig.label = updates.label;
    if (updates.icon !== undefined) feedConfig.icon = updates.icon;
    if (updates.showReplies !== undefined) feedConfig.showReplies = updates.showReplies;
    if (updates.showReposts !== undefined) feedConfig.showReposts = updates.showReposts;
    if (updates.kinds !== undefined) feedConfig.kinds = updates.kinds;
    if (updates.updatedAt !== undefined) feedConfig.updatedAt = updates.updatedAt;

    return await this.feedService.updateFeed(id, feedConfig);
  }


  /**
   * Remove a feed (delegates to FeedService)
   */
  removeFeed(id: string): boolean {
    const removed = this.feedService.removeFeed(id);

    // If the removed feed was active, clear or set a new active feed
    if (removed && this._activeFeedId() === id) {
      const remainingFeeds = this.feeds();
      this._activeFeedId.set(remainingFeeds.length > 0 ? remainingFeeds[0].id : null);
      this.saveActiveFeed();
    }

    return removed;
  }

  /**
   * Reset all feeds to defaults (delegates to FeedService)
   */
  resetToDefaults(): void {
    this.feedService.resetToDefaults();

    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      // Clear active feed ID from centralized state
      this.accountLocalState.setActiveFeed(pubkey, null);
    }

    // Set first default feed as active
    const defaultFeeds = this.feeds();
    if (defaultFeeds.length > 0) {
      this._activeFeedId.set(defaultFeeds[0].id);
      this.saveActiveFeed();
    }
  }

  /**
   * Get feed by ID
   */
  getFeedById(id: string): FeedDefinition | undefined {
    return this.feeds().find(feed => feed.id === id);
  }
  /**
   * Set the active feed
   * @param feedId The ID of the feed to set as active
   * @param skipValidation If true, skip checking if the feed exists (useful when feed was just added)
   */
  setActiveFeed(feedId: string, skipValidation = false): boolean {
    const feed = skipValidation ? { id: feedId } : this.getFeedById(feedId);
    if (feed) {
      // Mark that user has manually changed the feed - this prevents
      // the auto-restore effect from overriding their selection
      this.userChangedFeed = true;

      // Set the active feed ID IMMEDIATELY for instant UI updates
      this._activeFeedId.set(feedId);
      this.saveActiveFeed();

      // Delegate subscription management to FeedService
      // We await this to ensure cached events are loaded before the UI renders columns
      this.feedService.setActiveFeed(feedId).catch(error => {
        this.logger.error(`Error setting active feed in FeedService: ${error}`);
      });

      this.logger.debug(`Set active feed to ${feedId}`);
      return true;
    }

    this.logger.warn(`Feed with id ${feedId} not found`);
    return false;
  }

  /**
   * Clear the active feed selection
   */
  clearActiveFeed(): void {
    this._activeFeedId.set(null);
    this.logger.debug('Cleared active feed');
  }

  /**
   * Set the dynamic feed active flag.
   * When true, prevents auto-selection of regular feeds.
   */
  setDynamicFeedActive(active: boolean): void {
    this._dynamicFeedActive.set(active);
    this.logger.debug(`Dynamic feed active: ${active}`);
  }

  /**
   * Check if a dynamic feed is currently active
   */
  isDynamicFeedActive(): boolean {
    return this._dynamicFeedActive();
  }









  /**
   * Refresh the active feed if it has 'following' or 'for-you' source
   * This should be called after the user's following list changes to reload content
   */
  async refreshFollowingFeeds(): Promise<void> {
    const activeFeed = this.activeFeed();
    if (!activeFeed) {
      this.logger.warn('Cannot refresh following feed: no active feed');
      return;
    }

    // Check if the active feed is following-related
    if (activeFeed.source !== 'following' && activeFeed.source !== 'for-you') {
      this.logger.debug('Active feed is not following-related, skipping refresh');
      return;
    }

    this.logger.info(`Refreshing ${activeFeed.source} feed: ${activeFeed.label}`);

    // Use the feed service's refreshFeed method
    await this.feedService.refreshFeed(activeFeed.id);

    this.logger.debug('Refreshed following-related feed');
  }

  /**
   * Reorder feeds (delegates to FeedService)
   */
  reorderFeeds(newOrder: string[]): void {
    this.feedService.reorderFeeds(newOrder);
    this.logger.debug('Reordered feeds', newOrder);
  }

}

