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

/** Service that handles changing account, will clear and load data in different services. */
@Injectable({
  providedIn: 'root',
})
export class StateService implements NostriaService {
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
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

    // Scan historical events for engagement metrics
    // Delay by 2 minutes to reduce initial load pressure and prioritize feed content
    setTimeout(() => {
      this.metricsTracking.scanHistoricalEvents().catch(error => {
        console.error('Error scanning historical events for metrics:', error);
      });
    }, 2 * 60 * 1000); // 2 minutes

    // NOTE: We don't automatically load chats here anymore
    // Chats are loaded on-demand when the user navigates to the messages page
    // This saves bandwidth and improves privacy
  }

  clear() {
    this.accountState.clear();
    this.messaging.clear();
    this.nostr.clear();
    this.badge.clear();
    this.media.clear();
    this.reporting.clear();
    this.following.clear();
  }
}
