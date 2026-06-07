import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

import { SettingsService } from '../../../services/settings.service';

@Component({
  selector: 'app-setting-sounds',
  imports: [MatSlideToggleModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <h2 i18n="@@settings.sounds.title">Sounds</h2>
      <p class="setting-description" i18n="@@settings.sounds.description">
        Choose which in-app sounds Nostria should play.
      </p>

      <div class="setting-item">
        <span i18n="@@settings.sounds.ui-interaction">UI Interaction Sounds</span>
        <mat-slide-toggle [checked]="settings.settings().uiInteractionSoundsEnabled !== false"
          (change)="toggleUiInteractionSounds()">
        </mat-slide-toggle>
      </div>
      <p class="setting-description" i18n="@@settings.sounds.ui-interaction.description">
        Play subtle feedback sounds for likes and other direct UI actions.
      </p>

      <div class="setting-item">
        <span i18n="@@settings.sounds.message-notifications">Message Notification Sounds</span>
        <mat-slide-toggle [checked]="settings.settings().messageNotificationSoundsEnabled !== false"
          (change)="toggleMessageNotificationSounds()">
        </mat-slide-toggle>
      </div>
      <p class="setting-description" i18n="@@settings.sounds.message-notifications.description">
        Play a short sound when a new unread direct message arrives.
      </p>

      <div class="setting-item">
        <span i18n="@@settings.sounds.zaps">Zap Sounds</span>
        <mat-slide-toggle [checked]="settings.settings().zapSoundsEnabled !== false" (change)="toggleZapSounds()">
        </mat-slide-toggle>
      </div>
      <p class="setting-description" i18n="@@settings.sounds.zaps.description">
        Play celebratory sound effects when zaps come in.
      </p>
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
export class SettingSoundsComponent {
  readonly settings = inject(SettingsService);

  toggleUiInteractionSounds(): void {
    const currentValue = this.settings.settings().uiInteractionSoundsEnabled !== false;
    void this.settings.updateSettings({ uiInteractionSoundsEnabled: !currentValue });
  }

  toggleMessageNotificationSounds(): void {
    const currentValue = this.settings.settings().messageNotificationSoundsEnabled !== false;
    void this.settings.updateSettings({ messageNotificationSoundsEnabled: !currentValue });
  }

  toggleZapSounds(): void {
    const currentValue = this.settings.settings().zapSoundsEnabled !== false;
    void this.settings.updateSettings({ zapSoundsEnabled: !currentValue });
  }
}
