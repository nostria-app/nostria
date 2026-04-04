import { Component, computed, inject, signal, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { DatePipe, NgOptimizedImage } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSliderModule } from '@angular/material/slider';

import { FeatureLevel, LoggerService, LogLevel } from '../../../services/logger.service';
import { ThemeService } from '../../../services/theme.service';
import { ApplicationStateService } from '../../../services/application-state.service';
import { ApplicationService } from '../../../services/application.service';
import {
  CalendarType,
  LocalSettingsService,
  RelayDiscoveryMode,
  TimeFormat,
} from '../../../services/local-settings.service';
import { PlaceholderAlgorithm, SettingsService } from '../../../services/settings.service';
import { AccountStateService } from '../../../services/account-state.service';
import { ImagePlaceholderService } from '../../../services/image-placeholder.service';
import { ExternalLinkHandlerService } from '../../../services/external-link-handler.service';
import { MatInputModule } from '@angular/material/input';
import { AccountLocalStateService } from '../../../services/account-local-state.service';
import { RightPanelService } from '../../../services/right-panel.service';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { XDualPostService } from '../../../services/x-dual-post.service';

interface Language {
  code: string;
  name: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-general-settings',
  imports: [
    DatePipe,
    NgOptimizedImage,
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
  ],
  templateUrl: './general.component.html',
  styleUrl: './general.component.scss',
  host: { class: 'panel-with-sticky-header' },
})
export class GeneralSettingsComponent implements OnInit, OnDestroy {
  logger = inject(LoggerService);
  themeService = inject(ThemeService);
  appState = inject(ApplicationStateService);
  app = inject(ApplicationService);
  localSettings = inject(LocalSettingsService);
  settings = inject(SettingsService);
  accountState = inject(AccountStateService);
  imagePlaceholder = inject(ImagePlaceholderService);
  externalLinkHandler = inject(ExternalLinkHandlerService);
  accountLocalState = inject(AccountLocalStateService);
  xDualPost = inject(XDualPostService);
  private rightPanel = inject(RightPanelService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);

  ngOnInit(): void {
    // Parent settings component handles the page title
    void this.xDualPost.refreshStatus();
    this.handleXAuthReturn();
  }

  ngOnDestroy(): void {
    // No cleanup needed
  }

  goBack(): void {
    this.rightPanel.goBack();
  }

  openPremiumTab(): void {
    void this.router.navigate(['/accounts'], { queryParams: { tab: 'premium' } });
  }

  currentFeatureLevel = signal<FeatureLevel>(this.app.featureLevel());
  xPremiumEligible = computed(() => {
    const subscription = this.accountState.subscription();
    const isPremiumTier = subscription?.tier === 'premium' || subscription?.tier === 'premium_plus';
    const isNotExpired = !subscription?.expires || Date.now() < subscription.expires;
    return !!subscription && isPremiumTier && isNotExpired;
  });
  xProfileUrl = computed(() => {
    const username = this.xDualPost.status().username;
    return username ? `https://x.com/${username}` : null;
  });

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
    { code: 'it', name: 'Italiano' },
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
    this.localSettings.setLocaleImmediate(languageCode);
    if (this.app.isBrowser()) {
      window.location.reload();
    }
  }

  setMaxRelaysPerUser(event: { value: number }): void {
    const value = event.value;
    this.localSettings.setMaxRelaysPerUser(value);
  }

  setRelayDiscoveryMode(mode: RelayDiscoveryMode): void {
    this.localSettings.setRelayDiscoveryMode(mode);
    this.settings.updateSettings({ relayDiscoveryMode: mode });
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

  togglePostToXByDefault(): void {
    const currentValue = this.settings.settings()?.postToXByDefault ?? false;
    this.settings.updateSettings({ postToXByDefault: !currentValue });
  }

  togglePublishMusicStatus(): void {
    const currentValue = this.settings.settings()?.publishMusicStatus !== false;
    this.settings.updateSettings({ publishMusicStatus: !currentValue });
  }

  toggleMessageNotificationSounds(): void {
    const currentValue = this.settings.settings().messageNotificationSoundsEnabled !== false;
    this.settings.updateSettings({ messageNotificationSoundsEnabled: !currentValue });
  }

  toggleZapSounds(): void {
    const currentValue = this.settings.settings().zapSoundsEnabled !== false;
    this.settings.updateSettings({ zapSoundsEnabled: !currentValue });
  }

  setPlaceholderAlgorithm(value: PlaceholderAlgorithm): void {
    this.settings.updateSettings({ placeholderAlgorithm: value });
    // Clear the placeholder cache when algorithm changes
    this.imagePlaceholder.clearCache();
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

  async connectX(): Promise<void> {
    if (!this.xPremiumEligible()) {
      this.snackBar.open('Post to X is available for Premium accounts only.', 'Close', {
        duration: 5000,
      });
      return;
    }

    try {
      await this.xDualPost.connect();
    } catch (error) {
      this.snackBar.open(`Failed to connect X: ${error instanceof Error ? error.message : 'Unknown error'}`, 'Close', {
        duration: 5000,
      });
    }
  }

  async disconnectX(): Promise<void> {
    try {
      await this.xDualPost.disconnect();
      this.snackBar.open('Disconnected X account', 'Close', {
        duration: 3000,
      });
    } catch (error) {
      this.snackBar.open(`Failed to disconnect X: ${error instanceof Error ? error.message : 'Unknown error'}`, 'Close', {
        duration: 5000,
      });
    }
  }

  async reconnectX(): Promise<void> {
    if (!this.xPremiumEligible()) {
      this.snackBar.open('Post to X is available for Premium accounts only.', 'Close', {
        duration: 5000,
      });
      return;
    }

    try {
      await this.xDualPost.reconnect();
    } catch (error) {
      this.snackBar.open(`Failed to reconnect X: ${error instanceof Error ? error.message : 'Unknown error'}`, 'Close', {
        duration: 5000,
      });
    }
  }

  getXUsageRemaining(): string {
    const status = this.xDualPost.status();

    if (status.limit24h === undefined || status.remaining24h === undefined) {
      return 'No daily cap configured';
    }

    return `${status.remaining24h} remaining of ${status.limit24h}`;
  }

  private handleXAuthReturn(): void {
    const status = this.route.snapshot.queryParamMap.get('xAuth');
    const message = this.route.snapshot.queryParamMap.get('xMessage');

    if (!status) {
      return;
    }

    if (status === 'success') {
      this.snackBar.open('X account connected', 'Close', {
        duration: 3000,
      });
    } else if (status === 'cancelled') {
      this.snackBar.open('X authorization was cancelled', 'Close', {
        duration: 3000,
      });
    } else {
      this.snackBar.open(message || 'X authorization failed', 'Close', {
        duration: 5000,
      });
    }

    void this.xDualPost.refreshStatus();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        xAuth: null,
        xMessage: null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
