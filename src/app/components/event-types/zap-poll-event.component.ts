import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog } from '@angular/material/dialog';
import { Event as NostrEvent } from 'nostr-tools';
import { ZapService } from '../../services/zap.service';
import { ApplicationService } from '../../services/application.service';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { AccountRelayService } from '../../services/relays/account-relay';
import { ZapDialogComponent, ZapDialogData } from '../zap-dialog/zap-dialog.component';
import { DataService } from '../../services/data.service';
import { PollOption } from '../../interfaces';
import { PollContentComponent } from './poll-content.component';
import { type ZapInfo } from '../event/reaction-summary/reaction-summary.component';
import { SatAmountComponent } from '../sat-amount/sat-amount.component';
import { SatDisplayService } from '../../services/sat-display.service';

export interface ZapPoll {
  id: string;
  content: string;
  options: PollOption[];
  valueMinimum?: number;
  valueMaximum?: number;
  closedAt?: number;
  created_at: number;
  pubkey: string;
}

interface ZapPollResult {
  optionId: string;
  zapCount: number;
  totalSats: number;
}

@Component({
  selector: 'app-zap-poll-event',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    PollContentComponent,
    SatAmountComponent,
  ],
  templateUrl: './zap-poll-event.component.html',
  styleUrl: './zap-poll-event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZapPollEventComponent {
  private zapService = inject(ZapService);
  private app = inject(ApplicationService);
  private pool = inject(RelayPoolService);
  private accountRelay = inject(AccountRelayService);
  private dialog = inject(MatDialog);
  private dataService = inject(DataService);
  private destroyRef = inject(DestroyRef);
  protected readonly satDisplay = inject(SatDisplayService);

  event = input.required<NostrEvent>();
  zaps = input<ZapInfo[] | null>(null);
  zapsLoaded = input(false);
  fallbackZapCount = input(0);
  fallbackTotalSats = input(0);
  showZapsRequested = output<void>();
  refreshZapsRequested = output<void>();

  // Local state
  selectedOption = signal<string | null>(null);
  isLoading = signal(false);
  results = signal<ZapPollResult[]>([]);
  showResults = signal(false);
  nowTimestamp = signal(Math.floor(Date.now() / 1000));

  // Parse the event into a ZapPoll object
  poll = computed<ZapPoll>(() => {
    const event = this.event();
    return this.parseZapPollEvent(event);
  });

  isExpired = computed(() => {
    const poll = this.poll();
    if (!poll.closedAt) return false;
    return this.nowTimestamp() >= poll.closedAt;
  });

  timeLeftLabel = computed(() => {
    const closedAt = this.poll().closedAt;
    if (!closedAt) return '';

    const remainingSeconds = closedAt - this.nowTimestamp();
    if (remainingSeconds <= 0) return '';

    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    return `${hours}h and ${minutes}m left`;
  });

  hasResults = computed(() => {
    return this.results().some(r => r.zapCount > 0);
  });

  displayResults = computed(() => {
    return this.isExpired() || this.showResults();
  });

  totalZaps = computed(() => {
    return this.results().reduce((sum, r) => sum + r.zapCount, 0);
  });

  totalSats = computed(() => {
    return this.results().reduce((sum, r) => sum + r.totalSats, 0);
  });

  summaryZapCount = computed(() => {
    const parsedCount = this.totalZaps();
    return parsedCount > 0 ? parsedCount : this.fallbackZapCount();
  });

  summaryTotalSats = computed(() => {
    const parsedSats = this.totalSats();
    return parsedSats > 0 ? parsedSats : this.fallbackTotalSats();
  });

  constructor() {
    effect(() => {
      const event = this.event();
      const sharedZaps = this.zaps();
      const sharedZapsLoaded = this.zapsLoaded();

      untracked(() => {
        if (sharedZaps !== null) {
          this.isLoading.set(!sharedZapsLoaded);
          this.results.set(this.buildResultsFromZaps(this.parseZapPollEvent(event), sharedZaps));
          return;
        }

        void this.loadZapResults(event);
      });
    });

    const intervalId = setInterval(() => {
      this.nowTimestamp.set(Math.floor(Date.now() / 1000));
    }, 60000);

    this.destroyRef.onDestroy(() => {
      clearInterval(intervalId);
    });
  }

  onTotalZapsClick(event: Event): void {
    event.stopPropagation();
    this.showZapsRequested.emit();
  }

  private async loadZapResults(event: NostrEvent): Promise<void> {
    this.isLoading.set(true);

    try {
      const relayUrls = this.accountRelay.getRelayUrls();
      if (relayUrls.length === 0) return;

      // Fetch zap receipts (kind 9735) for this poll event
      const filter: {
        kinds: number[];
        '#e': string[];
        until?: number;
      } = {
        kinds: [9735],
        '#e': [event.id],
      };

      const poll = this.parseZapPollEvent(event);
      if (poll.closedAt) {
        filter.until = poll.closedAt;
      }

      const zapReceipts = await this.pool.query(relayUrls, filter, 5000);

      const parsedZaps: ZapInfo[] = [];
      for (const receipt of zapReceipts) {
        const parsed = this.zapService.parseZapReceipt(receipt);
        if (parsed.zapRequest && parsed.amount) {
          parsedZaps.push({
            receipt,
            zapRequest: parsed.zapRequest,
            amount: parsed.amount,
            comment: parsed.comment,
            senderPubkey: parsed.zapRequest.pubkey,
            timestamp: receipt.created_at,
          });
        }
      }

      this.results.set(this.buildResultsFromZaps(poll, parsedZaps));
    } catch (error) {
      console.error('Failed to load zap poll results:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  private buildResultsFromZaps(poll: ZapPoll, zaps: ZapInfo[]): ZapPollResult[] {
    const optionResults = new Map<string, { zapCount: number; totalSats: number }>();

    for (const option of poll.options) {
      optionResults.set(option.id, { zapCount: 0, totalSats: 0 });
    }

    for (const zap of zaps) {
      if (poll.closedAt && zap.timestamp > poll.closedAt) {
        continue;
      }

      const optionId = zap.zapRequest?.tags.find(tag => tag[0] === 'poll_option')?.[1];
      if (!optionId || !poll.options.some(option => option.id === optionId)) {
        continue;
      }

      const existing = optionResults.get(optionId);
      if (!existing) {
        continue;
      }

      existing.zapCount++;
      existing.totalSats += zap.amount || 0;
    }

    return Array.from(optionResults.entries()).map(([optionId, data]) => ({
      optionId,
      zapCount: data.zapCount,
      totalSats: data.totalSats,
    }));
  }

  selectOption(optionId: string): void {
    if (this.isExpired()) {
      return;
    }

    if (this.selectedOption() === optionId) {
      this.selectedOption.set(null);
    } else {
      this.selectedOption.set(optionId);
    }
  }

  toggleShowResults(): void {
    this.showResults.update(v => !v);
  }

  async voteWithZap(): Promise<void> {
    const optionId = this.selectedOption();
    if (!optionId) return;

    const event = this.event();
    const poll = this.poll();
    const option = poll.options.find(o => o.id === optionId);
    if (!option) return;

    // Look up recipient profile for the zap dialog
    let recipientName: string | undefined;
    let recipientMetadata: Record<string, unknown> | undefined;

    try {
      const recipientProfile = await this.dataService.getProfile(event.pubkey);
      if (recipientProfile?.data) {
        const data = recipientProfile.data as Record<string, unknown>;
        recipientName =
          (typeof data['display_name'] === 'string' ? data['display_name'] : undefined) ||
          (typeof data['name'] === 'string' ? data['name'] : undefined);
        recipientMetadata = data;
      }
    } catch {
      // Continue without profile data
    }

    const dialogData: ZapDialogData = {
      recipientPubkey: event.pubkey,
      recipientName,
      recipientMetadata,
      eventId: event.id,
      eventKind: event.kind,
      initialMessage: `Poll vote: ${option.label}`,
      eventContent: poll.content,
    };

    const dialogRef = this.dialog.open(ZapDialogComponent, {
      data: dialogData,
      width: '480px',
      maxWidth: '95vw',
    });

    dialogRef.afterClosed().subscribe(() => {
      setTimeout(() => {
        if (this.zaps() !== null) {
          this.refreshZapsRequested.emit();
          return;
        }

        void this.loadZapResults(this.event());
      }, 2000);
    });
  }

  getPercentage(optionId: string): number {
    const total = this.totalZaps();
    if (total === 0) return 0;
    const result = this.results().find(r => r.optionId === optionId);
    if (!result) return 0;
    return Math.round((result.zapCount / total) * 100);
  }

  getZapCount(optionId: string): number {
    const result = this.results().find(r => r.optionId === optionId);
    return result?.zapCount ?? 0;
  }

  getZapAmount(optionId: string): number {
    const result = this.results().find(r => r.optionId === optionId);
    return result?.totalSats ?? 0;
  }

  formatSats(sats: number): string {
    return this.satDisplay.formatSats(sats, { compact: true });
  }

  private parseZapPollEvent(event: NostrEvent): ZapPoll {
    const options: PollOption[] = event.tags
      .filter(tag => tag[0] === 'poll_option')
      .map(tag => ({
        id: tag[1],
        label: tag[2],
      }));

    const valueMinTag = event.tags.find(tag => tag[0] === 'value_minimum');
    const valueMinimum = valueMinTag ? parseInt(valueMinTag[1], 10) : undefined;

    const valueMaxTag = event.tags.find(tag => tag[0] === 'value_maximum');
    const valueMaximum = valueMaxTag ? parseInt(valueMaxTag[1], 10) : undefined;

    const closedAtTag = event.tags.find(tag => tag[0] === 'closed_at');
    const closedAt = closedAtTag ? parseInt(closedAtTag[1], 10) : undefined;

    return {
      id: event.id,
      content: event.content,
      options,
      valueMinimum,
      valueMaximum,
      closedAt,
      created_at: event.created_at,
      pubkey: event.pubkey,
    };
  }
}
