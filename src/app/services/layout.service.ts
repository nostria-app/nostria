/* eslint-disable @typescript-eslint/no-explicit-any */
import { inject, Injectable, signal, computed, OnDestroy, effect, PLATFORM_ID, Injector, runInInjectionContext, NgZone } from '@angular/core';
import { NavigationEnd, NavigationExtras, Router } from '@angular/router';
import { Location } from '@angular/common';
import { LoggerService } from './logger.service';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MediaPreviewDialogComponent } from '../components/media-preview-dialog/media-preview.component';
import { type Event, kinds, nip19 } from 'nostr-tools';
import { AddressPointer, EventPointer, ProfilePointer } from 'nostr-tools/nip19';
import { ProfileStateService } from './profile-state.service';
import { NostrRecord } from '../interfaces';
import { AccountStateService } from './account-state.service';
import { isPlatformBrowser } from '@angular/common';
import { LocalStorageService } from './local-storage.service';
import {
  PublishDialogComponent,
  PublishDialogData,
} from '../components/publish-dialog/publish-dialog.component';
// ReportDialogComponent is dynamically imported to break circular dependency
import type { ReportDialogData } from '../components/report-dialog/report-dialog.component';
import { UtilitiesService } from './utilities.service';
import { RelayPoolService } from './relays/relay-pool';
import { VideoRecordDialogComponent } from '../pages/media/video-record-dialog/video-record-dialog.component';
import { AudioRecordDialogComponent } from '../pages/media/audio-record-dialog/audio-record-dialog.component';
import { ConfirmDialogComponent } from '../components/confirm-dialog/confirm-dialog.component';
import { MediaService, MediaItem } from './media.service';
import { MediaPublishDialogComponent, MediaPublishOptions } from '../pages/media/media-publish-dialog/media-publish-dialog.component';
import { MediaCreatorDialogComponent, MediaCreatorResult } from '../pages/media/media-creator-dialog/media-creator-dialog.component';
import { NostrService } from './nostr.service';
import { PublishService } from './publish.service';
import { CustomDialogService, CustomDialogRef } from './custom-dialog.service';
import { AccountRelayService } from './relays/account-relay';
import { UserRelayService } from './relays/user-relay';
import { FeedService } from './feed.service';
import { ReportTarget } from './reporting.service';
// EventDialogComponent is dynamically imported to break circular dependency
import { OnDemandUserDataService } from './on-demand-user-data.service';
import { CommandPaletteDialogComponent } from '../components/command-palette-dialog/command-palette-dialog.component';
import { NavigationStackService } from './navigation-stack.service';
import { RightPanelService } from './right-panel.service';
import { PanelNavigationService } from './panel-navigation.service';
import { SearchActionService } from './search-action.service';
// import { ArticleEditorDialogComponent } from '../components/article-editor-dialog/article-editor-dialog.component';

@Injectable({
  providedIn: 'root',
})
export class LayoutService implements OnDestroy {
  /** Used to perform queries or search when input has been parsed to be NIP-5 or similar. */
  query = signal<string | null>(null);
  search = signal(false);
  private searchAction = inject(SearchActionService);
  router = inject(Router);
  location = inject(Location);
  private logger = inject(LoggerService);
  private ngZone = inject(NgZone);
  private dialog = inject(MatDialog);
  private customDialog = inject(CustomDialogService);
  private snackBar = inject(MatSnackBar);
  private accountRelay = inject(AccountRelayService);
  private injector = inject(Injector);
  private utilities = inject(UtilitiesService);
  isHandset = signal(false);
  isWideScreen = signal(false);
  breakpointObserver = inject(BreakpointObserver);
  optimalProfilePosition = 240;

  profileState = inject(ProfileStateService);
  accountStateService = inject(AccountStateService);
  private userRelayService = inject(UserRelayService);
  private feedService = inject(FeedService);
  private pool = inject(RelayPoolService);
  private onDemandUserData = inject(OnDemandUserDataService);
  private navigationStack = inject(NavigationStackService);
  private rightPanel = inject(RightPanelService);
  private panelNavigation = inject(PanelNavigationService);
  showMediaPlayer = signal(false);
  fullscreenMediaPlayer = signal(false);
  private readonly platformId = inject(PLATFORM_ID);
  readonly isBrowser = signal(isPlatformBrowser(this.platformId));
  localStorage = inject(LocalStorageService);

  /** 
   * Signal to control whether the global feeds panel is expanded/visible.
   * When true, the feeds panel is shown. When false, it's hidden.
   * The feeds component is always rendered (never destroyed) to preserve state.
   */
  feedsExpanded = signal(true);

  /**
   * Signal that exposes whether there are items in the navigation stack.
   * Used to determine if content is loaded in the two-column layout.
   */
  hasNavigationItems = computed(() => this.navigationStack.hasItems());

  /**
   * Signal tracking whether we're currently on the home route.
   * Used to determine when to center the feeds panel.
   */
  isHomeRoute = signal(true);

  /** @deprecated Use feedsExpanded instead */
  feedCollapsed = computed(() => !this.feedsExpanded());

  /** Toggle the global feeds panel visibility */
  toggleFeedsExpanded() {
    this.feedsExpanded.update((v) => !v);
  }

  /** @deprecated Use toggleFeedsExpanded instead */
  toggleFeedCollapsed() {
    this.toggleFeedsExpanded();
  }

  /** Expand the feeds panel */
  expandFeeds() {
    this.feedsExpanded.set(true);
  }

  /** Collapse/hide the feeds panel */
  collapseFeeds() {
    this.feedsExpanded.set(false);
  }

  // Track currently open event dialog for back button handling
  // Using any type since EventDialogComponent is dynamically imported
  private currentEventDialogRef: CustomDialogRef<any> | null = null;

  // Scroll position management for feeds
  private feedScrollPositions = new Map<string, number>();

  /**
   * Signal that indicates whether the content wrapper is scrolled to the top
   * @deprecated Use leftPanelScrolledToTop or rightPanelScrolledToTop instead
   */
  scrolledToTop = signal(false);

  /**
   * Signal that indicates whether the content wrapper is scrolled to the bottom
   * @deprecated Use leftPanelScrolledToBottom or rightPanelScrolledToBottom instead
   */
  scrolledToBottom = signal(false);

  // ============================================
  // Panel-specific scroll signals (two-pane layout)
  // ============================================

  /**
   * Signal that indicates whether the LEFT panel is scrolled to the top
   * Use this for left panel content (main routes, feeds, profile pages, etc.)
   */
  leftPanelScrolledToTop = signal(false);

  /**
   * Signal that indicates whether the LEFT panel is scrolled to the bottom
   * Use this for infinite scroll loading in left panel content
   */
  leftPanelScrolledToBottom = signal(false);

  /**
   * Signal that indicates whether the RIGHT panel is scrolled to the top
   * Use this for right panel content (detail views opened from left panel)
   */
  rightPanelScrolledToTop = signal(false);

  /**
   * Signal that indicates whether the RIGHT panel is scrolled to the bottom
   * Use this for infinite scroll loading in right panel content
   */
  rightPanelScrolledToBottom = signal(false);

  /**
   * Signal indicating that left panel scroll monitoring is ready
   */
  leftPanelScrollReady = signal(false);

  /**
   * Signal indicating that right panel scroll monitoring is ready
   */
  rightPanelScrollReady = signal(false);

  /**
   * Signal that indicates whether the user is currently scrolling
   * This is useful for deferring heavy operations (like image loading or complex rendering)
   * until scrolling stops to improve performance.
   */
  isScrolling = signal(false);
  private scrollCheckTimer?: number;
  private lastScrollPosition = { x: 0, y: 0 };

  private scrollEventListener?: () => void;
  private contentWrapper?: Element;
  private isScrollMonitoringReady = signal(false);

  /**
   * Signal that indicates whether the mobile nav should be hidden due to scroll direction.
   * Hidden when scrolling down, shown when scrolling up.
   */
  mobileNavScrollHidden = signal(false);
  private mobileNavScrollState = new Map<Element, number>(); // Track last scroll position per element
  private scrollDirectionThreshold = 10; // Minimum scroll distance to trigger hide/show
  private mobileScrollListener?: (event: globalThis.Event) => void;

  /**
   * Signal that indicates whether scroll monitoring is ready and initialized
   * Use this to ensure scroll signals are reliable before reacting to them
   */
  readonly scrollMonitoringReady = this.isScrollMonitoringReady.asReadonly();

  constructor() {
    // Monitor only mobile devices (not tablets)
    this.breakpointObserver.observe('(max-width: 599px)').subscribe(result => {
      this.logger.debug('Breakpoint observer update', {
        isMobile: result.matches,
      });
      this.isHandset.set(result.matches);
    });

    this.breakpointObserver.observe('(min-width: 1200px)').subscribe(result => {
      this.isWideScreen.set(result.matches);
    });

    // Handle browser back button when event dialog is open
    if (isPlatformBrowser(this.platformId)) {
      window.addEventListener('popstate', () => {
        if (this.currentEventDialogRef) {
          this.currentEventDialogRef.close();
          this.currentEventDialogRef = null;
        }
      });
    }

    // Track whether we're on the home route
    // Initialize with current route state
    this.isHomeRoute.set(this.router.url === '/' || this.router.url.startsWith('/?'));
    this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        this.isHomeRoute.set(event.url === '/' || event.url.startsWith('/?'));
      }
    });

    effect(() => {
      if (this.isBrowser() && this.accountStateService.initialized()) {
        // Initialize scroll monitoring after a longer delay to ensure DOM is fully rendered
        setTimeout(() => {
          this.initializeScrollMonitoring();
        }, 500); // Increased from 100ms to 500ms to ensure full render
      }
    });

    // Setup global scroll detection
    this.setupGlobalScrollDetection();
  }

  /**
   * Initializes scroll event monitoring on the content wrapper
   */
  private initializeScrollMonitoring(): void {
    // Find the content wrapper (prioritize .mat-drawer-content, fallback to .content-wrapper)
    // const matDrawerContent = document.querySelector('.mat-drawer-content');
    const contentWrapper = document.querySelector('.content-wrapper');

    if (!contentWrapper) {
      return;
    }

    this.contentWrapper = contentWrapper; // || matDrawerContent || undefined;
    // this.contentWrapper = matDrawerContent || contentWrapper || undefined;

    if (!this.contentWrapper) {
      this.logger.warn('Content wrapper not found for scroll monitoring, retrying in 500ms...');
      setTimeout(() => this.initializeScrollMonitoring(), 500);
      return;
    }

    this.logger.debug('Initializing scroll monitoring on content wrapper'); // Remove existing listener if any
    if (this.scrollEventListener) {
      this.contentWrapper.removeEventListener('scroll', this.scrollEventListener);
    }

    // Create scroll handler with immediate and throttled updates
    let scrollTimeout: number | undefined;
    this.scrollEventListener = () => {
      // Immediate check for critical state changes (top/bottom transitions)
      const currentTop = this.scrolledToTop();
      const currentBottom = this.scrolledToBottom();

      // Quick check to see if we need immediate update
      const scrollTop = this.contentWrapper!.scrollTop;
      const scrollHeight = this.contentWrapper!.scrollHeight;
      const clientHeight = this.contentWrapper!.clientHeight;
      const threshold = 5;

      const isAtTop = scrollTop <= threshold;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - threshold;

      // If transitioning away from top or bottom, update immediately
      if ((currentTop && !isAtTop) || (currentBottom && !isAtBottom)) {
        this.checkScrollPosition();
      }

      // Always do throttled update for other cases
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
      scrollTimeout = window.setTimeout(() => {
        this.checkScrollPosition();
      }, 50);
    };
    this.contentWrapper.addEventListener('scroll', this.scrollEventListener, {
      passive: true,
    });

    // Delay the initial scroll position check to ensure everything has rendered
    // This prevents early triggering of scrolledToTop/scrolledToBottom signals
    setTimeout(() => {
      this.checkScrollPosition();
      this.isScrollMonitoringReady.set(true);
    }, 1000); // Wait 1 second after scroll monitoring setup before checking position
  }

  /**
   * Checks the current scroll position and updates the scroll signals
   * Only updates signals if monitoring is ready to prevent early triggering
   */
  private checkScrollPosition(): void {
    if (!this.contentWrapper) {
      return;
    }

    const scrollTop = this.contentWrapper.scrollTop;
    const scrollHeight = this.contentWrapper.scrollHeight;
    const clientHeight = this.contentWrapper.clientHeight;

    // Threshold for considering "at top" or "at bottom" (5px tolerance)
    const threshold = 5;

    // Check if scrolled to top
    const isAtTop = scrollTop <= threshold;
    const currentAtTop = this.scrolledToTop();
    if (isAtTop !== currentAtTop && this.isScrollMonitoringReady()) {
      this.scrolledToTop.set(isAtTop);
      // this.logger.debug('Scroll position - at top changed:', {
      //   isAtTop,
      //   wasAtTop: currentAtTop,
      //   scrollTop,
      //   threshold,
      // });
    }

    // Check if scrolled to bottom
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - threshold;
    const currentAtBottom = this.scrolledToBottom();
    if (isAtBottom !== currentAtBottom && this.isScrollMonitoringReady()) {
      this.scrolledToBottom.set(isAtBottom);
      // this.logger.debug('Scroll position - at bottom changed:', {
      //   isAtBottom,
      //   wasAtBottom: currentAtBottom,
      //   scrollTop,
      //   clientHeight,
      //   scrollHeight,
      //   calculated: scrollTop + clientHeight,
      //   targetThreshold: scrollHeight - threshold,
      // });
    }
  }

  /**
   * Manually refresh scroll monitoring (useful when content changes)
   */
  refreshScrollMonitoring(): void {
    this.checkScrollPosition();
  }

  /**
   * Refresh left panel scroll monitoring (useful after content changes)
   */
  refreshLeftPanelScroll(): void {
    // Find and check left panel scroll position
    const leftPanel = document.querySelector('.left-panel-content');
    if (leftPanel) {
      this.checkPanelScrollPosition(leftPanel, 'left');
    }
  }

  /**
   * Refresh right panel scroll monitoring (useful after content changes)
   */
  refreshRightPanelScroll(): void {
    // Find and check right panel scroll position
    const rightPanel = document.querySelector('.right-panel-content');
    if (rightPanel) {
      this.checkPanelScrollPosition(rightPanel, 'right');
    }
  }

  /**
   * @deprecated Use handlePanelScroll instead
   * Handle scroll events from the left panel (called by app.ts)
   * @param event - The scroll event from left panel
   */
  handleLeftPanelScroll(event: globalThis.Event): void {
    this.handlePanelScroll(event, 'left');
  }

  /**
   * @deprecated Use handlePanelScroll instead
   * Handle scroll events from the right panel (called by app.ts)
   * @param event - The scroll event from right panel
   */
  handleRightPanelScroll(event: globalThis.Event): void {
    this.handlePanelScroll(event, 'right');
  }

  /**
   * Handle scroll events from a panel container (left-panel or right-panel)
   * Each panel is its own scroll container with scrollbar at the panel edge
   * @param event - The scroll event from the panel container
   * @param panel - Which panel is scrolling ('left' or 'right')
   */
  handlePanelScroll(event: globalThis.Event, panel: 'left' | 'right'): void {
    const target = (event as any).target as Element;
    if (!target) return;

    // Mark panel as ready
    if (panel === 'left' && !this.leftPanelScrollReady()) {
      this.leftPanelScrollReady.set(true);
    }
    if (panel === 'right' && !this.rightPanelScrollReady()) {
      this.rightPanelScrollReady.set(true);
    }

    // Update scroll position for the specific panel
    const scrollTop = target.scrollTop;
    const scrollHeight = target.scrollHeight;
    const clientHeight = target.clientHeight;
    const threshold = 100; // Larger threshold for infinite scroll trigger

    const isAtTop = scrollTop <= 5;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - threshold;

    if (panel === 'left') {
      // Update left panel signals
      if (isAtTop !== this.leftPanelScrolledToTop()) {
        this.leftPanelScrolledToTop.set(isAtTop);
      }
      if (isAtBottom !== this.leftPanelScrolledToBottom()) {
        this.leftPanelScrolledToBottom.set(isAtBottom);
      }
      // Update legacy signals for backward compatibility
      if (isAtTop !== this.scrolledToTop()) {
        this.scrolledToTop.set(isAtTop);
      }
      if (isAtBottom !== this.scrolledToBottom()) {
        this.scrolledToBottom.set(isAtBottom);
      }
    } else {
      // Update right panel signals
      if (isAtTop !== this.rightPanelScrolledToTop()) {
        this.rightPanelScrolledToTop.set(isAtTop);
      }
      if (isAtBottom !== this.rightPanelScrolledToBottom()) {
        this.rightPanelScrolledToBottom.set(isAtBottom);
      }
    }
  }

  /**
   * @deprecated Use handlePanelScroll instead. This method is kept for backward compatibility.
   * Handle scroll events from the main layout container (dual-panel-layout)
   * @param event - The scroll event from the layout container
   */
  handleLayoutScroll(event: globalThis.Event): void {
    // For backward compatibility, treat as left panel scroll
    this.handlePanelScroll(event, 'left');
  }

  /**
   * Check scroll position of a specific panel and update signals
   * @param element - The scrollable panel element
   * @param panel - 'left' or 'right'
   */
  private checkPanelScrollPosition(element: Element, panel: 'left' | 'right'): void {
    const scrollTop = element.scrollTop;
    const scrollHeight = element.scrollHeight;
    const clientHeight = element.clientHeight;
    const threshold = 5;

    const isAtTop = scrollTop <= threshold;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - threshold;

    if (panel === 'left') {
      if (isAtTop !== this.leftPanelScrolledToTop()) {
        this.leftPanelScrolledToTop.set(isAtTop);
      }
      if (isAtBottom !== this.leftPanelScrolledToBottom()) {
        this.leftPanelScrolledToBottom.set(isAtBottom);
      }
      // Also update the legacy signals for backward compatibility
      if (isAtTop !== this.scrolledToTop()) {
        this.scrolledToTop.set(isAtTop);
      }
      if (isAtBottom !== this.scrolledToBottom()) {
        this.scrolledToBottom.set(isAtBottom);
      }
    } else {
      if (isAtTop !== this.rightPanelScrolledToTop()) {
        this.rightPanelScrolledToTop.set(isAtTop);
      }
      if (isAtBottom !== this.rightPanelScrolledToBottom()) {
        this.rightPanelScrolledToBottom.set(isAtBottom);
      }
    }
  }

  /**
   * Re-initialize scroll monitoring (useful when DOM structure changes)
   */
  reinitializeScrollMonitoring(): void {
    this.isScrollMonitoringReady.set(false);
    this.initializeScrollMonitoring();
  }

  /**
   * Debug method to test scroll signal behavior
   * Logs current scroll state and signal values
   */
  debugScrollState(): void {
    if (!this.contentWrapper) {
      console.log('No content wrapper found');
      return;
    }

    let scrollTimeout: any;
    this.contentWrapper.addEventListener('scroll', function () {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        console.log('Scroll event triggered (debounced)');
      }, 200);
    });

    const scrollTop = this.contentWrapper.scrollTop;
    const scrollHeight = this.contentWrapper.scrollHeight;
    const clientHeight = this.contentWrapper.clientHeight;
    const threshold = 5;

    const calculatedAtTop = scrollTop <= threshold;
    const calculatedAtBottom = scrollTop + clientHeight >= scrollHeight - threshold;

    console.log('Scroll Debug State:', {
      scrollTop,
      scrollHeight,
      clientHeight,
      threshold,
      calculatedAtTop,
      calculatedAtBottom,
      signalAtTop: this.scrolledToTop(),
      signalAtBottom: this.scrolledToBottom(),
      signalsMatch: {
        top: calculatedAtTop === this.scrolledToTop(),
        bottom: calculatedAtBottom === this.scrolledToBottom(),
      },
    });
  }

  /**
   * SCROLL SIGNALS USAGE GUIDE:
   *
   * The scrolledToTop and scrolledToBottom signals can be used in any component
   * to react to scroll events in the main content area. Here are common patterns:
   *
   * 1. INFINITE LOADING (scroll to bottom):
   * ```typescript
   * export class MyListComponent {
   *   private layout = inject(LayoutService);
   *   private dataService = inject(MyDataService);
   *   private loading = signal(false);
   *   items = signal<Item[]>([]);
   *     *   constructor() {
   *     effect(() => {
   *       if (this.layout.scrolledToBottom() && !this.loading()) {
   *         this.loadMoreItems();
   *       }
   *     });
   *   }
   *
   *   private async loadMoreItems() {
   *     this.loading.set(true);
   *     try {
   *       const newItems = await this.dataService.loadMore();
   *       this.items.update(current => [...current, ...newItems]);
   *     } finally {
   *       this.loading.set(false);
   *     }
   *   }
   * }
   * ```
   *
   * 2. PULL-TO-REFRESH (scroll to top):
   * ```typescript
   * export class MyFeedComponent {
   *   private layout = inject(LayoutService);
   *   private dataService = inject(MyDataService);
   *   private refreshing = signal(false);
   *     *   constructor() {
   *     effect(() => {
   *       if (this.layout.scrolledToTop() && !this.refreshing()) {
   *         this.refreshData();
   *       }
   *     });
   *   }
   *
   *   private async refreshData() {
   *     this.refreshing.set(true);
   *     try {
   *       const freshData = await this.dataService.refresh();
   *       // Update your data
   *     } finally {
   *       this.refreshing.set(false);
   *     }
   *   }
   * }
   * ```
   *     * 3. SHOW/HIDE UI ELEMENTS:
   * ```typescript
   * export class MyComponent {
   *   private layout = inject(LayoutService);
   *   showScrollToTop = computed(() =>
   *     this.layout.scrollMonitoringReady() && !this.layout.scrolledToTop()
   *   );
   *   showLoadMoreButton = computed(() =>
   *     this.layout.scrollMonitoringReady() && this.layout.scrolledToBottom()
   *   );
   * }
   * ```
   *
   * IMPORTANT NOTES:
   * - Always check scrollMonitoringReady() first to prevent early triggers
   * - Always check for loading states to prevent duplicate requests
   * - Use computed() for reactive UI updates based on scroll position
   * - The signals update with a 50ms throttle to prevent excessive updates
   * - Scroll monitoring initializes 1.5 seconds after account initialization
   * - Call refreshScrollMonitoring() after dynamic content changes
   * - Call reinitializeScrollMonitoring() if the DOM structure changes
   */
  ngOnDestroy(): void {
    if (this.contentWrapper && this.scrollEventListener) {
      this.contentWrapper.removeEventListener('scroll', this.scrollEventListener);
    }

    if (this.scrollCheckTimer) {
      clearInterval(this.scrollCheckTimer);
    }
  }

  /**
   * Toggle search - first checks if any component wants to handle it,
   * otherwise opens/closes global search.
   */
  toggleSearch() {
    // Try component-specific search first (components handle their own toggle)
    const handled = this.searchAction.triggerSearch();
    if (handled) {
      // Component handled the search, don't interact with global search
      return;
    }

    // No component handler - toggle global search
    if (this.search()) {
      this.closeSearch();
    } else {
      this.openGlobalSearch();
    }
  }

  /**
   * Force open global search (bypasses component handlers)
   */
  openGlobalSearch(): void {
    this.search.set(true);
    // Add ESC key listener when search is opened
    this.setupEscKeyListener();

    // Focus on search input after DOM update
    setTimeout(() => {
      const searchInput = document.querySelector('.search-input') as HTMLInputElement;
      if (searchInput) {
        searchInput.focus();
        this.logger.debug('Search input focused');
      } else {
        this.logger.error('Search input element not found for focusing');
      }
    }, 100);
  }

  /**
   * Close global search
   */
  closeSearch(): void {
    this.search.set(false);
    // Remove ESC key listener when search is closed
    this.removeEscKeyListener();
    // Clear search input and query when closing
    this.searchInput = '';
    this.query.set('');
  }

  private escKeyListener: ((event: KeyboardEvent) => void) | null = null;

  private setupEscKeyListener(): void {
    // Remove any existing listener first to prevent duplicates
    this.removeEscKeyListener();

    // Create and store the listener function
    this.escKeyListener = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Esc') {
        this.logger.debug('ESC key pressed, canceling search');
        this.toggleSearch();
        // Prevent default behavior for the ESC key
        event.preventDefault();
      }
    };

    // Add the listener to document
    document.addEventListener('keydown', this.escKeyListener);
    this.logger.debug('ESC key listener added for search');
  }

  private removeEscKeyListener(): void {
    if (this.escKeyListener) {
      document.removeEventListener('keydown', this.escKeyListener);
      this.escKeyListener = null;
      this.logger.debug('ESC key listener removed');
    }
  }

  searchInput = '';

  /**
   * Opens the search input and populates it with a value
   * Used by voice commands to search for something
   */
  openSearchWithValue(value: string): void {
    // Open search if not already open
    if (!this.search()) {
      this.search.set(true);
      this.setupEscKeyListener();
    }

    // Set the search input value
    this.searchInput = value;

    // Trigger the search after DOM update
    setTimeout(() => {
      const searchInput = document.querySelector('.search-input') as HTMLInputElement;
      if (searchInput) {
        searchInput.focus();
        // Trigger the input event to start search
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, 100);
  }

  private debounceTimer: any;

  copyToClipboard(text: any | undefined | null, type: string, author?: string, kind?: number): void {
    if (text === null || text === undefined) {
      return;
    }

    if (type === 'nprofile') {
      const pubkey = this.profileState.pubkey();
      const profilePointer: ProfilePointer = {
        pubkey: text,
        relays: pubkey ? this.userRelayService.getRelaysForPubkey(pubkey) : undefined,
      };
      text = nip19.nprofileEncode(profilePointer);
    }

    if (type === 'nevent') {
      const eventPointer: EventPointer = { id: text, author: author, kind: kind };
      text = nip19.neventEncode(eventPointer);
    }

    if (type === 'note') {
      text = nip19.noteEncode(text);
    }

    if (type === 'json') {
      text = JSON.stringify(text, null, 2);
    }

    navigator.clipboard
      .writeText(text)
      .then(() => {
        this.logger.debug(`Copied ${type} to clipboard:`, text);
        this.snackBar.open(
          `${type.charAt(0).toUpperCase() + type.slice(1)} copied to clipboard`,
          'Dismiss',
          {
            duration: 3000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
            panelClass: 'copy-snackbar',
          }
        );
      })
      .catch(error => {
        this.logger.error('Failed to copy to clipboard:', error);
        this.snackBar.open('Failed to copy to clipboard', 'Dismiss', {
          duration: 3000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
          panelClass: 'error-snackbar',
        });
      });
  }

  showWelcomeScreen = signal<boolean>(false);

  // Method to update welcome screen preference
  setWelcomeScreenPreference(show: boolean): void {
    this.showWelcomeScreen.set(show);
  }

  async publishEvent(event: Event) {
    if (!event) {
      return;
    }

    const dialogData: PublishDialogData = {
      event,
    };

    this.dialog.open(PublishDialogComponent, {
      data: dialogData,
      width: '600px',
      panelClass: 'responsive-dialog',
      disableClose: false,
    });
  }

  openPublishCustomEvent() {
    const dialogData: PublishDialogData = {
      customMode: true,
    };

    this.dialog.open(PublishDialogComponent, {
      data: dialogData,
      width: '600px',
      panelClass: 'responsive-dialog',
      disableClose: false,
    });
  }

  async showReportDialog(target: ReportTarget, userDisplayName?: string) {
    const dialogData: ReportDialogData = {
      target,
      userDisplayName,
    };

    // Dynamically import to break circular dependency
    const { ReportDialogComponent } = await import('../components/report-dialog/report-dialog.component');

    const dialogRef = this.dialog.open(ReportDialogComponent, {
      data: dialogData,
      width: '600px',
      panelClass: 'responsive-dialog',
      disableClose: false,
    });

    return dialogRef.afterClosed();
  }

  // Method to show the welcome dialog
  showWelcomeDialog(): void {
    this.logger.debug('Showing welcome dialog');
    this.showWelcomeScreen.set(true);
  }

  async showLoginDialog(): Promise<void> {
    this.logger.debug('showLoginDialog called');

    // Set a signal to show the standalone login dialog
    this.showStandaloneLogin.set(true);

    this.logger.debug('Standalone login dialog opened');
  }

  // Signal to control standalone login dialog visibility
  showStandaloneLogin = signal(false);

  // Signal to store the initial step for the login dialog (accessible by StandaloneLoginDialogComponent)
  loginDialogInitialStep = signal<string | undefined>(undefined);

  // Signal to control Terms of Use dialog visibility
  showTermsDialog = signal(false);

  // Signal to hide the mobile navigation (e.g., when in chat view)
  hideMobileNav = signal(false);

  // Signal to control shoutout overlay visibility
  showShoutoutOverlay = signal(false);

  /**
   * Open the shoutout overlay
   */
  openShoutouts(): void {
    this.showShoutoutOverlay.set(true);
  }

  /**
   * Close the shoutout overlay
   */
  closeShoutouts(): void {
    this.showShoutoutOverlay.set(false);
  }

  /**
   * Toggle the shoutout overlay
   */
  toggleShoutouts(): void {
    this.showShoutoutOverlay.update(v => !v);
  }

  // Handle login dialog close
  handleLoginDialogClose(): void {
    this.logger.debug('Login dialog closed');
    this.showStandaloneLogin.set(false);
    this.loginDialogInitialStep.set(undefined);
  }

  // Open Terms of Use dialog
  openTermsOfUse(): void {
    this.logger.debug('Opening Terms of Use dialog');
    this.showTermsDialog.set(true);
  }

  // Handle Terms dialog close
  handleTermsDialogClose(): void {
    this.logger.debug('Terms dialog closed');
    this.showTermsDialog.set(false);
  }

  /**
   * Opens the login dialog with specific step
   * @param step - The specific login step to navigate to (optional)
   * @returns Promise that resolves when the dialog closes
   */
  async showLoginDialogWithStep(step?: string): Promise<void> {
    this.logger.debug('showLoginDialogWithStep called', { step });

    // Store the initial step so the standalone login dialog can use it
    this.loginDialogInitialStep.set(step);

    // Open the standalone login dialog
    this.showStandaloneLogin.set(true);

    this.logger.debug('Standalone login dialog opened with step', { step });

    // Return a promise that resolves when the dialog closes
    return new Promise<void>((resolve) => {
      // Set up an effect to watch for dialog close using runInInjectionContext
      runInInjectionContext(this.injector, () => {
        const cleanup = effect(() => {
          if (!this.showStandaloneLogin()) {
            this.logger.debug('Login dialog closed');
            // Clear the initial step
            this.loginDialogInitialStep.set(undefined);
            resolve();
            cleanup.destroy();
          }
        });
      });
    });
  }

  navigateToProfile(npub: string): void {
    // Profile always opens in the right panel
    this.router.navigate([{ outlets: { right: ['p', npub] } }]);
  }
  onSearchInput(event: any) {
    if (event.target.value === null) {
      clearTimeout(this.debounceTimer);
      return;
    }

    // Trim the input to remove leading/trailing whitespace
    const trimmedValue = event.target.value.trim();

    // Set query immediately for cached search results
    console.log('onSearchInput called with value:', trimmedValue);
    this.query.set(trimmedValue);

    // Debounce logic to wait until user finishes typing for special searches
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      console.log('Handle search called!');
      this.handleSearch(trimmedValue);
    }, 750);
  }
  private async handleSearch(value: string): Promise<void> {
    if (!value) {
      this.query.set('');
      return;
    }

    // Handle nostr: prefixed URLs first
    if (value.startsWith('nostr:')) {
      try {
        await this.handleNostrEntity(value.substring(6));
        return;
      } catch (error) {
        console.error('Failed to parse nostr URL:', error);
        this.toast('Invalid nostr URL format');
        return;
      }
    }

    // Handle nostr entities directly
    if (this.isNostrEntity(value)) {
      try {
        await this.handleNostrEntity(value);
        return;
      } catch (error) {
        console.warn('Failed to handle nostr entity:', value, error);
        // For entities that aren't recognized as valid nostr entities, continue with other logic
      }
    }

    // Handle other special cases
    if (value.includes('@')) {
      // Keep the query set for NIP-05 lookups (already set in onSearchInput)
      // The search service will handle this
    } else if (value.includes(':') && !value.startsWith('http')) {
      this.openProfile(value);
    } else {
      // For regular text searches, let the search service handle cached results
      // The query is already set in onSearchInput
      // Only navigate to search page if no cached results are found after a delay
      setTimeout(() => {
        // This could be enhanced to check if cached results were found
        // For now, we'll let the cached search work without navigation
      }, 100);
    }
  }

  /**
   * Handle any nostr entity by parsing and routing appropriately
   */
  private async handleNostrEntity(value: string): Promise<void> {
    if (!value) {
      return;
    }

    // Handle different nostr entity types
    if (value.startsWith('npub')) {
      this.toggleSearch();
      this.searchInput = '';
      this.openProfile(value);
      return;
    }

    if (value.startsWith('nprofile')) {
      this.toggleSearch();
      try {
        const decoded = nip19.decode(value).data as ProfilePointer;
        this.openProfile(decoded.pubkey);
      } catch (error) {
        console.warn('Failed to decode nprofile:', value, error);
        this.toast('Invalid profile format', 3000, 'error-snackbar');
      }
      return;
    }

    if (value.startsWith('nevent')) {
      this.toggleSearch();
      try {
        // Use the nevent value directly since openGenericEvent expects the encoded value
        this.openGenericEvent(value);
      } catch (error) {
        console.warn('Failed to decode nevent:', value, error);
        this.toast('Invalid event format', 3000, 'error-snackbar');
      }
      return;
    }

    if (value.startsWith('note')) {
      this.toggleSearch();
      try {
        // Note ID - open in right panel
        console.log('Opening note:', value);
        this.openGenericEvent(value);
      } catch (error) {
        console.warn('Failed to handle note:', value, error);
        this.toast('Invalid note format', 3000, 'error-snackbar');
      }
      return;
    }

    if (value.startsWith('naddr')) {
      this.toggleSearch();
      try {
        const decoded = nip19.decode(value).data as AddressPointer;

        if (decoded.kind === kinds.LongFormArticle) {
          // Route to article page for long-form articles
          this.openArticle(value);
        } else {
          // Route to event page for other addressable events (starter packs, etc.)
          this.openGenericEvent(value);
        }
      } catch (error) {
        console.warn('Failed to decode naddr:', value, error);
        this.toast('Invalid address format', 3000, 'error-snackbar');
      }
      return;
    }

    if (value.startsWith('nsec')) {
      this.toggleSearch();
      this.toast(
        'WARNING: You pasted your nsec key. This is a security risk! Please remove it from your clipboard.',
        5000,
        'error-snackbar'
      );
      return;
    }

    // If none of the specific cases match, throw an error
    throw new Error('Unsupported nostr entity type');
  }

  /**
   * Check if a value is a nostr entity (npub, nprofile, nevent, note, naddr, nsec)
   */
  private isNostrEntity(value: string): boolean {
    return (
      value.startsWith('npub') ||
      value.startsWith('nprofile') ||
      value.startsWith('nevent') ||
      value.startsWith('note') ||
      value.startsWith('naddr') ||
      value.startsWith('nsec')
    );
  }

  openProfile(pubkey: string): void {
    // Always use npub in URLs for consistency and bookmarkability
    const npub = pubkey.startsWith('npub') ? pubkey : nip19.npubEncode(pubkey);
    // Profile always opens in the right panel using named outlet routing
    this.router.navigate([{ outlets: { right: ['p', npub] } }]);
  }

  openEvent(eventId: string, event: Event, trustedByPubkey?: string): void {
    // Handle live event comments (kind 1311) - extract and open the referenced stream
    if (event.kind === 1311) {
      const aTag = event.tags.find((tag: string[]) => tag[0] === 'a');
      if (aTag && aTag[1]) {
        // Parse the "a" tag: "kind:pubkey:d-tag"
        const parts = aTag[1].split(':');
        if (parts.length === 3 && parts[0] === '30311') {
          // This is a reference to a live event (kind 30311)
          const [, pubkey, dTag] = parts;
          const relayHint = aTag[2] || '';
          const relays = relayHint ? [relayHint] : this.accountRelay.relays().map((r: { url: string }) => r.url).slice(0, 3);

          // Encode as naddr (for parameterized replaceable events)
          const naddr = nip19.naddrEncode({
            kind: 30311,
            pubkey: pubkey,
            identifier: dTag,
            relays: relays,
          });

          // Navigate to the stream
          this.router.navigate(['/stream', naddr]);
          return;
        }
      }
    }

    // Handle live events (kind 30311) - open the stream directly
    if (event.kind === 30311) {
      const relayHints = this.accountRelay.relays().map((r: { url: string }) => r.url).slice(0, 3);
      const dTag = event.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';

      // Encode as naddr (for parameterized replaceable events)
      const naddr = nip19.naddrEncode({
        kind: 30311,
        pubkey: event.pubkey,
        identifier: dTag,
        relays: relayHints,
      });

      // Navigate to the stream
      this.router.navigate(['/stream', naddr]);
      return;
    }

    let neventId = eventId;
    if (!neventId.startsWith('nevent')) {
      neventId = nip19.neventEncode({
        id: event.id,
        author: event.pubkey,
        kind: event.kind,
      });
    }
    if (event.kind === kinds.LongFormArticle) {
      this.openArticle(neventId, event);
    } else {
      this.openGenericEvent(neventId, event, trustedByPubkey);
    }
  }

  openGenericEvent(eventId: string, event?: Event, trustedByPubkey?: string): void {
    // Open events in the right panel using named outlet routing
    // This provides consistent behavior across all list views (bookmarks, summary, feeds, etc.)
    this.router.navigate([{ outlets: { right: ['e', eventId] } }], {
      state: { event, trustedByPubkey }
    });
  }

  private async openEventInDialog(eventId: string, event?: Event, trustedByPubkey?: string): Promise<void> {
    // Close existing dialog if any
    if (this.currentEventDialogRef) {
      this.currentEventDialogRef.close();
    }

    // Update URL without navigation to support back button
    // Use replaceState to avoid creating extra history entries
    const previousUrl = this.location.path();
    this.location.replaceState(`/e/${eventId}`);

    // Determine dialog title based on event author
    let dialogTitle = 'Thread';
    const pubkey = event?.pubkey;

    // Dynamically import EventDialogComponent to break circular dependency
    const { EventDialogComponent } = await import('../pages/event/event-dialog/event-dialog.component');

    // Open dialog using CustomDialogService
    this.currentEventDialogRef = this.customDialog.open(EventDialogComponent, {
      title: dialogTitle,
      width: '800px',
      maxWidth: '100%',
      showBackButton: true,
      showCloseButton: false,
      data: { eventId, event, trustedByPubkey },
    });

    // Set the data on the component instance
    this.currentEventDialogRef.componentInstance.data = { eventId, event, trustedByPubkey };

    // Fetch author profile to update dialog title
    if (pubkey) {
      this.onDemandUserData.getProfile(pubkey).then(profile => {
        if (profile && this.currentEventDialogRef) {
          const authorName = profile.data?.display_name || profile.data?.name;
          if (authorName) {
            dialogTitle = `${authorName}'s post`;
            // Update the dialog title dynamically
            this.currentEventDialogRef.updateTitle(dialogTitle);
          }
        }
      }).catch(() => {
        // Silently ignore profile fetch errors, keep default title
      });
    }

    // Restore URL when dialog is closed (only if not closed via back button)
    this.currentEventDialogRef.afterClosed$.subscribe(({ closedViaBackButton }) => {
      // Only restore URL if dialog was closed programmatically (not via back button)
      // When closed via back button, the browser already handled the URL navigation
      if (!closedViaBackButton) {
        this.location.replaceState(previousUrl);
      }
      this.currentEventDialogRef = null;
    });
  }

  openArticle(naddr: string, event?: Event): void {
    // Open article in the right panel using named outlet routing
    this.router.navigate([{ outlets: { right: ['a', naddr] } }], {
      state: { articleEvent: event }
    });
  }

  /**
   * Open a music playlist in the right panel
   */
  openMusicPlaylist(pubkey: string, dTag: string, event?: Event): void {
    this.router.navigate([{ outlets: { right: ['music', 'playlist', pubkey, dTag] } }], {
      state: { playlistEvent: event }
    });
  }

  /**
   * Open a music artist in the right panel
   */
  openMusicArtist(npub: string): void {
    this.router.navigate([{ outlets: { right: ['music', 'artist', npub] } }]);
  }

  /**
   * Open a song detail in the right panel
   */
  openSongDetail(pubkey: string, dTag: string, event?: Event): void {
    this.router.navigate([{ outlets: { right: ['music', 'song', pubkey, dTag] } }], {
      state: { songEvent: event }
    });
  }

  /**
   * Open liked songs in the right panel
   */
  openMusicLiked(): void {
    this.router.navigate([{ outlets: { right: ['music', 'liked'] } }]);
  }

  /**
   * Open liked playlists in the right panel
   */
  openMusicLikedPlaylists(): void {
    this.router.navigate([{ outlets: { right: ['music', 'liked-playlists'] } }]);
  }

  /**
   * Open music tracks list in the left panel
   */
  openMusicTracks(source?: 'following' | 'public'): void {
    const queryParams = source ? { source } : undefined;
    this.router.navigate(['/music/tracks'], { queryParams });
  }

  /**
   * Open music playlists list in the left panel
   */
  openMusicPlaylists(source?: 'following' | 'public'): void {
    const queryParams = source ? { source } : undefined;
    this.router.navigate(['/music/playlists'], { queryParams });
  }

  /**
   * Open interest sets in the left panel (it's a list view)
   */
  openInterestSets(): void {
    this.router.navigate(['/collections/interests']);
  }

  /**
   * Open emoji sets in the left panel (it's a list view)
   */
  openEmojiSets(): void {
    this.router.navigate(['/collections/emojis']);
  }

  /**
   * Navigate to search in the left panel with optional query
   */
  openSearchInLeftPanel(query?: string): void {
    if (query) {
      this.router.navigate(['/search'], { queryParams: { q: query } });
    } else {
      this.router.navigate(['/search']);
    }
  }

  openBadge(badge: string, event?: Event, extra?: NavigationExtras): void {
    this.router.navigate(['/b', badge], { ...extra, state: { event } });
  }

  scrollToOptimalProfilePosition() {
    this.scrollToOptimalPosition(this.optimalProfilePosition);
  }

  async createArticle(articleId?: string): Promise<CustomDialogRef<any>> {
    // Open the article editor dialog
    const { ArticleEditorDialogComponent } = await import('../components/article-editor-dialog/article-editor-dialog.component');

    const dialogRef = this.customDialog.open(ArticleEditorDialogComponent, {
      width: '920px',
      maxWidth: '100vw',
      disableClose: true,
      disableEnterSubmit: true,
      showCloseButton: true,
      title: articleId ? 'Edit Article' : 'New Article',
      data: { articleId },
      panelClass: 'article-editor-dialog'
    });

    // Set the dialogRef and data on the component instance
    dialogRef.componentInstance.dialogRef = dialogRef;
    dialogRef.componentInstance.data = { articleId };

    return dialogRef;
  }

  async uploadMedia(): Promise<void> {
    // Navigate to media page with upload parameter
    await this.router.navigate(['/collections/media'], { queryParams: { upload: 'true' } });
  }

  private nostrService = inject(NostrService);
  private mediaService = inject(MediaService);
  private publishService = inject(PublishService);

  openRecordVideoDialog(): void {
    const dialogRef = this.customDialog.open<VideoRecordDialogComponent, { file: File; uploadOriginal: boolean } | null>(
      VideoRecordDialogComponent,
      {
        title: 'Record Video',
        width: '600px',
        maxWidth: '90vw',
        disableClose: true,
        showCloseButton: true,
        panelClass: 'video-record-dialog-panel',
      }
    );

    dialogRef.afterClosed$.subscribe(async ({ result }) => {
      if (result && result.file) {
        try {
          // Set uploading state to true
          this.mediaService.uploading.set(true);

          // Upload the recorded video to media servers
          // Use uploadOriginal flag from dialog result
          const uploadResult = await this.mediaService.uploadFile(
            result.file,
            result.uploadOriginal ?? false,
            this.mediaService.mediaServers()
          );

          // Set the uploading state to false
          this.mediaService.uploading.set(false);

          // Handle the result
          if (uploadResult.status === 'success' && uploadResult.item) {
            this.snackBar.open('Video uploaded successfully', 'Close', {
              duration: 3000,
            });

            this.publishSingleItem(uploadResult.item);

            // Call the callback function if provided
            // if (onUploadComplete) {
            //   onUploadComplete(uploadResult.item);
            // }
          } else {
            this.snackBar.open('Failed to upload recorded video', 'Close', {
              duration: 3000,
            });
          }
        } catch {
          // Set the uploading state to false on error
          this.mediaService.uploading.set(false);

          this.snackBar.open('Failed to upload recorded video', 'Close', {
            duration: 3000,
          });
        }
      }
    });
  }

  openRecordAudioDialog(): void {
    const dialogRef = this.dialog.open(AudioRecordDialogComponent, {
      width: '400px',
      maxWidth: '90vw',
      panelClass: 'responsive-dialog',
      disableClose: true,
    });

    dialogRef.afterClosed().subscribe(async result => {
      if (result && result.blob) {
        // Confirm before publishing
        const confirmDialog = this.dialog.open(ConfirmDialogComponent, {
          data: {
            title: 'Publish Audio Clip?',
            message: 'Are you sure you want to publish this audio clip?',
            confirmText: 'Publish',
            cancelText: 'Cancel',
            confirmColor: 'primary'
          }
        });

        const confirmed = await confirmDialog.afterClosed().toPromise();

        if (!confirmed) {
          return;
        }

        try {
          this.mediaService.uploading.set(true);

          // Upload file
          const file = new File([result.blob], 'voice-message.mp4', { type: result.blob.type });
          const uploadResult = await this.mediaService.uploadFile(
            file,
            false,
            this.mediaService.mediaServers()
          );

          this.mediaService.uploading.set(false);

          if (uploadResult.status === 'success' && uploadResult.item) {
            // Create kind 1222 event
            const url = uploadResult.item.url;
            const duration = Math.round(result.duration);
            const waveform = result.waveform.join(' ');

            const tags = [
              ['imeta', `url ${url}`, `waveform ${waveform}`, `duration ${duration}`]
            ];

            // Also add 'alt' tag for clients that don't support kind 1222
            tags.push(['alt', 'Voice message']);

            const event = this.nostrService.createEvent(
              1222,
              url,
              tags
            );

            const signedEvent = await this.nostrService.signEvent(event);
            await this.accountRelay.publish(signedEvent);

            // Show the published event in right panel
            this.ngZone.run(() => {
              this.openGenericEvent(signedEvent.id);
            });
            this.snackBar.open('Voice message sent!', 'Close', { duration: 3000 });
          } else {
            this.snackBar.open('Failed to upload voice message', 'Close', { duration: 3000 });
          }
        } catch (error) {
          console.error('Failed to upload/publish audio:', error);
          this.mediaService.uploading.set(false);
          this.snackBar.open('Failed to publish audio clip.', 'Close', { duration: 3000 });
        }
      }
    });
  }

  /**
   * Open the media creator dialog for publishing photos/videos
   * Supports kind 20 (photo), kind 21 (video), kind 22 (short video)
   * with optional kind 1 note creation
   */
  openMediaCreatorDialog(): void {
    const dialogRef = this.customDialog.open<MediaCreatorDialogComponent, MediaCreatorResult>(
      MediaCreatorDialogComponent,
      {
        title: $localize`:@@media.creator.dialog.title:Post Media`,
        width: '950px',
        maxWidth: '95vw',
        disableClose: true,
        showCloseButton: true,
        panelClass: 'media-creator-dialog-panel',
      }
    );

    dialogRef.afterClosed$.subscribe(({ result }) => {
      if (result?.published) {
        // Show the published media event in right panel
        if (result.mediaEvent) {
          const nevent = nip19.neventEncode({
            id: result.mediaEvent.id,
            author: result.mediaEvent.pubkey,
            kind: result.mediaEvent.kind,
          });
          this.ngZone.run(() => {
            this.openGenericEvent(nevent);
          });
        }
      }
    });
  }

  private commandPaletteOpen = false;

  openCommandPalette(listening = false): void {
    // Prevent opening multiple command palettes
    if (this.commandPaletteOpen) {
      return;
    }

    this.commandPaletteOpen = true;
    const dialogRef = this.customDialog.open(CommandPaletteDialogComponent, {
      width: '600px',
      maxWidth: '90vw',
      panelClass: 'command-palette-dialog',
      showCloseButton: false,
      disableEnterSubmit: true
    });

    // Reset flag when dialog closes
    dialogRef.afterClosed$.subscribe(() => {
      this.commandPaletteOpen = false;
    });

    if (listening) {
      // Start recording immediately if opened in listening mode
      if (dialogRef.componentInstance) {
        dialogRef.componentInstance.startRecording();
      }
    }
  }

  /**
   * Publish a single media item to Nostr
   * @param item - The media item to publish
   * @returns Promise<boolean> - True if successfully published
   */
  async publishSingleItem(item: MediaItem): Promise<boolean> {
    // Open the publish dialog
    const dialogRef = this.dialog.open(MediaPublishDialogComponent, {
      data: {
        mediaItem: item,
      },
      maxWidth: '650px',
      width: '100%',
      panelClass: 'responsive-dialog',
    });

    const result: MediaPublishOptions | null = await dialogRef.afterClosed().toPromise();

    if (!result) {
      return false; // User cancelled
    }

    try {
      // Show publishing message
      this.snackBar.open('Publishing to Nostr...', '', { duration: 2000 });

      // Build the event
      const event = await this.buildMediaEvent(item, result);

      // Sign and publish the event
      const signedEvent = await this.nostrService.signEvent(event);

      // Prepare publish options with custom relays if provided
      const publishOptions: { useOptimizedRelays: boolean; customRelays?: string[] } = {
        useOptimizedRelays: false, // Publish to ALL account relays for media events
      };

      // Add custom relays if provided
      if (result.customRelays && result.customRelays.length > 0) {
        publishOptions.customRelays = result.customRelays;
      }

      const publishResult = await this.publishService.publish(signedEvent, publishOptions);

      if (publishResult.success) {
        this.snackBar.open('Successfully published to Nostr!', 'Close', {
          duration: 3000,
        });

        // Show the published event in right panel
        const neventId = nip19.neventEncode({
          id: signedEvent.id,
          author: signedEvent.pubkey,
          kind: signedEvent.kind,
        });
        this.openGenericEvent(neventId);

        return true;
      } else {
        this.snackBar.open('Failed to publish to some relays', 'Close', {
          duration: 5000,
        });
        return false;
      }
    } catch (error) {
      console.error('Error publishing media:', error);
      this.snackBar.open('Failed to publish media', 'Close', {
        duration: 3000,
      });
      return false;
    }
  }

  /**
   * Build a media event from a media item and publish options
   * @param item - The media item
   * @param options - Publishing options from the dialog
   * @returns The unsigned event
   */
  private async buildMediaEvent(item: MediaItem, options: MediaPublishOptions) {
    const tags: string[][] = [];

    // For kind 1 (regular note), build a simpler event structure
    if (options.kind === 1) {
      // Build content with description and media URL
      let content = options.content || '';
      if (content && !content.endsWith('\n')) {
        content += '\n';
      }
      content += item.url;

      // Add imeta tag according to NIP-92 for media attachment
      const imetaTag = ['imeta'];
      imetaTag.push(`url ${item.url}`);
      if (item.type) {
        imetaTag.push(`m ${item.type}`);
      }
      imetaTag.push(`x ${item.sha256}`);
      if (item.size) {
        imetaTag.push(`size ${item.size}`);
      }
      if (options.alt) {
        imetaTag.push(`alt ${options.alt}`);
      }
      // Add mirror URLs as fallback
      if (item.mirrors && item.mirrors.length > 0) {
        item.mirrors.forEach(mirrorUrl => {
          imetaTag.push(`fallback ${mirrorUrl}`);
        });
      }
      tags.push(imetaTag);

      // Add hashtags
      options.hashtags.forEach(tag => {
        tags.push(['t', tag]);
      });

      // Add content warning if provided
      if (options.contentWarning) {
        tags.push(['content-warning', options.contentWarning]);
      }

      // Add location if provided
      if (options.location) {
        tags.push(['location', options.location]);
      }

      // Add geohash if provided
      if (options.geohash) {
        tags.push(['g', options.geohash]);
      }

      // Add client tag (Nostria)
      tags.push(['client', 'nostria']);

      // Create the event
      return this.nostrService.createEvent(1, content, tags);
    }

    // Add d-tag for addressable events (kinds 34235, 34236)
    if ((options.kind === 34235 || options.kind === 34236) && options.dTag) {
      tags.push(['d', options.dTag]);
    }

    // Upload thumbnail blob if provided (for videos)
    let thumbnailUrl = options.thumbnailUrl;
    const thumbnailUrls: string[] = []; // Collect all thumbnail URLs (main + mirrors)
    if (options.thumbnailBlob && (options.kind === 21 || options.kind === 22 || options.kind === 34235 || options.kind === 34236)) {
      try {
        const thumbnailFile = new File([options.thumbnailBlob], 'thumbnail.jpg', { type: 'image/jpeg' });
        const uploadResult = await this.mediaService.uploadFile(
          thumbnailFile,
          false,
          this.mediaService.mediaServers()
        );

        if (uploadResult.status === 'success' && uploadResult.item) {
          thumbnailUrl = uploadResult.item.url;

          // Collect all thumbnail URLs: main URL + all mirrors (deduplicated)
          const allUrls = [uploadResult.item.url];
          if (uploadResult.item.mirrors && uploadResult.item.mirrors.length > 0) {
            allUrls.push(...uploadResult.item.mirrors);
          }

          // Deduplicate URLs
          const uniqueUrls = [...new Set(allUrls)];
          thumbnailUrls.push(...uniqueUrls);
        }
      } catch (error) {
        console.error('Failed to upload thumbnail during publish:', error);
      }
    } else if (thumbnailUrl) {
      // If thumbnail URL is provided but no blob was uploaded, use just that URL
      thumbnailUrls.push(thumbnailUrl);
    }

    // Add title tag if provided
    if (options.title && options.title.trim().length > 0) {
      tags.push(['title', options.title]);
    }

    // Build imeta tag according to NIP-92/94
    const imetaTag = ['imeta'];

    // Add URL
    imetaTag.push(`url ${item.url}`);

    // Add MIME type
    if (item.type) {
      imetaTag.push(`m ${item.type}`);
    }

    // Add SHA-256 hash
    imetaTag.push(`x ${item.sha256}`);

    // Add file size
    if (item.size) {
      imetaTag.push(`size ${item.size}`);
    }

    // Add alt text if provided
    if (options.alt) {
      imetaTag.push(`alt ${options.alt}`);
    }

    // Add dimensions if provided (for images or video thumbnails)
    if (options.imageDimensions && options.kind === 20) {
      imetaTag.push(`dim ${options.imageDimensions.width}x${options.imageDimensions.height}`);
    }

    // Add blurhash for images if provided
    if (options.blurhash && options.kind === 20) {
      imetaTag.push(`blurhash ${options.blurhash}`);
    }

    // For videos, add all thumbnail image URLs if provided (NIP-71)
    if (thumbnailUrls.length > 0 && (options.kind === 21 || options.kind === 22 || options.kind === 34235 || options.kind === 34236)) {
      thumbnailUrls.forEach(url => {
        imetaTag.push(`image ${url}`);
      });

      // Add thumbnail dimensions if available
      if (options.thumbnailDimensions) {
        imetaTag.push(`dim ${options.thumbnailDimensions.width}x${options.thumbnailDimensions.height}`);
      }
    }

    // For videos, add blurhash if provided (NIP-71)
    if (options.blurhash && (options.kind === 21 || options.kind === 22 || options.kind === 34235 || options.kind === 34236)) {
      imetaTag.push(`blurhash ${options.blurhash}`);
    }

    // For videos, add duration if provided
    if (options.duration !== undefined && (options.kind === 21 || options.kind === 22 || options.kind === 34235 || options.kind === 34236)) {
      imetaTag.push(`duration ${options.duration}`);
    }

    // Add mirror URLs as fallback
    if (item.mirrors && item.mirrors.length > 0) {
      item.mirrors.forEach(mirrorUrl => {
        imetaTag.push(`fallback ${mirrorUrl}`);
      });
    }

    tags.push(imetaTag);

    // Add published_at timestamp
    tags.push(['published_at', Math.floor(Date.now() / 1000).toString()]);

    // Add alt tag separately if provided (for accessibility)
    if (options.alt) {
      tags.push(['alt', options.alt]);
    }

    // Add content warning if provided
    if (options.contentWarning) {
      tags.push(['content-warning', options.contentWarning]);
    }

    // Add hashtags
    options.hashtags.forEach(tag => {
      tags.push(['t', tag]);
    });

    // Add location if provided
    if (options.location) {
      tags.push(['location', options.location]);
    }

    // Add geohash if provided
    if (options.geohash) {
      tags.push(['g', options.geohash]);
    }

    // Add origin tag for addressable events (NIP-71)
    if ((options.kind === 34235 || options.kind === 34236) && options.origin) {
      const originTag = ['origin', options.origin.platform];
      if (options.origin.externalId) {
        originTag.push(options.origin.externalId);
      }
      if (options.origin.url) {
        originTag.push(options.origin.url);
      }
      tags.push(originTag);
    }

    // Add MIME type as m tag for filtering (for images)
    if (item.type && options.kind === 20) {
      tags.push(['m', item.type]);
    }

    // Add x tag with hash for queryability
    tags.push(['x', item.sha256]);

    // Add client tag (Nostria)
    tags.push(['client', 'nostria']);

    // Create the event
    const event = this.nostrService.createEvent(
      options.kind,
      options.content,
      tags
    );

    return event;
  }

  /**
   * Scrolls the page to show half of the banner and the full profile picture
   */
  scrollToOptimalPosition(scrollPosition: number): void {
    // We need the banner height to calculate the optimal scroll position
    // const bannerHeight = this.getBannerHeight();

    console.log('Scrolling to optimal position:', scrollPosition);
    // // Calculate scroll position that shows half of the banner
    // // We divide banner height by 2 to show half of it
    // const scrollPosition = bannerHeight / 2;

    // Find the content wrapper element
    const contentWrapper = document.querySelector('.content-wrapper');
    if (contentWrapper) {
      // Scroll the content wrapper to the calculated position with smooth animation
      contentWrapper.scrollTo({
        top: scrollPosition,
        behavior: 'smooth',
      });

      this.logger.debug(
        'Scrolled content wrapper to optimal profile view position',
        scrollPosition
      );

      // Refresh scroll monitoring after programmatic scroll
      setTimeout(() => this.refreshScrollMonitoring(), 300);
    } else {
      this.logger.error('Could not find mat-drawer-content element for scrolling');
    }
  }

  /**
   * Returns the banner height based on the current viewport width
   */
  getBannerHeight(): number {
    // Default height of the banner is 300px (as defined in CSS)
    let bannerHeight = 300;

    // Check viewport width and return appropriate banner height
    // matching the responsive CSS values
    if (window.innerWidth <= 480) {
      bannerHeight = 150;
    } else if (window.innerWidth <= 768) {
      bannerHeight = 200;
    }

    return bannerHeight;
  }

  /**
   * Scrolls an element to the top of the page with smooth animation
   * @param elementSelector CSS selector for the element to scroll
   */ scrollToTop(elementSelector = '.content-wrapper'): void {
    const element = document.querySelector(elementSelector);
    if (element) {
      element.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
      this.logger.debug(`Scrolled ${elementSelector} to top`);

      // Refresh scroll monitoring after programmatic scroll
      setTimeout(() => this.refreshScrollMonitoring(), 300);
    } else {
      this.logger.error(`Could not find ${elementSelector} element for scrolling`);
    }
  }

  /**
   * Scrolls the main content area to the top - specifically for page navigation
   * Uses the mat-drawer-content element which is the main scrollable container
   */ scrollMainContentToTop(): void {
    // Try the mat-drawer-content first (main layout container)
    const matDrawerContent = document.querySelector('.mat-drawer-content');
    if (matDrawerContent) {
      matDrawerContent.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
      this.logger.debug('Scrolled mat-drawer-content to top');

      // Refresh scroll monitoring after programmatic scroll
      setTimeout(() => this.refreshScrollMonitoring(), 300);
      return;
    }

    // Fallback to content-wrapper
    const contentWrapper = document.querySelector('.content-wrapper');
    if (contentWrapper) {
      contentWrapper.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
      this.logger.debug('Fallback: scrolled content-wrapper to top');
      return;
    }

    // Final fallback to window scroll
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
    this.logger.debug('Final fallback: scrolled window to top');
  }

  /**
   * Gets the main scrollable content element
   * Returns the mat-drawer-content element or falls back to content-wrapper or document.documentElement
   */
  getMainContentElement(): Element {
    // Try the mat-drawer-content first (main layout container)
    const matDrawerContent = document.querySelector('.mat-drawer-content');
    if (matDrawerContent) {
      return matDrawerContent;
    }

    // Fallback to content-wrapper
    const contentWrapper = document.querySelector('.content-wrapper');
    if (contentWrapper) {
      return contentWrapper;
    }

    // Final fallback to document element
    return document.documentElement;
  }

  /**
   * Scrolls an element into view
   * @param elementSelector CSS selector for the element to scroll into view
   * @param block Position of the element relative to the viewport after scrolling
   * @param behavior Scrolling behavior
   */
  scrollToElement(
    elementSelector: string,
    block: ScrollLogicalPosition = 'start',
    behavior: ScrollBehavior = 'smooth'
  ): void {
    const element = document.querySelector(elementSelector);
    if (element) {
      element.scrollIntoView({
        behavior: behavior,
        block: block,
      });
      this.logger.debug(`Scrolled ${elementSelector} into view`);
    } else {
      this.logger.error(`Could not find ${elementSelector} element for scrolling into view`);

      // Fallback: try scrolling the parent container
      const contentWrapper = document.querySelector('.content-wrapper');
      if (contentWrapper) {
        contentWrapper.scrollTo({
          top: 0,
          behavior: behavior,
        });
        this.logger.debug('Fallback: scrolled content-wrapper to top');
      }
    }
  }

  /**
   * Scrolls the content wrapper to make a specific element visible
   * @param elementSelector CSS selector for the element to scroll to
   * @param offset Optional offset from the element's top (in pixels)
   * @param behavior Scrolling behavior
   */
  scrollToPosition(elementSelector: string, offset = 0, behavior: ScrollBehavior = 'smooth'): void {
    const container = document.querySelector('.content-wrapper');
    const targetElement = document.querySelector(elementSelector);

    if (!container) {
      this.logger.error('Could not find .content-wrapper element for scrolling');
      return;
    }

    if (!targetElement) {
      this.logger.error(`Could not find target element "${elementSelector}" for scrolling to`);
      return;
    }

    // Calculate the target element's position relative to the container
    const containerRect = container.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    const relativeTop = targetRect.top - containerRect.top + container.scrollTop + offset;

    container.scrollTo({
      top: relativeTop,
      behavior: behavior,
    });

    this.logger.debug(
      `Scrolled .content-wrapper to show element "${elementSelector}" at position ${relativeTop}`
    );
  }

  /**
   * Opens the profile picture in a larger view dialog
   */
  openProfilePicture(profile: NostrRecord): void {
    if (profile?.data.picture) {
      this.dialog.open(MediaPreviewDialogComponent, {
        data: {
          mediaUrl: profile.data.picture,
          mediaType: 'image',
          mediaTitle: profile.data.display_name || profile.data.name || 'Profile Picture',
        },
        maxWidth: '100vw',
        maxHeight: '100vh',
        width: '100vw',
        height: '100vh',
        panelClass: 'image-dialog-panel',
      });

      this.logger.debug('Opened profile picture dialog');
    }
  }

  /**
   * Navigate to messages page to start a new chat with this user
   */
  openSendMessage(pubkey: string) {
    this.logger.debug('Message requested for:', pubkey);
    this.router.navigate(['/messages'], {
      queryParams: { pubkey: pubkey },
    });
  }

  /**
   * Open gift premium dialog for a user
   * @param pubkey - The recipient's public key
   * @param recipientName - Optional display name for the recipient
   * @param recipientMetadata - Optional metadata object for the recipient
   */
  async openGiftPremiumDialog(
    pubkey: string,
    recipientName?: string,
    recipientMetadata?: Record<string, unknown>
  ): Promise<CustomDialogRef> {
    // No lightning address validation needed - payments go to Nostria, not the recipient

    // Dynamically import the dialog component
    const { GiftPremiumDialogComponent } = await import(
      '../components/gift-premium-dialog/gift-premium-dialog.component'
    );

    const dialogData = {
      recipientPubkey: pubkey,
      recipientName: recipientName,
      recipientMetadata: recipientMetadata,
    };

    return this.customDialog.open(GiftPremiumDialogComponent, {
      data: dialogData,
      width: '520px',
      maxWidth: '95vw',
      disableClose: true,
      title: 'Gift Premium Subscription',
      headerIcon: '',
      showCloseButton: true,
    });
  }

  openProfileBanner(profile: NostrRecord): void {
    if (profile?.data.banner) {
      this.dialog.open(MediaPreviewDialogComponent, {
        data: {
          mediaUrl: profile.data.banner,
          mediaType: 'image',
          mediaTitle: `${profile.data.display_name || profile.data.name || 'Profile'} Banner`,
        },
        maxWidth: '100vw',
        maxHeight: '100vh',
        width: '100vw',
        height: '100vh',
        panelClass: 'image-dialog-panel',
      });

      this.logger.debug('Opened profile picture dialog');
    }
  }

  shareEvent(event: Event): void {
    if (!event) {
      this.logger.error('Cannot share event: event is undefined');
      return;
    }

    // Share profile action using the Web Share API if available
    if (navigator.share) {
      navigator
        .share({
          title: `Nostria Event`,
          text: `Check out this event on Nostria`,
          url: window.location.href,
        })
        .then(() => {
          this.logger.debug('Event shared successfully');
        })
        .catch(error => {
          this.logger.error('Error sharing profile:', error);
        });
    } else {
      // Fallback if Web Share API is not available
      this.copyToClipboard(window.location.href, 'event URL');
    }
  }

  getCurrentUrl() {
    // Get the current URL without the query parameters
    const url = new URL(window.location.href);
    url.search = ''; // Remove query parameters
    return url.toString();
  }

  shareProfile(npub?: string, name?: string): void {
    if (!npub || !name) {
      this.logger.error('Cannot share profile: npub or name is undefined');
      return;
    }

    // Share profile action using the Web Share API if available
    if (navigator.share) {
      navigator
        .share({
          title: `${name}'s Nostr Profile`,
          text: `Check out ${npub} on Nostr`,
          url: window.location.href,
        })
        .then(() => {
          this.logger.debug('Profile shared successfully');
        })
        .catch(error => {
          this.logger.error('Error sharing profile:', error);
        });
    } else {
      // Fallback if Web Share API is not available
      this.copyToClipboard(window.location.href, 'profile URL');
    }
  }

  copyProfileUrl(npub: string | null | undefined, username?: string | null): void {
    if (!npub && !username) {
      return;
    }

    let url;
    if (username) {
      url = 'https://nostria.app/u/' + username;
    } else {
      url = 'https://nostria.app/p/' + npub;
    }
    this.copyToClipboard(url, 'profile URL');
  }

  navigateToDeleteEventPage(event: Event) {
    if (!event) {
      return;
    }

    const neventId = nip19.neventEncode({
      id: event.id,
      author: event.pubkey,
      kind: event.kind,
    });

    this.router.navigate(['/delete-event'], {
      queryParams: { eventId: neventId }
    });
  }

  toast(message: string, duration = 3000, panelClass = 'success-snackbar') {
    this.snackBar.open(message, 'Close', {
      duration,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
      panelClass,
    });
  }

  async showPublishResults(publishPromises: Promise<string>[] | null, itemName: string) {
    try {
      // Wait for all publishing results
      const results = await Promise.all(publishPromises || []);

      // Count successes and failures
      const successful = results.filter(result => result === '').length;
      const failed = results.length - successful;

      // Display appropriate notification
      if (failed === 0) {
        this.snackBar.open(
          `${itemName} saved successfully to ${successful} ${successful === 1 ? 'relay' : 'relays'}`,
          'Close',
          {
            duration: 3000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
            panelClass: 'success-snackbar',
          }
        );
      } else {
        this.snackBar.open(
          `${itemName} saved to ${successful} ${successful === 1 ? 'relay' : 'relays'}, failed on ${failed} ${failed === 1 ? 'relay' : 'relays'}`,
          'Close',
          {
            duration: 5000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
            panelClass: failed > successful ? 'error-snackbar' : 'warning-snackbar',
          }
        );
      }
    } catch (error) {
      console.error('Error publishing:', error);
      this.snackBar.open(`Failed to save ${itemName}`, 'Close', {
        duration: 5000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
        panelClass: 'error-snackbar',
      });
    }
  }

  /**
   * Save the current scroll position for a feed
   * @param feedId - The feed identifier
   * @param scrollPosition - The scroll position in pixels (optional, will read from content wrapper if not provided)
   */
  saveFeedScrollPosition(feedId: string, scrollPosition?: number): void {
    if (!feedId) return;

    // Check if there's an active account before saving scroll position
    if (!this.accountStateService.account()) {
      return;
    }

    let position = scrollPosition;
    if (position === undefined) {
      // Look for feed column content containers (multi-column layout)
      const columnContents = document.querySelectorAll('.column-content');

      if (columnContents.length > 0) {
        // Find the first column with actual scroll
        for (const column of Array.from(columnContents)) {
          if (column.scrollTop > 0) {
            position = column.scrollTop;
            console.log(`📍 Found scroll in column-content:`, position, 'px');
            break;
          }
        }

        // If no column has scrolled yet, use the first visible column
        if (position === undefined) {
          const firstColumn = columnContents[0];
          if (firstColumn && firstColumn.scrollHeight > firstColumn.clientHeight) {
            position = firstColumn.scrollTop;
          }
        }
      }

      // Fallback to other possible containers if column-content not found
      if (position === undefined) {
        const matDrawerContent = document.querySelector('mat-drawer-content');
        const matSidenavContent = document.querySelector('mat-sidenav-content');
        const elements = [matDrawerContent, matSidenavContent, document.documentElement, document.body];

        for (const element of elements) {
          if (element && element.scrollHeight > element.clientHeight) {
            position = element.scrollTop;
            break;
          }
        }
      }

      if (position === undefined) {
        return;
      }
    }

    this.feedScrollPositions.set(feedId, position);
  }

  /**
   * Restore the scroll position for a feed
   * @param feedId - The feed identifier
   * @param behavior - Scroll behavior ('auto' or 'smooth')
   */
  restoreFeedScrollPosition(feedId: string, behavior: ScrollBehavior = 'auto'): void {
    if (!feedId) return;

    // Check if there's an active account before restoring scroll position
    if (!this.accountStateService.account()) {
      return;
    }

    const position = this.feedScrollPositions.get(feedId);
    if (position === undefined) {
      return;
    }

    // Retry mechanism to wait for content to be fully rendered
    let attempts = 0;
    const maxAttempts = 15; // Try for up to 3 seconds (15 * 200ms)
    let lastScrollHeight = 0;
    let stableHeightCount = 0;

    const attemptRestore = () => {
      // Look for feed column content containers (multi-column layout)
      const columnContents = document.querySelectorAll('.column-content');
      let scrollContainer: Element | null = null;

      if (columnContents.length > 0) {
        // Use the first visible column
        scrollContainer = columnContents[0];
      } else {
        // Fallback to other possible containers
        const matDrawerContent = document.querySelector('mat-drawer-content');
        const matSidenavContent = document.querySelector('mat-sidenav-content');
        const elements = [matDrawerContent, matSidenavContent];

        for (const element of elements) {
          if (element && element.scrollHeight > element.clientHeight) {
            scrollContainer = element;
            break;
          }
        }
      }

      if (!scrollContainer) {
        if (attempts < maxAttempts) {
          attempts++;
          setTimeout(attemptRestore, 200);
        } else {
          this.logger.warn('No scrollable container found for scroll restoration after multiple attempts');
        }
        return;
      }

      const scrollHeight = scrollContainer.scrollHeight;
      const clientHeight = scrollContainer.clientHeight;
      const hasContent = scrollHeight > clientHeight;

      // Check if scroll height has stabilized (content finished loading)
      if (scrollHeight === lastScrollHeight) {
        stableHeightCount++;
      } else {
        stableHeightCount = 0;
        lastScrollHeight = scrollHeight;
      }

      // Wait for content to render AND stabilize (no height changes for 2 consecutive checks)
      // This ensures images and other dynamic content have loaded
      if ((!hasContent || stableHeightCount < 2) && attempts < maxAttempts) {
        attempts++;
        setTimeout(attemptRestore, 200);
        return;
      }

      // Restore scroll position
      scrollContainer.scrollTo({
        top: position,
        behavior: behavior,
      });
    };

    // Start attempting to restore after initial delay
    setTimeout(attemptRestore, 300);
  }

  /**
   * Get the saved scroll position for a feed
   * @param feedId - The feed identifier
   * @returns The saved scroll position or undefined if not found
   */
  getFeedScrollPosition(feedId: string): number | undefined {
    return this.feedScrollPositions.get(feedId);
  }

  /**
   * Clear the saved scroll position for a feed
   * @param feedId - The feed identifier
   */
  clearFeedScrollPosition(feedId: string): void {
    this.feedScrollPositions.delete(feedId);
    this.logger.debug(`Cleared scroll position for feed ${feedId}`);
  }

  /**
   * Clear all saved scroll positions
   */
  clearAllFeedScrollPositions(): void {
    this.feedScrollPositions.clear();
    this.logger.debug('Cleared all feed scroll positions');
  }

  /**
   * Scroll the main layout container to the top
   * Used by components that need to scroll to top when content changes or user clicks "scroll to top"
   * @param smooth - Whether to use smooth scrolling (default: true)
   * @param panel - Which panel to scroll ('left' or 'right', default: 'left')
   */
  scrollLayoutToTop(smooth = true, panel: 'left' | 'right' = 'left'): void {
    if (!isPlatformBrowser(this.platformId)) return;
    
    const panelSelector = panel === 'left' ? '.left-panel' : '.right-panel';
    const panelContainer = document.querySelector(panelSelector);
    if (panelContainer) {
      panelContainer.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'instant' });
    }
  }

  private setupGlobalScrollDetection(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.ngZone.runOutsideAngular(() => {
      // Check scroll position periodically to detect scrolling
      // This is more reliable than scroll events which might be throttled or not fire for all containers
      this.scrollCheckTimer = window.setInterval(() => {
        const currentX = window.scrollX;
        const currentY = window.scrollY;

        if (this.lastScrollPosition.x !== currentX || this.lastScrollPosition.y !== currentY) {
          // Scrolling detected
          if (!this.isScrolling()) {
            this.ngZone.run(() => this.isScrolling.set(true));
          }
          this.lastScrollPosition = { x: currentX, y: currentY };
        } else {
          // No change, scrolling stopped
          if (this.isScrolling()) {
            this.ngZone.run(() => this.isScrolling.set(false));
          }
        }
      }, 100);

      // Setup mobile nav scroll detection using event capturing
      // This catches scroll events from any element, including scrollable divs
      this.mobileScrollListener = (event: globalThis.Event) => {
        // Only process on mobile
        if (!this.isHandset()) return;

        const target = event.target;
        if (!target || !(target instanceof Element)) return;

        // Get scroll position - handle both element and document scrolling
        let scrollTop: number;
        if (target === document.documentElement || target === document.body) {
          scrollTop = window.scrollY || document.documentElement.scrollTop;
        } else {
          scrollTop = (target as HTMLElement).scrollTop;
        }

        const lastScrollTop = this.mobileNavScrollState.get(target) ?? scrollTop;
        const scrollDelta = scrollTop - lastScrollTop;

        // Show nav when at top of page
        if (scrollTop <= 5) {
          if (this.mobileNavScrollHidden()) {
            this.ngZone.run(() => this.mobileNavScrollHidden.set(false));
          }
          // Reset anchor point when at top
          this.mobileNavScrollState.set(target, scrollTop);
        }
        // Hide when scrolling down past threshold
        else if (scrollDelta > this.scrollDirectionThreshold) {
          if (!this.mobileNavScrollHidden()) {
            this.ngZone.run(() => this.mobileNavScrollHidden.set(true));
          }
          // Only update anchor when state changes or continuing in same direction
          this.mobileNavScrollState.set(target, scrollTop);
        }
        // Show when scrolling up past threshold
        else if (scrollDelta < -this.scrollDirectionThreshold) {
          if (this.mobileNavScrollHidden()) {
            this.ngZone.run(() => this.mobileNavScrollHidden.set(false));
          }
          // Only update anchor when state changes or continuing in same direction
          this.mobileNavScrollState.set(target, scrollTop);
        }
        // Don't update anchor for small movements - this allows delta to accumulate
        // when changing scroll direction
      };

      // Use capturing phase to catch scroll events from all elements
      document.addEventListener('scroll', this.mobileScrollListener as EventListener, { capture: true, passive: true });
    });
  }
}
