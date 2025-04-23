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

  async addRelay() {
    let url = this.newRelayUrl();

    if (!url || !url.trim()) {
      this.showMessage('Please enter a valid relay URL');
      return;
    }

    // Automatically add wss:// prefix if missing
    if (!url.startsWith('wss://')) {
      url = `wss://${url.trim()}`;

      if (!url.endsWith('/')) {
        url += '/';
      }

      this.newRelayUrl.set(url);
    }

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
    debugger;
    const relays = this.relay.userRelays();

    const tags = this.nostr.createTags('r', relays.map(relay => relay.url));
    const relayListEvent = this.nostr.createEvent(kinds.RelayList, '', tags);

    console.log('relayListEvent', relayListEvent);
    // this.nostr.setTags(relayListEvent, 'r', relays.map(relay => relay.url));

    const signedEvent = await this.nostr.signEvent(relayListEvent);
    
    // Make sure the relay list is published both to the user's relays and discovery relays.
    this.relay.publish(signedEvent);
    this.relay.publish(signedEvent, this.relay.bootStrapRelays());

    await this.storage.saveEvent(signedEvent);
  }

  addBootstrapRelay(): void {
    let url = this.newBootstrapUrl();

    if (!url || !url.trim()) {
      this.showMessage('Please enter a valid relay URL');
      return;
    }

    // Automatically add wss:// prefix if missing
    if (!url.startsWith('wss://')) {
      url = `wss://${url.trim()}`;

      if (!url.endsWith('/')) {
        url += '/';
      }

      this.newBootstrapUrl.set(url);
    }

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
