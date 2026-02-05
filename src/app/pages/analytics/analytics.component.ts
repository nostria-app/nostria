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
import { ScrollingModule } from '@angular/cdk/scrolling';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { LoggerService } from '../../services/logger.service';
import { AccountRelayService } from '../../services/relays/account-relay';
import { ZapService } from '../../services/zap.service';
import { Metrics } from '../../services/metrics';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { LayoutService } from '../../services/layout.service';
import { DiscoveryRelayService } from '../../services/relays/discovery-relay';
import { LocalStorageService } from '../../services/local-storage.service';
import { SimplePool } from 'nostr-tools';

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

interface ZapAnalyticsData {
  zapsReceived: number;
  satsReceived: number;
  zapsSent: number;
  satsSent: number;
}

interface DailyZapData {
  date: string;
  received: number;
  sent: number;
  volumeReceived: number;
  volumeSent: number;
}

// Relay source types for follower discovery
type RelaySource = 'account' | 'custom' | 'deep';

interface DiscoveredFollower {
  pubkey: string;
  isFollowing: boolean;
  discoveredAt: number;
  followListUpdated: number; // Timestamp of the most recent kind 3 event where this follower included the current user in their contact list
}

interface FollowerDiscoveryCache {
  followers: DiscoveredFollower[];
  lastUpdated: number;
  relaySource: RelaySource;
  customRelays?: string[];
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
    ScrollingModule,
  ],
  templateUrl: './analytics.component.html',
  styleUrl: './analytics.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsComponent implements OnInit, OnDestroy {
  private readonly accountState = inject(AccountStateService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly logger = inject(LoggerService);
  private readonly zapService = inject(ZapService);
  private readonly metricsService = inject(Metrics);
  private readonly discoveryRelay = inject(DiscoveryRelayService);
  private readonly localStorage = inject(LocalStorageService);
  protected readonly app = inject(ApplicationService);
  protected readonly layout = inject(LayoutService);

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

  // Zap analytics data
  zapAnalytics = signal<ZapAnalyticsData>({
    zapsReceived: 0,
    satsReceived: 0,
    zapsSent: 0,
    satsSent: 0,
  });
  dailyZapData = signal<DailyZapData[]>([]);

  // Follower discovery data
  discoveredFollowers = signal<DiscoveredFollower[]>([]);
  followerDiscoveryLoading = signal(false);
  followerDiscoveryProgress = signal(0);
  followerDiscoveryStatus = signal('');
  selectedRelaySource = signal<RelaySource>('account');
  customRelayInput = signal('');
  customRelays = signal<string[]>([]);
  customRelayError = signal('');

  // Virtual scroll configuration for follower list
  readonly followerItemSize = 56; // Fixed height in pixels
  readonly minBufferPx = 560; // 10 items
  readonly maxBufferPx = 1120; // 20 items

  // Computed signals for follower discovery
  newFollowersCount = computed(() => {
    return this.discoveredFollowers().filter(f => !f.isFollowing).length;
  });

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
      // Load cached follower discovery data
      this.loadFollowerDiscoveryCache();
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
      this.loadingProgress.set(85);
      await this.loadTopEngagers(pubkey, range);

      // Load zap analytics from relays
      this.loadingStatus.set('Loading zap history...');
      this.loadingProgress.set(95);
      await this.loadZapAnalytics(pubkey, range);

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
        limit: 500,
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
        limit: 500,
      });

      // Count unique followers from the period
      const newFollowers = new Set(followEvents.map(e => e.pubkey)).size;

      // Try to get total followers from a broader time range
      const allFollowers = await this.accountRelay.getMany({
        kinds: [kinds.Contacts],
        '#p': [pubkey],
        limit: 500,
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
          limit: 500,
        }),
        this.accountRelay.getMany({
          kinds: [kinds.Repost, 16],
          '#e': eventIds,
          since: range.start,
          until: range.end,
          limit: 500,
        }),
        this.accountRelay.getMany({
          kinds: [kinds.ShortTextNote],
          '#e': eventIds,
          since: range.start,
          until: range.end,
          limit: 500,
        }),
        this.accountRelay.getMany({
          kinds: [9735],
          '#e': eventIds,
          since: range.start,
          until: range.end,
          limit: 500,
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
          limit: 500,
        }),
        this.accountRelay.getMany({
          kinds: [kinds.Repost, 16],
          '#e': eventIds,
          since: range.start,
          until: range.end,
          limit: 500,
        }),
        this.accountRelay.getMany({
          kinds: [kinds.ShortTextNote],
          '#e': eventIds,
          since: range.start,
          until: range.end,
          limit: 500,
        }),
        this.accountRelay.getMany({
          kinds: [9735],
          '#e': eventIds,
          since: range.start,
          until: range.end,
          limit: 500,
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

  /**
   * Load zap analytics from relays using ZapService
   * This fetches actual zap receipts for both sent and received zaps
   */
  private async loadZapAnalytics(pubkey: string, range: TimeRange): Promise<void> {
    try {
      // Get zaps received by the user
      const receivedZapReceipts = await this.zapService.getZapsForUser(pubkey);

      // Get zaps sent by the user
      const sentZapReceipts = await this.zapService.getZapsSentByUser(pubkey);

      // Filter by time range and calculate totals
      let zapsReceived = 0;
      let satsReceived = 0;
      let zapsSent = 0;
      let satsSent = 0;

      // Track processed receipt IDs to avoid duplicates
      const processedIds = new Set<string>();

      // Daily data map for charting
      const dailyMap = new Map<string, DailyZapData>();

      // Initialize daily data for the time range
      const startDate = new Date(range.start * 1000);
      const endDate = new Date(range.end * 1000);
      const currentDate = new Date(startDate);

      while (currentDate <= endDate) {
        const dateStr = currentDate.toISOString().split('T')[0];
        dailyMap.set(dateStr, {
          date: dateStr,
          received: 0,
          sent: 0,
          volumeReceived: 0,
          volumeSent: 0,
        });
        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Process received zaps
      for (const receipt of receivedZapReceipts) {
        if (processedIds.has(receipt.id)) continue;

        // Filter by time range
        if (receipt.created_at < range.start || receipt.created_at > range.end) continue;

        const parsed = this.zapService.parseZapReceipt(receipt);
        if (parsed.zapRequest && parsed.amount) {
          zapsReceived++;
          satsReceived += parsed.amount;
          processedIds.add(receipt.id);

          // Add to daily stats
          const dateStr = new Date(receipt.created_at * 1000).toISOString().split('T')[0];
          const dayData = dailyMap.get(dateStr);
          if (dayData) {
            dayData.received++;
            dayData.volumeReceived += parsed.amount;
          }
        }
      }

      // Process sent zaps
      for (const receipt of sentZapReceipts) {
        if (processedIds.has(receipt.id)) continue;

        // Filter by time range
        if (receipt.created_at < range.start || receipt.created_at > range.end) continue;

        const parsed = this.zapService.parseZapReceipt(receipt);
        if (parsed.zapRequest && parsed.amount) {
          zapsSent++;
          satsSent += parsed.amount;
          processedIds.add(receipt.id);

          // Add to daily stats
          const dateStr = new Date(receipt.created_at * 1000).toISOString().split('T')[0];
          const dayData = dailyMap.get(dateStr);
          if (dayData) {
            dayData.sent++;
            dayData.volumeSent += parsed.amount;
          }
        }
      }

      this.zapAnalytics.set({
        zapsReceived,
        satsReceived,
        zapsSent,
        satsSent,
      });

      // Convert daily map to array and sort by date
      this.dailyZapData.set(
        Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date))
      );

      this.logger.debug('Zap analytics loaded', {
        zapsReceived,
        satsReceived,
        zapsSent,
        satsSent,
        dailyDataPoints: this.dailyZapData().length,
      });
    } catch (error) {
      this.logger.error('Failed to load zap analytics', error);
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
    const stats = this.dailyZapData();
    if (stats.length === 0) return 2;

    let maxValue = 0;
    for (const day of stats) {
      maxValue = Math.max(maxValue, day.volumeReceived, day.volumeSent);
    }

    const minHeight = 2;
    const maxHeight = 80;
    return maxValue > 0 ? Math.max(minHeight, (value / maxValue) * maxHeight) : minHeight;
  }

  /**
   * Load cached follower discovery data from local storage
   */
  private loadFollowerDiscoveryCache(): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    const cacheKey = `follower-discovery-${pubkey}`;
    const cached = this.localStorage.getItem(cacheKey);

    if (cached) {
      try {
        const cacheData: FollowerDiscoveryCache = JSON.parse(cached);
        this.discoveredFollowers.set(cacheData.followers);
        this.selectedRelaySource.set(cacheData.relaySource);
        if (cacheData.customRelays) {
          this.customRelays.set(cacheData.customRelays);
        }
        this.logger.debug(`Loaded ${cacheData.followers.length} cached followers`);
      } catch (error) {
        this.logger.error('Failed to parse follower discovery cache', error);
      }
    }
  }

  /**
   * Save follower discovery data to local storage
   */
  private saveFollowerDiscoveryCache(): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    const cacheKey = `follower-discovery-${pubkey}`;
    const cacheData: FollowerDiscoveryCache = {
      followers: this.discoveredFollowers(),
      lastUpdated: Date.now(),
      relaySource: this.selectedRelaySource(),
      customRelays: this.customRelays(),
    };

    this.localStorage.setItem(cacheKey, JSON.stringify(cacheData));
    this.logger.debug(`Saved ${cacheData.followers.length} followers to cache`);
  }

  /**
   * Discover followers by querying for kind 3 events that mention the current user
   * Implements pagination to fetch all followers beyond the 500 event limit
   */
  async discoverFollowers(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.warn('No pubkey available for follower discovery');
      return;
    }

    if (this.followerDiscoveryLoading()) {
      this.logger.debug('Follower discovery already in progress');
      return;
    }

    this.followerDiscoveryLoading.set(true);
    this.followerDiscoveryProgress.set(0);
    this.followerDiscoveryStatus.set('Preparing to discover followers...');

    // Create a temporary pool for this query
    const pool = new SimplePool();

    try {
      // Get relay URLs based on selected source
      const relayUrls = await this.getRelayUrlsForDiscovery();
      this.logger.debug(`Using ${relayUrls.length} relays for follower discovery`);

      if (relayUrls.length === 0) {
        this.followerDiscoveryStatus.set('No relays available');
        this.followerDiscoveryLoading.set(false);
        return;
      }

      this.followerDiscoveryStatus.set(`Querying ${relayUrls.length} relays for kind 3 events...`);
      this.followerDiscoveryProgress.set(10);

      // Query for kind 3 (contact list) events that include this user's pubkey in p-tags
      // The authors of these events are the users who follow the current user
      // Use pagination to fetch all followers beyond the 500 event limit
      const allEvents: Event[] = [];
      const followerDataMap = new Map<string, { pubkey: string; followListUpdated: number }>();
      let until: number | undefined = undefined;
      let hasMore = true;
      let pageCount = 0;
      const maxPages = 20; // Safety limit to prevent infinite loops

      while (hasMore && pageCount < maxPages) {
        const filter = {
          kinds: [kinds.Contacts],
          '#p': [pubkey],
          limit: 500,
          ...(until !== undefined && { until }),
        };

        this.logger.debug(`Fetching page ${pageCount + 1}, until: ${until}`);
        const events = await pool.querySync(relayUrls, filter);

        if (events.length === 0) {
          hasMore = false;
          break;
        }

        allEvents.push(...events);

        // Extract unique follower pubkeys with their follow list update timestamp
        for (const event of events) {
          if (event.pubkey !== pubkey) { // Don't include self
            // Keep the most recent follow list update for each follower
            const existing = followerDataMap.get(event.pubkey);
            if (!existing || event.created_at > existing.followListUpdated) {
              followerDataMap.set(event.pubkey, {
                pubkey: event.pubkey,
                followListUpdated: event.created_at,
              });
            }
          }
        }

        // Update progress (each page is worth 5% progress, up to 60%)
        const progressIncrement = Math.min(5, (60 - 10) / maxPages);
        this.followerDiscoveryProgress.update(p => Math.min(60, p + progressIncrement));
        this.followerDiscoveryStatus.set(
          `Found ${followerDataMap.size} unique followers across ${pageCount + 1} page(s)...`
        );

        // Check if we got fewer events than the limit (no more pages)
        if (events.length < 500) {
          hasMore = false;
        } else {
          // Get the oldest event's timestamp for the next page
          const oldestEvent = events.reduce((oldest, event) =>
            event.created_at < oldest.created_at ? event : oldest
          );
          until = oldestEvent.created_at;
        }

        pageCount++;
      }

      this.followerDiscoveryProgress.set(60);
      this.followerDiscoveryStatus.set(
        `Found ${followerDataMap.size} unique followers, checking following status...`
      );

      // Check which followers we're already following
      const currentFollowing = this.accountState.followingList();
      const followingSet = new Set(currentFollowing);

      const discoveredFollowers: DiscoveredFollower[] = Array.from(followerDataMap.values()).map(
        followerData => ({
          pubkey: followerData.pubkey,
          isFollowing: followingSet.has(followerData.pubkey),
          discoveredAt: Math.floor(Date.now() / 1000),
          followListUpdated: followerData.followListUpdated,
        })
      );

      this.followerDiscoveryProgress.set(80);
      this.followerDiscoveryStatus.set('Sorting results...');

      // Sort by two-tier logic:
      // 1. Non-following users first (potential new connections)
      // 2. Within each group, sort by most recent follow list update
      discoveredFollowers.sort((a, b) => {
        if (a.isFollowing !== b.isFollowing) {
          return a.isFollowing ? 1 : -1;
        }
        // Within the same following status, sort by most recent update
        return b.followListUpdated - a.followListUpdated;
      });

      this.discoveredFollowers.set(discoveredFollowers);
      this.saveFollowerDiscoveryCache();

      this.followerDiscoveryProgress.set(100);
      this.followerDiscoveryStatus.set(
        `Discovered ${discoveredFollowers.length} followers (${discoveredFollowers.filter(f => !f.isFollowing).length} new)`
      );

      this.logger.info(
        `Follower discovery complete: ${discoveredFollowers.length} followers found across ${pageCount} page(s)`
      );
    } catch (error) {
      this.logger.error('Failed to discover followers', error);
      this.followerDiscoveryStatus.set('Failed to discover followers');
    } finally {
      // Always close the pool to prevent resource leaks
      try {
        const relayUrls = await this.getRelayUrlsForDiscovery();
        pool.close(relayUrls);
      } catch (closeError) {
        this.logger.debug('Error closing pool:', closeError);
      }
      this.followerDiscoveryLoading.set(false);
    }
  }

  /**
   * Get relay URLs based on the selected relay source
   */
  private async getRelayUrlsForDiscovery(): Promise<string[]> {
    const relaySource = this.selectedRelaySource();

    switch (relaySource) {
      case 'account':
        // Use account relays
        return this.accountRelay.getRelayUrls();

      case 'custom':
        // Use custom relays
        return this.customRelays();

      case 'deep':
        // Use deep discovery - get relays from all observed relays
        return await this.getDeepDiscoveryRelays();

      default:
        return this.accountRelay.getRelayUrls();
    }
  }

  /**
   * Get relays for deep discovery mode by combining account relays and discovery relays
   */
  private async getDeepDiscoveryRelays(): Promise<string[]> {
    const relaySet = new Set<string>();

    // Add account relays
    const accountRelays = this.accountRelay.getRelayUrls();
    accountRelays.forEach(url => relaySet.add(url));

    // Add discovery relays
    const discoveryRelays = this.discoveryRelay.getRelayUrls();
    discoveryRelays.forEach(url => relaySet.add(url));

    // Could also add relays from followed users here if needed
    // For now, we'll just use account + discovery relays

    return Array.from(relaySet);
  }

  /**
   * Add a custom relay URL
   */
  addCustomRelay(): void {
    const relayUrl = this.customRelayInput().trim();
    if (!relayUrl) {
      this.customRelayError.set('Please enter a relay URL');
      return;
    }

    // Basic validation
    if (!relayUrl.startsWith('wss://') && !relayUrl.startsWith('ws://')) {
      this.customRelayError.set('Invalid relay URL. Must start with wss:// or ws://');
      this.logger.warn('Invalid relay URL, must start with wss:// or ws://');
      return;
    }

    // Check if already added
    const currentRelays = this.customRelays();
    if (currentRelays.includes(relayUrl)) {
      this.customRelayError.set('This relay has already been added');
      this.logger.debug('Relay already added');
      return;
    }

    // Add to list
    this.customRelays.update(relays => [...relays, relayUrl]);
    this.customRelayInput.set('');
    this.customRelayError.set(''); // Clear error on success
    this.logger.debug(`Added custom relay: ${relayUrl}`);
  }

  /**
   * Remove a custom relay URL
   */
  removeCustomRelay(relayUrl: string): void {
    this.customRelays.update(relays => relays.filter(r => r !== relayUrl));
    this.logger.debug(`Removed custom relay: ${relayUrl}`);
  }

  /**
   * Handle relay source change
   */
  onRelaySourceChange(source: RelaySource): void {
    this.selectedRelaySource.set(source);
    this.logger.debug(`Relay source changed to: ${source}`);
  }
}
