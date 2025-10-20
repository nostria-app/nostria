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
    ContentWarningComponent,
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
  localSettings = inject(LocalSettingsService);
  powService = inject(PowService);
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
    const myLikes = this.likes();
    const userPubkey = this.accountState.pubkey();

    if (!myLikes || !userPubkey) return undefined;

    // Find the user's like reaction
    return myLikes.find(r => r.event.pubkey === userPubkey && r.event.content === '+');
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
      panelClass: 'responsive-dialog',
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

    const userPubkey = this.accountState.pubkey();
    if (!userPubkey) return;

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

    if (isAdding) {
      // Create a temporary reaction event for optimistic UI
      const tempReactionEvent = {
        id: `temp-${userPubkey}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        pubkey: userPubkey,
        created_at: Math.floor(Date.now() / 1000),
        kind: kinds.Reaction,
        content: emoji,
        tags: [
          ['e', this.event()?.id || ''],
          ['p', this.event()?.pubkey || '']
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
    'nostrudel': 'logos/clients/nostrudel.png',
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
      this.bookmark.toggleBookmark(targetItem.event.id);
    }
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
