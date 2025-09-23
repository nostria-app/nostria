import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import { Event, kinds, nip19 } from 'nostr-tools';
import { NostrRecord } from '../../interfaces';
import { AgoPipe } from '../../pipes/ago.pipe';
import { ApplicationService } from '../../services/application.service';
import { BookmarkService } from '../../services/bookmark.service';
import { DataService } from '../../services/data.service';
import { LayoutService } from '../../services/layout.service';
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
} from '../event-types';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { BadgeComponent } from '../../pages/badges/badge/badge.component';
import { RepostButtonComponent } from './repost-button/repost-button.component';
import { ProfileDisplayNameComponent } from '../user-profile/display-name/profile-display-name.component';
import { EventMenuComponent } from './event-menu/event-menu.component';
import { ReportedContentComponent } from '../reported-content/reported-content.component';
import { ReportingService } from '../../services/reporting.service';
import { ZapButtonComponent } from '../zap-button/zap-button.component';
import { ZapDisplayComponent } from '../zap-display/zap-display.component';
import { ZapService } from '../../services/zap.service';
import { ReactionsDialogComponent } from '../reactions-dialog/reactions-dialog.component';

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
    UserProfileComponent,
    BadgeComponent,
    ReportedContentComponent,
    ZapButtonComponent,
    ZapDisplayComponent,
  ],
  templateUrl: './event.component.html',
  styleUrl: './event.component.scss',
})
export class EventComponent {
  id = input<string | null | undefined>();
  type = input<'e' | 'a' | 'r' | 't'>('e');
  event = input<Event | null | undefined>(null);
  appearance = input<EventCardAppearance>('plain');
  navigationDisabled = input<boolean>(false);
  mode = input<'timeline' | 'thread'>('timeline');
  isPlain = computed<boolean>(() => this.appearance() === 'plain');

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
  reactions = signal<ReactionEvents>({ events: [], data: new Map() });
  reports = signal<ReactionEvents>({ events: [], data: new Map() });

  // Loading states
  isLoadingEvent = signal<boolean>(false);
  isLoadingThread = signal<boolean>(false);
  isLoadingReactions = signal<boolean>(false);
  isLoadingParent = signal<boolean>(false);
  loadingError = signal<string | null>(null);

  // Parent and root events for replies
  parentEvent = signal<Event | null>(null);
  rootEvent = signal<Event | null>(null);

  // Check if this event is currently the one being displayed on the event page
  isCurrentlySelected = computed<boolean>(() => {
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
    return this.reactions().events.filter(r => r.event.content === '+');
  });

  likeReaction = computed<NostrRecord | undefined>(() => {
    const myReactions = this.likes();
    if (!myReactions) return;
    return myReactions.find(r => r.event.pubkey === this.accountState.pubkey());
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

  repostCount = computed<number>(() => {
    return this.reposts().length;
  });

  quoteCount = computed<number>(() => {
    return this.quotes().length;
  });

  repostedRecord = computed<NostrRecord | null>(() => {
    const event = this.event();
    if (!event || (event.kind !== kinds.Repost && event.kind !== kinds.GenericRepost)) return null;
    return this.repostService.decodeRepost(event);
  });

  // Check if this event is a reply (has e-tags)
  isReply = computed<boolean>(() => {
    const event = this.event() || this.record()?.event;
    if (!event) return false;

    const eTags = event.tags.filter(tag => tag[0] === 'e');
    return eTags.length > 0;
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
  parentRecord = computed<NostrRecord | null>(() => {
    const parent = this.parentEvent();
    if (!parent) return null;
    return this.data.toRecord(parent);
  });

  // Get root record for display
  rootRecord = computed<NostrRecord | null>(() => {
    const root = this.rootEvent();
    if (!root) return null;
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

  constructor() {
    effect(() => {
      const event = this.event();

      if (!event) {
        return;
      }

      untracked(async () => {
        const record = this.data.toRecord(event);
        this.record.set(record);

        if (record.event.kind == kinds.ShortTextNote) {
          this.loadReactions();
          this.loadZaps();
          this.loadReposts();
          this.loadQuotes();
          this.loadReports();
        }
      });
    });

    // Effect to load parent event when parentEventId changes
    effect(() => {
      const replyId = this.replyEventId();
      const rootId = this.rootEventId();

      if (this.isReply()) {
        untracked(async () => {
          // Load immediate parent (reply)
          if (replyId) {
            await this.loadParentEvent(replyId);
          }

          // Load root event if it's different from reply
          if (rootId && rootId !== replyId) {
            await this.loadRootEvent(rootId);
          }
        });
      } else {
        this.parentEvent.set(null);
        this.rootEvent.set(null);
      }
    });

    effect(async () => {
      if (this.app.initialized()) {
        const eventId = this.id();
        const type = this.type();

        if (!eventId || !type) {
          return;
        }

        if (type === 'e' || type === 'a') {
          if (eventId) {
            this.isLoadingEvent.set(true);
            this.loadingError.set(null);
            try {
              const eventData = await this.data.getEventById(eventId);
              this.record.set(eventData);
              console.log('RECORD:', this.record());
            } catch (error) {
              console.error('Error loading event:', error);
              this.loadingError.set('Failed to load event');
            } finally {
              this.isLoadingEvent.set(false);
            }
          }
        }
      }
    });
  }

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
      this.reactions.set(reactions);
    } finally {
      this.isLoadingReactions.set(false);
    }
  }

  async loadParentEvent(parentId: string) {
    if (!parentId) return;

    this.isLoadingParent.set(true);
    try {
      const parentEvent = await this.eventService.loadEvent(parentId);
      this.parentEvent.set(parentEvent);
    } catch (error) {
      console.error('Error loading parent event:', error);
      this.parentEvent.set(null);
    } finally {
      this.isLoadingParent.set(false);
    }
  }

  async loadRootEvent(rootId: string) {
    if (!rootId) return;

    try {
      const rootEvent = await this.eventService.loadEvent(rootId);
      this.rootEvent.set(rootEvent);
    } catch (error) {
      console.error('Error loading root event:', error);
      this.rootEvent.set(null);
    }
  }

  async loadZaps() {
    const currentEvent = this.event();
    if (!currentEvent) return;

    try {
      const zapReceipts = await this.zapService.getZapsForEvent(currentEvent.id);
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

      this.zaps.set(parsedZaps);
    } catch (error) {
      console.error('Error loading zaps:', error);
    }
  }

  async loadReposts() {
    const currentEvent = this.event();
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
      this.reposts.set(reposts);
    } catch (error) {
      console.error('Error loading reposts:', error);
    }
  }

  async loadQuotes() {
    const currentEvent = this.event();
    if (!currentEvent) return;

    try {
      // For now, quotes are complex to find - they're regular notes that reference this event
      // This would require a more complex query to find notes with 'q' tags referencing this event
      // TODO: Implement proper quotes loading when EventService supports it
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
    const currentEvent = this.event();
    if (!currentEvent) return;

    this.dialog.open(ReactionsDialogComponent, {
      width: '650px',
      maxWidth: '90vw',
      data: {
        event: currentEvent,
        likes: this.likes(),
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

    const currentEvent = this.event();
    if (!currentEvent) return;
    const likeEvent = this.likeReaction();
    if (likeEvent) {
      await this.reactionService.deleteReaction(likeEvent.event);
    } else {
      await this.reactionService.addLike(currentEvent);
    }
    await this.loadReactions(true);
  }

  onBookmarkClick(event: MouseEvent) {
    event.stopPropagation();
    const targetItem = this.repostedRecord() || this.record();
    if (targetItem) {
      this.bookmark.toggleBookmark(targetItem.event.id);
    }
  }

  onCardClick(event: MouseEvent) {
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

    // Check if the click is on an interactive element or its children
    const isInteractiveElement = target.closest(
      'img, button, a, mat-menu, [mat-menu-trigger-for], input, textarea, select, .user-profile-avatar, .user-profile-name, .date-link'
    );

    if (isInteractiveElement) {
      return;
    }

    // Navigate to the event
    const currentEvent = this.event() || this.record()?.event;
    if (currentEvent) {
      this.layout.openEvent(currentEvent.id, currentEvent);
    }
  }
}
