import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { AccountStateService } from '../../services/account-state.service';
import { NostrService } from '../../services/nostr.service';
import { UserProfileComponent } from "../user-profile/user-profile.component";
import { StorageService } from '../../services/storage.service';
import { RelayService } from '../../services/relay.service';

@Component({
  selector: 'app-logs-settings',
  standalone: true,
  imports: [
    CommonModule,
    MatTabsModule,
    MatCardModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule,
    UserProfileComponent
  ],
  templateUrl: './logs-settings.component.html',
  styleUrls: ['./logs-settings.component.scss']
})
export class LogsSettingsComponent {
  accountState = inject(AccountStateService);
  nostr = inject(NostrService);
  storage = inject(StorageService);
  relay = inject(RelayService);

  getWebUrl(relayUrl: string) {
    return relayUrl.replace('wss://', 'https://').replace('ws://', 'http://');
  }
}
