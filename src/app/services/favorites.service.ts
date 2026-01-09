import { Injectable, computed, inject, signal, effect } from '@angular/core';
import { AccountStateService } from './account-state.service';
import { LocalStorageService } from './local-storage.service';
import { LoggerService } from './logger.service';
import { AccountLocalStateService } from './account-local-state.service';
import { FollowSetsService } from './follow-sets.service';

type FavoritesData = Record<string, string[]>;

@Injectable({
  providedIn: 'root',
})
export class FavoritesService {
  private readonly accountState = inject(AccountStateService);
  private readonly localStorage = inject(LocalStorageService);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly followSetsService = inject(FollowSetsService);
  private readonly logger = inject(LoggerService);
  readonly STORAGE_KEY = 'nostria-favorites';

  // Internal signal to trigger reactivity when favorites change
  private favoritesVersion = signal(0);

  // Track if we've synced to Nostr yet (per account)
  private syncedAccounts = new Set<string>();

  // Track pending sync operations to prevent multiple simultaneous syncs
  private pendingSyncPromise: Promise<void> | null = null;

  // Debounce timer for Nostr sync
  private syncToNostrTimer: any = null;
  private readonly SYNC_DEBOUNCE_MS = 1000; // Wait 1 second before syncing to Nostr

  // Computed signal for current account's favorites
  // Now pulls from follow sets service if available, otherwise uses local state
  readonly favorites = computed(() => {
    // Depend on version to trigger recomputation
    this.favoritesVersion();

    const currentPubkey = this.accountState.pubkey();
    if (!currentPubkey) return [];

    // Try to get from follow sets first (kind 30000)
    const favoritesSet = this.followSetsService.getFavorites();
    if (favoritesSet && favoritesSet.pubkeys.length > 0) {
      return favoritesSet.pubkeys;
    }

    // Fall back to local state
    return this.accountLocalState.getFavorites(currentPubkey);
  });

  constructor() {
    // Check for legacy favorites and migrate them on first load
    this.migrateLegacyFavorites();

    // Watch for account changes and trigger refresh
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        this.favoritesVersion.update(v => v + 1);
        // Reset sync tracking when account changes
        this.pendingSyncPromise = null;
      }
    });

    // Sync local favorites to Nostr when account loads (once per account)
    effect(() => {
      const pubkey = this.accountState.pubkey();
      const followSetsLoaded = !this.followSetsService.isLoading();

      if (pubkey && followSetsLoaded && !this.syncedAccounts.has(pubkey) && !this.pendingSyncPromise) {
        this.syncFavoritesToNostr(pubkey);
      }
    });

    // Watch for changes in follow sets and trigger refresh
    effect(() => {
      this.followSetsService.followSets();
      this.favoritesVersion.update(v => v + 1);
    });
  }

  /**
   * Sync local favorites to Nostr as a follow set
   */
  private async syncFavoritesToNostr(pubkey: string): Promise<void> {
    // Prevent multiple simultaneous syncs
    if (this.pendingSyncPromise) {
      this.logger.debug('[Favorites] Sync already in progress, skipping');
      return this.pendingSyncPromise;
    }

    this.pendingSyncPromise = (async () => {
      try {
        const localFavorites = this.accountLocalState.getFavorites(pubkey);

        // Only sync if we have local favorites
        if (localFavorites.length > 0) {
          const favoritesSet = this.followSetsService.getFavorites();

          // Only sync if the Nostr version doesn't exist or is different
          // Use Set-based comparison for efficiency
          if (!favoritesSet || !this.arraysEqual(favoritesSet.pubkeys, localFavorites)) {
            this.logger.info('[Favorites] Syncing local favorites to Nostr');
            await this.followSetsService.migrateFavorites(localFavorites);
          } else {
            this.logger.debug('[Favorites] Favorites already synced, skipping');
          }
        }

        // Mark this account as synced
        this.syncedAccounts.add(pubkey);
      } catch (error) {
        this.logger.error('[Favorites] Failed to sync favorites to Nostr:', error);
      } finally {
        this.pendingSyncPromise = null;
      }
    })();

    return this.pendingSyncPromise;
  }

  /**
   * Compare two arrays for equality (order-independent)
   */
  private arraysEqual(arr1: string[], arr2: string[]): boolean {
    if (arr1.length !== arr2.length) return false;
    const set1 = new Set(arr1);
    const set2 = new Set(arr2);
    if (set1.size !== set2.size) return false;
    for (const item of set1) {
      if (!set2.has(item)) return false;
    }
    return true;
  }

  /**
   * Migrate legacy favorites from old 'nostria-favorites' storage to centralized state
   * This handles both the old per-account Record structure and the very old array format
   */
  private migrateLegacyFavorites(): void {
    try {
      const stored = this.localStorage.getObject<FavoritesData>(this.STORAGE_KEY);

      if (stored && typeof stored === 'object') {
        // Migrate all accounts from old structure to centralized state
        for (const [pubkey, favorites] of Object.entries(stored)) {
          if (Array.isArray(favorites) && favorites.every(item => typeof item === 'string')) {
            this.accountLocalState.setFavorites(pubkey, favorites);
            this.logger.debug(`Migrated ${favorites.length} favorites for account ${pubkey}`);
          }
        }

        // Clean up old storage
        this.localStorage.removeItem(this.STORAGE_KEY);
        this.logger.info('Successfully migrated legacy favorites to centralized state');
      }
    } catch (error) {
      this.logger.error('Failed to migrate legacy favorites', error);
    }
  }

  /**
   * Check if a user is in the current account's favorites
   */
  isFavorite(userPubkey: string): boolean {
    return this.favorites().includes(userPubkey);
  }

  /**
   * Schedule a debounced sync to Nostr
   */
  private scheduleSyncToNostr(pubkey: string, favorites: string[]): void {
    // Clear any existing timer
    if (this.syncToNostrTimer) {
      clearTimeout(this.syncToNostrTimer);
    }

    // Schedule new sync
    this.syncToNostrTimer = setTimeout(() => {
      this.followSetsService.migrateFavorites(favorites).catch(error => {
        this.logger.error('Failed to sync favorites to Nostr:', error);
      });
      this.syncToNostrTimer = null;
    }, this.SYNC_DEBOUNCE_MS);
  }

  /**
   * Add a user to the current account's favorites
   */
  addFavorite(userPubkey: string): boolean {
    const currentPubkey = this.accountState.pubkey();
    if (!currentPubkey) {
      this.logger.warn('Cannot add favorite: no current account');
      return false;
    }

    if (this.isFavorite(userPubkey)) {
      this.logger.debug('User is already in favorites', { userPubkey });
      return false;
    }

    const currentFavorites = this.accountLocalState.getFavorites(currentPubkey);
    const updatedFavorites = [...currentFavorites, userPubkey];
    this.accountLocalState.setFavorites(currentPubkey, updatedFavorites);

    // Schedule debounced sync to Nostr
    this.scheduleSyncToNostr(currentPubkey, updatedFavorites);

    // Trigger reactivity
    this.favoritesVersion.update(v => v + 1);

    this.logger.debug('Added user to favorites', {
      userPubkey,
      account: currentPubkey,
    });
    return true;
  }

  /**
   * Remove a user from the current account's favorites
   */
  removeFavorite(userPubkey: string): boolean {
    const currentPubkey = this.accountState.pubkey();
    if (!currentPubkey) {
      this.logger.warn('Cannot remove favorite: no current account');
      return false;
    }

    if (!this.isFavorite(userPubkey)) {
      this.logger.debug('User is not in favorites', { userPubkey });
      return false;
    }

    const currentFavorites = this.accountLocalState.getFavorites(currentPubkey);
    const updatedFavorites = currentFavorites.filter(pubkey => pubkey !== userPubkey);
    this.accountLocalState.setFavorites(currentPubkey, updatedFavorites);

    // Schedule debounced sync to Nostr
    this.scheduleSyncToNostr(currentPubkey, updatedFavorites);

    // Trigger reactivity
    this.favoritesVersion.update(v => v + 1);

    this.logger.debug('Removed user from favorites', {
      userPubkey,
      account: currentPubkey,
    });
    return true;
  }

  /**
   * Toggle a user's favorite status for the current account
   */
  toggleFavorite(userPubkey: string): boolean {
    if (this.isFavorite(userPubkey)) {
      return this.removeFavorite(userPubkey);
    } else {
      return this.addFavorite(userPubkey);
    }
  }

  /**
   * Reorder favorites for the current account
   */
  reorderFavorites(newOrder: string[]): boolean {
    const currentPubkey = this.accountState.pubkey();
    if (!currentPubkey) {
      this.logger.warn('Cannot reorder favorites: no current account');
      return false;
    }

    // Validate that newOrder contains the same pubkeys as current favorites
    const currentFavorites = this.accountLocalState.getFavorites(currentPubkey);
    if (newOrder.length !== currentFavorites.length) {
      this.logger.warn('Cannot reorder favorites: length mismatch', {
        current: currentFavorites.length,
        new: newOrder.length,
      });
      return false;
    }

    // Verify all pubkeys are present
    const currentSet = new Set(currentFavorites);
    const newSet = new Set(newOrder);
    if (currentSet.size !== newSet.size || !newOrder.every(pk => currentSet.has(pk))) {
      this.logger.warn('Cannot reorder favorites: pubkey mismatch');
      return false;
    }

    // Update the order
    this.accountLocalState.setFavorites(currentPubkey, newOrder);

    // Trigger reactivity
    this.favoritesVersion.update(v => v + 1);

    this.logger.debug('Reordered favorites', {
      account: currentPubkey,
      newOrder,
    });
    return true;
  }

  /**
   * Get favorites for a specific account (useful for debugging or admin purposes)
   */
  getFavoritesForAccount(accountPubkey: string): string[] {
    return this.accountLocalState.getFavorites(accountPubkey);
  }

  /**
   * Clear all favorites for the current account
   */
  clearCurrentAccountFavorites(): void {
    const currentPubkey = this.accountState.pubkey();
    if (!currentPubkey) {
      this.logger.warn('Cannot clear favorites: no current account');
      return;
    }

    this.accountLocalState.setFavorites(currentPubkey, []);

    this.logger.info('Cleared all favorites for current account', {
      account: currentPubkey,
    });
  }
}
