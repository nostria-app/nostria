import { Injectable, inject, signal } from '@angular/core';
import { LocalStorageService } from './local-storage.service';
import { DeviceNotificationPreferences } from './database.service';

/**
 * Filter options for People page
 */
export interface PeopleFilters {
  hasRelayList: boolean;
  hasFollowingList: boolean;
  hasNip05: boolean;
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
  followingSidebarDocked?: boolean;
  powEnabled?: boolean;
  powTargetDifficulty?: number;
  lastRoute?: string;
  launchCount?: number;
  dismissedPushNotificationDialog?: boolean;
  articlesActiveTab?: number;
  subscriptionSettingsLastFetch?: number;
  subscriptionSettings?: DeviceNotificationPreferences[];
  translationSourceLang?: string;
  translationTargetLang?: string;
  lastSummaryCheck?: number; // Timestamp when user last viewed the Summary page
  summaryTimePreset?: number | null; // Selected time preset in hours, null = last visit
  summaryCustomDate?: number | null; // Custom date timestamp if selected
  zapSplitEnabled?: boolean; // Whether zap split is enabled when quoting
  zapSplitOriginalPercent?: number; // Percentage to original author (0-100)
  zapSplitQuoterPercent?: number; // Percentage to quoter (0-100)
  trustedMediaAuthors?: string[]; // Pubkeys of authors whose media should always be revealed (not blurred)
}

/**
 * Root structure for all account states
 */
type AccountStatesRoot = Record<string, AccountLocalState>;

const ACCOUNT_STATE_KEY = 'nostria-state';

/**
 * Service for managing per-account state in localStorage
 * This centralizes state that should be stored per-account rather than globally
 * Uses in-memory caching to avoid repeated localStorage reads
 */
@Injectable({
  providedIn: 'root',
})
export class AccountLocalStateService {
  private localStorage = inject(LocalStorageService);

  // In-memory cache of account states to avoid repeated localStorage reads
  private cachedStates: AccountStatesRoot | null = null;

  // Signal to trigger reactivity when trusted media authors change
  private trustedMediaAuthorsVersion = signal(0);

  /**
   * Get all account states from cache or localStorage
   */
  private getAllStates(): AccountStatesRoot {
    // Return cached states if available
    if (this.cachedStates !== null) {
      return this.cachedStates;
    }

    try {
      const data = this.localStorage.getItem(ACCOUNT_STATE_KEY);
      if (data) {
        this.cachedStates = JSON.parse(data);
        return this.cachedStates!;
      }
      this.cachedStates = {};
      return this.cachedStates;
    } catch (error) {
      console.error('Failed to load account states:', error);
      this.cachedStates = {};
      return this.cachedStates;
    }
  }

  /**
   * Save all account states to localStorage and update cache
   */
  private saveAllStates(states: AccountStatesRoot): void {
    try {
      this.cachedStates = states;
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
   * Get following sidebar docked state for an account
   */
  getFollowingSidebarDocked(pubkey: string): boolean {
    const state = this.getAccountState(pubkey);
    return state.followingSidebarDocked || false;
  }

  /**
   * Set following sidebar docked state for an account
   */
  setFollowingSidebarDocked(pubkey: string, docked: boolean): void {
    this.updateAccountState(pubkey, { followingSidebarDocked: docked });
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
   * Get active articles tab for an account
   */
  getArticlesActiveTab(pubkey: string): number {
    const state = this.getAccountState(pubkey);
    return state.articlesActiveTab || 0;
  }

  /**
   * Set active articles tab for an account
   */
  setArticlesActiveTab(pubkey: string, tabIndex: number): void {
    this.updateAccountState(pubkey, { articlesActiveTab: tabIndex });
  }

  /**
   * Get subscription settings last fetch timestamp for an account
   */
  getSubscriptionSettingsLastFetch(pubkey: string): number {
    const state = this.getAccountState(pubkey);
    return state.subscriptionSettingsLastFetch || 0;
  }

  /**
   * Set subscription settings last fetch timestamp for an account
   */
  setSubscriptionSettingsLastFetch(pubkey: string, timestamp: number): void {
    this.updateAccountState(pubkey, { subscriptionSettingsLastFetch: timestamp });
  }

  /**
   * Get subscription settings for an account
   */
  getSubscriptionSettings(pubkey: string): DeviceNotificationPreferences[] | undefined {
    const state = this.getAccountState(pubkey);
    return state.subscriptionSettings;
  }

  /**
   * Set subscription settings for an account
   */
  setSubscriptionSettings(pubkey: string, settings: DeviceNotificationPreferences[]): void {
    this.updateAccountState(pubkey, { subscriptionSettings: settings });
  }

  /**
   * Get translation source language for an account
   */
  getTranslationSourceLang(pubkey: string): string | undefined {
    const state = this.getAccountState(pubkey);
    return state.translationSourceLang;
  }

  /**
   * Set translation source language for an account
   */
  setTranslationSourceLang(pubkey: string, lang: string | null | undefined): void {
    this.updateAccountState(pubkey, { translationSourceLang: lang ?? undefined });
  }

  /**
   * Get translation target language for an account
   */
  getTranslationTargetLang(pubkey: string): string | undefined {
    const state = this.getAccountState(pubkey);
    return state.translationTargetLang;
  }

  /**
   * Set translation target language for an account
   */
  setTranslationTargetLang(pubkey: string, lang: string | null | undefined): void {
    this.updateAccountState(pubkey, { translationTargetLang: lang ?? undefined });
  }

  /**
   * Get last summary check timestamp for an account
   */
  getLastSummaryCheck(pubkey: string): number {
    const state = this.getAccountState(pubkey);
    return state.lastSummaryCheck || 0;
  }

  /**
   * Set last summary check timestamp for an account
   */
  setLastSummaryCheck(pubkey: string, timestamp: number): void {
    this.updateAccountState(pubkey, { lastSummaryCheck: timestamp });
  }

  /**
   * Get summary time preset for an account
   */
  getSummaryTimePreset(pubkey: string): number | null | undefined {
    const state = this.getAccountState(pubkey);
    return state.summaryTimePreset;
  }

  /**
   * Set summary time preset for an account
   */
  setSummaryTimePreset(pubkey: string, preset: number | null | undefined): void {
    this.updateAccountState(pubkey, { summaryTimePreset: preset });
  }

  /**
   * Get summary custom date for an account
   */
  getSummaryCustomDate(pubkey: string): number | null | undefined {
    const state = this.getAccountState(pubkey);
    return state.summaryCustomDate;
  }

  /**
   * Set summary custom date for an account
   */
  setSummaryCustomDate(pubkey: string, timestamp: number | null | undefined): void {
    this.updateAccountState(pubkey, { summaryCustomDate: timestamp });
  }

  /**
   * Get zap split enabled state for an account
   */
  getZapSplitEnabled(pubkey: string): boolean {
    const state = this.getAccountState(pubkey);
    return state.zapSplitEnabled ?? false;
  }

  /**
   * Set zap split enabled state for an account
   */
  setZapSplitEnabled(pubkey: string, enabled: boolean): void {
    this.updateAccountState(pubkey, { zapSplitEnabled: enabled });
  }

  /**
   * Get zap split original author percentage for an account
   */
  getZapSplitOriginalPercent(pubkey: string): number {
    const state = this.getAccountState(pubkey);
    return state.zapSplitOriginalPercent ?? 90; // Default 90%
  }

  /**
   * Set zap split original author percentage for an account
   */
  setZapSplitOriginalPercent(pubkey: string, percent: number): void {
    this.updateAccountState(pubkey, { zapSplitOriginalPercent: percent });
  }

  /**
   * Get zap split quoter percentage for an account
   */
  getZapSplitQuoterPercent(pubkey: string): number {
    const state = this.getAccountState(pubkey);
    return state.zapSplitQuoterPercent ?? 10; // Default 10%
  }

  /**
   * Set zap split quoter percentage for an account
   */
  setZapSplitQuoterPercent(pubkey: string, percent: number): void {
    this.updateAccountState(pubkey, { zapSplitQuoterPercent: percent });
  }

  /**
   * Get trusted media authors for an account
   * These are pubkeys whose media should always be revealed (not blurred)
   * @param pubkey The user's pubkey
   * @param trackChanges If true, reads the version signal to enable reactivity
   */
  getTrustedMediaAuthors(pubkey: string, trackChanges = false): string[] {
    // Read version signal to establish dependency for computed signals
    if (trackChanges) {
      this.trustedMediaAuthorsVersion();
    }
    const state = this.getAccountState(pubkey);
    return state.trustedMediaAuthors || [];
  }

  /**
   * Set trusted media authors for an account
   */
  setTrustedMediaAuthors(pubkey: string, authors: string[]): void {
    this.updateAccountState(pubkey, { trustedMediaAuthors: authors });
    // Bump version to trigger reactivity in computed signals
    this.trustedMediaAuthorsVersion.update(v => v + 1);
  }

  /**
   * Add a trusted media author for an account
   */
  addTrustedMediaAuthor(pubkey: string, authorPubkey: string): void {
    const current = this.getTrustedMediaAuthors(pubkey);
    if (!current.includes(authorPubkey)) {
      this.setTrustedMediaAuthors(pubkey, [...current, authorPubkey]);
    }
  }

  /**
   * Remove a trusted media author for an account
   */
  removeTrustedMediaAuthor(pubkey: string, authorPubkey: string): void {
    const current = this.getTrustedMediaAuthors(pubkey);
    this.setTrustedMediaAuthors(pubkey, current.filter(p => p !== authorPubkey));
  }

  /**
   * Check if an author is trusted for media reveal
   * @param trackChanges - If true, reads the version signal to trigger reactivity in computed signals
   */
  isMediaAuthorTrusted(pubkey: string, authorPubkey: string, trackChanges = false): boolean {
    // Read the version signal to establish reactive dependency if requested
    if (trackChanges) {
      this.trustedMediaAuthorsVersion();
    }
    return this.getTrustedMediaAuthors(pubkey).includes(authorPubkey);
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
    this.cachedStates = null;
    this.localStorage.removeItem(ACCOUNT_STATE_KEY);
  }
}
