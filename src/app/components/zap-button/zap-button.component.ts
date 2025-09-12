import { Component, inject, input, signal } from '@angular/core';
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

@Component({
  selector: 'app-zap-button',
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <button
      mat-button
      [ngClass]="{
        'zap-button': true,
        zapped: hasZapped(),
        'only-icon': !totalZaps(),
      }"
      [disabled]="isLoading()"
      (click)="onZapClick($event)"
      [matTooltip]="getTooltip()"
      matTooltipPosition="below"
    >
      <mat-icon>{{ hasZapped() ? 'bolt' : 'bolt' }}</mat-icon>
      @if (totalZaps()) {
        <span class="zap-count">{{ formatZapAmount(totalZaps()) }}</span>
      }
    </button>
  `,
  styles: [
    `
      .zap-button {
        color: #ff6b1a !important;
        transition: all 0.2s ease;
      }

      .zap-button:hover {
        background-color: rgba(255, 107, 26, 0.1);
        transform: scale(1.05);
      }

      .zap-button.zapped {
        color: #ff6b1a !important;
        background-color: rgba(255, 107, 26, 0.1);
      }

      .zap-button.zapped mat-icon {
        color: #ff6b1a !important;
      }

      .zap-button.only-icon {
        min-width: 40px;
        padding: 8px;
      }

      .zap-count {
        margin-left: 4px;
        font-size: 14px;
        font-weight: 500;
      }

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
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

  // Services
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private zapService = inject(ZapService);
  private dataService = inject(DataService);

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
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        // Zap was sent successfully
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
    this.totalZaps.update((current) => current + amount);
    this.hasZapped.set(true);

    // TODO: Optionally refresh zap data from relays
    // to get the latest zap receipts
  }

  // TODO: Implement methods to load and refresh zap data
  private async loadZapData(): Promise<void> {
    // This would query for zap receipts and calculate totals
    // Implementation depends on having the relay querying working in ZapService
  }
}
