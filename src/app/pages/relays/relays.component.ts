import { Component, effect, inject, signal } from '@angular/core';
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
import { kinds } from 'nostr-tools';
import { StorageService } from '../../services/storage.service';
import { NotificationService } from '../../services/notification.service';

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
export class RelaysComponent {
  private relay = inject(RelayService);
  private nostr = inject(NostrService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private layout = inject(LayoutService);
  private storage = inject(StorageService);
  private notifications = inject(NotificationService);

  relays = this.relay.userRelays;
  bootstrapRelays = this.relay.bootStrapRelays;

  newRelayUrl = signal('');
  newBootstrapUrl = signal('');

  constructor() {
    // effect(async () => {
    //   if (this.relayService.userRelays()) {

    //   }
    // });
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
    if (this.relays().some(relay => relay.url === url)) {
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
  
    const relays = this.relay.userRelays();
    this.logger.debug('User relays being published:', relays);
  
    const tags = this.nostr.createTags('r', relays.map(relay => relay.url));
    const relayListEvent = this.nostr.createEvent(kinds.RelayList, '', tags);
  
    this.logger.debug('Created relay list event', relayListEvent);
  
    const signedEvent = await this.nostr.signEvent(relayListEvent);
    this.logger.debug('Signed relay list event', signedEvent);
  
    // Make sure the relay list is published both to the user's relays and discovery relays.
    const callbacks1 = await this.relay.publish(signedEvent);
    const callbacks2 = await this.relay.publish(signedEvent, this.relay.bootStrapRelays());
  
    // Combine all callbacks into a flat array for tracking
    const allCallbacks = [...(callbacks1 || []), ...(callbacks2 || [])].flat();
    
    const relayUrls = [...this.relay.userRelays().map(relay => relay.url), ...this.relay.bootStrapRelays()];
    this.logger.debug('Publishing to relay URLs:', relayUrls);
    
    // Create a mapping of callbacks to their respective relay URLs
    const callbackRelayMapping = new Map<Promise<string>, string>();
    callbacks1?.forEach((callback, i) => {
      // Map callbacks to user relay URLs (if they exist)
      if (i < this.relay.userRelays().length) {
        callbackRelayMapping.set(callback, this.relay.userRelays()[i].url);
      }
    });
    
    callbacks2?.forEach((callback, i) => {
      // Map callbacks to bootstrap relay URLs (if they exist)
      if (i < this.relay.bootStrapRelays().length) {
        callbackRelayMapping.set(callback, this.relay.bootStrapRelays()[i]);
      }
    });
    
    // // Track publishing progress
    // const results = { 
    //   success: 0, 
    //   failed: 0, 
    //   total: allCallbacks.length, 
    //   successfulRelayUrls: [] as string[] 
    // };
    
    // // Process each callback promise individually to properly track success/failure
    // for (const callback of allCallbacks) {
    //   try {
    //     const relayUrl = callbackRelayMapping.get(callback) || 'unknown relay';
        
    //     await callback.then(
    //       () => {
    //         results.success++;
    //         results.successfulRelayUrls.push(relayUrl);
    //         this.logger.debug(`Successfully published to relay ${relayUrl} with status: ${status}`);
    //       },
    //       (error: any) => {
    //         results.failed++;
    //         this.logger.warn(`Failed to publish to relay ${relayUrl}:`, error);
    //       }
    //     );
    //   } catch (error) {
    //     debugger;
    //     results.failed++;
    //     this.logger.error(`Exception while publishing to relay:`, error);
    //   }
    // }
    
    // this.logger.info('Relay list publication results:', {
    //   success: results.success,
    //   failed: results.failed,
    //   total: results.total,
    //   successfulRelays: results.successfulRelayUrls
    // });
    
    // if (results.failed > 0) {
    //   this.showMessage(`Published to ${results.success}/${results.total} relays (${results.failed} failed)`);
    // } else if (results.success > 0) {
    //   this.showMessage(`Successfully published to ${results.success} relays`);
    // } else {
    //   this.showMessage('Failed to publish to any relays');
    // }
  
    // Pass the original callback arrays to the notification service
    this.notifications.addRelayPublishingNotification(signedEvent, callbackRelayMapping);
  
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
    if (this.bootstrapRelays().includes(url)) {
      this.showMessage('This Discovery Relay is already in your list');
      return;
    }

    this.logger.info('Adding new Discovery Relay', { url });
    this.relay.addBootstrapRelay(url);
    this.newBootstrapUrl.set('');
    this.showMessage('Discovery Relay added successfully');
  }

  removeBootstrapRelay(url: string): void {
    this.logger.info('Removing Discovery Relay', { url });
    this.relay.removeBootstrapRelay(url);
    this.showMessage('Discovery Relay removed');
  }

  getStatusIcon(status: Relay['status'] | undefined): string {
    switch (status) {
      case 'connected': return 'check_circle';
      case 'connecting': return 'hourglass_empty';
      case 'error': return 'error';
      case 'disconnected':
      default: return 'radio_button_unchecked';
    }
  }

  getStatusColor(status: Relay['status'] | undefined): string {
    switch (status) {
      case 'connected': return 'text-green-500';
      case 'connecting': return 'text-yellow-500';
      case 'error': return 'text-red-500';
      case 'disconnected':
      default: return 'text-gray-500';
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
}
