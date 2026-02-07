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
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { EventComponent } from '../../../components/event/event.component';
import { LoggerService } from '../../../services/logger.service';
import { RepostService } from '../../../services/repost.service';
import { SharedRelayService } from '../../../services/relays/shared-relay';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { DatabaseService } from '../../../services/database.service';
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
    MatProgressSpinnerModule,
    EventComponent,
  ],
  template: `
    <div class="list-column">
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
  private repostService = inject(RepostService);
  private sharedRelayService = inject(SharedRelayService);
  private accountRelay = inject(AccountRelayService);
  private database = inject(DatabaseService);

  // Input for the list data
  listData = input<ListFeedData | null>(null);

  // Track the current list dTag to detect changes
  private currentListDTag = '';
  // Track previous mentionedMode to detect changes
  private previousMentionedMode = false;

  private loadMoreTriggerElement?: HTMLDivElement;

  @ViewChild('loadMoreTrigger')
  set loadMoreTrigger(element: ElementRef<HTMLDivElement> | undefined) {
    if (element?.nativeElement) {
      this.loadMoreTriggerElement = element.nativeElement;
      this.observeLoadMoreTrigger();
    }
  }

  // Filter inputs from parent
  showReplies = input(false);
  showReposts = input(true);

  // Mentioned mode: when true, query for events where list members are mentioned (#p tag)
  // instead of events authored by list members
  mentionedMode = input(false);

  // Kinds to filter by (from parent filter panel)
  filterKinds = input<number[]>([]);

  // State
  isLoading = signal(false);
  isRefreshing = signal(false);
  isLoadingMore = signal(false);
  isLoadingFromRelays = signal(false);
  error = signal<string | null>(null);

  // Events
  private allEvents = signal<Event[]>([]);
  private displayCount = signal(PAGE_SIZE);
  private intersectionObserver?: IntersectionObserver;

  // Filtered events based on settings
  private filteredEvents = computed(() => {
    const events = this.allEvents();
    const showReplies = this.showReplies();
    const showReposts = this.showReposts();
    const filterKinds = this.filterKinds();

    return events.filter(event => {
      // Filter by kinds if specified
      if (filterKinds.length > 0 && !filterKinds.includes(event.kind)) {
        return false;
      }

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
    // Load events when list data or mentionedMode changes
    effect(() => {
      const data = this.listData();
      const mentioned = this.mentionedMode();
      if (data && data.pubkeys.length > 0) {
        // Check if this is a different list or mode changed
        if (this.currentListDTag !== data.dTag || this.previousMentionedMode !== mentioned) {
          // Clear existing events immediately when switching lists or modes
          this.allEvents.set([]);
          this.displayCount.set(PAGE_SIZE);
          this.currentListDTag = data.dTag;
          this.previousMentionedMode = mentioned;
        }
        this.loadEventsFromList(data, mentioned);
      } else {
        this.allEvents.set([]);
        this.displayCount.set(PAGE_SIZE);
        this.currentListDTag = '';
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
   * Load events from users in the list
   * First loads from local database for instant display, then fetches from relays
   * @param mentioned When true, query for events mentioning the pubkeys (#p tag) instead of authored by them
   */
  private async loadEventsFromList(data: ListFeedData, mentioned: boolean): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    const { pubkeys } = data;
    const modeLabel = mentioned ? 'mentioned by' : 'authored by';
    this.logger.info(`[ListColumn] Loading events ${modeLabel} ${pubkeys.length} users from list "${data.title}"`);

    try {
      if (mentioned) {
        // Mentioned mode: query account relays for events with #p tags
        // No local database query since we index by author, not by tags
        this.isLoadingFromRelays.set(true);
        try {
          await this.loadMentionedEventsFromRelays(pubkeys);
        } finally {
          this.isLoadingFromRelays.set(false);
        }
      } else {
        // Authored mode (default): query by author pubkeys
        // Step 1: Load cached events from database immediately
        const cachedEvents = await this.loadEventsFromDatabase(pubkeys);
        if (cachedEvents.length > 0) {
          this.logger.info(`[ListColumn] Loaded ${cachedEvents.length} cached events from database`);
          this.updateEventsState(cachedEvents);
        }

        // Step 2: Fetch fresh events from relays in the background
        this.isLoadingFromRelays.set(true);
        try {
          await this.loadEventsFromRelays(pubkeys, cachedEvents);
        } finally {
          this.isLoadingFromRelays.set(false);
        }
      }
    } catch (err) {
      this.logger.error('[ListColumn] Error loading events:', err);
      this.error.set('Failed to load events from list');
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Load events from local database for the given pubkeys
   */
  private async loadEventsFromDatabase(pubkeys: string[]): Promise<Event[]> {
    const allCachedEvents: Event[] = [];

    // Query database for each kind we're interested in
    const kinds = [1, 6, 30023]; // Notes, reposts, articles

    for (const kind of kinds) {
      try {
        const events = await this.database.getEventsByPubkeyAndKind(pubkeys, kind);
        allCachedEvents.push(...events);
      } catch (err) {
        this.logger.debug(`[ListColumn] Failed to load kind ${kind} from database:`, err);
      }
    }

    return allCachedEvents;
  }

  /**
   * Fetch events from relays using the outbox model
   */
  private async loadEventsFromRelays(pubkeys: string[], existingEvents: Event[]): Promise<void> {
    const allLoadedEvents: Event[] = [...existingEvents];
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
  }

  /**
   * Fetch events from account relays where pubkeys are mentioned (#p tag)
   * Unlike authored mode, we can't use the outbox model here since we don't know
   * who authored the events. Instead, we query account relays with #p tag filters.
   * Pubkeys are batched to avoid creating overly large filters.
   */
  private async loadMentionedEventsFromRelays(pubkeys: string[]): Promise<void> {
    const allLoadedEvents: Event[] = [];
    const kinds = [1, 6, 30023]; // Notes, reposts, articles
    const batchSize = 10;

    for (let i = 0; i < pubkeys.length; i += batchSize) {
      const batch = pubkeys.slice(i, i + batchSize);

      try {
        const events = await this.accountRelay.getMany({
          kinds,
          '#p': batch,
          limit: batch.length * 15,
        }, { timeout: 8000 });

        allLoadedEvents.push(...events);
      } catch (err) {
        this.logger.debug(`[ListColumn] Failed to fetch mentioned events for batch ${i / batchSize}:`, err);
      }

      // Update UI incrementally after each batch
      this.updateEventsState(allLoadedEvents);
    }

    this.logger.info(`[ListColumn] Loaded ${allLoadedEvents.length} total mentioned events from list`);
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
      await this.loadEventsFromList(data, this.mentionedMode());
    } finally {
      this.isRefreshing.set(false);
    }
  }

  loadMore(): void {
    this.displayCount.update(count => count + PAGE_SIZE);
  }
}
