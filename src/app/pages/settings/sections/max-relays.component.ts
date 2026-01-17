import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatSliderModule } from '@angular/material/slider';
import { LocalSettingsService } from '../../../services/local-settings.service';

@Component({
  selector: 'app-setting-max-relays',
  imports: [MatSliderModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <h2 i18n="@@settings.max-relays.title">Max relays per user</h2>
      <p i18n="@@settings.max-relays.description">Number of relays to use per user</p>

      <div class="setting-item">
        <span>{{ localSettings.maxRelaysPerUser() }} <ng-container i18n="@@settings.max-relays.unit">relays</ng-container></span>
        <mat-slider min="1" max="14" step="1" discrete>
          <input matSliderThumb [value]="localSettings.maxRelaysPerUser()"
            (valueChange)="setMaxRelaysPerUser($event)" aria-label="Max relays per user" />
        </mat-slider>
      </div>
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
      margin-bottom: 16px;
      padding: 12px 0;
    }
  `]
})
export class SettingMaxRelaysComponent {
  readonly localSettings = inject(LocalSettingsService);

  setMaxRelaysPerUser(value: number): void {
    this.localSettings.setMaxRelaysPerUser(value);
  }
}
