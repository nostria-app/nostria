import { Injectable, effect, inject, signal } from '@angular/core';
import { NostrService } from './nostr.service';
import { kinds } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { AccountRelayService } from './relays/account-relay';

export type PlaceholderAlgorithm = 'blurhash' | 'thumbhash' | 'both';

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

  constructor() {
    effect(async () => {
      const account = this.accountState.account();
      const initialized = this.accountState.initialized();

      if (account && initialized) {
        // Reset to defaults first to ensure clean state
        this.settings.set({ ...DEFAULT_SETTINGS });
        // Then load settings for this account
        await this.loadSettings(this.accountState.pubkey());
      } else if (!account) {
        // No account, reset to defaults
        this.settings.set({ ...DEFAULT_SETTINGS });
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
}
