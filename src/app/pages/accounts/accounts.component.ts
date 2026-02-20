import { Component, inject, signal, effect, OnInit, computed, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTabsModule } from '@angular/material/tabs';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatExpansionModule } from '@angular/material/expansion';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { nip19 } from 'nostr-tools';

import {
  ConfirmDialogComponent,
  ConfirmDialogData,
} from '../../components/confirm-dialog/confirm-dialog.component';
import { QRCodeDialogComponent } from '../../components/qrcode-dialog/qrcode-dialog.component';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { NPubPipe } from '../../pipes/npub.pipe';
import { LayoutService } from '../../services/layout.service';
import { AccountStateService } from '../../services/account-state.service';
import { UtilitiesService } from '../../services/utilities.service';
import { CryptoEncryptionService, EncryptedData } from '../../services/crypto-encryption.service';
import { PinPromptService } from '../../services/pin-prompt.service';
import { ApplicationService } from '../../services/application.service';
import { PremiumApiService, SubscriptionHistoryItem, PaymentHistoryItem } from '../../services/premium-api.service';
import { SetUsernameDialogComponent, SetUsernameDialogData } from '../premium/set-username-dialog/set-username-dialog.component';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-accounts',
  imports: [
    CommonModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatListModule,
    MatDialogModule,
    MatDividerModule,
    MatTooltipModule,
    MatTabsModule,
    MatInputModule,
    MatFormFieldModule,
    MatProgressSpinnerModule,
    MatExpansionModule,
    ReactiveFormsModule,
    RouterLink,
    NPubPipe,
  ],
  templateUrl: './accounts.component.html',
  styleUrl: './accounts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountsComponent implements OnInit, OnDestroy {
  nostrService = inject(NostrService);
  layout = inject(LayoutService);
  private dialog = inject(MatDialog);
  private logger = inject(LoggerService);
  accountState = inject(AccountStateService);
  utilities = inject(UtilitiesService);
  crypto = inject(CryptoEncryptionService);
  pinPrompt = inject(PinPromptService);
  snackBar = inject(MatSnackBar);
  app = inject(ApplicationService);
  premiumApi = inject(PremiumApiService);
  private route = inject(ActivatedRoute);
  environment = environment;

  private destroy$ = new Subject<void>();

  // Tab index
  selectedTabIndex = signal(0);

  // Credentials signals
  isNsecVisible = signal(false);
  isMnemonicVisible = signal(false);
  isChangingPin = signal(false);
  isResettingPin = signal(false);
  oldPinControl = new FormControl('', [Validators.required, Validators.minLength(4)]);
  newPinControl = new FormControl('', [Validators.required, Validators.minLength(4)]);
  confirmPinControl = new FormControl('', [Validators.required, Validators.minLength(4)]);
  resetPinControl = new FormControl('', [Validators.required, Validators.minLength(4)]);
  private cachedNsec = signal<string>('');
  private cachedMnemonic = signal<string>('');

  // Premium signals
  subscriptionHistory = signal<SubscriptionHistoryItem[]>([]);
  paymentHistory = signal<PaymentHistoryItem[]>([]);
  isLoadingHistory = signal(false);
  private premiumDataLoaded = false;

  // Premium computed values
  isExpired = computed(() => {
    const expires = this.accountState.subscription()?.expires;
    return expires ? expires < Date.now() : false;
  });

  expiresIn = computed(() => {
    const expires = this.accountState.subscription()?.expires;
    if (!expires) return null;
    
    const now = Date.now();
    const diff = expires - now;
    
    if (diff <= 0) return 'Expired';
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days > 30) {
      const months = Math.floor(days / 30);
      return `${months} month${months > 1 ? 's' : ''}`;
    }
    return `${days} day${days !== 1 ? 's' : ''}`;
  });

  isExpiringSoon = computed(() => {
    const expires = this.accountState.subscription()?.expires;
    if (!expires) return false;
    
    const thirtyDaysFromNow = Date.now() + (30 * 24 * 60 * 60 * 1000);
    return expires < thirtyDaysFromNow && expires > Date.now();
  });

  constructor() {
    // Watch for account changes and reload nsec and mnemonic
    effect(() => {
      const account = this.accountState.account();
      if (account) {
        this.loadNsec();
        this.loadMnemonic();
      } else {
        this.cachedNsec.set('');
        this.cachedMnemonic.set('');
      }
    });

    // Load premium data only when the Premium tab is selected
    effect(() => {
      const tabIndex = this.selectedTabIndex();
      if (tabIndex === 2 && !this.premiumDataLoaded) {
        this.premiumDataLoaded = true;
        this.refreshPremiumData();
      }
    });
  }

  ngOnInit(): void {
    // Check for tab query parameter
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const tab = params['tab'];
      if (tab === 'credentials') {
        this.selectedTabIndex.set(1);
      } else if (tab === 'premium') {
        this.selectedTabIndex.set(2);
      } else {
        this.selectedTabIndex.set(0);
      }
    });

    // Load credentials
    this.loadNsec();
    this.loadMnemonic();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ============ ACCOUNTS TAB METHODS ============

  removeAccount(event: Event, pubkey: string): void {
    event.stopPropagation();
    this.logger.debug('Attempting to remove account', { pubkey });

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Remove Account',
        message:
          'If you do not have backup of your nsec for this account, your account will be permanently deleted and lost. Only if you have a backup, will you be able to restore it again. Are you sure?',
        confirmText: 'Remove Account',
        cancelText: 'Cancel',
        confirmColor: 'warn',
      } as ConfirmDialogData,
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.logger.debug('Removing account confirmed', { pubkey });
        const isCurrentAccount = this.accountState.account()?.pubkey === pubkey;

        if (isCurrentAccount) {
          const allAccounts = this.accountState.accounts();
          const nextAccount = allAccounts.find(acc => acc.pubkey !== pubkey);
          this.nostrService.removeAccount(pubkey);
          if (nextAccount) {
            this.logger.debug('Switching to another account after removing current', {
              nextPubkey: nextAccount.pubkey,
            });
            this.nostrService.switchToUser(nextAccount.pubkey);
          }
        } else {
          this.nostrService.removeAccount(pubkey);
        }
      }
    });
  }

  switchAccount(pubkey: string): void {
    this.logger.debug('Switching to account', { pubkey });
    this.nostrService.switchToUser(pubkey);
  }

  // ============ CREDENTIALS TAB METHODS ============

  private async loadNsec(): Promise<void> {
    const account = this.accountState.account();
    if (!account?.privkey || account.source !== 'nsec') {
      this.cachedNsec.set('');
      return;
    }

    try {
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

  private async getDecryptedNsecWithPrompt(): Promise<string | null> {
    const account = this.accountState.account();
    if (!account?.privkey) {
      return null;
    }

    try {
      const privkey = await this.nostrService.getDecryptedPrivateKey(account, this.crypto.DEFAULT_PIN);
      return this.utilities.getNsecFromPrivkey(privkey);
    } catch {
      return await this.promptForPinAndDecrypt();
    }
  }

  private async promptForPinAndDecrypt(): Promise<string | null> {
    const account = this.accountState.account();
    if (!account?.privkey) {
      return null;
    }

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
      this.snackBar.open('PIN required to access private key', 'Dismiss', { duration: 3000 });
      return null;
    }

    try {
      const privkey = await this.nostrService.getDecryptedPrivateKey(account, pin);
      const nsec = this.utilities.getNsecFromPrivkey(privkey);
      this.snackBar.open('Private key unlocked', 'Dismiss', { duration: 2000 });
      return nsec;
    } catch {
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

  private async getDecryptedMnemonicWithPrompt(): Promise<string | null> {
    const account = this.accountState.account();
    if (!account?.mnemonic) {
      return null;
    }

    try {
      if (!account.isMnemonicEncrypted) {
        return account.mnemonic;
      }
      const encryptedData = JSON.parse(account.mnemonic);
      return await this.crypto.decryptPrivateKey(encryptedData, this.crypto.DEFAULT_PIN);
    } catch {
      return await this.promptForPinAndDecryptMnemonic();
    }
  }

  private async promptForPinAndDecryptMnemonic(): Promise<string | null> {
    const account = this.accountState.account();
    if (!account?.mnemonic) {
      return null;
    }

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
      this.snackBar.open('PIN required to access recovery phrase', 'Dismiss', { duration: 3000 });
      return null;
    }

    try {
      const encryptedData = JSON.parse(account.mnemonic);
      const mnemonic = await this.crypto.decryptPrivateKey(encryptedData, pin);
      this.snackBar.open('Recovery phrase unlocked', 'Dismiss', { duration: 2000 });
      return mnemonic;
    } catch {
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
      if (label === 'Private key' && !text) {
        await this.loadNsec();
        text = this.cachedNsec();
      }
      await navigator.clipboard.writeText(text);
      this.snackBar.open(`${label} copied to clipboard`, 'Dismiss', { duration: 3000 });
    } catch (error) {
      this.logger.error('Failed to copy to clipboard:', error);
      this.snackBar.open('Failed to copy to clipboard', 'Dismiss', { duration: 3000 });
    }
  }

  async downloadCredentials(): Promise<void> {
    const account = this.accountState.account();
    const pubkey = this.accountState.pubkey();

    if (!account?.privkey || !pubkey) {
      this.snackBar.open('Private key not available for download', 'Dismiss', { duration: 3000 });
      return;
    }

    try {
      const nsec = await this.getDecryptedNsecWithPrompt();
      if (!nsec) return;

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

      this.snackBar.open('Credentials downloaded successfully', 'Dismiss', { duration: 3000 });
    } catch (error) {
      this.logger.error('Failed to download credentials:', error);
      this.snackBar.open('Failed to download credentials. Could not decrypt private key.', 'Dismiss', { duration: 3000 });
    }
  }

  async exportQrCode(): Promise<void> {
    const account = this.accountState.account();

    if (!account?.privkey) {
      this.snackBar.open('Private key not available for export', 'Dismiss', { duration: 3000 });
      return;
    }

    try {
      const nsec = await this.getDecryptedNsecWithPrompt();
      if (!nsec) return;

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
      this.logger.error('Failed to export QR code:', error);
      this.snackBar.open('Failed to export QR code. Could not decrypt private key.', 'Dismiss', { duration: 3000 });
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

    const updatedAccount = { ...account, preferredSigningMethod: method };
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

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '450px',
      data: {
        title: 'Remove Private Key',
        message: `WARNING: This action is IRREVERSIBLE!\n\n` +
          `You are about to permanently remove the private key from this account. ` +
          `After removal, you will only be able to sign using your remote signer.\n\n` +
          `Before proceeding, make sure you have:\n` +
          `- Backed up your private key (nsec) in a secure location\n` +
          `- Verified that your remote signer is working correctly\n` +
          `- Tested signing operations with the remote signer\n\n` +
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
        this.snackBar.open('Remote signer disconnected.', 'Dismiss', { duration: 3000 });
      }
    });
  }

  getMaskedNsec(nsec: string): string {
    if (!nsec) return '';
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

  hasEncryptedKey(): boolean {
    const account = this.accountState.account();
    return account?.isEncrypted === true && account?.source === 'nsec';
  }

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

  startChangingPin(): void {
    this.isChangingPin.set(true);
    this.isUsingDefaultPin().then(isDefault => {
      if (isDefault) {
        this.oldPinControl.setValue(this.crypto.DEFAULT_PIN);
      }
    });
  }

  cancelChangingPin(): void {
    this.isChangingPin.set(false);
    this.oldPinControl.reset();
    this.newPinControl.reset();
    this.confirmPinControl.reset();
  }

  startResettingPin(): void {
    this.isResettingPin.set(true);
    this.resetPinControl.reset();
  }

  cancelResettingPin(): void {
    this.isResettingPin.set(false);
    this.resetPinControl.reset();
  }

  async resetPinToDefault(): Promise<void> {
    const account = this.accountState.account();

    if (!account || !account.isEncrypted || !account.privkey) {
      this.snackBar.open('No encrypted private key to reset', 'Dismiss', { duration: 3000 });
      return;
    }

    const currentPin = this.resetPinControl.value;

    if (!currentPin) {
      this.snackBar.open('Please enter your current PIN', 'Dismiss', { duration: 3000 });
      return;
    }

    try {
      const encryptedPrivkey = JSON.parse(account.privkey) as EncryptedData;
      const reencryptedPrivkey = await this.crypto.reencryptPrivateKey(
        encryptedPrivkey,
        currentPin,
        this.crypto.DEFAULT_PIN
      );

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
          reencryptedMnemonic = account.mnemonic;
        }
      }

      const updatedAccount = {
        ...account,
        privkey: JSON.stringify(reencryptedPrivkey),
        ...(reencryptedMnemonic && { mnemonic: reencryptedMnemonic }),
      };

      await this.nostrService.setAccount(updatedAccount);
      this.pinPrompt.clearCache();

      this.snackBar.open('PIN reset to default (0000) successfully', 'Dismiss', { duration: 3000 });
      this.cancelResettingPin();
    } catch (error) {
      this.logger.error('Failed to reset PIN:', error);
      this.snackBar.open('Failed to reset PIN. Please check your current PIN and try again.', 'Dismiss', { duration: 5000 });
    }
  }

  async changePin(): Promise<void> {
    const account = this.accountState.account();

    if (!account || !account.isEncrypted || !account.privkey) {
      this.snackBar.open('No encrypted private key to update', 'Dismiss', { duration: 3000 });
      return;
    }

    const oldPin = this.oldPinControl.value;
    const newPin = this.newPinControl.value;
    const confirmPin = this.confirmPinControl.value;

    if (!oldPin || !newPin || !confirmPin) {
      this.snackBar.open('Please fill in all PIN fields', 'Dismiss', { duration: 3000 });
      return;
    }

    if (newPin !== confirmPin) {
      this.snackBar.open('New PIN and confirmation do not match', 'Dismiss', { duration: 3000 });
      return;
    }

    if (newPin.length < 4) {
      this.snackBar.open('PIN must be at least 4 characters', 'Dismiss', { duration: 3000 });
      return;
    }

    try {
      const encryptedPrivkey = JSON.parse(account.privkey) as EncryptedData;
      const reencryptedPrivkey = await this.crypto.reencryptPrivateKey(
        encryptedPrivkey,
        oldPin,
        newPin
      );

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
          reencryptedMnemonic = account.mnemonic;
        }
      }

      const updatedAccount = {
        ...account,
        privkey: JSON.stringify(reencryptedPrivkey),
        ...(reencryptedMnemonic && { mnemonic: reencryptedMnemonic }),
      };

      await this.nostrService.setAccount(updatedAccount);
      this.pinPrompt.clearCache();

      this.snackBar.open('PIN changed successfully', 'Dismiss', { duration: 3000 });
      this.cancelChangingPin();
    } catch (error) {
      this.logger.error('Failed to change PIN:', error);
      this.snackBar.open('Failed to change PIN. Please check your old PIN and try again.', 'Dismiss', { duration: 5000 });
    }
  }

  // ============ PREMIUM TAB METHODS ============

  async refreshPremiumData(): Promise<void> {
    try {
      await this.accountState.refreshSubscription();
      if (this.accountState.subscription()?.expires) {
        this.loadHistory();
      }
    } catch (error) {
      this.logger.error('Failed to refresh subscription:', error);
    }
  }

  loadHistory(): void {
    this.isLoadingHistory.set(true);
    
    this.premiumApi.getSubscriptionHistory()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (history) => this.subscriptionHistory.set(history),
        error: (err) => this.logger.error('Failed to load subscription history:', err)
      });

    this.premiumApi.getPaymentHistory()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (history) => {
          this.paymentHistory.set(history);
          this.isLoadingHistory.set(false);
        },
        error: (err) => {
          this.logger.error('Failed to load payment history:', err);
          this.isLoadingHistory.set(false);
        }
      });
  }

  formatBillingCycle(cycle: string): string {
    switch (cycle) {
      case 'monthly': return '1 Month';
      case 'quarterly': return '3 Months';
      case 'yearly': return '12 Months';
      default: return cycle;
    }
  }

  formatPrice(cents: number, currency?: string): string {
    const currencyCode = currency || 'USD';
    return `$${(cents / 100).toFixed(2)} ${currencyCode}`;
  }

  openSetUsernameDialog(): void {
    const currentUsername = this.accountState.subscription()?.username;

    const dialogRef = this.dialog.open<SetUsernameDialogComponent, SetUsernameDialogData>(
      SetUsernameDialogComponent,
      {
        width: '500px',
        disableClose: false,
        data: { currentUsername },
      }
    );

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.logger.debug('Username operation completed successfully, refreshing subscription');
        this.accountState.refreshSubscription().catch(error => {
          this.logger.error('Failed to refresh subscription after username update:', error);
        });
      }
    });
  }
}
