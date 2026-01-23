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

  constructor() {
    effect(async () => {
      const account = this.accountState.account();
      if (account) {
        try {
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

          this.clear();
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

    // This is never called for anonymous accounts.
    await this.discoveryRelay.load();
    // Destroy old connections before setting up new ones
    const relayStatus = await this.accountRelay.setAccount(pubkey, true);

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

    await this.accountState.load();
    await this.nostr.load();

    // Load notifications from storage
    if (!this.notification.notificationsLoaded()) {
      await this.notification.loadNotifications();
    }

    await this.media.load();

    // Schedule historical events scan for engagement metrics
    // Uses built-in timeout management to prevent duplicate scans
    this.metricsTracking.scheduleHistoricalScan();

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
  }
}
