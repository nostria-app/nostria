import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { LocalSettingsService } from '../../../services/local-settings.service';
import { ApplicationService } from '../../../services/application.service';

interface Language {
  code: string;
  name: string;
}

@Component({
  selector: 'app-setting-language',
  imports: [FormsModule, MatFormFieldModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <h2 i18n="@@settings.language">Language</h2>
      <p i18n="@@settings.language.description">Select your preferred language</p>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label i18n="@@settings.language.label">Language</mat-label>
        <mat-select [ngModel]="localSettings.locale()" (selectionChange)="setLanguage($event.value)">
          @for (language of languages; track language.code) {
            <mat-option [value]="language.code">{{ language.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
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
  `]
})
export class SettingLanguageComponent {
  readonly localSettings = inject(LocalSettingsService);
  private readonly app = inject(ApplicationService);

  languages: Language[] = [
    { code: 'en', name: 'English' },
    { code: 'ar', name: 'العربية' },
    { code: 'cnr', name: 'Crnogorski' },
    { code: 'es', name: 'Español' },
    { code: 'fa', name: 'فارسی' },
    { code: 'fr', name: 'Français' },
    { code: 'no', name: 'Norsk' },
    { code: 'ru', name: 'Русский' },
    { code: 'sw', name: 'Kiswahili' },
    { code: 'zu', name: 'isiZulu' },
  ];

  setLanguage(languageCode: string): void {
    this.localSettings.setLocale(languageCode);
    if (this.app.isBrowser()) {
      window.location.reload();
    }
  }
}
