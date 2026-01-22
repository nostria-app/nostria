import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  ConfirmDialogComponent,
  ConfirmDialogData,
} from '../../components/confirm-dialog/confirm-dialog.component';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { NPubPipe } from '../../pipes/npub.pipe';
import { LayoutService } from '../../services/layout.service';
import { AccountStateService } from '../../services/account-state.service';

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
    NPubPipe,
  ],
  templateUrl: './accounts.component.html',
  styleUrl: './accounts.component.scss',
})
export class AccountsComponent {
  nostrService = inject(NostrService);
  layout = inject(LayoutService);
  private dialog = inject(MatDialog);
  private logger = inject(LoggerService);
  accountState = inject(AccountStateService);

  /**
   * Remove an account after confirmation
   * @param event The click event
   * @param pubkey The public key of the account to remove
   */ removeAccount(event: Event, pubkey: string): void {
    // Prevent click event from propagating
    event.stopPropagation();
    this.logger.debug('Attempting to remove account', { pubkey });

    // Show confirmation dialog
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

        // Check if this is the current account
        const isCurrentAccount = this.accountState.account()?.pubkey === pubkey;

        // Find another account to switch to if we're removing the current one
        if (isCurrentAccount) {
          const allAccounts = this.accountState.accounts();
          const nextAccount = allAccounts.find(acc => acc.pubkey !== pubkey);

          // Remove the account
          this.nostrService.removeAccount(pubkey);

          // If there's another account available, switch to it
          if (nextAccount) {
            this.logger.debug('Switching to another account after removing current', {
              nextPubkey: nextAccount.pubkey,
            });
            this.nostrService.switchToUser(nextAccount.pubkey);
          }
        } else {
          // Just remove the account if it's not the current one
          this.nostrService.removeAccount(pubkey);
        }
      }
    });
  }

  /**
   * Switch to a different account
   * @param pubkey The public key to switch to
   */
  switchAccount(pubkey: string): void {
    this.logger.debug('Switching to account', { pubkey });
    this.nostrService.switchToUser(pubkey);
  }
}
