import { Component, inject, signal } from '@angular/core';
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
  private relayService = inject(RelayService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private layout = inject(LayoutService);

  relays = this.relayService.userRelays;
  bootstrapRelays = this.relayService.bootStrapRelays;

  newRelayUrl = signal('');
  newBootstrapUrl = signal('');

  // Simulate a premium user status - in a real app this would come from a user service
  isPremiumUser = signal(false);

  addRelay(): void {
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
        isPremiumUser: this.isPremiumUser()
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.confirmed) {
        this.logger.info('Adding new relay', { url, migrateData: result.migrateData });
        this.relayService.addRelay(url);

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

  removeRelay(relay: Relay): void {
    this.logger.info('Removing relay', { url: relay.url });
    this.relayService.removeRelay(relay.url);
    this.showMessage('Relay removed');
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
      this.showMessage('This bootstrap relay is already in your list');
      return;
    }

    this.logger.info('Adding new bootstrap relay', { url });
    this.relayService.addBootstrapRelay(url);
    this.newBootstrapUrl.set('');
    this.showMessage('Bootstrap relay added successfully');
  }

  removeBootstrapRelay(url: string): void {
    this.logger.info('Removing bootstrap relay', { url });
    this.relayService.removeBootstrapRelay(url);
    this.showMessage('Bootstrap relay removed');
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
