import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSliderModule } from '@angular/material/slider';
import { MatDialog } from '@angular/material/dialog';
import { FeatureLevel, LoggerService, LogLevel } from '../../../services/logger.service';
import { ThemeService } from '../../../services/theme.service';
import { ApplicationStateService } from '../../../services/application-state.service';
import { ApplicationService } from '../../../services/application.service';
import { CalendarType, LocalSettingsService } from '../../../services/local-settings.service';
import { PlaceholderAlgorithm, SettingsService } from '../../../services/settings.service';
import { StorageStatsComponent } from '../../../components/storage-stats/storage-stats.component';
import { ConfirmDialogComponent } from '../../../components/confirm-dialog/confirm-dialog.component';
import { AccountStateService } from '../../../services/account-state.service';
import { DatabaseService } from '../../../services/database.service';
import { NotificationService } from '../../../services/notification.service';
import { ContentNotificationService } from '../../../services/content-notification.service';
import { ImagePlaceholderService } from '../../../services/image-placeholder.service';
import { ExternalLinkHandlerService } from '../../../services/external-link-handler.service';
import { MatInputModule } from '@angular/material/input';

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
    StorageStatsComponent,
  ],
  templateUrl: './general.component.html',
  styleUrl: './general.component.scss',
})
export class GeneralSettingsComponent {
  logger = inject(LoggerService);
  themeService = inject(ThemeService);
  appState = inject(ApplicationStateService);
  app = inject(ApplicationService);
  dialog = inject(MatDialog);
  localSettings = inject(LocalSettingsService);
  settings = inject(SettingsService);
  accountState = inject(AccountStateService);
  database = inject(DatabaseService);
  notificationService = inject(NotificationService);
  contentNotificationService = inject(ContentNotificationService);
  imagePlaceholder = inject(ImagePlaceholderService);
  externalLinkHandler = inject(ExternalLinkHandlerService);

  currentFeatureLevel = signal<FeatureLevel>(this.app.featureLevel());
  
  // External domains management
  configuredDomains = signal<string[]>(this.externalLinkHandler.getConfiguredDomains());
  newDomain = '';

  // Available languages
  languages: Language[] = [
    { code: 'en', name: 'English' },
    { code: 'ar', name: 'العربية' },
    { code: 'cnr', name: 'Crnogorski' },
    { code: 'fa', name: 'فارسی' },
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

  toggleAddClientTag(): void {
    this.localSettings.setAddClientTag(!this.localSettings.addClientTag());
  }

  toggleShowClientTag(): void {
    this.localSettings.setShowClientTag(!this.localSettings.showClientTag());
  }

  toggleStartOnLastRoute(): void {
    this.localSettings.setStartOnLastRoute(!this.localSettings.startOnLastRoute());
  }

  toggleStartFeedsOnLastEvent(): void {
    this.localSettings.setStartFeedsOnLastEvent(!this.localSettings.startFeedsOnLastEvent());
  }

  toggleShowThreadLines(): void {
    this.localSettings.setShowThreadLines(!this.localSettings.showThreadLines());
  }

  toggleOpenThreadsExpanded(): void {
    this.localSettings.setOpenThreadsExpanded(!this.localSettings.openThreadsExpanded());
  }

  setMediaPrivacy(value: 'blur-non-following' | 'blur-always' | 'show-always'): void {
    this.settings.updateSettings({ mediaPrivacy: value });
  }

  setCalendarType(calendarType: CalendarType): void {
    this.localSettings.setCalendarType(calendarType);
  }

  toggleAutoPlayShortForm(): void {
    const currentValue = this.settings.settings()?.autoPlayShortForm ?? true;
    this.settings.updateSettings({ autoPlayShortForm: !currentValue });
  }

  toggleRepeatShortForm(): void {
    const currentValue = this.settings.settings()?.repeatShortForm ?? true;
    this.settings.updateSettings({ repeatShortForm: !currentValue });
  }

  setPlaceholderAlgorithm(value: PlaceholderAlgorithm): void {
    this.settings.updateSettings({ placeholderAlgorithm: value });
    // Clear the placeholder cache when algorithm changes
    this.imagePlaceholder.clearCache();
  }

  resetNotificationsCache(): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Reset Notifications Cache',
        message: 'Are you sure you want to delete all cached notifications? They will be refetched from relays on next check.',
        confirmButtonText: 'Reset Cache',
      },
    });

    dialogRef.afterClosed().subscribe(async confirmed => {
      if (confirmed) {
        // Clear notifications from IndexedDB
        await this.database.clearAllNotifications();

        // Clear in-memory notification cache
        this.notificationService.clearNotifications();

        // Reset notification filters and last check timestamp
        this.contentNotificationService.resetLastCheckTimestamp();
        localStorage.removeItem('nostria-notification-filters');
        this.logger.info('Notifications cache cleared');

        // Start a fresh notification check to repopulate from relays
        // Note: No day limit - this fetches full history when manually resetting
        try {
          await this.contentNotificationService.checkForNewNotifications();
          this.logger.info('Fresh notifications fetched from relays');
        } catch (error) {
          this.logger.error('Failed to fetch fresh notifications', error);
        }
      }
    });
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
}
