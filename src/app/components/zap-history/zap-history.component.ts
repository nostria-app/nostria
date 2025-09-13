import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event } from 'nostr-tools';
import { ZapService } from '../../services/zap.service';
import { AccountStateService } from '../../services/account-state.service';
import { AgoPipe } from '../../pipes/ago.pipe';

interface ZapHistoryEntry {
  type: 'sent' | 'received';
  zapReceipt: Event;
  zapRequest: Event | null;
  amount: number;
  comment: string;
  counterparty: string; // The other person involved (sender if received, recipient if sent)
  timestamp: number;
  eventId?: string; // If the zap was for a specific event
}

@Component({
  selector: 'app-zap-history',
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatTabsModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    AgoPipe,
  ],
  template: `
    <div class="zap-history-container">
      <mat-card class="history-card">
        <mat-card-header>
          <mat-card-title>
            <mat-icon class="title-icon">bolt</mat-icon>
            Zap History
          </mat-card-title>
          <mat-card-subtitle> View your sent and received lightning zaps </mat-card-subtitle>
        </mat-card-header>

        <mat-card-content>
          @if (isLoading()) {
            <div class="loading-container">
              <mat-spinner diameter="40"></mat-spinner>
              <p>Loading zap history...</p>
            </div>
          } @else {
            <mat-tab-group (selectedTabChange)="onTabChange($event)">
              <mat-tab label="All Zaps">
                <div class="tab-content">
                  <div class="stats-row">
                    <div class="stat">
                      <span class="stat-label">Total Sent:</span>
                      <span class="stat-value sent">{{ totalSent() }} sats</span>
                    </div>
                    <div class="stat">
                      <span class="stat-label">Total Received:</span>
                      <span class="stat-value received">{{ totalReceived() }} sats</span>
                    </div>
                    <div class="stat">
                      <span class="stat-label">Net:</span>
                      <span
                        class="stat-value"
                        [class.sent]="netAmount() < 0"
                        [class.received]="netAmount() > 0"
                      >
                        {{ netAmount() }} sats
                      </span>
                    </div>
                  </div>
                  <div class="zaps-list">
                    @for (zap of allZaps(); track zap.zapReceipt.id) {
                      <div
                        class="zap-entry"
                        [class.sent]="zap.type === 'sent'"
                        [class.received]="zap.type === 'received'"
                      >
                        <div class="zap-header">
                          <div class="zap-type">
                            <mat-icon class="type-icon">{{
                              zap.type === 'sent' ? 'trending_up' : 'trending_down'
                            }}</mat-icon>
                            <span class="type-label">{{
                              zap.type === 'sent' ? 'Sent to' : 'Received from'
                            }}</span>
                            <span class="counterparty">{{ formatPubkey(zap.counterparty) }}</span>
                          </div>
                          <div class="zap-amount">
                            <mat-icon class="bolt-icon">bolt</mat-icon>
                            <span class="amount">{{ formatAmount(zap.amount) }} sats</span>
                          </div>
                          <div
                            class="zap-time"
                            [matTooltip]="zap.timestamp * 1000 | date: 'medium'"
                          >
                            {{ zap.timestamp | ago }}
                          </div>
                        </div>

                        @if (zap.comment) {
                          <div class="zap-comment">
                            <mat-icon class="comment-icon">format_quote</mat-icon>
                            <span class="comment-text">{{ zap.comment }}</span>
                          </div>
                        }

                        @if (zap.eventId) {
                          <div class="zap-context">
                            <mat-chip-set>
                              <mat-chip>
                                <mat-icon matChipAvatar>note</mat-icon>
                                For event {{ zap.eventId.substring(0, 8) }}...
                              </mat-chip>
                            </mat-chip-set>
                          </div>
                        }
                      </div>
                    }

                    @if (allZaps().length === 0) {
                      <div class="empty-state">
                        <mat-icon class="empty-icon">bolt</mat-icon>
                        <h3>No zaps yet</h3>
                        <p>
                          Your zap history will appear here once you send or receive lightning
                          payments.
                        </p>
                      </div>
                    }
                  </div>
                </div>
              </mat-tab>

              <mat-tab label="Sent ({{ sentZaps().length }})">
                <div class="tab-content">
                  <div class="zaps-list">
                    @for (zap of sentZaps(); track zap.zapReceipt.id) {
                      <div class="zap-entry sent">
                        <div class="zap-header">
                          <div class="zap-type">
                            <mat-icon class="type-icon">trending_up</mat-icon>
                            <span class="type-label">Sent to</span>
                            <span class="counterparty">{{ formatPubkey(zap.counterparty) }}</span>
                          </div>
                          <div class="zap-amount">
                            <mat-icon class="bolt-icon">bolt</mat-icon>
                            <span class="amount">{{ formatAmount(zap.amount) }} sats</span>
                          </div>
                          <div
                            class="zap-time"
                            [matTooltip]="zap.timestamp * 1000 | date: 'medium'"
                          >
                            {{ zap.timestamp | ago }}
                          </div>
                        </div>

                        @if (zap.comment) {
                          <div class="zap-comment">
                            <mat-icon class="comment-icon">format_quote</mat-icon>
                            <span class="comment-text">{{ zap.comment }}</span>
                          </div>
                        }

                        @if (zap.eventId) {
                          <div class="zap-context">
                            <mat-chip-set>
                              <mat-chip>
                                <mat-icon matChipAvatar>note</mat-icon>
                                For event {{ zap.eventId.substring(0, 8) }}...
                              </mat-chip>
                            </mat-chip-set>
                          </div>
                        }
                      </div>
                    }

                    @if (sentZaps().length === 0) {
                      <div class="empty-state">
                        <mat-icon class="empty-icon">trending_up</mat-icon>
                        <h3>No zaps sent</h3>
                        <p>Zaps you send to others will appear here.</p>
                      </div>
                    }
                  </div>
                </div>
              </mat-tab>

              <mat-tab label="Received ({{ receivedZaps().length }})">
                <div class="tab-content">
                  <div class="zaps-list">
                    @for (zap of receivedZaps(); track zap.zapReceipt.id) {
                      <div class="zap-entry received">
                        <div class="zap-header">
                          <div class="zap-type">
                            <mat-icon class="type-icon">trending_down</mat-icon>
                            <span class="type-label">Received from</span>
                            <span class="counterparty">{{ formatPubkey(zap.counterparty) }}</span>
                          </div>
                          <div class="zap-amount">
                            <mat-icon class="bolt-icon">bolt</mat-icon>
                            <span class="amount">{{ formatAmount(zap.amount) }} sats</span>
                          </div>
                          <div
                            class="zap-time"
                            [matTooltip]="zap.timestamp * 1000 | date: 'medium'"
                          >
                            {{ zap.timestamp | ago }}
                          </div>
                        </div>

                        @if (zap.comment) {
                          <div class="zap-comment">
                            <mat-icon class="comment-icon">format_quote</mat-icon>
                            <span class="comment-text">{{ zap.comment }}</span>
                          </div>
                        }

                        @if (zap.eventId) {
                          <div class="zap-context">
                            <mat-chip-set>
                              <mat-chip>
                                <mat-icon matChipAvatar>note</mat-icon>
                                For event {{ zap.eventId.substring(0, 8) }}...
                              </mat-chip>
                            </mat-chip-set>
                          </div>
                        }
                      </div>
                    }

                    @if (receivedZaps().length === 0) {
                      <div class="empty-state">
                        <mat-icon class="empty-icon">trending_down</mat-icon>
                        <h3>No zaps received</h3>
                        <p>Zaps you receive from others will appear here.</p>
                      </div>
                    }
                  </div>
                </div>
              </mat-tab>
            </mat-tab-group>
          }
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [
    `
      .zap-history-container {
        padding: 16px;
        max-width: 800px;
        margin: 0 auto;
      }

      .history-card {
        min-height: 400px;
        /* Use Material surface container so card adapts to light/dark themes */
        background: var(--mat-sys-color-surface-container);
        color: var(--mat-sys-on-surface);
      }

      .title-icon {
        margin-right: 8px;
        color: var(--mat-sys-primary);
      }

      .loading-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 48px;
        gap: 16px;
      }

      .tab-content {
        padding: 16px 0;
      }

      .stats-row {
        display: flex;
        gap: 24px;
        margin-bottom: 24px;
        padding: 16px;
        background: var(--mat-sys-surface-container-lowest, var(--mat-sys-color-surface-container));
        border-radius: 8px;
      }

      .stat {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .stat-label {
        font-size: 12px;
        color: var(--mat-sys-on-surface-variant);
        text-transform: uppercase;
      }

      .stat-value {
        font-size: 18px;
        /* Avoid setting font-weight per project guidance */
        color: var(--mat-sys-on-surface);
      }

      .stat-value.sent {
        color: var(--mat-sys-error);
      }

      .stat-value.received {
        color: var(--mat-success-color);
      }

      .zaps-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .zap-entry {
        padding: 16px;
        border: 1px solid var(--mat-sys-outline-variant, #e0e0e0);
        border-radius: 8px;
        background: var(--mat-sys-color-surface-container);
        transition: box-shadow 0.2s;
      }

      .zap-entry:hover {
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      }

      .zap-entry.sent {
        border-left: 4px solid var(--mat-sys-error);
      }

      .zap-entry.received {
        border-left: 4px solid var(--mat-success-color);
      }

      .zap-header {
        display: flex;
        align-items: center;
        gap: 16px;
        margin-bottom: 8px;
      }

      .zap-type {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
      }

      .type-icon {
        font-size: 18px;
        color: var(--mat-sys-on-surface-variant);
      }

      .zap-entry.sent .type-icon {
        color: var(--mat-sys-error);
      }

      .zap-entry.received .type-icon {
        color: var(--mat-success-color);
      }

      .type-label {
        font-size: 14px;
        color: #666;
      }

      .counterparty {
        /* Avoid setting font-weight; use color token */
        color: var(--mat-sys-on-surface);
      }

      .zap-amount {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .bolt-icon {
        color: var(--nostria-bitcoin);
        font-size: 18px;
      }

      .amount {
        /* Avoid setting font-weight */
        color: var(--nostria-bitcoin);
      }

      .zap-time {
        font-size: 12px;
        color: var(--mat-sys-on-surface-variant);
        min-width: 80px;
        text-align: right;
      }

      .zap-comment {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin-top: 8px;
        padding: 8px;
        /* Use a slightly elevated surface container for comment boxes so they adapt to theme */
        background: var(--mat-sys-surface-container-high, var(--mat-sys-color-surface-container));
        border-radius: 4px;
      }

      .comment-icon {
        color: var(--mat-sys-on-surface-variant);
        font-size: 16px;
        margin-top: 2px;
      }

      .comment-text {
        color: var(--mat-sys-on-surface);
        line-height: 1.4;
      }

      .zap-context {
        margin-top: 8px;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 48px;
        text-align: center;
      }

      .empty-icon {
        font-size: 48px;
        color: var(--mat-sys-on-surface-variant);
        margin-bottom: 16px;
      }

      .empty-state h3 {
        margin: 0 0 8px 0;
        color: var(--mat-sys-on-surface-variant);
      }

      .empty-state p {
        margin: 0;
        color: var(--mat-sys-on-surface-variant);
        max-width: 300px;
      }

      @media (max-width: 600px) {
        .zap-history-container {
          padding: 8px;
        }

        .stats-row {
          flex-direction: column;
          gap: 12px;
        }

        .zap-header {
          flex-direction: column;
          align-items: flex-start;
          gap: 8px;
        }

        .zap-time {
          text-align: left;
          min-width: auto;
        }
      }
    `,
  ],
})
export class ZapHistoryComponent implements OnInit, OnDestroy {
  // Services
  private zapService = inject(ZapService);
  private accountState = inject(AccountStateService);

  // State
  isLoading = signal(false);
  allZaps = signal<ZapHistoryEntry[]>([]);

  // Computed properties
  sentZaps = computed(() => this.allZaps().filter((zap) => zap.type === 'sent'));
  receivedZaps = computed(() => this.allZaps().filter((zap) => zap.type === 'received'));

  totalSent = computed(() => {
    return this.sentZaps().reduce((total, zap) => total + zap.amount, 0);
  });

  totalReceived = computed(() => {
    return this.receivedZaps().reduce((total, zap) => total + zap.amount, 0);
  });

  netAmount = computed(() => {
    return this.totalReceived() - this.totalSent();
  });

  async ngOnInit(): Promise<void> {
    await this.loadZapHistory();
  }

  ngOnDestroy(): void {
    this.zapService.cleanupSubscriptions();
  }

  private async loadZapHistory(): Promise<void> {
    const account = this.accountState.account();
    if (!account) {
      return;
    }

    this.isLoading.set(true);

    try {
      const userPubkey = account.pubkey;

      // Get zaps received by the user
      const receivedZapReceipts = await this.zapService.getZapsForUser(userPubkey);

      // TODO: Get zaps sent by the user (requires more complex querying)
      // For now, we'll just show received zaps

      const zapHistory: ZapHistoryEntry[] = [];

      // Process received zaps
      for (const receipt of receivedZapReceipts) {
        const parsed = this.zapService.parseZapReceipt(receipt);
        if (parsed.zapRequest && parsed.amount) {
          const eventTag = receipt.tags.find((tag) => tag[0] === 'e');
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
        }
      }

      // TODO: Process sent zaps
      // This requires querying for zap receipts where the zap request pubkey matches the current user
      // For now, we'll just show received zaps

      // Sort by timestamp (most recent first)
      zapHistory.sort((a, b) => b.timestamp - a.timestamp);

      this.allZaps.set(zapHistory);
    } catch (error) {
      console.error('Failed to load zap history:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  onTabChange(event: { index: number }): void {
    // Handle tab change if needed
    console.log('Tab changed to index:', event.index);
  }

  formatPubkey(pubkey: string): string {
    return pubkey.substring(0, 8) + '...';
  }

  formatAmount(amount: number): string {
    if (amount >= 1000000) {
      return `${(amount / 1000000).toFixed(1)}M`;
    }
    if (amount >= 1000) {
      return `${(amount / 1000).toFixed(1)}K`;
    }
    return amount.toString();
  }

  async refreshHistory(): Promise<void> {
    await this.loadZapHistory();
  }
}
