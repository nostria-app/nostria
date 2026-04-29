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
  ChangeDetectionStrategy,
} from '@angular/core';
import { LayoutService } from '../../services/layout.service';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { DataService } from '../../services/data.service';
import { Event, kinds } from 'nostr-tools';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { UrlUpdateService } from '../../services/url-update.service';
import { EventComponent } from '../../components/event/event.component';
import { UtilitiesService } from '../../services/utilities.service';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSliderModule } from '@angular/material/slider';
import { ApplicationService } from '../../services/application.service';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { TrustService } from '../../services/trust.service';
import { PublishEventBus, PublishRelayResultEvent } from '../../services/publish-event-bus.service';
import { UserRelayService } from '../../services/relays/user-relay';
import { DatabaseService } from '../../services/database.service';
import { TtsSequencePlayerService } from '../../services/tts-sequence-player.service';
import { SettingsService } from '../../services/settings.service';

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
export const REPLY_FILTER_AUTHOR_FOLLOWING = 'author-following';
export const REPLY_FILTER_WOT = 'wot';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-event-page',
  imports: [CommonModule, EventComponent, MatIconModule, MatButtonModule, MatProgressSpinnerModule, MatTooltipModule, MatMenuModule, MatDividerModule, MatButtonToggleModule, MatSliderModule, InlineReplyEditorComponent],
  templateUrl: './event.component.html',
  styleUrl: './event.component.scss',
  host: {
    '[class.dialog-mode]': 'isInDialogMode()'
  }
})
export class EventPageComponent {
  readonly replyFilterEveryone = REPLY_FILTER_EVERYONE;
  readonly replyFilterFollowing = REPLY_FILTER_FOLLOWING;
  readonly replyFilterAuthorFollowing = REPLY_FILTER_AUTHOR_FOLLOWING;

  // Unique instance ID for debugging
  private instanceId = Math.random().toString(36).substring(7);

  // Input for dialog mode - when provided, uses this instead of route params
  dialogEventId = input<string | undefined>(undefined);
  dialogEvent = input<Event | undefined>(undefined);
  // Optional: pubkey of a trusted user who shared this (for blur bypass on main event)
  trustedByPubkey = input<string | undefined>(undefined);

  // Computed to check if we're in dialog mode
  isInDialogMode = computed(() => !!this.dialogEventId());

  // Reduce indentation on mobile to preserve horizontal space in thread view
  readonly threadIndent = computed(() => this.panelNav.isMobile() ? 8 : 16);

  // Cap the maximum indentation from parent events on mobile to prevent content being pushed off-screen
  readonly maxParentIndent = computed(() => {
    const indent = this.parentEvents().length * this.threadIndent();
    // On mobile, cap indent at 2 levels worth (16px) to keep content readable
    if (this.panelNav.isMobile()) {
      return Math.min(indent, 16);
    }
    return indent;
  });

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
  private readonly trustService = inject(TrustService);
  private publishEventBus = inject(PublishEventBus);
  private readonly userRelayService = inject(UserRelayService);
  private readonly database = inject(DatabaseService);
  protected readonly ttsSequence = inject(TtsSequencePlayerService);
  protected readonly settings = inject(SettingsService);
  id = signal<string | null>(null);
  userRelays: string[] = [];
  app = inject(ApplicationService);
  private routeParams = toSignal<ParamMap>(this.route.paramMap);
  replies = signal<Event[]>([]);
  threadedReplies = signal<ThreadedEvent[]>([]);

  /** Filter for comment kinds: 'all' shows both kind 1 and 1111, 'nip10' shows only kind 1, 'nip22' shows only kind 1111 */
  commentKindFilter = signal<'all' | 'nip10' | 'nip22'>('all');

  /** Whether we have any NIP-22 comments in the thread */
  hasNip22Comments = computed(() => this.threadedReplies().some(r => this.containsKind(r, 1111)));

  /** Whether we have any NIP-10 replies in the thread */
  hasNip10Replies = computed(() => this.threadedReplies().some(r => this.containsKind(r, 1)));

  /** Whether to show the kind filter (only when both kinds exist) */
  showKindFilter = computed(() => this.hasNip22Comments() && this.hasNip10Replies());

  /** Check recursively if a threaded event tree contains events of a specific kind */
  private containsKind(thread: ThreadedEvent, kind: number): boolean {
    if (thread.event.kind === kind) return true;
    return thread.replies.some(r => this.containsKind(r, kind));
  }

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

  startThreadReadAloud(modelId: string): void {
    const events = this.getThreadTtsEvents();
    this.ttsSequence.start('thread', 'Thread', events, modelId);
  }

  private getThreadTtsEvents(): Event[] {
    const mainEvent = this.event();
    const events = [
      ...this.parentEvents(),
      ...(mainEvent ? [mainEvent] : []),
      ...this.flattenThreadedEvents(this.filteredThreadedReplies()),
    ];

    const seen = new Set<string>();
    return events.filter(event => {
      if (seen.has(event.id)) {
        return false;
      }

      seen.add(event.id);
      return true;
    });
  }

  private flattenThreadedEvents(replies: ThreadedEvent[]): Event[] {
    const events: Event[] = [];
    for (const reply of replies) {
      events.push(reply.event, ...this.flattenThreadedEvents(reply.replies));
    }
    return events;
  }

  // Reply filter state
  // 'everyone' = no filter, 'following' = main contact list, or d-tag of a custom follow set
  selectedReplyFilter = signal<string>(REPLY_FILTER_EVERYONE);

  activeReplyFilter = computed<string>(() => {
    const filter = this.selectedReplyFilter();
    if (filter === REPLY_FILTER_AUTHOR_FOLLOWING && !this.supportsAuthorFollowingFilter()) {
      return REPLY_FILTER_EVERYONE;
    }

    return filter;
  });

  // WoT minimum rank threshold (0 = no minimum, 100 = maximum trust required)
  wotMinRank = signal<number>(0);

  private authorFollowingPubkeys = signal<string[]>([]);
  private authorFollowingTimestamp = signal<number>(0);
  authorFollowingLoaded = signal(false);
  private authorFollowingRequestId = 0;
  private lastAuthorFollowingPubkey: string | null = null;

  threadOriginalPoster = computed<string | undefined>(() => this.threadData()?.rootEvent?.pubkey ?? this.event()?.pubkey);

  supportsAuthorFollowingFilter = computed<boolean>(() => {
    const sourceEvent = this.threadData()?.rootEvent ?? this.event();
    return sourceEvent?.kind === kinds.ShortTextNote;
  });

  authorFollowingAllowedPubkeys = computed<Set<string>>(() => {
    const allowedPubkeys = new Set(this.authorFollowingPubkeys());
    const originalPoster = this.threadOriginalPoster();
    if (originalPoster) {
      allowedPubkeys.add(originalPoster);
    }
    return allowedPubkeys;
  });

  isAuthorFollowingInteractionLocked = computed<boolean>(() => {
    if (this.activeReplyFilter() !== REPLY_FILTER_AUTHOR_FOLLOWING) {
      return false;
    }

    const viewerPubkey = this.accountState.pubkey();
    const originalPoster = this.threadOriginalPoster();
    if (!viewerPubkey || !originalPoster || viewerPubkey === originalPoster) {
      return false;
    }

    return !this.authorFollowingAllowedPubkeys().has(viewerPubkey);
  });

  authorFollowingInteractionDisabledReason = computed<string | null>(() => {
    if (!this.isAuthorFollowingInteractionLocked()) {
      return null;
    }

    return 'Only accounts followed by the original poster can interact in this thread.';
  });

  // Available follow sets for the filter menu
  availableFollowSets = computed<FollowSet[]>(() => this.followSetsService.followSets());

  // Get the currently selected follow set (for display)
  selectedFollowSetName = computed<string>(() => {
    const filter = this.activeReplyFilter();
    if (filter === REPLY_FILTER_EVERYONE) return 'Everyone';
    if (filter === REPLY_FILTER_FOLLOWING) return 'Your Following';
    if (filter === REPLY_FILTER_AUTHOR_FOLLOWING) return 'Author Following';
    // Legacy WoT-only filter: treat as Everyone with WoT slider
    if (filter === REPLY_FILTER_WOT) return 'Everyone';
    const set = this.availableFollowSets().find(s => s.dTag === filter);
    return set?.title || 'Custom List';
  });

  // Check if a reply filter is active
  isReplyFilterActive = computed<boolean>(() => this.activeReplyFilter() !== REPLY_FILTER_EVERYONE || this.wotMinRank() > 0);

  // Filtered threaded replies based on selected follow set and WoT threshold
  filteredThreadedReplies = computed<ThreadedEvent[]>(() => {
    const filter = this.activeReplyFilter();
    const kindFilter = this.commentKindFilter();
    const minRank = this.wotMinRank();
    let replies = this.threadedReplies();

    // Apply kind filter first
    if (kindFilter !== 'all') {
      const allowedKind = kindFilter === 'nip22' ? 1111 : 1;
      replies = this.filterByKind(replies, allowedKind);
    }

    const mainEventPubkey = this.event()?.pubkey;
    const originalPoster = this.threadOriginalPoster();
    const currentAccountPubkey = this.accountState.pubkey();

    // Apply people filter first (if not 'everyone')
    if (filter === REPLY_FILTER_FOLLOWING) {
      const allowedPubkeys = new Set(this.accountState.followingList());
      if (mainEventPubkey) allowedPubkeys.add(mainEventPubkey);
      if (currentAccountPubkey) allowedPubkeys.add(currentAccountPubkey);
      replies = this.filterThreadedReplies(replies, allowedPubkeys);
    } else if (filter === REPLY_FILTER_AUTHOR_FOLLOWING) {
      replies = this.filterThreadedReplies(replies, this.authorFollowingAllowedPubkeys());
    } else if (filter !== REPLY_FILTER_EVERYONE && filter !== REPLY_FILTER_WOT) {
      // Custom follow set
      const followSet = this.availableFollowSets().find(s => s.dTag === filter);
      if (followSet) {
        const allowedPubkeys = new Set(followSet.pubkeys);
        if (mainEventPubkey) allowedPubkeys.add(mainEventPubkey);
        if (currentAccountPubkey) allowedPubkeys.add(currentAccountPubkey);
        replies = this.filterThreadedReplies(replies, allowedPubkeys);
      }
    }

    // Apply WoT rank filter (either standalone WoT filter or combined with people filter via slider)
    if (filter === REPLY_FILTER_WOT || minRank > 0) {
      replies = this.filterThreadedRepliesByWot(replies, originalPoster ?? mainEventPubkey, minRank, currentAccountPubkey);
    }

    return replies;
  });

  // Number of replies hidden by the active filter
  hiddenReplyCount = computed<number>(() => {
    const total = this.countAllReplies(this.threadedReplies());
    const visible = this.countAllReplies(this.filteredThreadedReplies());
    return total - visible;
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
        // Keep disallowed connector replies when they have matching descendants.
        // This preserves thread structure and avoids making intermediate events disappear.
        result.push({
          ...reply,
          replies: filteredChildren,
        });
      }
      // If not allowed and no matching children, skip entirely
    }

    return result;
  }

  /**
   * Recursively filter threaded replies by Web of Trust rank.
   * Only include replies from users with a trust rank >= minRank or the main event author.
   */
  private filterThreadedRepliesByWot(
    replies: ThreadedEvent[],
    mainEventPubkey?: string,
    minRank = 1,
    currentAccountPubkey = this.accountState.pubkey(),
  ): ThreadedEvent[] {
    const result: ThreadedEvent[] = [];
    const effectiveMinRank = minRank > 0 ? minRank : 1;

    for (const reply of replies) {
      const rank = this.trustService.getRankSignal(reply.event.pubkey);
      const isAllowed = reply.event.pubkey === mainEventPubkey
        || reply.event.pubkey === currentAccountPubkey
        || (typeof rank === 'number' && rank >= effectiveMinRank);

      // Recursively filter child replies
      const filteredChildren = this.filterThreadedRepliesByWot(reply.replies, mainEventPubkey, minRank, currentAccountPubkey);

      if (isAllowed) {
        result.push({
          ...reply,
          replies: filteredChildren,
        });
      } else if (filteredChildren.length > 0) {
        // Keep non-trusted connector replies when they have trusted descendants
        result.push({
          ...reply,
          replies: filteredChildren,
        });
      }
    }

    return result;
  }

  /**
   * Set the reply filter and persist it
   */
  /** Recursively filter threaded replies to only include events of a specific kind */
  private filterByKind(replies: ThreadedEvent[], kind: number): ThreadedEvent[] {
    const result: ThreadedEvent[] = [];
    for (const reply of replies) {
      const filteredChildren = this.filterByKind(reply.replies, kind);
      if (reply.event.kind === kind) {
        result.push({ ...reply, replies: filteredChildren });
      } else if (filteredChildren.length > 0) {
        // Keep non-matching parents that have matching descendants to preserve thread structure
        result.push({ ...reply, replies: filteredChildren });
      }
    }
    return result;
  }

  setCommentKindFilter(filter: 'all' | 'nip10' | 'nip22'): void {
    this.commentKindFilter.set(filter);
  }

  setReplyFilter(filter: string): void {
    this.selectedReplyFilter.set(filter);
    // Persist to local storage
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setThreadReplyFilter(pubkey, filter);
    }
  }

  setReplyFilterAndClose(filter: string, menuTrigger: MatMenuTrigger): void {
    this.setReplyFilter(filter);
    menuTrigger.closeMenu();
  }

  setWotMinRank(rank: number): void {
    this.wotMinRank.set(rank);
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setThreadWotMinRank(pubkey, rank);
    }
  }

  /**
   * Load saved reply filter from storage
   */
  private loadSavedReplyFilter(): void {
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      let savedFilter = this.accountLocalState.getThreadReplyFilter(pubkey);
      // Migrate legacy WoT-only filter to everyone + wotMinRank
      if (savedFilter === REPLY_FILTER_WOT) {
        savedFilter = REPLY_FILTER_EVERYONE;
        this.accountLocalState.setThreadReplyFilter(pubkey, savedFilter);
        if (this.accountLocalState.getThreadWotMinRank(pubkey) === 0) {
          this.accountLocalState.setThreadWotMinRank(pubkey, 1);
        }
      }
      this.selectedReplyFilter.set(savedFilter);
      const savedMinRank = this.accountLocalState.getThreadWotMinRank(pubkey);
      this.wotMinRank.set(savedMinRank);
    }
  }

  private resetAuthorFollowingList(): void {
    this.authorFollowingRequestId++;
    this.lastAuthorFollowingPubkey = null;
    this.authorFollowingPubkeys.set([]);
    this.authorFollowingTimestamp.set(0);
    this.authorFollowingLoaded.set(false);
  }

  private applyAuthorFollowingEvent(event: Event): void {
    if (event.kind !== kinds.Contacts) {
      return;
    }

    const currentTimestamp = this.authorFollowingTimestamp();
    if (event.created_at < currentTimestamp) {
      return;
    }

    this.authorFollowingPubkeys.set(this.utilities.getPTagsValuesFromEvent(event));
    this.authorFollowingTimestamp.set(event.created_at);
  }

  private async loadAuthorFollowingList(pubkey: string): Promise<void> {
    const requestId = ++this.authorFollowingRequestId;
    this.lastAuthorFollowingPubkey = pubkey;
    this.authorFollowingPubkeys.set([]);
    this.authorFollowingTimestamp.set(0);
    this.authorFollowingLoaded.set(false);

    try {
      const cachedEvent = await this.database.getEventByPubkeyAndKind(pubkey, kinds.Contacts);
      if (requestId !== this.authorFollowingRequestId) {
        return;
      }

      if (cachedEvent) {
        this.applyAuthorFollowingEvent(cachedEvent);
      }

      const relayEvent = await this.userRelayService.getEventByPubkeyAndKind(pubkey, kinds.Contacts);
      if (requestId !== this.authorFollowingRequestId) {
        return;
      }

      if (relayEvent) {
        this.applyAuthorFollowingEvent(relayEvent);
        this.database.saveReplaceableEvent(relayEvent).catch((error) => {
          this.logger.debug('Failed to cache author following list:', error);
        });
      }
    } catch (error) {
      if (requestId !== this.authorFollowingRequestId) {
        return;
      }

      this.logger.debug('Failed to load author following list for thread filter:', error);
    } finally {
      if (requestId === this.authorFollowingRequestId) {
        this.authorFollowingLoaded.set(true);
      }
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

  missingKnownParentIds = computed<string[]>(() => {
    const currentEvent = this.event();
    if (!currentEvent) {
      return [];
    }

    if (currentEvent.kind !== kinds.ShortTextNote) {
      return [];
    }

    const tags = this.eventService.getEventTags(currentEvent);
    const expectedParentIds: string[] = [];

    if (tags.rootId) {
      expectedParentIds.push(tags.rootId);
    }

    for (const intermediate of tags.intermediates) {
      expectedParentIds.push(intermediate.id);
    }

    if (tags.replyId) {
      expectedParentIds.push(tags.replyId);
    }

    const loadedParentIds = new Set(this.parentEvents().map((parent) => parent.id));
    const uniqueExpectedIds = Array.from(new Set(expectedParentIds)).filter((id) => id !== currentEvent.id);

    return uniqueExpectedIds.filter((id) => !loadedParentIds.has(id));
  });

  missingKnownParentCount = computed<number>(() => this.missingKnownParentIds().length);

  shouldShowParentLoadingPlaceholder = computed<boolean>(() => {
    return this.isLoadingParents() && this.parentEvents().length === 0 && this.missingKnownParentCount() > 0;
  });

  shouldShowMissingParentPlaceholder = computed<boolean>(() => {
    return !this.isLoadingParents() && this.missingKnownParentCount() > 0;
  });

  missingParentPlaceholderText = computed<string>(() => {
    return this.missingKnownParentCount() === 1
      ? 'A parent event is referenced in this thread, but it could not be loaded.'
      : 'Some parent events are referenced in this thread, but they could not be loaded.';
  });

  /**
   * True when any parent in the thread chain is collapsed.
   * In that state, descendant content (main event, inline reply editor, and replies)
   * should stay hidden until the parent chain is expanded again.
   */
  isMainThreadHiddenByCollapsedParent = computed<boolean>(() => {
    const collapsed = this.collapsedThreads();
    const parents = this.parentEvents();
    return parents.some(parent => collapsed.has(parent.id));
  });

  private titleService = inject(Title);
  localSettings = inject(LocalSettingsService);

  item!: EventData;
  reactions = signal<Reaction[]>([]);
  private handledPublishedReplyIds = new Set<string>();
  /** Events that were optimistically injected via onReplyPublished while progressive loading may still be running */
  private optimisticallyPublishedReplies: Event[] = [];

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

    this.publishEventBus
      .on('relay-result')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((publishEvent) => {
        const relayEvent = publishEvent as PublishRelayResultEvent;
        if (!relayEvent.success || (relayEvent.event.kind !== 1 && relayEvent.event.kind !== 1111 && relayEvent.event.kind !== 1244)) {
          return;
        }
        this.onReplyPublished(relayEvent.event);
      });

    // this.item = this.route.snapshot.data['data'];

    // Load saved reply filter from local storage
    this.loadSavedReplyFilter();

    effect(() => {
      const originalPoster = this.threadOriginalPoster();
      const supportsAuthorFilter = this.supportsAuthorFollowingFilter();

      untracked(() => {
        if (!supportsAuthorFilter || !originalPoster) {
          this.resetAuthorFollowingList();
          return;
        }

        if (this.lastAuthorFollowingPubkey === originalPoster && this.authorFollowingLoaded()) {
          return;
        }

        void this.loadAuthorFollowingList(originalPoster);
      });
    });

    if (this.transferState.hasKey(EVENT_STATE_KEY)) {
      const data = this.transferState.get<EventData | null>(EVENT_STATE_KEY, null);
      if (data) {
        this.item = data;
      }
      this.transferState.remove(EVENT_STATE_KEY); // optional cleanup
    }

    this.applyNavigationState();

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
            this.applyNavigationState(id);

            if (id.startsWith('naddr')) {
              if (this.isInRightPanel()) {
                this.layout.navigateToRightPanel(`a/${id}`);
              } else {
                this.router.navigateByUrl(`/a/${id}`);
              }
              return;
            }

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

    let repliesLoadingTimeout: ReturnType<typeof setTimeout> | null = null;

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

      // Cap the replies loading indicator at 3 seconds — don't make users wait forever
      repliesLoadingTimeout = setTimeout(() => this.isLoadingReplies.set(false), 3000);
      this.error.set(null);
      this.showCompletionStatus.set(false);
      this.deepResolutionProgress.set('');
      this.handledPublishedReplyIds.clear();
      this.optimisticallyPublishedReplies = [];

      // Reset state
      const preloadedEvent = this.getPreloadedEvent(nevent);
      this.event.set(preloadedEvent);
      this.id.set(preloadedEvent?.id ?? null);
      this.parentEvents.set([]);
      this.replies.set([]);
      this.threadedReplies.set([]);
      this.reactions.set([]);
      this.threadData.set(null);
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
      let deletionCheckStarted = false;

      for await (const partialData of progressiveLoader) {
        // Update signals with partial data as it becomes available
        if (partialData.event) {
          this.event.set(partialData.event);
          const hex = partialData.event.id;
          this.id.set(hex);

          // Update URL with proper encoding (naddr for addressable events, nevent for others)
          const encoded = this.utilities.encodeEventForUrl(partialData.event);

          // Use canonical route: /a for addressable events, /e for non-addressable
          const routePrefix = encoded.startsWith('naddr') ? '/a' : '/e';
          this.url.updatePathSilently([routePrefix, encoded]);

          // Hide main loading spinner once we have the main event
          this.isLoading.set(false);

          // Check for deletion request for the main event (NIP-09)
          // Only check once per loadEvent call to avoid duplicate queries
          if (!deletionCheckStarted) {
            deletionCheckStarted = true;
            this.checkDeletionRequestForEvent(partialData.event);
          }
        }

        if (partialData.parentsLoaded) {
          this.parentEvents.set(partialData.parents ?? []);
          this.isLoadingParents.set(false);
        }

        // Merge any optimistically published replies into progressive data so they
        // are not overwritten by relay data that hasn't indexed them yet.
        let mergedReplies = partialData.replies;
        let mergedThreadedReplies = partialData.threadedReplies;

        if (this.optimisticallyPublishedReplies.length > 0 && mergedReplies !== undefined) {
          const existingIds = new Set(mergedReplies.map(r => r.id));
          const missing = this.optimisticallyPublishedReplies.filter(r => !existingIds.has(r.id));
          if (missing.length > 0) {
            mergedReplies = [...mergedReplies, ...missing];

            // Rebuild the thread tree with the merged replies
            const currentEvent = this.event();
            if (currentEvent) {
              const parentEventIds = new Set(this.parentEvents().map(p => p.id));
              parentEventIds.add(currentEvent.id);
              const filteredMerged = mergedReplies.filter(r => !parentEventIds.has(r.id));
              mergedReplies = filteredMerged;
              const isViewingThreadRoot = partialData.isThreadRoot ?? this.parentEvents().length === 0;
              mergedThreadedReplies = this.eventService.buildThreadTree(filteredMerged, currentEvent.id, isViewingThreadRoot);
            }
          }
        }

        if (mergedReplies !== undefined) {
          this.replies.set(mergedReplies);
        }

        // Only update threadedReplies when we actually have replies to show
        // This prevents flickering from multiple empty array updates during progressive loading
        if (mergedThreadedReplies !== undefined && mergedThreadedReplies.length > 0) {
          this.threadedReplies.set(mergedThreadedReplies);
          this.isLoadingReplies.set(false);
          // Clear initial reply count since we now have actual data
          this.initialReplyCount.set(undefined);

          // If openThreadsExpanded is false, collapse top-level replies by default
          if (!this.localSettings.openThreadsExpanded()) {
            const collapsedIds = new Set<string>();
            for (const reply of mergedThreadedReplies) {
              if (reply.replies.length > 0) {
                collapsedIds.add(reply.event.id);
              }
            }
            this.collapsedThreads.set(collapsedIds);
          }
        } else if (partialData.repliesLoaded) {
          // Replies were fetched but none were found — clear the loading state
          this.isLoadingReplies.set(false);
        }

        if (partialData.reactions !== undefined) {
          this.reactions.set(partialData.reactions);
        }

        // Update threadData with current state
        this.threadData.set({
          event: partialData.event!,
          replies: mergedReplies || partialData.replies || [],
          threadedReplies: mergedThreadedReplies || partialData.threadedReplies || [],
          reactions: partialData.reactions || [],
          parents: partialData.parentsLoaded ? (partialData.parents ?? []) : this.parentEvents(),
          isThreadRoot: partialData.isThreadRoot || false,
          rootEvent: partialData.rootEvent || null,
          parentsLoaded: partialData.parentsLoaded ?? false,
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
      if (repliesLoadingTimeout) clearTimeout(repliesLoadingTimeout);
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

  private applyNavigationState(routeId?: string): void {
    const state = this.getNavigationState();
    const expectedId = routeId ? this.extractRouteEventId(routeId) : null;
    const stateEvent = state?.['event'];
    const eventFromState = this.isEventWithId(stateEvent)
      && (!expectedId || stateEvent.id === expectedId)
      ? stateEvent
      : undefined;

    if (eventFromState) {
      this.event.set(eventFromState);
      this.id.set(eventFromState.id);
      this.item = {
        title: this.item?.title || '',
        description: this.item?.description || '',
        event: eventFromState,
      };
    } else if (expectedId && this.item?.event?.id !== expectedId) {
      this.item = {
        title: this.item?.title || '',
        description: this.item?.description || '',
      };
    }

    this.initialReplyCount.set(typeof state?.['replyCount'] === 'number' ? state['replyCount'] as number : undefined);
    this.initialParentEvent.set(this.isEventWithId(state?.['parentEvent']) ? state['parentEvent'] : undefined);
    this.initialReplies.set(Array.isArray(state?.['replies']) ? state['replies'] as ThreadedEvent[] : undefined);
  }

  private getPreloadedEvent(routeId: string): Event | undefined {
    const expectedId = this.extractRouteEventId(routeId);
    const itemEvent = this.item?.event;

    if (expectedId && this.isEventWithId(itemEvent) && itemEvent.id === expectedId) {
      return itemEvent;
    }

    return undefined;
  }

  private getNavigationState(): Record<string, unknown> | undefined {
    const navigationState = this.router.currentNavigation()?.extras.state as Record<string, unknown> | undefined;
    if (navigationState) {
      return navigationState;
    }

    if (!this.app.isBrowser()) {
      return undefined;
    }

    const historyState = window.history.state as Record<string, unknown> | undefined;
    return historyState;
  }

  private extractRouteEventId(routeId: string): string | null {
    if (this.utilities.isHex(routeId)) {
      return routeId;
    }

    try {
      const decoded = this.utilities.decode(routeId);
      if (decoded.type === 'note') {
        return decoded.data;
      }
      if (decoded.type === 'nevent') {
        return decoded.data.id;
      }
    } catch {
      return null;
    }

    return null;
  }

  private isEventWithId(value: unknown): value is Event {
    return !!value && typeof value === 'object' && 'id' in value && typeof value.id === 'string';
  }

  onReplyPublished(event: Event): void {
    const currentEvent = this.event();
    if (!currentEvent || event.id === currentEvent.id) {
      return;
    }

    if (this.handledPublishedReplyIds.has(event.id)) {
      return;
    }

    const threadRootId = this.parentEvents()[0]?.id || currentEvent.id;
    const knownIds = this.collectKnownThreadEventIds();
    let belongsToThread = false;

    if (event.kind === 1111) {
      // NIP-22: uppercase E = root scope, lowercase e = parent scope
      const rootETag = event.tags.find(t => t[0] === 'E');
      const parentETag = event.tags.find(t => t[0] === 'e');
      const rootATag = event.tags.find(t => t[0] === 'A');

      const nip22RootId = rootETag?.[1] || rootATag?.[1];
      const nip22ParentId = parentETag?.[1];

      const isRootMatch = nip22RootId === threadRootId || nip22RootId === currentEvent.id;
      const isDirectReply = nip22ParentId === currentEvent.id || nip22ParentId === threadRootId;
      const repliesToKnown = !!nip22ParentId && knownIds.has(nip22ParentId);

      belongsToThread = isDirectReply || (isRootMatch && repliesToKnown);
    } else {
      // NIP-10: standard e-tag threading
      const tags = this.eventService.getEventTags(event);
      if (!tags.rootId && !tags.replyId) {
        return;
      }

      const isDirectReplyToCurrent = tags.replyId === currentEvent.id || (!tags.replyId && tags.rootId === currentEvent.id);
      const repliesToKnownEvent = !!tags.replyId && knownIds.has(tags.replyId);
      const isInCurrentThreadRoot = tags.rootId === threadRootId || tags.rootId === currentEvent.id;

      belongsToThread = isDirectReplyToCurrent || (isInCurrentThreadRoot && repliesToKnownEvent);
    }

    if (!belongsToThread) {
      return;
    }

    this.handledPublishedReplyIds.add(event.id);
    this.optimisticallyPublishedReplies.push(event);

    const mergedReplies = [...this.replies(), event];
    const dedupedById = new Map<string, Event>();
    for (const replyEvent of mergedReplies) {
      dedupedById.set(replyEvent.id, replyEvent);
    }

    const parentEventIds = new Set(this.parentEvents().map((p) => p.id));
    parentEventIds.add(currentEvent.id);

    const filteredReplies = Array.from(dedupedById.values()).filter((replyEvent) => !parentEventIds.has(replyEvent.id));
    this.replies.set(filteredReplies);

    const isViewingThreadRoot = this.threadData()?.isThreadRoot ?? this.parentEvents().length === 0;
    const rebuiltThread = this.eventService.buildThreadTree(filteredReplies, currentEvent.id, isViewingThreadRoot);
    this.threadedReplies.set(rebuiltThread);
    this.expandReplyPath(event.id, rebuiltThread);
    this.initialReplyCount.set(undefined);

    const currentThreadData = this.threadData();
    if (currentThreadData) {
      this.threadData.set({
        ...currentThreadData,
        replies: filteredReplies,
        threadedReplies: rebuiltThread,
      });
    }
  }

  private expandReplyPath(replyEventId: string, threadedReplies: ThreadedEvent[]): void {
    const ancestorIds = this.findReplyAncestorIds(threadedReplies, replyEventId);
    if (!ancestorIds || ancestorIds.length === 0) {
      return;
    }

    this.collapsedThreads.update(existing => {
      const next = new Set(existing);
      let changed = false;

      for (const ancestorId of ancestorIds) {
        if (next.delete(ancestorId)) {
          changed = true;
        }
      }

      return changed ? next : existing;
    });
  }

  private findReplyAncestorIds(threadedReplies: ThreadedEvent[], targetReplyId: string, ancestors: string[] = []): string[] | null {
    for (const threadedReply of threadedReplies) {
      if (threadedReply.event.id === targetReplyId) {
        return ancestors;
      }

      const result = this.findReplyAncestorIds(threadedReply.replies, targetReplyId, [...ancestors, threadedReply.event.id]);
      if (result) {
        return result;
      }
    }

    return null;
  }

  private collectKnownThreadEventIds(): Set<string> {
    const ids = new Set<string>();
    const currentEvent = this.event();
    if (currentEvent) {
      ids.add(currentEvent.id);
    }

    const addThread = (thread: ThreadedEvent): void => {
      ids.add(thread.event.id);
      for (const child of thread.replies) {
        addThread(child);
      }
    };

    for (const parent of this.parentEvents()) {
      ids.add(parent.id);
    }

    for (const reply of this.threadedReplies()) {
      addThread(reply);
    }

    return ids;
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

      const result = await this.eventService.loadEventWithDeepResolution(hex, (current, total, relays) => {
        this.deepResolutionProgress.set(`Scanning batch ${current}/${total} (${relays.length} relays)...`);
      });

      if (result.event) {
        this.deepResolutionProgress.set('Event found! Loading thread...');
        // Update item so loadEvent picks it up
        if (!this.item) {
          this.item = { title: '', description: '' };
        }
        this.item.event = result.event;

        // Restart loading
        await this.loadEvent(nevent);
      } else if (result.deletionEvent) {
        this.logger.info('Deep resolution found deletion request for missing event:', {
          eventId: hex,
          deletionEventId: result.deletionEvent.id,
          reason: result.deletionEvent.content || '(no reason given)',
        });

        this.isDeleted.set(true);
        this.deletionReason.set(result.deletionEvent.content || null);
        this.error.set('This event has been deleted by its author');
        this.deepResolutionProgress.set('');
        this.isLoading.set(false);
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
