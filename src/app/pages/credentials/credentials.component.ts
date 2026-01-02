import { ChangeDetectionStrategy, Component, inject, signal, effect, OnInit, untracked } from '@angular/core';
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
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterModule } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { NostrService } from '../../services/nostr.service';
import { UtilitiesService } from '../../services/utilities.service';
import { AccountStateService } from '../../services/account-state.service';
import { Wallets, Wallet } from '../../services/wallets';
import { NwcService, WalletData, NwcTransaction } from '../../services/nwc.service';
import { LN, USD } from '@getalby/sdk';
import { CryptoEncryptionService, EncryptedData } from '../../services/crypto-encryption.service';
import { PinPromptService } from '../../services/pin-prompt.service';
import { nip19 } from 'nostr-tools';
import { QRCodeDialogComponent } from '../../components/qrcode-dialog/qrcode-dialog.component';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../components/confirm-dialog/confirm-dialog.component';
import { DatePipe, DecimalPipe } from '@angular/common';

@Component({
  selector: 'app-credentials',
  imports: [
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatDividerModule,
    MatTooltipModule,
    MatTabsModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    ReactiveFormsModule,
    RouterModule,
    UserProfileComponent,
    DatePipe,
    DecimalPipe,
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
  nwcService = inject(NwcService);
  isNsecVisible = signal(false);
  isMnemonicVisible = signal(false);
  wallets = inject(Wallets);

  connectionStringControl = new FormControl('', [
    Validators.required,
    Validators.pattern(/^nostr\+walletconnect:\/\//i),
  ]);

  isAddingWallet = signal(false);
  editingWallet = signal<string | null>(null);
  editNameControl = new FormControl('', [Validators.required]);

  // Wallet details view
  expandedWallet = signal<string | null>(null);

  // Track which wallets have had their balance loaded to prevent re-loading
  private loadedWalletBalances = new Set<string>();

  // PIN change controls
  isChangingPin = signal(false);
  oldPinControl = new FormControl('', [Validators.required, Validators.minLength(4)]);
  newPinControl = new FormControl('', [Validators.required, Validators.minLength(4)]);
  confirmPinControl = new FormControl('', [Validators.required, Validators.minLength(4)]);

  // Cached nsec value (decrypted on demand)
  private cachedNsec = signal<string>('');

  // Cached mnemonic value (decrypted on demand)
  private cachedMnemonic = signal<string>('');

  // Donation-related properties
  developerPubkeys = ['17e2889fba01021d048a13fd0ba108ad31c38326295460c21e69c43fa8fbe515', 'cbec30a9038fe934b55272b046df47eb4d20ef006de0acbe46b0c0dae06e5d5b', '5f432a9f39b58ff132fc0a4c8af10d42efd917d8076f68bb7f2f91ed7d4f6a41', '7e2b09f951ed9be483284e7469ac20ac427d3264633d250c9d01e4265c99ed42'];
  selectedConnectionString = signal<string | null>(null);
  selectedDonationAmount = signal<number | null>(5);
  customDonationAmount = new FormControl<number | null>(null, [Validators.min(0.01)]);
  isDonating = signal(false);
  donationSuccess = signal(false);
  donationError = signal<string | null>(null);

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

    // Auto-load wallet balances when wallets change
    effect(() => {
      const walletEntries = Object.entries(this.wallets.wallets());

      // Use untracked to prevent signal reads inside async calls from creating dependencies
      untracked(() => {
        for (const [pubkey] of walletEntries) {
          // Skip if already loaded
          if (this.loadedWalletBalances.has(pubkey)) {
            continue;
          }

          // Mark as loaded before the async call to prevent re-triggering
          this.loadedWalletBalances.add(pubkey);

          // Initialize and load balance for each wallet
          this.nwcService.selectWallet(pubkey);
          this.nwcService.getBalance(pubkey);
        }
      });
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

    const pin = await this.pinPrompt.promptForPin();

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

    const pin = await this.pinPrompt.promptForPin();

    if (!pin) {
      // User cancelled
      this.snackBar.open('PIN required to access recovery phrase', 'Dismiss', { duration: 3000 });
      return null;
    }

    try {
      // Try to decrypt with the provided PIN
      const encryptedData = JSON.parse(account.mnemonic);
      const mnemonic = await this.crypto.decryptPrivateKey(encryptedData, pin);
      this.snackBar.open('Recovery phrase unlocked', 'Dismiss', { duration: 2000 });
      return mnemonic;
    } catch {
      // Wrong PIN
      this.snackBar.open('Incorrect PIN. Please try again.', 'Dismiss', { duration: 3000 });
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

  selectDonationAmount(amount: number): void {
    this.selectedDonationAmount.set(amount);
    this.customDonationAmount.reset();
    this.donationError.set(null);
  }

  selectCustomAmount(): void {
    this.selectedDonationAmount.set(null);
    this.donationError.set(null);
  }

  getDonationAmount(): number | null {
    if (this.selectedDonationAmount() !== null) {
      return this.selectedDonationAmount();
    }
    return this.customDonationAmount.value;
  }

  selectConnection(connectionString: string): void {
    this.selectedConnectionString.set(connectionString);
  }

  /**
   * Returns all connections across all wallets as a flat list
   * Each entry contains the connection string and wallet info for display
   */
  getAllConnections(): { connectionString: string; walletName: string; walletPubkey: string; index: number }[] {
    const connections: { connectionString: string; walletName: string; walletPubkey: string; index: number }[] = [];
    const walletEntries = this.getWalletEntries();

    for (const [pubkey, wallet] of walletEntries) {
      wallet.connections.forEach((conn, index) => {
        const name = wallet.connections.length > 1
          ? `${this.getWalletName(wallet)} #${index + 1}`
          : this.getWalletName(wallet);
        connections.push({
          connectionString: conn,
          walletName: name,
          walletPubkey: pubkey,
          index
        });
      });
    }

    return connections;
  }

  async donateWithSelectedWallet(): Promise<void> {
    const allConnections = this.getAllConnections();
    let connectionString = this.selectedConnectionString();

    // Auto-select first connection if only one exists
    if (!connectionString && allConnections.length === 1) {
      connectionString = allConnections[0].connectionString;
    }

    if (!connectionString) {
      this.snackBar.open('Please select a wallet connection', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    const amount = this.getDonationAmount();
    if (!amount || amount <= 0) {
      this.snackBar.open('Please select or enter a donation amount', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    this.isDonating.set(true);
    this.donationSuccess.set(false);
    this.donationError.set(null);

    try {
      const request = await new LN(connectionString).pay('nostria@coinos.io', USD(amount));
      console.log('Payment request created:', request);

      this.donationSuccess.set(true);
      this.snackBar.open(`Thank you for your $${amount.toFixed(2)} donation!`, 'Dismiss', {
        duration: 5000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });

      // Reset donation state after success
      this.selectedDonationAmount.set(null);
      this.customDonationAmount.reset();
    } catch (error) {
      console.error('Donation failed:', error);
      this.donationError.set('Donation failed. Please try again.');
      this.snackBar.open('Donation failed. Please try again.', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    } finally {
      this.isDonating.set(false);
    }
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

  // NWC Wallet Balance and Transactions

  /**
   * Toggle expanded wallet details view (for transactions)
   */
  toggleWalletDetails(pubkey: string): void {
    if (this.expandedWallet() === pubkey) {
      this.expandedWallet.set(null);
    } else {
      this.expandedWallet.set(pubkey);
      // Load transactions when expanding
      this.loadTransactions(pubkey);
    }
  }

  /**
   * Load transactions for a wallet
   */
  async loadTransactions(pubkey: string): Promise<void> {
    await this.nwcService.getTransactions(pubkey, { limit: 20 });
  }

  /**
   * Refresh wallet balance
   */
  async refreshBalance(pubkey: string): Promise<void> {
    await this.nwcService.getBalance(pubkey);
  }

  /**
   * Refresh wallet data (balance and transactions)
   */
  async refreshWalletData(pubkey: string): Promise<void> {
    await this.nwcService.refreshWalletData(pubkey);
  }

  /**
   * Get cached wallet data for display
   */
  getWalletData(pubkey: string): WalletData | null {
    return this.nwcService.getWalletData(pubkey);
  }

  /**
   * Format millisatoshis to readable string
   */
  formatMsats(msats: number): string {
    return this.nwcService.formatMsats(msats);
  }

  /**
   * Format balance to sats
   */
  formatBalanceToSats(msats: number): number {
    return this.nwcService.formatBalanceToSats(msats);
  }

  /**
   * Get transaction icon based on type
   */
  getTransactionIcon(tx: NwcTransaction): string {
    return tx.type === 'incoming' ? 'call_received' : 'call_made';
  }

  /**
   * Get transaction color class based on type
   */
  getTransactionClass(tx: NwcTransaction): string {
    return tx.type === 'incoming' ? 'tx-incoming' : 'tx-outgoing';
  }

  /**
   * Format transaction amount with sign
   */
  formatTransactionAmount(tx: NwcTransaction): string {
    const sign = tx.type === 'incoming' ? '+' : '-';
    return `${sign}${this.formatMsats(tx.amount)}`;
  }

  /**
   * Get transaction description or fallback
   */
  getTransactionDescription(tx: NwcTransaction): string {
    if (tx.description) return tx.description;
    if (tx.type === 'incoming') return 'Received payment';
    return 'Sent payment';
  }

  /**
   * Format timestamp to relative or absolute date
   */
  formatTransactionDate(timestamp: number): Date {
    return new Date(timestamp * 1000);
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
