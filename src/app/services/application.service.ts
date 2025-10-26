import {
  computed,
  effect,
  inject,
  Injectable,
  PLATFORM_ID,
  signal,
  untracked,
} from '@angular/core';
import { NostrService } from './nostr.service';
import { StorageService } from './storage.service';
import { Router } from '@angular/router';
import { FeatureLevel, LoggerService } from './logger.service';
import { ApplicationStateService } from './application-state.service';
import { ThemeService } from './theme.service';
import { NotificationService } from './notification.service';
import { LocalStorageService } from './local-storage.service';
import { isPlatformBrowser } from '@angular/common';
import { AccountStateService } from './account-state.service';
import { DataService } from './data.service';
import { BadgeService } from './badge.service';
import { SleepModeService } from './sleep-mode.service';
import { FavoritesService } from './favorites.service';
import { ContentNotificationService } from './content-notification.service';
import { AccountLocalStateService } from './account-local-state.service';

@Injectable({
  providedIn: 'root',
})
export class ApplicationService {
  nostrService = inject(NostrService);
  storage = inject(StorageService);
  router = inject(Router);
  logger = inject(LoggerService);
  appState = inject(ApplicationStateService);
  accountState = inject(AccountStateService);
  badgeService = inject(BadgeService);
  sleepModeService = inject(SleepModeService);
  theme = inject(ThemeService);
  notificationService = inject(NotificationService);
  dataService = inject(DataService);
  contentNotificationService = inject(ContentNotificationService);
  private readonly localStorage = inject(LocalStorageService);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly favorites = inject(FavoritesService);
  private readonly platformId = inject(PLATFORM_ID);
  readonly isBrowser = signal(isPlatformBrowser(this.platformId));

  /** Check the status on fully initialized, which ensures Nostr, Storage and user is logged in. */
  initialized = computed(() => this.nostrService.initialized() && this.storage.initialized());

  /** User is "authenticated" if there is any account set. */
  authenticated = computed(() => this.accountState.account() != null);

  featureLevel = signal<FeatureLevel>(this.getStoredFeatureLevel());

  private readonly featurePrecedence: Record<FeatureLevel, number> = {
    stable: 0,
    beta: 1,
    preview: 2,
  };

  previousPubKey = '';

  constructor() {
    // Effect for profile processing when following list changes
    effect(async () => {
      const followingList = this.accountState.followingList();
      // const initialize = this.appState.

      // Auto-trigger profile processing when following list changes, but only once per account
      const pubkey = this.accountState.pubkey();

      // For reasons unable to figure out,
      // this is triggered twice on app start.
      if (pubkey && followingList.length > 0) {
        untracked(async () => {
          try {
            // Check if profile discovery has already been done for this account
            if (!this.accountState.hasProfileDiscoveryBeenDone(pubkey)) {
              await this.accountState.startProfileProcessing(
                followingList,
                this.dataService,
                () => {
                  // Callback: After profile processing completes, check for first-time notifications
                  this.checkFirstTimeNotifications();
                }
              );
              this.accountState.markProfileDiscoveryDone(pubkey);
            } else {
              const currentState = this.accountState.profileProcessingState();
              if (!currentState.isProcessing) {
                // Profile discovery has been done, load profiles from storage into cache
                await this.accountState.loadProfilesFromStorageToCache(
                  pubkey,
                  this.dataService,
                  this.storage
                );
              }
            }
          } catch (error) {
            this.logger.error('Error during profile processing:', error);
          }
        });
      }
    });

    // Effect for checking notifications when account changes
    effect(() => {
      const isAuthenticated = this.authenticated();
      const pubkey = this.accountState.pubkey();
      const isInitialized = this.contentNotificationService.initialized();

      // Only proceed if we're authenticated, have a pubkey, and service is initialized
      if (!isAuthenticated || !pubkey || !isInitialized) {
        return;
      }

      untracked(async () => {
        const lastCheck = this.contentNotificationService.lastCheckTimestamp();
        const isFirstTime = lastCheck === 0;

        // Only check for returning users here
        // First-time checks are handled after profile processing completes
        if (!isFirstTime) {
          this.logger.info(
            `[ApplicationService] Account changed - checking notifications for returning user (lastCheck: ${lastCheck})`
          );
          try {
            await this.contentNotificationService.checkForNewNotifications();
            this.logger.info('[ApplicationService] Notification check completed after account change');
          } catch (error) {
            this.logger.error('[ApplicationService] Failed to check notifications after account change', error);
          }
        } else {
          this.logger.debug('[ApplicationService] First-time user - notification check will happen after profile processing');
        }
      });
    });
  }

  private getStoredFeatureLevel(): FeatureLevel {
    if (!this.isBrowser()) return 'stable';

    const storedLevel = localStorage.getItem(this.appState.FEATURE_LEVEL) as FeatureLevel | null;
    return storedLevel || 'stable';
  }

  enabledFeature(level?: FeatureLevel): boolean {
    if (!level) {
      return true;
    }

    return this.featurePrecedence[level] <= this.featurePrecedence[this.featureLevel()];
  }

  reload() {
    const window = this.appState.getWindow();

    if (window) {
      // Reload the application
      window.location.reload();
    }
  }

  async wipe() {
    this.nostrService.clear();

    // Clear known localStorage keys related to the app
    const keysToRemove = [
      this.appState.ACCOUNT_STORAGE_KEY,
      this.appState.ACCOUNTS_STORAGE_KEY,
      this.appState.DISCOVERY_RELAYS_STORAGE_KEY,
      this.appState.PEOPLE_VIEW_MODE,
      this.appState.MEDIA_ACTIVE_TAB,
      this.appState.FEATURE_LEVEL,
      this.logger.LOG_LEVEL_KEY,
      this.logger.LOG_OVERLAY_KEY,
      this.theme.THEME_KEY,
      this.appState.FEEDS_STORAGE_KEY,
      this.appState.RELAYS_STORAGE_KEY,
      this.appState.PROCESSING_STORAGE_KEY,
      this.appState.SETTINGS_KEY,
      this.appState.WALLETS_KEY,
      this.appState.USERNAMES_STORAGE_KEY,
      this.favorites.STORAGE_KEY,

      'nostria-notification-filters',
      'nostria-poll-drafts',
      'nostria-polls',
      'nostria-subscriptions',
      'nostria-settings'

      // Delete auto-drafts, example:
      // article-auto-draft-ad755dd2d56d4bff21d0d2670ed6fc13ef9fae1fb78b75e81b98b5dbcc22fd27
      // note-auto-draft-ad755dd2d56d4bff21d0d2670ed6fc13ef9fae1fb78b75e81b98b5dbcc22fd27
    ];

    for (const key of keysToRemove) {
      this.localStorage.removeItem(key);
    }

    // Clear all per-account state (nostria-state with all pubkeys)
    this.accountLocalState.clearAllStates();

    // Clear notifications from memory
    this.notificationService.clearNotifications();

    await this.storage.wipe(); // Assuming this method clears all app data

    // Navigate to home page before reloading
    await this.router.navigate(['/']);

    const window = this.appState.getWindow();

    if (window) {
      // Reload the application
      window.location.reload();
    }
  }

  /**
   * Check if this is the first time loading notifications for this account
   * and trigger a 30-day limited fetch if so.
   * This is called after profile pre-caching completes.
   */
  private checkFirstTimeNotifications(): void {
    if (!this.authenticated()) {
      return;
    }

    const lastCheck = this.contentNotificationService.lastCheckTimestamp();

    // Only trigger for first-time users (lastCheck === 0)
    if (lastCheck === 0) {
      this.logger.info(
        '[ApplicationService] Profile processing complete - triggering first-time notification check (30 days)'
      );
      this.contentNotificationService.checkForNewNotifications(30).catch(error => {
        this.logger.error('[ApplicationService] Failed to check notifications after profile processing', error);
      });
    } else {
      this.logger.debug(
        `[ApplicationService] Not first-time (lastCheck: ${lastCheck}), skipping notification check after profile processing`
      );
    }
  }
}
