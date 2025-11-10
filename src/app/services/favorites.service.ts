import { Injectable, computed, inject, signal, effect } from '@angular/core';
import { AccountStateService } from './account-state.service';
import { LocalStorageService } from './local-storage.service';
import { LoggerService } from './logger.service';
import { AccountLocalStateService } from './account-local-state.service';

type FavoritesData = Record<string, string[]>;

@Injectable({
  providedIn: 'root',
})
export class FavoritesService {
  private readonly accountState = inject(AccountStateService);
  private readonly localStorage = inject(LocalStorageService);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly logger = inject(LoggerService);
  readonly STORAGE_KEY = 'nostria-favorites';

  // Internal signal to trigger reactivity when favorites change
  private favoritesVersion = signal(0);

  // Computed signal for current account's favorites
  readonly favorites = computed(() => {
    // Depend on version to trigger recomputation
    this.favoritesVersion();

    const currentPubkey = this.accountState.pubkey();
    if (!currentPubkey) return [];

    // Get favorites from centralized state
    return this.accountLocalState.getFavorites(currentPubkey);
  });

  constructor() {
    // Check for legacy favorites and migrate them on first load
    this.migrateLegacyFavorites();

    // Watch for account changes and trigger refresh
    effect(() => {
      this.accountState.pubkey();
      this.favoritesVersion.update(v => v + 1);
    });
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
    this.accountLocalState.setFavorites(currentPubkey, [...currentFavorites, userPubkey]);

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
