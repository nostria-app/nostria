import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FormsModule } from '@angular/forms';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { MatCardModule } from '@angular/material/card';

type LoginView = 'main' | 'nsec' | 'extension-loading' | 'existing-accounts';

@Component({
  selector: 'app-login-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatListModule,
    MatIconModule,
    MatProgressSpinnerModule,
    FormsModule
  ],
  templateUrl: './login-dialog.component.html',
  styleUrls: ['./login-dialog.component.scss']
})
export class LoginDialogComponent implements OnInit {
  private dialogRef = inject(MatDialogRef<LoginDialogComponent>);
  nostrService = inject(NostrService);
  private logger = inject(LoggerService);

  currentView = signal<LoginView>('main');
  extensionError = signal<string | null>(null);
  nsecKey = '';

  constructor() {
    this.logger.debug('LoginDialogComponent constructor');
  }

  ngOnInit(): void {
    this.logger.debug('LoginDialogComponent ngOnInit');
    // Make sure we have the metadata for all accounts
    // this.nostrService.loadAllUsersMetadata().catch(err =>
    //   this.logger.error('Failed to load metadata for all users', err));
  }

  switchToExistingAccounts(): void {
    this.logger.debug('Switching to existing accounts view');
    this.currentView.set('existing-accounts');
  }

  async generateNewKey(): Promise<void> {
    this.logger.debug('Generating new key');
    this.nostrService.generateNewKey();
    this.closeDialog();
  }

  async loginWithExtension(): Promise<void> {
    this.logger.debug('Attempting login with extension');
    this.currentView.set('extension-loading');
    this.extensionError.set(null);

    try {
      await this.nostrService.loginWithExtension();
      this.logger.debug('Login with extension successful');
      this.closeDialog();
    } catch (err) {
      this.logger.error('Login with extension failed', err);
      this.extensionError.set(err instanceof Error ? err.message : 'Unknown error connecting to extension');
      this.currentView.set('main');
    }
  }

  loginWithNsec(): void {
    this.logger.debug('Attempting login with nsec');
    try {
      this.nostrService.loginWithNsec(this.nsecKey);
      this.logger.debug('Login with nsec successful');
      this.closeDialog();
    } catch (err) {
      this.logger.error('Login with nsec failed', err);
      // Handle error display (could add an error signal here)
    }
  }

  usePreviewAccount(): void {
    this.logger.debug('Using preview account');
    this.nostrService.usePreviewAccount();
    this.closeDialog();
  }

  selectExistingAccount(pubkey: string): void {
    this.logger.debug('Selecting existing account', { pubkey });
    this.nostrService.switchToUser(pubkey);
    this.closeDialog();
  }

  removeAccount(event: Event, pubkey: string): void {
    // Prevent the click event from propagating to the parent (which would select the account)
    event.stopPropagation();
    this.logger.debug('Removing account', { pubkey });

    // Call the service to remove the account
    this.nostrService.removeAccount(pubkey);

    // If no more accounts exist, go back to main view
    if (this.nostrService.allAccounts().length === 0) {
      this.currentView.set('main');
    }
  }

  closeDialog(): void {
    this.logger.debug('Closing login dialog');
    this.dialogRef.close();
  }
}
