import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';

import { RightPanelService } from '../../services/right-panel.service';
import { SettingLoggingComponent } from './sections/logging.component';

@Component({
  selector: 'app-logs-debug-settings',
  imports: [MatButtonModule, MatCardModule, MatIconModule, MatTooltipModule, SettingLoggingComponent],
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

      <div class="link-grid">
        <mat-card appearance="outlined" class="link-card">
          <div>
            <h2 i18n="@@settings.logs.title">Logs</h2>
            <p i18n="@@settings.logs.description">Relay statistics, all relays, and cluster analysis for troubleshooting.</p>
          </div>
          <button mat-stroked-button type="button" (click)="openLogs()">Open Logs</button>
        </mat-card>

        <mat-card appearance="outlined" class="link-card">
          <div>
            <h2 i18n="@@settings.sections.debug">Debug</h2>
            <p i18n="@@settings.debug.description">Platform simulation and developer-focused payment flow testing tools.</p>
          </div>
          <button mat-stroked-button type="button" (click)="openDebug()">Open Debug Tools</button>
        </mat-card>
      </div>
    </div>
  `,
  styles: [`
    .link-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 12px;
      padding: 16px 0;
    }

    .link-card {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 12px;
      padding: 16px;
    }

    .link-card h2 {
      margin-top: 0;
    }

    .link-card p {
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 0;
    }
  `],
})
export class LogsDebugSettingsComponent {
  private readonly rightPanel = inject(RightPanelService);
  private readonly router = inject(Router);

  goBack(): void {
    this.rightPanel.goBack();
  }

  openLogs(): void {
    void this.router.navigate(['/settings/logs']);
  }

  openDebug(): void {
    void this.router.navigate(['/settings/debug']);
  }
}
