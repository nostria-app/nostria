import { Component, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Event } from 'nostr-tools';
import { ZapDialogComponent, ZapDialogData } from '../zap-dialog/zap-dialog.component';
import { ZapService } from '../../services/zap.service';
import { DataService } from '../../services/data.service';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';

@Component({
  selector: 'app-zap-button',
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <button
      mat-icon-button
      [class]="{
        'zap-button': true,
        zapped: hasZapped(),
      }"
      [disabled]="isLoading()"
      (click)="onZapClick($event)"
      [matTooltip]="getTooltip()"
      matTooltipPosition="below"
    >
      <mat-icon>bolt</mat-icon>
    </button>
  `,
  styles: [
    `
      .zap-button {
        color: var(--nostria-bitcoin) !important;
        transition: all 0.2s ease;
      }

      .zap-button:hover {
        background-color: var(--nostria-bitcoin-10);
        transform: scale(1.05);
      }

      .zap-button.zapped {
        color: var(--nostria-bitcoin) !important;
        background-color: var(--nostria-bitcoin-10);
      }

      .zap-button.zapped mat-icon {
        color: var(--nostria-bitcoin) !important;
      }

      .zap-button.only-icon {
        min-width: 40px;
        padding: 8px;
      }

      .zap-count {
        margin-left: 4px;
        font-size: 14px;
        /* Avoid setting font-weight per project conventions */
      }

      mat-icon {
        font-size: 20px;
        width: 20px;
      }
    `,
  ],
})
export class ZapButtonComponent {
  // Inputs
  event = input<Event | null>(null);
  recipientPubkey = input<string | null>(null);
  recipientName = input<string | null>(null);
  recipientMetadata = input<Record<string, unknown> | null>(null);

  // Outputs
  zapSent = output<number>();

  // Services
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private zapService = inject(ZapService);
  private dataService = inject(DataService);
  private accountState = inject(AccountStateService);
  private layout = inject(LayoutService);

  // State
  isLoading = signal(false);
  totalZaps = signal(0);
  hasZapped = signal(false);

  constructor() {
    // TODO: Load existing zaps for this event/user
    // This would query for zap receipts and calculate totals
  }

  getTooltip(): string {
    const target = this.event() ? 'event' : 'user';
    const name = this.recipientName() || 'user';

    if (this.totalZaps()) {
      return `${this.formatZapAmount(this.totalZaps())} sats zapped to this ${target}. Click to send a zap to ${name}.`;
    }

    return `Send a Lightning zap to ${name}`;
  }

  formatZapAmount(amount: number): string {
    if (amount >= 1000000) {
      return `${(amount / 1000000).toFixed(1)}M`;
    }
    if (amount >= 1000) {
      return `${(amount / 1000).toFixed(1)}K`;
    }
    return amount.toString();
  }

  async onZapClick(event: MouseEvent): Promise<void> {
    event.stopPropagation();

    // Check if user is logged in
    const userPubkey = this.accountState.pubkey();
    const currentAccount = this.accountState.account();
    if (!userPubkey || currentAccount?.source === 'preview') {
      // Show login dialog if no account is active or if using a preview account
      await this.layout.showLoginDialog();
      return;
    }

    // Check if this event has zap splits (NIP-57 Appendix G)
    const currentEvent = this.event();
    if (currentEvent) {
      const zapSplits = this.zapService.parseZapSplits(currentEvent);
      if (zapSplits.length > 0) {
        // Event has zap splits - show dialog with split info
        this.openZapSplitDialog(currentEvent, zapSplits);
        return;
      }
    }

    // No zap splits - proceed with regular single-recipient zap
    // Get the recipient pubkey from either direct input or event
    const pubkey = this.recipientPubkey() || this.event()?.pubkey;
    if (!pubkey) {
      this.snackBar.open('Unable to determine recipient for zap', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    // Get recipient metadata - either from input or fetch from data service
    let metadata = this.recipientMetadata();
    if (!metadata) {
      try {
        // Try to get metadata from the data service
        const userProfile = await this.dataService.getProfile(pubkey);
        if (userProfile?.data) {
          metadata = userProfile.data;
        }
      } catch (error) {
        console.warn('Failed to get user profile for zap:', error);
      }
    }

    // Check if recipient has lightning address
    if (metadata) {
      const lightningAddress = this.zapService.getLightningAddress(metadata);
      if (!lightningAddress) {
        this.snackBar.open('This user has no lightning address configured for zaps', 'Dismiss', {
          duration: 4000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
        });
        return;
      }
    } else {
      // No metadata available at all
      this.snackBar.open('Unable to get recipient information for zap', 'Dismiss', {
        duration: 4000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    // Prepare dialog data
    const dialogData: ZapDialogData = {
      recipientPubkey: pubkey,
      recipientName:
        this.recipientName() ||
        (typeof metadata?.['name'] === 'string' ? metadata['name'] : undefined) ||
        (typeof metadata?.['display_name'] === 'string' ? metadata['display_name'] : undefined) ||
        undefined,
      recipientMetadata: metadata,
      eventId: this.event()?.id,
      eventContent: this.event()?.content ? this.truncateContent(this.event()!.content) : undefined,
    };

    // Open zap dialog
    const dialogRef = this.dialog.open(ZapDialogComponent, {
      width: '500px',
      data: dialogData,
      disableClose: true,
      panelClass: 'responsive-dialog',
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        // Zap was sent successfully
        this.onZapSent(result.amount);
      }
    });
  }

  private openZapSplitDialog(
    event: Event,
    splits: { pubkey: string; relay: string; weight: number }[]
  ): void {
    // Prepare dialog data for zap split
    const dialogData: ZapDialogData = {
      recipientPubkey: event.pubkey, // This will be overridden for splits
      eventId: event.id,
      eventContent: event.content ? this.truncateContent(event.content) : undefined,
      zapSplits: splits, // Pass the split information
      event: event, // Pass the actual event object
    };

    // Open zap dialog
    const dialogRef = this.dialog.open(ZapDialogComponent, {
      width: '500px',
      data: dialogData,
      disableClose: true,
      panelClass: 'responsive-dialog',
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        // Split zap was sent successfully
        this.onZapSent(result.amount);
      }
    });
  }

  private truncateContent(content: string): string {
    const maxLength = 100;
    if (content.length <= maxLength) {
      return content;
    }
    return content.substring(0, maxLength) + '...';
  }

  private onZapSent(amount: number): void {
    // Update local state to reflect the new zap
    this.totalZaps.update(current => current + amount);
    this.hasZapped.set(true);

    // Emit the zap sent event so parent components can refresh their data
    this.zapSent.emit(amount);
  }

  // TODO: Implement methods to load and refresh zap data
  private async loadZapData(): Promise<void> {
    // This would query for zap receipts and calculate totals
    // Implementation depends on having the relay querying working in ZapService
  }
}
