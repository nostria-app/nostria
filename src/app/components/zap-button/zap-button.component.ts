import { Component, inject, input, output, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Event } from 'nostr-tools';
import { ZapDialogComponent, ZapDialogData } from '../zap-dialog/zap-dialog.component';
import { ZapService } from '../../services/zap.service';
import { DataService } from '../../services/data.service';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';
import { SettingsService } from '../../services/settings.service';
import { BreakpointObserver } from '@angular/cdk/layout';

@Component({
  selector: 'app-zap-button',
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTooltipModule, MatMenuModule],
  template: `
    <button
      mat-icon-button
      [class]="{
        'zap-button': true,
        zapped: hasZapped(),
      }"
      [disabled]="isLoading()"
      (click)="onZapClick($event)"
      (contextmenu)="onLongPressStart($event)"
      (touchstart)="onLongPressStart($event)"
      (touchend)="onLongPressEnd($event)"
      (touchcancel)="onLongPressEnd($event)"
      (mouseenter)="onMouseEnter()"
      (mouseleave)="onMouseLeave()"
      [matMenuTriggerFor]="isMobile() ? null : quickZapMenu"
      #zapButtonElement
      [matTooltip]="getTooltip()"
      matTooltipPosition="below"
    >
      <mat-icon>bolt</mat-icon>
    </button>

    <!-- Quick zap menu for desktop (hover) and mobile (long press) -->
    <mat-menu #quickZapMenu="matMenu" class="quick-zap-menu">
      @if (quickZapAmounts().length > 0) {
        @for (amount of quickZapAmounts(); track amount) {
          <button mat-menu-item (click)="quickZap(amount)">
            <mat-icon>bolt</mat-icon>
            <span>{{ formatZapAmount(amount) }} sats</span>
          </button>
        }
      } @else {
        <button mat-menu-item disabled>
          <span>No quick zap amounts configured</span>
        </button>
      }
    </mat-menu>
  `,
  styles: [
    `
      .zap-button {
        color: var(--nostria-bitcoin) !important;
        transition: all 0.2s ease;
        position: relative;
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

      /* Quick zap menu styling */
      :host ::ng-deep .quick-zap-menu {
        .mat-mdc-menu-content {
          padding: 4px 0;
        }

        .mat-mdc-menu-item {
          display: flex;
          align-items: center;
          gap: 8px;
          min-height: 40px;

          mat-icon {
            color: var(--nostria-bitcoin);
          }
        }
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
  private settings = inject(SettingsService);
  private breakpointObserver = inject(BreakpointObserver);

  // State
  isLoading = signal(false);
  totalZaps = signal(0);
  hasZapped = signal(false);
  isMobile = signal(false);

  // Quick zap state
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly LONG_PRESS_DURATION = 500; // milliseconds
  private isLongPressing = false;

  // Get quick zap amounts from settings
  quickZapAmounts = computed(() => {
    const settings = this.settings.settings();
    return settings.zapQuickAmounts || [];
  });

  constructor() {
    // TODO: Load existing zaps for this event/user
    // This would query for zap receipts and calculate totals

    // Detect if on mobile device
    this.breakpointObserver.observe('(max-width: 768px)').subscribe(result => {
      this.isMobile.set(result.matches);
    });
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

  onLongPressStart(event: MouseEvent | TouchEvent): void {
    // Prevent context menu on right-click
    if (event instanceof MouseEvent && event.button === 2) {
      event.preventDefault();
      return;
    }

    // Only handle long press on mobile
    if (!this.isMobile()) {
      return;
    }

    this.isLongPressing = true;

    // Start timer for long press
    this.longPressTimer = setTimeout(() => {
      this.handleLongPress(event);
    }, this.LONG_PRESS_DURATION);
  }

  onLongPressEnd(event: TouchEvent): void {
    // Cancel the timer if it hasn't fired yet
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }

    // Reset long press flag
    this.isLongPressing = false;
  }

  onMouseEnter(): void {
    // Desktop hover behavior - show menu if there are quick zap amounts
    // Menu is controlled by matMenuTriggerFor directive
  }

  onMouseLeave(): void {
    // Desktop hover behavior - menu will close automatically
  }

  private async handleLongPress(event: Event): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    const amounts = this.quickZapAmounts();

    // If only one amount enabled, send it immediately
    if (amounts.length === 1) {
      await this.quickZap(amounts[0]);
      return;
    }

    // If multiple amounts, we'll need to show a selection
    // For mobile, we can trigger the menu programmatically or use a custom dialog
    // For now, we'll just show a message - in production this would open amount selection
    if (amounts.length === 0) {
      this.snackBar.open('No quick zap amounts configured. Go to Settings > Wallet to configure.', 'Dismiss', {
        duration: 4000,
      });
    }
    // The menu will be shown via matMenuTriggerFor on the button
  }

  async quickZap(amount: number): Promise<void> {
    // Prevent duplicate quick zaps
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

    this.isLoading.set(true);

    try {
      // Get the recipient pubkey from either direct input or event
      const pubkey = this.recipientPubkey() || this.event()?.pubkey;
      if (!pubkey) {
        this.snackBar.open('Unable to determine recipient for zap', 'Dismiss', {
          duration: 3000,
        });
        return;
      }

      // Get recipient metadata
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

      // Check if recipient has lightning address
      if (metadata) {
        const lightningAddress = this.zapService.getLightningAddress(metadata);
        if (!lightningAddress) {
          this.snackBar.open('This user has no lightning address configured for zaps', 'Dismiss', {
            duration: 4000,
          });
          return;
        }
      } else {
        this.snackBar.open('Unable to get recipient information for zap', 'Dismiss', {
          duration: 4000,
        });
        return;
      }

      // Check for zap splits
      const currentEvent = this.event();
      if (currentEvent) {
        const zapSplits = this.zapService.parseZapSplits(currentEvent);
        if (zapSplits.length > 0) {
          // Send split zap
          await this.zapService.sendSplitZap(currentEvent, amount, '');
          this.snackBar.open(
            `⚡ Successfully sent ${amount} sats split to ${zapSplits.length} recipients!`,
            'Dismiss',
            {
              duration: 4000,
            }
          );
          this.onZapSent(amount);
          return;
        }
      }

      // Send regular zap
      await this.zapService.sendZap(
        pubkey,
        amount,
        '', // No message for quick zaps
        this.event()?.id,
        metadata
      );

      // Show success message
      const recipientName = this.recipientName() || 
        (typeof metadata?.['name'] === 'string' ? metadata['name'] : undefined) ||
        (typeof metadata?.['display_name'] === 'string' ? metadata['display_name'] : undefined);

      this.snackBar.open(
        `⚡ Successfully sent ${amount} sats${recipientName ? ` to ${recipientName}` : ''}!`,
        'Dismiss',
        {
          duration: 4000,
        }
      );

      this.onZapSent(amount);
    } catch (error) {
      console.error('Failed to send quick zap:', error);
      this.snackBar.open(
        `Failed to send zap: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'Dismiss',
        {
          duration: 5000,
        }
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  async onZapClick(event: MouseEvent): Promise<void> {
    event.stopPropagation();

    // Don't handle click if it was a long press on mobile
    if (this.isLongPressing) {
      this.isLongPressing = false;
      return;
    }

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
