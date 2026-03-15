import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { LocalSettingsService, RelayDiscoveryMode } from '../../../services/local-settings.service';
import { SettingsService } from '../../../services/settings.service';

@Component({
  selector: 'app-setting-relay-mode',
  imports: [MatFormFieldModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <div class="setting-item">
        <span i18n="@@settings.relay-mode.title">Relays Mode</span>
      </div>
      <p class="setting-description" i18n="@@settings.relay-mode.description">
        Choose how relays are selected when querying events for other users.
      </p>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label i18n="@@settings.relay-mode.label">Relays Mode</mat-label>
        <mat-select [value]="settings.settings().relayDiscoveryMode ?? 'outbox'" (selectionChange)="setRelayDiscoveryMode($event.value)">
          <mat-option value="outbox" i18n="@@settings.relay-mode.outbox">Outbox</mat-option>
          <mat-option value="hybrid" i18n="@@settings.relay-mode.hybrid">Hybrid</mat-option>
        </mat-select>
      </mat-form-field>

      <p class="setting-description">
        @switch (settings.settings().relayDiscoveryMode ?? 'outbox') {
          @case ('hybrid') {
            <ng-container i18n="@@settings.relay-mode.hybrid.description">Hybrid combines discovered user relays with your current account relays for improved event discovery.</ng-container>
          }
          @default {
            <ng-container i18n="@@settings.relay-mode.outbox.description">Outbox queries only the relays discovered from the target user (kind 10002 or kind 3).</ng-container>
          }
        }
      </p>
    </div>
  `,
  styles: [`
    .setting-section {
      padding: 16px 0;
    }

    .setting-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .full-width {
      width: 100%;
    }

    .setting-description {
      color: var(--mat-sys-on-surface-variant);
      margin-top: 0;
      margin-bottom: 16px;
    }
  `]
})
export class SettingRelayModeComponent {
  readonly localSettings = inject(LocalSettingsService);
  readonly settings = inject(SettingsService);

  setRelayDiscoveryMode(mode: RelayDiscoveryMode): void {
    this.localSettings.setRelayDiscoveryMode(mode);
    void this.settings.updateSettings({ relayDiscoveryMode: mode });
  }
}
