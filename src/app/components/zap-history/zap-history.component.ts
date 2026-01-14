import { Component, inject, signal, computed, effect, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Event } from 'nostr-tools';
import { ZapService } from '../../services/zap.service';
import { DataService } from '../../services/data.service';
import { AccountStateService } from '../../services/account-state.service';
import { AccountRelayService } from '../../services/relays/account-relay';
import { AgoPipe } from '../../pipes/ago.pipe';
import { TimestampPipe } from '../../pipes/timestamp.pipe';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { LayoutService } from '../../services/layout.service';

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
    RouterLink,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatTabsModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatMenuModule,
    AgoPipe,
    TimestampPipe,
    UserProfileComponent,
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
                            <span class="counterparty">
                              <app-user-profile
                                [pubkey]="zap.counterparty"
                                view="icon"
                                [hostWidthAuto]="true"
                                [prefetchedProfile]="prefetchedProfiles()[zap.counterparty]"
                              ></app-user-profile>
                            </span>
                          </div>
                          <div class="zap-info">
                            <div class="zap-amount">
                              <mat-icon class="bolt-icon">bolt</mat-icon>
                              <span class="amount">{{ formatAmount(zap.amount) }} sats</span>
                            </div>
                            <div
                              class="zap-time"
                              [matTooltip]="zap.timestamp | timestamp: 'medium'"
                            >
                              {{ zap.timestamp | ago }}
                            </div>
                            <button
                              mat-icon-button
                              [matMenuTriggerFor]="zapMenu"
                              class="zap-menu-button"
                              matTooltip="More options"
                            >
                              <mat-icon>more_vert</mat-icon>
                            </button>
                            <mat-menu #zapMenu="matMenu">
                              <button mat-menu-item (click)="copyEventData(zap)">
                                <mat-icon>content_copy</mat-icon>
                                <span>Copy Event Data</span>
                              </button>
                              <button mat-menu-item (click)="layout.publishEvent(zap.zapReceipt)">
                                <mat-icon>publish</mat-icon>
                                <span>Publish Event</span>
                              </button>
                            </mat-menu>
                          </div>
                        </div>

                        @if (zap.comment) {
                          <div class="zap-comment">
                            <mat-icon class="comment-icon">format_quote</mat-icon>
                            <span class="comment-text" style="white-space: pre-wrap;">{{ zap.comment }}</span>
                          </div>
                        }

                        @if (zap.eventId) {
                          <div class="zap-context">
                            <mat-icon class="context-icon">note</mat-icon>
                            <a [routerLink]="[{ outlets: { right: ['e', zap.eventId] } }]" class="context-link">
                              For event {{ zap.eventId.substring(0, 8) }}...
                            </a>
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
                            <span class="counterparty">
                              <app-user-profile
                                [pubkey]="zap.counterparty"
                                view="icon"
                                [hostWidthAuto]="true"
                                [prefetchedProfile]="prefetchedProfiles()[zap.counterparty]"
                              ></app-user-profile>
                            </span>
                          </div>
                          <div class="zap-info">
                            <div class="zap-amount">
                              <mat-icon class="bolt-icon">bolt</mat-icon>
                              <span class="amount">{{ formatAmount(zap.amount) }} sats</span>
                            </div>
                            <div
                              class="zap-time"
                              [matTooltip]="zap.timestamp | timestamp: 'medium'"
                            >
                              {{ zap.timestamp | ago }}
                            </div>
                            <button
                              mat-icon-button
                              [matMenuTriggerFor]="sentZapMenu"
                              class="zap-menu-button"
                              matTooltip="More options"
                            >
                              <mat-icon>more_vert</mat-icon>
                            </button>
                            <mat-menu #sentZapMenu="matMenu">
                              <button mat-menu-item (click)="copyEventData(zap)">
                                <mat-icon>content_copy</mat-icon>
                                <span>Copy Event Data</span>
                              </button>
                              <button mat-menu-item (click)="layout.publishEvent(zap.zapReceipt)">
                                <mat-icon>publish</mat-icon>
                                <span>Publish Event</span>
                              </button>
                            </mat-menu>
                          </div>
                        </div>

                        @if (zap.comment) {
                          <div class="zap-comment">
                            <mat-icon class="comment-icon">format_quote</mat-icon>
                            <span class="comment-text" style="white-space: pre-wrap;">{{ zap.comment }}</span>
                          </div>
                        }

                        @if (zap.eventId) {
                          <div class="zap-context">
                            <mat-icon class="context-icon">note</mat-icon>
                            <a [routerLink]="[{ outlets: { right: ['e', zap.eventId] } }]" class="context-link">
                              For event {{ zap.eventId.substring(0, 8) }}...
                            </a>
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
                            <span class="counterparty">
                              <app-user-profile
                                [pubkey]="zap.counterparty"
                                view="icon"
                                [hostWidthAuto]="true"
                                [prefetchedProfile]="prefetchedProfiles()[zap.counterparty]"
                              ></app-user-profile>
                            </span>
                          </div>
                          <div class="zap-info">
                            <div class="zap-amount">
                              <mat-icon class="bolt-icon">bolt</mat-icon>
                              <span class="amount">{{ formatAmount(zap.amount) }} sats</span>
                            </div>
                            <div
                              class="zap-time"
                              [matTooltip]="zap.timestamp | timestamp: 'medium'"
                            >
                              {{ zap.timestamp | ago }}
                            </div>
                            <button
                              mat-icon-button
                              [matMenuTriggerFor]="receivedZapMenu"
                              class="zap-menu-button"
                              matTooltip="More options"
                            >
                              <mat-icon>more_vert</mat-icon>
                            </button>
                            <mat-menu #receivedZapMenu="matMenu">
                              <button mat-menu-item (click)="copyEventData(zap)">
                                <mat-icon>content_copy</mat-icon>
                                <span>Copy Event Data</span>
                              </button>
                              <button mat-menu-item (click)="layout.publishEvent(zap.zapReceipt)">
                                <mat-icon>publish</mat-icon>
                                <span>Publish Event</span>
                              </button>
                            </mat-menu>
                          </div>
                        </div>

                        @if (zap.comment) {
                          <div class="zap-comment">
                            <mat-icon class="comment-icon">format_quote</mat-icon>
                            <span class="comment-text" style="white-space: pre-wrap;">{{ zap.comment }}</span>
                          </div>
                        }

                        @if (zap.eventId) {
                          <div class="zap-context">
                            <mat-icon class="context-icon">note</mat-icon>
                            <a [routerLink]="[{ outlets: { right: ['e', zap.eventId] } }]" class="context-link">
                              For event {{ zap.eventId.substring(0, 8) }}...
                            </a>
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
        padding: 20px;
        border-radius: 16px;
        background: var(--mat-sys-color-surface-container);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      }

      .zap-entry.sent {
        background: rgba(0, 0, 0, 0.05);
      }

      .zap-entry.received {
        background: rgba(255, 255, 255, 0.05);
      }

      .zap-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 8px;
      }

      .zap-type {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      .zap-info {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-left: auto;
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

      .counterparty app-user-profile {
        transform: scale(0.5);
        transform-origin: left center;
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

      .zap-menu-button {
        color: var(--mat-sys-on-surface-variant);
        flex-shrink: 0;
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
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin-top: 8px;
        padding: 8px;
        background: var(--mat-sys-surface-container-high, var(--mat-sys-color-surface-container));
        border-radius: 4px;
      }

      .context-icon {
        color: var(--mat-sys-on-surface-variant);
        font-size: 16px;
        margin-top: 2px;
      }

      .context-text {
        color: var(--mat-sys-on-surface);
        line-height: 1.4;
      }

      .context-link {
        color: var(--mat-sys-primary);
        text-decoration: none;
        line-height: 1.4;
        cursor: pointer;
        transition: color 0.2s;
      }

      .context-link:hover {
        color: var(--mat-sys-primary-fixed-dim);
        text-decoration: underline;
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
          flex-wrap: wrap;
        }

        .zap-type {
          flex: 1 1 100%;
          margin-bottom: 4px;
        }

        .zap-info {
          flex: 1 1 100%;
          justify-content: space-between;
        }

        .zap-time {
          text-align: left;
          min-width: auto;
        }
      }
    `,
  ],
})
export class ZapHistoryComponent implements OnDestroy {
  // Services
  private zapService = inject(ZapService);
  private accountState = inject(AccountStateService);
  private data = inject(DataService);
  private snackBar = inject(MatSnackBar);
  private accountRelay = inject(AccountRelayService);
  layout = inject(LayoutService);

  // State
  isLoading = signal(false);
  allZaps = signal<ZapHistoryEntry[]>([]);
  // Prefetched profiles keyed by pubkey
  prefetchedProfiles = signal<Record<string, unknown>>({});

  // Computed properties
  sentZaps = computed(() => this.allZaps().filter(zap => zap.type === 'sent'));
  receivedZaps = computed(() => this.allZaps().filter(zap => zap.type === 'received'));

  totalSent = computed(() => {
    return this.sentZaps().reduce((total, zap) => total + zap.amount, 0);
  });

  totalReceived = computed(() => {
    return this.receivedZaps().reduce((total, zap) => total + zap.amount, 0);
  });

  netAmount = computed(() => {
    return this.totalReceived() - this.totalSent();
  });

  constructor() {
    // Effect to reload zap history when account changes
    effect(() => {
      const account = this.accountState.account();
      if (account) {
        // Clear existing history and load for new account
        this.allZaps.set([]);
        this.prefetchedProfiles.set({});
        this.loadZapHistory();
      }
    });
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

      // Unable to get any events for test account on this, need investigation.
      // Also get zaps the user sent
      const sentZapReceipts = await this.zapService.getZapsSentByUser(userPubkey);

      const zapHistory: ZapHistoryEntry[] = [];
      // Track processed receipt IDs to avoid duplicates
      const processedReceiptIds = new Set<string>();

      // Process received zaps
      for (const receipt of receivedZapReceipts) {
        // Skip if already processed
        if (processedReceiptIds.has(receipt.id)) {
          continue;
        }

        const parsed = this.zapService.parseZapReceipt(receipt);

        // Debug logging for troubleshooting
        console.debug('Processing received zap receipt:', {
          id: receipt.id,
          parsed: {
            hasZapRequest: !!parsed.zapRequest,
            hasAmount: !!parsed.amount,
            amount: parsed.amount,
            comment: parsed.comment,
          },
          tags: receipt.tags,
        });

        if (parsed.zapRequest && parsed.amount) {
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
        } else {
          console.warn('Skipping received zap - missing zapRequest or amount:', {
            id: receipt.id,
            hasZapRequest: !!parsed.zapRequest,
            hasAmount: !!parsed.amount,
          });
        }
      }

      // Process sent zaps - receipts whose embedded zapRequest.pubkey === current user
      for (const receipt of sentZapReceipts) {
        // Skip if already processed (prevents duplicates when receipt has both p and P tags)
        if (processedReceiptIds.has(receipt.id)) {
          continue;
        }

        const parsed = this.zapService.parseZapReceipt(receipt);
        if (parsed.zapRequest && parsed.amount) {
          // Determine the recipient pubkey from the zapRequest tags (p tag)
          const pTag = parsed.zapRequest.tags.find(t => t[0] === 'p');
          const recipient = pTag && pTag[1] ? pTag[1] : parsed.zapRequest.pubkey;
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

      // Sort by timestamp (most recent first)
      zapHistory.sort((a, b) => b.timestamp - a.timestamp);

      this.allZaps.set(zapHistory);

      // Prefetch unique profiles to avoid duplicate loads in child components
      const uniquePubkeys = Array.from(new Set(zapHistory.map(z => z.counterparty)));
      const profileMap: Record<string, unknown> = {};

      await Promise.all(
        uniquePubkeys.map(async pubkey => {
          try {
            const profile = await this.data.getProfile(pubkey);
            if (profile) {
              profileMap[pubkey] = profile;
            }
          } catch {
            // ignore individual profile errors
          }
        })
      );

      if (Object.keys(profileMap).length) {
        this.prefetchedProfiles.set(profileMap);
      }
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



  /**
   * Copy zap receipt event data to clipboard
   */
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

  async refreshHistory(): Promise<void> {
    await this.loadZapHistory();
  }
}
