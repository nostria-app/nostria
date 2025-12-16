import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatListModule } from '@angular/material/list';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule } from '@angular/material/sort';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { kinds, Event, nip19 } from 'nostr-tools';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { LoggerService } from '../../services/logger.service';
import { AccountRelayService } from '../../services/relays/account-relay';
import { ZapMetricsService, ZapMetrics, DailyZapStats } from '../../services/zap-metrics.service';
import { Metrics } from '../../services/metrics';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';

// Time period options
type TimePeriod = '1h' | '6h' | '24h' | '7d' | '30d' | 'custom';

interface TimeRange {
  start: number;
  end: number;
}

interface EngagementStats {
  totalReactions: number;
  totalReposts: number;
  totalReplies: number;
  totalZaps: number;
  totalZapAmount: number;
  uniqueEngagers: number;
}

interface ContentStats {
  totalNotes: number;
  totalArticles: number;
  totalMedia: number;
  totalPolls: number;
  averageEngagementPerPost: number;
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

interface TopContent {
  id: string;
  kind: number;
  content: string;
  createdAt: number;
  reactions: number;
  reposts: number;
  replies: number;
  zaps: number;
  zapAmount: number;
  totalEngagement: number;
}

interface DailyEngagement {
  date: string;
  reactions: number;
  reposts: number;
  replies: number;
  zaps: number;
  zapAmount: number;
  newFollowers: number;
}

interface FollowerStats {
  totalFollowers: number;
  newFollowers: number;
  followerGrowthRate: number;
}

@Component({
  selector: 'app-analytics',
  imports: [
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatCardModule,
    MatTabsModule,
    MatDividerModule,
    MatTooltipModule,
    MatSelectModule,
    MatFormFieldModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatInputModule,
    MatChipsModule,
    MatExpansionModule,
    MatListModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatProgressBarModule,
    DecimalPipe,
    DatePipe,
    FormsModule,
    UserProfileComponent,
  ],
  templateUrl: './analytics.component.html',
  styleUrl: './analytics.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsComponent implements OnInit, OnDestroy {
  private readonly accountState = inject(AccountStateService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly logger = inject(LoggerService);
  private readonly zapMetrics = inject(ZapMetricsService);
  private readonly metricsService = inject(Metrics);
  protected readonly app = inject(ApplicationService);

  // Time period state
  selectedPeriod = signal<TimePeriod>('7d');
  customStartDate = signal<Date | null>(null);
  customEndDate = signal<Date | null>(null);

  // Loading states
  isLoading = signal(false);
  loadingProgress = signal(0);
  loadingStatus = signal('');

  // Data signals
  engagementStats = signal<EngagementStats>({
    totalReactions: 0,
    totalReposts: 0,
    totalReplies: 0,
    totalZaps: 0,
    totalZapAmount: 0,
    uniqueEngagers: 0,
  });

  contentStats = signal<ContentStats>({
    totalNotes: 0,
    totalArticles: 0,
    totalMedia: 0,
    totalPolls: 0,
    averageEngagementPerPost: 0,
  });

  followerStats = signal<FollowerStats>({
    totalFollowers: 0,
    newFollowers: 0,
    followerGrowthRate: 0,
  });

  topEngagers = signal<TopEngager[]>([]);
  topContent = signal<TopContent[]>([]);
  dailyEngagement = signal<DailyEngagement[]>([]);
  recentEngagements = signal<Event[]>([]);

  // Computed signals for UI
  timeRange = computed<TimeRange>(() => {
    const period = this.selectedPeriod();
    const now = Math.floor(Date.now() / 1000);

    if (period === 'custom') {
      const start = this.customStartDate();
      const end = this.customEndDate();
      return {
        start: start ? Math.floor(start.getTime() / 1000) : now - 7 * 24 * 60 * 60,
        end: end ? Math.floor(end.getTime() / 1000) : now,
      };
    }

    const periodSeconds: Record<string, number> = {
      '1h': 60 * 60,
      '6h': 6 * 60 * 60,
      '24h': 24 * 60 * 60,
      '7d': 7 * 24 * 60 * 60,
      '30d': 30 * 24 * 60 * 60,
    };

    return {
      start: now - (periodSeconds[period] || 7 * 24 * 60 * 60),
      end: now,
    };
  });

  isPremium = computed(() => {
    const subscription = this.accountState.subscription();
    return subscription?.expires && subscription.expires > Date.now();
  });

  totalEngagement = computed(() => {
    const stats = this.engagementStats();
    return stats.totalReactions + stats.totalReposts + stats.totalReplies + stats.totalZaps;
  });

  zapMetricsData = computed<ZapMetrics>(() => this.zapMetrics.metrics());
  zapDailyStats = computed<DailyZapStats[]>(() => this.zapMetrics.dailyStats());

  // Time period options
  readonly timePeriods = [
    { value: '1h' as TimePeriod, label: $localize`:@@analytics.period.1h:Last hour` },
    { value: '6h' as TimePeriod, label: $localize`:@@analytics.period.6h:Last 6 hours` },
    { value: '24h' as TimePeriod, label: $localize`:@@analytics.period.24h:Last 24 hours` },
    { value: '7d' as TimePeriod, label: $localize`:@@analytics.period.7d:Last 7 days` },
    { value: '30d' as TimePeriod, label: $localize`:@@analytics.period.30d:Last 30 days` },
    { value: 'custom' as TimePeriod, label: $localize`:@@analytics.period.custom:Custom range` },
  ];

  // Top content display columns
  topContentColumns = ['content', 'reactions', 'reposts', 'replies', 'zaps', 'total'];

  async ngOnInit(): Promise<void> {
    if (this.app.authenticated() && this.isPremium()) {
      await this.loadAnalytics();
    }
  }

  ngOnDestroy(): void {
    // Component cleanup handled by Angular's change detection
    this.isLoading.set(false);
  }

  async loadAnalytics(): Promise<void> {
    if (this.isLoading()) return;

    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.warn('No pubkey available for analytics');
      return;
    }

    this.isLoading.set(true);
    this.loadingProgress.set(0);
    this.loadingStatus.set('Loading your content...');

    try {
      const range = this.timeRange();

      // Load user's content
      this.loadingStatus.set('Loading your notes and articles...');
      this.loadingProgress.set(10);
      await this.loadUserContent(pubkey, range);

      // Load engagement on user's content
      this.loadingStatus.set('Loading engagement data...');
      this.loadingProgress.set(30);
      await this.loadEngagementData(pubkey, range);

      // Load follower stats
      this.loadingStatus.set('Loading follower statistics...');
      this.loadingProgress.set(60);
      await this.loadFollowerStats(pubkey, range);

      // Calculate daily engagement
      this.loadingStatus.set('Calculating daily trends...');
      this.loadingProgress.set(80);
      await this.calculateDailyEngagement(pubkey, range);

      // Load top engagers
      this.loadingStatus.set('Finding your top supporters...');
      this.loadingProgress.set(90);
      await this.loadTopEngagers(pubkey, range);

      this.loadingProgress.set(100);
      this.loadingStatus.set('Complete!');
    } catch (error) {
      this.logger.error('Failed to load analytics', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadUserContent(pubkey: string, range: TimeRange): Promise<void> {
    try {
      // Fetch user's notes
      const notes = await this.accountRelay.getMany({
        kinds: [kinds.ShortTextNote],
        authors: [pubkey],
        since: range.start,
        until: range.end,
        limit: 500,
      });

      // Fetch user's articles
      const articles = await this.accountRelay.getMany({
        kinds: [kinds.LongFormArticle],
        authors: [pubkey],
        since: range.start,
        until: range.end,
        limit: 100,
      });

      // Fetch user's media (kind 20 for photos, kind 21/22 for videos)
      const media = await this.accountRelay.getMany({
        kinds: [20, 21, 22],
        authors: [pubkey],
        since: range.start,
        until: range.end,
        limit: 200,
      });

      // Fetch polls
      const polls = await this.accountRelay.getMany({
        kinds: [1068], // Poll kind
        authors: [pubkey],
        since: range.start,
        until: range.end,
        limit: 50,
      });

      this.contentStats.update(stats => ({
        ...stats,
        totalNotes: notes.length,
        totalArticles: articles.length,
        totalMedia: media.length,
        totalPolls: polls.length,
      }));

      // Store all content for engagement tracking
      const allContent = [...notes, ...articles, ...media, ...polls];
      await this.loadContentEngagement(allContent, range);
    } catch (error) {
      this.logger.error('Failed to load user content', error);
    }
  }

  private async loadContentEngagement(content: Event[], range: TimeRange): Promise<void> {
    if (content.length === 0) return;

    const eventIds = content.map(e => e.id);
    const engagementByEvent = new Map<string, TopContent>();

    // Initialize engagement data for each event
    for (const event of content) {
      engagementByEvent.set(event.id, {
        id: event.id,
        kind: event.kind,
        content: event.content.substring(0, 200),
        createdAt: event.created_at,
        reactions: 0,
        reposts: 0,
        replies: 0,
        zaps: 0,
        zapAmount: 0,
        totalEngagement: 0,
      });
    }

    try {
      // Fetch reactions on user's content
      const reactions = await this.accountRelay.getMany({
        kinds: [kinds.Reaction],
        '#e': eventIds,
        since: range.start,
        until: range.end,
        limit: 1000,
      });

      // Fetch reposts
      const reposts = await this.accountRelay.getMany({
        kinds: [kinds.Repost, 16],
        '#e': eventIds,
        since: range.start,
        until: range.end,
        limit: 500,
      });

      // Fetch replies
      const replies = await this.accountRelay.getMany({
        kinds: [kinds.ShortTextNote],
        '#e': eventIds,
        since: range.start,
        until: range.end,
        limit: 500,
      });

      // Fetch zap receipts
      const zapReceipts = await this.accountRelay.getMany({
        kinds: [9735],
        '#e': eventIds,
        since: range.start,
        until: range.end,
        limit: 500,
      });

      const engagers = new Set<string>();
      let totalZapAmount = 0;

      // Process reactions
      for (const reaction of reactions) {
        const eventId = reaction.tags.find(t => t[0] === 'e')?.[1];
        if (eventId && engagementByEvent.has(eventId)) {
          const data = engagementByEvent.get(eventId)!;
          data.reactions++;
          engagers.add(reaction.pubkey);
        }
      }

      // Process reposts
      for (const repost of reposts) {
        const eventId = repost.tags.find(t => t[0] === 'e')?.[1];
        if (eventId && engagementByEvent.has(eventId)) {
          const data = engagementByEvent.get(eventId)!;
          data.reposts++;
          engagers.add(repost.pubkey);
        }
      }

      // Process replies
      for (const reply of replies) {
        const eventId = reply.tags.find(t => t[0] === 'e')?.[1];
        if (eventId && engagementByEvent.has(eventId)) {
          const data = engagementByEvent.get(eventId)!;
          data.replies++;
          engagers.add(reply.pubkey);
        }
      }

      // Process zaps
      for (const zap of zapReceipts) {
        const eventId = zap.tags.find(t => t[0] === 'e')?.[1];
        const bolt11 = zap.tags.find(t => t[0] === 'bolt11')?.[1];
        const amount = this.extractZapAmount(bolt11);

        if (eventId && engagementByEvent.has(eventId)) {
          const data = engagementByEvent.get(eventId)!;
          data.zaps++;
          data.zapAmount += amount;
          totalZapAmount += amount;
          engagers.add(zap.pubkey);
        }
      }

      // Calculate total engagement for each event
      for (const data of engagementByEvent.values()) {
        data.totalEngagement = data.reactions + data.reposts * 3 + data.replies * 5 + data.zaps * 10;
      }

      // Update engagement stats
      this.engagementStats.set({
        totalReactions: reactions.length,
        totalReposts: reposts.length,
        totalReplies: replies.length,
        totalZaps: zapReceipts.length,
        totalZapAmount: totalZapAmount,
        uniqueEngagers: engagers.size,
      });

      // Update content stats with average engagement
      const totalContent = content.length;
      const totalEngagement = reactions.length + reposts.length + replies.length + zapReceipts.length;
      this.contentStats.update(stats => ({
        ...stats,
        averageEngagementPerPost: totalContent > 0 ? Math.round((totalEngagement / totalContent) * 10) / 10 : 0,
      }));

      // Sort and store top content
      const sortedContent = Array.from(engagementByEvent.values())
        .sort((a, b) => b.totalEngagement - a.totalEngagement)
        .slice(0, 20);
      this.topContent.set(sortedContent);

      // Store recent engagements
      const recentEvents = [...reactions, ...reposts, ...replies, ...zapReceipts]
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, 50);
      this.recentEngagements.set(recentEvents);
    } catch (error) {
      this.logger.error('Failed to load content engagement', error);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async loadEngagementData(_pubkey: string, _range: TimeRange): Promise<void> {
    // This data is already loaded in loadContentEngagement
    // Placeholder for future additional engagement metrics
    return;
  }

  private async loadFollowerStats(pubkey: string, range: TimeRange): Promise<void> {
    try {
      // Fetch follow events where user is the followed party
      const followEvents = await this.accountRelay.getMany({
        kinds: [kinds.Contacts],
        '#p': [pubkey],
        since: range.start,
        until: range.end,
        limit: 1000,
      });

      // Count unique followers from the period
      const newFollowers = new Set(followEvents.map(e => e.pubkey)).size;

      // Try to get total followers from a broader time range
      const allFollowers = await this.accountRelay.getMany({
        kinds: [kinds.Contacts],
        '#p': [pubkey],
        limit: 5000,
      });

      const totalFollowers = new Set(allFollowers.map(e => e.pubkey)).size;
      const periodDays = (range.end - range.start) / (24 * 60 * 60);
      const growthRate = periodDays > 0 ? Math.round((newFollowers / periodDays) * 10) / 10 : 0;

      this.followerStats.set({
        totalFollowers,
        newFollowers,
        followerGrowthRate: growthRate,
      });
    } catch (error) {
      this.logger.error('Failed to load follower stats', error);
    }
  }

  private async calculateDailyEngagement(pubkey: string, range: TimeRange): Promise<void> {
    try {
      const days = Math.ceil((range.end - range.start) / (24 * 60 * 60));
      const dailyData = new Map<string, DailyEngagement>();

      // Initialize daily data
      for (let i = 0; i < Math.min(days, 30); i++) {
        const date = new Date((range.end - i * 24 * 60 * 60) * 1000);
        const dateStr = date.toISOString().split('T')[0];
        dailyData.set(dateStr, {
          date: dateStr,
          reactions: 0,
          reposts: 0,
          replies: 0,
          zaps: 0,
          zapAmount: 0,
          newFollowers: 0,
        });
      }

      // Get user's content IDs for the period
      const userContent = await this.accountRelay.getMany({
        kinds: [kinds.ShortTextNote, kinds.LongFormArticle, 20, 21, 22],
        authors: [pubkey],
        since: range.start,
        until: range.end,
        limit: 500,
      });

      const eventIds = userContent.map(e => e.id);
      if (eventIds.length === 0) {
        this.dailyEngagement.set(Array.from(dailyData.values()).reverse());
        return;
      }

      // Fetch all engagement events
      const [reactions, reposts, replies, zaps] = await Promise.all([
        this.accountRelay.getMany({
          kinds: [kinds.Reaction],
          '#e': eventIds,
          since: range.start,
          until: range.end,
          limit: 2000,
        }),
        this.accountRelay.getMany({
          kinds: [kinds.Repost, 16],
          '#e': eventIds,
          since: range.start,
          until: range.end,
          limit: 1000,
        }),
        this.accountRelay.getMany({
          kinds: [kinds.ShortTextNote],
          '#e': eventIds,
          since: range.start,
          until: range.end,
          limit: 1000,
        }),
        this.accountRelay.getMany({
          kinds: [9735],
          '#e': eventIds,
          since: range.start,
          until: range.end,
          limit: 1000,
        }),
      ]);

      // Aggregate by day
      for (const event of reactions) {
        const dateStr = new Date(event.created_at * 1000).toISOString().split('T')[0];
        if (dailyData.has(dateStr)) {
          dailyData.get(dateStr)!.reactions++;
        }
      }

      for (const event of reposts) {
        const dateStr = new Date(event.created_at * 1000).toISOString().split('T')[0];
        if (dailyData.has(dateStr)) {
          dailyData.get(dateStr)!.reposts++;
        }
      }

      for (const event of replies) {
        const dateStr = new Date(event.created_at * 1000).toISOString().split('T')[0];
        if (dailyData.has(dateStr)) {
          dailyData.get(dateStr)!.replies++;
        }
      }

      for (const event of zaps) {
        const dateStr = new Date(event.created_at * 1000).toISOString().split('T')[0];
        const bolt11 = event.tags.find(t => t[0] === 'bolt11')?.[1];
        const amount = this.extractZapAmount(bolt11);
        if (dailyData.has(dateStr)) {
          const day = dailyData.get(dateStr)!;
          day.zaps++;
          day.zapAmount += amount;
        }
      }

      this.dailyEngagement.set(Array.from(dailyData.values()).reverse());
    } catch (error) {
      this.logger.error('Failed to calculate daily engagement', error);
    }
  }

  private async loadTopEngagers(pubkey: string, range: TimeRange): Promise<void> {
    try {
      // Get user's content IDs
      const userContent = await this.accountRelay.getMany({
        kinds: [kinds.ShortTextNote, kinds.LongFormArticle, 20, 21, 22],
        authors: [pubkey],
        since: range.start,
        until: range.end,
        limit: 500,
      });

      const eventIds = userContent.map(e => e.id);
      if (eventIds.length === 0) {
        this.topEngagers.set([]);
        return;
      }

      const engagerMap = new Map<string, TopEngager>();

      const getOrCreateEngager = (pk: string): TopEngager => {
        if (!engagerMap.has(pk)) {
          engagerMap.set(pk, {
            pubkey: pk,
            reactions: 0,
            reposts: 0,
            replies: 0,
            zaps: 0,
            zapAmount: 0,
            totalEngagement: 0,
          });
        }
        return engagerMap.get(pk)!;
      };

      // Fetch engagement events
      const [reactions, reposts, replies, zaps] = await Promise.all([
        this.accountRelay.getMany({
          kinds: [kinds.Reaction],
          '#e': eventIds,
          since: range.start,
          until: range.end,
          limit: 2000,
        }),
        this.accountRelay.getMany({
          kinds: [kinds.Repost, 16],
          '#e': eventIds,
          since: range.start,
          until: range.end,
          limit: 1000,
        }),
        this.accountRelay.getMany({
          kinds: [kinds.ShortTextNote],
          '#e': eventIds,
          since: range.start,
          until: range.end,
          limit: 1000,
        }),
        this.accountRelay.getMany({
          kinds: [9735],
          '#e': eventIds,
          since: range.start,
          until: range.end,
          limit: 1000,
        }),
      ]);

      // Don't include self in engagers
      for (const event of reactions) {
        if (event.pubkey !== pubkey) {
          getOrCreateEngager(event.pubkey).reactions++;
        }
      }

      for (const event of reposts) {
        if (event.pubkey !== pubkey) {
          getOrCreateEngager(event.pubkey).reposts++;
        }
      }

      for (const event of replies) {
        if (event.pubkey !== pubkey) {
          getOrCreateEngager(event.pubkey).replies++;
        }
      }

      for (const event of zaps) {
        // Zap receipts have the sender in a 'P' tag
        const senderPubkey = event.tags.find(t => t[0] === 'P')?.[1] || event.pubkey;
        if (senderPubkey !== pubkey) {
          const engager = getOrCreateEngager(senderPubkey);
          engager.zaps++;
          const bolt11 = event.tags.find(t => t[0] === 'bolt11')?.[1];
          engager.zapAmount += this.extractZapAmount(bolt11);
        }
      }

      // Calculate total engagement for each engager
      for (const engager of engagerMap.values()) {
        engager.totalEngagement =
          engager.reactions + engager.reposts * 3 + engager.replies * 5 + engager.zaps * 10;
      }

      // Sort by total engagement
      const sorted = Array.from(engagerMap.values())
        .sort((a, b) => b.totalEngagement - a.totalEngagement)
        .slice(0, 20);

      this.topEngagers.set(sorted);
    } catch (error) {
      this.logger.error('Failed to load top engagers', error);
    }
  }

  private extractZapAmount(bolt11?: string): number {
    if (!bolt11) return 0;

    try {
      // Extract amount from BOLT11 invoice
      // Format: lnbc<amount><multiplier>...
      const match = bolt11.match(/lnbc(\d+)([munp]?)/i);
      if (!match) return 0;

      const amount = parseInt(match[1], 10);
      const multiplier = match[2]?.toLowerCase() || '';

      // Convert to satoshis
      switch (multiplier) {
        case 'm':
          return amount * 100000; // milli-bitcoin
        case 'u':
          return amount * 100; // micro-bitcoin
        case 'n':
          return Math.floor(amount / 10); // nano-bitcoin
        case 'p':
          return Math.floor(amount / 10000); // pico-bitcoin
        default:
          return amount * 100000000; // bitcoin
      }
    } catch {
      return 0;
    }
  }

  onPeriodChange(period: TimePeriod): void {
    this.selectedPeriod.set(period);
    if (period !== 'custom') {
      this.loadAnalytics();
    }
  }

  onCustomDateChange(): void {
    if (this.customStartDate() && this.customEndDate()) {
      this.loadAnalytics();
    }
  }

  refresh(): void {
    this.loadAnalytics();
  }

  getContentKindLabel(kind: number): string {
    switch (kind) {
      case kinds.ShortTextNote:
        return 'Note';
      case kinds.LongFormArticle:
        return 'Article';
      case 20:
        return 'Photo';
      case 21:
      case 22:
        return 'Video';
      case 1068:
        return 'Poll';
      default:
        return 'Post';
    }
  }

  getContentKindIcon(kind: number): string {
    switch (kind) {
      case kinds.ShortTextNote:
        return 'chat_bubble';
      case kinds.LongFormArticle:
        return 'article';
      case 20:
        return 'photo';
      case 21:
      case 22:
        return 'videocam';
      case 1068:
        return 'poll';
      default:
        return 'note';
    }
  }

  formatSats(sats: number): string {
    if (sats >= 1000000) {
      return (sats / 1000000).toFixed(2) + 'M';
    } else if (sats >= 1000) {
      return (sats / 1000).toFixed(1) + 'K';
    }
    return sats.toString();
  }

  getEngagementScore(item: TopEngager): string {
    return item.totalEngagement.toLocaleString();
  }

  getNevent(eventId: string): string {
    return nip19.neventEncode({ id: eventId });
  }

  getBarWidth(value: number, type: string): number {
    const daily = this.dailyEngagement();
    if (daily.length === 0) return 0;

    let maxValue = 0;
    for (const day of daily) {
      switch (type) {
        case 'reactions':
          maxValue = Math.max(maxValue, day.reactions);
          break;
        case 'reposts':
          maxValue = Math.max(maxValue, day.reposts);
          break;
        case 'replies':
          maxValue = Math.max(maxValue, day.replies);
          break;
        case 'zaps':
          maxValue = Math.max(maxValue, day.zaps);
          break;
      }
    }

    return maxValue > 0 ? (value / maxValue) * 100 : 0;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getZapBarHeight(value: number, _type: 'received' | 'sent'): number {
    const stats = this.zapDailyStats();
    if (stats.length === 0) return 2;

    let maxValue = 0;
    for (const day of stats) {
      maxValue = Math.max(maxValue, day.volumeReceived, day.volumeSent);
    }

    const minHeight = 2;
    const maxHeight = 80;
    return maxValue > 0 ? Math.max(minHeight, (value / maxValue) * maxHeight) : minHeight;
  }
}
