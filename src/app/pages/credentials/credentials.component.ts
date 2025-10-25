import { Component, inject, signal, effect, OnInit } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDialog } from '@angular/material/dialog';
import { RouterModule } from '@angular/router';
import { NostrService } from '../../services/nostr.service';
import { UtilitiesService } from '../../services/utilities.service';
import { AccountStateService } from '../../services/account-state.service';
import { Wallets, Wallet } from '../../services/wallets';
import { LN, USD } from '@getalby/sdk';
import { CryptoEncryptionService, EncryptedData } from '../../services/crypto-encryption.service';
import { PinPromptDialogComponent } from '../../components/pin-prompt-dialog/pin-prompt-dialog.component';
import { nip19 } from 'nostr-tools';

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
    RouterModule,
  ],
  templateUrl: './credentials.component.html',
  styleUrl: './credentials.component.scss',
})
export class CredentialsComponent implements OnInit {
  nostrService = inject(NostrService);
  snackBar = inject(MatSnackBar);
  utilities = inject(UtilitiesService);
  accountState = inject(AccountStateService);
  crypto = inject(CryptoEncryptionService);
  dialog = inject(MatDialog);
  isNsecVisible = signal(false);
  wallets = inject(Wallets);

  connectionStringControl = new FormControl('', [
    Validators.required,
    Validators.pattern(/^nostr\+walletconnect:\/\//i),
  ]);

  isAddingWallet = signal(false);
  editingWallet = signal<string | null>(null);
  editNameControl = new FormControl('', [Validators.required]);

  // PIN change controls
  isChangingPin = signal(false);
  oldPinControl = new FormControl('', [Validators.required, Validators.minLength(4)]);
  newPinControl = new FormControl('', [Validators.required, Validators.minLength(4)]);
  confirmPinControl = new FormControl('', [Validators.required, Validators.minLength(4)]);

  // Cached nsec value (decrypted on demand)
  private cachedNsec = signal<string>('');

  constructor() {
    // Watch for account changes and reload nsec when account changes
    effect(() => {
      const account = this.accountState.account();
      // Trigger reload when account changes
      if (account) {
        this.loadNsec();
      } else {
        this.cachedNsec.set('');
      }
    });
  }

  ngOnInit(): void {
    // Load nsec on component initialization
    this.loadNsec();
  }

  private async loadNsec(): Promise<void> {
    const account = this.accountState.account();
    if (!account?.privkey || account.source !== 'nsec') {
      this.cachedNsec.set('');
      return;
    }

    try {
      // Try to get decrypted private key (will prompt for PIN if needed)
      const nsec = await this.getDecryptedNsecWithPrompt();
      if (!nsec) {
        this.cachedNsec.set('');
        return;
      }
      this.cachedNsec.set(nsec);
    } catch {
      this.cachedNsec.set('');
    }
  }

  /**
   * Gets the decrypted private key as nsec, prompting for PIN if the default PIN fails
   */
  private async getDecryptedNsecWithPrompt(): Promise<string | null> {
    const account = this.accountState.account();
    if (!account?.privkey) {
      return null;
    }

    try {
      // Try with default PIN first
      const privkey = await this.nostrService.getDecryptedPrivateKey(account, this.crypto.DEFAULT_PIN);
      return this.utilities.getNsecFromPrivkey(privkey);
    } catch {
      // Default PIN failed, prompt user for their PIN
      return await this.promptForPinAndDecrypt();
    }
  }

  private async promptForPinAndDecrypt(): Promise<string | null> {
    const account = this.accountState.account();
    if (!account?.privkey) {
      return null;
    }

    const dialogRef = this.dialog.open(PinPromptDialogComponent, {
      disableClose: true,
      width: '400px',
    });

    const pin = await dialogRef.afterClosed().toPromise();

    if (!pin) {
      // User cancelled
      this.snackBar.open('PIN required to access private key', 'Dismiss', { duration: 3000 });
      return null;
    }

    try {
      // Try to decrypt with the provided PIN
      const privkey = await this.nostrService.getDecryptedPrivateKey(account, pin);
      const nsec = this.utilities.getNsecFromPrivkey(privkey);
      this.snackBar.open('Private key unlocked', 'Dismiss', { duration: 2000 });
      return nsec;
    } catch {
      // Wrong PIN
      this.snackBar.open('Incorrect PIN. Please try again.', 'Dismiss', { duration: 3000 });
      return null;
    }
  }

  toggleNsecVisibility(): void {
    this.isNsecVisible.update(current => !current);
  }

  async copyToClipboard(text: string, label: string): Promise<void> {
    try {
      // If copying nsec, make sure we have the cached value
      if (label === 'Private key' && !text) {
        await this.loadNsec();
        text = this.cachedNsec();
      }

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

  async downloadCredentials(): Promise<void> {
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

    try {
      // Get decrypted nsec (will prompt for PIN if needed)
      const nsec = await this.getDecryptedNsecWithPrompt();
      if (!nsec) {
        return; // User cancelled or wrong PIN
      }

      // Decode nsec to get the private key bytes
      const decoded = nip19.decode(nsec);
      const privkeyBytes = decoded.data as Uint8Array;
      const privkey = Array.from(privkeyBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const credentialsData = {
        npub: this.getNpub(),
        pubkey: pubkey,
        nsec: nsec,
        privkey: privkey,
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
    } catch (error) {
      console.error('Failed to download credentials:', error);
      this.snackBar.open('Failed to download credentials. Could not decrypt private key.', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    }
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
    return this.cachedNsec();
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

  async donate(wallet: Wallet) {
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

  getFirstConnectionString(wallet: Wallet): string {
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

  getWalletName(wallet: Wallet): string {
    return wallet.name || 'Unnamed Wallet';
  }

  getWalletRelays(wallet: Wallet): string[] {
    const relayUrls: string[] = [];

    if (wallet.connections && wallet.connections.length > 0) {
      for (const connectionString of wallet.connections) {
        try {
          const parsed = this.wallets.parseConnectionString(connectionString);
          relayUrls.push(...parsed.relay);
        } catch (error) {
          console.warn('Failed to parse connection string for relay extraction:', error);
        }
      }
    }

    // Remove duplicates
    return [...new Set(relayUrls)];
  }

  // PIN Management methods

  /**
   * Checks if the current account has an encrypted private key
   */
  hasEncryptedKey(): boolean {
    const account = this.accountState.account();
    return account?.isEncrypted === true && account?.source === 'nsec';
  }

  /**
   * Checks if the current account is using the default PIN
   */
  async isUsingDefaultPin(): Promise<boolean> {
    const account = this.accountState.account();
    if (!account?.isEncrypted || !account?.privkey) {
      return false;
    }

    try {
      const encryptedData = JSON.parse(account.privkey) as EncryptedData;
      return await this.crypto.verifyPin(encryptedData, this.crypto.DEFAULT_PIN);
    } catch {
      return false;
    }
  }

  /**
   * Starts the PIN change process
   */
  startChangingPin(): void {
    this.isChangingPin.set(true);
    // Pre-fill old PIN with default if currently using default
    this.isUsingDefaultPin().then(isDefault => {
      if (isDefault) {
        this.oldPinControl.setValue(this.crypto.DEFAULT_PIN);
      }
    });
  }

  /**
   * Cancels the PIN change process
   */
  cancelChangingPin(): void {
    this.isChangingPin.set(false);
    this.oldPinControl.reset();
    this.newPinControl.reset();
    this.confirmPinControl.reset();
  }

  /**
   * Changes the PIN for the encrypted private key
   */
  async changePin(): Promise<void> {
    const account = this.accountState.account();

    if (!account || !account.isEncrypted || !account.privkey) {
      this.snackBar.open('No encrypted private key to update', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    const oldPin = this.oldPinControl.value;
    const newPin = this.newPinControl.value;
    const confirmPin = this.confirmPinControl.value;

    // Validate inputs
    if (!oldPin || !newPin || !confirmPin) {
      this.snackBar.open('Please fill in all PIN fields', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    if (newPin !== confirmPin) {
      this.snackBar.open('New PIN and confirmation do not match', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    if (newPin.length < 4) {
      this.snackBar.open('PIN must be at least 4 characters', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    try {
      // Parse the encrypted data
      const encryptedData = JSON.parse(account.privkey) as EncryptedData;

      // Re-encrypt with new PIN
      const reencryptedData = await this.crypto.reencryptPrivateKey(
        encryptedData,
        oldPin,
        newPin
      );

      // Update the account
      const updatedAccount = {
        ...account,
        privkey: JSON.stringify(reencryptedData),
      };

      // Save to NostrService which will persist to localStorage
      await this.nostrService.setAccount(updatedAccount);

      this.snackBar.open('PIN changed successfully', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });

      // Reset form
      this.cancelChangingPin();
    } catch (error) {
      console.error('Failed to change PIN:', error);
      this.snackBar.open('Failed to change PIN. Please check your old PIN and try again.', 'Dismiss', {
        duration: 5000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    }
  }
}
