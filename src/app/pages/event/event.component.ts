import {
  Component,
  effect,
  inject,
  signal,
  TransferState,
  untracked,
  computed,
  input,
  ElementRef,
  DestroyRef,
} from '@angular/core';
import { LayoutService } from '../../services/layout.service';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { DataService } from '../../services/data.service';
import { Event, nip19 } from 'nostr-tools';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { UrlUpdateService } from '../../services/url-update.service';
import { EventComponent } from '../../components/event/event.component';
import { UtilitiesService } from '../../services/utilities.service';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { ApplicationService } from '../../services/application.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { EVENT_STATE_KEY, EventData } from '../../data-resolver';
import { EventService, Reaction, ThreadData, ThreadedEvent } from '../../services/event';
import { Title } from '@angular/platform-browser';
import { LocalSettingsService } from '../../services/local-settings.service';
import { RightPanelService } from '../../services/right-panel.service';
import { PanelNavigationService } from '../../services/panel-navigation.service';
import { InlineReplyEditorComponent } from '../../components/inline-reply-editor/inline-reply-editor.component';
import { FollowSetsService, FollowSet } from '../../services/follow-sets.service';
import { AccountStateService } from '../../services/account-state.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { EventFocusService } from '../../services/event-focus.service';

/** Description of the EventPageComponent
 *
 * Events and threads for events are retrieved from the OP's relays.
 * Nostr clients should ensure they post replies and reactions to the OP's relays.
 */

// export interface Reaction {
//   emoji: string;
//   count: number;
// }

// export interface ThreadedEvent {
//   event: Event;
//   replies: ThreadedEvent[];
//   level: number;
//   hasMoreReplies?: boolean;
//   deepestReplyId?: string;
// }

// Constants for follow set filter types
export const REPLY_FILTER_EVERYONE = 'everyone';
export const REPLY_FILTER_FOLLOWING = 'following';

@Component({
  selector: 'app-event-page',
  imports: [CommonModule, EventComponent, MatIconModule, MatButtonModule, MatProgressSpinnerModule, MatTooltipModule, MatMenuModule, MatDividerModule, InlineReplyEditorComponent],
  templateUrl: './event.component.html',
  styleUrl: './event.component.scss',
  host: {
    '[class.dialog-mode]': 'isInDialogMode()'
  }
})
export class EventPageComponent {
  // Unique instance ID for debugging
  private instanceId = Math.random().toString(36).substring(7);

  // Input for dialog mode - when provided, uses this instead of route params
  dialogEventId = input<string | undefined>(undefined);
  dialogEvent = input<Event | undefined>(undefined);
  // Optional: pubkey of a trusted user who shared this (for blur bypass on main event)
  trustedByPubkey = input<string | undefined>(undefined);

  // Computed to check if we're in dialog mode
  isInDialogMode = computed(() => !!this.dialogEventId());

  // Detect if event is rendered in the right panel outlet
  isInRightPanel = computed(() => {
    // Check both the route outlet property AND the current URL structure
    // The URL contains "(right:e/..." when the event is in the right panel
    const outletCheck = this.route.outlet === 'right';
    const urlCheck = this.router.url.includes('(right:');
    return outletCheck || urlCheck;
  });

  event = signal<Event | undefined>(undefined);
  private readonly utilities = inject(UtilitiesService);
  isLoading = signal(false);
  isLoadingParents = signal(false);
  isLoadingReplies = signal(false);
  error = signal<string | null>(null);
  layout = inject(LayoutService);
  nostrService = inject(NostrService);
  logger = inject(LoggerService);
  data = inject(DataService);
  url = inject(UrlUpdateService);
  eventService = inject(EventService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private rightPanel = inject(RightPanelService);
  private panelNav = inject(PanelNavigationService);
  followSetsService = inject(FollowSetsService);
  accountState = inject(AccountStateService);
  private accountLocalState = inject(AccountLocalStateService);
  private elementRef = inject(ElementRef);
  private readonly eventFocus = inject(EventFocusService);
  private readonly destroyRef = inject(DestroyRef);
  id = signal<string | null>(null);
  userRelays: string[] = [];
  app = inject(ApplicationService);
  private routeParams = toSignal<ParamMap>(this.route.paramMap);
  replies = signal<Event[]>([]);
  threadedReplies = signal<ThreadedEvent[]>([]);

  // Total reply count (including nested replies) - passed to app-event to avoid duplicate relay queries
  // Uses initial reply count from router state for instant display until thread is fully loaded
  totalReplyCount = computed<number>(() => {
    const replies = this.threadedReplies();
    const countFromReplies = this.countAllReplies(replies);

    // If we have actual replies loaded, use that count
    if (countFromReplies > 0) {
      return countFromReplies;
    }

    // Otherwise use the initial reply count from router state (if available)
    const initialCount = this.initialReplyCount();
    if (initialCount !== undefined) {
      return initialCount;
    }

    return 0;
  });

  /**
   * Recursively count all replies (including nested)
   */
  private countAllReplies(replies: ThreadedEvent[]): number {
    let count = replies.length;
    for (const reply of replies) {
      count += this.countAllReplies(reply.replies);
    }
    return count;
  }

  // Reply filter state
  // 'everyone' = no filter, 'following' = main contact list, or d-tag of a custom follow set
  selectedReplyFilter = signal<string>(REPLY_FILTER_EVERYONE);

  // Available follow sets for the filter menu
  availableFollowSets = computed<FollowSet[]>(() => this.followSetsService.followSets());

  // Get the currently selected follow set (for display)
  selectedFollowSetName = computed<string>(() => {
    const filter = this.selectedReplyFilter();
    if (filter === REPLY_FILTER_EVERYONE) return 'Everyone';
    if (filter === REPLY_FILTER_FOLLOWING) return 'Following';
    const set = this.availableFollowSets().find(s => s.dTag === filter);
    return set?.title || 'Custom List';
  });

  // Check if a reply filter is active
  isReplyFilterActive = computed<boolean>(() => this.selectedReplyFilter() !== REPLY_FILTER_EVERYONE);

  // Filtered threaded replies based on selected follow set
  filteredThreadedReplies = computed<ThreadedEvent[]>(() => {
    const filter = this.selectedReplyFilter();
    const replies = this.threadedReplies();

    // No filter - show all replies
    if (filter === REPLY_FILTER_EVERYONE) {
      return replies;
    }

    // Get the set of pubkeys to filter by
    let allowedPubkeys: Set<string>;

    if (filter === REPLY_FILTER_FOLLOWING) {
      // Use main following list
      allowedPubkeys = new Set(this.accountState.followingList());
    } else {
      // Use custom follow set
      const followSet = this.availableFollowSets().find(s => s.dTag === filter);
      if (!followSet) {
        // Follow set not found, show all
        return replies;
      }
      allowedPubkeys = new Set(followSet.pubkeys);
    }

    // Also include the main event author so their replies are always shown
    const mainEventPubkey = this.event()?.pubkey;
    if (mainEventPubkey) {
      allowedPubkeys.add(mainEventPubkey);
    }

    // Filter the threaded replies recursively
    return this.filterThreadedReplies(replies, allowedPubkeys);
  });

  /**
   * Recursively filter threaded replies to only include those from allowed pubkeys
   */
  private filterThreadedReplies(replies: ThreadedEvent[], allowedPubkeys: Set<string>): ThreadedEvent[] {
    const result: ThreadedEvent[] = [];

    for (const reply of replies) {
      // Check if this reply's author is in the allowed set
      const isAllowed = allowedPubkeys.has(reply.event.pubkey);

      // Recursively filter child replies
      const filteredChildren = this.filterThreadedReplies(reply.replies, allowedPubkeys);

      if (isAllowed) {
        // Include this reply with filtered children
        result.push({
          ...reply,
          replies: filteredChildren,
        });
      } else if (filteredChildren.length > 0) {
        // This reply is filtered out, but it has children that match
        // Include the children directly (they become top-level in this branch)
        result.push(...filteredChildren);
      }
      // If not allowed and no matching children, skip entirely
    }

    return result;
  }

  /**
   * Set the reply filter and persist it
   */
  setReplyFilter(filter: string): void {
    this.selectedReplyFilter.set(filter);
    // Persist to local storage
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setThreadReplyFilter(pubkey, filter);
    }
  }

  /**
   * Load saved reply filter from storage
   */
  private loadSavedReplyFilter(): void {
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      const savedFilter = this.accountLocalState.getThreadReplyFilter(pubkey);
      this.selectedReplyFilter.set(savedFilter);
    }
  }

  // Track collapsed thread IDs
  collapsedThreads = signal<Set<string>>(new Set());

  /**
   * Toggle the collapsed state of a thread
   */
  toggleThreadCollapse(eventId: string): void {
    this.collapsedThreads.update(set => {
      const newSet = new Set(set);
      if (newSet.has(eventId)) {
        newSet.delete(eventId);
      } else {
        newSet.add(eventId);
      }
      return newSet;
    });
  }

  /**
   * Check if a thread is collapsed
   */
  isThreadCollapsed(eventId: string): boolean {
    return this.collapsedThreads().has(eventId);
  }

  /**
   * Count total replies (including nested) for a threaded event
   */
  countReplies(threadedEvent: ThreadedEvent): number {
    let count = threadedEvent.replies.length;
    for (const reply of threadedEvent.replies) {
      count += this.countReplies(reply);
    }
    return count;
  }

  /**
   * Navigate back - handle both primary outlet and right panel scenarios
   */
  goBack(): void {
    // First check RightPanelService (for programmatic component-based panels)
    if (this.rightPanel.canGoBack()) {
      this.rightPanel.goBack();
      return;
    }

    // If in right panel outlet, use panel navigation
    if (this.isInRightPanel()) {
      this.panelNav.goBackRight();
      return;
    }

    // In primary outlet - check if there's left panel history to go back to
    if (this.panelNav.canGoBackLeft()) {
      this.panelNav.goBackLeft();
    } else {
      // No history - navigate to feeds as the default destination
      this.router.navigate(['/f']);
    }
  }

  transferState = inject(TransferState);
  parentEvents = signal<Event[]>([]);
  threadData = signal<ThreadData | null>(null);

  // Initial data from router state (pre-loaded from feed for instant rendering)
  private initialReplyCount = signal<number | undefined>(undefined);
  private initialParentEvent = signal<Event | undefined>(undefined);
  private initialReplies = signal<ThreadedEvent[] | undefined>(undefined);

  /**
   * Converts flat parent events array into a nested ThreadedEvent structure
   * so parents display with the same indentation as thread replies.
   * The structure nests from root -> child, with the last parent wrapping the main event's position.
   */
  threadedParents = computed<ThreadedEvent | null>(() => {
    const parents = this.parentEvents();
    if (parents.length === 0) return null;

    // Build nested structure from root (first) to immediate parent (last)
    // Each parent contains the next one as its single reply
    let result: ThreadedEvent | null = null;

    // Iterate in reverse to build from innermost to outermost
    for (let i = parents.length - 1; i >= 0; i--) {
      result = {
        event: parents[i],
        replies: result ? [result] : [],
        level: i,
      };
    }

    return result;
  });
  private titleService = inject(Title);
  localSettings = inject(LocalSettingsService);

  item!: EventData;
  reactions = signal<Reaction[]>([]);

  // Computed signal to track if anything is still loading
  isAnyLoading = computed(
    () => this.isLoading() || this.isLoadingParents() || this.isLoadingReplies()
  );

  showCompletionStatus = signal(false);
  deepResolutionProgress = signal<string>('');

  // Scroll management - prevents disruptive auto-scroll when user has manually scrolled
  private currentLoadGeneration = 0;
  private userHasScrolledDuringLoad = false;
  private scrollDetectionCleanup: (() => void) | null = null;
  private isPerformingAutoScroll = false;

  // Track if the event has been deleted (NIP-09)
  isDeleted = signal(false);
  deletionReason = signal<string | null>(null);

  constructor() {
    if (this.app.isBrowser()) {
      this.eventFocus.activate();
      this.destroyRef.onDestroy(() => {
        this.eventFocus.deactivate();
        this.scrollDetectionCleanup?.();
      });
    }

    // this.item = this.route.snapshot.data['data'];

    // Load saved reply filter from local storage
    this.loadSavedReplyFilter();

    if (this.transferState.hasKey(EVENT_STATE_KEY)) {
      const data = this.transferState.get<EventData | null>(EVENT_STATE_KEY, null);
      if (data) {
        this.item = data;
      }
      this.transferState.remove(EVENT_STATE_KEY); // optional cleanup
    }

    // Check for router navigation state
    const navigation = this.router.currentNavigation();
    if (navigation?.extras.state?.['event']) {
      this.event.set(navigation.extras.state['event'] as Event);
    }
    // Check for pre-loaded reply count from feed
    if (navigation?.extras.state?.['replyCount'] !== undefined) {
      this.initialReplyCount.set(navigation.extras.state['replyCount'] as number);
    }
    // Check for pre-loaded parent event from feed
    if (navigation?.extras.state?.['parentEvent']) {
      this.initialParentEvent.set(navigation.extras.state['parentEvent'] as Event);
    }
    // Check for pre-loaded replies from thread view (for instant rendering)
    if (navigation?.extras.state?.['replies']) {
      this.initialReplies.set(navigation.extras.state['replies'] as ThreadedEvent[]);
    }

    // Effect to load event when in dialog mode with direct event ID input
    effect(() => {
      const dialogEventId = this.dialogEventId();
      const dialogEvent = this.dialogEvent();

      if (dialogEventId) {
        untracked(async () => {
          // Set the event if provided
          if (dialogEvent) {
            this.event.set(dialogEvent);
          }
          await this.loadEvent(dialogEventId);
        });
      }
    });

    // Effect to load event when route parameter changes (normal routing mode)
    effect(() => {
      if (this.app.initialized() && this.routeParams() && !this.dialogEventId()) {
        untracked(async () => {
          const id = this.routeParams()?.get('id');
          if (id) {
            // Scroll to top immediately when navigating to a new event
            // Use panel-aware scrolling to avoid scrolling the wrong panel
            const panel = this.isInRightPanel() ? 'right' : 'left';
            this.layout.scrollLayoutToTop(true, panel);

            await this.loadEvent(id);
          }
        });
      }
    });

    // Effect to update document title with loading indicator
    effect(() => {
      const isLoading = this.isAnyLoading();
      const event = this.event();

      if (event) {
        this.titleService.setTitle(isLoading ? 'Nostria – ⏳ Thread' : 'Nostria – Thread');
      } else if (isLoading) {
        this.titleService.setTitle('Nostria – ⏳ Loading...');
      }
    });

    // Effect to scroll to main event when parent events are loaded
    effect(() => {
      const isLoadingParents = this.isLoadingParents();
      const parentEvents = this.parentEvents();
      const event = this.event();

      // If parent events have finished loading and we have parent events and a main event
      if (!isLoadingParents && parentEvents.length > 0 && event) {
        // Use requestAnimationFrame and multiple retries to ensure DOM is fully rendered
        this.scrollToMainEventWithRetry();
      }
    });
  }

  async loadEvent(nevent: string) {
    // this.logger.info('loadEvent called with nevent:', nevent);

    try {
      // Increment load generation to cancel any stale auto-scroll operations
      this.currentLoadGeneration++;
      this.userHasScrolledDuringLoad = false;
      if (this.app.isBrowser()) {
        this.setupUserScrollDetection();
      }

      this.isLoading.set(true);
      this.isLoadingParents.set(true);
      this.isLoadingReplies.set(true);
      this.error.set(null);
      this.showCompletionStatus.set(false);
      this.deepResolutionProgress.set('');

      // Reset state
      this.parentEvents.set([]);
      this.replies.set([]);
      this.threadedReplies.set([]);
      this.reactions.set([]);
      this.isDeleted.set(false);
      this.deletionReason.set(null);

      // Use pre-loaded parent event from router state for instant rendering
      const initialParent = this.initialParentEvent();
      if (initialParent) {
        // Set initial parent immediately for instant UI
        this.parentEvents.set([initialParent]);
        // Note: isLoadingParents stays true because we still want to fully resolve the parent chain
      }

      // Use pre-loaded replies from router state for instant rendering
      const initialRepliesData = this.initialReplies();
      if (initialRepliesData && initialRepliesData.length > 0) {
        // Set initial replies immediately for instant UI
        this.threadedReplies.set(initialRepliesData);
        // Mark loading as complete for replies since we have data
        // The progressive loader will update with fresh data from relays
        this.isLoadingReplies.set(false);
      }

      // Clear initial values after using them (only used once per navigation)
      this.initialParentEvent.set(undefined);
      this.initialReplies.set(undefined);
      // Note: Don't clear initialReplyCount here - it's used by totalReplyCount computed signal

      // Use progressive loading to show content as it becomes available
      const progressiveLoader = this.eventService.loadThreadProgressively(nevent, this.item);
      let mainEvent: Event | undefined;
      let deletionCheckStarted = false;

      for await (const partialData of progressiveLoader) {
        // Update signals with partial data as it becomes available
        if (partialData.event) {
          mainEvent = partialData.event;
          this.event.set(partialData.event);
          const hex = partialData.event.id;
          this.id.set(hex);

          // Update URL with proper encoding (naddr for addressable events, nevent for others)
          const encoded = this.utilities.encodeEventForUrl(partialData.event);

          // Always use /e/ route for event page (articles use /a/ route separately)
          this.url.updatePathSilently(['/e', encoded]);

          // Hide main loading spinner once we have the main event
          this.isLoading.set(false);

          // Check for deletion request for the main event (NIP-09)
          // Only check once per loadEvent call to avoid duplicate queries
          if (!deletionCheckStarted) {
            deletionCheckStarted = true;
            this.checkDeletionRequestForEvent(partialData.event);
          }
        }

        if (partialData.parents !== undefined) {
          this.parentEvents.set(partialData.parents);
          this.isLoadingParents.set(false);
        }

        if (partialData.replies !== undefined) {
          this.replies.set(partialData.replies);
        }

        // Only update threadedReplies when we actually have replies to show
        // This prevents flickering from multiple empty array updates during progressive loading
        if (partialData.threadedReplies !== undefined && partialData.threadedReplies.length > 0) {
          this.threadedReplies.set(partialData.threadedReplies);
          this.isLoadingReplies.set(false);
          // Clear initial reply count since we now have actual data
          this.initialReplyCount.set(undefined);

          // If openThreadsExpanded is false, collapse top-level replies by default
          if (!this.localSettings.openThreadsExpanded()) {
            const collapsedIds = new Set<string>();
            for (const reply of partialData.threadedReplies) {
              if (reply.replies.length > 0) {
                collapsedIds.add(reply.event.id);
              }
            }
            this.collapsedThreads.set(collapsedIds);
          }
        }

        if (partialData.reactions !== undefined) {
          this.reactions.set(partialData.reactions);
        }

        // Update threadData with current state
        this.threadData.set({
          event: partialData.event!,
          replies: partialData.replies || [],
          threadedReplies: partialData.threadedReplies || [],
          reactions: partialData.reactions || [],
          parents: partialData.parents || [],
          isThreadRoot: partialData.isThreadRoot || false,
          rootEvent: partialData.rootEvent || null,
        });
      }

      this.logger.info('Successfully completed progressive loading for event:', this.id());
    } catch (error) {
      this.logger.error('Error loading event:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load event';

      // If event not found, check if it was deleted (NIP-09)
      if (errorMessage === 'Event not found') {
        await this.checkIfEventWasDeleted(nevent);
      } else {
        this.error.set(errorMessage);
      }
    } finally {
      // Ensure all loading states are cleared
      this.isLoading.set(false);
      this.isLoadingParents.set(false);
      this.isLoadingReplies.set(false);

      // Show completion status briefly
      if (this.event()) {
        this.showCompletionStatus.set(true);
        setTimeout(() => this.showCompletionStatus.set(false), 3000);
      }

    }
  }

  /**
   * Scrolls to the main event after thread context has been loaded
   * Uses the component's own DOM to avoid affecting other panels
   * The CSS scroll-margin-top on #main-event handles the toolbar offset
   */
  private scrollToMainEvent(): void {
    // Query within component's own DOM to avoid finding element in wrong panel
    const mainEventElement = this.elementRef.nativeElement.querySelector('#main-event');
    if (mainEventElement) {
      // Find the scrollable container (panel) for this component
      const scrollContainer = this.findScrollContainer(mainEventElement);
      if (scrollContainer) {
        // Calculate the offset to scroll to
        const containerRect = scrollContainer.getBoundingClientRect();
        const elementRect = mainEventElement.getBoundingClientRect();
        const scrollTop = scrollContainer.scrollTop + (elementRect.top - containerRect.top);
        scrollContainer.scrollTo({
          top: scrollTop,
          behavior: 'smooth',
        });
      }
    }
  }

  /**
   * Scrolls to the main event with retry logic to handle async content loading
   * Retries a limited number of times to ensure DOM is rendered.
   * Skips scrolling if the user has manually scrolled since the load started.
   * Uses the component's own DOM to avoid affecting other panels.
   * The CSS scroll-margin-top on #main-event handles the toolbar offset.
   */
  private scrollToMainEventWithRetry(attempt = 0, maxAttempts = 3): void {
    const loadGeneration = this.currentLoadGeneration;

    // Don't scroll if user has already scrolled or a new load started
    if (this.userHasScrolledDuringLoad || loadGeneration !== this.currentLoadGeneration) return;

    // Query within component's own DOM to avoid finding element in wrong panel
    const mainEventElement = this.elementRef.nativeElement.querySelector('#main-event') as HTMLElement | null;

    if (mainEventElement) {
      // Wait for next animation frame to ensure rendering is complete
      requestAnimationFrame(() => {
        if (this.userHasScrolledDuringLoad || loadGeneration !== this.currentLoadGeneration) return;

        setTimeout(() => {
          if (this.userHasScrolledDuringLoad || loadGeneration !== this.currentLoadGeneration) return;

          const el = this.elementRef.nativeElement.querySelector('#main-event') as HTMLElement | null;
          if (el) {
            const scrollContainer = this.findScrollContainer(el);
            if (scrollContainer) {
              const containerRect = scrollContainer.getBoundingClientRect();
              const elementRect = el.getBoundingClientRect();
              const scrollTop = scrollContainer.scrollTop + (elementRect.top - containerRect.top);

              this.isPerformingAutoScroll = true;
              scrollContainer.scrollTo({
                top: scrollTop,
                behavior: 'instant',
              });
              // Clear the flag after the scroll event has propagated
              setTimeout(() => { this.isPerformingAutoScroll = false; }, 50);
            }
          }
        }, 150);
      });
    } else if (attempt < maxAttempts) {
      // Element not found yet, retry with exponential backoff
      const delay = Math.min(200 * Math.pow(1.5, attempt), 600);
      setTimeout(() => {
        if (this.userHasScrolledDuringLoad || loadGeneration !== this.currentLoadGeneration) return;
        this.scrollToMainEventWithRetry(attempt + 1, maxAttempts);
      }, delay);
    }
  }

  /**
   * Sets up a scroll listener on the panel container to detect user-initiated scrolls.
   * When detected, auto-scroll operations are suppressed for the current load.
   */
  private setupUserScrollDetection(): void {
    this.scrollDetectionCleanup?.();
    this.scrollDetectionCleanup = null;

    const generation = this.currentLoadGeneration;

    // Delay setup slightly so the initial scroll-to-top doesn't trigger detection
    setTimeout(() => {
      if (generation !== this.currentLoadGeneration) return;

      const scrollContainer = this.findScrollContainer(this.elementRef.nativeElement);
      if (!scrollContainer) return;

      const handler = () => {
        // Ignore programmatic auto-scrolls
        if (this.isPerformingAutoScroll) return;
        if (generation !== this.currentLoadGeneration) return;

        this.userHasScrolledDuringLoad = true;
        // Once detected, remove the listener — no need to keep listening
        scrollContainer.removeEventListener('scroll', handler);
      };

      scrollContainer.addEventListener('scroll', handler, { passive: true });
      this.scrollDetectionCleanup = () => scrollContainer.removeEventListener('scroll', handler);
    }, 300);
  }

  /**
   * Find the scrollable container (panel) for an element
   * Returns the .left-panel or .right-panel element that contains this component
   */
  private findScrollContainer(element: HTMLElement): HTMLElement | null {
    let current: HTMLElement | null = element;
    while (current) {
      if (current.classList.contains('left-panel') || current.classList.contains('right-panel')) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  async startDeepResolution() {
    const nevent = this.dialogEventId() || this.routeParams()?.get('id');
    if (!nevent) return;

    this.isLoading.set(true);
    this.error.set(null);
    this.deepResolutionProgress.set('Starting deep resolution...');

    try {
      // Decode to get hex ID
      let hex = nevent;
      if (!this.utilities.isHex(nevent)) {
        const decoded = this.utilities.decode(nevent);
        if (decoded.type === 'note') {
          hex = decoded.data;
        } else if (decoded.type === 'nevent') {
          hex = decoded.data.id;
        } else if (decoded.type === 'naddr') {
          // Addressable events might need different handling, but let's assume we can't deep resolve them by ID easily without kind/pubkey
          // But loadEventWithDeepResolution takes a string, presumably hex ID.
          // If it's naddr, we might not have a single hex ID to search for unless we know the event ID.
          // But loadEvent handles naddr separately.
          // If we are here, loadEvent failed.
          this.error.set('Cannot perform deep resolution on this event type');
          this.isLoading.set(false);
          return;
        }
      }

      const event = await this.eventService.loadEventWithDeepResolution(hex, (current, total, relays) => {
        this.deepResolutionProgress.set(`Scanning batch ${current}/${total} (${relays.length} relays)...`);
      });

      if (event) {
        this.deepResolutionProgress.set('Event found! Loading thread...');
        // Update item so loadEvent picks it up
        if (!this.item) {
          this.item = { title: '', description: '' };
        }
        this.item.event = event;

        // Restart loading
        await this.loadEvent(nevent);
      } else {
        this.error.set('Event not found');
        this.deepResolutionProgress.set('');
        this.isLoading.set(false);
      }
    } catch (err) {
      this.logger.error('Deep resolution error:', err);
      this.error.set('Deep resolution failed');
      this.isLoading.set(false);
    }
  }

  /**
   * Check if the main event has a deletion request (NIP-09)
   * If found, delete from local database and show deleted state
   */
  private async checkDeletionRequestForEvent(event: Event): Promise<void> {
    try {
      const deletionEvent = await this.eventService.checkDeletionRequest(event);

      if (deletionEvent) {
        this.logger.info('Event has been deleted by author:', {
          eventId: event.id,
          deletionEventId: deletionEvent.id,
          reason: deletionEvent.content || '(no reason given)',
        });

        // Delete from local database
        await this.eventService.deleteEventFromLocalStorage(event.id);

        // Update UI state
        this.isDeleted.set(true);
        this.deletionReason.set(deletionEvent.content || null);
        this.event.set(undefined);
        this.error.set('This event has been deleted by its author');
      }
    } catch (error) {
      this.logger.error('Error checking deletion request:', error);
      // Don't block the UI if deletion check fails
    }
  }

  /**
   * Check if an event was deleted when it cannot be found (NIP-09)
   * This extracts the event ID from the nevent/note and queries for deletion requests
   */
  private async checkIfEventWasDeleted(nevent: string): Promise<void> {
    try {
      // Extract the event ID from the nevent/note
      let eventId: string | null = null;

      if (this.utilities.isHex(nevent)) {
        eventId = nevent;
      } else {
        const decoded = this.utilities.decode(nevent);
        if (decoded.type === 'note') {
          eventId = decoded.data;
        } else if (decoded.type === 'nevent') {
          eventId = decoded.data.id;
        }
      }

      if (!eventId) {
        this.error.set('Event not found');
        return;
      }

      this.logger.info('Checking if event was deleted:', eventId);

      // Query for deletion request
      const deletionEvent = await this.eventService.checkDeletionRequestById(eventId);

      if (deletionEvent) {
        this.logger.info('Event was deleted:', {
          eventId,
          deletionEventId: deletionEvent.id,
          reason: deletionEvent.content || '(no reason given)',
        });

        // Update UI state to show deletion
        this.isDeleted.set(true);
        this.deletionReason.set(deletionEvent.content || null);
        this.error.set('This event has been deleted by its author');
      } else {
        // No deletion found, show regular "Event not found" message
        this.error.set('Event not found');
      }
    } catch (error) {
      this.logger.error('Error checking if event was deleted:', error);
      this.error.set('Event not found');
    }
  }
}
