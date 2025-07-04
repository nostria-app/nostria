import { Component, effect, inject, signal } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { FeatureLevel, LoggerService, LogLevel } from '../../services/logger.service';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { RouterModule } from '@angular/router';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { MatTabsModule } from '@angular/material/tabs';
import { StorageStatsComponent } from '../../components/storage-stats/storage-stats.component';
import { ThemeService } from '../../services/theme.service';
import { NostrService } from '../../services/nostr.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmDialogComponent } from '../../components/confirm-dialog/confirm-dialog.component';
import { Router } from '@angular/router';
import { StorageService } from '../../services/storage.service';
import { ApplicationStateService } from '../../services/application-state.service';
import { ApplicationService } from '../../services/application.service';
import { PrivacySettingsComponent } from '../../components/privacy-settings/privacy-settings.component';
import { LogsSettingsComponent } from '../../components/logs-settings/logs-settings.component';
import { BreakpointObserver } from '@angular/cdk/layout';
import { AboutComponent } from '../about/about.component';
import { RelaysComponent } from '../relays/relays.component';
import { BackupComponent } from '../backup/backup.component';
import { LocalSettingsService } from '../../services/local-settings.service';
import { WebRequest } from '../../services/web-request';
import { AccountStateService } from '../../services/account-state.service';
import { PremiumSettings } from '../premium/settings/settings';

interface SettingsSection {
  id: string;
  title: string;
  icon: string;
  authenticated?: boolean;
}

interface Language {
  code: string;
  name: string;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    MatSlideToggleModule,
    RouterModule,
    MatListModule,
    MatDividerModule,
    MatTabsModule,
    StorageStatsComponent,
    PrivacySettingsComponent,
    LogsSettingsComponent,
    AboutComponent,
    RelaysComponent,
    BackupComponent,
    PremiumSettings
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  logger = inject(LoggerService);
  private breakpointObserver = inject(BreakpointObserver);
  themeService = inject(ThemeService);
  nostrService = inject(NostrService);
  storage = inject(StorageService);
  appState = inject(ApplicationStateService);
  accountState = inject(AccountStateService);
  app = inject(ApplicationService);
  dialog = inject(MatDialog);
  router = inject(Router);
  localSettings = inject(LocalSettingsService);
  web = inject(WebRequest);

  currentFeatureLevel = signal<FeatureLevel>(this.app.featureLevel());

  // Available languages
  languages: Language[] = [
 { code: 'en', name: 'English' },
  { code: 'ru', name: 'Русский' },
  { code: 'no', name: 'Norsk' },
  { code: 'sw', name: 'Kiswahili' },
  { code: 'zu', name: 'isiZulu' }
  ];

  // Track active section
  activeSection = signal('general');
  isMobile = signal(false);
  showDetails = signal(false);

  // Define settings sections
  sections: SettingsSection[] = [
    { id: 'general', title: 'General', icon: 'settings' },
    { id: 'relays', title: 'Relays', icon: 'dns', authenticated: true },
    { id: 'privacy', title: 'Privacy & Safety', icon: 'security', authenticated: true },
    { id: 'backup', title: 'Backup', icon: 'archive', authenticated: true },
    { id: 'premium', title: 'Premium', icon: 'diamond', authenticated: true },
    { id: 'logs', title: 'Logs', icon: 'article', authenticated: true },
    { id: 'about', title: 'About', icon: 'info' }
  ];

  constructor() {
    // Keep the current log level in sync with the service
    // effect(() => {
    //   this.currentLogLevel.set(this.logger.logLevel());
    // });

    // Check if the screen is mobile-sized
    this.breakpointObserver.observe(['(max-width: 768px)']).subscribe(result => {
      this.isMobile.set(result.matches);
      this.showDetails.set(!result.matches);
    });
  }

  selectSection(sectionId: string): void {
    this.activeSection.set(sectionId);

    if (this.isMobile()) {
      this.showDetails.set(true);
    }
  }

  goBack(): void {
    if (this.isMobile()) {
      this.showDetails.set(false);
    }
  }

  setFeatureLevel(level: FeatureLevel): void {
    if (!this.app.isBrowser()) return; // Return if not in browser context

    this.app.featureLevel.set(level);
    localStorage.setItem(this.appState.FEATURE_LEVEL, level);
  }

  setLogLevel(level: LogLevel): void {
    this.logger.setLogLevel(level);
  }

  toggleDarkMode() {
    this.themeService.toggleDarkMode();
  }

  logout() {
    this.nostrService.logout();
  }

  getTitle() {
    return this.sections.find(section => section.id === this.activeSection())?.title || 'Settings';
  }

  setLanguage(languageCode: string): void {
    this.localSettings.setLocale(languageCode);
    // Reload the page to apply the new language
    if (this.app.isBrowser()) {
      window.location.reload();
    }
  }

  wipeData(): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Confirm Data Deletion',
        message: 'Are you sure you want to delete all app data? This action cannot be undone.',
        confirmButtonText: 'Delete All Data'
      }
    });

    dialogRef.afterClosed().subscribe(async confirmed => {
      if (confirmed) {
        await this.app.wipe();
      }
    });
  }

  async loadSettings() {
    const result = await this.web.fetchJson(`http://localhost:3000/api/settings/${this.accountState.pubkey()}`, { method: 'GET' }, { kind: 27235 });
    console.log('Loaded settings:', result);
  }

  async saveSettings() {
    const settings = {
      releaseChannel: "alpha",
      socialSharing: true
    };

    const json = JSON.stringify(settings);

    const result = await this.web.fetchJson(`http://localhost:3000/api/settings/${this.accountState.pubkey()}`, { method: 'POST', body: json }, { kind: 27235 });
    console.log('Loaded settings:', result);
  }

}
