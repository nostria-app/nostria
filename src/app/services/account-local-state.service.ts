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
  showRank: boolean;
}

/**
 * Per-account state stored in localStorage
 */
interface AccountLocalState {
  notificationLastCheck?: number;
  messagesLastCheck?: number;
  activeFeed?: string;
  favorites?: string[];
  peopleViewMode?: string;
  peopleSortOption?: string;
  peopleFilters?: PeopleFilters;
  peopleScrollPosition?: number;
  bookmarksViewMode?: string;
  activeProfileTab?: string;
  powEnabled?: boolean;
  powTargetDifficulty?: number;
  lastRoute?: string;
  launchCount?: number;
  dismissedPushNotificationDialog?: boolean;
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
   * Get messages last check timestamp for an account
   */
  getMessagesLastCheck(pubkey: string): number {
    const state = this.getAccountState(pubkey);
    return state.messagesLastCheck || 0;
  }

  /**
   * Set messages last check timestamp for an account
   */
  setMessagesLastCheck(pubkey: string, timestamp: number): void {
    this.updateAccountState(pubkey, { messagesLastCheck: timestamp });
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
   * Get people scroll position for an account
   */
  getPeopleScrollPosition(pubkey: string): number | undefined {
    const state = this.getAccountState(pubkey);
    return state.peopleScrollPosition;
  }

  /**
   * Set people scroll position for an account
   */
  setPeopleScrollPosition(pubkey: string, position: number | null | undefined): void {
    this.updateAccountState(pubkey, { peopleScrollPosition: position || undefined });
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
   * Get Proof-of-Work enabled state for an account
   */
  getPowEnabled(pubkey: string): boolean {
    const state = this.getAccountState(pubkey);
    return state.powEnabled || false;
  }

  /**
   * Set Proof-of-Work enabled state for an account
   */
  setPowEnabled(pubkey: string, enabled: boolean): void {
    this.updateAccountState(pubkey, { powEnabled: enabled });
  }

  /**
   * Get Proof-of-Work target difficulty for an account
   */
  getPowTargetDifficulty(pubkey: string): number {
    const state = this.getAccountState(pubkey);
    return state.powTargetDifficulty || 20; // Default to 20
  }

  /**
   * Set Proof-of-Work target difficulty for an account
   */
  setPowTargetDifficulty(pubkey: string, difficulty: number): void {
    this.updateAccountState(pubkey, { powTargetDifficulty: difficulty });
  }

  /**
   * Get last route for an account
   */
  getLastRoute(pubkey: string): string | undefined {
    const state = this.getAccountState(pubkey);
    return state.lastRoute;
  }

  /**
   * Set last route for an account
   */
  setLastRoute(pubkey: string, route: string | null | undefined): void {
    this.updateAccountState(pubkey, { lastRoute: route || undefined });
  }

  /**
   * Get launch count for an account
   */
  getLaunchCount(pubkey: string): number {
    const state = this.getAccountState(pubkey);
    return state.launchCount || 0;
  }

  /**
   * Increment launch count for an account
   */
  incrementLaunchCount(pubkey: string): number {
    const currentCount = this.getLaunchCount(pubkey);
    const newCount = currentCount + 1;
    this.updateAccountState(pubkey, { launchCount: newCount });
    return newCount;
  }

  /**
   * Get dismissed push notification dialog status for an account
   */
  getDismissedPushNotificationDialog(pubkey: string): boolean {
    const state = this.getAccountState(pubkey);
    return state.dismissedPushNotificationDialog || false;
  }

  /**
   * Set dismissed push notification dialog status for an account
   */
  setDismissedPushNotificationDialog(pubkey: string, dismissed: boolean): void {
    this.updateAccountState(pubkey, { dismissedPushNotificationDialog: dismissed });
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
