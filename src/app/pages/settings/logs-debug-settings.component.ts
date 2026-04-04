import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';

import { LocalSettingsService } from '../../services/local-settings.service';
import { RightPanelService } from '../../services/right-panel.service';
import { SettingLoggingComponent } from './sections/logging.component';
import { SettingsLinkCardComponent } from './sections/settings-link-card.component';
import { getSettingsSectionComponent } from './settings-section-components.map';

@Component({
  selector: 'app-logs-debug-settings',
  imports: [MatButtonModule, MatIconModule, MatSlideToggleModule, MatTooltipModule, SettingLoggingComponent, SettingsLinkCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel-with-sticky-header' },
  template: `
    <div class="panel-header">
      <button mat-icon-button (click)="goBack()" matTooltip="Back" i18n-matTooltip="@@common.back">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h2 class="panel-title title-font" i18n="@@settings.sections.logs-debug">Logs &amp; Debug</h2>
      <span class="panel-header-spacer"></span>
    </div>

    <div class="content-medium">
      <app-setting-logging />

      <section class="analytics-section">
        <h3 i18n="@@settings.privacy.analytics.title">Analytics</h3>
        <p class="section-description" i18n="@@settings.privacy.analytics.description">
          Analytics is strictly opt-in and applies to all accounts in this app on this device. If you enable it,
          analytics logs and diagnostics data will be uploaded to a cloud provider to help the developers improve
          quality and reliability.
        </p>
        <div class="settings-option">
          <mat-slide-toggle [checked]="localSettings.analyticsEnabled()" (change)="toggleAnalytics()">
            <span i18n="@@settings.privacy.analytics.enable">Enable optional analytics</span>
          </mat-slide-toggle>
        </div>
      </section>

      <div class="settings-link-list">
        <app-settings-link-card icon="description" i18n-title="@@settings.logs.title" title="Logs"
          i18n-description="@@settings.logs.description"
          description="Relay statistics, all relays, and cluster analysis for troubleshooting."
          (activated)="openLogs()" />

        <app-settings-link-card icon="code" i18n-title="@@settings.sections.debug" title="Debug"
          i18n-description="@@settings.debug.description"
          description="Platform simulation and developer-focused payment flow testing tools."
          (activated)="openDebug()" />
      </div>
    </div>
  `,
  styles: [`
    .settings-link-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px 0;
    }

    .analytics-section {
      padding: 16px 0;
    }

    .analytics-section h3 {
      margin: 0 0 8px;
    }

    .section-description {
      margin: 0 0 12px;
      color: var(--mat-sys-on-surface-variant);
    }
  `],
})
export class LogsDebugSettingsComponent {
  readonly localSettings = inject(LocalSettingsService);
  private readonly rightPanel = inject(RightPanelService);

  goBack(): void {
    this.rightPanel.goBack();
  }

  toggleAnalytics(): void {
    this.localSettings.setAnalyticsEnabled(!this.localSettings.analyticsEnabled());
  }

  async openLogs(): Promise<void> {
    const componentLoader = getSettingsSectionComponent('logs');
    if (!componentLoader) return;
    const component = await componentLoader();
    this.rightPanel.open({
      component,
      title: $localize`:@@settings.logs.title:Logs`,
    });
  }

  async openDebug(): Promise<void> {
    const componentLoader = getSettingsSectionComponent('debug');
    if (!componentLoader) return;
    const component = await componentLoader();
    this.rightPanel.open({
      component,
      title: $localize`:@@settings.sections.debug:Debug`,
    });
  }
}
