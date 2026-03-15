import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';

import { LocalSettingsService } from '../../services/local-settings.service';
import { RightPanelService } from '../../services/right-panel.service';
import { SettingHomeDestinationComponent } from './sections/home-destination.component';
import { SettingMenuEditorComponent } from './sections/menu-editor.component';
import { SettingRightSidebarComponent } from './sections/right-sidebar.component';

@Component({
  selector: 'app-menu-navigation-settings',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
    MatTooltipModule,
    SettingHomeDestinationComponent,
    SettingMenuEditorComponent,
    SettingRightSidebarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel-with-sticky-header' },
  template: `
    <div class="panel-header">
      <button mat-icon-button (click)="goBack()" matTooltip="Back" i18n-matTooltip="@@common.back">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h2 class="panel-title title-font" i18n="@@settings.sections.navigation">Menu &amp; Navigation</h2>
      <span class="panel-header-spacer"></span>
    </div>

    <div class="content-medium">
      <div class="setting-section">
        <h2 i18n="@@settings.navigation.title">Navigation</h2>

        <div class="setting-item">
          <span i18n="@@settings.navigation.start-last-page">Start on Last Page</span>
          <mat-slide-toggle [checked]="localSettings.startOnLastRoute()" (change)="toggleStartOnLastRoute()">
          </mat-slide-toggle>
        </div>
        <p class="setting-description" i18n="@@settings.navigation.start-last-page.description">
          When opening the app, restore the last page you were viewing.
        </p>
      </div>

      <app-setting-right-sidebar />
      <app-setting-home-destination />
      <app-setting-menu-editor />
    </div>
  `,
  styles: [`
    .setting-section {
      padding: 16px 0;
    }

    h2 {
      margin-top: 0;
    }

    .setting-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 8px;
      padding: 12px 0;
    }

    .setting-description {
      color: var(--mat-sys-on-surface-variant);
      margin-top: 0;
      margin-bottom: 16px;
    }
  `],
})
export class MenuNavigationSettingsComponent {
  readonly localSettings = inject(LocalSettingsService);
  private readonly rightPanel = inject(RightPanelService);

  goBack(): void {
    this.rightPanel.goBack();
  }

  toggleStartOnLastRoute(): void {
    this.localSettings.setStartOnLastRoute(!this.localSettings.startOnLastRoute());
  }
}
