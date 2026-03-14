import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';

import { FeatureLevel } from '../../services/logger.service';
import { ApplicationService } from '../../services/application.service';
import { ApplicationStateService } from '../../services/application-state.service';
import { AccountStateService } from '../../services/account-state.service';
import { RightPanelService } from '../../services/right-panel.service';
import { SettingCalendarComponent } from './sections/calendar.component';
import { SettingLanguageComponent } from './sections/language.component';

@Component({
  selector: 'app-general-preferences-settings',
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    MatTooltipModule,
    SettingCalendarComponent,
    SettingLanguageComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel-with-sticky-header' },
  template: `
    <div class="panel-header">
      <button mat-icon-button (click)="goBack()" matTooltip="Back" i18n-matTooltip="@@common.back">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h2 class="panel-title title-font" i18n="@@settings.sections.general">General</h2>
      <span class="panel-header-spacer"></span>
    </div>

    <div class="content-medium">
      <app-setting-language />
      <app-setting-calendar />

      @if (accountState.hasActiveSubscription()) {
        <div class="setting-section">
          <h2 i18n="@@settings.release-channel">
            Release Channel <mat-icon class="minor-icon">diamond</mat-icon>
          </h2>
          <p i18n="@@settings.release-channel.description">
            Get early access to new features (Premium)
          </p>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label i18n="@@settings.feature-level">Feature Level</mat-label>
            <mat-select [ngModel]="app.featureLevel()" (selectionChange)="setFeatureLevel($event.value)">
              <mat-option value="stable" i18n="@@settings.feature-level.stable">Stable</mat-option>
              <mat-option value="beta" i18n="@@settings.feature-level.beta">Beta</mat-option>
              <mat-option value="preview" i18n="@@settings.feature-level.preview">Preview</mat-option>
            </mat-select>
          </mat-form-field>
        </div>
      }
    </div>
  `,
  styles: [`
    .setting-section {
      padding: 16px 0;
    }

    .full-width {
      width: 100%;
    }

    h2 {
      margin-top: 0;
    }

    .minor-icon {
      vertical-align: middle;
      font-size: 1rem;
      width: 1rem;
      height: 1rem;
    }
  `],
})
export class GeneralPreferencesSettingsComponent {
  readonly app = inject(ApplicationService);
  readonly accountState = inject(AccountStateService);
  private readonly appState = inject(ApplicationStateService);
  private readonly rightPanel = inject(RightPanelService);

  goBack(): void {
    this.rightPanel.goBack();
  }

  setFeatureLevel(level: FeatureLevel): void {
    if (!this.app.isBrowser()) {
      return;
    }

    this.app.featureLevel.set(level);
    localStorage.setItem(this.appState.FEATURE_LEVEL, level);
  }
}
