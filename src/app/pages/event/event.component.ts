import {
  Component,
  effect,
  inject,
  signal,
  TransferState,
  untracked,
  computed,
  input,
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
  // Input for dialog mode - when provided, uses this instead of route params
  dialogEventId = input<string | undefined>(undefined);
  dialogEvent = input<Event | undefined>(undefined);
  // Optional: pubkey of a trusted user who shared this (for blur bypass on main event)
  trustedByPubkey = input<string | undefined>(undefined);

  // Computed to check if we're in dialog mode
  isInDialogMode = computed(() => !!this.dialogEventId());

  // Detect if event is rendered in the right panel outlet
  isInRightPanel = computed(() => {
    return this.route.outlet === 'right';
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
  id = signal<string | null>(null);
  userRelays: string[] = [];
  app = inject(ApplicationService);
  private routeParams = toSignal<ParamMap>(this.route.paramMap);
  replies = signal<Event[]>([]);
  threadedReplies = signal<ThreadedEvent[]>([]);

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

  // Track if the event has been deleted (NIP-09)
  isDeleted = signal(false);
  deletionReason = signal<string | null>(null);

  constructor() {
    // this.item = this.route.snapshot.data['data'];
    console.log('EventPageComponent initialized with data:', this.item);

    // Load saved reply filter from local storage
    this.loadSavedReplyFilter();

    if (this.transferState.hasKey(EVENT_STATE_KEY)) {
      const data = this.transferState.get<EventData | null>(EVENT_STATE_KEY, null);
      console.log('Transferred data:', data);
      if (data) {
        this.item = data;
      }
      this.transferState.remove(EVENT_STATE_KEY); // optional cleanup
    }

    // Check for router navigation state
    const navigation = this.router.currentNavigation();
    if (navigation?.extras.state?.['event']) {
      console.log('Router state event data:', navigation.extras.state['event']);
      this.event.set(navigation.extras.state['event'] as Event);
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
            await this.loadEvent(id);

            // Scroll to top when navigating to a new event
            setTimeout(() => this.layout.scrollMainContentToTop(), 100);
          }
        });
      }
    });

    // Effect to update document title with loading indicator
    effect(() => {
      const isLoading = this.isAnyLoading();
      const event = this.event();

      if (event) {
        const baseTitle = `Note by ${event.pubkey.slice(0, 8)}... - Nostria`;
        this.titleService.setTitle(isLoading ? `⏳ ${baseTitle}` : baseTitle);
      } else if (isLoading) {
        this.titleService.setTitle('⏳ Loading... - Nostria');
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

      // Use progressive loading to show content as it becomes available
      const progressiveLoader = this.eventService.loadThreadProgressively(nevent, this.item);
      let mainEvent: Event | undefined;

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
          // This runs asynchronously so it doesn't block the UI
          this.checkDeletionRequestForEvent(partialData.event);
        }

        if (partialData.parents !== undefined) {
          this.parentEvents.set(partialData.parents);
          this.isLoadingParents.set(false);
        }

        if (partialData.replies !== undefined) {
          this.replies.set(partialData.replies);
        }

        if (partialData.threadedReplies !== undefined) {
          this.threadedReplies.set(partialData.threadedReplies);
          // Only mark as not loading if we actually have replies OR if this is the final update
          // This prevents showing "No replies yet" during progressive loading
          if (partialData.threadedReplies.length > 0) {
            this.isLoadingReplies.set(false);
          }

          // If openThreadsExpanded is false, collapse top-level replies by default
          if (!this.localSettings.openThreadsExpanded() && partialData.threadedReplies.length > 0) {
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

      // Scroll to top after loading
      setTimeout(() => this.layout.scrollMainContentToTop(), 100);
    }
  }

  /**
   * Scrolls to the main event after thread context has been loaded
   * The CSS scroll-margin-top on #main-event handles the toolbar offset
   */
  private scrollToMainEvent(): void {
    const mainEventElement = document.getElementById('main-event');
    if (mainEventElement) {
      mainEventElement.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
        inline: 'nearest',
      });
    }
  }

  /**
   * Scrolls to the main event with retry logic to handle async content loading
   * Retries multiple times with increasing delays to ensure DOM is fully rendered
   * The CSS scroll-margin-top on #main-event handles the toolbar offset
   */
  private scrollToMainEventWithRetry(attempt = 0, maxAttempts = 5): void {
    const mainEventElement = document.getElementById('main-event');

    if (mainEventElement) {
      // Wait for next animation frame to ensure rendering is complete
      requestAnimationFrame(() => {
        // Additional timeout to ensure all content (including images) has loaded
        setTimeout(() => {
          const mainEventElement = document.getElementById('main-event');
          if (mainEventElement) {
            mainEventElement.scrollIntoView({
              behavior: attempt === 0 ? 'auto' : 'smooth',
              block: 'start',
              inline: 'nearest',
            });
          }
        }, 250);
      });
    } else if (attempt < maxAttempts) {
      // Element not found yet, retry with exponential backoff
      const delay = Math.min(200 * Math.pow(1.5, attempt), 1000); // Max 1 second
      setTimeout(() => {
        this.scrollToMainEventWithRetry(attempt + 1, maxAttempts);
      }, delay);
    }
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
