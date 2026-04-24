import { ChangeDetectionStrategy, Component, inject, signal, effect, untracked, OnDestroy } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';

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
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { Wallets, Wallet } from '../../services/wallets';
import { NwcService, WalletData, NwcTransaction } from '../../services/nwc.service';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { DatePipe, DecimalPipe } from '@angular/common';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { AddWalletDialogComponent } from './add-wallet-dialog/add-wallet-dialog.component';
import { SettingsService } from '../../services/settings.service';
import { LoggerService } from '../../services/logger.service';
import { RightPanelService } from '../../services/right-panel.service';
import { ZapHistoryComponent } from '../../components/zap-history/zap-history.component';
import { QrCodeComponent } from '../../components/qr-code/qr-code.component';
import { SupportNostriaComponent } from '../../components/support-nostria/support-nostria.component';
import { SatDisplayService } from '../../services/sat-display.service';

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
    MatSlideToggleModule,
    ReactiveFormsModule,
    FormsModule,
    RouterModule,
    UserProfileComponent,
    DatePipe,
    ZapHistoryComponent,
    QrCodeComponent,
    SupportNostriaComponent,
  ],
  templateUrl: './wallet.component.html',
  styleUrl: './wallet.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WalletComponent implements OnDestroy {
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
  private logger = inject(LoggerService);
  private router = inject(Router);
  readonly rightPanel = inject(RightPanelService);
  readonly satDisplay = inject(SatDisplayService);
  private routerSubscription: Subscription;

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

  bitcoinDonationAddress = 'bc1p733wvkgpew822jwdwxdps46uqr4zpsnt0c8splhln965mtsf0mls4z3yxr';

  nwcProviders = [
    {
      name: 'Rizful',
      url: 'https://rizful.com',
      description: 'Nostr-native custodial wallet with NWC support',
    },
    {
      name: 'Alby',
      url: 'https://getalby.com',
      description: 'Browser extension and hub for Lightning payments',
    },
    {
      name: 'Cashu.me',
      url: 'https://cashu.me',
      description: 'Ecash wallet with Nostr Wallet Connect integration',
    },
    {
      name: 'Minibits',
      url: 'https://www.minibits.cash',
      description: 'Mobile Cashu wallet with NWC support',
    },
    {
      name: 'Coinos',
      url: 'https://coinos.io',
      description: 'Web-based Bitcoin and Lightning wallet',
    },
  ];
  // Wallet transfer properties
  transferFromPubkey = signal<string | null>(null);
  transferToPubkey = signal<string | null>(null);
  transferAmountControl = new FormControl<number | null>(null, [Validators.required, Validators.min(1)]);
  transferMemoControl = new FormControl('');
  isTransferring = signal(false);
  transferError = signal<string | null>(null);
  transferSuccess = signal<string | null>(null);

  // Active tab index
  activeTabIndex = signal(0);

  // Wallet settings - Quick Zap
  quickZapEnabled = signal(false);
  quickZapAmount = signal(21);

  // Wallet settings - Hide Wallet Amounts
  hideWalletAmountsEnabled = signal(false);

  // Wallet settings - Show USD values
  displaySatsInUsdEnabled = signal(false);

  constructor() {
    this.syncTabFromUrl(this.router.url);
    this.loadWalletSettings();

    this.routerSubscription = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(event => {
        this.syncTabFromUrl(event.urlAfterRedirects);
      });

    // Auto-load wallet balances when wallets change
    effect(() => {
      const walletEntries = Object.entries(this.wallets.wallets());

      // Use untracked to prevent signal reads inside async calls from creating dependencies
      untracked(() => {
        const walletPubkeys = walletEntries.map(([pubkey]) => pubkey);

        if (walletPubkeys.length >= 2) {
          const currentFrom = this.transferFromPubkey();
          const currentTo = this.transferToPubkey();

          if (!currentFrom || !walletPubkeys.includes(currentFrom)) {
            this.transferFromPubkey.set(walletPubkeys[0]);
          }

          const nextFrom = this.transferFromPubkey();
          if (!currentTo || !walletPubkeys.includes(currentTo) || currentTo === nextFrom) {
            const fallbackTo = walletPubkeys.find(pubkey => pubkey !== nextFrom) || null;
            this.transferToPubkey.set(fallbackTo);
          }
        } else {
          this.transferFromPubkey.set(null);
          this.transferToPubkey.set(null);
        }

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

  ngOnDestroy(): void {
    this.routerSubscription.unsubscribe();
  }

  goBack(): void {
    this.rightPanel.goBack();
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

  getWalletEntries() {
    return Object.entries(this.wallets.wallets());
  }

  getTransferWalletOptions(): { pubkey: string; name: string }[] {
    return this.getWalletEntries().map(([pubkey, wallet]) => ({
      pubkey,
      name: this.getWalletName(wallet),
    }));
  }

  selectTransferFrom(pubkey: string): void {
    this.transferFromPubkey.set(pubkey);
    this.transferError.set(null);

    if (this.transferToPubkey() === pubkey) {
      const fallbackTo = this.getTransferWalletOptions().find(option => option.pubkey !== pubkey);
      this.transferToPubkey.set(fallbackTo?.pubkey || null);
    }
  }

  selectTransferTo(pubkey: string): void {
    this.transferToPubkey.set(pubkey);
    this.transferError.set(null);

    if (this.transferFromPubkey() === pubkey) {
      const fallbackFrom = this.getTransferWalletOptions().find(option => option.pubkey !== pubkey);
      this.transferFromPubkey.set(fallbackFrom?.pubkey || null);
    }
  }

  async transferBetweenWallets(): Promise<void> {
    const fromPubkey = this.transferFromPubkey();
    const toPubkey = this.transferToPubkey();
    const amountSats = this.transferAmountControl.value;

    if (!fromPubkey || !toPubkey || fromPubkey === toPubkey) {
      this.transferError.set('Please choose two different wallets');
      return;
    }

    if (!amountSats || amountSats <= 0) {
      this.transferError.set('Please enter a valid transfer amount');
      return;
    }

    this.transferError.set(null);
    this.transferSuccess.set(null);
    this.isTransferring.set(true);

    try {
      await this.nwcService.transferBetweenWallets(
        fromPubkey,
        toPubkey,
        amountSats,
        this.transferMemoControl.value || undefined
      );

      await Promise.all([
        this.refreshBalance(fromPubkey),
        this.refreshBalance(toPubkey),
        this.loadTransactions(fromPubkey),
        this.loadTransactions(toPubkey),
      ]);

      const fromName = this.getWalletName(this.wallets.wallets()[fromPubkey]);
      const toName = this.getWalletName(this.wallets.wallets()[toPubkey]);
      const successMessage = `Transferred ${amountSats.toLocaleString()} sats from ${fromName} to ${toName}`;

      this.transferSuccess.set(successMessage);
      this.transferAmountControl.reset();
      this.transferMemoControl.reset();
      this.snackBar.open(successMessage, 'Dismiss', {
        duration: 4000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transfer failed. Please try again.';
      this.transferError.set(message);
      this.snackBar.open(message, 'Dismiss', {
        duration: 4000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    } finally {
      this.isTransferring.set(false);
    }
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

  setPrimaryWallet(pubkey: string, walletName: string): void {
    this.wallets.setPrimaryWallet(pubkey);
    this.snackBar.open(`${walletName} set as primary wallet`, 'Dismiss', {
      duration: 3000,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
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
    return this.satDisplay.formatMsats(msats);
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
    return this.satDisplay.formatMsats(tx.amount, {
      hideWhenWalletHidden: true,
      prefix: sign,
    });
  }

  /**
   * Get transaction description or fallback
   */
  getTransactionDescription(tx: NwcTransaction): string {
    const parsedDescription = this.parseTransactionDescription(tx.description);
    if (parsedDescription) {
      return parsedDescription;
    }

    const metadataDescription = this.parseTransactionMetadata(tx.metadata);
    if (metadataDescription) {
      return metadataDescription;
    }

    if (tx.type === 'incoming') return 'Received payment';
    return 'Sent payment';
  }

  private parseTransactionDescription(description?: string): string | null {
    if (!description) {
      return null;
    }

    const trimmed = description.trim();
    if (!trimmed) {
      return null;
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;

      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (!Array.isArray(item) || item.length < 2) {
            continue;
          }

          const key = String(item[0]).toLowerCase();
          const value = typeof item[1] === 'string' ? item[1].trim() : '';
          if (!value) {
            continue;
          }

          if (key.includes('text/plain') || key.includes('description') || key.includes('memo')) {
            return value;
          }

          if (key.includes('identifier')) {
            return `Payment to ${value}`;
          }
        }
      }

      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        const content = typeof obj['content'] === 'string' ? obj['content'].trim() : '';
        if (content) {
          return content;
        }

        const memo = typeof obj['memo'] === 'string' ? obj['memo'].trim() : '';
        if (memo) {
          return memo;
        }

        const recipient = typeof obj['identifier'] === 'string' ? obj['identifier'].trim() : '';
        if (recipient) {
          return `Payment to ${recipient}`;
        }

        if (typeof obj['kind'] === 'number') {
          return `Nostr event payment (${obj['kind']})`;
        }
      }
    } catch {
      // Not JSON, return cleaned text below
    }

    const cleaned = trimmed.replace(/\s+/g, ' ').trim();
    if (!cleaned) {
      return null;
    }

    if (cleaned.length > 120) {
      return `${cleaned.slice(0, 117)}...`;
    }

    return cleaned;
  }

  private parseTransactionMetadata(metadata?: Record<string, unknown>): string | null {
    if (!metadata) {
      return null;
    }

    const descriptionKeys = ['description', 'memo', 'comment', 'identifier'];
    for (const key of descriptionKeys) {
      const value = metadata[key];
      if (typeof value === 'string' && value.trim()) {
        return key === 'identifier' ? `Payment to ${value.trim()}` : value.trim();
      }
    }

    return null;
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

    return this.satDisplay.getDisplayValueFromMsats(totalMsats, {
      showUnit: false,
      hideWhenWalletHidden: true,
      placeholder: '...',
    }).value;
  }

  /**
   * Format balance to sats or hide if setting is enabled
   */
  getDisplayBalance(msats: number | undefined): string {
    return this.satDisplay.getDisplayValueFromMsats(msats, {
      showUnit: false,
      hideWhenWalletHidden: true,
      placeholder: '...',
    }).value;
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

    const currentPath = this.router.url.split('?')[0].split('#')[0];
    const targetPath = this.getTabPath(index);
    if (currentPath !== targetPath) {
      this.router.navigateByUrl(targetPath);
    }
  }

  private syncTabFromUrl(url: string): void {
    const path = url.split('?')[0].split('#')[0];
    if (path === '/wallet/transactions') {
      this.activeTabIndex.set(1);
      this.loadAllTransactions();
      return;
    }

    if (path === '/wallet/zaps') {
      this.activeTabIndex.set(2);
      return;
    }

    if (path === '/wallet/settings') {
      this.activeTabIndex.set(3);
      return;
    }

    this.activeTabIndex.set(0);
  }

  private getTabPath(index: number): string {
    if (index === 1) {
      return '/wallet/transactions';
    }

    if (index === 2) {
      return '/wallet/zaps';
    }

    if (index === 3) {
      return '/wallet/settings';
    }

    return '/wallet';
  }

  // --- Wallet Settings Methods ---

  private loadWalletSettings(): void {
    const currentSettings = this.settingsService.settings();
    this.quickZapEnabled.set(currentSettings.quickZapEnabled ?? false);
    this.quickZapAmount.set(currentSettings.quickZapAmount ?? 21);
    this.hideWalletAmountsEnabled.set(currentSettings.hideWalletAmounts ?? false);
    this.displaySatsInUsdEnabled.set(currentSettings.displaySatsInUsd ?? false);
  }

  async toggleQuickZap(): Promise<void> {
    const newValue = !this.quickZapEnabled();
    this.quickZapEnabled.set(newValue);

    try {
      await this.settingsService.updateSettings({
        quickZapEnabled: newValue,
      });
      this.snackBar.open(
        newValue ? 'Quick Zap enabled' : 'Quick Zap disabled',
        'Dismiss',
        { duration: 2000 }
      );
    } catch (error) {
      this.logger.error('Failed to save quick zap setting:', error);
      this.quickZapEnabled.set(!newValue);
      this.snackBar.open('Failed to save settings', 'Dismiss', { duration: 3000 });
    }
  }

  async updateQuickZapAmount(): Promise<void> {
    const amount = this.quickZapAmount();
    if (amount <= 0) {
      this.snackBar.open('Please enter a valid positive number', 'Dismiss', { duration: 3000 });
      return;
    }

    try {
      await this.settingsService.updateSettings({
        quickZapAmount: amount,
      });
      this.snackBar.open(`Quick zap amount set to ${amount.toLocaleString()} sats`, 'Dismiss', {
        duration: 2000,
      });
    } catch (error) {
      this.logger.error('Failed to save quick zap amount:', error);
      this.snackBar.open('Failed to save settings', 'Dismiss', { duration: 3000 });
    }
  }

  async toggleDisplaySatsInUsd(): Promise<void> {
    const newValue = !this.displaySatsInUsdEnabled();
    this.displaySatsInUsdEnabled.set(newValue);

    try {
      await this.settingsService.updateSettings({
        displaySatsInUsd: newValue,
      });
      this.snackBar.open(
        newValue ? 'Dollar display enabled' : 'Sats display enabled',
        'Dismiss',
        { duration: 2000 },
      );
    } catch (error) {
      this.logger.error('Failed to save sats display setting:', error);
      this.displaySatsInUsdEnabled.set(!newValue);
      this.snackBar.open('Failed to save settings', 'Dismiss', { duration: 3000 });
    }
  }

  async toggleHideWalletAmountsSetting(): Promise<void> {
    const newValue = !this.hideWalletAmountsEnabled();
    this.hideWalletAmountsEnabled.set(newValue);

    try {
      await this.settingsService.updateSettings({
        hideWalletAmounts: newValue,
      });
      this.snackBar.open(
        newValue ? 'Wallet amounts hidden' : 'Wallet amounts visible',
        'Dismiss',
        { duration: 2000 }
      );
    } catch (error) {
      this.logger.error('Failed to save hide wallet amounts setting:', error);
      this.hideWalletAmountsEnabled.set(!newValue);
      this.snackBar.open('Failed to save settings', 'Dismiss', { duration: 3000 });
    }
  }
}
