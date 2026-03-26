import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog } from '@angular/material/dialog';
import { Event } from 'nostr-tools';
import { ZapService } from '../../services/zap.service';
import { ApplicationService } from '../../services/application.service';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { AccountRelayService } from '../../services/relays/account-relay';
import { ZapDialogComponent, ZapDialogData } from '../zap-dialog/zap-dialog.component';
import { DataService } from '../../services/data.service';
import { TimestampPipe } from '../../pipes/timestamp.pipe';
import { PollOption } from '../../interfaces';
import { PollContentComponent } from './poll-content.component';

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
    TimestampPipe,
    PollContentComponent,
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

  event = input.required<Event>();

  // Local state
  selectedOption = signal<string | null>(null);
  isLoading = signal(false);
  results = signal<ZapPollResult[]>([]);
  showResults = signal(false);

  // Parse the event into a ZapPoll object
  poll = computed<ZapPoll>(() => {
    const event = this.event();
    return this.parseZapPollEvent(event);
  });

  isExpired = computed(() => {
    const poll = this.poll();
    if (!poll.closedAt) return false;
    return Date.now() / 1000 > poll.closedAt;
  });

  hasResults = computed(() => {
    return this.results().some(r => r.zapCount > 0);
  });

  displayResults = computed(() => {
    return this.hasResults() || this.showResults();
  });

  totalZaps = computed(() => {
    return this.results().reduce((sum, r) => sum + r.zapCount, 0);
  });

  totalSats = computed(() => {
    return this.results().reduce((sum, r) => sum + r.totalSats, 0);
  });

  constructor() {
    effect(() => {
      const event = this.event();
      untracked(() => {
        void this.loadZapResults(event);
      });
    });
  }

  private async loadZapResults(event: Event): Promise<void> {
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

      // Parse zap receipts into per-option results
      const optionResults = new Map<string, { zapCount: number; totalSats: number }>();

      // Initialize all options
      for (const option of poll.options) {
        optionResults.set(option.id, { zapCount: 0, totalSats: 0 });
      }

      for (const receipt of zapReceipts) {
        const parsed = this.parseZapReceiptForPoll(receipt, poll);
        if (parsed) {
          const existing = optionResults.get(parsed.optionId);
          if (existing) {
            existing.zapCount++;
            existing.totalSats += parsed.amountSats;
          }
        }
      }

      const resultArray: ZapPollResult[] = [];
      for (const [optionId, data] of optionResults) {
        resultArray.push({
          optionId,
          zapCount: data.zapCount,
          totalSats: data.totalSats,
        });
      }

      this.results.set(resultArray);
    } catch (error) {
      console.error('Failed to load zap poll results:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Parse a kind 9735 zap receipt to extract which poll option was voted for.
   * The zap request (kind 9734) embedded in the receipt's `description` tag
   * should contain a `poll_option` tag indicating the chosen option.
   */
  private parseZapReceiptForPoll(receipt: Event, poll: ZapPoll): { optionId: string; amountSats: number } | null {
    try {
      // Get the embedded zap request from the description tag
      const descriptionTag = receipt.tags.find(t => t[0] === 'description');
      if (!descriptionTag?.[1]) return null;

      const zapRequest: Event = JSON.parse(descriptionTag[1]);

      // Extract the poll_option tag from the zap request
      const pollOptionTag = zapRequest.tags.find(t => t[0] === 'poll_option');
      if (!pollOptionTag?.[1]) return null;

      const optionId = pollOptionTag[1];

      // Validate the option exists in this poll
      if (!poll.options.some(o => o.id === optionId)) return null;

      // Extract amount from bolt11 invoice
      const bolt11Tag = receipt.tags.find(t => t[0] === 'bolt11');
      let amountSats = 0;
      if (bolt11Tag?.[1]) {
        amountSats = this.decodeBolt11Amount(bolt11Tag[1]);
      }

      return { optionId, amountSats };
    } catch {
      return null;
    }
  }

  /**
   * Decode the amount from a bolt11 invoice string.
   * The amount is encoded after 'lnbc' as a number followed by a multiplier.
   */
  private decodeBolt11Amount(bolt11: string): number {
    try {
      const lower = bolt11.toLowerCase();
      // Match the amount part: lnbc<amount><multiplier>
      const match = lower.match(/^lnbc(\d+)([munp]?)/);
      if (!match) return 0;

      const amount = parseInt(match[1], 10);
      const multiplier = match[2];

      // Convert to sats based on multiplier
      // lnbc amounts are in BTC by default
      switch (multiplier) {
        case 'm': return amount * 100000; // milli-BTC = 0.001 BTC = 100,000 sats
        case 'u': return amount * 100;    // micro-BTC = 0.000001 BTC = 100 sats
        case 'n': return Math.floor(amount / 10); // nano-BTC = 0.1 sat
        case 'p': return Math.floor(amount / 10000); // pico-BTC = 0.0001 sat
        default: return amount * 100000000; // BTC = 100,000,000 sats
      }
    } catch {
      return 0;
    }
  }

  selectOption(optionId: string): void {
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
      // Reload results after dialog closes (zap may have been sent)
      setTimeout(() => {
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
    if (sats >= 1000000) {
      return `${(sats / 1000000).toFixed(1)}M sats`;
    }
    if (sats >= 1000) {
      return `${(sats / 1000).toFixed(1)}k sats`;
    }
    return `${sats} sats`;
  }

  private parseZapPollEvent(event: Event): ZapPoll {
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
