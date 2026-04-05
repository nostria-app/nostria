import {
  computed,
  effect,
  inject,
  Injectable,
  PLATFORM_ID,
  signal,
  untracked,
} from '@angular/core';
import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';
import { NostrService } from './nostr.service';
import { DatabaseService } from './database.service';
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
import { FavoritesService } from './favorites.service';
import { ContentNotificationService } from './content-notification.service';
import { AccountLocalStateService } from './account-local-state.service';
import { EventFocusService } from './event-focus.service';

@Injectable({
  providedIn: 'root',
})
export class ApplicationService {
  /** Application version */
  readonly version = signal('Loading...');
  nostrService = inject(NostrService);
  database = inject(DatabaseService);
  router = inject(Router);
  logger = inject(LoggerService);
  appState = inject(ApplicationStateService);
  accountState = inject(AccountStateService);
  badgeService = inject(BadgeService);
  theme = inject(ThemeService);
  notificationService = inject(NotificationService);
  dataService = inject(DataService);
  contentNotificationService = inject(ContentNotificationService);
  private readonly localStorage = inject(LocalStorageService);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly favorites = inject(FavoritesService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly eventFocus = inject(EventFocusService);
  readonly isBrowser = signal(isPlatformBrowser(this.platformId));

  /** Check the status on fully initialized, which ensures Nostr, Storage and user is logged in. */
  initialized = computed(() => this.nostrService.initialized() && this.database.initialized());

  /** User is "authenticated" if there is any account set. */
  authenticated = computed(() => this.accountState.account() != null);

  featureLevel = signal<FeatureLevel>(this.getStoredFeatureLevel());

  private readonly featurePrecedence: Record<FeatureLevel, number> = {
    stable: 0,
    beta: 1,
    preview: 2,
  };

  previousPubKey = '';

  // Track previous following list to avoid reprocessing unchanged lists
  private previousFollowingListSize = 0;
  private previousFollowingListHash = '';

  constructor() {
    void this.initializeVersion();

    // Effect for profile processing when following list changes
    effect(async () => {
      const followingList = this.accountState.followingList();
      const pubkey = this.accountState.pubkey();
      const isEventFocused = this.eventFocus.isEventFocused();

      // Don't process if there's no account
      if (!this.accountState.account() || !pubkey) {
        return;
      }

      if (isEventFocused) {
        return;
      }

      // Handle empty following list case
      if (followingList.length === 0) {
        // For returning users with empty following list, still mark cache as loaded
        // so FollowingService and DataService don't wait forever
        if (this.accountState.hasProfileDiscoveryBeenDone(pubkey)) {
          this.accountState.profileCacheLoaded.set(true);
        }
        return;
      }

      // OPTIMIZATION: Check if following list actually changed
      // Create a simple hash of the list to detect changes
      const currentHash = followingList.join(',');
      if (this.previousFollowingListSize === followingList.length &&
        this.previousFollowingListHash === currentHash) {
        return;
      }

      // Update tracking
      this.previousFollowingListSize = followingList.length;
      this.previousFollowingListHash = currentHash;

      untracked(async () => {
        try {
          // Check if profile discovery has already been done for this account
          const hasDiscoveryBeenDone = this.accountState.hasProfileDiscoveryBeenDone(pubkey);

          if (!hasDiscoveryBeenDone) {
            // Wait for feed content to actually render before starting heavy profile loading
            // This ensures users see content first, not a blank screen while profiles load
            await this.waitForFeedContent(5000); // Wait up to 5 seconds for feed content

            // Re-check if we still need to process (account might have changed)
            if (this.accountState.pubkey() !== pubkey) {
              return;
            }

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
                this.database
              );
            }
          }
        } catch (error) {
          this.logger.error('❌ [Profile Loading Effect] Error during profile processing:', error);
        }
      });
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
        // Reset polling state for the new account before checking
        // This ensures the correct lastCheckTimestamp is loaded and the rate limiter is cleared
        await this.contentNotificationService.onAccountChanged();

        const lastCheck = this.contentNotificationService.lastCheckTimestamp();
        const isFirstTime = lastCheck === 0;

        // Only check for returning users here
        // First-time checks are handled after profile processing completes
        if (!isFirstTime) {
          try {
            await this.contentNotificationService.checkForNewNotifications();
          } catch (error) {
            this.logger.error('[ApplicationService] Failed to check notifications after account change', error);
          }
        }
      });
    });
  }

  private async initializeVersion(): Promise<void> {
    if (!this.isBrowser()) {
      return;
    }

    if (isTauri()) {
      try {
        const version = await getVersion();
        this.version.set(version);
        return;
      } catch (error) {
        this.logger.warn('[ApplicationService] Failed to read app version from Tauri', error);
      }
    }

    try {
      const response = await fetch('/manifest.webmanifest');
      if (!response.ok) {
        throw new Error(`Failed to load manifest.webmanifest: ${response.status}`);
      }

      const manifest = await response.json() as { version?: string };
      this.version.set(manifest.version || 'Unknown');
    } catch (error) {
      this.logger.warn('[ApplicationService] Failed to read app version from manifest', error);
      this.version.set('Unknown');
    }
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
      this.appState.PROCESSING_STORAGE_KEY,
      this.appState.SETTINGS_KEY,
      this.appState.WALLETS_KEY,
      this.appState.USERNAMES_STORAGE_KEY,
      this.favorites.STORAGE_KEY,

      'nostria-notification-filters',
      'nostria-chat-drafts',
      'nostria-poll-drafts',
      'nostria-polls',
      'nostria-subscriptions',
      'nostria-settings',
      'nostria-following-history'

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

    await this.database.wipe(); // Assuming this method clears all app data

    // Navigate to home page before reloading
    await this.router.navigate(['/']);

    const window = this.appState.getWindow();

    if (window) {
      // Reload the application
      window.location.reload();
    }
  }

  /**
   * Wait for feed content to be ready before continuing
   * Returns immediately if content is already available, otherwise waits up to maxWaitMs
   * @param maxWaitMs Maximum time to wait for content (default 5000ms)
   */
  private async waitForFeedContent(maxWaitMs = 5000): Promise<void> {
    // Check if content is already ready
    if (this.appState.feedHasInitialContent()) {
      return;
    }

    return new Promise<void>((resolve) => {
      const startTime = Date.now();
      const checkInterval = 100; // Check every 100ms

      const intervalId = setInterval(() => {
        if (this.appState.feedHasInitialContent()) {
          clearInterval(intervalId);
          resolve();
        } else if (Date.now() - startTime >= maxWaitMs) {
          clearInterval(intervalId);
          resolve();
        }
      }, checkInterval);
    });
  }

  /**
   * Check if this is the first time loading notifications for this account
   * and trigger a 7-day limited fetch if so.
   * This is called after profile pre-caching completes.
   */
  private checkFirstTimeNotifications(): void {
    if (!this.authenticated()) {
      return;
    }

    const lastCheck = this.contentNotificationService.lastCheckTimestamp();

    // Only trigger for first-time users (lastCheck === 0)
    if (lastCheck === 0) {
      // Note: checkForNewNotifications already has a default 7-day limit,
      // so we don't need to pass limitDays here
      this.contentNotificationService.checkForNewNotifications().catch(error => {
        this.logger.error('[ApplicationService] Failed to check notifications after profile processing', error);
      });
    }
  }
}
