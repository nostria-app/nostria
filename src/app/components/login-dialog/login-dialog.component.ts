import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FormsModule } from '@angular/forms';
import { NostrService, NostrUser } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';

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
  
  // savedAccounts: NostrUser[] = [];
  
  constructor() {
    this.logger.debug('LoginDialogComponent constructor');
  }
  
  ngOnInit(): void {
    this.logger.debug('LoginDialogComponent ngOnInit');
    // Load saved accounts for display
    // this.savedAccounts = this.nostrService.allUsers();
    // this.logger.debug('Loaded saved accounts', { count: this.savedAccounts.length });
  }
  
  showExistingAccounts(): boolean {
    return this.nostrService.allUsers().length > 0;
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
  
  closeDialog(): void {
    this.logger.debug('Closing login dialog');
    this.dialogRef.close();
  }
}
