import { Component, inject, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { AccountStateService } from '../../services/account-state.service';
import { NostrService } from '../../services/nostr.service';
import { InfoRecord, StorageService } from '../../services/storage.service';
import { RelayService } from '../../services/relay.service';
import { ApplicationService } from '../../services/application.service';
import { LoggerService } from '../../services/logger.service';

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
  ],
  templateUrl: './logs-settings.component.html',
  styleUrls: ['./logs-settings.component.scss']
})
export class LogsSettingsComponent {
  accountState = inject(AccountStateService);
  nostr = inject(NostrService);
  storage = inject(StorageService);
  relay = inject(RelayService);
  app = inject(ApplicationService);
  logger = inject(LoggerService);

  disabledRelays = signal<any>([]);

  constructor() {
    effect(async () => {
      if (this.app.authenticated()) {
        const relaysInfo = await this.storage.getInfoByType('relay');
        const disabledRelays = relaysInfo.filter((relay: any) => relay.disabled);
        this.disabledRelays.set(disabledRelays);
        this.logger.info('Disabled relays:', disabledRelays);
      }
    });
  }

  getWebUrl(relayUrl: string) {
    return relayUrl.replace('wss://', 'https://').replace('ws://', 'http://');
  }

  async removeDisabledRelay(relay: InfoRecord) {
    relay['disabled'] = false;
    relay['suspendedCount'] = 0;
    await this.storage.updateInfo(relay);
    this.disabledRelays.update((relays) => relays.filter((r: InfoRecord) => r.key !== relay.key));
  }
}
