import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { AccountStateService } from './account-state.service';
import { LocalStorageService } from './local-storage.service';
import { LoggerService } from './logger.service';

type FavoritesData = Record<string, string[]>;

@Injectable({
  providedIn: 'root',
})
export class FavoritesService {
  private readonly accountState = inject(AccountStateService);
  private readonly localStorage = inject(LocalStorageService);
  private readonly logger = inject(LoggerService);
  readonly STORAGE_KEY = 'nostria-favorites';

  // Signal containing all favorites data for all accounts
  private favoritesData = signal<FavoritesData>({});

  // Computed signal for current account's favorites
  readonly favorites = computed(() => {
    const currentPubkey = this.accountState.pubkey();
    if (!currentPubkey) return [];

    const data = this.favoritesData();
    return data[currentPubkey] || [];
  });

  constructor() {
    // Load favorites data on initialization
    this.loadFavoritesData();

    // Auto-save when favorites data changes
    effect(() => {
      const data = this.favoritesData();
      this.saveFavoritesData(data);
    });
  }

  /**
   * Load favorites data from localStorage
   */
  private loadFavoritesData(): void {
    try {
      const stored = this.localStorage.getObject<FavoritesData>(this.STORAGE_KEY);

      if (stored) {
        // Validate that the stored data has the correct structure
        if (this.isValidFavoritesData(stored)) {
          this.favoritesData.set(stored);
          this.logger.debug('Favorites data loaded successfully', stored);
        } else {
          // Invalid structure, wipe and start fresh
          this.logger.warn('Invalid favorites data structure detected, wiping existing favorites');
          this.wipeAndStartFresh();
        }
      } else {
        // Check for legacy favorites and migrate them
        this.migrateLegacyFavorites();
      }
    } catch (error) {
      this.logger.error('Failed to load favorites data, wiping existing favorites', error);
      this.wipeAndStartFresh();
    }
  }

  /**
   * Validate that the stored data matches the expected FavoritesData structure
   */
  private isValidFavoritesData(data: any): data is FavoritesData {
    if (!data || typeof data !== 'object') {
      return false;
    }

    // Check if all values are arrays of strings
    for (const [key, value] of Object.entries(data)) {
      if (typeof key !== 'string' || !Array.isArray(value)) {
        return false;
      }

      // Validate that all items in the array are strings
      if (!value.every((item) => typeof item === 'string')) {
        return false;
      }
    }

    return true;
  }

  /**
   * Wipe existing favorites and start with empty data
   */
  private wipeAndStartFresh(): void {
    this.favoritesData.set({});
    this.localStorage.removeItem(this.STORAGE_KEY);
    this.logger.info('Wiped existing favorites and started fresh');
  }

  /**
   * Migrate legacy favorites to the new per-account structure
   */
  private migrateLegacyFavorites(): void {
    try {
      const legacyFavorites = this.localStorage.getItem(this.STORAGE_KEY);
      if (legacyFavorites) {
        const parsed = JSON.parse(legacyFavorites);

        // Check if it's the legacy format (array of strings)
        if (Array.isArray(parsed)) {
          const currentPubkey = this.accountState.pubkey();

          if (currentPubkey && parsed.length > 0) {
            // Migrate legacy favorites to current account
            const newData: FavoritesData = {
              [currentPubkey]: parsed,
            };

            this.favoritesData.set(newData);
            this.logger.info('Migrated legacy favorites to new per-account structure', {
              account: currentPubkey,
              count: parsed.length,
            });
          } else {
            // No current account or empty favorites, start fresh
            this.wipeAndStartFresh();
          }
        } else {
          // Data exists but not in expected format, wipe it
          this.logger.warn('Found unexpected data format in favorites storage, wiping');
          this.wipeAndStartFresh();
        }
      }
    } catch (error) {
      this.logger.error('Failed to migrate legacy favorites, wiping existing data', error);
      this.wipeAndStartFresh();
    }
  }

  /**
   * Save favorites data to localStorage
   */
  private saveFavoritesData(data: FavoritesData): void {
    try {
      const success = this.localStorage.setObject(this.STORAGE_KEY, data);
      if (success) {
        this.logger.debug('Favorites data saved successfully');
      } else {
        this.logger.warn('Failed to save favorites data to localStorage');
      }
    } catch (error) {
      this.logger.error('Failed to save favorites data', error);
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

    this.favoritesData.update((data) => {
      const updatedData = { ...data };
      if (!updatedData[currentPubkey]) {
        updatedData[currentPubkey] = [];
      }
      updatedData[currentPubkey] = [...updatedData[currentPubkey], userPubkey];
      return updatedData;
    });

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

    this.favoritesData.update((data) => {
      const updatedData = { ...data };
      if (updatedData[currentPubkey]) {
        updatedData[currentPubkey] = updatedData[currentPubkey].filter(
          (pubkey) => pubkey !== userPubkey,
        );
      }
      return updatedData;
    });

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
   * Get favorites for a specific account (useful for debugging or admin purposes)
   */
  getFavoritesForAccount(accountPubkey: string): string[] {
    const data = this.favoritesData();
    return data[accountPubkey] || [];
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

    this.favoritesData.update((data) => {
      const updatedData = { ...data };
      delete updatedData[currentPubkey];
      return updatedData;
    });

    this.logger.info('Cleared all favorites for current account', {
      account: currentPubkey,
    });
  }

  /**
   * Get the total number of favorites across all accounts (for debugging)
   */
  getTotalFavoritesCount(): number {
    const data = this.favoritesData();
    return Object.values(data).reduce((total, favorites) => total + favorites.length, 0);
  }

  /**
   * Get the number of accounts that have favorites (for debugging)
   */
  getAccountsWithFavoritesCount(): number {
    const data = this.favoritesData();
    return Object.keys(data).length;
  }
}
