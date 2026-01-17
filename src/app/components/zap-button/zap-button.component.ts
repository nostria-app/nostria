import { Component, inject, input, output, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Event as NostrEvent } from 'nostr-tools';
import { ZapDialogComponent, ZapDialogData } from '../zap-dialog/zap-dialog.component';
import { ZapService } from '../../services/zap.service';
import { DataService } from '../../services/data.service';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';
import { SettingsService } from '../../services/settings.service';

/**
 * Unified Zap Button - Supports both quick zap and custom zap.
 * 
 * When Quick Zap is ENABLED (in Settings > Wallet):
 * - Click: Sends instant zap with configured amount
 * - Shows amount badge on button
 * - Menu arrow provides access to custom zap dialog
 * 
 * When Quick Zap is DISABLED:
 * - Click: Opens zap dialog for custom amount
 * - No badge shown
 */
@Component({
  selector: 'app-zap-button',
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="zap-button-container">
      @if (quickZapEnabled()) {
        <!-- Quick Zap Mode: Button + settings button for custom zap -->
        <button
          mat-icon-button
          class="zap-button"
          [class.zapped]="hasZapped()"
          [class.loading]="isLoading()"
          [disabled]="isLoading()"
          (click)="sendQuickZap($event)"
          [matTooltip]="quickZapTooltip()"
          matTooltipPosition="below"
        >
          <mat-icon>bolt</mat-icon>
          <span class="quick-zap-badge">{{ formatAmount(quickZapAmount()) }}</span>
        </button>
        <button
          mat-icon-button
          class="zap-settings-trigger"
          (click)="openZapDialog($event)"
          matTooltip="Custom zap amount"
          matTooltipPosition="below"
        >
          <mat-icon class="settings-icon">tune</mat-icon>
        </button>
      } @else {
        <!-- Standard Mode: Just opens dialog -->
        <button
          mat-icon-button
          class="zap-button"
          [class.zapped]="hasZapped()"
          [disabled]="isLoading()"
          (click)="openZapDialog($event)"
          [matTooltip]="tooltip()"
          matTooltipPosition="below"
        >
          <mat-icon>bolt</mat-icon>
        </button>
      }
    </div>
  `,
  styles: [`
    .zap-button-container {
      display: inline-flex;
      align-items: center;
      position: relative;
    }

    .zap-button {
      color: var(--nostria-bitcoin) !important;
      transition: all 0.2s ease;
      position: relative;
    }

    .zap-button:hover {
      background-color: rgba(255, 107, 26, 0.1);
      transform: scale(1.05);
    }

    .zap-button:active {
      transform: scale(0.95);
    }

    .zap-button.zapped {
      color: var(--nostria-bitcoin) !important;
      background-color: rgba(255, 107, 26, 0.15);
    }

    .zap-button.loading {
      opacity: 0.6;
    }

    .zap-button mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    .quick-zap-badge {
      position: absolute;
      bottom: 4px;
      right: 4px;
      font-size: 9px;
      background-color: var(--nostria-bitcoin);
      color: white;
      padding: 1px 4px;
      border-radius: 4px;
      line-height: 1.2;
      font-weight: 500;
    }

    .zap-settings-trigger {
      width: 24px;
      height: 24px;
      min-width: 24px;
      padding: 0;
      margin-left: -8px;
      color: var(--mat-sys-on-surface-variant);
    }

    .zap-settings-trigger .settings-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .zap-settings-trigger:hover {
      color: var(--nostria-bitcoin);
    }
  `],
})
export class ZapButtonComponent {
  // Inputs
  event = input<NostrEvent | null>(null);
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
  private settings = inject(SettingsService);

  // State
  isLoading = signal(false);
  totalZaps = signal(0);
  hasZapped = signal(false);

  // Quick zap settings
  quickZapEnabled = computed(() => {
    const settings = this.settings.settings();
    return settings.quickZapEnabled ?? false;
  });

  quickZapAmount = computed(() => {
    const settings = this.settings.settings();
    return settings.quickZapAmount ?? 21;
  });

  // Computed tooltips
  quickZapTooltip = computed(() => {
    const amount = this.quickZapAmount();
    const name = this.recipientName() || 'user';
    const total = this.totalZaps();

    if (total) {
      return `${this.formatAmount(total)} sats zapped. Click to quick zap ${this.formatAmount(amount)} sats to ${name}`;
    }
    return `Quick zap ${this.formatAmount(amount)} sats to ${name}`;
  });

  tooltip = computed(() => {
    const target = this.event() ? 'event' : 'user';
    const name = this.recipientName() || 'user';
    const total = this.totalZaps();

    if (total) {
      return `${this.formatAmount(total)} sats zapped to this ${target}. Click to send a zap to ${name}.`;
    }

    return `Send a Lightning zap to ${name}`;
  });

  formatAmount(amount: number): string {
    if (amount >= 1000000) {
      return `${(amount / 1000000).toFixed(1)}M`;
    }
    if (amount >= 1000) {
      return `${(amount / 1000).toFixed(0)}K`;
    }
    return amount.toString();
  }

  // Quick zap functionality
  async sendQuickZap(event: MouseEvent): Promise<void> {
    event.stopPropagation();
    event.preventDefault();

    if (this.isLoading()) {
      return;
    }

    // Check if user is logged in
    const userPubkey = this.accountState.pubkey();
    const currentAccount = this.accountState.account();
    if (!userPubkey || currentAccount?.source === 'preview') {
      await this.layout.showLoginDialog();
      return;
    }

    const amount = this.quickZapAmount();
    if (amount <= 0) {
      this.snackBar.open('Quick zap amount not configured. Go to Settings > Wallet.', 'Dismiss', {
        duration: 4000,
      });
      return;
    }

    this.isLoading.set(true);

    try {
      const pubkey = this.recipientPubkey() || this.event()?.pubkey;
      if (!pubkey) {
        this.snackBar.open('Unable to determine recipient for zap', 'Dismiss', { duration: 3000 });
        return;
      }

      let metadata = this.recipientMetadata();
      if (!metadata) {
        try {
          const userProfile = await this.dataService.getProfile(pubkey);
          if (userProfile?.data) {
            metadata = userProfile.data;
          }
        } catch (error) {
          console.warn('Failed to get user profile for zap:', error);
        }
      }

      if (metadata) {
        const lightningAddress = this.zapService.getLightningAddress(metadata);
        if (!lightningAddress) {
          this.snackBar.open('This user has no lightning address configured for zaps', 'Dismiss', {
            duration: 4000,
          });
          return;
        }
      } else {
        this.snackBar.open('Unable to get recipient information for zap', 'Dismiss', { duration: 4000 });
        return;
      }

      // Check for zap splits
      const currentEvent = this.event();
      if (currentEvent) {
        const zapSplits = this.zapService.parseZapSplits(currentEvent);
        if (zapSplits.length > 0) {
          await this.zapService.sendSplitZap(currentEvent, amount, '');
          this.snackBar.open(
            `⚡ Zapped ${amount} sats split to ${zapSplits.length} recipients!`,
            'Dismiss',
            { duration: 4000 }
          );
          this.onZapSent(amount);
          return;
        }
      }

      // Send regular zap
      await this.zapService.sendZap(pubkey, amount, '', this.event()?.id, metadata);

      const recipientName = this.recipientName() ||
        (typeof metadata?.['name'] === 'string' ? metadata['name'] : undefined) ||
        (typeof metadata?.['display_name'] === 'string' ? metadata['display_name'] : undefined);

      this.snackBar.open(
        `⚡ Zapped ${amount} sats${recipientName ? ` to ${recipientName}` : ''}!`,
        'Dismiss',
        { duration: 3000 }
      );

      this.onZapSent(amount);
    } catch (error) {
      console.error('Failed to send quick zap:', error);
      this.snackBar.open(
        `Failed to send zap: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'Dismiss',
        { duration: 5000 }
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  // Custom zap dialog
  async openZapDialog(event: MouseEvent): Promise<void> {
    event.stopPropagation();

    const userPubkey = this.accountState.pubkey();
    const currentAccount = this.accountState.account();
    if (!userPubkey || currentAccount?.source === 'preview') {
      await this.layout.showLoginDialog();
      return;
    }

    const currentEvent = this.event();
    if (currentEvent) {
      const zapSplits = this.zapService.parseZapSplits(currentEvent);
      if (zapSplits.length > 0) {
        this.openZapSplitDialog(currentEvent, zapSplits);
        return;
      }
    }

    const pubkey = this.recipientPubkey() || this.event()?.pubkey;
    if (!pubkey) {
      this.snackBar.open('Unable to determine recipient for zap', 'Dismiss', { duration: 3000 });
      return;
    }

    let metadata = this.recipientMetadata();
    if (!metadata) {
      try {
        const userProfile = await this.dataService.getProfile(pubkey);
        if (userProfile?.data) {
          metadata = userProfile.data;
        }
      } catch (error) {
        console.warn('Failed to get user profile for zap:', error);
      }
    }

    if (metadata) {
      const lightningAddress = this.zapService.getLightningAddress(metadata);
      if (!lightningAddress) {
        this.snackBar.open('This user has no lightning address configured for zaps', 'Dismiss', {
          duration: 4000,
        });
        return;
      }
    } else {
      this.snackBar.open('Unable to get recipient information for zap', 'Dismiss', { duration: 4000 });
      return;
    }

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

    const dialogRef = this.dialog.open(ZapDialogComponent, {
      width: '500px',
      data: dialogData,
      disableClose: true,
      panelClass: 'responsive-dialog',
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.onZapSent(result.amount);
      }
    });
  }

  private openZapSplitDialog(
    event: NostrEvent,
    splits: { pubkey: string; relay: string; weight: number }[]
  ): void {
    const dialogData: ZapDialogData = {
      recipientPubkey: event.pubkey,
      eventId: event.id,
      eventContent: event.content ? this.truncateContent(event.content) : undefined,
      zapSplits: splits,
      event: event,
    };

    const dialogRef = this.dialog.open(ZapDialogComponent, {
      width: '500px',
      data: dialogData,
      disableClose: true,
      panelClass: 'responsive-dialog',
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
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
    this.totalZaps.update(current => current + amount);
    this.hasZapped.set(true);
    this.zapSent.emit(amount);
  }
}
