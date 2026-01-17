import { Component, inject, input, output, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Event as NostrEvent } from 'nostr-tools';
import { ZapService } from '../../services/zap.service';
import { DataService } from '../../services/data.service';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';
import { SettingsService } from '../../services/settings.service';

/**
 * Quick Zap Button - Sends an instant zap with a preconfigured amount.
 * The amount is configured in Settings > Wallet > Quick Zap Amount.
 * Shows a lightning bolt icon with a small indicator to distinguish from regular zap button.
 */
@Component({
  selector: 'app-quick-zap-button',
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (quickZapEnabled() && quickZapAmount() > 0) {
      <button
        mat-icon-button
        class="quick-zap-button"
        [disabled]="isLoading()"
        (click)="sendQuickZap($event)"
        [matTooltip]="tooltip()"
        matTooltipPosition="below"
      >
        <mat-icon class="quick-zap-icon">electric_bolt</mat-icon>
        <span class="quick-zap-badge">{{ formatAmount(quickZapAmount()) }}</span>
      </button>
    }
  `,
  styles: [
    `
      .quick-zap-button {
        color: var(--nostria-bitcoin) !important;
        position: relative;
        transition: all 0.2s ease;
      }

      .quick-zap-button:hover {
        background-color: var(--nostria-bitcoin-10);
        transform: scale(1.05);
      }

      .quick-zap-button:active {
        transform: scale(0.95);
      }

      .quick-zap-button:disabled {
        opacity: 0.5;
      }

      .quick-zap-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      .quick-zap-badge {
        position: absolute;
        bottom: 2px;
        right: 2px;
        font-size: 8px;
        background-color: var(--nostria-bitcoin);
        color: white;
        padding: 1px 3px;
        border-radius: 4px;
        line-height: 1;
      }
    `,
  ],
})
export class QuickZapButtonComponent {
  // Inputs
  event = input<NostrEvent | null>(null);
  recipientPubkey = input<string | null>(null);
  recipientName = input<string | null>(null);
  recipientMetadata = input<Record<string, unknown> | null>(null);

  // Outputs
  zapSent = output<number>();

  // Services
  private snackBar = inject(MatSnackBar);
  private zapService = inject(ZapService);
  private dataService = inject(DataService);
  private accountState = inject(AccountStateService);
  private layout = inject(LayoutService);
  private settings = inject(SettingsService);

  // State
  isLoading = signal(false);

  // Get quick zap settings
  quickZapEnabled = computed(() => {
    const settings = this.settings.settings();
    return settings.quickZapEnabled ?? false;
  });

  quickZapAmount = computed(() => {
    const settings = this.settings.settings();
    return settings.quickZapAmount ?? 21;
  });

  // Computed tooltip
  tooltip = computed(() => {
    const amount = this.quickZapAmount();
    const name = this.recipientName() || 'user';
    return `Quick zap ${this.formatAmount(amount)} sats to ${name}`;
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

  async sendQuickZap(event: MouseEvent): Promise<void> {
    event.stopPropagation();
    event.preventDefault();

    // Prevent duplicate zaps
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
            `⚡ Quick zapped ${amount} sats split to ${zapSplits.length} recipients!`,
            'Dismiss',
            { duration: 4000 }
          );
          this.zapSent.emit(amount);
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
        `⚡ Quick zapped ${amount} sats${recipientName ? ` to ${recipientName}` : ''}!`,
        'Dismiss',
        { duration: 3000 }
      );

      this.zapSent.emit(amount);
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
}
