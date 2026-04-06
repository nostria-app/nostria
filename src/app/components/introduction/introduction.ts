import { Component, inject, ChangeDetectionStrategy, signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LayoutService } from '../../services/layout.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { ApplicationService } from '../../services/application.service';
import { AndroidSignerService } from '../../services/android-signer.service';
import { NostrService } from '../../services/nostr.service';
import { SUPPORTED_LOCALE_LABELS } from '../../utils/supported-locales';

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
  private androidSigner = inject(AndroidSignerService);
  private nostrService = inject(NostrService);
  private snackBar = inject(MatSnackBar);
  signerConnecting = signal(false);

  readonly languages = SUPPORTED_LOCALE_LABELS;

  openNewUserFlow(): void {
    this.layout.showLoginDialogWithStep('new-user');
  }

  openLoginFlow(): void {
    this.layout.showLoginDialogWithStep('login');
  }

  async openSignerLoginFlow(): Promise<void> {
    if (!this.usesLocalSigner()) {
      await this.layout.showLoginDialogWithStep('remote-signer');
      return;
    }

    if (this.signerConnecting()) {
      return;
    }

    this.signerConnecting.set(true);

    try {
      await this.nostrService.loginWithAndroidSigner();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to connect Android signer';
      this.snackBar.open(message, 'Close', {
        duration: 5000,
        panelClass: 'error-snackbar',
      });
    } finally {
      this.signerConnecting.set(false);
    }
  }

  usesLocalSigner(): boolean {
    return this.androidSigner.isSupported();
  }

  isNativeAndroidApp(): boolean {
    return this.androidSigner.isSupported();
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
