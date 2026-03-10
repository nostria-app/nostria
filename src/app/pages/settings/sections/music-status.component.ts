import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { SettingsService } from '../../../services/settings.service';

@Component({
  selector: 'app-setting-music-status',
  imports: [MatSlideToggleModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <div class="setting-item">
        <span i18n="@@settings.music-status.toggle">Share Music Status (NIP-38)</span>
        <mat-slide-toggle [checked]="settings.settings().publishMusicStatus !== false" (change)="toggle()">
        </mat-slide-toggle>
      </div>
      <p class="setting-description" i18n="@@settings.music-status.description">
        When enabled, your currently playing song is shared as a user status so others can see what you're listening to.
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
    }
    .setting-description {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.85em;
      margin-top: 8px;
    }
  `]
})
export class SettingMusicStatusComponent {
  readonly settings = inject(SettingsService);

  toggle(): void {
    const currentValue = this.settings.settings().publishMusicStatus !== false;
    this.settings.updateSettings({ publishMusicStatus: !currentValue });
  }
}
