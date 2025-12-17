import { computed, effect, inject, Injectable, PLATFORM_ID, signal, DOCUMENT } from '@angular/core';
import { Router } from '@angular/router';
import { LoggerService } from './logger.service';
import { isPlatformBrowser } from '@angular/common';

@Injectable({
  providedIn: 'root',
})
export class ApplicationStateService {
  router = inject(Router);
  logger = inject(LoggerService);

  showSuccess = signal(false);
  isOnline = signal(navigator.onLine);
  isPublishing = signal(false); // Track when events are being published
  feedHasInitialContent = signal(false); // Track when feed has initial content ready
  private document = inject(DOCUMENT);
  private platformId = inject(PLATFORM_ID);

  // pubkey = signal<string | null>(null);

  readonly DISCOVERY_RELAYS_STORAGE_KEY = 'nostria-discovery-relays';
  readonly ACCOUNT_STORAGE_KEY = 'nostria-account';
  readonly FEATURE_LEVEL = 'nostria-feature-level';
  readonly ACCOUNTS_STORAGE_KEY = 'nostria-accounts';
  readonly PEOPLE_VIEW_MODE = 'nostria-peple-view-mode';
  readonly MEDIA_ACTIVE_TAB = 'nostria-media-active-tab';
  readonly FEEDS_STORAGE_KEY = 'nostria-feeds';
  readonly RELAYS_STORAGE_KEY = 'nostria-relays';
  readonly PROCESSING_STORAGE_KEY = 'nostria-processing';
  readonly SETTINGS_KEY = 'nostria-settings';
  readonly WALLETS_KEY = 'nostria-wallets';
  readonly SUBSCRIPTIONS_STORAGE_KEY = 'nostria-subscriptions';
  readonly USERNAMES_STORAGE_KEY = 'nostria-usernames';

  showOfflineWarning = computed(() => !this.isOnline() && !this.offlineDismissed());
  // showOfflineWarning = signal(true);
  private offlineDismissed = signal(false);

  constructor() {
    this.setupConnectionListeners();
  }

  dismissOffline() {
    this.offlineDismissed.set(true);
  }

  getWindow(): Window | null {
    return isPlatformBrowser(this.platformId) ? this.document.defaultView : null;
  }

  private setupConnectionListeners(): void {
    const window = this.getWindow();

    if (window) {
      window.addEventListener('online', () => {
        this.isOnline.set(true);
        this.offlineDismissed.set(false); // Reset dismiss state when coming back online
      });
      window.addEventListener('offline', () => this.isOnline.set(false));
    }

    // Create an effect to log status changes (optional)
    effect(() => {
      if (this.isOnline()) {
        this.logger.info('Connection status: online');
      } else {
        this.logger.warn('Connection status: offline');
      }
    });
  }
}
