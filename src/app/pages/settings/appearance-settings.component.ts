import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';

import { LocalSettingsService } from '../../services/local-settings.service';
import { RightPanelService } from '../../services/right-panel.service';
import { SettingDarkModeComponent } from './sections/dark-mode.component';
import { SettingFontSelectorComponent } from './sections/font-selector.component';
import { SettingTextSizeComponent } from './sections/text-size.component';

@Component({
  selector: 'app-appearance-settings',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
    MatTooltipModule,
    SettingDarkModeComponent,
    SettingFontSelectorComponent,
    SettingTextSizeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel-with-sticky-header' },
  template: `
    <div class="panel-header">
      <button mat-icon-button (click)="goBack()" matTooltip="Back" i18n-matTooltip="@@common.back">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h2 class="panel-title title-font" i18n="@@settings.sections.appearance">Appearance</h2>
      <span class="panel-header-spacer"></span>
    </div>

    <div class="content-medium">
      <app-setting-dark-mode />
      <app-setting-text-size />
      <app-setting-font-selector />

      <div class="setting-section">
        <div class="setting-item">
          <span i18n="@@settings.display.lock-screen-rotation">Lock Screen Rotation</span>
          <mat-slide-toggle [checked]="localSettings.lockScreenRotation()" (change)="toggleLockScreenRotation()">
          </mat-slide-toggle>
        </div>
        <p class="setting-description" i18n="@@settings.display.lock-screen-rotation.description">
          Keep the app in portrait mode so it does not rotate when your device rotates. Applies only on devices and
          browsers that support orientation lock.
        </p>
      </div>
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
      gap: 16px;
    }

    .setting-description {
      color: var(--mat-sys-on-surface-variant);
    }
  `],
})
export class AppearanceSettingsComponent {
  readonly localSettings = inject(LocalSettingsService);
  private readonly rightPanel = inject(RightPanelService);

  goBack(): void {
    this.rightPanel.goBack();
  }

  toggleLockScreenRotation(): void {
    this.localSettings.setLockScreenRotation(!this.localSettings.lockScreenRotation());
  }
}
