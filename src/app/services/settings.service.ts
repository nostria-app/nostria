import { Injectable, effect, inject, signal } from '@angular/core';
import { NostrService } from './nostr.service';
import { kinds } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { AccountRelayService } from './relays/account-relay';

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
  createdAt: number;
  updatedAt: number;
  isSystem?: boolean;
}

export interface UserSettings {
  socialSharingPreview: boolean;
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
  // Video playback settings
  autoPlayVideos?: boolean; // Auto-play all videos (muted)
  // Custom feeds - synced across devices via kind 30078
  customFeeds?: SyncedFeedConfig[];
  // Add more settings as needed
}

const DEFAULT_SETTINGS: UserSettings = {
  socialSharingPreview: true,
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
  // Video playback
  autoPlayVideos: false, // Off by default - user must opt-in
  // Custom feeds - empty by default, will be populated from FeedService
  customFeeds: undefined,
};

@Injectable({
  providedIn: 'root',
})
export class SettingsService {
  private nostrService = inject(NostrService);
  private accountState = inject(AccountStateService);
  private accountRelay = inject(AccountRelayService);
  private logger = inject(LoggerService);

  settings = signal<UserSettings>({ ...DEFAULT_SETTINGS });

  // Track whether settings have been loaded for the current user
  // This prevents showing media before user's privacy preferences are known
  settingsLoaded = signal<boolean>(false);

  constructor() {
    effect(async () => {
      const account = this.accountState.account();
      const initialized = this.accountState.initialized();

      if (account && initialized) {
        // Mark settings as not loaded while we fetch
        this.settingsLoaded.set(false);
        // Reset to defaults first to ensure clean state
        this.settings.set({ ...DEFAULT_SETTINGS });
        // Then load settings for this account
        await this.loadSettings(this.accountState.pubkey());
        // Mark settings as loaded after fetch completes
        this.settingsLoaded.set(true);
      } else if (!account) {
        // No account, reset to defaults and mark as loaded (defaults are safe for anonymous)
        this.settings.set({ ...DEFAULT_SETTINGS });
        this.settingsLoaded.set(true);
      }
    });
  }

  async loadSettings(pubkey: string): Promise<void> {
    try {
      const filter = {
        kinds: [kinds.Application],
        '#d': ['nostria:settings'],
        authors: [pubkey],
        limit: 1,
      };

      const event = await this.accountRelay.get(filter);

      if (event && event.content) {
        try {
          const parsedContent = JSON.parse(event.content);
          // Merge in correct order: defaults first, then loaded settings
          const mergedSettings = {
            ...DEFAULT_SETTINGS,
            ...parsedContent,
          };
          this.settings.set(mergedSettings);
          this.logger.info('Settings loaded successfully', this.settings());
        } catch (error) {
          this.logger.error('Failed to parse settings content', error);
          this.settings.set({ ...DEFAULT_SETTINGS });
        }
      } else {
        this.logger.info('No settings found, using defaults', DEFAULT_SETTINGS);
        this.settings.set({ ...DEFAULT_SETTINGS });
      }
    } catch (error) {
      this.logger.error('Failed to load settings', error);
      this.settings.set({ ...DEFAULT_SETTINGS });
    }
  }

  async updateSettings(updatedSettings: Partial<UserSettings>): Promise<void> {
    console.log('updateSettings called with:', updatedSettings);
    console.log('Current settings before update:', this.settings());

    // Update the local settings
    const newSettings = {
      ...this.settings(),
      ...updatedSettings,
    };

    console.log('New settings after merge:', newSettings);
    this.settings.set(newSettings);

    // Skip publishing for preview accounts - they cannot sign events
    const account = this.accountState.account();
    if (account?.source === 'preview') {
      this.logger.info('Skipping settings publish for preview account - cannot sign events');
      return;
    }

    // Create and publish the event
    try {
      const content = JSON.stringify(newSettings);
      console.log('Settings content to publish:', content);
      const tags = [['d', 'nostria:settings']];

      const unsignedEvent = this.nostrService.createEvent(kinds.Application, content, tags);
      const signedEvent = await this.nostrService.signEvent(unsignedEvent);

      const publishResult = await this.accountRelay.publish(signedEvent);
      this.logger.info('Settings published', publishResult);
      console.log('Settings published successfully:', publishResult);
    } catch (error) {
      this.logger.error('Failed to save settings', error);
      console.error('Failed to save settings:', error);
      throw error;
    }
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
      console.log('[Settings] Image cache disabled, existing cache preserved');
    }
  }

  async toggleReportTypeVisibility(reportType: string): Promise<void> {
    console.log('toggleReportTypeVisibility called with:', reportType);
    const currentSettings = this.settings();
    console.log('Current settings:', currentSettings);

    const settingKey =
      `hide${reportType.charAt(0).toUpperCase() + reportType.slice(1)}` as keyof UserSettings;
    const currentValue = currentSettings[settingKey] as boolean;

    console.log(`Setting key: ${settingKey}, current value: ${currentValue}`);

    const newSettings = {
      [settingKey]: !currentValue,
    } as Partial<UserSettings>;

    console.log('New settings to update:', newSettings);

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
}
