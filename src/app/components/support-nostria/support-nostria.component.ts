import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LightningAddress, getSatoshiValue } from '@getalby/lightning-tools';
import { NWCClient } from '@getalby/sdk/nwc';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { Wallet, Wallets } from '../../services/wallets';

@Component({
  selector: 'app-support-nostria',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    UserProfileComponent,
  ],
  templateUrl: './support-nostria.component.html',
  styleUrl: './support-nostria.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupportNostriaComponent {
  private readonly snackBar = inject(MatSnackBar);
  private readonly wallets = inject(Wallets);

  readonly developerPubkeys = [
    '17e2889fba01021d048a13fd0ba108ad31c38326295460c21e69c43fa8fbe515',
    'cbec30a9038fe934b55272b046df47eb4d20ef006de0acbe46b0c0dae06e5d5b',
    '5f432a9f39b58ff132fc0a4c8af10d42efd917d8076f68bb7f2f91ed7d4f6a41',
    '7e2b09f951ed9be483284e7469ac20ac427d3264633d250c9d01e4265c99ed42',
  ];

  readonly supportHighlights = [
    'Independent development',
    'Voluntary support',
    'Helps ship faster',
  ];

  readonly selectedConnectionString = signal<string | null>(null);
  readonly selectedDonationAmount = signal<number | null>(5);
  readonly customDonationAmount = new FormControl<number | null>(null, [Validators.min(0.01)]);
  readonly isDonating = signal(false);
  readonly donationSuccess = signal(false);
  readonly donationError = signal<string | null>(null);

  constructor() {
    effect(() => {
      const primaryWallet = this.wallets.getPrimaryWallet();
      untracked(() => {
        if (!this.selectedConnectionString() && primaryWallet) {
          const [, wallet] = primaryWallet;
          if (wallet.connections.length > 0) {
            this.selectedConnectionString.set(wallet.connections[0]);
          }
        }
      });
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

  selectConnection(connectionString: string): void {
    this.selectedConnectionString.set(connectionString);
  }

  getDonationAmount(): number | null {
    if (this.selectedDonationAmount() !== null) {
      return this.selectedDonationAmount();
    }

    return this.customDonationAmount.value;
  }

  getAllConnections(): { connectionString: string; walletName: string; walletPubkey: string; index: number }[] {
    const connections: { connectionString: string; walletName: string; walletPubkey: string; index: number }[] = [];
    const walletEntries = Object.entries(this.wallets.wallets());

    for (const [pubkey, wallet] of walletEntries) {
      wallet.connections.forEach((connectionString, index) => {
        const walletName = wallet.connections.length > 1
          ? `${this.getWalletName(wallet)} #${index + 1}`
          : this.getWalletName(wallet);

        connections.push({
          connectionString,
          walletName,
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

    if (!connectionString && allConnections.length === 1) {
      connectionString = allConnections[0].connectionString;
    }

    if (!connectionString) {
      this.snackBar.open('Please select a wallet connection', 'Dismiss', { duration: 3000 });
      return;
    }

    const amount = this.getDonationAmount();
    if (!amount || amount <= 0) {
      this.snackBar.open('Please select or enter a donation amount', 'Dismiss', { duration: 3000 });
      return;
    }

    this.isDonating.set(true);
    this.donationSuccess.set(false);
    this.donationError.set(null);

    try {
      const satoshi = await getSatoshiValue({ amount, currency: 'USD' });
      const lightningAddress = new LightningAddress('nostria@rizful.com');
      await lightningAddress.fetch();
      const invoiceObj = await lightningAddress.requestInvoice({ satoshi });
      const invoice = invoiceObj.paymentRequest;

      const nwcClient = new NWCClient({ nostrWalletConnectUrl: connectionString });
      try {
        await nwcClient.payInvoice({ invoice });
      } finally {
        nwcClient.close();
      }

      this.donationSuccess.set(true);
      this.snackBar.open(`Thank you for your $${amount.toFixed(2)} donation!`, 'Dismiss', { duration: 5000 });
      this.selectedDonationAmount.set(5);
      this.customDonationAmount.reset();
    } catch (error) {
      console.error('Donation failed:', error);
      this.donationError.set('Donation failed. Please try again.');
      this.snackBar.open('Donation failed. Please try again.', 'Dismiss', { duration: 3000 });
    } finally {
      this.isDonating.set(false);
    }
  }

  private getWalletName(wallet: Wallet): string {
    return wallet.name?.trim() || 'Unnamed Wallet';
  }
}