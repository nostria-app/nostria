import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatRadioModule } from '@angular/material/radio';
import { LocalSettingsService, HomeDestination } from '../../../services/local-settings.service';

@Component({
  selector: 'app-setting-home-destination',
  imports: [MatRadioModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <h2 i18n="@@settings.home-destination.title">Home Button Destination</h2>
      <p class="setting-description" i18n="@@settings.home-destination.description">
        Choose where the Nostria logo button should navigate to.
      </p>

      <mat-radio-group 
        [value]="localSettings.homeDestination()" 
        (change)="setHomeDestination($event.value)"
        class="radio-group">
        <mat-radio-button value="feeds" class="radio-option">
          <div class="option-content">
            <span class="option-label" i18n="@@settings.home-destination.feeds">Feeds</span>
            <span class="option-description" i18n="@@settings.home-destination.feeds.description">Navigate to the Feeds page</span>
          </div>
        </mat-radio-button>
        <mat-radio-button value="home" class="radio-option">
          <div class="option-content">
            <span class="option-label" i18n="@@settings.home-destination.home">Home</span>
            <span class="option-description" i18n="@@settings.home-destination.home.description">Navigate to the Home page</span>
          </div>
        </mat-radio-button>
        <mat-radio-button value="first-menu-item" class="radio-option">
          <div class="option-content">
            <span class="option-label" i18n="@@settings.home-destination.first-menu-item">First Menu Item</span>
            <span class="option-description" i18n="@@settings.home-destination.first-menu-item.description">Navigate to the first item in your customized menu</span>
          </div>
        </mat-radio-button>
      </mat-radio-group>
    </div>
  `,
  styles: [`
    .setting-section {
      padding: 16px 0;
    }

    h2 {
      margin-top: 0;
    }

    .setting-description {
      color: var(--mat-sys-on-surface-variant);
      margin-top: 0;
      margin-bottom: 16px;
    }

    .radio-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .radio-option {
      padding: 12px;
      border-radius: var(--mat-sys-corner-small);
      background-color: var(--mat-sys-surface-container);
      
      &:hover {
        background-color: var(--mat-sys-surface-container-high);
      }
    }

    .option-content {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .option-label {
      font-size: 1rem;
    }

    .option-description {
      font-size: 0.875rem;
      color: var(--mat-sys-on-surface-variant);
    }
  `]
})
export class SettingHomeDestinationComponent {
  readonly localSettings = inject(LocalSettingsService);

  setHomeDestination(value: HomeDestination): void {
    this.localSettings.setHomeDestination(value);
  }
}
