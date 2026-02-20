import { effect, inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MediaService } from './media.service';
import { AccountStateService } from './account-state.service';
import { NostriaService } from '../interfaces';
import { BadgeService } from './badge.service';
import { NotificationService } from './notification.service';
import { NostrService, NostrUser } from './nostr.service';
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
  private skipNextExtensionPubkeyVerificationFor: string | null = null;
  private extensionPubkeyVerificationInFlightFor: string | null = null;

  constructor() {
    effect(async () => {
      const account = this.accountState.account();
      if (account) {
        try {
          if (account.source === 'extension') {
            // Trigger extension pubkey verification as early as possible on startup.
            // This runs in the background and never blocks loading.
            this.startExtensionPubkeyVerification(account);
          }

          // Clear previous account state first
          this.clear();

          // FAST PATH: Load cached data IMMEDIATELY (before waiting for extension)
          // This makes following list, profile, and mute list available immediately
          // Cached data is just database reads - no signing/extension needed
          const startTime = Date.now();
          this.logger.info('[StateService] Loading cached data from storage (fast path)');
          await this.nostr.loadCachedData();
          this.logger.info(`[StateService] Cached data loaded in ${Date.now() - startTime}ms`);

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

  private startExtensionPubkeyVerification(account: NostrUser): void {
    if (this.skipNextExtensionPubkeyVerificationFor === account.pubkey) {
      this.logger.info('[StateService] Skipping redundant extension pubkey verification for account', {
        pubkey: account.pubkey.substring(0, 16),
      });
      this.skipNextExtensionPubkeyVerificationFor = null;
      return;
    }

    if (this.extensionPubkeyVerificationInFlightFor === account.pubkey) {
      return;
    }

    this.extensionPubkeyVerificationInFlightFor = account.pubkey;

    if (this.utilities.isBrowser() && window.nostr) {
      this.logger.info('[StateService] Browser extension already available, requesting pubkey immediately');
      this.verifyExtensionPubkey(account);
      this.extensionPubkeyVerificationInFlightFor = null;
      return;
    }

    void (async () => {
      this.logger.info('[StateService] Extension account detected, waiting for browser extension...');

      // Use a longer timeout because extension injection can be delayed during startup.
      const extensionAvailable = await this.utilities.waitForNostrExtension(20000);
      if (!extensionAvailable) {
        this.logger.warn('[StateService] Browser extension not available after timeout');
        return;
      }

      this.logger.info('[StateService] Browser extension is ready');
      this.verifyExtensionPubkey(account);
    })().finally(() => {
      if (this.extensionPubkeyVerificationInFlightFor === account.pubkey) {
        this.extensionPubkeyVerificationInFlightFor = null;
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
    // Returns true if user has a kind 10086 event, false otherwise
    const hasDiscoveryRelays = await this.discoveryRelay.load(pubkey);

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
      await this.ensureDefaultDiscoveryRelays(pubkey, hasDiscoveryRelays);
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
   * @param pubkey The user's public key
   * @param hasDiscoveryRelays Whether the user already has a kind 10086 event (from load() result)
   */
  private async ensureDefaultDiscoveryRelays(pubkey: string, hasDiscoveryRelays: boolean): Promise<void> {
    try {
      if (!hasDiscoveryRelays) {
        // User has no kind 10086 event, create and publish defaults
        this.logger.info('[StateService] User has no discovery relays (kind 10086), setting defaults');

        // Get default discovery relays based on user's region
        const region = this.accountState.account()?.region || 'eu';
        const defaultRelays = this.discoveryRelay.getDefaultDiscoveryRelays(region);

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

  /**
   * Non-blocking verification of the extension's active pubkey.
   * 
   * Browser extensions (NIP-07) can have multiple accounts. The user may have
   * switched their active key in the extension since last using the app. We
   * optimistically continue with the stored account, but fire off a
   * getPublicKey() request in the background. If the returned pubkey differs,
   * we switch to that account (existing or newly created).
   * 
   * Some extensions (e.g. nos2x) require user approval via a popup for
   * getPublicKey(). If the user doesn't interact with it, the promise hangs
   * forever, so we apply a timeout.
   */
  private verifyExtensionPubkey(currentAccount: NostrUser): void {
    if (!window.nostr) {
      return;
    }

    this.logger.info('[StateService] Querying extension for active pubkey (non-blocking)');

    // Timeout: extensions that require user approval via a popup may hang
    // indefinitely if the user doesn't interact with the popup.
    const TIMEOUT_MS = 60000;
    const timeoutPromise = new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error('Extension getPublicKey() timed out')), TIMEOUT_MS);
    });

    // Fire-and-forget — don't await, don't block the app
    Promise.race([
      window.nostr.getPublicKey(),
      timeoutPromise,
    ]).then(async (extensionPubkey) => {
      if (!extensionPubkey) {
        this.logger.warn('[StateService] Extension returned empty pubkey');
        return;
      }

      // Same pubkey — nothing to do
      if (extensionPubkey === currentAccount.pubkey) {
        this.logger.info('[StateService] Extension pubkey matches current account');
        return;
      }

      // Different pubkey — the user switched keys in their extension
      this.logger.info('[StateService] Extension pubkey differs from current account', {
        current: currentAccount.pubkey.substring(0, 16),
        extension: extensionPubkey.substring(0, 16),
      });

      // We already know the active extension pubkey from this request.
      // Mark the next account-change cycle to avoid a redundant second request.
      this.skipNextExtensionPubkeyVerificationFor = extensionPubkey;

      // Check if we already have this account
      const existingAccount = this.accountState.accounts().find(
        (a) => a.pubkey === extensionPubkey
      );

      if (existingAccount) {
        // Switch to the existing account
        this.logger.info('[StateService] Switching to existing account from extension');
        await this.nostr.switchToUser(extensionPubkey);
      } else {
        // Create a new extension account and switch to it
        this.logger.info('[StateService] Creating new account from extension pubkey');
        const newUser: NostrUser = {
          pubkey: extensionPubkey,
          name: this.utilities.getTruncatedNpub(extensionPubkey),
          source: 'extension',
          lastUsed: Date.now(),
          hasActivated: true,
        };
        await this.nostr.setAccount(newUser);
      }
    }).catch((error) => {
      // Don't disrupt the app if the extension rejects or times out.
      // Timeout is expected for extensions that require popup approval —
      // the user will still be asked to approve when they first sign an event.
      this.logger.warn('[StateService] Extension getPublicKey() failed (non-blocking)', error);
    });
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
