import { Injectable, inject } from '@angular/core';
import { LocalStorageService } from './local-storage.service';

/**
 * Filter options for People page
 */
export interface PeopleFilters {
  hasRelayList: boolean;
  hasFollowingList: boolean;
  hasNip05: boolean;
  hasPicture: boolean;
  hasBio: boolean;
  favoritesOnly: boolean;
}

/**
 * Per-account state stored in localStorage
 */
interface AccountLocalState {
  notificationLastCheck?: number;
  activeFeed?: string;
  favorites?: string[];
  peopleViewMode?: string;
  peopleSortOption?: string;
  peopleFilters?: PeopleFilters;
  bookmarksViewMode?: string;
  activeProfileTab?: string;
}

/**
 * Root structure for all account states
 */
type AccountStatesRoot = Record<string, AccountLocalState>;

const ACCOUNT_STATE_KEY = 'nostria-state';

/**
 * Service for managing per-account state in localStorage
 * This centralizes state that should be stored per-account rather than globally
 */
@Injectable({
  providedIn: 'root',
})
export class AccountLocalStateService {
  private localStorage = inject(LocalStorageService);

  /**
   * Get all account states from localStorage
   */
  private getAllStates(): AccountStatesRoot {
    try {
      const data = this.localStorage.getItem(ACCOUNT_STATE_KEY);
      if (data) {
        return JSON.parse(data);
      }
      return {};
    } catch (error) {
      console.error('Failed to load account states:', error);
      return {};
    }
  }

  /**
   * Save all account states to localStorage
   */
  private saveAllStates(states: AccountStatesRoot): void {
    try {
      this.localStorage.setItem(ACCOUNT_STATE_KEY, JSON.stringify(states));
    } catch (error) {
      console.error('Failed to save account states:', error);
    }
  }

  /**
   * Get state for a specific account
   */
  getAccountState(pubkey: string): AccountLocalState {
    const allStates = this.getAllStates();
    return allStates[pubkey] || {};
  }

  /**
   * Update state for a specific account
   */
  updateAccountState(pubkey: string, updates: Partial<AccountLocalState>): void {
    const allStates = this.getAllStates();
    allStates[pubkey] = {
      ...allStates[pubkey],
      ...updates,
    };
    this.saveAllStates(allStates);
  }

  /**
   * Get notification last check timestamp for an account
   */
  getNotificationLastCheck(pubkey: string): number {
    const state = this.getAccountState(pubkey);
    return state.notificationLastCheck || 0;
  }

  /**
   * Set notification last check timestamp for an account
   */
  setNotificationLastCheck(pubkey: string, timestamp: number): void {
    this.updateAccountState(pubkey, { notificationLastCheck: timestamp });
  }

  /**
   * Get active feed for an account
   */
  getActiveFeed(pubkey: string): string | undefined {
    const state = this.getAccountState(pubkey);
    return state.activeFeed;
  }

  /**
   * Set active feed for an account
   */
  setActiveFeed(pubkey: string, feedId: string | null | undefined): void {
    this.updateAccountState(pubkey, { activeFeed: feedId || undefined });
  }

  /**
   * Get favorites for an account
   */
  getFavorites(pubkey: string): string[] {
    const state = this.getAccountState(pubkey);
    return state.favorites || [];
  }

  /**
   * Set favorites for an account
   */
  setFavorites(pubkey: string, favorites: string[]): void {
    this.updateAccountState(pubkey, { favorites });
  }

  /**
   * Get people view mode for an account
   */
  getPeopleViewMode(pubkey: string): string | undefined {
    const state = this.getAccountState(pubkey);
    return state.peopleViewMode;
  }

  /**
   * Set people view mode for an account
   */
  setPeopleViewMode(pubkey: string, viewMode: string | null | undefined): void {
    this.updateAccountState(pubkey, { peopleViewMode: viewMode || undefined });
  }

  /**
   * Get people sort option for an account
   */
  getPeopleSortOption(pubkey: string): string | undefined {
    const state = this.getAccountState(pubkey);
    return state.peopleSortOption;
  }

  /**
   * Set people sort option for an account
   */
  setPeopleSortOption(pubkey: string, sortOption: string | null | undefined): void {
    this.updateAccountState(pubkey, { peopleSortOption: sortOption || undefined });
  }

  /**
   * Get people filters for an account
   */
  getPeopleFilters(pubkey: string): PeopleFilters | undefined {
    const state = this.getAccountState(pubkey);
    return state.peopleFilters;
  }

  /**
   * Set people filters for an account
   */
  setPeopleFilters(pubkey: string, filters: PeopleFilters | null | undefined): void {
    this.updateAccountState(pubkey, { peopleFilters: filters || undefined });
  }

  /**
   * Get bookmarks view mode for an account
   */
  getBookmarksViewMode(pubkey: string): string | undefined {
    const state = this.getAccountState(pubkey);
    return state.bookmarksViewMode;
  }

  /**
   * Set bookmarks view mode for an account
   */
  setBookmarksViewMode(pubkey: string, viewMode: string | null | undefined): void {
    this.updateAccountState(pubkey, { bookmarksViewMode: viewMode || undefined });
  }

  /**
   * Get active profile tab for an account
   */
  getActiveProfileTab(pubkey: string): string | undefined {
    const state = this.getAccountState(pubkey);
    return state.activeProfileTab;
  }

  /**
   * Set active profile tab for an account
   */
  setActiveProfileTab(pubkey: string, tabId: string | null | undefined): void {
    this.updateAccountState(pubkey, { activeProfileTab: tabId || undefined });
  }

  /**
   * Clear state for a specific account
   */
  clearAccountState(pubkey: string): void {
    const allStates = this.getAllStates();
    delete allStates[pubkey];
    this.saveAllStates(allStates);
  }

  /**
   * Clear all account states (used during app wipe)
   */
  clearAllStates(): void {
    this.localStorage.removeItem(ACCOUNT_STATE_KEY);
  }
}
