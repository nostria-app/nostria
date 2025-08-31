import { Injectable, effect, inject, signal } from '@angular/core';
import { NostrService } from './nostr.service';
import { kinds } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { AccountRelayService } from './relays/account-relay';

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
      if (this.accountState.account()) {
        await this.loadSettings(this.accountState.pubkey());
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
          this.settings.update((currentSettings) => ({
            ...DEFAULT_SETTINGS,
            ...currentSettings,
            ...parsedContent,
          }));
          this.logger.info('Settings loaded successfully', this.settings());
        } catch (error) {
          this.logger.error('Failed to parse settings content', error);
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
