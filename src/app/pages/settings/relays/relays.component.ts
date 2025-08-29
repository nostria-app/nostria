import {
  Component,
  effect,
  inject,
  signal,
  OnInit,
  OnDestroy,
  untracked,
  computed,
  ViewChild,
  TemplateRef,
} from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RelayInfoDialogComponent } from './relay-info-dialog.component';
import { RelayPingResultsDialogComponent, PingResult } from './relay-ping-results-dialog.component';
import { kinds, SimplePool, UnsignedEvent } from 'nostr-tools';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { LayoutService } from '../../../services/layout.service';
import { StorageService } from '../../../services/storage.service';
import { NotificationService } from '../../../services/notification.service';
import { ApplicationService } from '../../../services/application.service';
import { ProfileStateService } from '../../../services/profile-state.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { AccountStateService } from '../../../services/account-state.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { DataService } from '../../../services/data.service';
import { InfoTooltipComponent } from '../../../components/info-tooltip/info-tooltip.component';
import { Relay } from '../../../services/relays/relay';
import { DiscoveryRelayService } from '../../../services/relays/discovery-relay';

@Component({
  selector: 'app-relays-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatSlideToggleModule,
    MatTabsModule,
    MatDividerModule,
    InfoTooltipComponent,
  ],
  templateUrl: './relays.component.html',
  styleUrl: './relays.component.scss',
})
export class RelaysComponent implements OnInit, OnDestroy {
  // relay = inject(RelayService);
  private nostr = inject(NostrService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private layout = inject(LayoutService);
  private storage = inject(StorageService);
  private notifications = inject(NotificationService);
  private app = inject(ApplicationService);
  private profileState = inject(ProfileStateService);
  private readonly utilities = inject(UtilitiesService);
  private readonly accountState = inject(AccountStateService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly discoveryRelay = inject(DiscoveryRelayService);
  private readonly data = inject(DataService);

  followingRelayUrls = signal<string[]>([]);
  newRelayUrl = signal('');
  newBootstrapUrl = signal('');
  // New signals for deprecated following list relay cleanup feature
  showFollowingRelayCleanup = signal(false);
  isCleaningFollowingList = signal(false);
  // Show DM relay update card unless already matching
  showUpdateDMRelays = signal(false);

  // Template references for tooltip content
  @ViewChild('userRelaysInfoContent')
  userRelaysInfoContent!: TemplateRef<unknown>;
  @ViewChild('discoveryRelaysInfoContent')
  discoveryRelaysInfoContent!: TemplateRef<unknown>;

  // Timer for connection status checking
  private statusCheckTimer: any;
  private readonly STATUS_CHECK_INTERVAL = 30000; // 30 seconds

  // Create signals that use the new relaysSignal from the base services
  userRelays = computed(() => {
    return this.accountRelay.relaysSignal();
  });

  discoveryRelays = computed(() => {
    return this.discoveryRelay.relaysSignal();
  });

  // Keep the existing computed signal for backward compatibility
  relays = computed(() => {
    return this.accountRelay.relaysModifiedSignal();
  });

  // For closest relay feature
  isCheckingRelays = signal(false);
  knownDiscoveryRelays = [
    'wss://discovery.eu.nostria.app',
    'wss://discovery.us.nostria.app',
    'wss://discovery.af.nostria.app',
  ];

  constructor() {
    effect(() => {
      if (this.app.authenticated()) {
        untracked(() => {
          // Start the connection status checking interval
          this.startStatusChecking();
        });
      }
    });
    // Effect to re-check following list when active pubkey changes
    effect(async () => {
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        await this.checkFollowingListForRelays(pubkey);
        await this.checkDirectMessageRelayList(pubkey);
      } else {
        this.showFollowingRelayCleanup.set(false);
        this.showUpdateDMRelays.set(false);
      }
    });
  }

  // Async method to detect if contact list (kind 3) contains relay URLs in content
  private async checkFollowingListForRelays(pubkey: string) {
    try {
      const followingEvent = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.Contacts);
      if (!followingEvent) {
        this.showFollowingRelayCleanup.set(false);
        return;
      }
      // If content is object (deprecated structure) and utilities can extract relay urls
      const relayUrls = this.utilities.getRelayUrlsFromFollowing(followingEvent as any);

      this.followingRelayUrls.set(relayUrls);

      const hasRelays = relayUrls.length > 0;
      this.showFollowingRelayCleanup.set(hasRelays);
    } catch (err) {
      this.logger.error('Failed to check following list for relays', err);
      this.showFollowingRelayCleanup.set(false);
    }
  }

  private async checkDirectMessageRelayList(pubkey: string) {
    try {
      // Get current user relay list (kind 10002) from storage (already have in memory as this.relay.relays)
      const userRelayUrls = this.utilities.normalizeRelayUrls(
        this.accountRelay.getRelayUrls().map((r) => r),
      );

      // Fetch existing DM relay list event (10050)
      const dmRelayEvent = await this.data.getEventByPubkeyAndKind(
        pubkey,
        kinds.DirectMessageRelaysList,
      );
      if (!dmRelayEvent) {
        this.showUpdateDMRelays.set(true); // Need to create one
        return;
      }

      // Extract relay tag URLs from dmRelayEvent
      const dmRelayUrls = dmRelayEvent.event.tags
        .filter((t) => t[0] === 'relay' && t[1])
        .map((t) => t[1]);
      const normalizedDMUrls = this.utilities.normalizeRelayUrls(dmRelayUrls);

      // Compare sets (unordered)
      const setA = new Set(userRelayUrls);
      const setB = new Set(normalizedDMUrls);
      const same = setA.size === setB.size && [...setA].every((u) => setB.has(u));

      this.showUpdateDMRelays.set(!same);
    } catch (err) {
      this.logger.error('Failed to check DM relay list', err);
      this.showUpdateDMRelays.set(true);
    }
  }

  ngOnInit() { }

  cleanFollowingList() {
    if (this.isCleaningFollowingList()) {
      return;
    }
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.showMessage('No active account');
      return;
    }
    this.isCleaningFollowingList.set(true);

    (async () => {
      try {
        const followingEvent = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.Contacts);
        if (!followingEvent) {
          this.showMessage('Following list not found');
          this.isCleaningFollowingList.set(false);
          return;
        }

        // Only proceed if deprecated relay data exists in content (object with relay keys)
        const relayUrls = this.utilities.getRelayUrlsFromFollowing(followingEvent as any);
        if (relayUrls.length === 0) {
          this.showMessage('No deprecated relay entries found');
          this.showFollowingRelayCleanup.set(false);
          this.isCleaningFollowingList.set(false);
          return;
        }

        // Preserve existing p and other tags; just strip relays from content by setting to empty string
        const updatedEvent: UnsignedEvent = {
          pubkey: followingEvent.pubkey,
          kind: kinds.Contacts,
          created_at: Math.floor(Date.now() / 1000),
          tags: [...followingEvent.tags],
          content: '',
        };
        const signed = await this.nostr.signEvent(updatedEvent);
        await this.accountRelay.publish(signed); // publish to user relays
        await this.storage.saveEvent(signed);
        this.showMessage('Deprecated relays removed from following list');
        this.showFollowingRelayCleanup.set(false);
      } catch (err) {
        this.logger.error('Failed cleaning following list', err);
        this.showMessage('Error removing relays');
      } finally {
        this.isCleaningFollowingList.set(false);
      }
    })();
  }

  ngOnDestroy() {
    // Clean up the interval when component is destroyed
    this.stopStatusChecking();
  }

  private startStatusChecking() {
    // Clear any existing timer first
    this.stopStatusChecking();

    // Create new timer that runs every 10 seconds
    this.statusCheckTimer = setInterval(() => {
      this.checkRelayConnectionStatus();
    }, this.STATUS_CHECK_INTERVAL);

    // Make the initial check a little bit delayed, if user reloads on the relay page, they
    // might return disconnected?
    setTimeout(() => {
      // Run an initial check immediately
      this.checkRelayConnectionStatus();
    }, 2000);

    this.logger.debug('Started relay connection status checking');
  }

  private stopStatusChecking() {
    if (this.statusCheckTimer) {
      clearInterval(this.statusCheckTimer);
      this.statusCheckTimer = null;
      this.logger.debug('Stopped relay connection status checking');
    }
  }

  /**
   * Check connection status of all relays using the pool's listConnectionStatus method
   */
  private checkRelayConnectionStatus() {
    const userPool = this.accountRelay.getPool();

    if (!userPool) {
      this.logger.warn('Cannot check relay status: user pool is not initialized');
      return;
    }

    const connectionStatusMap = userPool.listConnectionStatus();
    this.logger.debug('Retrieved relay connection statuses', connectionStatusMap);

    console.log('SEEN ON!!');
    console.log(userPool.seenOn);

    // Update the status of each relay in our user relays list
    this.userRelays().forEach((relay) => {
      // Check if this relay URL exists in the connection status map
      if (connectionStatusMap.has(relay.url)) {
        const isConnected = connectionStatusMap.get(relay.url);
        const newStatus = isConnected ? 'connected' : 'disconnected';

        // Only update if status has changed
        if (relay.status !== newStatus) {
          this.logger.debug(`Updating relay ${relay.url} status to ${newStatus}`);
          this.accountRelay.updateRelayStatus(relay.url, newStatus);
        }
      }
    });

    // Also check discovery relays if we have a discovery pool
    const discoveryPool = this.discoveryRelay.getPool();
    if (discoveryPool) {
      const discoveryConnectionStatusMap = discoveryPool.listConnectionStatus();
      this.discoveryRelays().forEach((relay) => {
        if (discoveryConnectionStatusMap.has(relay.url)) {
          const isConnected = discoveryConnectionStatusMap.get(relay.url);
          const newStatus = isConnected ? 'connected' : 'disconnected';

          if (relay.status !== newStatus) {
            this.logger.debug(`Updating discovery relay ${relay.url} status to ${newStatus}`);
            this.discoveryRelay.updateRelayStatus(relay.url, newStatus);
          }
        }
      });
    }
  }

  parseUrl(relayUrl: string) {
    let url = relayUrl.trim();

    if (!url) {
      this.showMessage('Please enter a valid relay URL');
      return;
    }

    // Check if the URL has a valid protocol
    if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      // Default to wss:// if no protocol is specified
      url = `wss://${url}`;
    }

    // Only append trailing slash if there's no path component (just domain)
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.pathname === '/') {
        url = url.endsWith('/') ? url : `${url}/`;
      }
    } catch (e) {
      this.logger.error('Invalid URL format', { url, error: e });
      this.showMessage('Invalid URL format');
      return;
    }

    return url;
  }

  async addRelay() {
    const url = this.parseUrl(this.newRelayUrl());

    if (!url) {
      return;
    }

    this.newRelayUrl.set(url);

    // Check if relay already exists
    if (this.accountRelay.getRelayUrls().some((relay) => relay === url)) {
      this.showMessage('This relay is already in your list');
      return;
    }

    // Open the relay info dialog
    const dialogRef = this.dialog.open(RelayInfoDialogComponent, {
      width: '500px',
      data: {
        relayUrl: url,
        adding: true,
      },
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result?.confirmed) {
        this.logger.info('Adding new relay', {
          url,
          migrateData: result.migrateData,
        });
        this.accountRelay.addRelay(url);

        await this.publish();

        if (result.migrateData) {
          // Handle data migration logic here
          this.logger.info('Beginning data migration to relay', { url });
          this.showMessage('Data migration to new relay has been scheduled');
        }

        this.newRelayUrl.set('');
        this.showMessage('Relay added successfully');
      }
    });
  }

  viewRelayInfo(relayUrl: string): void {
    const dialogRef = this.dialog.open(RelayInfoDialogComponent, {
      width: '500px',
      data: {
        relayUrl: relayUrl,
        adding: false, // Set to false to indicate viewing only
      },
    });
  }

  async removeRelay(relay: Relay) {
    this.logger.info('Removing relay', { url: relay.url });
    this.accountRelay.removeRelay(relay.url);
    await this.publish();
    this.showMessage('Relay removed');
  }

  async publish() {
    this.logger.info('Starting relay list publication process');

    const relays = this.accountRelay.getRelayUrls();
    this.logger.debug('User relays being published:', relays);

    const tags = this.nostr.createTags(
      'r',
      relays.map((relay) => relay),
    );

    const relayListEvent = this.nostr.createEvent(kinds.RelayList, '', tags);

    this.logger.debug('Created relay list event', relayListEvent);

    const signedEvent = await this.nostr.signEvent(relayListEvent);
    this.logger.debug('Signed relay list event', signedEvent);

    // Make sure the relay list is published both to the user's relays and discovery relays.
    const callbacks1 = await this.accountRelay.publish(signedEvent);
    const callbacks2 = await this.discoveryRelay.publish(signedEvent);

    // Combine all callbacks into a flat array for tracking
    const allCallbacks = [...(callbacks1 || []), ...(callbacks2 || [])].flat();

    const relayUrls = [
      ...this.accountRelay.getRelayUrls().map((relay) => relay),
      ...this.discoveryRelay.getRelayUrls(),
    ];
    this.logger.debug('Publishing to relay URLs:', relayUrls);

    // Create a mapping of callbacks to their respective relay URLs
    const callbackRelayMapping = new Map<Promise<string>, string>();

    callbacks1?.forEach((callback, i) => {
      // Map callbacks to user relay URLs (if they exist)
      if (i < this.accountRelay.getRelayUrls().length) {
        callbackRelayMapping.set(callback, this.accountRelay.getRelayUrls()[i]);
      }
    });

    callbacks2?.forEach((callback, i) => {
      // Map callbacks to bootstrap relay URLs (if they exist)
      if (i < this.discoveryRelay.getRelayUrls().length) {
        callbackRelayMapping.set(callback, this.discoveryRelay.getRelayUrls()[i]);
      }
    });

    // Pass the original callback arrays to the notification service
    this.notifications.addRelayPublishingNotification(signedEvent, callbackRelayMapping);

    // this.relay.getUserPool();

    await this.storage.saveEvent(signedEvent);
    this.logger.debug('Saved relay list event to storage');
  }

  addBootstrapRelay(): void {
    const url = this.parseUrl(this.newBootstrapUrl());

    if (!url) {
      return;
    }

    this.newBootstrapUrl.set(url);

    // Check if relay already exists
    if (this.discoveryRelay.getRelayUrls().includes(url)) {
      this.showMessage('This Discovery Relay is already in your list');
      return;
    }

    this.logger.info('Adding new Discovery Relay', { url });
    this.discoveryRelay.addRelay(url);
    this.newBootstrapUrl.set('');
    this.showMessage('Discovery Relay added successfully');

    // This will also save.
    this.discoveryRelay.setDiscoveryRelays(this.discoveryRelay.getRelayUrls());
  }

  removeDiscoveryRelay(url: string): void {
    this.logger.info('Removing Discovery Relay', { url });
    this.discoveryRelay.removeRelay(url);
    this.showMessage('Discovery Relay removed');
    this.discoveryRelay.setDiscoveryRelays(this.discoveryRelay.getRelayUrls());
  }

  getStatusIcon(status: Relay['status'] | undefined): string {
    switch (status) {
      case 'connected':
        return 'check_circle';
      case 'connecting':
        return 'hourglass_empty';
      case 'error':
        return 'error';
      case 'disconnected':
      default:
        return 'cancel'; // Changed from radio_button_unchecked to cancel for more serious look
    }
  }

  getStatusColor(status: Relay['status'] | undefined): string {
    switch (status) {
      case 'connected':
        return 'text-green-500';
      case 'connecting':
        return 'text-yellow-500';
      case 'error':
        return 'text-red-500';
      case 'disconnected':
      default:
        return 'text-orange-500'; // Changed from text-gray-500 to text-orange-500 for more serious look
    }
  }

  formatRelayUrl(url: string): string {
    // Remove wss:// prefix for better UX
    return url.replace(/^wss:\/\//, '');
  }

  private showMessage(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 3000,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }

  async updateDirectMessageRelayList() {
    const relayUrls = this.relays().map((relay) => {
      return relay;
    });
    const normalizedUrls = this.utilities.normalizeRelayUrls(relayUrls);
    const relayTags = this.nostr.createTags('relay', normalizedUrls);
    const pubkey = this.accountState.pubkey();

    // const relayTags = this.createTags('r', [relayServerUrl!]);

    // Create Relay List event for the new user
    const relayListEvent: UnsignedEvent = {
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: kinds.DirectMessageRelaysList,
      tags: relayTags,
      content: '',
    };

    const signedEvent = await this.nostr.signEvent(relayListEvent);
    const publishResults = this.accountRelay.publish(signedEvent);
  }

  async findClosestRelay(): Promise<void> {
    this.isCheckingRelays.set(true);
    this.logger.info('Starting latency check to find closest discovery relay');

    // Combine user's discovery relays with known ones, removing duplicates
    const relaysToCheck = [
      ...new Set([...this.discoveryRelay.getRelayUrls(), ...this.knownDiscoveryRelays]),
    ];

    this.logger.debug('Checking relays for latency', {
      count: relaysToCheck.length,
    });
    this.showMessage(`Checking ${relaysToCheck.length} discovery relays for latency...`);

    try {
      // Check latency for all relays
      const pingResults = await Promise.allSettled(
        relaysToCheck.map((url) => this.checkRelayPing(url)),
      );

      // Process results
      const successfulPings = pingResults
        .map((result, index) => ({
          url: relaysToCheck[index],
          pingTime: result.status === 'fulfilled' ? result.value : Infinity,
          isAlreadyAdded: this.discoveryRelay.getRelayUrls().includes(relaysToCheck[index]),
        }))
        .filter((result) => result.pingTime !== Infinity)
        .sort((a, b) => a.pingTime - b.pingTime);

      this.logger.debug('Latency results', { successfulPings });

      if (successfulPings.length === 0) {
        this.showMessage('No reachable discovery relays found');
        this.isCheckingRelays.set(false);
        return;
      }

      // Show dialog with results
      const dialogRef = this.dialog.open(RelayPingResultsDialogComponent, {
        width: '500px',
        data: {
          results: successfulPings,
        },
      });

      dialogRef.afterClosed().subscribe((result) => {
        if (result?.selected) {
          const selectedRelay = result.selected as PingResult;

          // Run in setTimeout to avoid the ExpressionChangedAfterItHasBeenCheckedError
          setTimeout(() => {
            this.discoveryRelay.addRelay(selectedRelay.url);
            this.discoveryRelay.setDiscoveryRelays(this.discoveryRelay.getRelayUrls());
            this.showMessage(`Added ${this.formatRelayUrl(selectedRelay.url)} to discovery relays`);
          }, 0);
        }
      });
    } catch (error) {
      this.logger.error('Error finding closest relay', error);
      this.showMessage('Error finding closest relay');
    } finally {
      this.isCheckingRelays.set(false);
    }
  }

  private async checkRelayPing(relayUrl: string): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      let startTime: number;

      try {
        // Use WebSocket for ping checking since we're testing relay connections
        startTime = performance.now();
        const ws = new WebSocket(relayUrl);

        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Timeout'));
        }, 5000); // 5 second timeout

        ws.onopen = () => {
          // Connection established, calculate ping time
          const pingTime = Math.round(performance.now() - startTime);
          clearTimeout(timeout);

          // Send a simple ping message if possible
          try {
            ws.send(JSON.stringify(['REQ', 'ping-check', {}]));
          } catch (e) {
            // Ignore errors when sending ping
          }

          // Start closing the connection
          ws.close();
          resolve(pingTime);
        };

        ws.onerror = (error) => {
          clearTimeout(timeout);
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }
}
