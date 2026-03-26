import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { RightPanelService } from '../../services/right-panel.service';
import { SettingDarkModeComponent } from './sections/dark-mode.component';
import { SettingFontSelectorComponent } from './sections/font-selector.component';
import { SettingLockScreenRotationComponent } from './sections/lock-screen-rotation.component';
import { SettingTextSizeComponent } from './sections/text-size.component';
import { SettingChatWidgetComponent } from './sections/chat-widget.component';

@Component({
  selector: 'app-appearance-settings',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    SettingDarkModeComponent,
    SettingFontSelectorComponent,
    SettingLockScreenRotationComponent,
    SettingTextSizeComponent,
    SettingChatWidgetComponent,
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
      <app-setting-lock-screen-rotation />
      <app-setting-chat-widget />
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
      padding: 12px 0;
    }

    .setting-description {
      color: var(--mat-sys-on-surface-variant);
    }
  `],
})
export class AppearanceSettingsComponent {
  private readonly rightPanel = inject(RightPanelService);

  goBack(): void {
    this.rightPanel.goBack();
  }
}
