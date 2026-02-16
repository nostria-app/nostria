import {
  Component,
  inject,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
  OnDestroy,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { Event } from 'nostr-tools';
import { EventComponent } from '../../../components/event/event.component';
import { LoggerService } from '../../../services/logger.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { AccountStateService } from '../../../services/account-state.service';
import { FollowSetsService } from '../../../services/follow-sets.service';
import { DatabaseService } from '../../../services/database.service';
import { ZapService } from '../../../services/zap.service';

export type TrendingOrder = 'replies' | 'reposts' | 'reactions' | 'zap_count' | 'zap_amount';
export type TrendingHours = 1 | 4 | 12 | 24 | 48;
export type TrendingSource = 'network' | 'cached';

interface TrendingApiResponse {
  event_id: string;
  reactions: number;
  replies: number;
  reposts: number;
  zap_amount: number;
  zap_count: number;
}

const PAGE_SIZE = 5;
const MAX_TRENDING_EVENTS = 200;
const MAX_CANDIDATE_NOTES = 1500;

interface TrendingMetric {
  replies: number;
  reposts: number;
  reactions: number;
  zap_count: number;
  zap_amount: number;
}

interface SelectOption<T extends string | number> {
  value: T;
  label: string;
}

@Component({
  selector: 'app-trending-column',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatFormFieldModule,
    MatTooltipModule,
    FormsModule,
    EventComponent,
  ],
  templateUrl: './trending-column.component.html',
  styleUrl: './trending-column.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrendingColumnComponent implements OnDestroy {
  private logger = inject(LoggerService);
  private utilities = inject(UtilitiesService);
  private accountState = inject(AccountStateService);
  private followSets = inject(FollowSetsService);
  private database = inject(DatabaseService);
  private zapService = inject(ZapService);

  private loadMoreTriggerElement?: HTMLDivElement;

  @ViewChild('loadMoreTrigger')
  set loadMoreTrigger(element: ElementRef<HTMLDivElement> | undefined) {
    if (element?.nativeElement) {
      this.loadMoreTriggerElement = element.nativeElement;
      this.observeLoadMoreTrigger();
    }
  }

  // Configuration options
  selectedSource = signal<TrendingSource>('network');
  selectedHours = signal<TrendingHours>(4);
  selectedOrder = signal<TrendingOrder>('replies');
  selectedList = signal<string>('following');

  // State
  isLoading = signal(false);
  isRefreshing = signal(false);
  error = signal<string | null>(null);

  // All event IDs from the API
  private allEventIds = signal<string[]>([]);

  // How many IDs to display
  private displayCount = signal(PAGE_SIZE);

  sourceOptions: SelectOption<TrendingSource>[] = [
    { value: 'network', label: 'Global (network)' },
    { value: 'cached', label: 'Personal (cached)' },
  ];

  // Options for dropdowns
  hoursOptions: { value: TrendingHours; label: string }[] = [
    { value: 1, label: '1 hour' },
    { value: 4, label: '4 hours' },
    { value: 12, label: '12 hours' },
    { value: 24, label: '24 hours' },
    { value: 48, label: '48 hours' },
  ];

  orderOptions: { value: TrendingOrder; label: string }[] = [
    { value: 'replies', label: 'Most comments' },
    { value: 'reposts', label: 'Most reposts' },
    { value: 'reactions', label: 'Most likes' },
    { value: 'zap_count', label: 'Most zaps' },
    { value: 'zap_amount', label: 'Most zap sats' },
  ];

  listOptions = computed<SelectOption<string>[]>(() => {
    const options: SelectOption<string>[] = [{ value: 'all', label: 'All cached notes' }];
    const followingCount = this.accountState.followingList().length;

    options.push({ value: 'following', label: `Following (${followingCount})` });

    for (const followSet of this.followSets.followSets()) {
      options.push({ value: `followset:${followSet.dTag}`, label: followSet.title });
    }

    return options;
  });

  // Computed signals
  displayedEventIds = computed(() => this.allEventIds().slice(0, this.displayCount()));
  hasEvents = computed(() => this.displayedEventIds().length > 0);
  hasMore = computed(() => this.displayCount() < this.allEventIds().length);

  // Expose anonymous relays for the template to pass to EventComponent
  readonly trendingRelays = this.utilities.anonymousRelays;

  private abortController: AbortController | null = null;
  private intersectionObserver?: IntersectionObserver;

  constructor() {
    // Load trending data on init
    effect(() => {
      // Re-fetch when hours or order changes
      const source = this.selectedSource();
      const hours = this.selectedHours();
      const order = this.selectedOrder();
      const list = this.selectedList();
      this.fetchTrendingData(source, hours, order, list);
    });

    effect(() => {
      const options = this.listOptions().map(option => option.value);
      const selectedList = this.selectedList();

      if (!options.includes(selectedList)) {
        this.selectedList.set(options.includes('following') ? 'following' : 'all');
      }
    });

    this.setupIntersectionObserver();
  }

  ngOnDestroy(): void {
    this.abortController?.abort();
    this.intersectionObserver?.disconnect();
  }

  private setupIntersectionObserver(): void {
    const options: IntersectionObserverInit = {
      root: null,
      rootMargin: '200px',
      threshold: 0.01,
    };

    this.intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && this.hasMore()) {
          this.loadMore();
        }
      });
    }, options);
  }

  private observeLoadMoreTrigger(): void {
    if (this.intersectionObserver && this.loadMoreTriggerElement) {
      this.intersectionObserver.observe(this.loadMoreTriggerElement);
    }
  }

  async fetchTrendingData(
    source: TrendingSource,
    hours: TrendingHours,
    order: TrendingOrder,
    selectedList: string
  ): Promise<void> {
    // Cancel any previous request
    this.abortController?.abort();
    this.abortController = new AbortController();

    this.isLoading.set(true);
    this.error.set(null);
    this.displayCount.set(PAGE_SIZE);

    try {
      if (source === 'cached') {
        await this.fetchCachedTrendingData(hours, order, selectedList);
      } else {
        await this.fetchNetworkTrendingData(hours, order);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      this.logger.error('Error fetching trending data:', err);
      this.error.set('Failed to load trending content');
    } finally {
      this.isLoading.set(false);
      this.isRefreshing.set(false);
    }
  }

  private async fetchNetworkTrendingData(hours: TrendingHours, order: TrendingOrder): Promise<void> {
    const url = `https://api.nostr.wine/trending?order=${order}&hours=${hours}&limit=${MAX_TRENDING_EVENTS}`;
    const response = await fetch(url, {
      signal: this.abortController?.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: TrendingApiResponse[] = await response.json();
    this.allEventIds.set(data.map(item => item.event_id));
    this.logger.debug(`Got ${data.length} trending event IDs from network API`);
  }

  private async fetchCachedTrendingData(
    hours: TrendingHours,
    order: TrendingOrder,
    selectedList: string
  ): Promise<void> {
    await this.database.init();

    const accountPubkey = this.accountState.pubkey();
    const sinceTimestamp = Math.floor(Date.now() / 1000) - (hours * 60 * 60);
    const selectedPubkeys = this.resolveSelectedPubkeys(selectedList);

    const noteEvents = selectedPubkeys === null
      ? await this.database.getAllEventsByKindSince(accountPubkey, 1, sinceTimestamp)
      : selectedPubkeys.length > 0
        ? await this.database.getAllEventsByPubkeyKindSince(accountPubkey, selectedPubkeys, 1, sinceTimestamp)
        : [];

    const topLevelNotes = noteEvents
      .filter(event => !event.tags.some(tag => tag[0] === 'e'))
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, MAX_CANDIDATE_NOTES);

    if (topLevelNotes.length === 0) {
      this.allEventIds.set([]);
      this.logger.debug('No cached notes available for the selected list and time window');
      return;
    }

    const metrics = new Map<string, TrendingMetric>();
    const candidateIds = new Set<string>();

    for (const note of topLevelNotes) {
      candidateIds.add(note.id);
      metrics.set(note.id, {
        replies: 0,
        reposts: 0,
        reactions: 0,
        zap_count: 0,
        zap_amount: 0,
      });
    }

    const [reactionEvents, repostEvents, zapEvents, replyEvents] = await Promise.all([
      this.database.getAllEventsByKindSince(accountPubkey, 7, sinceTimestamp),
      this.database.getAllEventsByKindSince(accountPubkey, 6, sinceTimestamp),
      this.database.getAllEventsByKindSince(accountPubkey, 9735, sinceTimestamp),
      this.database.getAllEventsByKindSince(accountPubkey, 1, sinceTimestamp),
    ]);

    for (const reaction of reactionEvents) {
      const references = this.extractUniqueEventReferences(reaction);
      for (const eventId of references) {
        const metric = metrics.get(eventId);
        if (metric) {
          metric.reactions += 1;
        }
      }
    }

    for (const repost of repostEvents) {
      const references = this.extractUniqueEventReferences(repost);
      for (const eventId of references) {
        const metric = metrics.get(eventId);
        if (metric) {
          metric.reposts += 1;
        }
      }
    }

    for (const reply of replyEvents) {
      if (reply.id && candidateIds.has(reply.id)) {
        continue;
      }

      const references = this.extractUniqueEventReferences(reply);
      for (const eventId of references) {
        const metric = metrics.get(eventId);
        if (metric) {
          metric.replies += 1;
        }
      }
    }

    for (const zap of zapEvents) {
      const parsedZap = this.zapService.parseZapReceipt(zap);
      const references = this.extractUniqueEventReferences(zap);
      for (const eventId of references) {
        const metric = metrics.get(eventId);
        if (metric) {
          metric.zap_count += 1;
          metric.zap_amount += parsedZap.amount || 0;
        }
      }
    }

    const sortedIds = topLevelNotes
      .sort((a, b) => {
        const aMetric = metrics.get(a.id);
        const bMetric = metrics.get(b.id);
        const scoreDiff = this.getMetricValue(bMetric, order) - this.getMetricValue(aMetric, order);

        if (scoreDiff !== 0) {
          return scoreDiff;
        }

        return b.created_at - a.created_at;
      })
      .slice(0, MAX_TRENDING_EVENTS)
      .map(event => event.id);

    this.allEventIds.set(sortedIds);
    this.logger.debug(`Built ${sortedIds.length} cached trending events from ${topLevelNotes.length} candidate notes`);
  }

  private resolveSelectedPubkeys(selectedList: string): string[] | null {
    if (selectedList === 'all') {
      return null;
    }

    if (selectedList === 'following') {
      return this.accountState.followingList();
    }

    if (selectedList.startsWith('followset:')) {
      const dTag = selectedList.substring('followset:'.length);
      const followSet = this.followSets.getFollowSetByDTag(dTag);
      return followSet?.pubkeys || [];
    }

    return [];
  }

  private extractUniqueEventReferences(event: Event): string[] {
    const references = new Set<string>();

    for (const tag of event.tags) {
      if (tag[0] === 'e' && tag[1]) {
        references.add(tag[1]);
      }
    }

    return Array.from(references);
  }

  private getMetricValue(metric: TrendingMetric | undefined, order: TrendingOrder): number {
    if (!metric) {
      return 0;
    }

    return metric[order] || 0;
  }

  loadMore(): void {
    if (!this.hasMore()) {
      return;
    }
    this.displayCount.update(count => count + PAGE_SIZE);
    this.logger.debug(`Showing ${this.displayCount()} of ${this.allEventIds().length} trending events`);
  }

  refresh(): void {
    this.isRefreshing.set(true);
    this.fetchTrendingData(
      this.selectedSource(),
      this.selectedHours(),
      this.selectedOrder(),
      this.selectedList()
    );
  }

  onSourceChange(source: TrendingSource): void {
    this.selectedSource.set(source);
  }

  onListChange(list: string): void {
    this.selectedList.set(list);
  }

  onHoursChange(hours: TrendingHours): void {
    this.selectedHours.set(hours);
  }

  onOrderChange(order: TrendingOrder): void {
    this.selectedOrder.set(order);
  }
}
