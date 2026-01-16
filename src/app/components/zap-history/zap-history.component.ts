import { Component, inject, signal, computed, effect, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Event, nip19 } from 'nostr-tools';
import { ZapService } from '../../services/zap.service';
import { DataService } from '../../services/data.service';
import { AccountStateService } from '../../services/account-state.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { AccountRelayService } from '../../services/relays/account-relay';
import { DatabaseService } from '../../services/database.service';
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
  counterparty: string;
  timestamp: number;
  eventId?: string;
}

@Component({
  selector: 'app-zap-history',
  imports: [
    CommonModule,
    ScrollingModule,
    MatIconModule,
    MatButtonModule,
    MatTabsModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatMenuModule,
    AgoPipe,
    TimestampPipe,
    UserProfileComponent,
  ],
  template: `
    <div class="zap-history-page">
      @if (isLoading()) {
        <div class="loading-container">
          <mat-spinner diameter="40"></mat-spinner>
          <p>Loading zap history...</p>
        </div>
      } @else {
        <mat-tab-group (selectedTabChange)="onTabChange($event)" class="zap-tabs">
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
              @if (allZaps().length === 0) {
                <div class="empty-state">
                  <mat-icon class="empty-icon">bolt</mat-icon>
                  <h3>No zaps yet</h3>
                  <p>Your zap history will appear here once you send or receive lightning payments.</p>
                </div>
              } @else {
                <cdk-virtual-scroll-viewport [itemSize]="56" [minBufferPx]="800" [maxBufferPx]="1400" class="zaps-viewport">
                  <div
                    *cdkVirtualFor="let zap of allZaps(); trackBy: trackByZapId"
                    class="zap-entry"
                    [class.sent]="zap.type === 'sent'"
                    [class.received]="zap.type === 'received'"
                  >
                    <div class="zap-entry-inner" (click)="openZapEvent(zap)" (keydown.enter)="openZapEvent(zap)" tabindex="0" role="button">
                      <div class="zap-row">
                        <mat-icon class="type-icon">{{ zap.type === 'sent' ? 'trending_up' : 'trending_down' }}</mat-icon>
                        <span class="type-label">{{ zap.type === 'sent' ? 'Sent to' : 'From' }}</span>
                        <span class="counterparty">
                          <app-user-profile
                            [pubkey]="zap.counterparty"
                            view="icon"
                            [hostWidthAuto]="true"
                            [prefetchedProfile]="prefetchedProfiles()[zap.counterparty]"
                          ></app-user-profile>
                        </span>
                        @if (zap.eventId) {
                          <mat-icon class="context-indicator" matTooltip="View zapped event">note</mat-icon>
                        }
                        @if (zap.comment) {
                          <span class="comment-text" [matTooltip]="zap.comment">{{ zap.comment }}</span>
                        }
                        <span class="spacer"></span>
                        <div class="zap-amount">
                          <mat-icon class="bolt-icon">bolt</mat-icon>
                          <span class="amount">{{ formatAmount(zap.amount) }}</span>
                        </div>
                        <div class="zap-time" [matTooltip]="zap.timestamp | timestamp: 'medium'">
                          {{ zap.timestamp | ago }}
                        </div>
                        <button mat-icon-button [matMenuTriggerFor]="zapMenu" class="zap-menu-button" matTooltip="More options" (click)="$event.stopPropagation()">
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
                  </div>
                </cdk-virtual-scroll-viewport>
              }
            </div>
          </mat-tab>

          <mat-tab label="Sent ({{ sentZaps().length }})">
            <div class="tab-content">
              @if (sentZaps().length === 0) {
                <div class="empty-state">
                  <mat-icon class="empty-icon">trending_up</mat-icon>
                  <h3>No zaps sent</h3>
                  <p>Zaps you send to others will appear here.</p>
                </div>
              } @else {
                <cdk-virtual-scroll-viewport [itemSize]="56" [minBufferPx]="800" [maxBufferPx]="1400" class="zaps-viewport">
                  <div
                    *cdkVirtualFor="let zap of sentZaps(); trackBy: trackByZapId"
                    class="zap-entry sent"
                  >
                    <div class="zap-entry-inner" (click)="openZapEvent(zap)" (keydown.enter)="openZapEvent(zap)" tabindex="0" role="button">
                      <div class="zap-row">
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
                        @if (zap.eventId) {
                          <mat-icon class="context-indicator" matTooltip="View zapped event">note</mat-icon>
                        }
                        @if (zap.comment) {
                          <span class="comment-text" [matTooltip]="zap.comment">{{ zap.comment }}</span>
                        }
                        <span class="spacer"></span>
                        <div class="zap-amount">
                          <mat-icon class="bolt-icon">bolt</mat-icon>
                          <span class="amount">{{ formatAmount(zap.amount) }}</span>
                        </div>
                        <div class="zap-time" [matTooltip]="zap.timestamp | timestamp: 'medium'">
                          {{ zap.timestamp | ago }}
                        </div>
                        <button mat-icon-button [matMenuTriggerFor]="sentZapMenu" class="zap-menu-button" matTooltip="More options" (click)="$event.stopPropagation()">
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
                  </div>
                </cdk-virtual-scroll-viewport>
              }
            </div>
          </mat-tab>

          <mat-tab label="Received ({{ receivedZaps().length }})">
            <div class="tab-content">
              @if (receivedZaps().length === 0) {
                <div class="empty-state">
                  <mat-icon class="empty-icon">trending_down</mat-icon>
                  <h3>No zaps received</h3>
                  <p>Zaps you receive from others will appear here.</p>
                </div>
              } @else {
                <cdk-virtual-scroll-viewport [itemSize]="56" [minBufferPx]="800" [maxBufferPx]="1400" class="zaps-viewport">
                  <div
                    *cdkVirtualFor="let zap of receivedZaps(); trackBy: trackByZapId"
                    class="zap-entry received"
                  >
                    <div class="zap-entry-inner" (click)="openZapEvent(zap)" (keydown.enter)="openZapEvent(zap)" tabindex="0" role="button">
                      <div class="zap-row">
                        <mat-icon class="type-icon">trending_down</mat-icon>
                        <span class="type-label">From</span>
                        <span class="counterparty">
                          <app-user-profile
                            [pubkey]="zap.counterparty"
                            view="icon"
                            [hostWidthAuto]="true"
                            [prefetchedProfile]="prefetchedProfiles()[zap.counterparty]"
                          ></app-user-profile>
                        </span>
                        @if (zap.eventId) {
                          <mat-icon class="context-indicator" matTooltip="View zapped event">note</mat-icon>
                        }
                        @if (zap.comment) {
                          <span class="comment-text" [matTooltip]="zap.comment">{{ zap.comment }}</span>
                        }
                        <span class="spacer"></span>
                        <div class="zap-amount">
                          <mat-icon class="bolt-icon">bolt</mat-icon>
                          <span class="amount">{{ formatAmount(zap.amount) }}</span>
                        </div>
                        <div class="zap-time" [matTooltip]="zap.timestamp | timestamp: 'medium'">
                          {{ zap.timestamp | ago }}
                        </div>
                        <button mat-icon-button [matMenuTriggerFor]="receivedZapMenu" class="zap-menu-button" matTooltip="More options" (click)="$event.stopPropagation()">
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
                  </div>
                </cdk-virtual-scroll-viewport>
              }
            </div>
          </mat-tab>
        </mat-tab-group>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        overflow: hidden;
      }

      .zap-history-page {
        height: 100%;
        display: flex;
        flex-direction: column;
        padding: 0 16px 16px 16px;
        overflow: hidden;
      }

      .loading-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 48px;
        gap: 16px;
        flex: 1;
      }

      .zap-tabs {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      ::ng-deep .zap-tabs .mat-mdc-tab-body-wrapper {
        flex: 1;
        min-height: 0;
      }

      ::ng-deep .zap-tabs .mat-mdc-tab-body {
        height: 100%;
      }

      ::ng-deep .zap-tabs .mat-mdc-tab-body-content {
        height: 100%;
        overflow: hidden;
      }

      .tab-content {
        height: 100%;
        display: flex;
        flex-direction: column;
        padding-top: 16px;
        overflow: hidden;
      }

      .stats-row {
        display: flex;
        gap: 24px;
        margin-bottom: 16px;
        padding: 12px 16px;
        background: var(--mat-sys-surface-container-low);
        border-radius: 8px;
        flex-shrink: 0;
      }

      .stat {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .stat-label {
        font-size: 11px;
        color: var(--mat-sys-on-surface-variant);
        text-transform: uppercase;
      }

      .stat-value {
        font-size: 16px;
        color: var(--mat-sys-on-surface);
      }

      .stat-value.sent {
        color: var(--mat-sys-error);
      }

      .stat-value.received {
        color: var(--mat-success-color);
      }

      .zaps-viewport {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        width: 100%;
      }

      .zap-entry {
        height: 56px;
        box-sizing: border-box;
        padding: 4px 0;
        width: 100%;
        overflow: hidden;
      }

      .zap-entry-inner {
        background: var(--mat-sys-surface-container);
        border-radius: 8px;
        padding: 0 12px;
        height: 48px;
        display: flex;
        align-items: center;
        cursor: pointer;
        transition: background-color 0.15s ease;
        overflow: hidden;
        width: 100%;
        box-sizing: border-box;
      }

      .zap-entry-inner:hover {
        background: var(--mat-sys-surface-container-high);
      }

      .zap-entry.sent .zap-entry-inner {
        border-left: 3px solid var(--mat-sys-error);
      }

      .zap-entry.received .zap-entry-inner {
        border-left: 3px solid var(--mat-success-color);
      }

      .zap-row {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        min-width: 0;
        overflow: hidden;
      }

      .type-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
        flex-shrink: 0;
      }

      .zap-entry.sent .type-icon {
        color: var(--mat-sys-error);
      }

      .zap-entry.received .type-icon {
        color: var(--mat-success-color);
      }

      .type-label {
        font-size: 13px;
        color: var(--mat-sys-on-surface-variant);
        flex-shrink: 0;
        white-space: nowrap;
      }

      .counterparty {
        color: var(--mat-sys-on-surface);
        min-width: 0;
        max-width: 120px;
        flex-shrink: 1;
        overflow: hidden;
      }

      .counterparty app-user-profile {
        transform: scale(0.5);
        transform-origin: left center;
      }

      .context-indicator {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--mat-sys-on-surface-variant);
        flex-shrink: 0;
        cursor: pointer;
      }

      .context-indicator:hover {
        color: var(--mat-sys-primary);
      }

      .context-link {
        display: flex;
        align-items: center;
        color: var(--mat-sys-on-surface-variant);
        text-decoration: none;
        flex-shrink: 0;
      }

      .context-link:hover .context-indicator {
        color: var(--mat-sys-primary);
      }

      .comment-text {
        font-size: 12px;
        color: var(--mat-sys-on-surface-variant);
        flex: 0 1 auto;
        min-width: 0;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-style: italic;
      }

      .spacer {
        flex: 1 1 0;
        min-width: 8px;
      }

      .zap-amount {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }

      .bolt-icon {
        color: var(--nostria-bitcoin);
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      .amount {
        color: var(--nostria-bitcoin);
        font-size: 14px;
        white-space: nowrap;
      }

      .zap-time {
        font-size: 12px;
        color: var(--mat-sys-on-surface-variant);
        min-width: 60px;
        text-align: right;
        flex-shrink: 0;
        white-space: nowrap;
      }

      .zap-menu-button {
        color: var(--mat-sys-on-surface-variant);
        flex-shrink: 0;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 48px;
        text-align: center;
        flex: 1;
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
        .zap-history-page {
          padding: 0 8px 8px 8px;
        }

        .stats-row {
          flex-direction: column;
          gap: 8px;
          padding: 12px;
        }

        .type-label {
          display: none;
        }

        .zap-time {
          min-width: 50px;
        }
      }
    `,
  ],
})
export class ZapHistoryComponent implements OnDestroy {
  // Services
  private zapService = inject(ZapService);
  private accountState = inject(AccountStateService);
  private accountLocalState = inject(AccountLocalStateService);
  private data = inject(DataService);
  private snackBar = inject(MatSnackBar);
  private accountRelay = inject(AccountRelayService);
  private database = inject(DatabaseService);
  private router = inject(Router);
  layout = inject(LayoutService);

  // State
  isLoading = signal(false);
  allZaps = signal<ZapHistoryEntry[]>([]);
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

  trackByZapId = (_index: number, zap: ZapHistoryEntry) => zap.zapReceipt.id;

  constructor() {
    // Effect to reload zap history when account changes
    effect(() => {
      const account = this.accountState.account();
      if (account) {
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

      // Initialize database
      await this.database.init();

      // Step 1: Load cached zap receipts from IndexedDB for instant display
      const cachedReceipts = await this.database.getEventsByKind(9735);
      const cachedReceived = cachedReceipts.filter(e => e.tags.some(t => t[0] === 'p' && t[1] === userPubkey));
      const cachedSent = cachedReceipts.filter(e => e.tags.some(t => t[0] === 'P' && t[1] === userPubkey));

      // Process cached zaps for immediate display
      const cachedHistory = this.processZapReceipts(cachedReceived, cachedSent);
      if (cachedHistory.length > 0) {
        cachedHistory.sort((a, b) => b.timestamp - a.timestamp);
        this.allZaps.set(cachedHistory);
        // Hide loading spinner once we have cached data
        this.isLoading.set(false);
        // Start prefetching profiles for cached data
        this.prefetchProfiles(cachedHistory);
      }

      // Step 2: Fetch new zaps from relays in background
      this.fetchFromRelays(userPubkey);
    } catch (error) {
      console.error('Failed to load zap history:', error);
      this.isLoading.set(false);
    }
  }

  /**
   * Fetch zaps from relays and merge with existing data
   */
  private async fetchFromRelays(userPubkey: string): Promise<void> {
    try {
      const receivedZapReceipts = await this.zapService.getZapsForUser(userPubkey);
      const sentZapReceipts = await this.zapService.getZapsSentByUser(userPubkey);

      // Save new zap receipts to IndexedDB for future caching
      const newReceipts = [...receivedZapReceipts, ...sentZapReceipts];
      if (newReceipts.length > 0) {
        await this.database.saveEvents(newReceipts);
      }

      // Process all zaps from relays
      const zapHistory = this.processZapReceipts(receivedZapReceipts, sentZapReceipts);

      // Sort by timestamp (most recent first)
      zapHistory.sort((a, b) => b.timestamp - a.timestamp);

      // Only update if we have new data or different data
      const currentZaps = this.allZaps();
      if (zapHistory.length !== currentZaps.length ||
        (zapHistory.length > 0 && currentZaps.length > 0 && zapHistory[0].zapReceipt.id !== currentZaps[0].zapReceipt.id)) {
        this.allZaps.set(zapHistory);
        // Prefetch profiles for any new zaps
        await this.prefetchProfiles(zapHistory);
      }

      // Update the last timestamp for tracking
      const newestTimestamp = zapHistory.length > 0 ? zapHistory[0].timestamp : 0;
      if (newestTimestamp > 0) {
        this.accountLocalState.setZapHistoryLastTimestamp(userPubkey, newestTimestamp);
      }
    } catch (error) {
      console.error('Failed to fetch zaps from relays:', error);
    } finally {
      // Ensure loading is hidden even if no cached data existed
      this.isLoading.set(false);
    }
  }

  /**
   * Process zap receipts into ZapHistoryEntry objects
   */
  private processZapReceipts(
    receivedReceipts: Event[],
    sentReceipts: Event[]
  ): ZapHistoryEntry[] {
    const zapHistory: ZapHistoryEntry[] = [];
    const processedReceiptIds = new Set<string>();

    // Process received zaps
    for (const receipt of receivedReceipts) {
      if (processedReceiptIds.has(receipt.id)) {
        continue;
      }

      const parsed = this.zapService.parseZapReceipt(receipt);

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
      }
    }

    // Process sent zaps
    for (const receipt of sentReceipts) {
      if (processedReceiptIds.has(receipt.id)) {
        continue;
      }

      const parsed = this.zapService.parseZapReceipt(receipt);
      if (parsed.zapRequest && parsed.amount) {
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

    return zapHistory;
  }

  /**
   * Prefetch profiles for zap counterparties
   */
  private async prefetchProfiles(zapHistory: ZapHistoryEntry[]): Promise<void> {
    const uniquePubkeys = Array.from(new Set(zapHistory.map(z => z.counterparty)));
    const profileMap: Record<string, unknown> = { ...this.prefetchedProfiles() };

    await Promise.all(
      uniquePubkeys.map(async pubkey => {
        if (profileMap[pubkey]) return; // Skip if already fetched
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
  }

  onTabChange(event: { index: number }): void {
    console.log('Tab changed to index:', event.index);
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
   * Open zapped event in right panel, or navigate to counterparty profile if no event
   */
  openZapEvent(zap: ZapHistoryEntry): void {
    if (zap.eventId) {
      // Open event in right panel
      const neventId = nip19.neventEncode({
        id: zap.eventId,
        author: zap.counterparty,
      });
      this.layout.openGenericEvent(neventId);
    } else {
      // No event - navigate to counterparty's profile
      this.layout.openProfile(zap.counterparty);
    }
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

  async refreshHistory(): Promise<void> {
    // Clear cached timestamp to force full reload
    const account = this.accountState.account();
    if (account) {
      this.accountLocalState.setZapHistoryLastTimestamp(account.pubkey, 0);
    }
    await this.loadZapHistory();
  }
}
