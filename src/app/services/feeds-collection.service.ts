import { Injectable, inject, signal, computed, effect, untracked } from '@angular/core';
import { LocalStorageService } from './local-storage.service';
import { LoggerService } from './logger.service';
import { FeedService, FeedConfig, ColumnConfig } from './feed.service';
import { AccountStateService } from './account-state.service';
import { AccountLocalStateService } from './account-local-state.service';

export interface ColumnDefinition {
  id: string;
  label: string;
  icon: string;
  path?: string;
  type: 'notes' | 'articles' | 'photos' | 'videos' | 'custom';
  kinds: number[];
  source?: 'following' | 'public' | 'custom' | 'for-you';
  customUsers?: string[]; // Array of pubkeys for custom user selection
  customStarterPacks?: string[]; // Array of starter pack identifiers (d tags)
  relayConfig: 'account' | 'custom';
  customRelays?: string[];
  filters?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface FeedDefinition {
  id: string;
  label: string;
  icon: string;
  path?: string;
  description?: string;
  columns: ColumnDefinition[];
  createdAt: number;
  updatedAt: number;
}

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

  // Public computed signals that use FeedService as source of truth
  readonly feeds = computed(() => this.convertFeedConfigsToDefinitions(this.feedService.feeds()));
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

      untracked(() => {
        if (pubkey) {
          // Load the active feed for this account
          const activeFeedId = this.accountLocalState.getActiveFeed(pubkey);
          if (activeFeedId) {
            this._activeFeedId.set(activeFeedId);
            // Sync with FeedService
            this.feedService.setActiveFeed(activeFeedId);
          }
        }
      });
    });

    // Sync with FeedService - if FeedService has feeds but we don't have an active feed, set one
    effect(() => {
      const feeds = this.feeds();
      const activeFeedId = this._activeFeedId();

      // Use untracked to prevent reactive loops when updating signals
      untracked(() => {
        if (feeds.length > 0 && !activeFeedId) {
          this._activeFeedId.set(feeds[0].id);
          this.saveActiveFeed();
          // Also set in FeedService
          this.feedService.setActiveFeed(feeds[0].id);
        } else if (activeFeedId && feeds.length > 0) {
          // Ensure FeedService is in sync with loaded active feed
          this.feedService.setActiveFeed(activeFeedId);
        }
      });
    });
  }

  /**
   * Convert FeedConfig to FeedDefinition for UI compatibility
   */
  private convertFeedConfigsToDefinitions(feedConfigs: FeedConfig[]): FeedDefinition[] {
    return feedConfigs.map(config => ({
      id: config.id,
      label: config.label,
      icon: config.icon,
      path: config.path,
      description: config.description,
      columns: config.columns as ColumnDefinition[],
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    }));
  }

  /**
   * Convert FeedDefinition to FeedConfig for FeedService compatibility
   */
  private convertDefinitionToConfig(definition: FeedDefinition): FeedConfig {
    return {
      id: definition.id,
      label: definition.label,
      icon: definition.icon,
      path: definition.path,
      description: definition.description,
      columns: definition.columns as ColumnConfig[],
      createdAt: definition.createdAt,
      updatedAt: definition.updatedAt,
    };
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
    const feedConfig = await this.feedService.addFeed({
      label: feedData.label,
      icon: feedData.icon,
      description: feedData.description,
      path: feedData.path,
      columns: feedData.columns as ColumnConfig[],
    });

    return this.convertFeedConfigsToDefinitions([feedConfig])[0];
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
    if (updates.description !== undefined) feedConfig.description = updates.description;
    if (updates.path !== undefined) feedConfig.path = updates.path;
    if (updates.columns !== undefined) feedConfig.columns = updates.columns as ColumnConfig[];
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
   */
  async setActiveFeed(feedId: string): Promise<boolean> {
    const feed = this.getFeedById(feedId);
    if (feed) {
      this._activeFeedId.set(feedId);
      this.saveActiveFeed();

      // Delegate subscription management to FeedService
      await this.feedService.setActiveFeed(feedId);

      this.logger.debug(`Set active feed to ${feedId}`);
      return true;
    }

    this.logger.warn(`Feed with id ${feedId} not found`);
    return false;
  }

  /**
   * Add a column to a feed
   */
  async addColumnToFeed(
    feedId: string,
    columnData: Omit<ColumnDefinition, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<boolean> {
    const feed = this.getFeedById(feedId);
    if (!feed) {
      this.logger.warn(`Feed with id ${feedId} not found`);
      return false;
    }

    const newColumn: ColumnDefinition = {
      ...columnData,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const updatedColumns = [...feed.columns, newColumn];
    return await this.updateFeed(feedId, {
      columns: updatedColumns,
      updatedAt: Date.now(),
    });
  }

  /**
   * Remove a column from a feed
   */
  async removeColumnFromFeed(feedId: string, columnId: string): Promise<boolean> {
    const feed = this.getFeedById(feedId);
    if (!feed) {
      this.logger.warn(`Feed with id ${feedId} not found`);
      return false;
    }

    const updatedColumns = feed.columns.filter(col => col.id !== columnId);
    return await this.updateFeed(feedId, {
      columns: updatedColumns,
      updatedAt: Date.now(),
    });
  }

  /**
   * Update a column in a feed
   */
  async updateColumnInFeed(
    feedId: string,
    columnId: string,
    updates: Partial<Omit<ColumnDefinition, 'id' | 'createdAt'>>
  ): Promise<boolean> {
    const feed = this.getFeedById(feedId);
    if (!feed) {
      this.logger.warn(`Feed with id ${feedId} not found`);
      return false;
    }

    const columnIndex = feed.columns.findIndex(col => col.id === columnId);
    if (columnIndex === -1) {
      this.logger.warn(`Column with id ${columnId} not found in feed ${feedId}`);
      return false;
    }

    const updatedColumns = [...feed.columns];
    updatedColumns[columnIndex] = {
      ...updatedColumns[columnIndex],
      ...updates,
      updatedAt: Date.now(),
    };

    return await this.updateFeed(feedId, {
      columns: updatedColumns,
      updatedAt: Date.now(),
    });
  }

  /**
   * Get columns for the currently active feed
   */
  getActiveColumns(): ColumnDefinition[] {
    const activeFeed = this.activeFeed();
    return activeFeed?.columns || [];
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
}
