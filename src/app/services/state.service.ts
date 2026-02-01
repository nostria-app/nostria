import { effect, inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MediaService } from './media.service';
import { AccountStateService } from './account-state.service';
import { NostriaService } from '../interfaces';
import { BadgeService } from './badge.service';
import { NotificationService } from './notification.service';
import { NostrService } from './nostr.service';
import { MessagingService } from './messaging.service';
import { DiscoveryRelayService } from './relays/discovery-relay';
import { AccountRelayService } from './relays/account-relay';
import { ReportingService } from './reporting.service';
import { FollowingService } from './following.service';
import { MetricsTrackingService } from './metrics-tracking.service';
import { LoggerService } from './logger.service';
import { UtilitiesService } from './utilities.service';
import { DeletionFilterService } from './deletion-filter.service';
import { SettingsService } from './settings.service';

/** Service that handles changing account, will clear and load data in different services. */
@Injectable({
  providedIn: 'root',
})
export class StateService implements NostriaService {
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private utilities = inject(UtilitiesService);
  private logger = inject(LoggerService);
  accountState = inject(AccountStateService);
  media = inject(MediaService);
  badge = inject(BadgeService);
  notification = inject(NotificationService);
  nostr = inject(NostrService);
  // relay = inject(RelayService);
  messaging = inject(MessagingService);
  discoveryRelay = inject(DiscoveryRelayService);
  accountRelay = inject(AccountRelayService);
  reporting = inject(ReportingService);
  following = inject(FollowingService);
  metricsTracking = inject(MetricsTrackingService);
  deletionFilter = inject(DeletionFilterService);
  settingsService = inject(SettingsService);

  constructor() {
    effect(async () => {
      const account = this.accountState.account();
      if (account) {
        try {
          // Clear previous account state first
          this.clear();

          // FAST PATH: Load cached data IMMEDIATELY (before waiting for extension)
          // This makes following list, profile, and mute list available immediately
          // Cached data is just database reads - no signing/extension needed
          const startTime = Date.now();
          this.logger.info('[StateService] Loading cached data from storage (fast path)');
          await this.nostr.loadCachedData();
          this.logger.info(`[StateService] Cached data loaded in ${Date.now() - startTime}ms`);

          // For extension-based accounts, wait for the browser extension to be available
          // before loading data that may require signing or decryption
          if (account.source === 'extension') {
            this.logger.info('[StateService] Extension account detected, waiting for browser extension...');
            const extensionAvailable = await this.utilities.waitForNostrExtension();
            if (!extensionAvailable) {
              this.logger.warn('[StateService] Browser extension not available after timeout');
              // Continue anyway - individual operations will handle missing extension
            } else {
              this.logger.info('[StateService] Browser extension is ready');
            }
          }

          await this.load();
        } catch (error) {
          console.error('Error during account change:', error);
          // Ensure we don't leave the app in a broken state
          this.clear();
        }
      } else {
        // Clear when account is null (logout)
        this.clear();
      }
    });
  }

  async load() {
    const pubkey = this.accountState.pubkey();
    const startTime = Date.now();
    this.logger.info('[StateService] Starting relay and settings load sequence');

    // NOTE: Cached data (following list, profile, mute list) was already loaded
    // in the constructor effect before waiting for extension - see loadCachedData() call above

    // This is never called for anonymous accounts.
    await this.discoveryRelay.load();
    // Destroy old connections before setting up new ones
    const relayStartTime = Date.now();
    const relayStatus = await this.accountRelay.setAccount(pubkey, true);
    this.logger.info(`[StateService] Account relay setup completed in ${Date.now() - relayStartTime}ms`);

    // Check if user has a malformed relay list or no relays configured
    if (relayStatus.hasMalformedRelayList || relayStatus.relayUrls.length === 0) {
      // Navigate to relay settings
      this.router.navigate(['/settings/relays']);

      // Show appropriate message
      const message = relayStatus.hasMalformedRelayList
        ? 'Malformed relay configuration detected. Please repair your relay list.'
        : 'No relays configured. Please add relays to use Nostr.';

      this.snackBar.open(
        message,
        'OK',
        {
          duration: 0, // Don't auto-dismiss
          horizontalPosition: 'center',
          verticalPosition: 'top',
        }
      );
    }

    // OPTIMIZATION: Run independent operations in parallel after relay setup
    // These operations don't depend on each other and can load simultaneously
    this.logger.info('[StateService] Starting parallel load operations');
    const parallelStartTime = Date.now();

    const settingsPromise = (async () => {
      const settingsStartTime = Date.now();
      await this.settingsService.loadSettings(pubkey);
      this.settingsService.settingsLoaded.set(true);
      this.logger.info(`[StateService] Settings loaded in ${Date.now() - settingsStartTime}ms`);
    })();

    const deletionPromise = (async () => {
      const deletionStartTime = Date.now();
      await this.deletionFilter.load(pubkey);
      this.logger.info(`[StateService] Deletion filter loaded in ${Date.now() - deletionStartTime}ms`);
    })();

    const accountStatePromise = (async () => {
      const accountStartTime = Date.now();
      await this.accountState.load();
      this.logger.info(`[StateService] Account state loaded in ${Date.now() - accountStartTime}ms`);
    })();

    const notificationPromise = (async () => {
      if (!this.notification.notificationsLoaded()) {
        const notifStartTime = Date.now();
        await this.notification.loadNotifications();
        this.logger.info(`[StateService] Notifications loaded in ${Date.now() - notifStartTime}ms`);
      }
    })();

    // Wait for all parallel operations to complete
    await Promise.all([
      settingsPromise,
      deletionPromise,
      accountStatePromise,
      notificationPromise,
    ]);
    this.logger.info(`[StateService] Parallel operations completed in ${Date.now() - parallelStartTime}ms`);

    // Start relay subscriptions (this will fetch fresh data in background)
    // Note: nostr.loadCachedData() was already called above for fast startup
    // This can run after other parallel operations since it's for background refresh
    await this.nostr.loadFromRelays();

    // Media load can also be parallelized but let's keep it sequential for now
    // as it's lower priority and depends on media servers being available
    await this.media.load();

    // Schedule historical events scan for engagement metrics
    // Uses built-in timeout management to prevent duplicate scans
    this.metricsTracking.scheduleHistoricalScan();

    this.logger.info(`[StateService] Full load sequence completed in ${Date.now() - startTime}ms`);

    // NOTE: We don't automatically load chats here anymore
    // Chats are loaded on-demand when the user navigates to the messages page
    // This saves bandwidth and improves privacy
  }

  clear() {
    // Cancel any pending metrics scan when clearing state
    this.metricsTracking.cancelPendingScan();

    this.accountState.clear();
    this.messaging.clear();
    this.nostr.clear();
    this.badge.clear();
    this.media.clear();
    this.reporting.clear();
    this.following.clear();
    this.deletionFilter.clear();
  }
}
