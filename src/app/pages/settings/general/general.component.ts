import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSliderModule } from '@angular/material/slider';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FeatureLevel, LoggerService, LogLevel } from '../../../services/logger.service';
import { ThemeService } from '../../../services/theme.service';
import { ApplicationStateService } from '../../../services/application-state.service';
import { ApplicationService } from '../../../services/application.service';
import { CalendarType, LocalSettingsService, TimeFormat } from '../../../services/local-settings.service';
import { PlaceholderAlgorithm, SettingsService } from '../../../services/settings.service';
import { StorageStatsComponent } from '../../../components/storage-stats/storage-stats.component';
import { ConfirmDialogComponent } from '../../../components/confirm-dialog/confirm-dialog.component';
import { AccountStateService } from '../../../services/account-state.service';
import { ImagePlaceholderService } from '../../../services/image-placeholder.service';
import { ExternalLinkHandlerService } from '../../../services/external-link-handler.service';
import { MatInputModule } from '@angular/material/input';
import { AccountLocalStateService } from '../../../services/account-local-state.service';
import { EmojiSetService } from '../../../services/emoji-set.service';
import { RightPanelService } from '../../../services/right-panel.service';
import { MatTooltipModule } from '@angular/material/tooltip';

interface Language {
  code: string;
  name: string;
}

@Component({
  selector: 'app-general-settings',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatSliderModule,
    MatInputModule,
    MatTooltipModule,
    StorageStatsComponent,
  ],
  templateUrl: './general.component.html',
  styleUrl: './general.component.scss',
})
export class GeneralSettingsComponent implements OnInit, OnDestroy {
  logger = inject(LoggerService);
  themeService = inject(ThemeService);
  appState = inject(ApplicationStateService);
  app = inject(ApplicationService);
  dialog = inject(MatDialog);
  localSettings = inject(LocalSettingsService);
  settings = inject(SettingsService);
  accountState = inject(AccountStateService);
  imagePlaceholder = inject(ImagePlaceholderService);
  externalLinkHandler = inject(ExternalLinkHandlerService);
  accountLocalState = inject(AccountLocalStateService);
  emojiSetService = inject(EmojiSetService);
  snackBar = inject(MatSnackBar);
  private rightPanel = inject(RightPanelService);

  ngOnInit(): void {
    // Parent settings component handles the page title
  }

  ngOnDestroy(): void {
    // No cleanup needed
  }

  goBack(): void {
    this.rightPanel.goBack();
  }

  currentFeatureLevel = signal<FeatureLevel>(this.app.featureLevel());

  // Global event expiration (in hours, null = disabled)
  globalEventExpiration = signal<number | null>(this.getInitialGlobalExpiration());

  // External domains management
  configuredDomains = signal<string[]>(this.externalLinkHandler.getConfiguredDomains());
  newDomain = '';

  // Available languages
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

  setFeatureLevel(level: FeatureLevel): void {
    if (!this.app.isBrowser()) return;
    this.app.featureLevel.set(level);
    localStorage.setItem(this.appState.FEATURE_LEVEL, level);
  }

  setLogLevel(level: LogLevel): void {
    this.logger.setLogLevel(level);
  }

  toggleDarkMode(): void {
    this.themeService.toggleDarkMode();
  }

  setLanguage(languageCode: string): void {
    this.localSettings.setLocale(languageCode);
    if (this.app.isBrowser()) {
      window.location.reload();
    }
  }

  setMaxRelaysPerUser(event: { value: number }): void {
    const value = event.value;
    this.localSettings.setMaxRelaysPerUser(value);
  }

  toggleAutoRelayAuth(): void {
    this.localSettings.setAutoRelayAuth(!this.localSettings.autoRelayAuth());
  }

  toggleAddClientTag(): void {
    this.localSettings.setAddClientTag(!this.localSettings.addClientTag());
  }

  toggleShowClientTag(): void {
    this.localSettings.setShowClientTag(!this.localSettings.showClientTag());
  }

  setMediaPrivacy(value: 'blur-non-following' | 'blur-always' | 'show-always'): void {
    this.settings.updateSettings({ mediaPrivacy: value });
  }

  setCalendarType(calendarType: CalendarType): void {
    this.localSettings.setCalendarType(calendarType);
  }

  setTimeFormat(timeFormat: TimeFormat): void {
    this.localSettings.setTimeFormat(timeFormat);
  }

  toggleAutoPlayShortForm(): void {
    const currentValue = this.settings.settings()?.autoPlayShortForm ?? true;
    this.settings.updateSettings({ autoPlayShortForm: !currentValue });
  }

  toggleRepeatShortForm(): void {
    const currentValue = this.settings.settings()?.repeatShortForm ?? true;
    this.settings.updateSettings({ repeatShortForm: !currentValue });
  }

  toggleAutoPlayVideos(): void {
    const currentValue = this.settings.settings()?.autoPlayVideos ?? false;
    this.settings.updateSettings({ autoPlayVideos: !currentValue });
  }

  setPlaceholderAlgorithm(value: PlaceholderAlgorithm): void {
    this.settings.updateSettings({ placeholderAlgorithm: value });
    // Clear the placeholder cache when algorithm changes
    this.imagePlaceholder.clearCache();
  }

  wipeData(): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Confirm Data Deletion',
        message: 'Are you sure you want to delete all app data? This action cannot be undone.',
        confirmButtonText: 'Delete All Data',
      },
    });

    dialogRef.afterClosed().subscribe(async confirmed => {
      if (confirmed) {
        await this.app.wipe();
      }
    });
  }

  // External link domain management methods
  addNewDomain(): void {
    if (!this.newDomain.trim()) {
      return;
    }

    this.externalLinkHandler.addDomain(this.newDomain.trim());
    this.configuredDomains.set(this.externalLinkHandler.getConfiguredDomains());
    this.newDomain = '';
  }

  removeDomain(domain: string): void {
    this.externalLinkHandler.removeDomain(domain);
    this.configuredDomains.set(this.externalLinkHandler.getConfiguredDomains());
  }

  resetDomainsToDefault(): void {
    this.externalLinkHandler.resetToDefaults();
    this.configuredDomains.set(this.externalLinkHandler.getConfiguredDomains());
  }

  // Global event expiration methods
  private getInitialGlobalExpiration(): number | null {
    const pubkey = this.accountState.account()?.pubkey;
    if (!pubkey) return null;
    return this.accountLocalState.getGlobalEventExpiration(pubkey);
  }

  toggleGlobalEventExpiration(): void {
    const pubkey = this.accountState.account()?.pubkey;
    if (!pubkey) return;

    const currentValue = this.globalEventExpiration();
    if (currentValue === null) {
      // Enable with default 24 hours
      this.globalEventExpiration.set(24);
      this.accountLocalState.setGlobalEventExpiration(pubkey, 24);
    } else {
      // Disable
      this.globalEventExpiration.set(null);
      this.accountLocalState.setGlobalEventExpiration(pubkey, null);
    }
  }

  setGlobalEventExpiration(hours: number | null): void {
    const pubkey = this.accountState.account()?.pubkey;
    if (!pubkey) return;

    this.globalEventExpiration.set(hours);
    this.accountLocalState.setGlobalEventExpiration(pubkey, hours);
  }

  clearEmojiCache(): void {
    this.emojiSetService.clearAllCaches();
    this.snackBar.open('Emoji cache cleared', 'Close', { duration: 3000 });
  }
}
