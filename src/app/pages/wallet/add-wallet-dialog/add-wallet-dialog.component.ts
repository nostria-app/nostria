import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CustomDialogRef } from '../../../services/custom-dialog.service';
import { Wallets } from '../../../services/wallets';

@Component({
  selector: 'app-add-wallet-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
  ],
  templateUrl: './add-wallet-dialog.component.html',
  styleUrl: './add-wallet-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddWalletDialogComponent {
  private snackBar = inject(MatSnackBar);
  private wallets = inject(Wallets);
  dialogRef = inject(CustomDialogRef);

  connectionStringControl = new FormControl('', [
    Validators.required,
    Validators.pattern(/^nostr\+walletconnect:\/\//i),
  ]);

  isAddingWallet = signal(false);

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

      this.snackBar.open('Wallet added successfully', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });

      this.dialogRef.close(true);
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

  cancel(): void {
    this.dialogRef.close();
  }
}
