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
    // Load discovery relays, passing the pubkey to check for kind 10086 event
    await this.discoveryRelay.load(pubkey);
    
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

    // Ensure default discovery relays are published in parallel (non-blocking)
    const discoveryRelayPromise = (async () => {
      const discoveryStartTime = Date.now();
      await this.ensureDefaultDiscoveryRelays(pubkey);
      this.logger.info(`[StateService] Discovery relay check completed in ${Date.now() - discoveryStartTime}ms`);
    })();

    // Wait for all parallel operations to complete
    await Promise.all([
      settingsPromise,
      accountStatePromise,
      notificationPromise,
      discoveryRelayPromise,
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

  /**
   * Ensure the user has default discovery relays set and published if they don't have a kind 10086 event.
   * This is critical for profile lookup functionality.
   */
  private async ensureDefaultDiscoveryRelays(pubkey: string): Promise<void> {
    try {
      // Check if user already has a kind 10086 event
      const existingRelays = await this.discoveryRelay.loadFromEvent(pubkey);
      
      if (existingRelays === null) {
        // User has no kind 10086 event, create and publish defaults
        this.logger.info('[StateService] User has no discovery relays (kind 10086), setting defaults');
        
        // Get default discovery relays based on user's region
        const defaultRelays = this.discoveryRelay.getDefaultDiscoveryRelays();
        
        // Save to local storage so they're used immediately
        this.discoveryRelay.setDiscoveryRelays(defaultRelays);
        
        // Create kind 10086 event
        const event = this.discoveryRelay.createDiscoveryRelayListEvent(pubkey, defaultRelays);
        
        // Sign the event
        const signedEvent = await this.nostr.signEvent(event);
        
        if (signedEvent) {
          // Save to database
          await this.discoveryRelay.saveEvent(signedEvent);
          
          // Publish to account relays and discovery relays
          // Using Promise.allSettled to not fail if publishing fails
          await Promise.allSettled([
            this.accountRelay.publish(signedEvent),
            this.discoveryRelay.publish(signedEvent),
          ]);
          
          this.logger.info('[StateService] Successfully published default discovery relays (kind 10086)');
        } else {
          this.logger.warn('[StateService] Failed to sign discovery relay event');
        }
      } else {
        this.logger.debug('[StateService] User already has discovery relays configured');
      }
    } catch (error) {
      // Don't fail the entire load process if discovery relay setup fails
      this.logger.error('[StateService] Error ensuring default discovery relays:', error);
    }
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
