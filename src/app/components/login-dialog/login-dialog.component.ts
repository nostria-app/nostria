import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { NostrService } from '../../services/nostr.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DataLoadingService } from '../../services/data-loading.service';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';

@Component({
  selector: 'app-login-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatDialogModule,
    MatInputModule,
    MatFormFieldModule,
    FormsModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatListModule
  ],
  templateUrl: './login-dialog.component.html',
  styleUrl: './login-dialog.component.scss',
})
export class LoginDialogComponent {
  private dialogRef = inject(MatDialogRef<LoginDialogComponent>);
  private nostrService = inject(NostrService);
  private dataLoadingService = inject(DataLoadingService);

  currentView = signal<'main' | 'nsec' | 'extension-loading' | 'existing-accounts'>('main');
  nsecKey = '';
  extensionError = signal<string | null>(null);

  get savedAccounts() {
    return this.nostrService.allUsers();
  }

  showExistingAccounts(): boolean {
    return this.savedAccounts.length > 0;
  }

  switchToExistingAccounts(): void {
    this.currentView.set('existing-accounts');
  }

  selectExistingAccount(pubkey: string): void {
    if (this.nostrService.switchToUser(pubkey)) {
      this.dialogRef.close();
    }
  }

  getTruncatedNpub(pubkey: string): string {
    const npub = this.nostrService.getNpubFromPubkey(pubkey);
    // Show first 6 and last 6 characters
    return npub.length > 12 
      ? `${npub.substring(0, 6)}...${npub.substring(npub.length - 6)}`
      : npub;
  }

  getFormattedDate(timestamp?: number): string {
    if (!timestamp) return 'Unknown';
    return new Date(timestamp).toLocaleDateString();
  }

  generateNewKey(): void {
    this.nostrService.generateNewKey();
    this.dialogRef.close();
  }

  async loginWithExtension(): Promise<void> {
    try {
      this.currentView.set('extension-loading');
      this.extensionError.set(null);
      
      await this.nostrService.loginWithExtension();
      this.dialogRef.close();
    } catch (error) {
      this.extensionError.set(error instanceof Error ? error.message : 'Failed to connect with extension');
      this.currentView.set('main');
    }
  }

  loginWithNsec(): void {
    if (this.nsecKey && this.nsecKey.startsWith('nsec')) {
      this.nostrService.loginWithNsec(this.nsecKey);
      this.dialogRef.close();
    }
  }

  usePreviewAccount(): void {
    this.nostrService.usePreviewAccount();
    this.dialogRef.close();
  }
}
