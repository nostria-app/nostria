import { inject, Injectable, signal, OnDestroy, effect, PLATFORM_ID } from '@angular/core';
import { NavigationExtras, Router } from '@angular/router';
import { LoggerService } from './logger.service';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MediaPreviewDialogComponent } from '../components/media-preview-dialog/media-preview.component';
import { Event, kinds, nip19 } from 'nostr-tools';
import { AddressPointer, EventPointer, ProfilePointer } from 'nostr-tools/nip19';
import { ProfileStateService } from './profile-state.service';
import { LoginDialogComponent } from '../components/login-dialog/login-dialog.component';
import { NostrRecord } from '../interfaces';
import { AccountStateService } from './account-state.service';
import { isPlatformBrowser } from '@angular/common';
import { LocalStorageService } from './local-storage.service';
import { PublishDialogComponent, PublishDialogData } from '../components/publish-dialog/publish-dialog.component';

@Injectable({
  providedIn: 'root',
})
export class LayoutService implements OnDestroy {
  /** Used to perform queries or search when input has been parsed to be NIP-5 or similar. */
  query = signal<string | null>(null);
  search = signal(false);
  router = inject(Router);
  private logger = inject(LoggerService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  isHandset = signal(false);
  isWideScreen = signal(false);
  breakpointObserver = inject(BreakpointObserver);
  optimalProfilePosition = 240;

  profileState = inject(ProfileStateService);
  accountStateService = inject(AccountStateService);
  overlayMode = signal(false);
  showMediaPlayer = signal(false);
  private readonly platformId = inject(PLATFORM_ID);
  readonly isBrowser = signal(isPlatformBrowser(this.platformId));
  localStorage = inject(LocalStorageService);

  // Scroll event signals

  /**
   * Signal that indicates whether the content wrapper is scrolled to the top
   *
   * Usage example in components:
   * ```typescript
   * import { inject, effect } from '@angular/core';
   * import { LayoutService } from '../services/layout.service';
   *     * export class MyComponent {
   *   private layout = inject(LayoutService);
   *
   *   constructor() {
   *     // React to scroll to top events
   *     effect(() => {
   *       // Only react if scroll monitoring is ready to prevent early triggers
   *       if (this.layout.scrollMonitoringReady() && this.layout.scrolledToTop()) {
   *         console.log('User scrolled to top - refresh data?');
   *         // Add your logic here (e.g., pull to refresh)
   *       }
   *     });
   *   }
   * }
   * ```
   */
  scrolledToTop = signal(false);

  /**
   * Signal that indicates whether the content wrapper is scrolled to the bottom
   *
   * Usage example in components:
   * ```typescript
   * import { inject, effect } from '@angular/core';
   * import { LayoutService } from '../services/layout.service';
   *
   * export class MyComponent {
   *   private layout = inject(LayoutService);
   *   private loading = signal(false);
   *     *   constructor() {
   *     // React to scroll to bottom events for infinite loading
   *     effect(() => {
   *       // Only react if scroll monitoring is ready to prevent early triggers
   *       if (this.layout.scrollMonitoringReady() && this.layout.scrolledToBottom() && !this.loading()) {
   *         console.log('User scrolled to bottom - load more data');
   *         this.loadMoreData();
   *       }
   *     });
   *   }
   *
   *   private async loadMoreData() {
   *     this.loading.set(true);
   *     try {
   *       // Fetch more data
   *       const newData = await this.dataService.loadMore();
   *       // Process and add to existing data
   *     } finally {
   *       this.loading.set(false);
   *     }
   *   }
   * }
   * ```
   */
  scrolledToBottom = signal(false);

  private scrollEventListener?: () => void;
  private contentWrapper?: Element;
  private isScrollMonitoringReady = signal(false);

  /**
   * Signal that indicates whether scroll monitoring is ready and initialized
   * Use this to ensure scroll signals are reliable before reacting to them
   */
  readonly scrollMonitoringReady = this.isScrollMonitoringReady.asReadonly();

  constructor() {
    // Monitor only mobile devices (not tablets)
    this.breakpointObserver.observe('(max-width: 599px)').subscribe((result) => {
      this.logger.debug('Breakpoint observer update', {
        isMobile: result.matches,
      });
      this.isHandset.set(result.matches);
    });

    this.breakpointObserver.observe('(min-width: 1200px)').subscribe((result) => {
      this.isWideScreen.set(result.matches);
    });
    effect(() => {
      if (this.isBrowser() && this.accountStateService.initialized()) {
        // Initialize scroll monitoring after a longer delay to ensure DOM is fully rendered
        setTimeout(() => {
          this.initializeScrollMonitoring();
        }, 500); // Increased from 100ms to 500ms to ensure full render
      }
    });
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
      this.logger.debug('Scroll position - at top changed:', {
        isAtTop,
        wasAtTop: currentAtTop,
        scrollTop,
        threshold,
      });
    }

    // Check if scrolled to bottom
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - threshold;
    const currentAtBottom = this.scrolledToBottom();
    if (isAtBottom !== currentAtBottom && this.isScrollMonitoringReady()) {
      this.scrolledToBottom.set(isAtBottom);
      this.logger.debug('Scroll position - at bottom changed:', {
        isAtBottom,
        wasAtBottom: currentAtBottom,
        scrollTop,
        clientHeight,
        scrollHeight,
        calculated: scrollTop + clientHeight,
        targetThreshold: scrollHeight - threshold,
      });
    }
  }

  /**
   * Manually refresh scroll monitoring (useful when content changes)
   */
  refreshScrollMonitoring(): void {
    this.checkScrollPosition();
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
  }

  toggleSearch() {
    const newSearchState = !this.search();
    this.search.set(newSearchState);
    if (newSearchState) {
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
    } else {
      // Remove ESC key listener when search is closed
      this.removeEscKeyListener();
      // Clear search input and query when closing
      this.searchInput = '';
      this.query.set('');
    }
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

  private debounceTimer: any;

  copyToClipboard(text: any | undefined | null, type: string, author?: string): void {
    if (text === null || text === undefined) {
      return;
    }

    if (type === 'nprofile') {
      const profilePointer: ProfilePointer = {
        pubkey: text,
        relays: this.profileState.relay?.getRelayUrls(),
      };
      text = nip19.nprofileEncode(profilePointer);
    }

    if (type === 'nevent') {
      const eventPointer: EventPointer = { id: text, author: author };
      text = nip19.neventEncode(eventPointer);
    }

    if (type === 'note') {
      debugger;
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
          },
        );
      })
      .catch((error) => {
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
      disableClose: false,
    });
  }

  // Method to show the welcome dialog
  showWelcomeDialog(): void {
    this.logger.debug('Showing welcome dialog');
    this.showWelcomeScreen.set(true);
  }

  async showLoginDialog(): Promise<void> {
    this.logger.debug('showLoginDialog called');
    // Apply the blur class to the document body before opening the dialog
    document.body.classList.add('blur-backdrop');

    const dialogRef = this.dialog.open(LoginDialogComponent, {
      // width: '400px',
      // maxWidth: '95vw',
      disableClose: true,
      // panelClass: 'welcome-dialog'
    });

    this.logger.debug('Initial login dialog opened');

    // Handle login completion and data loading
    dialogRef.afterClosed().subscribe(async () => {
      this.logger.debug('Login dialog closed');
      document.body.classList.remove('blur-backdrop');

      // If user is logged in after dialog closes, simulate data loading
      // if (this.nostrService.isLoggedIn()) {
      //   this.logger.debug('User logged in, loading data');
      // } else {
      //   this.logger.debug('User not logged in after dialog closed');
      // }
    });
  }

  /**
   * Opens the login dialog with specific step and blur backdrop
   * @param step - The specific login step to navigate to (optional)
   */
  async showLoginDialogWithStep(step?: string): Promise<void> {
    this.logger.debug('showLoginDialogWithStep called', { step });
    // Apply the blur class to the document body before opening the dialog
    document.body.classList.add('blur-backdrop');

    const dialogRef = this.dialog.open(LoginDialogComponent, {
      disableClose: true,
    });

    this.logger.debug('Login dialog opened with step', { step });

    // Navigate to specific step after dialog opens if provided
    if (step) {
      dialogRef.afterOpened().subscribe(() => {
        const componentInstance = dialogRef.componentInstance;
        if (step === 'new-user') {
          setTimeout(() => {
            componentInstance.startNewAccountFlow();
          }, 100);
        } else if (step === 'login') {
          setTimeout(() => {
            componentInstance.goToStep(componentInstance.LoginStep.LOGIN_OPTIONS);
          }, 100);
        }
      });
    }

    // Handle dialog close
    dialogRef.afterClosed().subscribe(async () => {
      this.logger.debug('Login dialog closed');
      document.body.classList.remove('blur-backdrop');
    });
  }

  navigateToProfile(npub: string): void {
    this.router.navigate(['/p', npub]);
    setTimeout(() => {
      this.scrollToOptimalProfilePosition();
    }, 300);
  }
  onSearchInput(event: any) {
    if (event.target.value === null) {
      clearTimeout(this.debounceTimer);
      return;
    }

    // Set query immediately for cached search results
    console.log('onSearchInput called with value:', event.target.value);
    this.query.set(event.target.value);

    // Debounce logic to wait until user finishes typing for special searches
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      console.log('Handle search called!');
      this.handleSearch(event.target.value);
    }, 750);
  }
  private handleSearch(value: string): void {
    if (!value) {
      this.query.set('');
      return;
    }

    if (value.startsWith('npub')) {
      this.toggleSearch();
      this.searchInput = '';
      this.openProfile(value);
    } else if (value.startsWith('nprofile')) {
      this.toggleSearch();
      try {
        const decoded = nip19.decode(value).data as ProfilePointer;
        this.openProfile(decoded.pubkey);
      } catch (error) {
        console.warn('Failed to decode nprofile:', value, error);
        this.toast('Invalid profile format', 3000, 'error-snackbar');
      }
    } else if (value.startsWith('nevent')) {
      this.toggleSearch();
      try {
        const decoded = nip19.decode(value).data as EventPointer;
        this.openGenericEvent(value);
      } catch (error) {
        console.warn('Failed to decode nevent:', value, error);
        this.toast('Invalid event format', 3000, 'error-snackbar');
      }
    } else if (value.includes('@')) {
      // Keep the query set for NIP-05 lookups (already set in onSearchInput)
      // The search service will handle this
    } else if (value.startsWith('nsec')) {
      this.toggleSearch();
      this.toast(
        'WARNING: You pasted your nsec key. This is a security risk! Please remove it from your clipboard.',
        5000,
        'error-snackbar',
      );
      return;
    } else if (value.startsWith('naddr')) {
      this.toggleSearch();
      try {
        const decoded = nip19.decode(value).data as AddressPointer;

        // If the naddr has a pubkey, we can discover them if not found locally.
        if (decoded.pubkey) {
        }
      } catch (error) {
        console.warn('Failed to decode naddr:', value, error);
        this.toast('Invalid address format', 3000, 'error-snackbar');
        return;
      }

      this.openArticle(value);
    } else if (value.includes(':')) {
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

  openProfile(pubkey: string): void {
    this.router.navigate(['/p', pubkey]);
  }

  openEvent(eventId: string, event: Event): void {
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
      this.openGenericEvent(neventId, event);
    }
  }

  openGenericEvent(naddr: string, event?: Event): void {
    this.router.navigate(['/e', naddr], { state: { event } });
  }

  openArticle(naddr: string, event?: Event): void {
    this.router.navigate(['/a', naddr], { state: { event } });
  }

  openBadge(badge: string, event?: Event, extra?: NavigationExtras): void {
    this.router.navigate(['/b', badge], { ...extra, state: { event } });
  }

  scrollToOptimalProfilePosition() {
    this.scrollToOptimalPosition(this.optimalProfilePosition);
  }

  createArticle(): void {
    // Navigate to article creation
    this.router.navigate(['/article/create']);
  }

  async uploadMedia(): Promise<void> {
    // Navigate to media page with upload parameter
    await this.router.navigate(['/media'], { queryParams: { upload: 'true' } });
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
        scrollPosition,
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
   * Scrolls an element into view
   * @param elementSelector CSS selector for the element to scroll into view
   * @param block Position of the element relative to the viewport after scrolling
   * @param behavior Scrolling behavior
   */
  scrollToElement(
    elementSelector: string,
    block: ScrollLogicalPosition = 'start',
    behavior: ScrollBehavior = 'smooth',
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
      `Scrolled .content-wrapper to show element "${elementSelector}" at position ${relativeTop}`,
    );
  }

  /**
   * Opens the profile picture in a larger view dialog
   */
  openProfilePicture(profile: NostrRecord): void {
    if (profile?.data.picture) {
      const dialogRef = this.dialog.open(MediaPreviewDialogComponent, {
        data: {
          mediaUrl: profile.data.picture,
          mediaType: 'image',
          mediaTitle: profile.data.display_name || profile.data.name || 'Profile Picture',
        },
        maxWidth: '100vw',
        maxHeight: '100vh',
        panelClass: 'profile-picture-dialog',
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

  openProfileBanner(profile: NostrRecord): void {
    if (profile?.data.banner) {
      const dialogRef = this.dialog.open(MediaPreviewDialogComponent, {
        data: {
          mediaUrl: profile.data.banner,
          mediaType: 'image',
          mediaTitle: `${profile.data.display_name || profile.data.name || 'Profile'} Banner`,
        },
        maxWidth: '100vw',
        maxHeight: '100vh',
        panelClass: 'profile-picture-dialog',
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
          title: `Nostra Event`,
          text: `Check out this event on Nostr`,
          url: window.location.href,
        })
        .then(() => {
          this.logger.debug('Event shared successfully');
        })
        .catch((error) => {
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
        .catch((error) => {
          this.logger.error('Error sharing profile:', error);
        });
    } else {
      // Fallback if Web Share API is not available
      this.copyToClipboard(window.location.href, 'profile URL');
    }
  }

  shareProfileUrl(npub: string | null | undefined): void {
    const username = this.accountStateService.subscription()?.username;

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
      const successful = results.filter((result) => result === '').length;
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
          },
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
          },
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
}
