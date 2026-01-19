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
import { EventComponent } from '../../../components/event/event.component';
import { LoggerService } from '../../../services/logger.service';

export type TrendingOrder = 'replies' | 'reposts' | 'reactions' | 'zap_count' | 'zap_amount';
export type TrendingHours = 1 | 4 | 12 | 24 | 48;

interface TrendingApiResponse {
  event_id: string;
  reactions: number;
  replies: number;
  reposts: number;
  zap_amount: number;
  zap_count: number;
}

const PAGE_SIZE = 5;

// Relays that aggregate trending content - used to fetch events from the trending API
const TRENDING_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
];

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

  private loadMoreTriggerElement?: HTMLDivElement;

  @ViewChild('loadMoreTrigger')
  set loadMoreTrigger(element: ElementRef<HTMLDivElement> | undefined) {
    if (element?.nativeElement) {
      this.loadMoreTriggerElement = element.nativeElement;
      this.observeLoadMoreTrigger();
    }
  }

  // Configuration options
  selectedHours = signal<TrendingHours>(4);
  selectedOrder = signal<TrendingOrder>('replies');

  // State
  isLoading = signal(false);
  isRefreshing = signal(false);
  error = signal<string | null>(null);

  // All event IDs from the API
  private allEventIds = signal<string[]>([]);

  // How many IDs to display
  private displayCount = signal(PAGE_SIZE);

  // Options for dropdowns
  hoursOptions: { value: TrendingHours; label: string }[] = [
    { value: 1, label: '1 hour' },
    { value: 4, label: '4 hours' },
    { value: 12, label: '12 hours' },
    { value: 24, label: '24 hours' },
    { value: 48, label: '48 hours' },
  ];

  orderOptions: { value: TrendingOrder; label: string }[] = [
    { value: 'replies', label: 'Replies count' },
    { value: 'reposts', label: 'Reposts count' },
    { value: 'reactions', label: 'Reactions count' },
    { value: 'zap_count', label: 'Zap count' },
    { value: 'zap_amount', label: 'Zap amount' },
  ];

  // Computed signals
  displayedEventIds = computed(() => this.allEventIds().slice(0, this.displayCount()));
  hasEvents = computed(() => this.displayedEventIds().length > 0);
  hasMore = computed(() => this.displayCount() < this.allEventIds().length);

  // Expose trending relays for the template to pass to EventComponent
  readonly trendingRelays = TRENDING_RELAYS;

  private abortController: AbortController | null = null;
  private intersectionObserver?: IntersectionObserver;

  constructor() {
    // Load trending data on init
    effect(() => {
      // Re-fetch when hours or order changes
      const hours = this.selectedHours();
      const order = this.selectedOrder();
      this.fetchTrendingData(hours, order);
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

  async fetchTrendingData(hours: TrendingHours, order: TrendingOrder): Promise<void> {
    // Cancel any previous request
    this.abortController?.abort();
    this.abortController = new AbortController();

    this.isLoading.set(true);
    this.error.set(null);
    this.displayCount.set(PAGE_SIZE);

    try {
      const url = `https://api.nostr.wine/trending?order=${order}&hours=${hours}&limit=200`;
      const response = await fetch(url, {
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: TrendingApiResponse[] = await response.json();
      this.allEventIds.set(data.map(item => item.event_id));
      this.logger.debug(`Got ${data.length} trending event IDs`);
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

  loadMore(): void {
    if (!this.hasMore()) {
      return;
    }
    this.displayCount.update(count => count + PAGE_SIZE);
    this.logger.debug(`Showing ${this.displayCount()} of ${this.allEventIds().length} trending events`);
  }

  refresh(): void {
    this.isRefreshing.set(true);
    this.fetchTrendingData(this.selectedHours(), this.selectedOrder());
  }

  onHoursChange(hours: TrendingHours): void {
    this.selectedHours.set(hours);
  }

  onOrderChange(order: TrendingOrder): void {
    this.selectedOrder.set(order);
  }
}
