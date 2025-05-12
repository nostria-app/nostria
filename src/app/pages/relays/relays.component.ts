import { Component, effect, inject, signal, OnInit, OnDestroy, untracked, computed } from '@angular/core';
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
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RelayService, Relay } from '../../services/relay.service';
import { LoggerService } from '../../services/logger.service';
import { RelayInfoDialogComponent } from './relay-info-dialog.component';
import { LayoutService } from '../../services/layout.service';
import { NostrService } from '../../services/nostr.service';
import { kinds, SimplePool } from 'nostr-tools';
import { StorageService } from '../../services/storage.service';
import { NotificationService } from '../../services/notification.service';
import { ApplicationService } from '../../services/application.service';

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
    MatTabsModule
  ],
  templateUrl: './relays.component.html',
  styleUrl: './relays.component.scss'
})
export class RelaysComponent implements OnInit, OnDestroy {
  relay = inject(RelayService);
  private nostr = inject(NostrService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private layout = inject(LayoutService);
  private storage = inject(StorageService);
  private notifications = inject(NotificationService);
  private app = inject(ApplicationService);

  newRelayUrl = signal('');
  newBootstrapUrl = signal('');

  // Timer for connection status checking
  private statusCheckTimer: any;
  private readonly STATUS_CHECK_INTERVAL = 30000; // 30 seconds

  // Create a computed signal that depends on both the array and the change flag
  relays = computed(() => {
    return this.relay.relaysChanged();
  });

  // For closest relay feature
  isCheckingRelays = signal(false);
  knownDiscoveryRelays = [
    'wss://relay.angor.io',
    'wss://discovery-eu.nostria.app',
    'wss://discovery-af.nostria.app',
    'wss://purplepag.es',
  ];

  constructor() {
    effect(() => {
      if (this.app.authenticated()) {

        console.log(this.relay.getUserPool());
        console.log(this.relay.getUserPool()?.listConnectionStatus());

        untracked(() => {
          // Start the connection status checking interval
          this.startStatusChecking();
        });
      }
    });
  }

  ngOnInit() {

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
    const userPool = this.relay.getUserPool();
    if (!userPool) {
      this.logger.warn('Cannot check relay status: user pool is not initialized');
      return;
    }

    const connectionStatusMap = userPool.listConnectionStatus();
    this.logger.debug('Retrieved relay connection statuses', connectionStatusMap);

    console.log('SEEN ON!!');
    console.log(userPool.seenOn);

    // Update the status of each relay in our list
    this.relay.relays.forEach(relay => {
      // Check if this relay URL exists in the connection status map
      if (connectionStatusMap.has(relay.url)) {
        const isConnected = connectionStatusMap.get(relay.url);
        const newStatus = isConnected ? 'connected' : 'disconnected';

        // Only update if status has changed
        if (relay.status !== newStatus) {
          this.logger.debug(`Updating relay ${relay.url} status to ${newStatus}`);
          this.relay.updateRelayStatus(relay.url, newStatus);
        }
      }
    });
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
    let url = this.parseUrl(this.newRelayUrl());

    if (!url) {
      return;
    }

    this.newRelayUrl.set(url);

    // Check if relay already exists
    if (this.relay.relays.some(relay => relay.url === url)) {
      this.showMessage('This relay is already in your list');
      return;
    }

    // Open the relay info dialog
    const dialogRef = this.dialog.open(RelayInfoDialogComponent, {
      width: '500px',
      data: {
        relayUrl: url,
        adding: true,
      }
    });

    dialogRef.afterClosed().subscribe(async result => {
      if (result?.confirmed) {
        this.logger.info('Adding new relay', { url, migrateData: result.migrateData });
        this.relay.addRelay(url);

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
      }
    });
  }

  async removeRelay(relay: Relay) {
    this.logger.info('Removing relay', { url: relay.url });
    this.relay.removeRelay(relay.url);
    await this.publish();
    this.showMessage('Relay removed');

  }

  async publish() {
    this.logger.info('Starting relay list publication process');

    const relays = this.relay.relays;
    this.logger.debug('User relays being published:', relays);

    const tags = this.nostr.createTags('r', relays.map(relay => relay.url));
    const relayListEvent = this.nostr.createEvent(kinds.RelayList, '', tags);

    this.logger.debug('Created relay list event', relayListEvent);

    const signedEvent = await this.nostr.signEvent(relayListEvent);
    this.logger.debug('Signed relay list event', signedEvent);

    // Make sure the relay list is published both to the user's relays and discovery relays.
    const callbacks1 = await this.relay.publish(signedEvent);
    const callbacks2 = await this.relay.publish(signedEvent, this.relay.discoveryRelays);

    // Combine all callbacks into a flat array for tracking
    const allCallbacks = [...(callbacks1 || []), ...(callbacks2 || [])].flat();

    const relayUrls = [...this.relay.relays.map(relay => relay.url), ...this.relay.discoveryRelays];
    this.logger.debug('Publishing to relay URLs:', relayUrls);

    // Create a mapping of callbacks to their respective relay URLs
    const callbackRelayMapping = new Map<Promise<string>, string>();
    callbacks1?.forEach((callback, i) => {
      // Map callbacks to user relay URLs (if they exist)
      if (i < this.relay.relays.length) {
        callbackRelayMapping.set(callback, this.relay.relays[i].url);
      }
    });

    callbacks2?.forEach((callback, i) => {
      // Map callbacks to bootstrap relay URLs (if they exist)
      if (i < this.relay.discoveryRelays.length) {
        callbackRelayMapping.set(callback, this.relay.discoveryRelays[i]);
      }
    });

    // Pass the original callback arrays to the notification service
    this.notifications.addRelayPublishingNotification(signedEvent, callbackRelayMapping);

    this.relay.getUserPool()

    await this.storage.saveEvent(signedEvent);
    this.logger.debug('Saved relay list event to storage');
  }

  addBootstrapRelay(): void {
    let url = this.parseUrl(this.newBootstrapUrl());

    if (!url) {
      return;
    }

    this.newBootstrapUrl.set(url);

    // Check if relay already exists
    if (this.relay.discoveryRelays.includes(url)) {
      this.showMessage('This Discovery Relay is already in your list');
      return;
    }

    this.logger.info('Adding new Discovery Relay', { url });
    this.relay.addDiscoveryRelay(url);
    this.newBootstrapUrl.set('');
    this.showMessage('Discovery Relay added successfully');

    this.relay.saveDiscoveryRelays();
  }

  removeDiscoveryRelay(url: string): void {
    this.logger.info('Removing Discovery Relay', { url });
    this.relay.removeDiscoveryRelay(url);
    this.showMessage('Discovery Relay removed');
    this.relay.saveDiscoveryRelays();
  }

  getStatusIcon(status: Relay['status'] | undefined): string {
    switch (status) {
      case 'connected': return 'check_circle';
      case 'connecting': return 'hourglass_empty';
      case 'error': return 'error';
      case 'disconnected':
      default: return 'cancel'; // Changed from radio_button_unchecked to cancel for more serious look
    }
  }

  getStatusColor(status: Relay['status'] | undefined): string {
    switch (status) {
      case 'connected': return 'text-green-500';
      case 'connecting': return 'text-yellow-500';
      case 'error': return 'text-red-500';
      case 'disconnected':
      default: return 'text-orange-500'; // Changed from text-gray-500 to text-orange-500 for more serious look
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
      verticalPosition: 'bottom'
    });
  }

  async discoveryRelayTest() {
    const relaysUrls = ['ws://localhost:5210'];
    const pubkey = '17e2889fba01021d048a13fd0ba108ad31c38326295460c21e69c43fa8fbe515';
    const pool = new SimplePool();
    const relayList = await pool.get(relaysUrls, {
      kinds: [kinds.RelayList],
      authors: [pubkey],
    }, {
      maxWait: 60000
    });

    console.log(relayList);

    const testEvent = {
      kind: 10002,
      created_at: 1745480732,
      content: '',
      tags: [
        ['r', 'wss://relay.example.com'],
        ['r', 'wss://another.relay.example.com']
      ],
      pubkey: 'eb67f0064b6217d47ae32bdd1286fb89ae6e942a1dcf09c1496febf9609c11e3',
      id: 'b2413a4b148055115bd6a5a4272c69e3690b447e5bedd4c0ffcfdbe8bcd38100',
      sig: 'e52e0fde8c64243d5a0b3013e0bc617037280f1f377c041b535799648a776430f3be13c79192fc0d7d9932deaeed05c35e61eecffc57beb355c6258716402afc',
    };

    const testResult = await pool.publish(relaysUrls, testEvent);
    console.log(testResult);

    const tags = this.nostr.createTags('r', ['wss://localhost:5210']);
    const eventTempate = this.nostr.createEvent(kinds.RelayList, '', tags);
    const signedEvent = await this.nostr.signEvent(eventTempate);
    const publishPromises = await pool.publish(relaysUrls, signedEvent);

    // Handle the promises returned from publish
    if (publishPromises && publishPromises.length > 0) {
      this.logger.info('Publish initiated to discovery relays', { count: publishPromises.length });

      // Process each promise and map it to its corresponding relay
      publishPromises.forEach((promise, index) => {
        const relayUrl = relaysUrls[index] || 'unknown relay';

        promise
          .then(result => {
            this.logger.info('Successfully published to discovery relay', {
              relay: relayUrl,
              result
            });
            this.showMessage(`Published to ${this.formatRelayUrl(relayUrl)}`);
          })
          .catch(error => {
            this.logger.error('Failed to publish to discovery relay', {
              relay: relayUrl,
              error: error.message || error
            });
            this.showMessage(`Failed to publish to ${this.formatRelayUrl(relayUrl)}`);
          });
      });

      // Wait for all promises to resolve or reject
      try {
        const results = await Promise.allSettled(publishPromises);

        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;

        this.logger.info('Discovery relay test completed', {
          total: publishPromises.length,
          successful,
          failed
        });
      } catch (error) {
        this.logger.error('Error when waiting for publish promises', error);
      }
    } else {
      this.logger.warn('No relay connections available for publishing');
      this.showMessage('No relay connections available');
    }
  }

  async findClosestRelay(): Promise<void> {
    this.isCheckingRelays.set(true);
    this.logger.info('Starting ping check to find closest discovery relay');
    
    // Combine user's discovery relays with known ones, removing duplicates
    const relaysToCheck = [...new Set([
      ...this.relay.discoveryRelays,
      ...this.knownDiscoveryRelays
    ])];

    this.logger.debug('Checking relays for ping times', { count: relaysToCheck.length });
    this.showMessage(`Checking ${relaysToCheck.length} discovery relays for response time...`);

    try {
      // Check ping times for all relays
      const pingResults = await Promise.allSettled(
        relaysToCheck.map(url => this.checkRelayPing(url))
      );

      // Process results
      const successfulPings = pingResults
        .map((result, index) => ({
          url: relaysToCheck[index],
          pingTime: result.status === 'fulfilled' ? result.value : Infinity
        }))
        .filter(result => result.pingTime !== Infinity)
        .sort((a, b) => a.pingTime - b.pingTime);

      this.logger.debug('Ping results', { successfulPings });

      if (successfulPings.length === 0) {
        this.showMessage('No reachable discovery relays found');
        this.isCheckingRelays.set(false);
        return;
      }

      const fastest = successfulPings[0];
      
      // If this relay isn't in the user's list, ask if they want to add it
      if (!this.relay.discoveryRelays.includes(fastest.url)) {
        const message = `Found fastest relay: ${this.formatRelayUrl(fastest.url)} (${fastest.pingTime}ms). Add to your list?`;
        
        const snackBarRef = this.snackBar.open(message, 'Add', {
          duration: 10000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom'
        });
        
        snackBarRef.onAction().subscribe(() => {
          this.relay.addDiscoveryRelay(fastest.url);
          this.relay.saveDiscoveryRelays();
          this.showMessage(`Added ${this.formatRelayUrl(fastest.url)} to discovery relays`);
        });
      } else {
        this.showMessage(`Fastest relay is already in your list: ${this.formatRelayUrl(fastest.url)} (${fastest.pingTime}ms)`);
      }
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
            ws.send(JSON.stringify(["REQ", "ping-check", {}]));
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
