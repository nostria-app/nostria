import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { LocalSettingsService } from '../../../services/local-settings.service';

@Component({
  selector: 'app-setting-relay-auth',
  imports: [MatSlideToggleModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <h2 i18n="@@settings.auto-relay-auth.title">Relay Authentication</h2>

      <div class="setting-item">
        <span i18n="@@settings.auto-relay-auth.toggle">Automatic Relay Authentication</span>
        <mat-slide-toggle [checked]="localSettings.autoRelayAuth()" (change)="toggleAutoRelayAuth()">
        </mat-slide-toggle>
      </div>
      <p class="setting-description" i18n="@@settings.auto-relay-auth.description">Automatically authenticate with relays that require authentication. When disabled, relays that require authentication will not be used.</p>
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
      margin-bottom: 8px;
      padding: 12px 0;
    }
    .setting-description {
      color: var(--mat-sys-on-surface-variant);
      margin-top: 0;
    }
  `]
})
export class SettingRelayAuthComponent {
  readonly localSettings = inject(LocalSettingsService);

  toggleAutoRelayAuth(): void {
    this.localSettings.setAutoRelayAuth(!this.localSettings.autoRelayAuth());
  }
}
