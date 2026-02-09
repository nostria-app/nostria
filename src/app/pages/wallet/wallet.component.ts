import { ChangeDetectionStrategy, Component, inject, signal, effect, untracked } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterModule } from '@angular/router';
import { Wallets, Wallet } from '../../services/wallets';
import { NwcService, WalletData, NwcTransaction } from '../../services/nwc.service';
import { LN, USD } from '@getalby/sdk';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { DatePipe, DecimalPipe } from '@angular/common';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { AddWalletDialogComponent } from './add-wallet-dialog/add-wallet-dialog.component';
import { SettingsService } from '../../services/settings.service';

@Component({
  selector: 'app-wallet',
  imports: [
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatDividerModule,
    MatTooltipModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    ReactiveFormsModule,
    RouterModule,
    UserProfileComponent,
    DatePipe,
  ],
  templateUrl: './wallet.component.html',
  styleUrl: './wallet.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WalletComponent {
  // Toggle wallet balance hiding
  toggleHideWalletAmounts() {
    const current = this.settingsService.settings().hideWalletAmounts;
    this.settingsService.updateSettings({ hideWalletAmounts: !current });
  }

  snackBar = inject(MatSnackBar);
  nwcService = inject(NwcService);
  wallets = inject(Wallets);
  private customDialog = inject(CustomDialogService);
  private settingsService = inject(SettingsService);

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

  // Donation-related properties
  developerPubkeys = [
    '17e2889fba01021d048a13fd0ba108ad31c38326295460c21e69c43fa8fbe515',
    'cbec30a9038fe934b55272b046df47eb4d20ef006de0acbe46b0c0dae06e5d5b',
    '5f432a9f39b58ff132fc0a4c8af10d42efd917d8076f68bb7f2f91ed7d4f6a41',
    '7e2b09f951ed9be483284e7469ac20ac427d3264633d250c9d01e4265c99ed42',
  ];
  selectedConnectionString = signal<string | null>(null);
  selectedDonationAmount = signal<number | null>(5);
  customDonationAmount = new FormControl<number | null>(null, [Validators.min(0.01)]);
  isDonating = signal(false);
  donationSuccess = signal(false);
  donationError = signal<string | null>(null);

  // Active tab index
  activeTabIndex = signal(0);

  constructor() {
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

  openAddWalletDialog(): void {
    this.customDialog.open(AddWalletDialogComponent, {
      title: $localize`:@@wallet.add.title:Add Wallet`,
      width: '500px',
    });
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
        const name =
          wallet.connections.length > 1
            ? `${this.getWalletName(wallet)} #${index + 1}`
            : this.getWalletName(wallet);
        connections.push({
          connectionString: conn,
          walletName: name,
          walletPubkey: pubkey,
          index,
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
    if (this.settingsService.settings().hideWalletAmounts) {
      const sign = tx.type === 'incoming' ? '+' : '-';
      return `${sign}****`;
    }
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

  /**
   * Get total balance across all wallets
   */
  getTotalBalance(): string {
    const walletEntries = this.getWalletEntries();
    let totalMsats = 0;
    let hasData = false;

    for (const [pubkey] of walletEntries) {
      const walletData = this.nwcService.getWalletData(pubkey);
      if (walletData?.balance) {
        totalMsats += walletData.balance.balance;
        hasData = true;
      }
    }

    if (!hasData) {
      return '...';
    }

    // Check if amounts should be hidden
    if (this.settingsService.settings().hideWalletAmounts) {
      return '****';
    }

    const sats = Math.floor(totalMsats / 1000);
    return sats.toLocaleString();
  }

  /**
   * Format balance to sats or hide if setting is enabled
   */
  getDisplayBalance(msats: number | undefined): string {
    if (msats === undefined) {
      return '...';
    }

    if (this.settingsService.settings().hideWalletAmounts) {
      return '****';
    }

    const sats = Math.floor(msats / 1000);
    return sats.toLocaleString();
  }

  /**
   * Get all transactions across all wallets, sorted by date
   */
  getAllTransactions(): { tx: NwcTransaction; walletName: string; walletPubkey: string }[] {
    const allTransactions: { tx: NwcTransaction; walletName: string; walletPubkey: string }[] = [];
    const walletEntries = this.getWalletEntries();

    for (const [pubkey, wallet] of walletEntries) {
      const walletData = this.getWalletData(pubkey);
      if (walletData?.transactions) {
        for (const tx of walletData.transactions) {
          allTransactions.push({
            tx,
            walletName: this.getWalletName(wallet),
            walletPubkey: pubkey,
          });
        }
      }
    }

    // Sort by date, newest first
    allTransactions.sort((a, b) => b.tx.created_at - a.tx.created_at);

    return allTransactions;
  }

  /**
   * Check if any wallet is loading transactions
   */
  isLoadingTransactions(): boolean {
    const walletEntries = this.getWalletEntries();
    for (const [pubkey] of walletEntries) {
      const walletData = this.getWalletData(pubkey);
      if (walletData?.loading) {
        return true;
      }
    }
    return false;
  }

  /**
   * Load all transactions across all wallets for the Transactions tab
   */
  async loadAllTransactions(): Promise<void> {
    const walletEntries = this.getWalletEntries();
    for (const [pubkey] of walletEntries) {
      await this.nwcService.getTransactions(pubkey, { limit: 20 });
    }
  }

  onTabChange(index: number): void {
    this.activeTabIndex.set(index);
    // Load transactions when switching to Transactions tab
    if (index === 1) {
      this.loadAllTransactions();
    }
  }
}
