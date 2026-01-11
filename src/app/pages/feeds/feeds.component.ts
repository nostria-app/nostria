import {
  Component,
  ViewChild,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  OnDestroy,
  ChangeDetectorRef,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Location } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatBadgeModule } from '@angular/material/badge';
import { NostrService } from '../../services/nostr.service';
import { NotificationService } from '../../services/notification.service';
import { LayoutService } from '../../services/layout.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { NewFeedDialogComponent } from './new-feed-dialog/new-feed-dialog.component';

import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import {
  ConfirmDialogComponent,
  ConfirmDialogData,
} from '../../components/confirm-dialog/confirm-dialog.component';
import { MediaPreviewDialogComponent } from '../../components/media-preview-dialog/media-preview.component';
import { LoggerService } from '../../services/logger.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FeedService, FeedConfig } from '../../services/feed.service';
import {
  FeedsCollectionService,
} from '../../services/feeds-collection.service';
import { RelayFeedsService } from '../../services/relay-feeds.service';
import { MediaItem, NostrRecord } from '../../interfaces';
import { Event } from 'nostr-tools';
import { UrlUpdateService } from '../../services/url-update.service';
import { MediaPlayerService } from '../../services/media-player.service';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApplicationService } from '../../services/application.service';
import { Introduction } from '../../components/introduction/introduction';
import { AccountStateService } from '../../services/account-state.service';
import { RepostService } from '../../services/repost.service';
import { EventComponent } from '../../components/event/event.component';
import { UtilitiesService } from '../../services/utilities.service';
import { ImagePlaceholderService } from '../../services/image-placeholder.service';
import { TrendingColumnComponent } from './trending-column/trending-column.component';
import { RelayColumnComponent } from './relay-column/relay-column.component';
import { RelayFeedMenuComponent } from './relay-feed-menu/relay-feed-menu.component';

// NavLink interface removed because it was unused.

@Component({
  selector: 'app-feeds',
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatChipsModule,
    MatMenuModule,
    MatTooltipModule,
    MatBadgeModule,
    DragDropModule,
    RouterModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    Introduction,
    EventComponent,
    NewFeedDialogComponent,
    TrendingColumnComponent,
    RelayColumnComponent,
    RelayFeedMenuComponent,
  ],
  templateUrl: './feeds.component.html',
  styleUrl: './feeds.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeedsComponent implements OnDestroy {
  // Services
  private nostrService = inject(NostrService);
  private notificationService = inject(NotificationService);
  private layoutService = inject(LayoutService);
  private localSettings = inject(LocalSettingsService);
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  feedService = inject(FeedService);
  feedsCollectionService = inject(FeedsCollectionService);
  private logger = inject(LoggerService);
  private url = inject(UrlUpdateService);
  private cdr = inject(ChangeDetectorRef);
  private mediaPlayerService = inject(MediaPlayerService);
  protected repostService = inject(RepostService);
  private snackBar = inject(MatSnackBar);
  protected app = inject(ApplicationService);
  protected accountState = inject(AccountStateService);
  private utilities = inject(UtilitiesService);
  private imagePlaceholder = inject(ImagePlaceholderService);
  private relayFeedsService = inject(RelayFeedsService);

  // Dialog State Signals
  showNewFeedDialog = signal(false);
  editingFeed = signal<import('../../services/feed.service').FeedConfig | undefined>(undefined);

  // Dialog icon options
  feedIcons = [
    'dynamic_feed',
    'bookmark',
    'explore',
    'trending_up',
    'star',
    'favorite',
    'rss_feed',
    'chat',
    'article',
    'image',
    'photo',
    'video_library',
    'music_note',
    'people',
    'group',
    'public',
    'tag',
    'local_fire_department',
    'bolt',
    'lightbulb',
    'science',
    'sports_esports',
    'sports_soccer',
    'restaurant',
    'coffee',
    'shopping_cart',
    'work',
    'home',
    'school',
    'flight',
    'directions_car',
    'palette',
    'pets',
    'spa',
    'nightlife',
    'celebration',
    'emoji_events',
    'military_tech',
  ];

  columnIcons = [
    'chat',
    'reply_all',
    'bookmark',
    'image',
    'people',
    'tag',
    'filter_list',
    'article',
    'video_library',
    'music_note',
    'photo',
    'explore',
    'trending_up',
    'group',
    'public',
  ];

  // UI State Signals
  activeSection = signal<'discover' | 'following' | 'media'>('discover');
  isLoading = signal(false);
  showAdvancedFilters = signal(false);
  selectedTags = signal<string[]>([]);
  screenWidth = signal(window.innerWidth);
  // Header visibility - hide when scrolling down, show when scrolling up
  headerHidden = signal(false);
  private lastScrollTop = 0;

  // Relay feed state - for showing public posts from a specific relay
  activeRelayDomain = signal<string>('');
  showRelayFeed = computed(() => !!this.activeRelayDomain());
  isSystemFeed = computed(() => {
    const feed = this.activeFeed();
    return feed?.isSystem ?? false;
  });
  @ViewChild('relayFeedMenu') relayFeedMenu?: RelayFeedMenuComponent;
  private queryParamsSubscription: import('rxjs').Subscription | null = null;

  // Horizontal scrollbar tracking
  hasHorizontalOverflow = signal(false);
  columnsScrollWidth = signal(0);
  columnsScrollLeft = signal(0);
  canScrollLeft = computed(() => this.columnsScrollLeft() > 0);
  canScrollRight = computed(() => {
    const scrollLeft = this.columnsScrollLeft();
    const scrollWidth = this.columnsScrollWidth();
    const clientWidth = this.columnsContainer?.nativeElement?.clientWidth || 0;
    return scrollLeft + clientWidth < scrollWidth - 1;
  });
  @ViewChild('columnsContainer') columnsContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('fixedScrollbar') fixedScrollbar!: ElementRef<HTMLDivElement>;
  private isSyncingScroll = false;

  columnLayout = computed(() => {
    const width = this.screenWidth();
    if (width >= 1600) {
      return 'three-columns-layout';
    } else if (width >= 1024) {
      return 'two-columns-layout';
    } else {
      return 'one-column-layout';
    }
  });

  isMobileView = computed(() => {
    const isMobile = this.screenWidth() < 1024;
    return isMobile;
  });

  // Calculate sidenav offset for fixed header positioning
  // On desktop, the sidenav pushes content, but fixed elements need manual offset
  sidenavOffset = computed(() => {
    // On mobile/handset, sidenav is in 'over' mode and doesn't need offset
    if (this.layoutService.isHandset()) {
      return 0;
    }
    // On desktop, check if sidenav is open
    if (!this.localSettings.menuOpen()) {
      return 0;
    }
    // Sidenav is open - return width based on expanded/collapsed state
    // 200px when expanded (displayLabels), 56px when collapsed
    return this.localSettings.menuExpanded() ? 200 : 56;
  });

  feedIcon = computed(() => {
    const activeFeed = this.activeFeed();
    return activeFeed ? activeFeed.icon : '';
  });

  feedLabel = computed(() => {
    const activeFeed = this.activeFeed();
    return activeFeed ? activeFeed.label : '';
  });

  // Track which feeds have loaded content
  columnContentLoaded = signal<Record<string, boolean>>({});

  // Computed signal to check if a feed has actual events to display
  feedHasEvents = computed(() => {
    const eventMap = new Map<string, boolean>();
    this.feeds().forEach(feed => {
      const events = this.columnEvents().get(feed.id);
      eventMap.set(feed.id, events !== undefined && events.length > 0);
    });
    return eventMap;
  });

  // Legacy column references - kept for backward compatibility
  // columns now maps directly to feeds since we merged the column concept with feeds
  columns = computed(() => this.feeds());

  // Content Signals
  trendingEvents = signal<NostrRecord[]>([]);
  followingEvents = signal<NostrRecord[]>([]);
  mediaEvents = signal<NostrRecord[]>([]);
  availableTags = signal<string[]>([
    'nostr',
    'bitcoin',
    'programming',
    'art',
    'music',
    'photography',
    'news',
    'sports',
  ]);

  // Video expansion state management
  videoExpandedStates = signal<Record<string, boolean>>({});

  // Computed Signals for Filtered Content
  filteredTrending = computed(() => {
    const tags = this.selectedTags();
    if (tags.length === 0) {
      return this.trendingEvents();
    } else {
      return this.trendingEvents().filter(event =>
        event.event.tags.some(tag => tag[0] === 't' && tags.includes(tag[1]))
      );
    }
  });

  filteredFollowing = computed(() => {
    const tags = this.selectedTags();
    if (tags.length === 0) {
      return this.followingEvents();
    } else {
      return this.followingEvents().filter(event =>
        event.event.tags.some(tag => tag[0] === 't' && tags.includes(tag[1]))
      );
    }
  });

  filteredMedia = computed(() => {
    const tags = this.selectedTags();
    if (tags.length === 0) {
      return this.mediaEvents();
    } else {
      return this.mediaEvents().filter(event =>
        event.event.tags.some(tag => tag[0] === 't' && tags.includes(tag[1]))
      );
    }
  });   // Computed signal to check if a column should show empty following message
  shouldShowEmptyFollowingMessage = computed(() => {
    const feedId = this.feedsCollectionService.activeFeedId();
    if (!feedId) return new Map<string, boolean>();

    const feedConfig = this.feedService.getFeedById(feedId);
    if (!feedConfig) return new Map<string, boolean>();

    const followingList = this.accountState.followingList();
    const followingListLoaded = this.accountState.followingListLoaded();
    const emptyColumnsMap = new Map<string, boolean>();

    // Check if feed source is 'following', following list has been loaded, and user has zero following
    // We only show the empty message after the following list has been loaded to avoid
    // showing it prematurely on slow connections
    if (feedConfig.source === 'following' || feedConfig.source === 'for-you') {
      emptyColumnsMap.set(
        feedConfig.id,
        feedConfig.source === 'following' && followingListLoaded && followingList.length === 0
      );
    }

    return emptyColumnsMap;
  });

  // Method to navigate to People discovery page
  navigateToPeople(): void {
    this.router.navigate(['/people/discover']);
  }

  // Drag state to prevent unnecessary re-renders during column reordering
  private isDragging = signal(false);

  // Cache to store events during drag operations
  private _eventCache = new Map<string, Event[]>();

  // Flag to track if we're processing a URL-based navigation (prevents URL sync loop)
  private isProcessingUrlNavigation = false;

  // Subscription for route params to prevent memory leaks
  private routeParamsSubscription: import('rxjs').Subscription | null = null;

  // Virtual list configuration
  INITIAL_RENDER_COUNT = 30;
  RENDER_BATCH_SIZE = 15;

  // Track rendered event counts per feed (virtual list)
  renderedEventCounts = signal<Record<string, number>>({});

  // Scroll detection for auto-loading more content
  lastLoadTime = 0;
  LOAD_MORE_COOLDOWN_MS = 1000;
  scrollCheckCleanup: (() => void) | null = null;

  /**
   * Helper method to filter events based on feed's showReplies and showReposts settings
   * Filters out reply events when showReplies is false
   * Filters out repost events when showReposts is false
   */
  private filterEventsByFeedSettings(events: Event[], feed: FeedConfig): Event[] {
    const showReplies = feed.showReplies ?? false;
    const showReposts = feed.showReposts ?? true; // Default to true for reposts

    return events.filter(event => {
      // Check if it's a repost (kind 6 or kind 16)
      const isRepost = this.repostService.isRepostEvent(event);

      // If it's a repost, filter based on showReposts setting
      if (isRepost) {
        return showReposts;
      }

      // For non-repost events, filter based on showReplies setting
      if (!showReplies) {
        return this.utilities.isRootPost(event);
      }

      return true;
    });
  }

  // Computed signal for ALL events (in-memory, not rendered)
  allColumnEvents = computed(() => {
    const feed = this.activeFeed();
    const isDragging = this.isDragging();
    const eventsMap = new Map<string, Event[]>();

    if (!feed) {
      console.log('[allColumnEvents] No active feed');
      return eventsMap;
    }

    // Get reactive feed data map from service
    const feedDataMap = this.feedService.feedDataReactive();

    let events: Event[];
    if (isDragging) {
      // During drag operations, use cached events to prevent DOM updates
      events = this._eventCache.get(feed.id) || [];
    } else {
      // Normal operation: get fresh events from reactive service
      const feedData = feedDataMap.get(feed.id);
      events = feedData?.events() || [];

      // Update cache for potential drag operations
      this._eventCache.set(feed.id, events);
    }

    const rawEventCount = events.length;

    // Filter based on feed showReplies and showReposts settings
    events = this.filterEventsByFeedSettings(events, feed);

    // Always log for debugging
    console.log(`[allColumnEvents] Feed "${feed.label}" (${feed.id}):`, {
      type: feed.type,
      source: feed.source,
      feedDataExists: feedDataMap.has(feed.id),
      rawEvents: rawEventCount,
      filteredEvents: events.length,
      showReplies: feed.showReplies,
      showReposts: feed.showReposts,
      isDragging
    });

    eventsMap.set(feed.id, events);

    return eventsMap;
  });

  // Computed signal for RENDERED events (virtual list - limited subset)
  columnEvents = computed(() => {
    const allEvents = this.allColumnEvents();
    const renderedCounts = this.renderedEventCounts();
    const eventsMap = new Map<string, Event[]>();

    allEvents.forEach((events, columnId) => {
      const renderCount = renderedCounts[columnId] || this.INITIAL_RENDER_COUNT;
      // Only render the first N events
      eventsMap.set(columnId, events.slice(0, renderCount));
    });

    return eventsMap;
  });

  // Helper method to get events for a specific column from the computed signal
  getEventsForColumn(columnId: string): Event[] {
    return this.columnEvents().get(columnId) || [];
  }

  // Get total event count for a column (for displaying "X of Y" info)
  getTotalEventCount(columnId: string): number {
    return this.allColumnEvents().get(columnId)?.length || 0;
  }

  // Get rendered event count for a column
  getRenderedEventCount(columnId: string): number {
    return this.columnEvents().get(columnId)?.length || 0;
  }

  // Check if there are more events to render in a column
  hasMoreEventsToRender(columnId: string): boolean {
    const total = this.getTotalEventCount(columnId);
    const rendered = this.getRenderedEventCount(columnId);
    return rendered < total;
  }

  // Load more events for rendering (virtual scroll)
  loadMoreRenderedEvents(columnId: string): void {
    this.renderedEventCounts.update(counts => {
      const currentCount = counts[columnId] || this.INITIAL_RENDER_COUNT;
      const newCount = currentCount + this.RENDER_BATCH_SIZE;
      return { ...counts, [columnId]: newCount };
    });
  }

  // Remove the old getEventsForColumn method
  // getEventsForColumn(columnId: string): Event[] {
  //   console.log(`Fetching events for column: ${columnId}`);
  //   console.log('Available feeds:', this.feedService.data.keys());
  //   return this.feedService.data.get(columnId)?.events() || [];
  // }  // Replace the old columns signal with columns from active feed
  feeds = computed(() => this.feedsCollectionService.feeds());
  activeFeed = computed(() => this.feedsCollectionService.activeFeed());

  // Check if the active feed is paused (no active subscription)
  isActiveFeedPaused = computed(() => {
    const feed = this.activeFeed();
    if (!feed) return false;

    const feedDataMap = this.feedService.feedDataReactive();
    const feedData = feedDataMap.get(feed.id);
    return feedData ? !feedData.subscription : false;
  });

  // Get pending events count for active feed
  activeFeedPendingCount = computed(() => {
    const feed = this.activeFeed();
    if (!feed) return 0;

    const feedDataMap = this.feedService.feedDataReactive();
    const feedData = feedDataMap.get(feed.id);
    if (feedData && feedData.pendingEvents) {
      const pendingEvents = this.filterEventsByFeedSettings(
        feedData.pendingEvents(),
        feed
      );

      // Only count events newer than the most recent displayed event
      const currentEvents = feedData.events();
      if (currentEvents.length > 0) {
        const mostRecentTimestamp = Math.max(...currentEvents.map(e => e.created_at || 0));
        const newerEvents = pendingEvents.filter(e => (e.created_at || 0) > mostRecentTimestamp);
        return newerEvents.length;
      }

      return pendingEvents.length;
    }
    return 0;
  });

  // Helper method to check if a specific feed is paused
  isFeedPaused(feedId: string): boolean {
    const feedDataMap = this.feedService.feedDataReactive();
    const feedData = feedDataMap.get(feedId);
    return feedData ? !feedData.subscription : false;
  }

  // Helper method to get pause status for debugging
  getColumnStatus(columnId: string): string {
    const feedDataMap = this.feedService.feedDataReactive();
    const columnData = feedDataMap.get(columnId);
    if (!columnData) return 'not found';
    return columnData.subscription ? 'active' : 'paused';
  }

  constructor() {
    // Mark the feeds page as active when component is constructed
    this.feedService.setFeedsPageActive(true);

    // Pre-load relay feeds when the component is initialized
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        untracked(async () => {
          try {
            await this.relayFeedsService.getRelayFeeds(pubkey);
            this.logger.debug('Relay feeds loaded for pubkey:', pubkey);
          } catch (error) {
            this.logger.error('Error loading relay feeds:', error);
          }
        });
      }
    });

    // Initialize data loading
    // this.loadTrendingContent();

    effect(async () => {
      // Whenever account is changed, make sure we reload this data.
      if (this.accountState.account()) {
        // Set loading state while initializing
        this.isLoading.set(true);

        untracked(async () => {
          try {
            // Re-establish subscriptions when component loads
            await this.feedService.subscribe();
            this.isLoading.set(false);
          } catch (error) {
            console.error('Error initializing feeds:', error);
            this.isLoading.set(false);
          }
        });
      }
    });

    // Monitor active feed changes for URL sync
    effect(() => {
      const currentFeedId = this.feedsCollectionService.activeFeedId();

      // Only process feed changes if there's an active account
      if (!this.accountState.account()) {
        return;
      }

      untracked(() => {
        // Log active feed change
        if (currentFeedId) {
          this.logger.debug('Active feed changed to:', currentFeedId);
        }

        // Sync URL with active feed (only if not triggered by route change)
        // This prevents infinite loops between route changes and feed changes
        // Also skip if we're currently processing a URL-based navigation
        // Also skip URL sync when showing a relay feed (to preserve the ?r= query param)
        if (currentFeedId && !this.isProcessingUrlNavigation && !this.activeRelayDomain()) {
          const feed = this.feedsCollectionService.feeds().find(f => f.id === currentFeedId);
          if (feed) {
            const currentPath = this.route.snapshot.params['path'];
            const targetPath = feed.path;

            // Check if there's a URL path that should take precedence over the saved active feed
            // This handles the case where user directly navigates to /f/following but saved feed is "discover"
            if (currentPath) {
              const urlTargetFeed = this.feedsCollectionService.feeds().find(f => f.path === currentPath);
              if (urlTargetFeed && urlTargetFeed.id !== currentFeedId) {
                // URL points to a different feed - let the route params effect handle this
                // Don't sync URL, the route params subscription will update the active feed
                this.logger.debug(`URL path ${currentPath} differs from active feed - deferring to route handler`);
                return;
              }
            }

            // Only navigate if the URL doesn't already match the feed
            // This check prevents loops: route change -> feed change -> route change
            const urlMatchesFeed =
              (targetPath && currentPath === targetPath) ||
              (!targetPath && !currentPath && this.router.url === '/f') ||
              (!targetPath && this.router.url === '/');

            if (!urlMatchesFeed) {
              if (targetPath) {
                this.router.navigate(['/f', targetPath], { replaceUrl: true, queryParamsHandling: 'preserve' });
                this.logger.debug(`Synced URL to feed path: /f/${targetPath}`);
              } else if (this.router.url.startsWith('/f/')) {
                // Feed has no path but URL has a path - navigate to /f
                this.router.navigate(['/f'], { replaceUrl: true, queryParamsHandling: 'preserve' });
                this.logger.debug('Synced URL to /f (feed has no path)');
              }
            }
          }
        }
      });
    });

    // Handle route parameters for feed navigation
    // This effect handles URL-based navigation to feeds (e.g., /f/discover, /f/articles)
    // IMPORTANT: This must run BEFORE the URL sync effect to properly handle direct URL navigation
    // Subscribe once and handle feeds loading within the subscription
    this.routeParamsSubscription = this.route.params.subscribe(params => {
      const pathParam = params['path'];
      const feeds = this.feedsCollectionService.feeds();

      // Wait for feeds to be loaded before processing route
      if (feeds.length === 0) {
        return;
      }

      if (pathParam) {
        // Set flag to indicate we're processing URL navigation
        // This prevents the URL sync effect from overriding our navigation
        this.isProcessingUrlNavigation = true;

        // Find feed by path parameter from URL
        const targetFeed = feeds.find(feed => feed.path === pathParam);

        if (targetFeed) {
          // Set the active feed immediately (synchronous operation)
          // Only set if it's different from current to avoid unnecessary updates
          const currentActiveFeedId = this.feedsCollectionService.activeFeedId();
          if (currentActiveFeedId !== targetFeed.id) {
            this.feedsCollectionService.setActiveFeed(targetFeed.id);
            this.logger.debug(`Activated feed from URL path: ${pathParam} -> ${targetFeed.id}`);
          }
        } else {
          // If no feed with this path is found, redirect to default feed
          console.warn(`No feed found with path: ${pathParam}`);
          this.router.navigate(['/f'], { replaceUrl: true, queryParamsHandling: 'preserve' });
        }

        // Clear the flag after a short delay to allow the feed change to process
        setTimeout(() => {
          this.isProcessingUrlNavigation = false;
        }, 100);
      } else if (this.router.url.startsWith('/f')) {
        // User navigated to /f without a path parameter
        // Restore the previously active feed or use "For You" as default
        const activeFeedId = this.feedsCollectionService.activeFeedId();

        if (!activeFeedId && feeds.length > 0) {
          // No active feed yet - prefer "For You" feed as it's optimized for new users
          const forYouFeed = feeds.find(f => f.id === 'default-feed-for-you');
          const defaultFeedId = forYouFeed ? forYouFeed.id : feeds[0].id;
          this.feedsCollectionService.setActiveFeed(defaultFeedId);
        }
        // If there's already an active feed, keep it (already loaded from localStorage)
      }
    });

    // Handle query parameters for relay feed (e.g., /f/?r=trending.relays.land)
    this.queryParamsSubscription = this.route.queryParams.subscribe(params => {
      const relayParam = params['r'];
      if (relayParam) {
        // Normalize the relay domain (remove wss:// if present)
        const domain = relayParam.replace(/^wss?:\/\//, '').replace(/\/$/, '');
        this.activeRelayDomain.set(domain);
        this.logger.debug(`Activated relay feed from URL: ${domain}`);

        // Update the relay feed menu selection if it's available
        if (this.relayFeedMenu) {
          this.relayFeedMenu.setSelectedRelay(domain);
        }
      } else {
        // Clear relay feed when no query param
        this.activeRelayDomain.set('');
      }
    });

    // Set up responsive layout
    effect(() => {
      const handleResize = () => {
        this.screenWidth.set(window.innerWidth);
        // Update horizontal overflow on resize
        this.updateHorizontalOverflow();
      };

      window.addEventListener('resize', handleResize);
      return () => {
        window.removeEventListener('resize', handleResize);
      };
    });

    // Set up scroll listener for header auto-hide
    effect(() => {
      if (this.layoutService.isBrowser()) {
        setTimeout(() => {
          this.setupHeaderScrollListener();
        }, 500);
      }
    });

    // Set up scroll listeners for the active feed
    effect(() => {
      const activeFeed = this.activeFeed();
      const account = this.accountState.account();

      // Only set up scroll listeners if there's an active account and feed
      if (!account || !activeFeed) {
        return;
      }

      if (this.layoutService.isBrowser()) {
        // Wait for feed content to be rendered
        setTimeout(() => {
          this.setupFeedScrollListener(activeFeed);
        }, 500);
      }
    });

    // Automatic refresh effect
    // effect(() => {
    //   const interval = setInterval(() => {
    //     this.loadTrendingContent(true);
    //   }, 60000); // Refresh every minute

    //   return () => {
    //     clearInterval(interval);
    //   };
    // });
  }

  /**
   * Set up scroll listener for the active feed to detect when user scrolls to bottom
   * Simplified from the old multi-column architecture
   */
  private setupFeedScrollListener(feed: FeedConfig) {
    // Clean up existing listeners
    this.cleanupScrollListener();

    // Find the main scroll container - this is typically .content-wrapper
    const contentWrapper = document.querySelector('.content-wrapper') as HTMLElement;

    if (!contentWrapper) {
      return;
    }

    // Create scroll check function
    const checkScrollPosition = () => {
      const now = Date.now();

      // Check cooldown
      if (now - this.lastLoadTime < this.LOAD_MORE_COOLDOWN_MS) {
        return;
      }

      const scrollTop = contentWrapper.scrollTop;
      const scrollHeight = contentWrapper.scrollHeight;
      const clientHeight = contentWrapper.clientHeight;

      // Trigger when within 500px of bottom
      const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);

      if (distanceFromBottom < 500) {
        this.lastLoadTime = now;

        // Render more events from cache if available
        if (this.hasMoreEventsToRender(feed.id)) {
          this.loadMoreRenderedEvents(feed.id);
        }

        // Also fetch more events from network if needed
        this.loadMoreForFeed(feed.id);
      }
    };

    // Throttled scroll handler
    const scrollHandler = () => {
      requestAnimationFrame(checkScrollPosition);
    };

    // Add scroll listener
    contentWrapper.addEventListener('scroll', scrollHandler, { passive: true });

    // Store cleanup function
    this.scrollCheckCleanup = () => {
      contentWrapper.removeEventListener('scroll', scrollHandler);
    };

    // Do initial check in case we're already scrolled down
    setTimeout(() => {
      checkScrollPosition();
    }, 100);

    setTimeout(() => {
      checkScrollPosition();
    }, 1000);
  }

  /**
   * Clean up scroll listeners
   */
  private cleanupScrollListener(): void {
    if (this.scrollCheckCleanup) {
      this.scrollCheckCleanup();
      this.scrollCheckCleanup = null;
    }
  }

  /**
   * Set up scroll listener on main container to auto-hide/show header
   */
  private setupHeaderScrollListener(): void {
    // Scrolling happens on content-wrapper, not home-container
    const container = document.querySelector('.content-wrapper') as HTMLElement;

    if (!container) {
      return;
    }

    // Remove existing listener if any
    const existingListener = (container as HTMLElement & { __headerScrollListener?: () => void }).__headerScrollListener;
    if (existingListener) {
      container.removeEventListener('scroll', existingListener);
    }

    const scrollListener = () => {
      const scrollTop = container.scrollTop;
      const scrollDelta = scrollTop - this.lastScrollTop;

      // Scrolling down - hide header after scrolling down past threshold
      if (scrollDelta > 10 && scrollTop > 100) {
        this.headerHidden.set(true);
      }
      // Scrolling up - show header immediately
      else if (scrollDelta < -10) {
        this.headerHidden.set(false);
      }
      // At the very top - always show header
      else if (scrollTop <= 50) {
        this.headerHidden.set(false);
      }

      this.lastScrollTop = scrollTop;
    };

    // Store listener reference for cleanup
    (container as HTMLElement & { __headerScrollListener?: () => void }).__headerScrollListener = scrollListener;
    container.addEventListener('scroll', scrollListener, { passive: true });
  }

  /**
   * Handle scroll on columns container and sync fixed scrollbar
   */
  onColumnsScroll(event: globalThis.Event): void {
    if (this.isSyncingScroll) return;

    const container = event.target as HTMLElement | null;
    if (!container) return;

    // Update scroll position for syncing
    this.columnsScrollLeft.set(container.scrollLeft);

    // Sync the fixed scrollbar
    if (this.fixedScrollbar?.nativeElement) {
      this.isSyncingScroll = true;
      this.fixedScrollbar.nativeElement.scrollLeft = container.scrollLeft;
      this.isSyncingScroll = false;
    }
  }

  /**
   * Handle scroll on fixed scrollbar and sync columns container
   */
  onFixedScrollbarScroll(event: globalThis.Event): void {
    if (this.isSyncingScroll) return;

    const scrollbar = event.target as HTMLElement | null;
    if (!scrollbar || !this.columnsContainer?.nativeElement) return;

    this.isSyncingScroll = true;
    this.columnsContainer.nativeElement.scrollLeft = scrollbar.scrollLeft;
    this.columnsScrollLeft.set(scrollbar.scrollLeft);
    this.isSyncingScroll = false;
  }

  /**
   * Check and update horizontal overflow state for columns
   */
  private updateHorizontalOverflow(): void {
    if (!this.columnsContainer?.nativeElement) return;

    const container = this.columnsContainer.nativeElement;
    const hasOverflow = container.scrollWidth > container.clientWidth;
    this.hasHorizontalOverflow.set(hasOverflow);
    this.columnsScrollWidth.set(container.scrollWidth);
  }

  /**
   * Load more content for a specific feed
   */
  private async loadMoreForFeed(feedId: string) {
    try {
      // Check if already loading or no more content
      const isLoadingSignal = this.feedService.getColumnLoadingState(feedId);
      const hasMoreSignal = this.feedService.getColumnHasMore(feedId);

      // Guard: Ensure signals exist and check their values
      if (!isLoadingSignal || !hasMoreSignal) {
        return;
      }

      // Guard: Don't load if already loading or no more data available
      if (isLoadingSignal() || !hasMoreSignal()) {
        return;
      }

      this.logger.debug(`Loading more content for feed: ${feedId}`);
      await this.feedService.loadMoreEventsForColumn(feedId);
    } catch (error) {
      this.logger.error(`Failed to load more content for feed ${feedId}:`, error);
    }
  }

  // setActiveSection(section: 'discover' | 'following' | 'media'): void {
  //   this.activeSection.set(section);

  //   // Load section data if needed
  //   switch (section) {
  //     case 'following':
  //       if (this.followingEvents().length === 0) {
  //         this.loadFollowingContent();
  //       }
  //       break;
  //     case 'media':
  //       if (this.mediaEvents().length === 0) {
  //         this.loadMediaContent();
  //       }
  //       break;
  //   }
  // }

  // async loadTrendingContent(silent = false): Promise<void> {
  //   if (!silent) {
  //     this.isLoading.set(true);
  //   }

  //   try {
  //     const events = await this.fetchTrendingEvents();
  //     this.trendingEvents.set(events);
  //     if (!silent) {
  //       this.notificationService.notify('Trending content updated');
  //     }
  //   } catch (error) {
  //     console.error('Failed to load trending content:', error);
  //     if (!silent) {
  //       this.notificationService.notify('Failed to load trending content', 'error');
  //     }
  //   } finally {
  //     if (!silent) {
  //       this.isLoading.set(false);
  //     }
  //   }
  // }

  // async loadFollowingContent(): Promise<void> {
  //   this.isLoading.set(true);

  //   try {
  //     const events = await this.fetchFollowingEvents();
  //     this.followingEvents.set(events);
  //   } catch (error) {
  //     console.error('Failed to load following content:', error);
  //     this.notificationService.notify('Failed to load following content', 'error');
  //   } finally {
  //     this.isLoading.set(false);
  //   }
  // }

  // async loadMediaContent(): Promise<void> {
  //   this.isLoading.set(true);

  //   try {
  //     const events = await this.fetchMediaEvents();
  //     this.mediaEvents.set(events);
  //   } catch (error) {
  //     console.error('Failed to load media content:', error);
  //     this.notificationService.notify('Failed to load media content', 'error');
  //   } finally {
  //     this.isLoading.set(false);
  //   }
  // }

  // async fetchTrendingEvents(): Promise<NostrRecord[]> {
  //   // Example implementation - would be replaced with actual fetch from nostrService
  //   const response = await fetch('/api/trending');
  //   if (!response.ok) {
  //     throw new Error('Failed to fetch trending events');
  //   }

  //   return await response.json() as NostrRecord[];
  // }

  // async fetchFollowingEvents(): Promise<NostrRecord[]> {
  //   // Example implementation - would be replaced with actual fetch from nostrService
  //   const response = await fetch('/api/following');
  //   if (!response.ok) {
  //     throw new Error('Failed to fetch following events');
  //   }

  //   return await response.json() as NostrRecord[];
  // }

  // async fetchMediaEvents(): Promise<NostrRecord[]> {
  //   // Example implementation - would be replaced with actual fetch from nostrService
  //   const response = await fetch('/api/media');
  //   if (!response.ok) {
  //     throw new Error('Failed to fetch media events');
  //   }

  //   return await response.json() as NostrRecord[];
  // }

  toggleAdvancedFilters(): void {
    this.showAdvancedFilters.update(value => !value);
  }

  /**
   * Handle relay selection from the relay feed menu
   */
  onRelaySelected(domain: string): void {
    if (domain) {
      // Clear the active feed selection when viewing a public relay feed
      this.feedsCollectionService.clearActiveFeed();

      // Navigate with relay query param (keeping nice URL without wss://)
      this.router.navigate(['/f'], {
        queryParams: { r: domain },
        queryParamsHandling: 'merge',
      });
    } else {
      // Clear relay param when deselecting
      this.router.navigate(['/f'], {
        queryParams: { r: null },
        queryParamsHandling: 'merge',
      });
    }
  }

  /**
   * Close the relay feed view
   */
  closeRelayFeed(): void {
    this.activeRelayDomain.set('');
    this.router.navigate(['/f'], {
      queryParams: { r: null },
      queryParamsHandling: 'merge',
    });
  }

  toggleTagFilter(tag: string): void {
    this.selectedTags.update(tags => {
      if (tags.includes(tag)) {
        return tags.filter(t => t !== tag);
      } else {
        return [...tags, tag];
      }
    });
  }

  // refreshContent(): void {
  //   switch (this.activeSection()) {
  //     case 'discover':
  //       this.loadTrendingContent();
  //       break;
  //     case 'following':
  //       this.loadFollowingContent();
  //       break;
  //     case 'media':
  //       this.loadMediaContent();
  //       break;
  //   }
  // }

  shareContent(): void {
    // Implement share functionality
    this.notificationService.notify('Content shared');
  }

  bookmarkContent(event?: any): void {
    // Implement bookmark functionality
    const eventId = event?.event?.id ?? '[unknown id]';
    this.notificationService.notify(`Content bookmarked: ${eventId}`);
  }

  // Column navigation methods removed - feeds are now flat structures without columns
  // The following methods (selectColumn, navigateToPreviousColumn, navigateToNextColumn,
  // loadColumnContentIfNeeded, handleColumnKeydown) have been deprecated

  onColumnDrop(event: CdkDragDrop<FeedConfig[]>): void {
    // Column reordering is deprecated - feeds no longer have columns
    console.warn('Column reordering is no longer supported - feeds are now flat structures');
    return;
  }

  // Drag event handlers removed - column dragging is no longer supported
  // (onDragStarted, onDragEnded methods deprecated)

  scrollLeft(): void {
    const container = this.columnsContainer?.nativeElement;
    if (!container) return;

    container.scrollBy({
      left: -750,
      behavior: 'smooth',
    });
  }

  scrollRight(): void {
    const container = this.columnsContainer?.nativeElement;
    if (!container) return;

    container.scrollBy({
      left: 750,
      behavior: 'smooth',
    });
  }
  // scrollToColumn method removed - no longer needed without column navigation





  /**
   * Toggle whether replies are shown in a feed
   */
  toggleShowReplies(feed: FeedConfig): void {
    const newValue = !feed.showReplies;
    this.feedsCollectionService.updateFeed(feed.id, { showReplies: newValue });
  }

  /**
   * Toggle whether reposts are shown in a feed
   */
  toggleShowReposts(feed: FeedConfig): void {
    const newValue = !(feed.showReposts ?? true); // Default is true
    this.feedsCollectionService.updateFeed(feed.id, { showReposts: newValue });
  }

  /**
   * Load pending new events into the main feed
   */
  loadNewPosts(feedId: string): void {
    const pendingCount = this.getPendingEventsCount(feedId);
    this.feedService.loadPendingEvents(feedId);

    // Only render initial batch (INITIAL_RENDER_COUNT) to improve performance
    // The rest will load progressively as the user scrolls
    this.renderedEventCounts.update(counts => ({
      ...counts,
      [feedId]: this.INITIAL_RENDER_COUNT
    }));

    // Scroll the feed to the top to show the new posts
    setTimeout(() => {
      const feedElement = document.querySelector(`[data-column-id="${feedId}"] .column-content`) as HTMLElement;
      if (feedElement) {
        feedElement.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }, 0);

    if (pendingCount > 0) {
      this.notificationService.notify(`Loaded ${pendingCount} new ${pendingCount === 1 ? 'post' : 'posts'}`);
    }
  }

  /**
   * Get pending events count for a column
   */
  getPendingEventsCount(feedId: string): number {
    const feed = this.feeds().find(f => f.id === feedId);
    if (!feed) return 0;

    const feedDataMap = this.feedService.feedDataReactive();
    const feedData = feedDataMap.get(feedId);
    if (feedData && feedData.pendingEvents) {
      const pendingEvents = this.filterEventsByFeedSettings(
        feedData.pendingEvents(),
        feed
      );

      // Only count events newer than the most recent displayed event
      const currentEvents = feedData.events();
      if (currentEvents.length > 0) {
        const mostRecentTimestamp = Math.max(...currentEvents.map(e => e.created_at || 0));
        const newerEvents = pendingEvents.filter(e => (e.created_at || 0) > mostRecentTimestamp);
        return newerEvents.length;
      }

      return pendingEvents.length;
    }
    return 0;
  }

  // Video expansion state management methods
  expandVideo(videoKey: string): void {
    this.videoExpandedStates.update(states => ({
      ...states,
      [videoKey]: true,
    }));
  }

  collapseVideo(videoKey: string): void {
    this.videoExpandedStates.update(states => ({
      ...states,
      [videoKey]: false,
    }));
  }

  ngOnDestroy() {
    console.log('🧹 FeedsComponent destroying...');
    this.logger.debug('Cleaning up resources...');

    // Clean up route params subscription
    if (this.routeParamsSubscription) {
      this.routeParamsSubscription.unsubscribe();
      this.routeParamsSubscription = null;
    }

    // Clean up query params subscription
    if (this.queryParamsSubscription) {
      this.queryParamsSubscription.unsubscribe();
      this.queryParamsSubscription = null;
    }

    // Clean up scroll listeners
    this.cleanupScrollListener();

    // Mark feeds page as inactive - this will trigger unsubscribe in FeedService
    this.feedService.setFeedsPageActive(false);
  }
  // Helper methods for content rendering
  getImageUrls(event: any): string[] {
    const imetas = event.tags?.filter((tag: any[]) => tag[0] === 'imeta') || [];
    return imetas
      .map((imeta: string[]) => {
        const urlIndex = imeta.findIndex(item => item.startsWith('url '));
        return urlIndex > 0 ? imeta[urlIndex].substring(4) : null;
      })
      .filter(Boolean);
  }

  /**
   * Get placeholder hash from event - prefers thumbhash over blurhash based on settings
   */
  getBlurhash(event: any, imageIndex = 0): string | null {
    const data = this.imagePlaceholder.getPlaceholderFromEvent(event, imageIndex);
    return this.imagePlaceholder.getBestPlaceholder(data);
  }

  /**
   * Generate a placeholder data URL - supports both blurhash and thumbhash
   */
  generateBlurhashDataUrl(placeholder: string, width = 32, height = 32): string {
    return this.imagePlaceholder.generatePlaceholderDataUrl(placeholder, width, height);
  }
  getVideoData(event: any): {
    url: string;
    thumbnail?: string;
    duration?: string;
    blurhash?: string;
  } | null {
    const imetas = event.tags?.filter((tag: any[]) => tag[0] === 'imeta') || [];
    if (imetas.length === 0) return null;

    const firstImeta = imetas[0];
    const urlIndex = firstImeta.findIndex((item: string) => item.startsWith('url '));
    const imageIndex = firstImeta.findIndex((item: string) => item.startsWith('image '));
    const blurhashIndex = firstImeta.findIndex((item: string) => item.startsWith('blurhash '));

    const durationTag = event.tags?.find((tag: any[]) => tag[0] === 'duration');

    const videoUrl = urlIndex > 0 ? firstImeta[urlIndex].substring(4) : '';
    const existingThumbnail = imageIndex > 0 ? firstImeta[imageIndex].substring(6) : undefined;
    const existingBlurhash = blurhashIndex > 0 ? firstImeta[blurhashIndex].substring(9) : undefined;

    // Generate thumbnail using web service if no existing thumbnail or blurhash
    let generatedThumbnail: string | undefined = existingThumbnail;
    if (!existingThumbnail && !existingBlurhash && videoUrl) {
      generatedThumbnail = `https://video-thumb.apps2.slidestr.net/${videoUrl}`;
    }

    return {
      url: videoUrl,
      thumbnail: generatedThumbnail,
      duration: durationTag ? durationTag[1] : undefined,
      blurhash: existingBlurhash,
    };
  }

  getEventTitle(event: any): string {
    const titleTag = event.tags?.find((tag: any[]) => tag[0] === 'title');
    return titleTag ? titleTag[1] : '';
  }

  getEventAlt(event: any): string {
    const altTag = event.tags?.find((tag: any[]) => tag[0] === 'alt');
    return altTag ? altTag[1] : '';
  }

  /**
   * Remove hashtags from content since they're already displayed as chips
   */
  removeHashtagsFromContent(content: string): string {
    if (!content) return '';

    // Remove hashtags using regex - matches #word patterns
    return content
      .replace(/#[a-zA-Z0-9_]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  hasContentWarning(event: any): boolean {
    return event.tags?.some((tag: any[]) => tag[0] === 'content-warning') || false;
  }

  getContentWarning(event: any): string {
    const warningTag = event.tags?.find((tag: any[]) => tag[0] === 'content-warning');
    return warningTag ? warningTag[1] : '';
  }

  formatDuration(seconds: string): string {
    const num = parseInt(seconds);
    const hours = Math.floor(num / 3600);
    const minutes = Math.floor((num % 3600) / 60);
    const secs = num % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
  openImageDialog(imageUrl: string, altText: string): void {
    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaItems: [{ url: imageUrl, type: 'image/jpeg', title: altText }],
        initialIndex: 0,
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      panelClass: 'image-dialog-panel',
    });
  }
  onImageLoad(event: globalThis.Event): void {
    const img = event.target as HTMLImageElement;
    const container = img.parentElement;
    if (container) {
      const placeholder = container.querySelector('.blurhash-placeholder') as HTMLImageElement;
      if (placeholder) {
        placeholder.style.opacity = '0';
        setTimeout(() => {
          placeholder.style.display = 'none';
        }, 300);
      }
    }
  }
  /**
   * Select a feed
   */
  selectFeed(feedId: string): void {
    const feeds = this.feedsCollectionService.feeds();
    const selectedFeed = feeds.find(feed => feed.id === feedId);

    // Set the active feed (this happens synchronously now)
    this.feedsCollectionService.setActiveFeed(feedId);

    // Navigate to the appropriate URL immediately
    if (selectedFeed?.path) {
      this.router.navigate(['/f', selectedFeed.path]);
    } else {
      // For feeds without a path, navigate to the base feeds route
      this.router.navigate(['/f']);
    }
  }

  /**
   * Add a new board
   */
  addNewFeed(): void {
    this.editingFeed.set(undefined);
    this.showNewFeedDialog.set(true);
  }

  async onFeedDialogClosed(result: import('../../services/feed.service').FeedConfig | null): Promise<void> {
    this.showNewFeedDialog.set(false);

    if (result) {
      const editingFeedData = this.editingFeed();

      if (editingFeedData) {
        // Update existing feed
        await this.feedsCollectionService.updateFeed(editingFeedData.id, {
          label: result.label,
          icon: result.icon,
          path: result.path,
        });
      } else {
        // Add new feed
        const newBoard = await this.feedsCollectionService.addFeed({
          label: result.label,
          icon: result.icon,
          path: result.path,
          type: result.type || 'notes',
          kinds: result.kinds || [1],
          source: result.source || 'public',
          relayConfig: result.relayConfig || 'account',
          customRelays: result.customRelays,
          customUsers: result.customUsers,
          customStarterPacks: result.customStarterPacks,
          customFollowSets: result.customFollowSets,
          searchQuery: result.searchQuery,
          showReplies: result.showReplies,
          showReposts: result.showReposts,
          filters: result.filters || {},
        });

        // Mark the new feed as content loaded BEFORE setting it active
        this.columnContentLoaded.update(loaded => ({
          ...loaded,
          [newBoard.id]: true,
        }));

        if (newBoard.path) {
          this.url.updatePathSilently(['/f', newBoard.path]);
        }

        // Set as active board (skip validation since feed was just added)
        this.feedsCollectionService.setActiveFeed(newBoard.id, true);
      }
    }

    // Reset editing state
    this.editingFeed.set(undefined);
  }

  /**
   * Edit the current board
   */
  editCurrentFeed(): void {
    const activeFeed = this.activeFeed();
    if (!activeFeed) return;

    this.editingFeed.set(activeFeed);
    this.showNewFeedDialog.set(true);
  }
  /**
   * Delete the current board
   */
  deleteCurrentFeed(): void {
    const activeFeed = this.activeFeed();
    if (!activeFeed) return;

    // Show confirmation dialog
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Board',
        message: `Are you sure you want to delete the board "${activeFeed.label}"?`,
        confirmText: 'Delete Board',
        cancelText: 'Cancel',
        confirmColor: 'warn',
      } as ConfirmDialogData,
    });
    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.feedsCollectionService.removeFeed(activeFeed.id);
      }
    });
  }

  async resetFeeds(): Promise<void> {
    // Show confirmation dialog with strong warning
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Reset Feeds',
        message:
          'Are you sure you want to reset all feeds to defaults? This will permanently delete all your custom feeds and columns. This action cannot be undone.',
        confirmText: 'Reset Feeds',
        cancelText: 'Cancel',
        confirmColor: 'warn',
      } as ConfirmDialogData,
    });
    dialogRef.afterClosed().subscribe(async (result) => {
      if (result) {
        await this.feedsCollectionService.resetToDefaults();
        this.notificationService.notify('Feeds have been reset to defaults');
      }
    });
  }

  /**
   * Get M3U playlist data from event
   */
  getPlaylistData(event: any): {
    title?: string;
    alt?: string;
    tracks: { url: string; title?: string; artist?: string }[];
    url?: string;
    totalDuration?: string;
  } | null {
    // Get M3U content from event content or URL tag
    const urlTag = event.tags?.find((tag: any[]) => tag[0] === 'u');
    const playlistUrl = urlTag ? urlTag[1] : null;
    const m3uContent = event.content || '';

    if (!m3uContent && !playlistUrl) return null;

    const title = this.getEventTitle(event) || 'M3U Playlist';
    const alt = this.getEventAlt(event);

    let tracks: { url: string; title?: string; artist?: string }[] = [];
    let totalDuration = 0;

    if (m3uContent) {
      tracks = this.parseM3UContent(m3uContent);

      // Calculate total duration if available
      tracks.forEach(track => {
        if (track.url) {
          // Try to extract duration from M3U metadata if available
          const durationMatch = m3uContent.match(/#EXTINF:(\d+)/);
          if (durationMatch) {
            totalDuration += parseInt(durationMatch[1]);
          }
        }
      });
    }

    return {
      title,
      alt,
      tracks,
      url: playlistUrl,
      totalDuration: totalDuration > 0 ? this.formatDuration(totalDuration.toString()) : undefined,
    };
  }

  /**
   * Parse M3U content and extract tracks
   */
  private parseM3UContent(content: string): { url: string; title?: string; artist?: string }[] {
    const lines = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line);
    const tracks: { url: string; title?: string; artist?: string }[] = [];

    let currentTrack: { url?: string; title?: string; artist?: string } = {};

    for (const line of lines) {
      if (line.startsWith('#EXTINF:')) {
        // Parse track info: #EXTINF:duration,artist - title
        const match = line.match(/#EXTINF:[^,]*,(.+)/);
        if (match) {
          const trackInfo = match[1];
          if (trackInfo.includes(' - ')) {
            const [artist, title] = trackInfo.split(' - ', 2);
            currentTrack.artist = artist.trim();
            currentTrack.title = title.trim();
          } else {
            currentTrack.title = trackInfo.trim();
          }
        }
      } else if (
        line.startsWith('http') ||
        line.startsWith('https') ||
        line.endsWith('.mp3') ||
        line.endsWith('.m4a') ||
        line.endsWith('.wav') ||
        line.endsWith('.flac')
      ) {
        // This is a track URL
        currentTrack.url = line;

        if (currentTrack.url) {
          tracks.push({
            url: currentTrack.url,
            title: currentTrack.title || this.extractFilenameFromUrl(currentTrack.url),
            artist: currentTrack.artist,
          });
        }

        // Reset for next track
        currentTrack = {};
      } else if (!line.startsWith('#')) {
        // Non-comment line that might be a relative URL or filename
        currentTrack.url = line;

        if (currentTrack.url) {
          tracks.push({
            url: currentTrack.url,
            title: currentTrack.title || this.extractFilenameFromUrl(currentTrack.url),
            artist: currentTrack.artist,
          });
        }

        currentTrack = {};
      }
    }

    return tracks;
  }

  /**
   * Extract filename from URL for track title
   */
  private extractFilenameFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop() || url;
      return filename.replace(/\.[^/.]+$/, ''); // Remove file extension
    } catch {
      // If URL parsing fails, just use the last part after '/'
      const parts = url.split('/');
      const filename = parts[parts.length - 1] || url;
      return filename.replace(/\.[^/.]+$/, '');
    }
  }

  /**
   * Play entire M3U playlist
   */
  playPlaylist(playlistData: {
    title?: string;
    tracks: { url: string; title?: string; artist?: string }[];
  }): void {
    console.log('Playing M3U playlist:', playlistData);

    if (!playlistData.tracks || playlistData.tracks.length === 0) return;

    // Clear current media queue and add all tracks
    this.mediaPlayerService.media.set([]);
    playlistData.tracks.forEach((track, index) => {
      let type: 'Music' | 'Podcast' | 'YouTube' | 'Video' = 'Video';

      // Extra if the track.url is YouTube, video or music.
      if (track.url.includes('youtube.com') || track.url.includes('youtu.be')) {
        type = 'YouTube';
      }
      const mediaItem: MediaItem = {
        title: track.title || `Track ${index + 1}`,
        artist: track.artist || 'Unknown Artist',
        source: track.url,
        artwork: '', // Could be enhanced to extract album art
        type,
      };

      this.mediaPlayerService.enque(mediaItem);
    });

    // Start playing the first track
    this.mediaPlayerService.start();
  }

  /**
   * Add playlist to queue
   */
  addPlaylistToQueue(playlistData: {
    title?: string;
    tracks: { url: string; title?: string; artist?: string }[];
  }): void {
    if (!playlistData.tracks || playlistData.tracks.length === 0) return;
    playlistData.tracks.forEach((track, index) => {
      const mediaItem: MediaItem = {
        title: track.title || `Track ${index + 1}`,
        artist: track.artist || 'Unknown Artist',
        source: track.url,
        artwork: '',
        type: 'Video',
      };
      this.mediaPlayerService.enque(mediaItem);
    });
  }

  /**
   * Refresh a feed by unsubscribing and resubscribing
   */
  async refreshFeed(feed: FeedConfig): Promise<void> {
    await this.feedService.refreshFeed(feed.id);
  }
}
