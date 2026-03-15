import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { LocalSettingsService } from '../../../services/local-settings.service';

@Component({
  selector: 'app-setting-lock-screen-rotation',
  imports: [MatSlideToggleModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
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
export class SettingLockScreenRotationComponent {
  readonly localSettings = inject(LocalSettingsService);

  toggleLockScreenRotation(): void {
    this.localSettings.setLockScreenRotation(!this.localSettings.lockScreenRotation());
  }
}
