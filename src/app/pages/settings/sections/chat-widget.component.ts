import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { LocalSettingsService } from '../../../services/local-settings.service';

@Component({
  selector: 'app-setting-chat-widget',
  imports: [MatSlideToggleModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <div class="setting-item">
        <span>Chat Widget</span>
        <mat-slide-toggle [checked]="localSettings.settings().chatWidgetEnabled !== false" (change)="toggle()">
        </mat-slide-toggle>
      </div>
      <p class="setting-description">
        Show a floating chat widget in the bottom-right corner for quick access to messages on desktop.
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
      gap: 16px;
      padding: 12px 0;
    }

    .setting-description {
      color: var(--mat-sys-on-surface-variant);
    }
  `]
})
export class SettingChatWidgetComponent {
  readonly localSettings = inject(LocalSettingsService);

  toggle(): void {
    const current = this.localSettings.settings().chatWidgetEnabled !== false;
    this.localSettings.updateSettings({ chatWidgetEnabled: !current });
  }
}
