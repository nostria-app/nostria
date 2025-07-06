import { Injectable, effect, inject, signal } from '@angular/core';
import { NostrService } from './nostr.service';
import { RelayService } from './relay.service';
import { kinds } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';

export interface UserSettings {
    socialSharingPreview: boolean;
    // Add more settings as needed
}

const DEFAULT_SETTINGS: UserSettings = {
    socialSharingPreview: true
};

@Injectable({
    providedIn: 'root'
})
export class SettingsService {
    private nostrService = inject(NostrService);
    private accountState = inject(AccountStateService);
    private relayService = inject(RelayService);
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
                limit: 1
            };

            const event = await this.relayService.get(filter);

            if (event && event.content) {
                try {
                    const parsedContent = JSON.parse(event.content);
                    this.settings.update(currentSettings => ({
                        ...DEFAULT_SETTINGS,
                        ...currentSettings,
                        ...parsedContent
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
        // Update the local settings
        const newSettings = {
            ...this.settings(),
            ...updatedSettings
        };

        this.settings.set(newSettings);

        // Create and publish the event
        try {
            const content = JSON.stringify(newSettings);
            const tags = [['d', 'nostria:settings']];

            const unsignedEvent = this.nostrService.createEvent(kinds.Application, content, tags);
            const signedEvent = await this.nostrService.signEvent(unsignedEvent);

            const publishResult = await this.relayService.publish(signedEvent);
            this.logger.info('Settings published', publishResult);
        } catch (error) {
            this.logger.error('Failed to save settings', error);
            throw error;
        }
    }

    async toggleSocialSharingPreview(): Promise<void> {
        const currentValue = this.settings().socialSharingPreview;
        await this.updateSettings({
            socialSharingPreview: !currentValue
        });
    }
}
