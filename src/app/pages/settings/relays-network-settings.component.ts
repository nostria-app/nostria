import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';

import { LocalSettingsService, RelayDiscoveryMode } from '../../services/local-settings.service';
import { RightPanelService } from '../../services/right-panel.service';
import { SettingsService } from '../../services/settings.service';
import { SettingMaxRelaysComponent } from './sections/max-relays.component';
import { SettingRelayAuthComponent } from './sections/relay-auth.component';

@Component({
  selector: 'app-relays-network-settings',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    MatTooltipModule,
    SettingMaxRelaysComponent,
    SettingRelayAuthComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel-with-sticky-header' },
  template: `
    <div class="panel-header">
      <button mat-icon-button (click)="goBack()" matTooltip="Back" i18n-matTooltip="@@common.back">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h2 class="panel-title title-font" i18n="@@settings.sections.network">Relays &amp; Network</h2>
      <span class="panel-header-spacer"></span>
    </div>

    <div class="content-medium">
      <app-setting-max-relays />

      <div class="setting-section">
        <h2 i18n="@@settings.relay-mode.title">Relays Mode</h2>
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

      <app-setting-relay-auth />

      <div class="setting-section">
        <h2 i18n="@@settings.relays.title">Relay Sources</h2>
        <div class="link-grid">
          <mat-card appearance="outlined" class="link-card">
            <div>
              <h3 i18n="@@settings.relays.account-relays">Account Relays</h3>
              <p i18n="@@settings.relays.account-relays.description">Manage your personal relay connections</p>
            </div>
            <button mat-stroked-button type="button" (click)="openRelays('account')">Open</button>
          </mat-card>

          <mat-card appearance="outlined" class="link-card">
            <div>
              <h3 i18n="@@settings.relays.discovery">Discovery Relays</h3>
              <p i18n="@@settings.relays.discovery.description">Relays used to discover other users</p>
            </div>
            <button mat-stroked-button type="button" (click)="openRelays('discovery')">Open</button>
          </mat-card>

          <mat-card appearance="outlined" class="link-card">
            <div>
              <h3 i18n="@@settings.relays.observed">Observed Relays</h3>
              <p i18n="@@settings.relays.observed.description">Inspect relays observed from the wider network.</p>
            </div>
            <button mat-stroked-button type="button" (click)="openRelays('observed')">Open</button>
          </mat-card>

          <mat-card appearance="outlined" class="link-card">
            <div>
              <h3 i18n="@@settings.search.relays">Search Relays</h3>
              <p i18n="@@settings.search.relays.description">Configure which relays to use for search</p>
            </div>
            <button mat-stroked-button type="button" (click)="openSearchRelays()">Open</button>
          </mat-card>

          <mat-card appearance="outlined" class="link-card">
            <div>
              <h3 i18n="@@settings.media-servers.title">Media Servers</h3>
              <p i18n="@@settings.media-servers.description">Manage your upload and fallback media servers</p>
            </div>
            <button mat-stroked-button type="button" (click)="openMediaServers()">Open</button>
          </mat-card>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .setting-section {
      padding: 16px 0;
    }

    .full-width {
      width: 100%;
    }

    h2,
    h3 {
      margin-top: 0;
    }

    .setting-description {
      color: var(--mat-sys-on-surface-variant);
    }

    .link-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
    }

    .link-card {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 12px;
      padding: 16px;
    }

    .link-card p {
      margin-bottom: 0;
      color: var(--mat-sys-on-surface-variant);
    }
  `],
})
export class RelaysNetworkSettingsComponent {
  readonly localSettings = inject(LocalSettingsService);
  readonly settings = inject(SettingsService);
  private readonly rightPanel = inject(RightPanelService);
  private readonly router = inject(Router);

  goBack(): void {
    this.rightPanel.goBack();
  }

  setRelayDiscoveryMode(mode: RelayDiscoveryMode): void {
    this.localSettings.setRelayDiscoveryMode(mode);
    void this.settings.updateSettings({ relayDiscoveryMode: mode });
  }

  openRelays(tab: 'account' | 'discovery' | 'observed'): void {
    void this.router.navigate(['/relays'], { queryParams: { tab } });
  }

  openSearchRelays(): void {
    void this.router.navigate(['/settings/search']);
  }

  openMediaServers(): void {
    void this.router.navigate(['/collections/media'], { queryParams: { tab: 'servers' } });
  }
}
