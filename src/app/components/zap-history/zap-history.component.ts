import { Component, inject, signal, computed, effect, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-zap-history',
  imports: [
    CommonModule,
    ScrollingModule,
    MatIconModule,
    MatButtonModule,
    MatButtonToggleModule,
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
        <div class="controls-row">
          <mat-button-toggle-group class="filter-toggles" [value]="filterMode()" (change)="setFilterMode($event.value)" [hideSingleSelectionIndicator]="true">
            <mat-button-toggle value="all">All ({{ allZaps().length }})</mat-button-toggle>
            <mat-button-toggle value="sent">Sent ({{ sentZaps().length }})</mat-button-toggle>
            <mat-button-toggle value="received">Received ({{ receivedZaps().length }})</mat-button-toggle>
          </mat-button-toggle-group>

          <mat-button-toggle-group class="sort-toggles" [value]="sortBy()" (change)="setSortBy($event.value)" [hideSingleSelectionIndicator]="true">
            <mat-button-toggle value="date">Date</mat-button-toggle>
            <mat-button-toggle value="amount">Amount</mat-button-toggle>
          </mat-button-toggle-group>
        </div>

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
            <span class="stat-value" [class.sent]="netAmount() < 0" [class.received]="netAmount() > 0">
              {{ netAmount() }} sats
            </span>
          </div>
        </div>

        @if (displayedZaps().length === 0) {
          <div class="empty-state">
            <mat-icon class="empty-icon">bolt</mat-icon>
            <h3>{{ emptyStateTitle() }}</h3>
            <p>{{ emptyStateDescription() }}</p>
          </div>
        } @else {
          <cdk-virtual-scroll-viewport [itemSize]="56" [minBufferPx]="800" [maxBufferPx]="1400" class="zaps-viewport">
            <div
              *cdkVirtualFor="let zap of displayedZaps(); trackBy: trackByZapId"
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

      .controls-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 16px 0 12px 0;
        flex-wrap: wrap;
        flex-shrink: 0;
      }

      .filter-toggles,
      .sort-toggles {
        --mat-standard-button-toggle-height: 36px;
        width: fit-content;
        max-width: 100%;
      }

      ::ng-deep .filter-toggles .mat-button-toggle-label-content,
      ::ng-deep .sort-toggles .mat-button-toggle-label-content {
        padding: 0 12px;
        white-space: nowrap;
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
        width: 20px;
        min-width: 20px;
        max-width: 20px;
        flex: 0 0 20px;
        overflow: visible;
        display: flex;
        align-items: center;
      }

      .counterparty app-user-profile {
        width: 40px;
        min-width: 40px;
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
        flex: 1 1 auto;
        min-width: 0;
        max-width: clamp(70px, 34vw, 200px);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-style: italic;
        line-height: 1.25;
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

        .controls-row {
          align-items: flex-start;
          gap: 8px;
        }

        .filter-toggles,
        .sort-toggles {
          width: auto;
          display: inline-flex;
          max-width: 100%;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }

        ::ng-deep .filter-toggles .mat-button-toggle-label-content,
        ::ng-deep .sort-toggles .mat-button-toggle-label-content {
          padding: 0 10px;
          font-size: 13px;
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

        .counterparty {
          width: 18px;
          min-width: 18px;
          max-width: 18px;
          flex-basis: 18px;
        }

        .counterparty app-user-profile {
          width: 36px;
          min-width: 36px;
        }

        .comment-text {
          max-width: clamp(64px, 30vw, 120px);
          font-size: 11px;
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
  filterMode = signal<'all' | 'sent' | 'received'>('all');
  sortBy = signal<'date' | 'amount'>('date');

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

  displayedZaps = computed(() => {
    let base = this.allZaps();
    const filterMode = this.filterMode();

    if (filterMode === 'sent') {
      base = this.sentZaps();
    } else if (filterMode === 'received') {
      base = this.receivedZaps();
    }

    const sorted = [...base];
    if (this.sortBy() === 'amount') {
      sorted.sort((a, b) => b.amount - a.amount || b.timestamp - a.timestamp);
    } else {
      sorted.sort((a, b) => b.timestamp - a.timestamp);
    }

    return sorted;
  });

  emptyStateTitle = computed(() => {
    switch (this.filterMode()) {
      case 'sent':
        return 'No zaps sent';
      case 'received':
        return 'No zaps received';
      default:
        return 'No zaps yet';
    }
  });

  emptyStateDescription = computed(() => {
    switch (this.filterMode()) {
      case 'sent':
        return 'Zaps you send to others will appear here.';
      case 'received':
        return 'Zaps you receive from others will appear here.';
      default:
        return 'Your zap history will appear here once you send or receive lightning payments.';
    }
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

  setFilterMode(value: 'all' | 'sent' | 'received' | null): void {
    if (!value) {
      return;
    }
    this.filterMode.set(value);
  }

  setSortBy(value: 'date' | 'amount' | null): void {
    if (!value) {
      return;
    }
    this.sortBy.set(value);
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
