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
  dismissedCredentialsBackupDialog?: boolean;
  articlesActiveTab?: number;
  /**
   * @deprecated Use articlesShowFollowing and articlesShowPublic instead
   * Feed source preference for articles discover page (following or public).
   * Defaults to 'following' to show articles from people the user follows.
   */
  articlesDiscoverFeedSource?: 'following' | 'public'; // Feed source for articles discover page
  /**
   * Whether to show articles from people the user follows.
   * Defaults to true.
   */
  articlesShowFollowing?: boolean;
  /**
   * Whether to show articles from the public feed (people not followed).
   * Defaults to false.
   */
  articlesShowPublic?: boolean;
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
  unreadMessagesCount?: number; // Cached count of unread direct messages
  hiddenChatIds?: string[]; // Chat IDs that user has hidden
  hiddenMessageIds?: Record<string, string[]>; // Hidden message IDs per chat (chatId -> messageId[])
  globalEventExpiration?: number | null; // Global expiration time in hours for all events created (null = disabled)
  musicTrackLicense?: string; // Last used license for music tracks
  musicTrackLicenseUrl?: string; // Last used license URL for music tracks (for custom licenses)
  volumeLevel?: number; // Video volume level (0-1)
  volumeMuted?: boolean; // Whether video is muted
  audioPlayerView?: string; // Audio player view preference (modern, cards, winamp)
  aiDisclaimerSeen?: boolean; // Whether the AI disclaimer dialog has been seen
  publicRelayFeeds?: string[]; // List of public relay feeds (domains) for the relay feed menu
  publicRelayShowReplies?: boolean; // Whether to show replies in public relay feeds
  publicRelayShowReposts?: boolean; // Whether to show reposts in public relay feeds (default: true)
  wallets?: Record<string, AccountWallet>; // NWC wallets for this account
  followingLastFetch?: number; // Timestamp when following data was last fetched from relays
  lastAppOpen?: number; // Timestamp (in seconds) when app was last opened
  musicYoursSectionCollapsed?: boolean; // Whether the "Yours" section in Music is collapsed
  favoritesMigrated?: boolean; // Whether favorites have been migrated to Nostr (kind 30000)
  leftPanelCollapsed?: boolean; // Whether the left panel is collapsed when viewing right panel content
  zapHistoryLastTimestamp?: number; // Timestamp of the most recent zap in history (for incremental fetching)
  threadReplyFilter?: string; // Global filter for thread replies: 'everyone', 'following', or follow set d-tag
  recentEmojis?: RecentEmoji[]; // Recently used emojis for quick access in emoji picker
  streamsListFilter?: string; // Filter for streams: 'all', 'following', or follow set d-tag
}

/**
 * Recent emoji stored per-account
 * Can be a standard emoji or a custom emoji with shortcode and URL
 */
export interface RecentEmoji {
  emoji: string; // The emoji character or :shortcode: for custom emojis
  url?: string; // URL for custom emojis (NIP-30)
  timestamp: number; // When the emoji was last used (for sorting)
}

/**
 * Wallet stored per-account
 */
export interface AccountWallet {
  pubkey: string;
  connections: string[];
  name?: string;
}

/**
 * Root structure for all account states
 */
type AccountStatesRoot = Record<string, AccountLocalState>;

const ACCOUNT_STATE_KEY = 'nostria-state';

/**
 * Key used for storing state for anonymous (unauthenticated) users
 */
export const ANONYMOUS_PUBKEY = 'anonymous';

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

  // Signal to trigger reactivity when hidden chat IDs change
  private hiddenChatIdsVersion = signal(0);

  // Signal to trigger reactivity when hidden message IDs change
  private hiddenMessageIdsVersion = signal(0);

  // Signal to trigger reactivity when left panel collapsed state changes
  private leftPanelCollapsedVersion = signal(0);

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
   * Get zap history last timestamp for an account (most recent zap timestamp)
   */
  getZapHistoryLastTimestamp(pubkey: string): number {
    const state = this.getAccountState(pubkey);
    return state.zapHistoryLastTimestamp || 0;
  }

  /**
   * Set zap history last timestamp for an account
   */
  setZapHistoryLastTimestamp(pubkey: string, timestamp: number): void {
    this.updateAccountState(pubkey, { zapHistoryLastTimestamp: timestamp });
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
   * Get thread reply filter for an account
   * Returns 'everyone' if not set
   */
  getThreadReplyFilter(pubkey: string): string {
    const state = this.getAccountState(pubkey);
    return state.threadReplyFilter || 'everyone';
  }

  /**
   * Set thread reply filter for an account
   */
  setThreadReplyFilter(pubkey: string, filter: string): void {
    // Only store non-default values
    const value = filter === 'everyone' ? undefined : filter;
    this.updateAccountState(pubkey, { threadReplyFilter: value });
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
   * Get dismissed credentials backup dialog status for an account
   */
  getDismissedCredentialsBackupDialog(pubkey: string): boolean {
    const state = this.getAccountState(pubkey);
    return state.dismissedCredentialsBackupDialog || false;
  }

  /**
   * Set dismissed credentials backup dialog status for an account
   */
  setDismissedCredentialsBackupDialog(pubkey: string, dismissed: boolean): void {
    this.updateAccountState(pubkey, { dismissedCredentialsBackupDialog: dismissed });
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
   * Get articles discover feed source for an account
   */
  getArticlesDiscoverFeedSource(pubkey: string): 'following' | 'public' {
    const state = this.getAccountState(pubkey);
    return state.articlesDiscoverFeedSource || 'following';
  }

  /**
   * Set articles discover feed source for an account
   * @deprecated Use setArticlesShowFollowing and setArticlesShowPublic instead
   */
  setArticlesDiscoverFeedSource(pubkey: string, feedSource: 'following' | 'public'): void {
    this.updateAccountState(pubkey, { articlesDiscoverFeedSource: feedSource });
  }

  /**
   * Get whether to show articles from following for an account
   */
  getArticlesShowFollowing(pubkey: string): boolean {
    const state = this.getAccountState(pubkey);
    // Default to true if not set, for backward compatibility with old 'following' default
    return state.articlesShowFollowing ?? true;
  }

  /**
   * Set whether to show articles from following for an account
   */
  setArticlesShowFollowing(pubkey: string, show: boolean): void {
    this.updateAccountState(pubkey, { articlesShowFollowing: show });
  }

  /**
   * Get whether to show public articles for an account
   */
  getArticlesShowPublic(pubkey: string): boolean {
    const state = this.getAccountState(pubkey);
    // Default to false for backward compatibility
    return state.articlesShowPublic ?? false;
  }

  /**
   * Set whether to show public articles for an account
   */
  setArticlesShowPublic(pubkey: string, show: boolean): void {
    this.updateAccountState(pubkey, { articlesShowPublic: show });
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
   * Get following last fetch timestamp for an account
   */
  getFollowingLastFetch(pubkey: string): number {
    const state = this.getAccountState(pubkey);
    return state.followingLastFetch || 0;
  }

  /**
   * Set following last fetch timestamp for an account
   */
  setFollowingLastFetch(pubkey: string, timestamp: number): void {
    this.updateAccountState(pubkey, { followingLastFetch: timestamp });
  }

  /**
   * Get last app open timestamp for an account (in seconds)
   */
  getLastAppOpen(pubkey: string): number {
    const state = this.getAccountState(pubkey);
    return state.lastAppOpen || 0;
  }

  /**
   * Set last app open timestamp for an account (in seconds)
   */
  setLastAppOpen(pubkey: string, timestamp: number): void {
    this.updateAccountState(pubkey, { lastAppOpen: timestamp });
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
   * Get unread messages count for an account
   */
  getUnreadMessagesCount(pubkey: string): number {
    return this.getAccountState(pubkey).unreadMessagesCount || 0;
  }

  /**
   * Set unread messages count for an account
   */
  setUnreadMessagesCount(pubkey: string, count: number): void {
    this.updateAccountState(pubkey, { unreadMessagesCount: count });
  }

  /**
   * Get hidden chat IDs for an account
   */
  getHiddenChatIds(pubkey: string): string[] {
    return this.getAccountState(pubkey).hiddenChatIds || [];
  }

  /**
   * Set hidden chat IDs for an account
   */
  setHiddenChatIds(pubkey: string, chatIds: string[]): void {
    this.updateAccountState(pubkey, { hiddenChatIds: chatIds });
  }

  /**
   * Hide a chat for an account
   */
  hideChat(pubkey: string, chatId: string): void {
    const current = this.getHiddenChatIds(pubkey);
    if (!current.includes(chatId)) {
      this.setHiddenChatIds(pubkey, [...current, chatId]);
      this.hiddenChatIdsVersion.update(v => v + 1);
    }
  }

  /**
   * Unhide a chat for an account
   */
  unhideChat(pubkey: string, chatId: string): void {
    const current = this.getHiddenChatIds(pubkey);
    this.setHiddenChatIds(pubkey, current.filter(id => id !== chatId));
    this.hiddenChatIdsVersion.update(v => v + 1);
  }

  /**
   * Check if a chat is hidden for an account
   * @param pubkey - Current user's pubkey
   * @param chatId - The chat ID to check
   * @param trackChanges - If true, reads the version signal to trigger reactivity in computed signals
   */
  isChatHidden(pubkey: string, chatId: string, trackChanges = false): boolean {
    if (trackChanges) {
      this.hiddenChatIdsVersion();
    }
    return this.getHiddenChatIds(pubkey).includes(chatId);
  }

  /**
   * Get hidden message IDs for a specific chat
   */
  getHiddenMessageIds(pubkey: string, chatId: string): string[] {
    const state = this.getAccountState(pubkey);
    return state.hiddenMessageIds?.[chatId] || [];
  }

  /**
   * Set hidden message IDs for a specific chat
   */
  private setHiddenMessageIds(pubkey: string, chatId: string, messageIds: string[]): void {
    const state = this.getAccountState(pubkey);
    const currentHiddenMessages = state.hiddenMessageIds || {};

    if (messageIds.length === 0) {
      // Remove the chat entry if no hidden messages
      const { [chatId]: _, ...rest } = currentHiddenMessages;
      this.updateAccountState(pubkey, { hiddenMessageIds: rest });
    } else {
      this.updateAccountState(pubkey, {
        hiddenMessageIds: {
          ...currentHiddenMessages,
          [chatId]: messageIds,
        },
      });
    }
  }

  /**
   * Hide a message in a chat
   */
  hideMessage(pubkey: string, chatId: string, messageId: string): void {
    const current = this.getHiddenMessageIds(pubkey, chatId);
    if (!current.includes(messageId)) {
      this.setHiddenMessageIds(pubkey, chatId, [...current, messageId]);
      this.hiddenMessageIdsVersion.update(v => v + 1);
    }
  }

  /**
   * Unhide a message in a chat
   */
  unhideMessage(pubkey: string, chatId: string, messageId: string): void {
    const current = this.getHiddenMessageIds(pubkey, chatId);
    this.setHiddenMessageIds(pubkey, chatId, current.filter(id => id !== messageId));
    this.hiddenMessageIdsVersion.update(v => v + 1);
  }

  /**
   * Check if a message is hidden in a chat
   * @param pubkey - Current user's pubkey
   * @param chatId - The chat ID
   * @param messageId - The message ID to check
   * @param trackChanges - If true, reads the version signal to trigger reactivity in computed signals
   */
  isMessageHidden(pubkey: string, chatId: string, messageId: string, trackChanges = false): boolean {
    if (trackChanges) {
      this.hiddenMessageIdsVersion();
    }
    return this.getHiddenMessageIds(pubkey, chatId).includes(messageId);
  }

  /**
   * Check if an author is trusted for media reveal
   * @param pubkey - Current user's pubkey
   * @param authorPubkey - The author of the media content
   * @param trackChanges - If true, reads the version signal to trigger reactivity in computed signals
   * @param trustedByPubkey - Optional pubkey of someone who shared/reposted the content (if they're trusted, content is trusted)
   */
  isMediaAuthorTrusted(pubkey: string, authorPubkey: string, trackChanges = false, trustedByPubkey?: string): boolean {
    // Read the version signal to establish reactive dependency if requested
    if (trackChanges) {
      this.trustedMediaAuthorsVersion();
    }
    const trustedAuthors = this.getTrustedMediaAuthors(pubkey);

    // Check if author is directly trusted
    if (trustedAuthors.includes(authorPubkey)) {
      return true;
    }

    // Check if the content was shared by someone trusted
    if (trustedByPubkey && trustedAuthors.includes(trustedByPubkey)) {
      return true;
    }

    return false;
  }

  /**
   * Get global event expiration setting for an account
   * @returns Expiration time in hours, or null if disabled
   */
  getGlobalEventExpiration(pubkey: string): number | null {
    const state = this.getAccountState(pubkey);
    return state.globalEventExpiration ?? null;
  }

  /**
   * Set global event expiration for an account
   * @param pubkey - User's pubkey
   * @param hours - Expiration time in hours, or null to disable
   */
  setGlobalEventExpiration(pubkey: string, hours: number | null): void {
    this.updateAccountState(pubkey, { globalEventExpiration: hours });
  }

  /**
   * Get last used music track license for an account
   */
  getMusicTrackLicense(pubkey: string): string | undefined {
    const state = this.getAccountState(pubkey);
    return state.musicTrackLicense;
  }

  /**
   * Set last used music track license for an account
   */
  setMusicTrackLicense(pubkey: string, license: string | undefined): void {
    this.updateAccountState(pubkey, { musicTrackLicense: license });
  }

  /**
   * Get last used music track license URL for an account (for custom licenses)
   */
  getMusicTrackLicenseUrl(pubkey: string): string | undefined {
    const state = this.getAccountState(pubkey);
    return state.musicTrackLicenseUrl;
  }

  /**
   * Set last used music track license URL for an account (for custom licenses)
   */
  setMusicTrackLicenseUrl(pubkey: string, url: string | undefined): void {
    this.updateAccountState(pubkey, { musicTrackLicenseUrl: url });
  }

  /**
   * Get video volume level for an account
   */
  getVolumeLevel(pubkey: string): number {
    const state = this.getAccountState(pubkey);
    return state.volumeLevel ?? 1; // Default to full volume
  }

  /**
   * Set video volume level for an account
   */
  setVolumeLevel(pubkey: string, volume: number): void {
    this.updateAccountState(pubkey, { volumeLevel: volume });
  }

  /**
   * Get video muted state for an account
   * Defaults to true (muted) because browser autoplay requires muted videos
   */
  getVolumeMuted(pubkey: string): boolean {
    const state = this.getAccountState(pubkey);
    return state.volumeMuted ?? true;
  }

  /**
   * Set video muted state for an account
   */
  setVolumeMuted(pubkey: string, muted: boolean): void {
    this.updateAccountState(pubkey, { volumeMuted: muted });
  }

  /**
   * Get audio player view preference for an account
   */
  getAudioPlayerView(pubkey: string): string {
    const state = this.getAccountState(pubkey);
    return state.audioPlayerView ?? 'modern';
  }

  /**
   * Set audio player view preference for an account
   */
  setAudioPlayerView(pubkey: string, view: string): void {
    this.updateAccountState(pubkey, { audioPlayerView: view });
  }

  /**
   * Get AI disclaimer seen status for an account
   */
  getAiDisclaimerSeen(pubkey: string): boolean {
    const state = this.getAccountState(pubkey);
    return state.aiDisclaimerSeen ?? false;
  }

  /**
   * Set AI disclaimer seen status for an account
   */
  setAiDisclaimerSeen(pubkey: string, seen: boolean): void {
    this.updateAccountState(pubkey, { aiDisclaimerSeen: seen });
  }

  /**
   * Get public relay feeds for an account
   */
  getPublicRelayFeeds(pubkey: string): string[] | undefined {
    const state = this.getAccountState(pubkey);
    return state.publicRelayFeeds;
  }

  /**
   * Set public relay feeds for an account
   */
  setPublicRelayFeeds(pubkey: string, feeds: string[]): void {
    this.updateAccountState(pubkey, { publicRelayFeeds: feeds });
  }

  /**
   * Get whether to show replies in public relay feeds
   */
  getPublicRelayShowReplies(pubkey: string): boolean {
    const state = this.getAccountState(pubkey);
    return state.publicRelayShowReplies ?? false; // Default to false
  }

  /**
   * Set whether to show replies in public relay feeds
   */
  setPublicRelayShowReplies(pubkey: string, showReplies: boolean): void {
    this.updateAccountState(pubkey, { publicRelayShowReplies: showReplies });
  }

  /**
   * Get whether to show reposts in public relay feeds
   */
  getPublicRelayShowReposts(pubkey: string): boolean {
    const state = this.getAccountState(pubkey);
    return state.publicRelayShowReposts ?? true; // Default to true
  }

  /**
   * Set whether to show reposts in public relay feeds
   */
  setPublicRelayShowReposts(pubkey: string, showReposts: boolean): void {
    this.updateAccountState(pubkey, { publicRelayShowReposts: showReposts });
  }

  /**
   * Get music "Yours" section collapsed state for an account
   */
  getMusicYoursSectionCollapsed(pubkey: string): boolean {
    const state = this.getAccountState(pubkey);
    return state.musicYoursSectionCollapsed ?? false;
  }

  /**
   * Set music "Yours" section collapsed state for an account
   */
  setMusicYoursSectionCollapsed(pubkey: string, collapsed: boolean): void {
    this.updateAccountState(pubkey, { musicYoursSectionCollapsed: collapsed });
  }

  /**
   * Get wallets for an account
   */
  getWallets(pubkey: string): Record<string, AccountWallet> {
    const state = this.getAccountState(pubkey);
    return state.wallets || {};
  }

  /**
   * Set wallets for an account
   */
  setWallets(pubkey: string, wallets: Record<string, AccountWallet>): void {
    this.updateAccountState(pubkey, { wallets });
  }

  /**
   * Get favorites migrated status for an account
   */
  getFavoritesMigrated(pubkey: string): boolean {
    const state = this.getAccountState(pubkey);
    return state.favoritesMigrated || false;
  }

  /**
   * Set favorites migrated status for an account
   */
  setFavoritesMigrated(pubkey: string, migrated: boolean): void {
    this.updateAccountState(pubkey, { favoritesMigrated: migrated });
  }

  /**
   * Get left panel collapsed state for an account
   */
  getLeftPanelCollapsed(pubkey: string): boolean {
    // Read version signal to enable reactivity
    this.leftPanelCollapsedVersion();
    const state = this.getAccountState(pubkey);
    return state.leftPanelCollapsed || false;
  }

  /**
   * Set left panel collapsed state for an account
   */
  setLeftPanelCollapsed(pubkey: string, collapsed: boolean): void {
    this.updateAccountState(pubkey, { leftPanelCollapsed: collapsed });
    this.leftPanelCollapsedVersion.update(v => v + 1);
  }

  /**
   * Get recent emojis for an account
   * Returns up to 12 most recently used emojis, sorted by most recent first
   */
  getRecentEmojis(pubkey: string): RecentEmoji[] {
    const state = this.getAccountState(pubkey);
    const emojis = state.recentEmojis || [];
    // Sort by timestamp descending (most recent first) and limit to 12
    return [...emojis].sort((a, b) => b.timestamp - a.timestamp).slice(0, 12);
  }

  /**
   * Add an emoji to recent emojis for an account
   * If the emoji already exists, updates its timestamp
   * Keeps only the 20 most recent emojis
   */
  addRecentEmoji(pubkey: string, emoji: string, url?: string): void {
    const state = this.getAccountState(pubkey);
    const currentEmojis = state.recentEmojis || [];
    const timestamp = Date.now();

    // Remove existing entry for this emoji if present
    const filteredEmojis = currentEmojis.filter(e => e.emoji !== emoji);

    // Add new entry at the beginning
    const newEmoji: RecentEmoji = { emoji, timestamp };
    if (url) {
      newEmoji.url = url;
    }

    // Keep only the 20 most recent emojis
    const updatedEmojis = [newEmoji, ...filteredEmojis].slice(0, 20);

    this.updateAccountState(pubkey, { recentEmojis: updatedEmojis });
  }

  /**
   * Clear recent emojis for an account
   */
  clearRecentEmojis(pubkey: string): void {
    this.updateAccountState(pubkey, { recentEmojis: [] });
  }

  /**
   * Get streams list filter for an account
   * Returns 'all' if not set (shows all streams)
   */
  getStreamsListFilter(pubkey: string): string {
    const state = this.getAccountState(pubkey);
    return state.streamsListFilter || 'all';
  }

  /**
   * Set streams list filter for an account
   * @param filter - 'all', 'following', or a follow set d-tag
   */
  setStreamsListFilter(pubkey: string, filter: string): void {
    // Only store non-default values
    const value = filter === 'all' ? undefined : filter;
    this.updateAccountState(pubkey, { streamsListFilter: value });
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
