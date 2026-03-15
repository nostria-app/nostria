import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { RightPanelService } from '../../services/right-panel.service';
import { SettingLoggingComponent } from './sections/logging.component';
import { SettingsLinkCardComponent } from './sections/settings-link-card.component';
import { getSettingsSectionComponent } from './settings-section-components.map';

@Component({
  selector: 'app-logs-debug-settings',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, SettingLoggingComponent, SettingsLinkCardComponent],
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
  `],
})
export class LogsDebugSettingsComponent {
  private readonly rightPanel = inject(RightPanelService);

  goBack(): void {
    this.rightPanel.goBack();
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
