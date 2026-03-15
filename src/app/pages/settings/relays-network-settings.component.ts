import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { RightPanelService } from '../../services/right-panel.service';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { SettingMaxRelaysComponent } from './sections/max-relays.component';
import { SettingRelayAuthComponent } from './sections/relay-auth.component';
import { SettingRelayModeComponent } from './sections/relay-mode.component';
import { SettingsLinkCardComponent } from './sections/settings-link-card.component';
import { getSettingsSectionComponent } from './settings-section-components.map';

@Component({
  selector: 'app-relays-network-settings',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    SettingMaxRelaysComponent,
    SettingRelayAuthComponent,
    SettingRelayModeComponent,
    SettingsLinkCardComponent,
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
      <div class="setting-section">
        <h2 i18n="@@settings.relays.title">Relay Sources</h2>
        <div class="settings-link-list">
          <app-settings-link-card icon="hub" i18n-title="@@settings.relays.account-relays" title="Account Relays"
            i18n-description="@@settings.relays.account-relays.description"
            description="Manage your personal relay connections" (activated)="openRelays('account')" />

          <app-settings-link-card icon="travel_explore" i18n-title="@@settings.relays.discovery"
            title="Discovery Relays" i18n-description="@@settings.relays.discovery.description"
            description="Relays used to discover other users" (activated)="openRelays('discovery')" />

          <app-settings-link-card icon="search" i18n-title="@@settings.search.relays" title="Search Relays"
            i18n-description="@@settings.search.relays.description"
            description="Configure which relays to use for search" (activated)="openSearchRelays()" />

          <app-settings-link-card icon="cloud_upload" i18n-title="@@settings.media-servers.title"
            title="Media Servers" i18n-description="@@settings.media-servers.description"
            description="Manage your upload and fallback media servers" (activated)="openMediaServers()" />
        </div>
      </div>

      <app-setting-max-relays />
      <app-setting-relay-mode />
      <app-setting-relay-auth />

      <app-settings-link-card icon="visibility" i18n-title="@@settings.relays.observed" title="Observed Relays"
        i18n-description="@@settings.relays.observed.description"
        description="Inspect relays observed from the wider network." (activated)="openRelays('observed')" />
    </div>
  `,
  styles: [`
    .setting-section {
      padding: 16px 0;
    }

    h2 {
      margin-top: 0;
    }

    .settings-link-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
  `],
})
export class RelaysNetworkSettingsComponent {
  private readonly rightPanel = inject(RightPanelService);
  private readonly customDialog = inject(CustomDialogService);

  goBack(): void {
    this.rightPanel.goBack();
  }

  async openRelays(tab: 'account' | 'discovery' | 'observed'): Promise<void> {
    const componentLoader = getSettingsSectionComponent('relays');
    if (!componentLoader) return;
    const component = await componentLoader();

    const titles: Record<string, string> = {
      account: $localize`:@@settings.relays.account-relays:Account Relays`,
      discovery: $localize`:@@settings.relays.discovery-relays:Discovery Relays`,
      observed: $localize`:@@settings.relays.observed-relays:Observed Relays`,
    };

    this.rightPanel.open({
      component,
      title: titles[tab],
      inputs: { tab },
    });
  }

  async openSearchRelays(): Promise<void> {
    const componentLoader = getSettingsSectionComponent('search');
    if (!componentLoader) return;
    const component = await componentLoader();
    this.rightPanel.open({
      component,
      title: $localize`:@@settings.search.relays:Search Relays`,
    });
  }

  async openMediaServers(): Promise<void> {
    const { MediaServersSettingsDialogComponent } = await import('../media/media-servers-settings-dialog/media-servers-settings-dialog.component');
    this.customDialog.open(MediaServersSettingsDialogComponent, {
      title: $localize`:@@settings.media-servers.title:Media Servers`,
      width: '550px',
      maxWidth: '95vw',
    });
  }
}
