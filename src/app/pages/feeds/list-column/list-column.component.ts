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
  input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EventComponent } from '../../../components/event/event.component';
import { LoggerService } from '../../../services/logger.service';
import { AccountStateService } from '../../../services/account-state.service';
import { RepostService } from '../../../services/repost.service';
import { EventProcessorService } from '../../../services/event-processor.service';
import { SharedRelayService } from '../../../services/relays/shared-relay';
import { Event } from 'nostr-tools';

const PAGE_SIZE = 10;

export interface ListFeedData {
  dTag: string;
  title: string;
  pubkeys: string[];
}

@Component({
  selector: 'app-list-column',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    EventComponent,
  ],
  template: `
    <div class="list-column">
      <!-- Header -->
      <div class="list-header">
        <div class="header-info">
          <mat-icon>people</mat-icon>
          <div class="header-text">
            <span class="list-name">{{ listData()?.title || 'List Feed' }}</span>
            <span class="list-count">{{ listData()?.pubkeys?.length || 0 }} people</span>
          </div>
        </div>
        <div class="header-actions">
          <button mat-icon-button (click)="refresh()" matTooltip="Refresh" [disabled]="isRefreshing()">
            <mat-icon [class.spinning]="isRefreshing()">refresh</mat-icon>
          </button>
          <button mat-icon-button [matMenuTriggerFor]="optionsMenu" matTooltip="Options">
            <mat-icon>more_vert</mat-icon>
          </button>
          <mat-menu #optionsMenu="matMenu">
            <button mat-menu-item (click)="toggleShowReplies()">
              <mat-icon>{{ showReplies() ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>
              <span>Show Replies</span>
            </button>
            <button mat-menu-item (click)="toggleShowReposts()">
              <mat-icon>{{ showReposts() ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>
              <span>Show Reposts</span>
            </button>
          </mat-menu>
          <button mat-icon-button (click)="onClose()" matTooltip="Close">
            <mat-icon>close</mat-icon>
          </button>
        </div>
      </div>

      <!-- Content -->
      <div class="list-content" #listContent>
        @if (isLoading() && displayedEvents().length === 0) {
          <!-- Loading skeleton -->
          <div class="list-skeleton-items">
            @for (item of [1, 2, 3, 4, 5]; track $index) {
              <div class="feed-item-skeleton">
                <div class="item-header-skeleton">
                  <div class="avatar-skeleton"></div>
                  <div class="user-info-skeleton">
                    <div class="username-skeleton"></div>
                    <div class="timestamp-skeleton"></div>
                  </div>
                </div>
                <div class="item-content-skeleton">
                  <div class="content-line-skeleton"></div>
                  <div class="content-line-skeleton"></div>
                  <div class="content-line-skeleton short"></div>
                </div>
                <div class="item-actions-skeleton">
                  <div class="action-skeleton"></div>
                  <div class="action-skeleton"></div>
                  <div class="action-skeleton"></div>
                  <div class="action-skeleton"></div>
                </div>
              </div>
            }
            <div class="skeleton-loading-indicator">
              <div class="loading-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <span class="loading-text">Loading posts from list...</span>
            </div>
          </div>
        } @else if (error()) {
          <div class="error-state">
            <mat-icon>error_outline</mat-icon>
            <span>{{ error() }}</span>
            <button mat-stroked-button (click)="refresh()">
              <mat-icon>refresh</mat-icon>
              Try Again
            </button>
          </div>
        } @else if (!hasEvents() && !isLoading()) {
          <div class="empty-state">
            <mat-icon>article</mat-icon>
            <span>No posts found</span>
            <span class="empty-hint">People in this list haven't posted recently</span>
          </div>
        } @else {
          <div class="list-events">
            @for (event of displayedEvents(); track event.id) {
              <app-event [event]="event" [inFeedsPanel]="true"></app-event>
            }

            @if (hasMore()) {
              <div class="load-more-section">
                <button mat-stroked-button (click)="loadMore()" [disabled]="isLoadingMore()">
                  @if (isLoadingMore()) {
                    <mat-spinner diameter="18"></mat-spinner>
                  } @else {
                    <mat-icon>expand_more</mat-icon>
                  }
                  <span>Load More</span>
                </button>
              </div>
            }

            <div #loadMoreTrigger class="load-more-trigger" aria-hidden="true"></div>
          </div>
        }
      </div>
    </div>
  `,
  styleUrl: './list-column.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListColumnComponent implements OnDestroy {
  private logger = inject(LoggerService);
  private accountState = inject(AccountStateService);
  private repostService = inject(RepostService);
  private eventProcessor = inject(EventProcessorService);
  private sharedRelayService = inject(SharedRelayService);

  // Input for the list data
  listData = input<ListFeedData | null>(null);

  // Close event callback
  closeCallback = input<(() => void) | null>(null);

  private loadMoreTriggerElement?: HTMLDivElement;

  @ViewChild('loadMoreTrigger')
  set loadMoreTrigger(element: ElementRef<HTMLDivElement> | undefined) {
    if (element?.nativeElement) {
      this.loadMoreTriggerElement = element.nativeElement;
      this.observeLoadMoreTrigger();
    }
  }

  // State
  isLoading = signal(false);
  isRefreshing = signal(false);
  isLoadingMore = signal(false);
  error = signal<string | null>(null);
  showReplies = signal(false);
  showReposts = signal(true);

  // Events
  private allEvents = signal<Event[]>([]);
  private displayCount = signal(PAGE_SIZE);
  private intersectionObserver?: IntersectionObserver;

  // Filtered events based on settings
  private filteredEvents = computed(() => {
    const events = this.allEvents();
    const showReplies = this.showReplies();
    const showReposts = this.showReposts();

    return events.filter(event => {
      // Check if it's a repost
      const isRepost = this.repostService.isRepostEvent(event);

      if (isRepost) {
        return showReposts;
      }

      // For non-repost events, filter based on showReplies
      if (!showReplies) {
        const hasReplyTag = event.tags.some(tag => tag[0] === 'e');
        return !hasReplyTag;
      }

      return true;
    });
  });

  // Computed signals
  displayedEvents = computed(() => this.filteredEvents().slice(0, this.displayCount()));
  hasEvents = computed(() => this.displayedEvents().length > 0);
  hasMore = computed(() => this.displayCount() < this.filteredEvents().length);

  constructor() {
    // Load events when list data changes
    effect(() => {
      const data = this.listData();
      if (data && data.pubkeys.length > 0) {
        this.loadEventsFromList(data);
      } else {
        this.allEvents.set([]);
        this.displayCount.set(PAGE_SIZE);
      }
    });
  }

  ngOnDestroy(): void {
    this.intersectionObserver?.disconnect();
  }

  private observeLoadMoreTrigger(): void {
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && this.hasMore() && !this.isLoadingMore()) {
          this.loadMore();
        }
      },
      { rootMargin: '200px' }
    );

    if (this.loadMoreTriggerElement) {
      this.intersectionObserver.observe(this.loadMoreTriggerElement);
    }
  }

  /**
   * Load events from users in the list using outbox model
   */
  private async loadEventsFromList(data: ListFeedData): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    const { pubkeys } = data;
    this.logger.info(`[ListColumn] Loading events for ${pubkeys.length} users from list "${data.title}"`);

    try {
      const allLoadedEvents: Event[] = [];
      const eventsPerUser = 15;

      // Process users in parallel batches to avoid overwhelming relays
      const batchSize = 10;
      for (let i = 0; i < pubkeys.length; i += batchSize) {
        const batch = pubkeys.slice(i, i + batchSize);

        const batchPromises = batch.map(async (pubkey) => {
          try {
            const events = await this.sharedRelayService.getMany(pubkey, {
              authors: [pubkey],
              kinds: [1, 6, 30023], // Notes, reposts, articles
              limit: eventsPerUser,
            }, { timeout: 5000 });

            return events;
          } catch (err) {
            this.logger.debug(`[ListColumn] Failed to fetch events for ${pubkey.slice(0, 8)}:`, err);
            return [];
          }
        });

        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach(events => {
          allLoadedEvents.push(...events);
        });

        // Update UI incrementally after each batch
        this.updateEventsState(allLoadedEvents);
      }

      this.logger.info(`[ListColumn] Loaded ${allLoadedEvents.length} total events from list`);
    } catch (err) {
      this.logger.error('[ListColumn] Error loading events:', err);
      this.error.set('Failed to load events from list');
    } finally {
      this.isLoading.set(false);
    }
  }

  private updateEventsState(events: Event[]): void {
    // Sort by created_at descending and deduplicate by event ID
    const seen = new Set<string>();
    const uniqueEvents = events
      .filter(event => {
        if (seen.has(event.id)) return false;
        seen.add(event.id);
        return true;
      })
      .sort((a, b) => b.created_at - a.created_at);

    this.allEvents.set(uniqueEvents);
  }

  async refresh(): Promise<void> {
    const data = this.listData();
    if (!data) return;

    this.isRefreshing.set(true);
    this.displayCount.set(PAGE_SIZE);

    try {
      await this.loadEventsFromList(data);
    } finally {
      this.isRefreshing.set(false);
    }
  }

  loadMore(): void {
    this.displayCount.update(count => count + PAGE_SIZE);
  }

  toggleShowReplies(): void {
    this.showReplies.update(v => !v);
  }

  toggleShowReposts(): void {
    this.showReposts.update(v => !v);
  }

  onClose(): void {
    const callback = this.closeCallback();
    if (callback) {
      callback();
    }
  }
}
