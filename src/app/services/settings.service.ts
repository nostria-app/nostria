import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { NostrService } from './nostr.service';
import { Event, kinds } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { AccountRelayService } from './relays/account-relay';
import { DatabaseService } from './database.service';
import { LocalSettingsService, MenuItemConfig, RelayDiscoveryMode } from './local-settings.service';

export type PlaceholderAlgorithm = 'blurhash' | 'thumbhash' | 'both';

/**
 * Synced feed configuration stored in kind 30078 settings event.
 * This is a subset of FeedConfig that excludes runtime/cache properties.
 */
export interface SyncedFeedConfig {
  id: string;
  label: string;
  icon: string;
  type: 'notes' | 'articles' | 'photos' | 'videos' | 'music' | 'polls' | 'custom';
  kinds: number[];
  source?: 'following' | 'public' | 'custom' | 'for-you' | 'search' | 'trending' | 'interests';
  customUsers?: string[]; // Array of pubkeys for custom user selection
  customStarterPacks?: string[]; // Array of starter pack identifiers (d tags)
  customFollowSets?: string[]; // Array of follow set identifiers (d tags from kind 30000 events)
  customInterestHashtags?: string[]; // Array of hashtags from interest list for filtering (without # prefix)
  searchQuery?: string; // Search query for search-based feeds (NIP-50)
  relayConfig: 'account' | 'custom' | 'search';
  customRelays?: string[];
  filters?: Record<string, unknown>;
  showReplies?: boolean;
  showReposts?: boolean;
  hideWordle?: boolean;
  wotFilter?: boolean;
  wotMinRank?: number;
  createdAt: number;
  updatedAt: number;
  isSystem?: boolean;
}

export interface UserSettings {
  socialSharingPreview: boolean;
  messageNotificationSoundsEnabled?: boolean;
  zapSoundsEnabled?: boolean;
  postToXByDefault?: boolean;
  rightSidebarEnabled?: boolean;
  relayDiscoveryMode?: RelayDiscoveryMode;
  menuItems?: MenuItemConfig[];
  imageCacheEnabled?: boolean; // Optional setting for image cache
  // Report type visibility settings (NIP-56)
  hideNudity?: boolean;
  hideMalware?: boolean;
  hideProfanity?: boolean;
  hideIllegal?: boolean;
  hideSpam?: boolean;
  hideImpersonation?: boolean;
  hideOther?: boolean;
  // Media privacy setting: 'blur-non-following' | 'blur-always' | 'show-always'
  mediaPrivacy?: 'blur-non-following' | 'blur-always' | 'show-always';
  // Image/video placeholder algorithm: blurhash (legacy), thumbhash (new), or both
  placeholderAlgorithm?: PlaceholderAlgorithm;
  // Short form video settings
  autoPlayShortForm?: boolean;
  repeatShortForm?: boolean;
  // AI Settings
  aiEnabled?: boolean;
  aiSentimentEnabled?: boolean;
  aiTranslationEnabled?: boolean;
  aiSummarizationEnabled?: boolean;
  aiTranscriptionEnabled?: boolean;
  aiSpeechEnabled?: boolean;
  aiVoice?: 'female' | 'male';
  aiNativeLanguage?: string;
  // Wallet Settings
  zapQuickAmounts?: number[]; // Array of amounts enabled for quick zapping (legacy, for menu)
  quickZapEnabled?: boolean; // Enable the quick zap button
  quickZapAmount?: number; // Amount for instant quick zap button
  hideWalletAmounts?: boolean; // Hide sat amounts in wallet UI
  displaySatsInUsd?: boolean; // Show sat-denominated values as USD across the UI
  // Video playback settings
  autoPlayVideos?: boolean; // Auto-play all videos (muted)
  // Music settings
  publishMusicStatus?: boolean; // Publish NIP-38 music status when playing tracks
  // Custom feeds - synced across devices via kind 30078
  customFeeds?: SyncedFeedConfig[];
  // Favicon settings
  googleFaviconEnabled?: boolean; // Use Google API for favicons (privacy tradeoff)
  // Pinned chats - synced across devices via kind 30078
  pinnedChatPubkeys?: string[]; // Array of chat pubkeys (or group chat IDs) pinned to top of messages list
  // Add more settings as needed
}

const DEFAULT_SETTINGS: UserSettings = {
  socialSharingPreview: true,
  messageNotificationSoundsEnabled: true,
  zapSoundsEnabled: true,
  postToXByDefault: false,
  rightSidebarEnabled: undefined,
  relayDiscoveryMode: 'outbox',
  imageCacheEnabled: true,
  // By default, hide all reported content
  hideNudity: true,
  hideMalware: true,
  hideProfanity: true,
  hideIllegal: true,
  hideSpam: true,
  hideImpersonation: true,
  hideOther: true,
  mediaPrivacy: 'show-always',
  placeholderAlgorithm: 'blurhash', // Default to blurhash for wider compatibility
  autoPlayShortForm: true,
  repeatShortForm: true,
  // AI Defaults
  aiEnabled: true,
  aiSentimentEnabled: true,
  aiTranslationEnabled: true,
  aiSummarizationEnabled: true,
  aiTranscriptionEnabled: true,
  aiSpeechEnabled: true,
  aiVoice: 'female',
  aiNativeLanguage: 'en',
  // Wallet Defaults - enable common zap amounts
  zapQuickAmounts: [21, 210, 420, 1000, 5000, 10000],
  quickZapEnabled: false, // Off by default
  quickZapAmount: 21, // Default quick zap amount
  hideWalletAmounts: false, // Show amounts by default
  displaySatsInUsd: false, // Show sats by default
  // Video playback
  autoPlayVideos: false, // Off by default - user must opt-in
  // Music
  publishMusicStatus: true, // Publish NIP-38 music status by default
  // Custom feeds - empty by default, will be populated from FeedService
  customFeeds: undefined,
  // Favicon settings - disabled by default for privacy
  googleFaviconEnabled: false,
};

@Injectable({
  providedIn: 'root',
})
export class SettingsService {
  private nostrService = inject(NostrService);
  private accountState = inject(AccountStateService);
  private accountRelay = inject(AccountRelayService);
  private database = inject(DatabaseService);
  private logger = inject(LoggerService);
  private localSettings = inject(LocalSettingsService);

  settings = signal<UserSettings>({ ...DEFAULT_SETTINGS });

  // Track whether settings have been loaded for the current user
  // This prevents showing media before user's privacy preferences are known
  settingsLoaded = signal<boolean>(false);

  // Tracks whether a persisted settings event definitely exists for the current account.
  // - true: a cached or relay-backed settings event was found
  // - false: relay fetch completed and no settings event exists
  // - null: unknown (for example due to startup or fetch failure)
  hasPersistedSettingsEvent = signal<boolean | null>(null);

  private liveSettingsSubscription: { close: () => void } | { unsubscribe: () => void } | null =
    null;
  private liveSettingsSubscriptionPubkey: string | null = null;
  private currentSettingsEventCreatedAt: number | null = null;
  private loadedSettingsPubkey: string | null = null;

  constructor() {
    effect(async () => {
      const account = this.accountState.account();
      const initialized = this.accountState.initialized();
      const pubkey = this.accountState.pubkey();

      if (account && initialized && pubkey) {
        // Skip if settings are already loaded for this account
        // (StateService loads settings directly for faster startup)
        if (this.settingsLoaded() && this.loadedSettingsPubkey === pubkey) {
          return;
        }
        // Mark settings as not loaded while we fetch
        this.settingsLoaded.set(false);
        this.hasPersistedSettingsEvent.set(null);
        this.loadedSettingsPubkey = null;
        // Reset to defaults first to ensure clean state
        this.settings.set({ ...DEFAULT_SETTINGS });
        // Then load settings for this account
        await this.loadSettings(pubkey);
        // Mark settings as loaded after fetch completes
        this.loadedSettingsPubkey = pubkey;
        this.settingsLoaded.set(true);
      } else if (!account) {
        // No account, reset to defaults and mark as loaded (defaults are safe for anonymous)
        this.settings.set({ ...DEFAULT_SETTINGS });
        this.hasPersistedSettingsEvent.set(false);
        this.currentSettingsEventCreatedAt = null;
        this.loadedSettingsPubkey = null;
        this.settingsLoaded.set(true);
      }
    });

    effect(() => {
      const account = this.accountState.account();
      const initialized = this.accountState.initialized();
      const pubkey = this.accountState.pubkey();

      if (!account || !initialized || !pubkey) {
        this.stopLiveSettingsSubscription();
        return;
      }

      if (this.liveSettingsSubscriptionPubkey === pubkey) {
        return;
      }

      untracked(() => {
        this.stopLiveSettingsSubscription();
        this.startLiveSettingsSubscription(pubkey);
      });
    });
  }

  private applySettingsEvent(event: Event, source: string): boolean {
    if (!event.content) {
      return false;
    }

    try {
      const parsedContent = JSON.parse(event.content);
      const mergedSettings = {
        ...DEFAULT_SETTINGS,
        ...parsedContent,
      };

      this.settings.set(mergedSettings);
      this.hasPersistedSettingsEvent.set(true);
      this.currentSettingsEventCreatedAt = event.created_at;
      this.localSettings.setRelayDiscoveryMode(mergedSettings.relayDiscoveryMode ?? 'outbox');

      if (Object.hasOwn(parsedContent, 'menuItems')) {
        const menuItems = Array.isArray(parsedContent.menuItems)
          ? parsedContent.menuItems as MenuItemConfig[]
          : [];
        this.localSettings.setMenuItems(menuItems);
      }

      this.logger.info(`Settings ${source}`, this.settings());
      return true;
    } catch (error) {
      this.logger.warn(`Failed to parse settings from ${source}`, error);
      return false;
    }
  }

  private async persistSettingsEvent(event: Event): Promise<boolean> {
    return this.database.saveReplaceableEvent({
      ...event,
      dTag: 'nostria:settings',
    });
  }

  private async handleLiveSettingsEvent(event: Event): Promise<void> {
    if (!event.content) {
      return;
    }

    try {
      const wasSaved = await this.persistSettingsEvent(event);
      if (!wasSaved && (this.currentSettingsEventCreatedAt ?? 0) >= event.created_at) {
        return;
      }

      if (this.applySettingsEvent(event, 'updated from relay subscription')) {
        this.logger.info('Applied live settings update from another device', {
          pubkey: event.pubkey,
          createdAt: event.created_at,
        });
      }
    } catch (error) {
      this.logger.warn('Failed to handle live settings update', error);
    }
  }

  private startLiveSettingsSubscription(pubkey: string): void {
    const filter = {
      kinds: [kinds.Application],
      '#d': ['nostria:settings'],
      authors: [pubkey],
      limit: 1,
    };

    this.liveSettingsSubscriptionPubkey = pubkey;
    this.liveSettingsSubscription = this.accountRelay.subscribe(
      filter,
      (event) => {
        void this.handleLiveSettingsEvent(event);
      },
      () => {
        this.logger.debug('Live settings subscription reached EOSE');
      }
    );
  }

  private stopLiveSettingsSubscription(): void {
    if (this.liveSettingsSubscription) {
      if ('close' in this.liveSettingsSubscription) {
        this.liveSettingsSubscription.close();
      } else {
        this.liveSettingsSubscription.unsubscribe();
      }
    }

    this.liveSettingsSubscription = null;
    this.liveSettingsSubscriptionPubkey = null;
  }

  async loadSettings(pubkey: string): Promise<void> {
    try {
      // FAST PATH: Try to load from local database first (instant)
      const cachedEvent = await this.database.getParameterizedReplaceableEvent(
        pubkey,
        kinds.Application,
        'nostria:settings'
      );

      if (cachedEvent && cachedEvent.content) {
        if (this.applySettingsEvent(cachedEvent, 'loaded from cache')) {
          // Refresh from relay in background (don't await)
          this.refreshSettingsFromRelay(pubkey);
          return;
        }

        this.logger.warn('Failed to use cached settings, will fetch from relay');
      }

      // No cache or invalid cache - fetch from relay
      await this.fetchSettingsFromRelay(pubkey);
    } catch (error) {
      this.logger.error('Failed to load settings', error);
      this.hasPersistedSettingsEvent.set(null);
      this.currentSettingsEventCreatedAt = null;
      this.settings.set({ ...DEFAULT_SETTINGS });
    }
  }

  /**
   * Fetch settings from relay and save to cache
   */
  private async fetchSettingsFromRelay(pubkey: string): Promise<void> {
    const filter = {
      kinds: [kinds.Application],
      '#d': ['nostria:settings'],
      authors: [pubkey],
      limit: 1,
    };

    const event = await this.accountRelay.get(filter);

    if (event && event.content) {
      if (this.applySettingsEvent(event, 'loaded successfully from relay')) {
        // Save to cache for next time
        await this.persistSettingsEvent(event);
      } else {
        this.logger.error('Failed to parse settings content from relay');
        this.hasPersistedSettingsEvent.set(null);
        this.currentSettingsEventCreatedAt = null;
        this.settings.set({ ...DEFAULT_SETTINGS });
      }
    } else {
      this.logger.info('No settings found, using defaults', DEFAULT_SETTINGS);
      this.hasPersistedSettingsEvent.set(false);
      this.currentSettingsEventCreatedAt = null;
      this.settings.set({ ...DEFAULT_SETTINGS });
    }
  }

  /**
   * Refresh settings from relay in background and update if newer
   */
  private async refreshSettingsFromRelay(pubkey: string): Promise<void> {
    try {
      const filter = {
        kinds: [kinds.Application],
        '#d': ['nostria:settings'],
        authors: [pubkey],
        limit: 1,
      };

      const event = await this.accountRelay.get(filter);

      if (event && event.content) {
        // Check if relay version is newer than cached
        const cachedEvent = await this.database.getParameterizedReplaceableEvent(
          pubkey,
          kinds.Application,
          'nostria:settings'
        );

        if (!cachedEvent || event.created_at > cachedEvent.created_at) {
          if (this.applySettingsEvent(event, 'refreshed from relay')) {
            // Update cache
            await this.persistSettingsEvent(event);
          }
        }
      }
    } catch (error) {
      this.logger.debug('Background settings refresh failed', error);
    }
  }

  async updateSettings(updatedSettings: Partial<UserSettings>): Promise<void> {
    // Guard: don't sign and publish settings before the persisted copy has
    // been loaded.  Publishing at this point would merge the partial update
    // with DEFAULT_SETTINGS (which lack the user's real values) and
    // overwrite the relay event – causing things like rightSidebarEnabled
    // to be lost across devices.
    if (!this.settingsLoaded()) {
      this.logger.warn('updateSettings called before settings were loaded – updating local signal only, skipping publish');
      this.settings.update(current => ({ ...current, ...updatedSettings }));
      return;
    }

    // Update the local settings
    const newSettings = {
      ...this.settings(),
      ...updatedSettings,
    };

    this.settings.set(newSettings);
    this.hasPersistedSettingsEvent.set(true);
    this.localSettings.setRelayDiscoveryMode(newSettings.relayDiscoveryMode ?? 'outbox');

    // Skip publishing for preview accounts - they cannot sign events
    const account = this.accountState.account();
    if (account?.source === 'preview') {
      this.logger.info('Skipping settings publish for preview account - cannot sign events');
      return;
    }

    // Create and publish the event
    try {
      const content = JSON.stringify(newSettings);
      const tags = [['d', 'nostria:settings']];

      const unsignedEvent = this.nostrService.createEvent(kinds.Application, content, tags);
      const signedEvent = await this.nostrService.signEvent(unsignedEvent);
      this.currentSettingsEventCreatedAt = signedEvent.created_at;

      // Persist immediately to the local database so settings such as custom feeds
      // are available on the next reload without waiting for relays to echo the event back.
      try {
        await this.persistSettingsEvent(signedEvent);
      } catch (cacheError) {
        this.logger.warn('Failed to cache settings event locally before publish', cacheError);
      }

      const publishResult = await this.accountRelay.publish(signedEvent);
      this.logger.info('Settings published', publishResult);
    } catch (error) {
      this.logger.error('Failed to save settings', error);
      throw error;
    }
  }

  async updateMenuItems(menuItems: MenuItemConfig[]): Promise<void> {
    this.localSettings.setMenuItems(menuItems);

    if (!this.accountState.account()) {
      return;
    }

    await this.updateSettings({ menuItems });
  }

  async resetMenuItems(): Promise<void> {
    await this.updateMenuItems([]);
  }

  async toggleSocialSharingPreview(): Promise<void> {
    const currentValue = this.settings().socialSharingPreview;
    await this.updateSettings({
      socialSharingPreview: !currentValue,
    });
  }

  async toggleImageCache(): Promise<void> {
    const currentValue = this.settings().imageCacheEnabled;
    await this.updateSettings({
      imageCacheEnabled: !currentValue,
    });

    // If disabling cache, optionally clear existing cache
    if (currentValue) {
      // Note: We don't automatically clear cache when disabling to preserve offline functionality
      // Users can manually clear cache in the settings if needed
      this.logger.debug('[Settings] Image cache disabled, existing cache preserved');
    }
  }

  async toggleGoogleFavicon(): Promise<void> {
    const currentValue = this.settings().googleFaviconEnabled;
    await this.updateSettings({
      googleFaviconEnabled: !currentValue,
    });
  }

  async toggleReportTypeVisibility(reportType: string): Promise<void> {
    const currentSettings = this.settings();

    const settingKey =
      `hide${reportType.charAt(0).toUpperCase() + reportType.slice(1)}` as keyof UserSettings;
    const currentValue = currentSettings[settingKey] as boolean;

    const newSettings = {
      [settingKey]: !currentValue,
    } as Partial<UserSettings>;

    await this.updateSettings(newSettings);
  }

  /**
   * Get synced custom feeds from settings.
   * Returns undefined if no feeds have been synced yet.
   */
  getSyncedFeeds(): SyncedFeedConfig[] | undefined {
    return this.settings().customFeeds;
  }

  /**
   * Update synced custom feeds in settings.
   * This will publish the updated settings to relays for cross-device sync.
   *
   * @param feeds - Array of feed configurations to sync
   */
  async updateSyncedFeeds(feeds: SyncedFeedConfig[]): Promise<void> {
    this.logger.info(`Syncing ${feeds.length} custom feeds to settings`);
    await this.updateSettings({ customFeeds: feeds });
  }

  /**
   * Check if there are any synced feeds available.
   * Useful to determine if this is a first-time user or if feeds should be loaded from sync.
   */
  hasSyncedFeeds(): boolean {
    const feeds = this.settings().customFeeds;
    return feeds !== undefined && feeds.length > 0;
  }

  /**
   * Check if a chat is pinned.
   * @param chatId - The chat pubkey or group chat ID
   */
  isChatPinned(chatId: string): boolean {
    const pinned = this.settings().pinnedChatPubkeys;
    return pinned !== undefined && pinned.includes(chatId);
  }

  /**
   * Pin a chat so it appears at the top of the messages list.
   * Publishes to relays for cross-device sync.
   * @param chatId - The chat pubkey or group chat ID
   */
  async pinChat(chatId: string): Promise<void> {
    const current = this.settings().pinnedChatPubkeys ?? [];
    if (current.includes(chatId)) return;
    await this.updateSettings({ pinnedChatPubkeys: [...current, chatId] });
  }

  /**
   * Unpin a chat, removing it from the pinned list.
   * Publishes to relays for cross-device sync.
   * @param chatId - The chat pubkey or group chat ID
   */
  async unpinChat(chatId: string): Promise<void> {
    const current = this.settings().pinnedChatPubkeys ?? [];
    if (!current.includes(chatId)) return;
    await this.updateSettings({ pinnedChatPubkeys: current.filter(id => id !== chatId) });
  }
}
