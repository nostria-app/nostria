import { Component, inject } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { LayoutService } from '../../services/layout.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { ApplicationService } from '../../services/application.service';
import { NostrService } from '../../services/nostr.service';

interface Language {
  code: string;
  name: string;
}

@Component({
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
  private nostrService = inject(NostrService);

  // Default preview account - Coffee
  private readonly previewPubkey = 'npub1lmtv5qjrgjak504pc0a2885w72df69lmk8jfaet2xc3x2rppjy8sfzxvac';

  // Available languages - same as general settings
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

  openNewUserFlow(): void {
    this.layout.showLoginDialogWithStep('new-user');
  }

  openLoginFlow(): void {
    this.layout.showLoginDialogWithStep('login');
  }

  showWelcomeDialog(): void {
    this.layout.showWelcomeDialog();
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

  loginWithPreview(): void {
    this.nostrService.usePreviewAccount(this.previewPubkey);
  }
}
