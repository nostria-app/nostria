import { Component, inject, computed, ViewChild, TemplateRef, OnInit, OnDestroy } from '@angular/core';

import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AccountStateService } from '../../../services/account-state.service';
import { NostrService } from '../../../services/nostr.service';
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';
import { SettingsService } from '../../../services/settings.service';
import { ImageCacheService } from '../../../services/image-cache.service';
import { InfoTooltipComponent } from '../../../components/info-tooltip/info-tooltip.component';
import { ReportingService } from '../../../services/reporting.service';
import { LocalSettingsService } from '../../../services/local-settings.service';
import { AccountLocalStateService } from '../../../services/account-local-state.service';
import { PanelActionsService } from '../../../services/panel-actions.service';
import { RightPanelService } from '../../../services/right-panel.service';
import { LoggerService } from '../../../services/logger.service';

@Component({
  selector: 'app-privacy-settings',
  imports: [
    MatTabsModule,
    MatCardModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
    FormsModule,
    UserProfileComponent,
    InfoTooltipComponent,
  ],
  templateUrl: './privacy-settings.component.html',
  styleUrls: ['./privacy-settings.component.scss'],
  host: { class: 'panel-with-sticky-header' },
})
export class PrivacySettingsComponent implements OnInit, OnDestroy {
  accountState = inject(AccountStateService);
  nostrService = inject(NostrService);
  settingsService = inject(SettingsService);
  imageCacheService = inject(ImageCacheService);
  reportingService = inject(ReportingService);
  localSettingsService = inject(LocalSettingsService);
  accountLocalState = inject(AccountLocalStateService);
  router = inject(Router);
  private panelActions = inject(PanelActionsService);
  private rightPanel = inject(RightPanelService);
  private logger = inject(LoggerService);

  ngOnInit(): void {
    // Only set page title if not in right panel (right panel has its own title)
    if (!this.rightPanel.hasContent()) {
      this.panelActions.setPageTitle($localize`:@@settings.privacy.title:Privacy & Safety`);
    }
  }

  ngOnDestroy(): void {
    if (!this.rightPanel.hasContent()) {
      this.panelActions.clearPageTitle();
    }
  }

  goBack(): void {
    this.rightPanel.goBack();
  }

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

  // Properties for adding new muted items
  newMutedWord = '';
  newMutedTag = '';

  // Template references for tooltip content
  @ViewChild('imageCacheInfoContent')
  imageCacheInfoContent!: TemplateRef<unknown>;
  @ViewChild('socialSharingInfoContent')
  socialSharingInfoContent!: TemplateRef<unknown>;
  @ViewChild('trackingRemovalInfoContent')
  trackingRemovalInfoContent!: TemplateRef<unknown>;

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

  // Trusted media authors - users whose media is always revealed
  trustedMediaAuthors = computed(() => {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return [];
    return this.accountLocalState.getTrustedMediaAuthors(pubkey, true);
  });

  removeTrustedMediaAuthor(authorPubkey: string): void {
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.removeTrustedMediaAuthor(pubkey, authorPubkey);
    }
  }

  async addMutedWord(): Promise<void> {
    const word = this.newMutedWord.trim().toLowerCase();
    if (!word) return;

    try {
      await this.reportingService.addWordToMuteListAndPublish(word);
      this.newMutedWord = '';
    } catch (error) {
      this.logger.error('Failed to add word to mute list:', error);
    }
  }

  async addMutedTag(): Promise<void> {
    const tag = this.newMutedTag.trim().toLowerCase().replace(/^#/, '');
    if (!tag) return;

    try {
      await this.reportingService.addTagToMuteListAndPublish(tag);
      this.newMutedTag = '';
    } catch (error) {
      this.logger.error('Failed to add tag to mute list:', error);
    }
  }

  async removeMutedItem(type: string, value: string): Promise<void> {
    try {
      switch (type) {
        case 'account':
          // Use the reporting service to unblock the user
          await this.reportingService.unblockUser(value);
          break;
        case 'word':
          // Remove word from mute list and publish
          await this.reportingService.removeFromMuteListAndPublish({ type: 'word', value });
          break;
        case 'tag':
          // Remove tag from mute list and publish
          await this.reportingService.removeFromMuteListAndPublish({ type: 't', value });
          break;
        case 'thread':
          // Remove thread from mute list and publish
          await this.reportingService.removeFromMuteListAndPublish({ type: 'e', value });
          break;
        default:
          this.logger.warn(`Unknown mute item type: ${type}`);
      }
    } catch (error) {
      this.logger.error(`Failed to remove ${type} from mute list:`, error);
    }
  }

  async toggleSocialSharingPreview(): Promise<void> {
    try {
      await this.settingsService.toggleSocialSharingPreview();
    } catch (error) {
      this.logger.error('Failed to toggle social sharing preview setting', error);
    }
  }

  toggleRemoveTrackingParameters(): void {
    this.localSettingsService.toggleRemoveTrackingParameters();
  }

  async toggleImageCache(): Promise<void> {
    try {
      await this.settingsService.toggleImageCache();
    } catch (error) {
      this.logger.error('Failed to toggle image cache setting', error);
    }
  }

  async toggleGoogleFavicon(): Promise<void> {
    try {
      await this.settingsService.toggleGoogleFavicon();
    } catch (error) {
      this.logger.error('Failed to toggle Google favicon setting', error);
    }
  }

  async clearImageCache(): Promise<void> {
    try {
      await this.imageCacheService.clearAllCache();
    } catch (error) {
      this.logger.error('Failed to clear image cache', error);
    }
  }

  async toggleReportTypeVisibility(reportType: string): Promise<void> {
    try {
      await this.settingsService.toggleReportTypeVisibility(reportType);
    } catch (error) {
      this.logger.error('Failed to toggle report type visibility setting', error);
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
