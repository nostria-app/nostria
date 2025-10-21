import { Component, inject, computed, ViewChild, TemplateRef } from '@angular/core';

import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AccountStateService } from '../../../services/account-state.service';
import { NostrService } from '../../../services/nostr.service';
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';
import { SettingsService } from '../../../services/settings.service';
import { ImageCacheService } from '../../../services/image-cache.service';
import { InfoTooltipComponent } from '../../../components/info-tooltip/info-tooltip.component';
import { ReportingService } from '../../../services/reporting.service';

@Component({
  selector: 'app-privacy-settings',
  standalone: true,
  imports: [
    MatTabsModule,
    MatCardModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule,
    MatCheckboxModule,
    FormsModule,
    UserProfileComponent,
    InfoTooltipComponent,
  ],
  templateUrl: './privacy-settings.component.html',
  styleUrls: ['./privacy-settings.component.scss'],
})
export class PrivacySettingsComponent {
  accountState = inject(AccountStateService);
  nostrService = inject(NostrService);
  settingsService = inject(SettingsService);
  imageCacheService = inject(ImageCacheService);
  reportingService = inject(ReportingService);
  router = inject(Router);

  // NIP-56 report types
  reportTypes = [
    { key: 'nudity', label: 'Nudity/Adult Content', icon: 'explicit' },
    { key: 'malware', label: 'Malware/Security Threat', icon: 'security' },
    { key: 'profanity', label: 'Hateful Speech', icon: 'sentiment_very_dissatisfied' },
    { key: 'illegal', label: 'Illegal Content', icon: 'gavel' },
    { key: 'spam', label: 'Spam', icon: 'report' },
    { key: 'impersonation', label: 'Impersonation', icon: 'person_off' },
    { key: 'other', label: 'Other', icon: 'flag' },
  ];

  // Template references for tooltip content
  @ViewChild('imageCacheInfoContent')
  imageCacheInfoContent!: TemplateRef<unknown>;
  @ViewChild('socialSharingInfoContent')
  socialSharingInfoContent!: TemplateRef<unknown>;

  // Compute muted lists using getTags utility function
  mutedAccounts = computed(() => {
    const muteList = this.accountState.muteList();
    if (!muteList) return [];
    return this.nostrService.getTags(muteList, 'p');
  });

  mutedTags = computed(() => {
    const muteList = this.accountState.muteList();
    if (!muteList) return [];
    return this.nostrService.getTags(muteList, 't');
  });

  mutedWords = computed(() => {
    const muteList = this.accountState.muteList();
    if (!muteList) return [];
    return this.nostrService.getTags(muteList, 'word');
  });

  mutedThreads = computed(() => {
    const muteList = this.accountState.muteList();
    if (!muteList) return [];
    return this.nostrService.getTags(muteList, 'e');
  });

  async removeMutedItem(type: string, value: string): Promise<void> {
    try {
      switch (type) {
        case 'account':
          // Use the reporting service to unblock the user
          await this.reportingService.unblockUser(value);
          console.log(`Successfully removed user from mute list: ${value}`);
          break;
        case 'word':
          // Remove word from mute list
          await this.reportingService.removeFromMuteList({ type: 'word', value });
          console.log(`Successfully removed word from mute list: ${value}`);
          break;
        case 'tag':
          // Remove tag from mute list
          await this.reportingService.removeFromMuteList({ type: 't', value });
          console.log(`Successfully removed tag from mute list: ${value}`);
          break;
        case 'thread':
          // Remove thread from mute list
          await this.reportingService.removeFromMuteList({ type: 'e', value });
          console.log(`Successfully removed thread from mute list: ${value}`);
          break;
        default:
          console.warn(`Unknown mute item type: ${type}`);
      }
    } catch (error) {
      console.error(`Failed to remove ${type} from mute list:`, error);
    }
  }

  async toggleSocialSharingPreview(): Promise<void> {
    try {
      await this.settingsService.toggleSocialSharingPreview();
    } catch (error) {
      console.error('Failed to toggle social sharing preview setting', error);
    }
  }

  async toggleImageCache(): Promise<void> {
    try {
      await this.settingsService.toggleImageCache();
    } catch (error) {
      console.error('Failed to toggle image cache setting', error);
    }
  }

  async clearImageCache(): Promise<void> {
    try {
      await this.imageCacheService.clearAllCache();
      console.log('Image cache cleared successfully');
    } catch (error) {
      console.error('Failed to clear image cache', error);
    }
  }

  async toggleReportTypeVisibility(reportType: string): Promise<void> {
    console.log('toggleReportTypeVisibility called with:', reportType);
    console.log('Current settings before toggle:', this.settingsService.settings());
    try {
      await this.settingsService.toggleReportTypeVisibility(reportType);
      console.log('Settings after toggle:', this.settingsService.settings());
    } catch (error) {
      console.error('Failed to toggle report type visibility setting', error);
    }
  }

  isReportTypeHidden(reportType: string): boolean {
    const settings = this.settingsService.settings();
    switch (reportType) {
      case 'nudity':
        return settings.hideNudity ?? true;
      case 'malware':
        return settings.hideMalware ?? true;
      case 'profanity':
        return settings.hideProfanity ?? true;
      case 'illegal':
        return settings.hideIllegal ?? true;
      case 'spam':
        return settings.hideSpam ?? true;
      case 'impersonation':
        return settings.hideImpersonation ?? true;
      case 'other':
        return settings.hideOther ?? true;
      default:
        return true;
    }
  }

  navigateToDeleteEventPage(): void {
    this.router.navigate(['/delete-event']);
  }

  navigateToDeleteAccountPage(): void {
    this.router.navigate(['/delete-account']);
  }
}
