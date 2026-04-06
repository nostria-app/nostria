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
import { DiscoveryRelayListKind } from './relays/discovery-relay';
import { DatabaseService } from './database.service';
import { kinds } from 'nostr-tools';
import { MEDIA_SERVERS_EVENT_KIND } from '../interfaces';
import { RegionService } from './region.service';

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
  private readonly database = inject(DatabaseService);
  private readonly region = inject(RegionService);
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
          await this.nostr.loadCachedData();

          await this.load();
        } catch (error) {
          this.logger.error('[StateService] Error during account change', error);
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
      this.skipNextExtensionPubkeyVerificationFor = null;
      return;
    }

    if (this.extensionPubkeyVerificationInFlightFor === account.pubkey) {
      return;
    }

    this.extensionPubkeyVerificationInFlightFor = account.pubkey;

    if (this.utilities.isBrowser() && window.nostr) {
      void this.verifyExtensionPubkey(account).finally(() => {
        if (this.extensionPubkeyVerificationInFlightFor === account.pubkey) {
          this.extensionPubkeyVerificationInFlightFor = null;
        }
      });
      return;
    }

    void (async () => {
      // Use a longer timeout because extension injection can be delayed during startup.
      const extensionAvailable = await this.utilities.waitForNostrExtension(20000);
      if (!extensionAvailable) {
        this.logger.warn('[StateService] Browser extension not available after timeout');
        return;
      }

      await this.verifyExtensionPubkey(account);
    })().finally(() => {
      if (this.extensionPubkeyVerificationInFlightFor === account.pubkey) {
        this.extensionPubkeyVerificationInFlightFor = null;
      }
    });
  }

  async load() {
    const pubkey = this.accountState.pubkey();

    // NOTE: Cached data (following list, profile, mute list) was already loaded
    // in the constructor effect before waiting for extension - see loadCachedData() call above

    // This is never called for anonymous accounts.
    // Load discovery relays, passing the pubkey to check for kind 10086 event in local DB.
    // If not found locally, default bootstrap relays are used immediately (no signing needed yet).
    // The actual relay query and potential signing happens later, after account relays are connected.
    const hasDiscoveryRelaysLocally = await this.discoveryRelay.load(pubkey);

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
          panelClass: 'safe-area-top-snackbar',
        }
      );
    }

    // OPTIMIZATION: Run independent operations in parallel after relay setup
    // These operations don't depend on each other and can load simultaneously
    const settingsPromise = (async () => {
      await this.settingsService.loadSettings(pubkey);
      this.settingsService.settingsLoaded.set(true);
    })();

    const accountStatePromise = (async () => {
      await this.accountState.load();
    })();

    const notificationPromise = (async () => {
      if (!this.notification.notificationsLoaded()) {
        await this.notification.loadNotifications();
      }
    })();

    // Wait for all parallel operations to complete
    await Promise.all([
      settingsPromise,
      accountStatePromise,
      notificationPromise,
    ]);

    // Start relay subscriptions (this will fetch fresh data in background)
    // Note: nostr.loadCachedData() was already called above for fast startup
    // This can run after other parallel operations since it's for background refresh
    await this.nostr.loadFromRelays();

    // Ensure discovery relays AFTER account relays are connected and subscription has started.
    // This is intentionally deferred: we first use default discovery relays, then query account
    // relays for the user's existing kind 10086 event. Only if it's truly not found anywhere
    // do we create, sign, and publish a new one. This prevents unnecessary signing prompts
    // for users who already have a kind 10086 event on their relays.
    await this.ensureDefaultDiscoveryRelays(pubkey, hasDiscoveryRelaysLocally);

    await this.migrateLegacyInfrastructureUrls(pubkey);

    // Media load can also be parallelized but let's keep it sequential for now
    // as it's lower priority and depends on media servers being available
    await this.media.load();

    // Schedule historical events scan for engagement metrics
    // Uses built-in timeout management to prevent duplicate scans
    this.metricsTracking.scheduleHistoricalScan();

    // NOTE: We don't automatically load chats here anymore
    // Chats are loaded on-demand when the user navigates to the messages page
    // This saves bandwidth and improves privacy
  }

  /**
   * Ensure the user has discovery relays configured, querying account relays if needed.
   * Only creates and signs a new kind 10086 event if the user truly doesn't have one.
   *
   * Flow:
   * 1. If local DB already has a kind 10086 event → done.
   * 2. Query account relays for an existing kind 10086 event.
   * 3. If found → save locally, update discovery relays, done.
   * 4. Re-check local DB (the subscription may have delivered the event in the meantime).
   * 5. If still not found anywhere → create defaults, sign, and publish.
   *
   * @param pubkey The user's public key
   * @param hasDiscoveryRelaysLocally Whether the local DB already has a kind 10086 event
   */
  private async ensureDefaultDiscoveryRelays(pubkey: string, hasDiscoveryRelaysLocally: boolean): Promise<void> {
    try {
      if (hasDiscoveryRelaysLocally) {
        return;
      }

      // Local DB didn't have kind 10086 — query account relays.
      // Account relays are fully connected at this point and the subscription has started,
      // so this one-shot query has the best chance of finding the event.
      const existingDiscoveryEvent = await this.accountRelay.getEventByPubkeyAndKind(pubkey, DiscoveryRelayListKind);

      if (existingDiscoveryEvent) {
        const relayUrls = this.discoveryRelay.getRelayUrlsFromDiscoveryEvent(existingDiscoveryEvent);
        this.discoveryRelay.setDiscoveryRelays(relayUrls);

        await this.discoveryRelay.saveEvent(existingDiscoveryEvent);
        return;
      }

      // Account relays didn't have it either. Re-check local DB one more time —
      // the background subscription (loadFromRelays) may have delivered and saved the
      // event while we were waiting for the account relay query to complete.
      const relaysFromEvent = await this.discoveryRelay.loadFromEvent(pubkey);
      if (relaysFromEvent !== null) {
        this.discoveryRelay.setDiscoveryRelays(relaysFromEvent);
        return;
      }

      // Truly not found anywhere — create and publish defaults.
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

        // Publish to account relays only.
        // Some discovery/indexer relays reject non-10002 events and create avoidable console noise.
        // Using allSettled keeps this non-blocking for startup.
        await Promise.allSettled([
          this.accountRelay.publish(signedEvent),
        ]);
      } else {
        this.logger.warn('[StateService] Failed to sign discovery relay event');
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
  private async verifyExtensionPubkey(currentAccount: NostrUser): Promise<void> {
    if (!window.nostr) {
      return;
    }

    const TIMEOUT_MS = 60000;
    try {
      // Route pubkey verification through NostrService so extension requests are
      // serialized with signing/NIP-98 prompts instead of racing each other.
      const extensionPubkey = await this.nostr.getExtensionPublicKey(TIMEOUT_MS);

      if (!extensionPubkey) {
        this.logger.warn('[StateService] Extension returned empty pubkey');
        return;
      }

      // Same pubkey — nothing to do
      if (extensionPubkey === currentAccount.pubkey) {
        return;
      }

      // We already know the active extension pubkey from this request.
      // Mark the next account-change cycle to avoid a redundant second request.
      this.skipNextExtensionPubkeyVerificationFor = extensionPubkey;

      // Check if we already have this account
      const existingAccount = this.accountState.accounts().find(
        (a) => a.pubkey === extensionPubkey
      );

      if (existingAccount) {
        // Switch to the existing account
        await this.nostr.switchToUser(extensionPubkey);
      } else {
        // Create a new extension account and switch to it
        const newUser: NostrUser = {
          pubkey: extensionPubkey,
          name: this.utilities.getTruncatedNpub(extensionPubkey),
          source: 'extension',
          lastUsed: Date.now(),
          hasActivated: true,
        };
        await this.nostr.setAccount(newUser);
      }
    } catch (error) {
      // Don't disrupt the app if the extension rejects or times out.
      // Timeout is expected for extensions that require popup approval —
      // the user will still be asked to approve when they first sign an event.
      this.logger.warn('[StateService] Extension getPublicKey() failed (non-blocking)', error);
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

  private async migrateLegacyInfrastructureUrls(pubkey: string): Promise<void> {
    await this.migrateLegacyRelayEvent(pubkey, kinds.RelayList, 'r');
    await this.migrateLegacyRelayEvent(pubkey, kinds.DirectMessageRelaysList, 'relay');
    await this.migrateLegacyRelayEvent(pubkey, DiscoveryRelayListKind, 'relay');
    await this.migrateLegacyMediaServers(pubkey);
  }

  private async migrateLegacyRelayEvent(pubkey: string, kind: number, tagName: 'r' | 'relay'): Promise<void> {
    const event = await this.database.getEventByPubkeyAndKind(pubkey, kind);
    if (!event) {
      return;
    }

    let changed = false;
    const updatedTags = event.tags.map(tag => {
      if (tag[0] !== tagName || !tag[1]) {
        return tag;
      }

      const rewrittenUrl = this.utilities.normalizeRelayUrl(tag[1], true, {
        source: tagName === 'r' ? 'account-relays' : 'discovery-relays',
        ownerPubkey: pubkey,
        eventKind: kind,
        details: 'legacy Nostria relay migration',
      });

      if (!rewrittenUrl || rewrittenUrl === tag[1]) {
        return tag;
      }

      changed = true;
      return [tag[0], rewrittenUrl, ...tag.slice(2)];
    });

    if (!changed) {
      return;
    }

    const result = await this.nostr.signAndPublish(this.nostr.createEvent(kind, event.content, updatedTags));
    if (!result.success) {
      this.logger.warn('[StateService] Failed to publish migrated relay event; runtime override remains active', {
        pubkey,
        kind,
        error: result.error,
      });
    }
  }

  private async migrateLegacyMediaServers(pubkey: string): Promise<void> {
    const event = await this.database.getEventByPubkeyAndKind(pubkey, MEDIA_SERVERS_EVENT_KIND);
    if (!event) {
      return;
    }

    const currentServers = event.tags
      .filter(tag => tag[0] === 'server' && !!tag[1])
      .map(tag => tag[1]);
    const { urls: rewrittenServers, changed } = this.region.rewriteMediaServerUrls(currentServers);

    if (!changed) {
      return;
    }

    this.media.setMediaServers(rewrittenServers);

    try {
      await this.media.publishMediaServers();
    } catch (error) {
      this.logger.warn('[StateService] Failed to publish migrated media server event; runtime override remains active', {
        pubkey,
        error,
      });
    }
  }
}
