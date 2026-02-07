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

  // Pagination cursor for mentioned mode (oldest event timestamp)
  private mentionedUntilCursor = signal<number | null>(null);
  // Whether more mentioned events can potentially be fetched from relays
  private mentionedHasMore = signal(true);
  // Guard against concurrent relay fetches
  private isFetchingMoreMentioned = false;
  // Count consecutive fetches that returned no new events, to stop pagination
  private mentionedEmptyFetchCount = 0;

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
  // In mentioned mode, we can always fetch more from relays until the relay returns nothing.
  // In authored mode, we only paginate through the locally-loaded set.
  hasMore = computed(() => {
    const localHasMore = this.displayCount() < this.filteredEvents().length;
    if (localHasMore) return true;
    // In mentioned mode, there may be older events on the relay
    if (this.mentionedMode() && this.mentionedHasMore()) return true;
    return false;
  });

  constructor() {
    // Load events when list data or mentionedMode changes.
    // IMPORTANT: Only call loadEventsFromList when the list or mode actually changed.
    // Without this guard, signal writes inside loadEventsFromList (isLoading, allEvents, etc.)
    // could cause the effect to re-trigger in an infinite loop.
    effect(() => {
      const data = this.listData();
      const mentioned = this.mentionedMode();
      if (data && data.pubkeys.length > 0) {
        // Only load when the list or mode actually changed
        if (this.currentListDTag !== data.dTag || this.previousMentionedMode !== mentioned) {
          // Clear existing events immediately when switching lists or modes
          this.allEvents.set([]);
          this.displayCount.set(PAGE_SIZE);
          this.mentionedUntilCursor.set(null);
          this.mentionedHasMore.set(true);
          this.isFetchingMoreMentioned = false;
          this.mentionedEmptyFetchCount = 0;
          this.currentListDTag = data.dTag;
          this.previousMentionedMode = mentioned;
          this.loadEventsFromList(data, mentioned);
        }
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
          const count = await this.loadMentionedEventsFromRelays(pubkeys);
          if (count === 0) {
            this.mentionedHasMore.set(false);
          }
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
   *
   * @param until Optional cursor: only fetch events older than this timestamp
   * @returns The number of new (previously unseen) events fetched
   */
  private async loadMentionedEventsFromRelays(pubkeys: string[], until?: number): Promise<number> {
    const existingIds = new Set(this.allEvents().map(e => e.id));
    const allLoadedEvents: Event[] = [...this.allEvents()];
    const kinds = [1, 6, 30023]; // Notes, reposts, articles
    const batchSize = 10;
    let newEventCount = 0;
    // Track the oldest timestamp from THIS fetch (not the global pool)
    // to advance the cursor even when all events are duplicates.
    let oldestInThisFetch: number | null = null;

    for (let i = 0; i < pubkeys.length; i += batchSize) {
      const batch = pubkeys.slice(i, i + batchSize);

      try {
        const filter: Record<string, unknown> = {
          kinds,
          '#p': batch,
          limit: batch.length * 15,
        };
        if (until !== undefined) {
          filter['until'] = until - 1; // exclusive: fetch strictly older
        }

        const events = await this.accountRelay.getMany(filter as any, { timeout: 8000 });

        for (const event of events) {
          // Track oldest from this fetch regardless of duplication
          if (oldestInThisFetch === null || event.created_at < oldestInThisFetch) {
            oldestInThisFetch = event.created_at;
          }

          if (!existingIds.has(event.id)) {
            existingIds.add(event.id);
            allLoadedEvents.push(event);
            newEventCount++;
          }
        }
      } catch (err) {
        this.logger.debug(`[ListColumn] Failed to fetch mentioned events for batch ${i / batchSize}:`, err);
      }

      // Update UI incrementally after each batch
      this.updateEventsState(allLoadedEvents);
    }

    // Advance the cursor based on what the relay returned in THIS fetch,
    // so the next page query skips past these events even if they were all duplicates.
    if (oldestInThisFetch !== null) {
      this.mentionedUntilCursor.set(oldestInThisFetch);
    }

    this.logger.info(`[ListColumn] Loaded ${newEventCount} new mentioned events (${allLoadedEvents.length} total)`);
    return newEventCount;
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
    const localHasMore = this.displayCount() < this.filteredEvents().length;

    if (localHasMore) {
      // Still have locally loaded events to show
      this.displayCount.update(count => count + PAGE_SIZE);
    } else if (this.mentionedMode() && this.mentionedHasMore() && !this.isFetchingMoreMentioned) {
      // In mentioned mode with all local events displayed — fetch the next page from relays
      this.fetchNextMentionedPage();
    }
  }

  /**
   * Fetch the next page of mentioned events using time-based cursor pagination.
   * Uses the oldest event's timestamp as the `until` parameter.
   * After fetching, shows all loaded events and re-checks if the scroll trigger
   * is still visible to chain further fetches for continuous scrolling.
   */
  private async fetchNextMentionedPage(): Promise<void> {
    const data = this.listData();
    if (!data || data.pubkeys.length === 0) return;

    this.isFetchingMoreMentioned = true;
    this.isLoadingMore.set(true);

    try {
      const cursor = this.mentionedUntilCursor();
      const newEvents = await this.loadMentionedEventsFromRelays(data.pubkeys, cursor ?? undefined);

      if (newEvents === 0) {
        this.mentionedEmptyFetchCount++;
        // Stop if the relay returned nothing, or if we've had 3 consecutive
        // fetches with no new unique events (all duplicates / cursor not advancing)
        if (this.mentionedEmptyFetchCount >= 3) {
          this.mentionedHasMore.set(false);
        }
      } else {
        this.mentionedEmptyFetchCount = 0;
        // Show all loaded events (they were just fetched on demand, no reason to hide them)
        this.displayCount.set(this.filteredEvents().length);
      }
    } catch (err) {
      this.logger.error('[ListColumn] Error fetching next mentioned page:', err);
    } finally {
      this.isLoadingMore.set(false);
      this.isFetchingMoreMentioned = false;

      // The IntersectionObserver won't re-fire if the trigger element stayed in the
      // viewport during the async fetch. Manually check and chain another fetch.
      this.checkLoadMoreTriggerVisibility();
    }
  }

  /**
   * Manually check if the load-more trigger element is currently visible in the viewport.
   * If it is and we still have more to load, trigger another loadMore() call.
   * This bridges the gap where the IntersectionObserver won't re-fire because the
   * trigger element never left/re-entered the viewport during an async fetch.
   */
  private checkLoadMoreTriggerVisibility(): void {
    if (!this.loadMoreTriggerElement || !this.hasMore() || this.isLoadingMore()) return;

    const rect = this.loadMoreTriggerElement.getBoundingClientRect();
    const viewportHeight = window.innerHeight;

    // Check if the trigger is within the viewport + 200px margin (matching the observer's rootMargin)
    if (rect.top < viewportHeight + 200) {
      this.loadMore();
    }
  }
}
