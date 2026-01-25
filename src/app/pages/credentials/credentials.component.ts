import { ChangeDetectionStrategy, Component, inject, signal, effect, OnInit } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { NostrService } from '../../services/nostr.service';
import { UtilitiesService } from '../../services/utilities.service';
import { AccountStateService } from '../../services/account-state.service';
import { CryptoEncryptionService, EncryptedData } from '../../services/crypto-encryption.service';
import { PinPromptService } from '../../services/pin-prompt.service';
import { nip19 } from 'nostr-tools';
import { QRCodeDialogComponent } from '../../components/qrcode-dialog/qrcode-dialog.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-credentials',
  imports: [
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatTooltipModule,
    ReactiveFormsModule,
  ],
  templateUrl: './credentials.component.html',
  styleUrl: './credentials.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CredentialsComponent implements OnInit {
  nostrService = inject(NostrService);
  snackBar = inject(MatSnackBar);
  utilities = inject(UtilitiesService);
  accountState = inject(AccountStateService);
  crypto = inject(CryptoEncryptionService);
  pinPrompt = inject(PinPromptService);
  dialog = inject(MatDialog);
  isNsecVisible = signal(false);
  isMnemonicVisible = signal(false);

  // PIN change controls
  isChangingPin = signal(false);
  isResettingPin = signal(false);
  oldPinControl = new FormControl('', [Validators.required, Validators.minLength(4)]);
  newPinControl = new FormControl('', [Validators.required, Validators.minLength(4)]);
  confirmPinControl = new FormControl('', [Validators.required, Validators.minLength(4)]);
  resetPinControl = new FormControl('', [Validators.required, Validators.minLength(4)]);

  // Cached nsec value (decrypted on demand)
  private cachedNsec = signal<string>('');

  // Cached mnemonic value (decrypted on demand)
  private cachedMnemonic = signal<string>('');

  constructor() {
    // Watch for account changes and reload nsec and mnemonic when account changes
    effect(() => {
      const account = this.accountState.account();
      // Trigger reload when account changes
      if (account) {
        this.loadNsec();
        this.loadMnemonic();
      } else {
        this.cachedNsec.set('');
        this.cachedMnemonic.set('');
      }
    });
  }

  ngOnInit(): void {
    // Load nsec and mnemonic on component initialization
    this.loadNsec();
    this.loadMnemonic();
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

    // Use the retry mechanism for better UX
    const pin = await this.pinPrompt.promptForPinWithRetry(
      async (testPin) => {
        try {
          await this.nostrService.getDecryptedPrivateKey(account, testPin);
          return true;
        } catch {
          return false;
        }
      },
      {
        title: 'Unlock Private Key',
        message: 'Enter your PIN to access your private key.',
      }
    );

    if (!pin) {
      // User cancelled
      this.snackBar.open('PIN required to access private key', 'Dismiss', { duration: 3000 });
      return null;
    }

    try {
      const privkey = await this.nostrService.getDecryptedPrivateKey(account, pin);
      const nsec = this.utilities.getNsecFromPrivkey(privkey);
      this.snackBar.open('Private key unlocked', 'Dismiss', { duration: 2000 });
      return nsec;
    } catch {
      // This shouldn't happen since we validated the PIN
      this.snackBar.open('Failed to decrypt private key', 'Dismiss', { duration: 3000 });
      return null;
    }
  }

  private async loadMnemonic(): Promise<void> {
    const account = this.accountState.account();
    if (!account?.mnemonic || account.source !== 'nsec') {
      this.cachedMnemonic.set('');
      return;
    }

    try {
      // Try to get decrypted mnemonic (will prompt for PIN if needed)
      const mnemonic = await this.getDecryptedMnemonicWithPrompt();
      if (!mnemonic) {
        this.cachedMnemonic.set('');
        return;
      }
      this.cachedMnemonic.set(mnemonic);
    } catch {
      this.cachedMnemonic.set('');
    }
  }

  /**
   * Gets the decrypted mnemonic, prompting for PIN if the default PIN fails
   */
  private async getDecryptedMnemonicWithPrompt(): Promise<string | null> {
    const account = this.accountState.account();
    if (!account?.mnemonic) {
      return null;
    }

    try {
      // If not encrypted, return plaintext
      if (!account.isMnemonicEncrypted) {
        return account.mnemonic;
      }

      // Try with default PIN first
      const encryptedData = JSON.parse(account.mnemonic);
      const mnemonic = await this.crypto.decryptPrivateKey(encryptedData, this.crypto.DEFAULT_PIN);
      return mnemonic;
    } catch {
      // Default PIN failed, prompt user for their PIN
      return await this.promptForPinAndDecryptMnemonic();
    }
  }

  private async promptForPinAndDecryptMnemonic(): Promise<string | null> {
    const account = this.accountState.account();
    if (!account?.mnemonic) {
      return null;
    }

    // Use the retry mechanism for better UX
    const pin = await this.pinPrompt.promptForPinWithRetry(
      async (testPin) => {
        try {
          const encryptedData = JSON.parse(account.mnemonic!);
          await this.crypto.decryptPrivateKey(encryptedData, testPin);
          return true;
        } catch {
          return false;
        }
      },
      {
        title: 'Unlock Recovery Phrase',
        message: 'Enter your PIN to access your recovery phrase.',
      }
    );

    if (!pin) {
      // User cancelled
      this.snackBar.open('PIN required to access recovery phrase', 'Dismiss', { duration: 3000 });
      return null;
    }

    try {
      const encryptedData = JSON.parse(account.mnemonic);
      const mnemonic = await this.crypto.decryptPrivateKey(encryptedData, pin);
      this.snackBar.open('Recovery phrase unlocked', 'Dismiss', { duration: 2000 });
      return mnemonic;
    } catch {
      // This shouldn't happen since we validated the PIN
      this.snackBar.open('Failed to decrypt recovery phrase', 'Dismiss', { duration: 3000 });
      return null;
    }
  }

  toggleMnemonicVisibility(): void {
    this.isMnemonicVisible.update(current => !current);
  }

  getMnemonic(): string {
    return this.cachedMnemonic();
  }

  getMaskedMnemonic(mnemonic: string): string {
    if (!mnemonic) return '';
    // Mask all words completely
    const words = mnemonic.split(' ');
    return words.map(word => '•'.repeat(word.length)).join(' ');
  }

  hasMnemonic(): boolean {
    return !!this.accountState.account()?.mnemonic;
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

  async exportQrCode(): Promise<void> {
    const account = this.accountState.account();

    if (!account?.privkey) {
      this.snackBar.open('Private key not available for export', 'Dismiss', {
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

      // Open QR code dialog with the nsec
      this.dialog.open(QRCodeDialogComponent, {
        width: '400px',
        panelClass: 'responsive-dialog',
        data: {
          did: nsec,
          hideToggle: true,
          title: 'Export Account to Another Device'
        },
      });
    } catch (error) {
      console.error('Failed to export QR code:', error);
      this.snackBar.open('Failed to export QR code. Could not decrypt private key.', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    }
  }

  hasRemoteSigner(): boolean {
    return !!this.accountState.account()?.bunker;
  }

  getPreferredSigningMethod(): 'local' | 'remote' {
    return this.accountState.account()?.preferredSigningMethod || 'local';
  }

  async setPreferredSigningMethod(method: 'local' | 'remote'): Promise<void> {
    const account = this.accountState.account();
    if (!account) return;

    const updatedAccount = {
      ...account,
      preferredSigningMethod: method,
    };

    await this.nostrService.setAccount(updatedAccount);

    this.snackBar.open(
      method === 'remote'
        ? 'Now using remote signer for signing operations'
        : 'Now using local private key for signing operations',
      'Dismiss',
      { duration: 3000 }
    );
  }

  async removePrivateKey(): Promise<void> {
    const account = this.accountState.account();
    if (!account?.privkey) return;

    // Show warning dialog
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '450px',
      data: {
        title: 'Remove Private Key',
        message: `⚠️ WARNING: This action is IRREVERSIBLE!\n\n` +
          `You are about to permanently remove the private key from this account. ` +
          `After removal, you will only be able to sign using your remote signer.\n\n` +
          `Before proceeding, make sure you have:\n` +
          `• Backed up your private key (nsec) in a secure location\n` +
          `• Verified that your remote signer is working correctly\n` +
          `• Tested signing operations with the remote signer\n\n` +
          `Are you absolutely sure you want to remove the private key?`,
        confirmText: 'Yes, Remove Private Key',
        cancelText: 'Cancel',
        confirmColor: 'warn' as const,
      } as ConfirmDialogData,
    });

    dialogRef.afterClosed().subscribe(async (confirmed) => {
      if (confirmed) {
        await this.performPrivateKeyRemoval();
      }
    });
  }

  private async performPrivateKeyRemoval(): Promise<void> {
    const account = this.accountState.account();
    if (!account) return;

    // Remove private key and mnemonic, set source to remote
    const updatedAccount = {
      ...account,
      privkey: undefined,
      mnemonic: undefined,
      isEncrypted: undefined,
      isMnemonicEncrypted: undefined,
      source: 'remote' as const,
      preferredSigningMethod: 'remote' as const,
    };

    await this.nostrService.setAccount(updatedAccount);

    // Clear cached values
    this.cachedNsec.set('');
    this.cachedMnemonic.set('');

    this.snackBar.open(
      'Private key removed. This account now uses remote signing only.',
      'Dismiss',
      { duration: 5000 }
    );
  }

  async disconnectRemoteSigner(): Promise<void> {
    const account = this.accountState.account();
    if (!account?.bunker) return;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Disconnect Remote Signer',
        message: 'Are you sure you want to disconnect the remote signer? ' +
          'You can reconnect it later if needed.',
        confirmText: 'Disconnect',
        cancelText: 'Cancel',
        confirmColor: 'warn' as const,
      } as ConfirmDialogData,
    });

    dialogRef.afterClosed().subscribe(async (confirmed) => {
      if (confirmed) {
        const updatedAccount = {
          ...account,
          bunker: undefined,
          preferredSigningMethod: 'local' as const,
        };

        await this.nostrService.setAccount(updatedAccount);

        this.snackBar.open(
          'Remote signer disconnected.',
          'Dismiss',
          { duration: 3000 }
        );
      }
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

    return this.utilities.getNpubFromPubkey(pubkey);
  }

  getNsec(): string {
    return this.cachedNsec();
  }

  isRemoteAccount(): boolean {
    return this.accountState.account()?.source === 'remote';
  }

  isExtensionAccount(): boolean {
    return this.accountState.account()?.source === 'extension';
  }

  isExternalSignerAccount(): boolean {
    return this.accountState.account()?.source === 'external';
  }

  isPreviewAccount(): boolean {
    return this.accountState.account()?.source === 'preview';
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
   * Starts the PIN reset process (reset to default "0000")
   */
  startResettingPin(): void {
    this.isResettingPin.set(true);
    this.resetPinControl.reset();
  }

  /**
   * Cancels the PIN reset process
   */
  cancelResettingPin(): void {
    this.isResettingPin.set(false);
    this.resetPinControl.reset();
  }

  /**
   * Resets the PIN back to the default "0000"
   */
  async resetPinToDefault(): Promise<void> {
    const account = this.accountState.account();

    if (!account || !account.isEncrypted || !account.privkey) {
      this.snackBar.open('No encrypted private key to reset', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    const currentPin = this.resetPinControl.value;

    if (!currentPin) {
      this.snackBar.open('Please enter your current PIN', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    try {
      // Parse the encrypted data
      const encryptedPrivkey = JSON.parse(account.privkey) as EncryptedData;

      // Re-encrypt private key with default PIN
      const reencryptedPrivkey = await this.crypto.reencryptPrivateKey(
        encryptedPrivkey,
        currentPin,
        this.crypto.DEFAULT_PIN
      );

      // Also re-encrypt mnemonic if it exists
      let reencryptedMnemonic: string | undefined;
      if (account.mnemonic && account.isMnemonicEncrypted) {
        try {
          const encryptedMnemonic = JSON.parse(account.mnemonic) as EncryptedData;
          const newMnemonicData = await this.crypto.reencryptPrivateKey(
            encryptedMnemonic,
            currentPin,
            this.crypto.DEFAULT_PIN
          );
          reencryptedMnemonic = JSON.stringify(newMnemonicData);
        } catch {
          // If mnemonic decryption fails, just keep the existing value
          reencryptedMnemonic = account.mnemonic;
        }
      }

      // Update the account
      const updatedAccount = {
        ...account,
        privkey: JSON.stringify(reencryptedPrivkey),
        ...(reencryptedMnemonic && { mnemonic: reencryptedMnemonic }),
      };

      // Save to NostrService which will persist to localStorage
      await this.nostrService.setAccount(updatedAccount);

      // Clear PIN cache since we changed it
      this.pinPrompt.clearCache();

      this.snackBar.open('PIN reset to default (0000) successfully', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });

      // Reset form
      this.cancelResettingPin();
    } catch (error) {
      console.error('Failed to reset PIN:', error);
      this.snackBar.open('Failed to reset PIN. Please check your current PIN and try again.', 'Dismiss', {
        duration: 5000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    }
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
      // Parse the encrypted private key data
      const encryptedPrivkey = JSON.parse(account.privkey) as EncryptedData;

      // Re-encrypt private key with new PIN
      const reencryptedPrivkey = await this.crypto.reencryptPrivateKey(
        encryptedPrivkey,
        oldPin,
        newPin
      );

      // Also re-encrypt mnemonic if it exists
      let reencryptedMnemonic: string | undefined;
      if (account.mnemonic && account.isMnemonicEncrypted) {
        try {
          const encryptedMnemonic = JSON.parse(account.mnemonic) as EncryptedData;
          const newMnemonicData = await this.crypto.reencryptPrivateKey(
            encryptedMnemonic,
            oldPin,
            newPin
          );
          reencryptedMnemonic = JSON.stringify(newMnemonicData);
        } catch {
          // If mnemonic decryption fails, keep the existing value
          reencryptedMnemonic = account.mnemonic;
        }
      }

      // Update the account
      const updatedAccount = {
        ...account,
        privkey: JSON.stringify(reencryptedPrivkey),
        ...(reencryptedMnemonic && { mnemonic: reencryptedMnemonic }),
      };

      // Save to NostrService which will persist to localStorage
      await this.nostrService.setAccount(updatedAccount);

      // Clear PIN cache since we changed it
      this.pinPrompt.clearCache();

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
