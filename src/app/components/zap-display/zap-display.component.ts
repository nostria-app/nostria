import { Component, inject, input, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatExpansionModule } from '@angular/material/expansion';
import { Event } from 'nostr-tools';
import { ZapService } from '../../services/zap.service';
import { AgoPipe } from '../../pipes/ago.pipe';

interface ZapReceipt {
  receipt: Event;
  zapRequest: Event | null;
  amount: number | null;
  comment: string;
  senderName?: string;
  timestamp: number;
}

@Component({
  selector: 'app-zap-display',
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatExpansionModule,
    AgoPipe,
  ],
  template: `
    @if (zaps().length > 0) {
      <div class="zaps-container">
        <div class="zaps-header">
          <mat-icon class="zap-icon">bolt</mat-icon>
          <span class="zaps-title">
            {{ totalAmount() }} sats from {{ zaps().length }} zap{{
              zaps().length === 1 ? '' : 's'
            }}
          </span>
        </div>

        @if (shouldShowZapList()) {
          <mat-expansion-panel class="zaps-panel">
            <mat-expansion-panel-header>
              <mat-panel-title> View all zaps </mat-panel-title>
            </mat-expansion-panel-header>

            <div class="zaps-list">
              @for (zap of zaps(); track zap.receipt.id) {
                <div class="zap-item">
                  <div class="zap-header">
                    <div class="zap-sender">
                      <mat-icon class="small-icon">person</mat-icon>
                      <span class="sender-name">{{ zap.senderName || 'Anonymous' }}</span>
                    </div>
                    <div class="zap-amount">
                      <mat-icon class="small-icon">bolt</mat-icon>
                      <span class="amount">{{ formatAmount(zap.amount) }} sats</span>
                    </div>
                    <div class="zap-time" [matTooltip]="zap.timestamp * 1000 | date: 'medium'">
                      {{ zap.timestamp | ago }}
                    </div>
                  </div>

                  @if (zap.comment) {
                    <div class="zap-comment">
                      <mat-icon class="comment-icon">format_quote</mat-icon>
                      <span class="comment-text">{{ zap.comment }}</span>
                    </div>
                  }
                </div>
              }
            </div>
          </mat-expansion-panel>
        } @else {
          <!-- Simple list for few zaps -->
          <div class="simple-zaps-list">
            @for (zap of zaps(); track zap.receipt.id) {
              <div class="simple-zap-item">
                <span class="zap-info">
                  {{ formatAmount(zap.amount) }} sats from {{ zap.senderName || 'Anonymous' }}
                </span>
                @if (zap.comment) {
                  <span class="zap-comment-inline">"{{ zap.comment }}"</span>
                }
              </div>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      .zaps-container {
        margin: 8px 0;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        background: linear-gradient(135deg, #fff3e0 0%, #fff8f0 100%);
        padding: 12px;
      }

      .zaps-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }

      .zap-icon {
        color: #ff6b1a;
        font-size: 20px;
      }

      .zaps-title {
        font-weight: 500;
        color: #d84315;
      }

      .zaps-panel {
        box-shadow: none;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
      }

      .zaps-list {
        max-height: 300px;
        overflow-y: auto;
      }

      .zap-item {
        padding: 12px;
        border-bottom: 1px solid #f0f0f0;
      }

      .zap-item:last-child {
        border-bottom: none;
      }

      .zap-header {
        display: flex;
        align-items: center;
        gap: 16px;
        margin-bottom: 8px;
      }

      .zap-sender {
        display: flex;
        align-items: center;
        gap: 4px;
        flex: 1;
      }

      .zap-amount {
        display: flex;
        align-items: center;
        gap: 4px;
        color: #ff6b1a;
        font-weight: 500;
      }

      .zap-time {
        color: #666;
        font-size: 12px;
      }

      .small-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }

      .sender-name {
        font-weight: 500;
      }

      .zap-comment {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin-top: 8px;
        padding-left: 20px;
        border-left: 3px solid #ff6b1a;
        background: rgba(255, 107, 26, 0.05);
        padding: 8px;
        border-radius: 4px;
      }

      .comment-icon {
        color: #666;
        margin-top: 2px;
      }

      .comment-text {
        font-style: italic;
        color: #333;
        line-height: 1.4;
      }

      .simple-zaps-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .simple-zap-item {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
      }

      .zap-info {
        color: #d84315;
        font-weight: 500;
      }

      .zap-comment-inline {
        color: #666;
        font-style: italic;
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ],
})
export class ZapDisplayComponent implements OnInit {
  // Inputs
  eventId = input<string | null>(null);
  recipientPubkey = input<string | null>(null);

  // Services
  private zapService = inject(ZapService);

  // State
  zaps = signal<ZapReceipt[]>([]);
  isLoading = signal(false);

  // Computed
  totalAmount = computed(() => {
    return this.zaps().reduce((total, zap) => total + (zap.amount || 0), 0);
  });

  shouldShowZapList = computed(() => {
    return this.zaps().length > 3;
  });

  async ngOnInit(): Promise<void> {
    await this.loadZaps();
  }

  private async loadZaps(): Promise<void> {
    this.isLoading.set(true);

    try {
      let zapReceipts: Event[] = [];

      if (this.eventId()) {
        zapReceipts = await this.zapService.getZapsForEvent(this.eventId()!);
      } else if (this.recipientPubkey()) {
        zapReceipts = await this.zapService.getZapsForUser(this.recipientPubkey()!);
      }

      // Parse zap receipts
      const parsedZaps: ZapReceipt[] = [];
      for (const receipt of zapReceipts) {
        const parsed = this.zapService.parseZapReceipt(receipt);
        if (parsed.zapRequest && parsed.amount) {
          parsedZaps.push({
            receipt,
            zapRequest: parsed.zapRequest,
            amount: parsed.amount,
            comment: parsed.comment,
            senderName: this.getSenderName(parsed.zapRequest),
            timestamp: receipt.created_at,
          });
        }
      }

      // Sort by timestamp (most recent first)
      parsedZaps.sort((a, b) => b.timestamp - a.timestamp);

      this.zaps.set(parsedZaps);
    } catch (error) {
      console.error('Failed to load zaps:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  private getSenderName(zapRequest: Event): string {
    // TODO: Look up the sender's profile/name from their pubkey
    // For now, return the first few characters of the pubkey
    return zapRequest.pubkey.substring(0, 8) + '...';
  }

  formatAmount(amount: number | null): string {
    if (!amount) return '0';

    if (amount >= 1000000) {
      return `${(amount / 1000000).toFixed(1)}M`;
    }
    if (amount >= 1000) {
      return `${(amount / 1000).toFixed(1)}K`;
    }
    return amount.toString();
  }

  // Public method to refresh zaps (can be called from parent components)
  async refreshZaps(): Promise<void> {
    await this.loadZaps();
  }
}
