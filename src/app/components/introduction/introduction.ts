import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { LayoutService } from '../../services/layout.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { ApplicationService } from '../../services/application.service';

interface Language {
  code: string;
  name: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-introduction',
  imports: [
    NgOptimizedImage,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatMenuModule,
  ],
  templateUrl: './introduction.html',
  styleUrl: './introduction.scss',
})
export class Introduction {
  private layout = inject(LayoutService);
  localSettings = inject(LocalSettingsService);
  private app = inject(ApplicationService);

  // Available languages - same as general settings
  languages: Language[] = [
    { code: 'en', name: 'English' },
    { code: 'ar', name: 'العربية' },
    { code: 'cnr', name: 'Crnogorski' },
    { code: 'es', name: 'Español' },
    { code: 'fa', name: 'فارسی' },
    { code: 'fr', name: 'Français' },
    { code: 'it', name: 'Italiano' },
    { code: 'no', name: 'Norsk' },
    { code: 'ru', name: 'Русский' },
    { code: 'sw', name: 'Kiswahili' },
    { code: 'zu', name: 'isiZulu' },
  ];

  openNewUserFlow(): void {
    this.layout.showLoginDialogWithStep('new-user');
  }

  openLoginFlow(): void {
    this.layout.showLoginDialogWithStep('login');
  }

  openSignerLoginFlow(): void {
    this.layout.showLoginDialogWithStep('external-signer');
  }

  openTermsOfUse(): void {
    this.layout.openTermsOfUse();
  }

  setLanguage(languageCode: string): void {
    this.localSettings.setLocaleImmediate(languageCode);
    if (this.app.isBrowser()) {
      window.location.reload();
    }
  }
}
