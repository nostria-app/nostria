import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { UserProfileComponent } from '../user-profile/user-profile.component';

export interface ZapConfirmationData {
  recipient: {
    name?: string;
    displayName?: string;
    pubkey: string;
    picture?: string;
  };
  amount: number;
  message?: string;
  wallet: {
    id: string;
    name: string;
  };
  eventTitle?: string;
  isProfileZap: boolean;
}

@Component({
  selector: 'app-zap-confirmation-dialog',
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    UserProfileComponent,
  ],
  template: `
    <div class="confirmation-dialog">
      <h2 mat-dialog-title>
        <mat-icon>bolt</mat-icon>
        Confirm Lightning Zap
      </h2>

      <mat-dialog-content>
        <div class="confirmation-content">
          <!-- Recipient Info -->
          <div class="recipient-section">
            <h3>Zapping</h3>
            <div class="recipient-info">
              <app-user-profile [pubkey]="data.recipient.pubkey"></app-user-profile>
            </div>
            @if (data.eventTitle) {
              <div class="event-context">
                <mat-icon>article</mat-icon>
                <span>{{ data.eventTitle }}</span>
              </div>
            } @else if (data.isProfileZap) {
              <div class="event-context">
                <mat-icon>person</mat-icon>
                <span>Profile zap</span>
              </div>
            }
          </div>

          <mat-divider></mat-divider>

          <!-- Amount -->
          <div class="amount-section">
            <h3>Amount</h3>
            <div class="amount-display">
              <mat-icon>bolt</mat-icon>
              <span class="amount">{{ formatAmount(data.amount) }}</span>
              <span class="unit">sats</span>
            </div>
          </div>

          <mat-divider></mat-divider>

          <!-- Message -->
          @if (data.message) {
            <div class="message-section">
              <h3>Message</h3>
              <div class="message-content">
                <mat-icon>message</mat-icon>
                <p>{{ data.message }}</p>
              </div>
            </div>
            <mat-divider></mat-divider>
          }

          <!-- Wallet -->
          <div class="wallet-section">
            <h3>Using Wallet</h3>
            <div class="wallet-info">
              <mat-icon>account_balance_wallet</mat-icon>
              <span>{{ data.wallet.name }}</span>
            </div>
          </div>
        </div>
      </mat-dialog-content>

      <mat-dialog-actions>
        <button mat-button (click)="cancel()">Cancel</button>
        <button mat-flat-button color="primary" (click)="confirm()" class="confirm-button">
          <mat-icon>bolt</mat-icon>
          Send Zap
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [
    `
      .confirmation-dialog {
        min-width: 400px;
        max-width: 500px;
      }

      h2[mat-dialog-title] {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 16px 0;
        color: #1976d2;
      }

      .confirmation-content {
        padding: 0;
      }

      .recipient-section,
      .amount-section,
      .message-section,
      .wallet-section {
        padding: 16px 0;
      }

      .recipient-section h3,
      .amount-section h3,
      .message-section h3,
      .wallet-section h3 {
        margin: 0 0 12px 0;
        font-size: 14px;
        font-weight: 500;
        color: #666;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .recipient-info {
        margin-bottom: 8px;
      }

      .event-context {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #666;
        font-size: 14px;
        margin-top: 8px;
      }

      .event-context mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      .amount-display {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 24px;
        font-weight: 500;
      }

      .amount-display mat-icon {
        color: #ff9800;
        font-size: 28px;
        width: 28px;
        height: 28px;
      }

      .amount {
        color: #1976d2;
      }

      .unit {
        color: #666;
        font-size: 16px;
      }

      .message-content {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }

      .message-content mat-icon {
        color: #666;
        margin-top: 2px;
      }

      .message-content p {
        margin: 0;
        color: #333;
        line-height: 1.4;
        word-break: break-word;
      }

      .wallet-info {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #333;
      }

      .wallet-info mat-icon {
        color: #4caf50;
      }

      mat-dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 16px 0 0 0;
        margin: 0;
      }

      .confirm-button {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      mat-divider {
        margin: 8px 0;
      }
    `,
  ],
})
export class ZapConfirmationDialogComponent {
  private dialogRef = inject(MatDialogRef<ZapConfirmationDialogComponent>);
  protected data = inject<ZapConfirmationData>(MAT_DIALOG_DATA);

  formatAmount(amount: number): string {
    if (amount >= 1000000) {
      return (amount / 1000000).toFixed(1) + 'M';
    } else if (amount >= 1000) {
      return (amount / 1000).toFixed(1) + 'K';
    }
    return amount.toLocaleString();
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  confirm(): void {
    this.dialogRef.close(true);
  }
}
