import { Component, computed, effect, inject, input, signal, untracked, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import { Event, kinds, nip19 } from 'nostr-tools';
import { NostrRecord, Playlist } from '../../interfaces';
import { AgoPipe } from '../../pipes/ago.pipe';
import { ApplicationService } from '../../services/application.service';
import { BookmarkService } from '../../services/bookmark.service';
import { DataService } from '../../services/data.service';
import { LayoutService } from '../../services/layout.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { RepostService } from '../../services/repost.service';
import { ContentComponent } from '../content/content.component';
import { ReplyButtonComponent } from './reply-button/reply-button.component';
import { EventHeaderComponent } from './header/header.component';
import { CommonModule, DatePipe } from '@angular/common';
import { AccountStateService } from '../../services/account-state.service';
import { EventService, ReactionEvents } from '../../services/event';
import { AccountRelayService } from '../../services/relays/account-relay';
import { ReactionService } from '../../services/reaction.service';
import {
  ArticleEventComponent,
  PhotoEventComponent,
  PlaylistEventComponent,
  StarterPackEventComponent,
  VideoEventComponent,
  PollEventComponent,
  LiveEventComponent,
  AudioEventComponent,
} from '../event-types';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { BadgeComponent } from '../../pages/badges/badge/badge.component';
import { RepostButtonComponent } from './repost-button/repost-button.component';
import { ProfileDisplayNameComponent } from '../user-profile/display-name/profile-display-name.component';
import { EventMenuComponent } from './event-menu/event-menu.component';
import { ReportedContentComponent } from '../reported-content/reported-content.component';
import { ReportingService } from '../../services/reporting.service';
import { ZapButtonComponent } from '../zap-button/zap-button.component';
import { ZapService } from '../../services/zap.service';
import { ReactionsDialogComponent } from '../reactions-dialog/reactions-dialog.component';
import { PowService } from '../../services/pow.service';
import { ContentWarningComponent } from '../content-warning/content-warning.component';
import { PlaylistService } from '../../services/playlist.service';

type EventCardAppearance = 'card' | 'plain';

@Component({
  selector: 'app-event',
  imports: [
    ArticleEventComponent,
    ProfileDisplayNameComponent,
    EventMenuComponent,
    AgoPipe,
    DatePipe,
    CommonModule,
    ReplyButtonComponent,
    RepostButtonComponent,
    EventHeaderComponent,
    ContentComponent,
    MatTooltipModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    PhotoEventComponent,
    VideoEventComponent,
    ArticleEventComponent,
    PlaylistEventComponent,
    StarterPackEventComponent,
    PollEventComponent,
    LiveEventComponent,
    AudioEventComponent,
    UserProfileComponent,
    BadgeComponent,
    ReportedContentComponent,
    ZapButtonComponent,
    ContentWarningComponent,
  ],
  templateUrl: './event.component.html',
  styleUrl: './event.component.scss',
})
export class EventComponent implements AfterViewInit, OnDestroy {
  id = input<string | null | undefined>();
  type = input<'e' | 'a' | 'r' | 't'>('e');
  event = input<Event | null | undefined>(null);
  appearance = input<EventCardAppearance>('plain');
  navigationDisabled = input<boolean>(false);
  mode = input<'timeline' | 'thread'>('timeline');
  compact = input<boolean>(false);
  hideComments = input<boolean>(false);
  showOverlay = input<boolean>(false);
  hideParentEvent = input<boolean>(false);
  hideFooter = input<boolean>(false);
  // Media navigation context (for Media tab grid)
  allMediaEvents = input<Event[]>([]);
  mediaEventIndex = input<number | undefined>(undefined);
  isPlain = computed<boolean>(() => this.appearance() === 'plain');

  // IntersectionObserver for lazy loading interactions
  private intersectionObserver?: IntersectionObserver;
  private hasLoadedInteractions = signal<boolean>(false);
  private elementRef = inject(ElementRef);
  private observedEventId?: string; // Track which event we're observing for

  data = inject(DataService);
  record = signal<NostrRecord | null>(null);
  bookmark = inject(BookmarkService);
  repostService = inject(RepostService);
  reactionService = inject(ReactionService);
  layout = inject(LayoutService);
  accountRelay = inject(AccountRelayService);
  dialog = inject(MatDialog);
  snackBar = inject(MatSnackBar);
  app = inject(ApplicationService);
  accountState = inject(AccountStateService);
  eventService = inject(EventService);
  router = inject(Router);
  reportingService = inject(ReportingService);
  zapService = inject(ZapService);
  localSettings = inject(LocalSettingsService);
  powService = inject(PowService);
  playlistService = inject(PlaylistService);
  reactions = signal<ReactionEvents>({ events: [], data: new Map() });
  reports = signal<ReactionEvents>({ events: [], data: new Map() });

  // Computed to check if event author is muted/blocked
  // CRITICAL: Filter out muted content from rendering
  isAuthorMuted = computed<boolean>(() => {
    const currentEvent = this.event() || this.record()?.event;
    if (!currentEvent) return false;

    const mutedAccounts = this.accountState.mutedAccounts();
    const isMuted = mutedAccounts.includes(currentEvent.pubkey);

    if (isMuted) {
      console.log('[EventComponent] Event author is muted:', currentEvent.pubkey.substring(0, 8));
    }

    return isMuted;
  });

  // Loading states
  isLoadingEvent = signal<boolean>(false);
  isLoadingThread = signal<boolean>(false);
  isLoadingReactions = signal<boolean>(false);
  isLoadingParent = signal<boolean>(false);
  isLoadingZaps = signal<boolean>(false);
  loadingError = signal<string | null>(null);

  // Parent and root events for replies
  parentEvent = signal<Event | null>(null);
  rootEvent = signal<Event | null>(null);

  // Expansion state for thread context in timeline mode
  isRootEventExpanded = signal<boolean>(false);
  isParentEventExpanded = signal<boolean>(false);

  // Check if this event card should be clickable (only kind 1)
  isCardClickable = computed<boolean>(() => {
    const currentEvent = this.event() || this.record()?.event;
    return currentEvent?.kind === 1 && !this.isCurrentlySelected();
  });

  // Check if root event card should be clickable (only kind 1)
  isRootCardClickable = computed<boolean>(() => {
    const rootRecordData = this.rootRecord();
    return rootRecordData?.event.kind === 1;
  });

  // Check if parent event card should be clickable (only kind 1)
  isParentCardClickable = computed<boolean>(() => {
    const parentRecordData = this.parentRecord();
    return parentRecordData?.event.kind === 1;
  });

  // Check if this event is currently the one being displayed on the event page
  isCurrentlySelected = computed<boolean>(() => {
    // If navigation is disabled, treat as selected (e.g., in thread view or dialog)
    if (this.navigationDisabled()) {
      return true;
    }

    const currentEvent = this.event() || this.record()?.event;
    if (!currentEvent) return false;

    const currentUrl = this.router.url;

    // Check if we're on an event page (/e/:id)
    const eventPageMatch = currentUrl.match(/^\/e\/([^/?]+)/);
    if (eventPageMatch) {
      const urlEventParam = eventPageMatch[1];

      // Try to decode if it's a nevent
      try {
        if (urlEventParam.startsWith('nevent')) {
          const decoded = nip19.decode(urlEventParam);
          if (decoded.type === 'nevent' && decoded.data.id) {
            return decoded.data.id === currentEvent.id;
          }
        }
        // If it's not a nevent, compare directly (might be hex)
        return urlEventParam === currentEvent.id;
      } catch {
        // If decoding fails, fall back to direct comparison
        return urlEventParam === currentEvent.id;
      }
    }

    // Check if we're on an article page (/a/:id)
    const articlePageMatch = currentUrl.match(/^\/a\/([^/?]+)/);
    if (articlePageMatch) {
      const urlEventParam = articlePageMatch[1];

      // Try to decode if it's a naddr
      try {
        if (urlEventParam.startsWith('naddr')) {
          const decoded = nip19.decode(urlEventParam);
          if (decoded.type === 'naddr' && decoded.data.identifier) {
            // For naddr, compare the identifier with event id
            return (
              decoded.data.identifier === currentEvent.id ||
              (decoded.data as { id?: string }).id === currentEvent.id
            );
          }
        }
        // If it's not a naddr, compare directly
        return urlEventParam === currentEvent.id;
      } catch {
        // If decoding fails, fall back to direct comparison
        return urlEventParam === currentEvent.id;
      }
    }

    return false;
  });

  likes = computed<NostrRecord[]>(() => {
    const event = this.event();
    if (!event) return [];
    // Return all reactions, not just '+' reactions
    return this.reactions().events;
  });

  likeReaction = computed<NostrRecord | undefined>(() => {
    const myLikes = this.likes();
    const userPubkey = this.accountState.pubkey();

    if (!myLikes || !userPubkey) return undefined;

    // Find the user's reaction (any content, not just '+')
    return myLikes.find(r => r.event.pubkey === userPubkey);
  });

  // Zap-related state
  zaps = signal<
    {
      receipt: Event;
      zapRequest: Event | null;
      amount: number | null;
      comment: string;
      senderName?: string;
      senderPubkey: string;
      timestamp: number;
    }[]
  >([]);

  totalZapAmount = computed<number>(() => {
    return this.zaps().reduce((total, zap) => total + (zap.amount || 0), 0);
  });

  zapCount = computed<number>(() => {
    return this.zaps().length;
  });

  // Reposts and quotes state
  reposts = signal<NostrRecord[]>([]);
  quotes = signal<NostrRecord[]>([]);
  replyCount = signal<number>(0);

  repostCount = computed<number>(() => {
    return this.reposts().length;
  });

  quoteCount = computed<number>(() => {
    return this.quotes().length;
  });

  repostedRecord = computed<NostrRecord | null>(() => {
    const event = this.event();
    if (!event || (event.kind !== kinds.Repost && event.kind !== kinds.GenericRepost)) return null;

    const repostedContent = this.repostService.decodeRepost(event);

    // CRITICAL: Filter out reposted content from muted accounts
    if (repostedContent?.event) {
      const mutedAccounts = this.accountState.mutedAccounts();
      if (mutedAccounts.includes(repostedContent.event.pubkey)) {
        return null;
      }
    }

    return repostedContent;
  });

  // Check if this event is a reply (has e-tags that are replies, not just mentions)
  isReply = computed<boolean>(() => {
    const event = this.event() || this.record()?.event;
    if (!event) return false;

    // Use eventService to properly parse tags and distinguish mentions from replies
    const eventTags = this.eventService.getEventTags(event);

    // An event is a reply if it has a rootId or replyId (actual thread participation)
    // Events with only mention tags are NOT replies
    return !!(eventTags.rootId || eventTags.replyId);
  });

  // Get the immediate parent event ID (what this is replying to)
  replyEventId = computed<string | null>(() => {
    const event = this.event() || this.record()?.event;
    if (!event) return null;

    const eventTags = this.eventService.getEventTags(event);
    return eventTags.replyId;
  });

  // Get the root event ID (original post in thread)
  rootEventId = computed<string | null>(() => {
    const event = this.event() || this.record()?.event;
    if (!event) return null;

    const eventTags = this.eventService.getEventTags(event);
    return eventTags.rootId;
  });

  // Check if this reply has both root and reply events (threaded reply)
  isThreadedReply = computed<boolean>(() => {
    const rootId = this.rootEventId();
    const replyId = this.replyEventId();
    return !!(rootId && replyId && rootId !== replyId);
  });

  // Get parent record for display (immediate parent)
  // Filter out muted accounts
  parentRecord = computed<NostrRecord | null>(() => {
    const parent = this.parentEvent();
    if (!parent) return null;

    // CRITICAL: Filter out parent events from muted accounts
    const mutedAccounts = this.accountState.mutedAccounts();
    if (mutedAccounts.includes(parent.pubkey)) {
      return null;
    }

    return this.data.toRecord(parent);
  });

  // Get root record for display
  // Filter out muted accounts
  rootRecord = computed<NostrRecord | null>(() => {
    const root = this.rootEvent();
    if (!root) return null;

    // CRITICAL: Filter out root events from muted accounts
    const mutedAccounts = this.accountState.mutedAccounts();
    if (mutedAccounts.includes(root.pubkey)) {
      return null;
    }

    return this.data.toRecord(root);
  });

  followingCount = computed<number>(() => {
    const record = this.record();
    if (!record || record.event.kind !== 3) return 0;

    // Count the "p" tags in the event
    return record.event.tags.filter(tag => tag[0] === 'p').length;
  });

  // Check if this event has any reports
  hasReports = computed<boolean>(() => {
    return this.reports().events.length > 0;
  });

  // Get active report types for this event
  reportTypes = computed<string[]>(() => {
    const reportData = this.reports().data;
    return Array.from(reportData.keys());
  });

  // Check if content should be hidden due to reports
  shouldHideContent = computed<boolean>(() => {
    const event = this.event() || this.record()?.event;
    if (!event) return false;

    // Show content if user has manually overridden the hide
    if (this.reportingService.isContentOverrideActive(event.id)) {
      return false;
    }

    // Check if content should be hidden based on report types and user settings
    const activeReportTypes = this.reportTypes();
    if (activeReportTypes.length === 0) return false;

    return this.reportingService.shouldHideContentForReportTypes(activeReportTypes);
  });

  // NIP-36 Content Warning support
  // Track if user has approved showing content with warning
  contentWarningApproved = signal<Set<string>>(new Set());

  // Check if event has content-warning tag (NIP-36)
  hasContentWarning = computed<boolean>(() => {
    const event = this.event() || this.record()?.event;
    if (!event) return false;

    return event.tags.some(tag => tag[0] === 'content-warning');
  });

  // Get content warning reason if provided
  contentWarningReason = computed<string | null>(() => {
    const event = this.event() || this.record()?.event;
    if (!event) return null;

    const warningTag = event.tags.find(tag => tag[0] === 'content-warning');
    return warningTag && warningTag[1] ? warningTag[1] : null;
  });

  // Check if content should be hidden due to content warning
  shouldHideContentDueToWarning = computed<boolean>(() => {
    const event = this.event() || this.record()?.event;
    if (!event) return false;

    // If no content warning, don't hide
    if (!this.hasContentWarning()) return false;

    // If user has approved this specific event, don't hide
    return !this.contentWarningApproved().has(event.id);
  });

  // Combined check for whether to hide content (reports OR content warning)
  shouldHideContentOverall = computed<boolean>(() => {
    return this.shouldHideContent() || this.shouldHideContentDueToWarning();
  });

  constructor() {
    effect(() => {
      const event = this.event();

      if (!event) {
        return;
      }

      untracked(async () => {
        const record = this.data.toRecord(event);
        this.record.set(record);

        // console.log('📝 [Event Setup] Record created for event:', event.id.substring(0, 8), '| Kind:', event.kind);

        // CRITICAL: Clear all interaction state when event changes
        // This prevents interactions from the previous event being displayed on the new event
        this.reactions.set({ events: [], data: new Map() });
        this.reposts.set([]);
        this.reports.set({ events: [], data: new Map() });
        this.zaps.set([]);
        this.quotes.set([]);

        // Reset the loaded interactions flag when event changes
        // This ensures each new event loads its own interactions
        this.hasLoadedInteractions.set(false);

        // Recreate IntersectionObserver if it exists
        // This ensures we observe the correct event when component is reused
        if (this.intersectionObserver) {
          this.setupIntersectionObserver();
        }

        // Interactions will be loaded lazily via IntersectionObserver in ngAfterViewInit
        // No longer loading immediately to reduce relay requests for off-screen events
      });
    });

    // Effect to load parent event when parentEventId changes
    effect(() => {
      const replyId = this.replyEventId();
      const rootId = this.rootEventId();
      const currentEvent = this.event() || this.record()?.event;

      if (this.isReply() && currentEvent) {
        untracked(async () => {
          // Get event tags which includes author and relay information
          const eventTags = this.eventService.getEventTags(currentEvent);

          // Load immediate parent (reply)
          if (replyId) {
            await this.loadParentEvent(replyId, eventTags);
          }

          // Load root event if it's different from reply
          if (rootId && rootId !== replyId) {
            await this.loadRootEvent(rootId, eventTags);
          }
        });
      } else {
        this.parentEvent.set(null);
        this.rootEvent.set(null);
      }
    });

    // Effect to reload reports when a new report is published for this event
    effect(() => {
      const reportNotification = this.reportingService.getReportPublishedSignal()();
      const currentEvent = this.event() || this.record()?.event;

      if (reportNotification && currentEvent && reportNotification.eventId === currentEvent.id) {
        untracked(async () => {
          console.log('🚨 [Report Notification] New report detected for event:', currentEvent.id.substring(0, 8));
          // Reload reports with cache invalidation to get the fresh data
          await this.loadReports(true);
        });
      }
    });
  }

  ngAfterViewInit(): void {
    // Set up IntersectionObserver for lazy loading
    this.setupIntersectionObserver();
  }

  /**
   * Set up or recreate IntersectionObserver to lazy load interactions when event becomes visible
   * This method can be called when the component initializes or when the event changes
   */
  private setupIntersectionObserver(): void {
    // Clean up existing observer if present
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = undefined;
    }

    // Set up IntersectionObserver to lazy load interactions when event becomes visible
    // Using rootMargin to trigger slightly before element enters viewport for seamless UX
    const options: IntersectionObserverInit = {
      root: null, // Use viewport as root
      rootMargin: '200px', // Start loading 200px before entering viewport
      threshold: 0.01, // Trigger when at least 1% is visible
    };

    this.intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !this.hasLoadedInteractions()) {
          // CRITICAL: Capture the current event at the moment of intersection
          // This prevents loading interactions for the wrong event
          const currentRecord = this.record();
          const currentEventId = currentRecord?.event.id;

          if (!currentRecord || !currentEventId) {
            console.warn('⚠️ [Lazy Load] No record available when event became visible');
            return;
          }

          console.log('👁️ [Lazy Load] Event became visible:', currentEventId.substring(0, 8));

          // Store which event we're loading for to prevent cross-contamination
          this.observedEventId = currentEventId;
          this.hasLoadedInteractions.set(true);

          // Load interactions for the specific event that became visible
          if (currentRecord.event.kind === kinds.ShortTextNote) {
            console.log('🚀 [Lazy Load] Loading interactions for visible event:', currentEventId.substring(0, 8));

            // Double-check event ID before loading to prevent race conditions
            if (this.record()?.event.id === currentEventId) {
              this.loadAllInteractions();
              this.loadZaps();
              this.loadQuotes();
            } else {
              console.warn('⚠️ [Lazy Load] Event changed between intersection and loading, skipping:', currentEventId.substring(0, 8));
            }
          }
        }
      });
    }, options);

    // Start observing the component's root element
    const element = this.elementRef.nativeElement;
    if (element) {
      this.intersectionObserver.observe(element);
    }
  }

  ngOnDestroy(): void {
    // Clean up IntersectionObserver to prevent memory leaks
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = undefined;
    }
  }

  /**
   * Load reports for an event
   * Note: For initial loads, prefer using loadAllInteractions() which is more efficient.
   * Use this method only when you need to refresh reports independently.
   */
  async loadReports(invalidateCache = false) {
    const record = this.record();
    if (!record) return;

    const userPubkey = this.accountState.pubkey();
    if (!userPubkey) return;

    try {
      const reports = await this.eventService.loadReports(
        record.event.id,
        userPubkey,
        invalidateCache
      );
      this.reports.set(reports);
    } catch (error) {
      console.error('Error loading reports:', error);
    }
  }

  /**
   * Load all event interactions (reactions, reposts, reports) in a single optimized query
   * This is more efficient than calling loadReactions, loadReposts, and loadReports separately
   */
  async loadAllInteractions(invalidateCache = false) {
    const record = this.record();
    if (!record) return;

    const userPubkey = this.accountState.pubkey();
    if (!userPubkey) return;

    // Capture the event ID we're loading for to prevent race conditions
    const targetEventId = record.event.id;

    console.log('📊 [Loading Interactions] Starting load for event:', targetEventId.substring(0, 8));

    this.isLoadingReactions.set(true);
    try {
      const interactions = await this.eventService.loadEventInteractions(
        targetEventId,
        record.event.kind,
        userPubkey,
        invalidateCache
      );

      // CRITICAL: Verify we're still showing the same event before updating state
      // This prevents interactions from one event being applied to another
      const currentRecord = this.record();
      if (currentRecord?.event.id !== targetEventId) {
        console.warn('⚠️ [Loading Interactions] Event changed during load, discarding results for:', targetEventId.substring(0, 8));
        console.warn('⚠️ [Loading Interactions] Current event is now:', currentRecord?.event.id.substring(0, 8));
        return;
      }

      console.log('✅ [Loading Interactions] Successfully loaded for event:', targetEventId.substring(0, 8));
      console.log('   - Reactions:', interactions.reactions.events.length);
      console.log('   - Reposts:', interactions.reposts.length);
      console.log('   - Reports:', interactions.reports.events.length);
      console.log('   - Replies:', interactions.replyCount);

      // CRITICAL: Filter out interactions from muted accounts
      const mutedAccounts = this.accountState.mutedAccounts();

      // Filter reactions
      const filteredReactionEvents = interactions.reactions.events.filter(r => !mutedAccounts.includes(r.event.pubkey));
      const filteredReactionData = new Map<string, number>();
      for (const event of filteredReactionEvents) {
        const emoji = event.event.content || '+';
        filteredReactionData.set(emoji, (filteredReactionData.get(emoji) || 0) + 1);
      }

      // Filter reposts
      const filteredReposts = interactions.reposts.filter(r => !mutedAccounts.includes(r.event.pubkey));

      // Filter reports
      const filteredReportEvents = interactions.reports.events.filter(r => !mutedAccounts.includes(r.event.pubkey));
      const filteredReportData = new Map<string, number>();
      for (const event of filteredReportEvents) {
        const reportType = event.event.content || 'other';
        filteredReportData.set(reportType, (filteredReportData.get(reportType) || 0) + 1);
      }

      console.log('🔒 [Mute Filter] Filtered interactions from', mutedAccounts.length, 'muted accounts');
      console.log('   - Reactions after filter:', filteredReactionEvents.length);
      console.log('   - Reposts after filter:', filteredReposts.length);
      console.log('   - Reports after filter:', filteredReportEvents.length);

      // Update all three states from the filtered results
      this.reactions.set({
        events: filteredReactionEvents,
        data: filteredReactionData
      });
      this.reposts.set(filteredReposts);
      this.reports.set({
        events: filteredReportEvents,
        data: filteredReportData
      });
      this.replyCount.set(interactions.replyCount);
    } catch (error) {
      console.error('Error loading event interactions:', error);
    } finally {
      this.isLoadingReactions.set(false);
    }
  }

  /**
   * Load reactions for an event
   * Note: For initial loads, prefer using loadAllInteractions() which is more efficient.
   * Use this method only when you need to refresh reactions independently (e.g., after liking).
   */
  async loadReactions(invalidateCache = false) {
    const record = this.record();
    if (!record) return;

    const userPubkey = this.accountState.pubkey();
    if (!userPubkey) return;

    this.isLoadingReactions.set(true);
    try {
      const reactions = await this.eventService.loadReactions(
        record.event.id,
        userPubkey,
        invalidateCache
      );

      // CRITICAL: Filter out reactions from muted accounts
      const mutedAccounts = this.accountState.mutedAccounts();
      const filteredEvents = reactions.events.filter(r => !mutedAccounts.includes(r.event.pubkey));

      // Rebuild the data map with filtered events
      const filteredData = new Map<string, number>();
      for (const event of filteredEvents) {
        const emoji = event.event.content || '+';
        filteredData.set(emoji, (filteredData.get(emoji) || 0) + 1);
      }

      this.reactions.set({
        events: filteredEvents,
        data: filteredData
      });
    } finally {
      this.isLoadingReactions.set(false);
    }
  }

  async loadParentEvent(parentId: string, eventTags: ReturnType<typeof this.eventService.getEventTags>) {
    if (!parentId) return;

    this.isLoadingParent.set(true);
    try {
      // Create nevent with author for outbox discovery if we have the author pubkey
      // Use eventTags.author if available, otherwise fall back to first p-tag
      const authorPubkey = eventTags.author || (eventTags.pTags.length > 0 ? eventTags.pTags[0] : null);

      // Check if parentId is a hex string (64 chars, only hex characters)
      let nevent = parentId;
      if (authorPubkey && /^[a-f0-9]{64}$/i.test(parentId)) {
        nevent = nip19.neventEncode({
          id: parentId,
          author: authorPubkey,
          relays: eventTags.replyRelays.length > 0 ? eventTags.replyRelays : undefined
        }) as string;
      }

      const parentEvent = await this.eventService.loadEvent(nevent);
      this.parentEvent.set(parentEvent);
    } catch (error) {
      console.error('Error loading parent event:', error);
      this.parentEvent.set(null);
    } finally {
      this.isLoadingParent.set(false);
    }
  }

  async loadRootEvent(rootId: string, eventTags: ReturnType<typeof this.eventService.getEventTags>) {
    if (!rootId) return;

    try {
      // Create nevent with author for outbox discovery if we have the author pubkey
      // Use eventTags.author if available, otherwise fall back to first p-tag
      const authorPubkey = eventTags.author || (eventTags.pTags.length > 0 ? eventTags.pTags[0] : null);

      // Check if rootId is a hex string (64 chars, only hex characters)
      let nevent = rootId;
      if (authorPubkey && /^[a-f0-9]{64}$/i.test(rootId)) {
        nevent = nip19.neventEncode({
          id: rootId,
          author: authorPubkey,
          relays: eventTags.rootRelays.length > 0 ? eventTags.rootRelays : undefined
        }) as string;
      }

      const rootEvent = await this.eventService.loadEvent(nevent);
      this.rootEvent.set(rootEvent);
    } catch (error) {
      console.error('Error loading root event:', error);
      this.rootEvent.set(null);
    }
  }

  async loadZaps() {
    const currentEvent = this.event() || this.record()?.event;
    if (!currentEvent) return;

    // Capture the event ID we're loading for to prevent race conditions
    const targetEventId = currentEvent.id;

    console.log('⚡ [Loading Zaps] Starting load for event:', targetEventId.substring(0, 8));

    try {
      const zapReceipts = await this.zapService.getZapsForEvent(targetEventId);

      // CRITICAL: Verify we're still showing the same event before updating state
      const stillCurrentEvent = this.event() || this.record()?.event;
      if (stillCurrentEvent?.id !== targetEventId) {
        console.warn('⚠️ [Loading Zaps] Event changed during load, discarding results for:', targetEventId.substring(0, 8));
        console.warn('⚠️ [Loading Zaps] Current event is now:', stillCurrentEvent?.id.substring(0, 8));
        return;
      }

      const parsedZaps = [];

      for (const receipt of zapReceipts) {
        const parsed = this.zapService.parseZapReceipt(receipt);
        if (parsed.zapRequest && parsed.amount) {
          parsedZaps.push({
            receipt,
            zapRequest: parsed.zapRequest,
            amount: parsed.amount,
            comment: parsed.comment,
            senderName: parsed.zapRequest.pubkey, // We'll use pubkey as name for now
            senderPubkey: parsed.zapRequest.pubkey,
            timestamp: receipt.created_at,
          });
        }
      }

      console.log('✅ [Loading Zaps] Successfully loaded', parsedZaps.length, 'zaps for event:', targetEventId.substring(0, 8));
      this.zaps.set(parsedZaps);
    } catch (error) {
      console.error('Error loading zaps:', error);
    }
  }

  /**
   * Handler for when a zap is successfully sent from the zap button.
   * Refreshes the zap data from relays after a short delay to allow propagation.
   */
  async onZapSent(amount: number): Promise<void> {
    console.log('⚡ [Zap Sent] Received zap sent event for amount:', amount);

    // Show loading indicator while waiting for zap receipt
    this.isLoadingZaps.set(true);

    try {
      // Wait a short time for the zap receipt to propagate to relays
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Reload zaps from relays to get the latest data including the new zap
      await this.loadZaps();
    } finally {
      this.isLoadingZaps.set(false);
    }
  }

  /**
   * Load reposts for an event
   * Note: For initial loads, prefer using loadAllInteractions() which is more efficient.
   * Use this method only when you need to refresh reposts independently.
   */
  async loadReposts() {
    const currentEvent = this.event() || this.record()?.event;
    if (!currentEvent) return;

    const userPubkey = this.accountState.pubkey();
    if (!userPubkey) return;

    try {
      const reposts = await this.eventService.loadReposts(
        currentEvent.id,
        currentEvent.kind,
        userPubkey,
        false
      );

      // CRITICAL: Filter out reposts from muted accounts
      const mutedAccounts = this.accountState.mutedAccounts();
      const filteredReposts = reposts.filter(r => !mutedAccounts.includes(r.event.pubkey));

      this.reposts.set(filteredReposts);
    } catch (error) {
      console.error('Error loading reposts:', error);
    }
  }

  async loadQuotes() {
    const currentEvent = this.event() || this.record()?.event;
    if (!currentEvent) return;

    // Capture the event ID we're loading for to prevent race conditions
    const targetEventId = currentEvent.id;

    try {
      // For now, quotes are complex to find - they're regular notes that reference this event
      // This would require a more complex query to find notes with 'q' tags referencing this event
      // TODO: Implement proper quotes loading when EventService supports it

      // CRITICAL: Verify we're still showing the same event before updating state
      const stillCurrentEvent = this.event() || this.record()?.event;
      if (stillCurrentEvent?.id !== targetEventId) {
        console.warn('⚠️ [Loading Quotes] Event changed during load, discarding results for:', targetEventId.substring(0, 8));
        return;
      }

      this.quotes.set([]);
    } catch (error) {
      console.error('Error loading quotes:', error);
    }
  }

  formatZapAmount(amount: number): string {
    if (amount >= 1000000) {
      return `${(amount / 1000000).toFixed(1)}M`;
    }
    if (amount >= 1000) {
      return `${(amount / 1000).toFixed(1)}K`;
    }
    return amount.toLocaleString();
  }

  openReactionsDialog(selectedTab: 'likes' | 'zaps' | 'reposts' | 'quotes' = 'likes') {
    const currentEvent = this.event() || this.record()?.event;
    if (!currentEvent) return;

    this.dialog.open(ReactionsDialogComponent, {
      width: '650px',
      maxWidth: '90vw',
      panelClass: 'responsive-dialog',
      data: {
        event: currentEvent,
        reactions: this.likes(), // Now contains all reactions, not just '+'
        zaps: this.zaps(),
        reposts: this.reposts(),
        quotes: this.quotes(),
        selectedTab,
      },
    });
  }

  async toggleLike(event?: MouseEvent) {
    if (event) {
      event.stopPropagation();
    }

    const currentEvent = this.event() || this.record()?.event;
    if (!currentEvent) return;

    const userPubkey = this.accountState.pubkey();
    const currentAccount = this.accountState.account();
    if (!userPubkey || currentAccount?.source === 'preview') {
      // Show login dialog if no account is active or if using a preview account
      await this.layout.showLoginDialog();
      return;
    }

    // Disable reaction loading temporarily to prevent interference
    this.isLoadingReactions.set(true);

    try {
      const existingLikeReaction = this.likeReaction();

      if (existingLikeReaction) {
        // Remove like - optimistically update UI first
        this.updateReactionsOptimistically(userPubkey, '+', false);

        const success = await this.reactionService.deleteReaction(existingLikeReaction.event);
        if (!success) {
          // Revert optimistic update if failed
          this.updateReactionsOptimistically(userPubkey, '+', true);
          this.snackBar.open('Failed to remove like. Please try again.', 'Dismiss', { duration: 3000 });
        } else {
          console.log('Like removed successfully');
        }
      } else {
        // Add like - optimistically update UI first
        this.updateReactionsOptimistically(userPubkey, '+', true);

        const success = await this.reactionService.addLike(currentEvent);
        if (!success) {
          // Revert optimistic update if failed
          this.updateReactionsOptimistically(userPubkey, '+', false);
          this.snackBar.open('Failed to add like. Please try again.', 'Dismiss', { duration: 3000 });
        } else {
          console.log('Like added successfully');
        }
      }

      // Reload reactions in the background to sync with the network
      // Use a longer delay to allow network propagation
      setTimeout(() => {
        this.loadReactions(true);
      }, 2000);

    } finally {
      this.isLoadingReactions.set(false);
    }
  }

  /**
   * Optimistically update reactions for immediate UI feedback
   */
  private updateReactionsOptimistically(userPubkey: string, emoji: string, isAdding: boolean) {
    const currentReactions = this.reactions();
    const currentEvents = [...currentReactions.events];
    const currentData = new Map(currentReactions.data);
    const currentEvent = this.event() || this.record()?.event;

    if (isAdding) {
      // Create a temporary reaction event for optimistic UI
      const tempReactionEvent = {
        id: `temp-${userPubkey}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        pubkey: userPubkey,
        created_at: Math.floor(Date.now() / 1000),
        kind: kinds.Reaction,
        content: emoji,
        tags: [
          ['e', currentEvent?.id || ''],
          ['p', currentEvent?.pubkey || '']
        ],
        sig: ''
      };

      const tempRecord = {
        event: tempReactionEvent,
        data: emoji
      };

      currentEvents.push(tempRecord);
      currentData.set(emoji, (currentData.get(emoji) || 0) + 1);
    } else {
      // Remove the user's reaction
      const userReactionIndex = currentEvents.findIndex(
        r => r.event.pubkey === userPubkey && r.event.content === emoji
      );

      if (userReactionIndex !== -1) {
        currentEvents.splice(userReactionIndex, 1);
        const currentCount = currentData.get(emoji) || 0;
        if (currentCount > 1) {
          currentData.set(emoji, currentCount - 1);
        } else {
          currentData.delete(emoji);
        }
      }
    }

    this.reactions.set({
      events: currentEvents,
      data: currentData
    });
  }

  // Client logo mapping - maps client names to logo image paths
  private readonly CLIENT_LOGO_MAP: Record<string, string> = {
    'nostria': 'logos/clients/nostria.png',
    'nosotros': 'logos/clients/nosotros.png',
    'damus deck': 'logos/clients/damus.png',
    'damus': 'logos/clients/damus.png',
    'amethyst': 'logos/clients/amethyst.png',
    'primal': 'logos/clients/primal.png',
    'snort': 'logos/clients/snort.png',
    'iris': 'logos/clients/iris.png',
    'coracle': 'logos/clients/coracle.png',
    'nos': 'logos/clients/nos.png',
    'current': 'logos/clients/current.png',
    'satellite': 'logos/clients/satellite.png',
    'habla': 'logos/clients/habla.png',
    'gossip': 'logos/clients/gossip.png',
    'freefrom': 'logos/clients/freefrom.png',
    'habla.news': 'logos/clients/habla.png',
    'nostrudel': 'logos/clients/nostrudel.svg',
    'yakihonne': 'logos/clients/yakihonne.png',
    'lume': 'logos/clients/lume.png',
    'nostur': 'logos/clients/nostur.png',
    'nostore': 'logos/clients/nostore.png',
  };

  /**
   * Get the client tag value from an event
   */
  getClientTag(event: Event | null | undefined): string | null {
    if (!event || !event.tags) return null;

    const clientTag = event.tags.find(tag => tag[0] === 'client' && tag[1]);
    return clientTag ? clientTag[1] : null;
  }

  /**
   * Get the logo image path for a client
   */
  getClientLogo(clientName: string | null): string | null {
    if (!clientName) return null;

    const normalizedClient = clientName.toLowerCase().trim();
    return this.CLIENT_LOGO_MAP[normalizedClient] || null;
  }

  /**
   * Get the display name for a client (capitalized)
   */
  getClientDisplayName(clientName: string | null): string {
    if (!clientName) return 'Unknown Client';

    // Special case for known clients with specific capitalization
    const normalizedClient = clientName.toLowerCase().trim();
    const displayNames: Record<string, string> = {
      'nostria': 'Nostria',
      'nosotros': 'Nosotros',
      'damus deck': 'Damus Deck',
      'damus': 'Damus',
      'amethyst': 'Amethyst',
      'primal': 'Primal',
      'snort': 'Snort',
      'iris': 'Iris',
      'coracle': 'Coracle',
      'nos': 'Nos',
      'current': 'Current',
      'satellite': 'Satellite',
      'habla': 'Habla',
      'gossip': 'Gossip',
      'freefrom': 'FreeFrom',
      'habla.news': 'Habla.news',
      'nostrudel': 'NoStrudel',
      'yakihonne': 'YakiHonne',
      'lume': 'Lume',
      'nostur': 'Nostur',
      'nostore': 'Nostore',
    };

    return displayNames[normalizedClient] || clientName;
  }

  /**
   * Check if client tag should be shown based on user settings
   */
  shouldShowClientTag(): boolean {
    return this.localSettings.showClientTag();
  }

  /**
   * Check if an event has a geohash tag
   */
  hasGeohash(event: Event | null | undefined): boolean {
    if (!event || !event.tags) return false;
    return event.tags.some(tag => tag[0] === 'g');
  }

  /**
   * Get the geohash value from an event
   */
  getGeohash(event: Event | null | undefined): string | null {
    if (!event || !event.tags) return null;
    const geohashTag = event.tags.find(tag => tag[0] === 'g');
    return geohashTag?.[1] || null;
  }

  /**
   * Get the geohash URL for an event
   */
  getGeohashUrl(event: Event | null | undefined): string | null {
    const geohash = this.getGeohash(event);
    if (!geohash) return null;
    return `https://geohash.softeng.co/${geohash}`;
  }

  /**
   * Check if an event has Proof-of-Work
   */
  hasProofOfWork(event: Event | null | undefined): boolean {
    if (!event || !event.tags) return false;
    return event.tags.some(tag => tag[0] === 'nonce');
  }

  /**
   * Get the Proof-of-Work difficulty for an event
   */
  getProofOfWorkDifficulty(event: Event | null | undefined): number {
    if (!event || !this.hasProofOfWork(event)) return 0;
    return this.powService.countLeadingZeroBits(event.id);
  }

  /**
   * Get the committed difficulty from the nonce tag
   */
  getCommittedDifficulty(event: Event | null | undefined): number {
    if (!event || !event.tags) return 0;
    const nonceTag = event.tags.find(tag => tag[0] === 'nonce');
    if (!nonceTag || !nonceTag[2]) return 0;
    return parseInt(nonceTag[2], 10) || 0;
  }

  /**
   * Get the PoW strength label
   */
  getProofOfWorkLabel(difficulty: number): string {
    if (difficulty < 10) return 'Minimal';
    if (difficulty < 15) return 'Low';
    if (difficulty < 20) return 'Moderate';
    if (difficulty < 25) return 'Strong';
    if (difficulty < 30) return 'Very Strong';
    return 'Extreme';
  }

  /**
   * Get the PoW tooltip text
   */
  getProofOfWorkTooltip(event: Event | null | undefined): string {
    const difficulty = this.getProofOfWorkDifficulty(event);
    const committed = this.getCommittedDifficulty(event);
    const strength = this.getProofOfWorkLabel(difficulty);

    if (committed > 0 && committed !== difficulty) {
      return `Proof-of-Work: ${difficulty} bits (${strength})\nTarget: ${committed} bits`;
    }
    return `Proof-of-Work: ${difficulty} bits (${strength})`;
  }

  onBookmarkClick(event: MouseEvent) {
    event.stopPropagation();
    const targetItem = this.repostedRecord() || this.record();
    if (targetItem) {
      if (targetItem.event.kind === 32100) {
        this.togglePlaylistBookmark(targetItem.event);
      } else {
        this.bookmark.toggleBookmark(targetItem.event.id);
      }
    }
  }

  private async togglePlaylistBookmark(event: Event) {
    const dTag = event.tags.find(t => t[0] === 'd')?.[1];
    if (!dTag) return;

    const playlist = {
      id: dTag,
      pubkey: event.pubkey,
      title: event.tags.find(t => t[0] === 'alt')?.[1] || 'Untitled Playlist',
      description: dTag,
      kind: event.kind,
      isLocal: false,
      created_at: event.created_at,
      tracks: [] // We don't need tracks for bookmarking
    } as Playlist;

    try {
      if (this.playlistService.isPlaylistSaved(playlist)) {
        await this.playlistService.removePlaylistFromBookmarks(playlist);
        this.snackBar.open('Playlist removed from saved playlists', 'Close', { duration: 3000 });
      } else {
        await this.playlistService.savePlaylistToBookmarks(playlist);
        this.snackBar.open('Playlist saved to bookmarks', 'Close', { duration: 3000 });
      }
    } catch (error) {
      console.error('Failed to toggle playlist bookmark:', error);
      this.snackBar.open('Failed to update saved playlists', 'Close', { duration: 3000 });
    }
  }

  getBookmarkIcon(event: Event): string {
    if (event.kind === 32100) {
      const dTag = event.tags.find(t => t[0] === 'd')?.[1];
      if (dTag) {
        const playlist = { id: dTag, pubkey: event.pubkey } as Pick<Playlist, 'id' | 'pubkey'>;
        return this.playlistService.isPlaylistSaved(playlist as Playlist) ? 'bookmark' : 'bookmark_border';
      }
    }
    return this.bookmark.getBookmarkIcon(event.id);
  }

  getBookmarkTooltip(event: Event): string {
    if (event.kind === 32100) {
      const dTag = event.tags.find(t => t[0] === 'd')?.[1];
      if (dTag) {
        const playlist = { id: dTag, pubkey: event.pubkey } as Pick<Playlist, 'id' | 'pubkey'>;
        return this.playlistService.isPlaylistSaved(playlist as Playlist) ? 'Remove from saved playlists' : 'Save playlist to bookmarks';
      }
    }
    return this.bookmark.getBookmarkTooltip(event.id);
  }

  /**
   * Approve showing content with content warning (NIP-36)
   */
  approveContentWarning(event?: MouseEvent) {
    event?.stopPropagation();
    const currentEvent = this.event() || this.record()?.event;
    if (!currentEvent) return;

    this.contentWarningApproved.update(approved => {
      const newSet = new Set(approved);
      newSet.add(currentEvent.id);
      return newSet;
    });
  }

  onCardClick(event: MouseEvent) {
    // Only handle clicks for kind 1 events (text notes)
    const currentEvent = this.event() || this.record()?.event;
    if (!currentEvent || currentEvent.kind !== 1) {
      return;
    }

    // Don't navigate if navigation is explicitly disabled
    if (this.navigationDisabled()) {
      return;
    }

    // Don't navigate if this event is currently selected/displayed
    if (this.isCurrentlySelected()) {
      return;
    }

    // Prevent navigation if clicking on interactive elements
    const target = event.target as HTMLElement;

    // In overlay mode (media grid), prevent card navigation entirely - only media click handlers should work
    if (this.showOverlay()) {
      return;
    }

    // Check if the click is on an interactive element or its children
    const isInteractiveElement = target.closest(
      'img, button, a, mat-menu, [mat-menu-trigger-for], input, textarea, select, .user-profile-avatar, .user-profile-name, .date-link'
    );

    if (isInteractiveElement) {
      return;
    }

    // Navigate to the event
    this.layout.openEvent(currentEvent.id, currentEvent);
  }

  /**
   * Handle clicks on the root event card
   * Only opens thread dialog for kind 1 (text note) events
   */
  onRootEventClick(event: MouseEvent) {
    event.stopPropagation(); // Prevent the main card click handler

    // Navigate to the root event (only kind 1)
    const rootRecordData = this.rootRecord();
    if (!rootRecordData || rootRecordData.event.kind !== 1) {
      return;
    }

    const target = event.target as HTMLElement;

    // Allow expand/collapse buttons to work normally
    const isButton = target.closest('button');
    if (isButton) {
      return;
    }

    // Check if the click is on other interactive elements
    const isInteractiveElement = target.closest(
      'img, a, mat-menu, [mat-menu-trigger-for], input, textarea, select, .user-profile-avatar, .user-profile-name, .date-link'
    );

    if (isInteractiveElement) {
      return;
    }

    this.layout.openEvent(rootRecordData.event.id, rootRecordData.event);
  }

  /**
   * Handle clicks on the parent event card
   * Only opens thread dialog for kind 1 (text note) events
   */
  onParentEventClick(event: MouseEvent) {
    event.stopPropagation(); // Prevent the main card click handler

    // Navigate to the parent event (only kind 1)
    const parentRecordData = this.parentRecord();
    if (!parentRecordData || parentRecordData.event.kind !== 1) {
      return;
    }

    const target = event.target as HTMLElement;

    // Allow expand/collapse buttons to work normally
    const isButton = target.closest('button');
    if (isButton) {
      return;
    }

    // Check if the click is on other interactive elements
    const isInteractiveElement = target.closest(
      'img, a, mat-menu, [mat-menu-trigger-for], input, textarea, select, .user-profile-avatar, .user-profile-name, .date-link'
    );

    if (isInteractiveElement) {
      return;
    }

    this.layout.openEvent(parentRecordData.event.id, parentRecordData.event);
  }

  /**
   * Handle expand/collapse button clicks
   */
  onExpandClick(event: MouseEvent, expandedSignal: typeof this.isRootEventExpanded, expand: boolean) {
    event.stopPropagation(); // Prevent card click
    expandedSignal.set(expand);
  }
}
