import { Component, inject, computed } from '@angular/core';

import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';
import { AccountStateService } from '../../services/account-state.service';
import { NostrService } from '../../services/nostr.service';
import { UserProfileComponent } from "../user-profile/user-profile.component";
import { SettingsService } from '../../services/settings.service';

@Component({
  selector: 'app-privacy-settings',
  standalone: true,  imports: [
    MatTabsModule,
    MatCardModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule,
    MatCheckboxModule,
    FormsModule,
    UserProfileComponent
],
  templateUrl: './privacy-settings.component.html',
  styleUrls: ['./privacy-settings.component.scss']
})
export class PrivacySettingsComponent {
  accountState = inject(AccountStateService);
  nostrService = inject(NostrService);
  settingsService = inject(SettingsService);

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
  
  removeMutedItem(type: string, value: string): void {
    // This would need to be implemented to update the mute list
    console.log(`Remove ${type}: ${value}`);
    // Would create a new mute event with the item removed and update via accountState
  }

  async toggleSocialSharingPreview(): Promise<void> {
    try {
      await this.settingsService.toggleSocialSharingPreview();
    } catch (error) {
      console.error('Failed to toggle social sharing preview setting', error);
    }
  }
}
