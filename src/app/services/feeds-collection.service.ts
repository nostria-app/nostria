import { Injectable, inject, signal, computed, effect, untracked } from '@angular/core';
import { LocalStorageService } from './local-storage.service';
import { LoggerService } from './logger.service';
import { FeedService, FeedConfig, ColumnConfig } from './feed.service';
import { AccountStateService } from './account-state.service';
import { AccountLocalStateService } from './account-local-state.service';

// FeedDefinition is now the same as FeedConfig - no more separate column definitions
export type FeedDefinition = FeedConfig;

// Legacy ColumnDefinition kept for backward compatibility during migration
export interface ColumnDefinition {
  id: string;
  label: string;
  icon: string;
  path?: string;
  type: 'notes' | 'articles' | 'photos' | 'videos' | 'music' | 'polls' | 'custom';
  kinds: number[];
  source?: 'following' | 'public' | 'custom' | 'for-you' | 'search' | 'trending';
  customUsers?: string[]; // Array of pubkeys for custom user selection
  customStarterPacks?: string[]; // Array of starter pack identifiers (d tags)
  customFollowSets?: string[]; // Array of follow set identifiers (d tags from kind 30000 events)
  searchQuery?: string; // Search query for search-based columns (NIP-50)
  relayConfig: 'account' | 'custom' | 'search';
  customRelays?: string[];
  filters?: Record<string, unknown>;
  showReplies?: boolean; // Whether to show replies in the feed (default: false)
  showReposts?: boolean; // Whether to show reposts in the feed (default: true)
  createdAt: number;
  updatedAt: number;
  lastRetrieved?: number; // Timestamp (seconds) of when data was last successfully retrieved from relays
}

// Default feed ID for new users - "For You" is optimized for quick rendering
const DEFAULT_FEED_ID = 'default-feed-for-you';

@Injectable({
  providedIn: 'root',
})
export class FeedsCollectionService {
  private readonly localStorageService = inject(LocalStorageService);
  private readonly logger = inject(LoggerService);
  private readonly feedService = inject(FeedService);
  private readonly accountState = inject(AccountStateService);
  private readonly accountLocalState = inject(AccountLocalStateService);

  readonly ACTIVE_FEED_KEY = 'nostria-active-feed';

  // Signal for active feed ID
  private readonly _activeFeedId = signal<string | null>(null);

  // Flag to track if user has manually changed the feed (prevents auto-restore from overriding)
  private userChangedFeed = false;

  // Track the last account pubkey to detect account switches
  private lastAccountPubkey: string | null = null;

  // Public computed signals that use FeedService as source of truth
  // Since FeedDefinition is now the same as FeedConfig, no conversion needed
  readonly feeds = computed(() => this.feedService.feeds());
  readonly activeFeedId = computed(() => this._activeFeedId());
  readonly activeFeed = computed(() => {
    const feedId = this._activeFeedId();
    return feedId ? this.feeds().find(f => f.id === feedId) : null;
  });
  constructor() {
    this.loadActiveFeed();

    // Reload active feed when account changes
    effect(() => {
      const pubkey = this.accountState.pubkey();
      const feedsLoaded = this.feedService.feedsLoaded(); // Wait for feeds to be loaded
      const feeds = this.feeds(); // Get current feeds to validate saved feed

      untracked(() => {
        if (pubkey && feedsLoaded) {
          // Only restore saved feed if:
          // 1. Account has changed (user switched accounts)
          // 2. User hasn't manually changed the feed in this session
          const accountChanged = this.lastAccountPubkey !== pubkey;

          if (accountChanged) {
            // Account switched - reset the user change flag and restore saved feed
            this.lastAccountPubkey = pubkey;
            this.userChangedFeed = false;

            const savedFeedId = this.accountLocalState.getActiveFeed(pubkey);

            // Validate that the saved feed still exists
            // If not, fall back to "For You" feed for optimal new user experience
            let feedIdToSet: string | null = null;

            if (savedFeedId && feeds.some(f => f.id === savedFeedId)) {
              // Saved feed exists, use it
              feedIdToSet = savedFeedId;
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
              // Save the corrected feed ID if we had to fall back
              if (feedIdToSet !== savedFeedId) {
                this.saveActiveFeed();
              }
            }
          }
          // If account hasn't changed and user has manually selected a feed,
          // don't override their selection
        }
      });
    });

    // Sync with FeedService - if FeedService has feeds but we don't have an active feed, set one
    effect(() => {
      const feeds = this.feeds();
      const activeFeedId = this._activeFeedId();
      const hasAccount = this.accountState.account() !== null;

      // Use untracked to prevent reactive loops when updating signals
      untracked(() => {
        // Only set active feed if there's an account
        if (!hasAccount) {
          this.logger.debug('No active account - skipping feed sync');
          return;
        }

        if (feeds.length > 0 && !activeFeedId) {
          // Prefer "For You" feed for new users as it's optimized for quick rendering
          // Fall back to first feed if "For You" doesn't exist
          const forYouFeed = feeds.find(f => f.id === DEFAULT_FEED_ID);
          const defaultFeedId = forYouFeed ? forYouFeed.id : feeds[0].id;

          this._activeFeedId.set(defaultFeedId);
          this.saveActiveFeed();
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
   * Load active feed ID from storage
   */
  private loadActiveFeed(): void {
    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        return;
      }

      const activeFeedId = this.accountLocalState.getActiveFeed(pubkey);
      if (activeFeedId) {
        this._activeFeedId.set(activeFeedId);
      }
    } catch (error) {
      this.logger.error('Error loading active feed from storage:', error);
    }
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
      } else {
        this.accountLocalState.setActiveFeed(pubkey, null);
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
    if (updates.path !== undefined) feedConfig.path = updates.path;
    if (updates.columns !== undefined) feedConfig.columns = updates.columns as ColumnConfig[];
    if (updates.showReplies !== undefined) feedConfig.showReplies = updates.showReplies;
    if (updates.showReposts !== undefined) feedConfig.showReposts = updates.showReposts;
    if (updates.updatedAt !== undefined) feedConfig.updatedAt = updates.updatedAt;

    return await this.feedService.updateFeed(id, feedConfig);
  }
  /**
   * Update only the column order without triggering subscription changes
   * This is optimized for drag and drop operations to preserve DOM state
   */
  updateColumnOrder(id: string, columns: ColumnDefinition[]): boolean {
    console.log(`⚡ FeedsCollectionService: Updating column order for feed ${id}`);
    console.log(
      `📋 New column order:`,
      columns.map(col => `${col.label} (${col.id})`)
    );
    return this.feedService.updateColumnOrder(id, columns as ColumnConfig[]);
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
   * @deprecated Columns have been removed. Use updateFeed() instead to modify feed properties.
   */
  async addColumnToFeed(
    feedId: string,
    columnData: Omit<ColumnDefinition, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<boolean> {
    this.logger.warn('addColumnToFeed is deprecated. Columns have been removed.');
    return false;
  }

  /**
   * @deprecated Columns have been removed. This method is no longer functional.
   */
  async removeColumnFromFeed(feedId: string, columnId: string): Promise<boolean> {
    this.logger.warn('removeColumnFromFeed is deprecated. Columns have been removed.');
    return false;
  }

  /**
   * @deprecated Columns have been removed. Use updateFeed() instead to modify feed properties.
   */
  async updateColumnInFeed(
    feedId: string,
    columnId: string,
    updates: Partial<Omit<ColumnDefinition, 'id' | 'createdAt'>>
  ): Promise<boolean> {
    this.logger.warn('updateColumnInFeed is deprecated. Use updateFeed() instead.');
    return false;
  }

  /**
   * @deprecated Columns have been removed. Returns empty array for backward compatibility.
   */
  getActiveColumns(): ColumnDefinition[] {
    this.logger.warn('getActiveColumns is deprecated. Columns have been removed.');
    return [];
  }

  /**
   * Reorder feeds (delegates to FeedService)
   */
  reorderFeeds(newOrder: string[]): void {
    this.feedService.reorderFeeds(newOrder);
    this.logger.debug('Reordered feeds', newOrder);
  }
  /**
   * Refresh a specific column (delegates to FeedService)
   */
  async refreshColumn(columnId: string): Promise<void> {
    await this.feedService.refreshColumn(columnId);
  }

  /**
   * Refresh all following columns in the active feed (delegates to FeedService)
   * This should be called after the user's following list changes
   */
  async refreshFollowingColumns(): Promise<void> {
    await this.feedService.refreshFollowingColumns();
    this.logger.debug('Refreshed all following columns');
  }

  /**
   * Pause a specific column (delegates to FeedService)
   */
  pauseColumn(columnId: string): void {
    this.feedService.pauseColumn(columnId);
    this.logger.debug(`Paused column: ${columnId}`);
  }

  /**
   * Continue a specific column (delegates to FeedService)
   */
  async continueColumn(columnId: string): Promise<void> {
    await this.feedService.continueColumn(columnId);
    this.logger.debug(`Continued column: ${columnId}`);
  }

  /**
   * Update a column in the active feed
   * Convenience method that finds the column in the active feed and updates it
   */
  async updateColumn(
    columnId: string,
    updates: Partial<Omit<ColumnDefinition, 'id' | 'createdAt'>>
  ): Promise<boolean> {
    const activeFeedId = this._activeFeedId();
    if (!activeFeedId) {
      this.logger.warn('No active feed to update column in');
      return false;
    }
    return await this.updateColumnInFeed(activeFeedId, columnId, updates);
  }
}
