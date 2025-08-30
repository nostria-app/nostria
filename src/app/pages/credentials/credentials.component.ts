import { Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NostrService } from '../../services/nostr.service';
import { UtilitiesService } from '../../services/utilities.service';
import { AccountStateService } from '../../services/account-state.service';
import { MatTabsModule } from '@angular/material/tabs';
import { Wallets } from '../../services/wallets';
import { LN, USD } from '@getalby/sdk';

@Component({
  selector: 'app-credentials',
  standalone: true,
  imports: [
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatDividerModule,
    MatTooltipModule,
    MatTabsModule,
    ReactiveFormsModule,
  ],
  templateUrl: './credentials.component.html',
  styleUrl: './credentials.component.scss',
})
export class CredentialsComponent {
  nostrService = inject(NostrService);
  snackBar = inject(MatSnackBar);
  utilities = inject(UtilitiesService);
  accountState = inject(AccountStateService);
  isNsecVisible = signal(false);
  wallets = inject(Wallets);

  connectionStringControl = new FormControl('', [
    Validators.required,
    Validators.pattern(/^nostr\+walletconnect:\/\//i),
  ]);

  isAddingWallet = signal(false);
  editingWallet = signal<string | null>(null);
  editNameControl = new FormControl('', [Validators.required]);

  toggleNsecVisibility(): void {
    this.isNsecVisible.update((current) => !current);
  }

  async copyToClipboard(text: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.snackBar.open(`${label} copied to clipboard`, 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      this.snackBar.open('Failed to copy to clipboard', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    }
  }

  downloadCredentials(): void {
    const account = this.accountState.account();
    const pubkey = this.accountState.pubkey();

    if (!account?.privkey || !pubkey) {
      this.snackBar.open('Private key not available for download', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    const credentialsData = {
      npub: this.getNpub(),
      pubkey: pubkey,
      nsec: this.getNsec(),
      privkey: account.privkey,
    };

    const dataStr = JSON.stringify(credentialsData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(dataBlob);
    link.download = `nostr-credentials-${pubkey.substring(0, 8)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    this.snackBar.open('Credentials downloaded successfully', 'Dismiss', {
      duration: 3000,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }

  getMaskedNsec(nsec: string): string {
    if (!nsec) return '';
    // Show only first 4 characters, mask the rest
    const prefix = nsec.substring(0, 4);
    return `${prefix}${'•'.repeat(Math.min(20, nsec.length - 4))}`;
  }

  getNpub(): string {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return '';

    console.debug('LOCATION 2:', pubkey);
    return this.utilities.getNpubFromPubkey(pubkey);
  }

  getNsec(): string {
    const privkey = this.accountState.account()?.privkey;
    if (!privkey) return '';
    return this.utilities.getNsecFromPrivkey(privkey);
  }

  isRemoteAccount(): boolean {
    return this.accountState.account()?.source === 'remote';
  }

  async addWallet(): Promise<void> {
    if (this.connectionStringControl.invalid) {
      this.snackBar.open('Please enter a valid Nostr Wallet Connect connection string', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    this.isAddingWallet.set(true);

    try {
      const connectionString = this.connectionStringControl.value!;
      const parsed = this.wallets.parseConnectionString(connectionString);

      this.wallets.addWallet(parsed.pubkey, connectionString, {
        relay: parsed.relay,
        secret: parsed.secret,
      });

      this.connectionStringControl.reset();
      this.snackBar.open('Wallet added successfully', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    } catch (error) {
      console.error('Failed to add wallet:', error);
      this.snackBar.open('Failed to add wallet. Please check the connection string.', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    } finally {
      this.isAddingWallet.set(false);
    }
  }

  removeWallet(pubkey: string): void {
    this.wallets.removeWallet(pubkey);
    this.snackBar.open('Wallet removed successfully', 'Dismiss', {
      duration: 3000,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }

  async donate(wallet: any) {
    console.log('Initiating donation for wallet:', wallet);

    // const request = await new LN(wallet.connections[0]).requestPayment(USD(0.1));
    // 15 minutes.
    // request.onTimeout(900, () => {
    //   console.error('Payment request timed out');
    // });

    // request.onPaid(() => {
    //   console.log('Donation successful');
    // });

    const request = await new LN(wallet.connections[0]).pay('sondreb@npub.cash', USD(0.1));
    console.log('Payment request created:', request);
  }

  getWalletEntries() {
    return Object.entries(this.wallets.wallets());
  }

  getFirstConnectionString(wallet: any): string {
    return wallet.connections && wallet.connections.length > 0 ? wallet.connections[0] : '';
  }

  startEditingWallet(pubkey: string, currentName: string): void {
    this.editingWallet.set(pubkey);
    this.editNameControl.setValue(currentName);
  }

  cancelEditingWallet(): void {
    this.editingWallet.set(null);
    this.editNameControl.reset();
  }

  saveWalletName(): void {
    const editingPubkey = this.editingWallet();
    const newName = this.editNameControl.value;

    if (editingPubkey && newName) {
      this.wallets.updateWalletName(editingPubkey, newName);
      this.snackBar.open('Wallet name updated successfully', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      this.cancelEditingWallet();
    }
  }

  getWalletName(wallet: any): string {
    return wallet.name || 'Unnamed Wallet';
  }
}
