import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { DecimalPipe, DatePipe } from '@angular/common';
import { kinds, Event } from 'nostr-tools';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { LoggerService } from '../../services/logger.service';
import { AccountRelayService } from '../../services/relays/account-relay';
import { ZapService } from '../../services/zap.service';
import { UtilitiesService } from '../../services/utilities.service';
import { LayoutService } from '../../services/layout.service';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';

interface EventStats {
  reactions: number;
  likes: number;
  reposts: number;
  replies: number;
  zaps: number;
  zapAmount: number;
  uniqueEngagers: number;
}

interface TopEngager {
  pubkey: string;
  reactions: number;
  reposts: number;
  replies: number;
  zaps: number;
  zapAmount: number;
  totalEngagement: number;
}

@Component({
  selector: 'app-event-analytics',
  imports: [
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatCardModule,
    MatDividerModule,
    MatTooltipModule,
    MatProgressBarModule,
    DecimalPipe,
    DatePipe,
    UserProfileComponent,
  ],
  templateUrl: './event-analytics.component.html',
  styleUrl: './event-analytics.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventAnalyticsComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly accountState = inject(AccountStateService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly logger = inject(LoggerService);
  private readonly zapService = inject(ZapService);
  private readonly utilities = inject(UtilitiesService);
  protected readonly app = inject(ApplicationService);
  protected readonly layout = inject(LayoutService);

  // Event being analyzed
  targetEvent = signal<Event | null>(null);
  eventEncodedId = signal<string>('');
  isAddressableEvent = signal<boolean>(false);
  eventAddress = signal<string>('');

  // Loading states
  isLoadingEvent = signal(false);
  isLoadingStats = signal(false);
  loadingProgress = signal(0);
  loadingStatus = signal('');

  // Stats
  eventStats = signal<EventStats>({
    reactions: 0,
    likes: 0,
    reposts: 0,
    replies: 0,
    zaps: 0,
    zapAmount: 0,
    uniqueEngagers: 0,
  });

  topEngagers = signal<TopEngager[]>([]);

  isPremium = computed(() => {
    const subscription = this.accountState.subscription();
    return subscription?.expires && subscription.expires > Date.now();
  });

  totalEngagement = computed(() => {
    const stats = this.eventStats();
    return stats.reactions + stats.reposts + stats.replies + stats.zaps;
  });

  async ngOnInit(): Promise<void> {
    const encodedId = this.route.snapshot.paramMap.get('id');
    if (encodedId) {
      this.eventEncodedId.set(encodedId);
      await this.loadTargetEvent(encodedId);
    }
  }

  private async loadTargetEvent(encodedId: string): Promise<void> {
    this.isLoadingEvent.set(true);

    try {
      const decoded = this.utilities.decodeEventFromUrl(encodedId);
      if (!decoded) {
        this.logger.error('Failed to decode event ID:', encodedId);
        return;
      }

      if (decoded.identifier !== undefined && decoded.kind !== undefined && decoded.author) {
        this.isAddressableEvent.set(true);
        const dTag = decoded.identifier || '';
        this.eventAddress.set(`${decoded.kind}:${decoded.author}:${dTag}`);

        const events = await this.accountRelay.getMany({
          kinds: [decoded.kind],
          authors: [decoded.author],
          '#d': [dTag],
          limit: 1,
        });

        if (events.length > 0) {
          this.targetEvent.set(events[0]);
          if (this.isPremium()) {
            await this.loadAnalytics();
          }
        }
      } else if (decoded.id) {
        this.isAddressableEvent.set(false);
        const event = await this.accountRelay.get({ ids: [decoded.id] });
        if (event) {
          this.targetEvent.set(event);
          if (this.isPremium()) {
            await this.loadAnalytics();
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to load target event:', error);
    } finally {
      this.isLoadingEvent.set(false);
    }
  }

  async loadAnalytics(): Promise<void> {
    const event = this.targetEvent();
    if (!event || this.isLoadingStats()) return;

    this.isLoadingStats.set(true);
    this.loadingProgress.set(0);
    this.loadingStatus.set('Loading engagement data...');

    const engagerMap = new Map<string, TopEngager>();

    try {
      // Load reactions
      this.loadingStatus.set('Loading reactions...');
      this.loadingProgress.set(20);
      const reactions = await this.loadReactions(event);

      // Load reposts
      this.loadingStatus.set('Loading reposts...');
      this.loadingProgress.set(40);
      const reposts = await this.loadReposts(event);

      // Load replies
      this.loadingStatus.set('Loading replies...');
      this.loadingProgress.set(60);
      const replies = await this.loadReplies(event);

      // Load zaps
      this.loadingStatus.set('Loading zaps...');
      this.loadingProgress.set(80);
      const { zaps, zapAmount, zapperMap } = await this.loadZaps(event);

      // Count likes specifically
      const likes = reactions.filter(
        r => r.content === '+' || r.content === '' || r.content === '👍' || r.content === '❤️'
      ).length;

      // Build engager map
      for (const reaction of reactions) {
        const existing = engagerMap.get(reaction.pubkey) || this.createEmptyEngager(reaction.pubkey);
        existing.reactions++;
        existing.totalEngagement++;
        engagerMap.set(reaction.pubkey, existing);
      }

      for (const repost of reposts) {
        const existing = engagerMap.get(repost.pubkey) || this.createEmptyEngager(repost.pubkey);
        existing.reposts++;
        existing.totalEngagement++;
        engagerMap.set(repost.pubkey, existing);
      }

      for (const reply of replies) {
        const existing = engagerMap.get(reply.pubkey) || this.createEmptyEngager(reply.pubkey);
        existing.replies++;
        existing.totalEngagement++;
        engagerMap.set(reply.pubkey, existing);
      }

      for (const [pubkey, data] of zapperMap.entries()) {
        const existing = engagerMap.get(pubkey) || this.createEmptyEngager(pubkey);
        existing.zaps += data.count;
        existing.zapAmount += data.amount;
        existing.totalEngagement += data.count;
        engagerMap.set(pubkey, existing);
      }

      // Update stats
      this.eventStats.set({
        reactions: reactions.length,
        likes,
        reposts: reposts.length,
        replies: replies.length,
        zaps,
        zapAmount,
        uniqueEngagers: engagerMap.size,
      });

      // Sort top engagers by total engagement
      const sortedEngagers = Array.from(engagerMap.values())
        .sort((a, b) => b.totalEngagement - a.totalEngagement)
        .slice(0, 20);
      this.topEngagers.set(sortedEngagers);

      this.loadingProgress.set(100);
      this.loadingStatus.set('Complete!');
    } catch (error) {
      this.logger.error('Failed to load analytics:', error);
      this.loadingStatus.set('Error loading analytics');
    } finally {
      this.isLoadingStats.set(false);
    }
  }

  private createEmptyEngager(pubkey: string): TopEngager {
    return {
      pubkey,
      reactions: 0,
      reposts: 0,
      replies: 0,
      zaps: 0,
      zapAmount: 0,
      totalEngagement: 0,
    };
  }

  private async loadReactions(event: Event): Promise<Event[]> {
    const filters: { kinds: number[]; '#e'?: string[]; '#a'?: string[]; limit: number }[] = [
      { kinds: [kinds.Reaction], '#e': [event.id], limit: 1000 },
    ];

    if (this.isAddressableEvent()) {
      filters.push({ kinds: [kinds.Reaction], '#a': [this.eventAddress()], limit: 1000 });
    }

    const results: Event[] = [];
    for (const filter of filters) {
      const events = await this.accountRelay.getMany(filter);
      results.push(...events);
    }

    // Deduplicate by event ID
    const seen = new Set<string>();
    return results.filter(e => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  }

  private async loadReposts(event: Event): Promise<Event[]> {
    const repostKind = event.kind === kinds.ShortTextNote ? kinds.Repost : kinds.GenericRepost;

    const filters: { kinds: number[]; '#e'?: string[]; '#a'?: string[]; limit: number }[] = [
      { kinds: [repostKind], '#e': [event.id], limit: 1000 },
    ];

    if (this.isAddressableEvent()) {
      filters.push({ kinds: [repostKind], '#a': [this.eventAddress()], limit: 1000 });
    }

    const results: Event[] = [];
    for (const filter of filters) {
      const events = await this.accountRelay.getMany(filter);
      results.push(...events);
    }

    const seen = new Set<string>();
    return results.filter(e => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  }

  private async loadReplies(event: Event): Promise<Event[]> {
    const filters: { kinds: number[]; '#e'?: string[]; '#a'?: string[]; limit: number }[] = [
      { kinds: [kinds.ShortTextNote], '#e': [event.id], limit: 1000 },
    ];

    if (this.isAddressableEvent()) {
      filters.push({ kinds: [kinds.ShortTextNote], '#a': [this.eventAddress()], limit: 1000 });
    }

    const results: Event[] = [];
    for (const filter of filters) {
      const events = await this.accountRelay.getMany(filter);
      results.push(...events);
    }

    const seen = new Set<string>();
    return results.filter(e => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  }

  private async loadZaps(event: Event): Promise<{
    zaps: number;
    zapAmount: number;
    zapperMap: Map<string, { count: number; amount: number }>;
  }> {
    const filters: { kinds: number[]; '#e'?: string[]; '#a'?: string[]; limit: number }[] = [
      { kinds: [9735], '#e': [event.id], limit: 1000 },
    ];

    if (this.isAddressableEvent()) {
      filters.push({ kinds: [9735], '#a': [this.eventAddress()], limit: 1000 });
    }

    const results: Event[] = [];
    for (const filter of filters) {
      const events = await this.accountRelay.getMany(filter);
      results.push(...events);
    }

    // Deduplicate
    const seen = new Set<string>();
    const uniqueZaps = results.filter(e => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    let totalAmount = 0;
    const zapperMap = new Map<string, { count: number; amount: number }>();

    for (const receipt of uniqueZaps) {
      const parsed = await this.zapService.parseZapReceipt(receipt);
      const amount = parsed.amount || 0;
      totalAmount += amount;

      // Get sender pubkey from P tag
      const senderTag = receipt.tags.find(t => t[0] === 'P');
      if (senderTag && senderTag[1]) {
        const existing = zapperMap.get(senderTag[1]) || { count: 0, amount: 0 };
        existing.count++;
        existing.amount += amount;
        zapperMap.set(senderTag[1], existing);
      }
    }

    return {
      zaps: uniqueZaps.length,
      zapAmount: totalAmount,
      zapperMap,
    };
  }

  async refresh(): Promise<void> {
    await this.loadAnalytics();
  }

  getEventPreview(): string {
    const event = this.targetEvent();
    if (!event) return '';

    const content = event.content || '';
    const maxLength = 200;
    if (content.length <= maxLength) return content;
    return content.slice(0, maxLength) + '...';
  }

  getEventKindLabel(): string {
    const event = this.targetEvent();
    if (!event) return '';

    switch (event.kind) {
      case kinds.ShortTextNote:
        return 'Note';
      case kinds.LongFormArticle:
        return 'Article';
      default:
        return `Kind ${event.kind}`;
    }
  }

  formatSats(sats: number): string {
    if (sats >= 1000000) {
      return (sats / 1000000).toFixed(1) + 'M';
    }
    if (sats >= 1000) {
      return (sats / 1000).toFixed(1) + 'k';
    }
    return sats.toString();
  }
}
