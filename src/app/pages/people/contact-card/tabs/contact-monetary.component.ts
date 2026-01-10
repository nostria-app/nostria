import { Component, inject, signal, input, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Event } from 'nostr-tools';
import { ZapService } from '../../../../services/zap.service';
import { DataService } from '../../../../services/data.service';
import { AccountStateService } from '../../../../services/account-state.service';
import { AgoPipe } from '../../../../pipes/ago.pipe';
import { TimestampPipe } from '../../../../pipes/timestamp.pipe';
import { LayoutService } from '../../../../services/layout.service';

interface ZapHistoryEntry {
  type: 'sent' | 'received';
  zapReceipt: Event;
  zapRequest: Event | null;
  amount: number;
  comment: string;
  counterparty: string;
  timestamp: number;
  eventId?: string;
}

@Component({
  selector: 'app-contact-monetary',
  imports: [
    CommonModule,
    RouterLink,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatMenuModule,
    AgoPipe,
    TimestampPipe,
  ],
  templateUrl: './contact-monetary.component.html',
  styleUrl: './contact-monetary.component.scss',
})
export class ContactMonetaryComponent {
  pubkey = input.required<string>();

  private zapService = inject(ZapService);
  private accountState = inject(AccountStateService);
  private data = inject(DataService);
  private snackBar = inject(MatSnackBar);
  layout = inject(LayoutService);

  isLoading = signal(false);
  allZaps = signal<ZapHistoryEntry[]>([]);

  // Computed properties for zaps between current user and contact
  sentZaps = computed(() => this.allZaps().filter(zap => zap.type === 'sent'));
  receivedZaps = computed(() => this.allZaps().filter(zap => zap.type === 'received'));

  totalSent = computed(() => {
    return this.sentZaps().reduce((total, zap) => total + zap.amount, 0);
  });

  totalReceived = computed(() => {
    return this.receivedZaps().reduce((total, zap) => total + zap.amount, 0);
  });

  balance = computed(() => {
    return this.totalReceived() - this.totalSent();
  });

  private lastLoadedPubkey = '';
  private loadingInProgress = false;

  constructor() {
    effect(() => {
      const contactPubkey = this.pubkey();
      if (contactPubkey && contactPubkey !== this.lastLoadedPubkey && !this.loadingInProgress) {
        this.lastLoadedPubkey = contactPubkey;
        this.loadZapHistory(contactPubkey);
      }
    });
  }

  private async loadZapHistory(contactPubkey: string): Promise<void> {
    if (this.loadingInProgress) return;

    const account = this.accountState.account();
    if (!account) {
      return;
    }

    this.loadingInProgress = true;
    this.isLoading.set(true);

    try {
      const userPubkey = account.pubkey;

      // Get all zaps received by the current user
      const allReceivedZapReceipts = await this.zapService.getZapsForUser(userPubkey);
      // Get all zaps sent by the current user
      const allSentZapReceipts = await this.zapService.getZapsSentByUser(userPubkey);

      const zapHistory: ZapHistoryEntry[] = [];
      const processedReceiptIds = new Set<string>();

      // Process received zaps - filter for ones from the contact
      for (const receipt of allReceivedZapReceipts) {
        if (processedReceiptIds.has(receipt.id)) {
          continue;
        }

        const parsed = this.zapService.parseZapReceipt(receipt);

        if (parsed.zapRequest && parsed.amount) {
          // Only include if this zap is from the contact we're viewing
          if (parsed.zapRequest.pubkey === contactPubkey) {
            const eventTag = receipt.tags.find(tag => tag[0] === 'e');
            zapHistory.push({
              type: 'received',
              zapReceipt: receipt,
              zapRequest: parsed.zapRequest,
              amount: parsed.amount,
              comment: parsed.comment,
              counterparty: parsed.zapRequest.pubkey,
              timestamp: receipt.created_at,
              eventId: eventTag?.[1],
            });
            processedReceiptIds.add(receipt.id);
          }
        }
      }

      // Process sent zaps - filter for ones to the contact
      for (const receipt of allSentZapReceipts) {
        if (processedReceiptIds.has(receipt.id)) {
          continue;
        }

        const parsed = this.zapService.parseZapReceipt(receipt);
        if (parsed.zapRequest && parsed.amount) {
          // Determine the recipient pubkey from the zapRequest tags (p tag)
          const pTag = parsed.zapRequest.tags.find(t => t[0] === 'p');
          const recipient = pTag && pTag[1] ? pTag[1] : parsed.zapRequest.pubkey;

          // Only include if this zap is to the contact we're viewing
          if (recipient === contactPubkey) {
            const eventTag = receipt.tags.find(tag => tag[0] === 'e');
            zapHistory.push({
              type: 'sent',
              zapReceipt: receipt,
              zapRequest: parsed.zapRequest,
              amount: parsed.amount,
              comment: parsed.comment,
              counterparty: recipient,
              timestamp: receipt.created_at,
              eventId: eventTag?.[1],
            });
            processedReceiptIds.add(receipt.id);
          }
        }
      }

      // Sort by timestamp (most recent first)
      zapHistory.sort((a, b) => b.timestamp - a.timestamp);

      this.allZaps.set(zapHistory);
    } catch (error) {
      console.error('Failed to load zap history for contact:', error);
    } finally {
      this.isLoading.set(false);
      this.loadingInProgress = false;
    }
  }

  formatAmount(amount: number): string {
    if (amount >= 1000000) {
      return `${(amount / 1000000).toFixed(1)}M`;
    }
    if (amount >= 1000) {
      return `${(amount / 1000).toFixed(1)}K`;
    }
    return amount.toLocaleString();
  }

  async copyEventData(zap: ZapHistoryEntry): Promise<void> {
    try {
      const eventData = JSON.stringify(zap.zapReceipt, null, 2);
      await navigator.clipboard.writeText(eventData);
      this.snackBar.open('Event data copied to clipboard', 'Dismiss', {
        duration: 3000,
      });
    } catch (error) {
      console.error('Failed to copy event data:', error);
      this.snackBar.open('Failed to copy event data', 'Dismiss', {
        duration: 3000,
      });
    }
  }
}
