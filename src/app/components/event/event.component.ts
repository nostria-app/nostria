import { Component, computed, effect, inject, input, signal, untracked, ElementRef, AfterViewInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
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
import { TimestampPipe } from '../../pipes/timestamp.pipe';
import { ApplicationService } from '../../services/application.service';
import { BookmarkService } from '../../services/bookmark.service';
import { DataService } from '../../services/data.service';
import { LayoutService } from '../../services/layout.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { RepostService } from '../../services/repost.service';
import { ContentComponent } from '../content/content.component';
import { ReplyButtonComponent } from './reply-button/reply-button.component';
import { ReactionButtonComponent } from './reaction-button/reaction-button.component';
import { EventHeaderComponent } from './header/header.component';
import { CommonModule } from '@angular/common';
import { AccountStateService } from '../../services/account-state.service';
import { EventService, ReactionEvents, ThreadedEvent } from '../../services/event';
import { AccountRelayService } from '../../services/relays/account-relay';
import { RelayPoolService } from '../../services/relays/relay-pool';
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
  MusicEventComponent,
  EmojiSetEventComponent,
  PeopleSetEventComponent,
  ProfileUpdateEventComponent,
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
import { BookmarkListSelectorComponent } from '../bookmark-list-selector/bookmark-list-selector.component';
import { ReactionsDialogComponent } from '../reactions-dialog/reactions-dialog.component';
import { PowService } from '../../services/pow.service';
import { ContentWarningComponent } from '../content-warning/content-warning.component';
import { PlaylistService } from '../../services/playlist.service';
import { IntersectionObserverService } from '../../services/intersection-observer.service';
import { ParsingService } from '../../services/parsing.service';
import { SocialPreviewComponent } from '../social-preview/social-preview.component';
import { MediaPreviewDialogComponent } from '../media-preview-dialog/media-preview.component';

type EventCardAppearance = 'card' | 'plain';

interface CollapsedContentMedia {
  images: string[];
  urls: string[];
}

@Component({
  selector: 'app-event',
  imports: [
    ArticleEventComponent,
    ProfileDisplayNameComponent,
    EventMenuComponent,
    AgoPipe,
    TimestampPipe,
    CommonModule,
    ReplyButtonComponent,
    ReactionButtonComponent,
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
    MusicEventComponent,
    EmojiSetEventComponent,
    PeopleSetEventComponent,
    ProfileUpdateEventComponent,
    UserProfileComponent,
    BadgeComponent,
    ReportedContentComponent,
    ZapButtonComponent,
    ContentWarningComponent,
    SocialPreviewComponent,
  ],
  templateUrl: './event.component.html',
  styleUrl: './event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
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
  // Optional: pubkey of a trusted user who shared this (for blur bypass on media)
  trustedByPubkey = input<string | undefined>(undefined);
  // Optional: relay hints for fetching the event (e.g., for trending feeds)
  relayHints = input<string[] | undefined>(undefined);
  // Whether this event is rendered inside the Feeds panel (for video auto-play control)
  inFeedsPanel = input<boolean>(false);
  // Optional: reply count passed from parent (e.g., event page) to avoid duplicate relay queries
  // When provided, this value is used instead of loading reply count via loadAllInteractions
  replyCountFromParent = input<number | undefined>(undefined);
  // Optional: threaded replies passed from parent (e.g., event page) for instant rendering when opening thread
  // When clicking this event, these replies are passed through router state for instant display
  repliesFromParent = input<ThreadedEvent[] | undefined>(undefined);
  isPlain = computed<boolean>(() => this.appearance() === 'plain');

  // IntersectionObserver for lazy loading interactions
  private hasLoadedInteractions = signal<boolean>(false);
  private elementRef = inject(ElementRef);
  private observedEventId?: string; // Track which event we're observing for
  private readonly intersectionObserverService = inject(IntersectionObserverService);

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
  relayPool = inject(RelayPoolService);
  parsingService = inject(ParsingService);
  reactions = signal<ReactionEvents>({ events: [], data: new Map() });
  reports = signal<ReactionEvents>({ events: [], data: new Map() });

  // Computed to check if event author is muted/blocked
  // CRITICAL: Filter out muted content from rendering
  // Checks both pubkey-based muting AND profile muted words (name, display_name, nip05)
  isAuthorMuted = computed<boolean>(() => {
    const currentEvent = this.event() || this.record()?.event;
    if (!currentEvent) return false;

    // Check pubkey-based muting
    const mutedAccounts = this.accountState.mutedAccounts();
    if (mutedAccounts.includes(currentEvent.pubkey)) {
      console.log('[EventComponent] Event author is muted (pubkey):', currentEvent.pubkey.substring(0, 8));
      return true;
    }

    // Check if profile fields match any muted words
    if (this.reportingService.isProfileBlockedByMutedWord(currentEvent.pubkey)) {
      console.log('[EventComponent] Event author is muted (profile word match):', currentEvent.pubkey.substring(0, 8));
      return true;
    }

    return false;
  });

  // Loading states
  isLoadingEvent = signal<boolean>(false);
  isLoadingThread = signal<boolean>(false);
  isLoadingReactions = signal<boolean>(false);
  isLoadingParent = signal<boolean>(false);
  isLoadingZaps = signal<boolean>(false);
  isLoadingRepostedEvent = signal<boolean>(false);
  loadingError = signal<string | null>(null);

  // Signal for async-loaded reposted event (when repost has empty content)
  asyncRepostedEvent = signal<Event | null>(null);

  // Parent and root events for replies
  parentEvent = signal<Event | null>(null);
  rootEvent = signal<Event | null>(null);

  // Expansion state for thread context in timeline mode
  isRootEventExpanded = signal<boolean>(false);
  isParentEventExpanded = signal<boolean>(false);

  // Expansion state for main event content
  isMainContentExpanded = signal<boolean>(false);

  // Content length threshold for showing "Show more" button (in characters)
  private readonly CONTENT_LENGTH_THRESHOLD = 500;

  // Regex patterns for detecting media content
  private readonly IMAGE_REGEX = /(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)(\?[^\s]*)?)/gi;
  private readonly VIDEO_REGEX = /(https?:\/\/[^\s]+\.(mp4|webm|mov|avi|wmv|flv|mkv)(\?[^\s]*)?)/gi;

  // Helper to check if content contains media (images or videos)
  private contentHasMedia(content: string): boolean {
    if (!content) return false;
    // Reset regex lastIndex before testing
    this.IMAGE_REGEX.lastIndex = 0;
    this.VIDEO_REGEX.lastIndex = 0;
    return this.IMAGE_REGEX.test(content) || this.VIDEO_REGEX.test(content);
  }

  // Check if this is primarily a media post (short text with media)
  // Media posts shouldn't be collapsed, but long text posts with embedded images should be
  private isPrimaryMediaPost(content: string): boolean {
    if (!content) return false;
    if (!this.contentHasMedia(content)) return false;
    
    // If content has media AND is short (under threshold), it's a media post
    // If content has media but is long, it's a text post with embedded media (should be collapsible)
    return content.length <= this.CONTENT_LENGTH_THRESHOLD;
  }

  /**
   * Extract images and URLs from collapsed content
   * Images will be shown in an album layout, URLs will be shown as link previews
   */
  private extractCollapsedMedia(content: string): CollapsedContentMedia {
    const images: string[] = [];
    const urls: string[] = [];
    
    // Simple regex patterns to extract content
    const imageRegex = /(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)(\?[^\s]*)?)/gi;
    const urlRegex = /https?:\/\/[^\s<]+/gi;
    
    // Track seen URLs to avoid duplicates
    const seenImages = new Set<string>();
    const seenUrls = new Set<string>();
    
    // Extract images first
    let match;
    while ((match = imageRegex.exec(content)) !== null) {
      const url = match[0];
      if (!seenImages.has(url)) {
        seenImages.add(url);
        images.push(url);
      }
    }
    
    // Extract all other URLs (excluding images)
    urlRegex.lastIndex = 0;
    while ((match = urlRegex.exec(content)) !== null) {
      const url = match[0];
      // Skip if it's an image or already seen
      if (!seenImages.has(url) && !seenUrls.has(url)) {
        seenUrls.add(url);
        urls.push(url);
      }
    }
    
    return { images, urls };
  }

  // Check if root event content should be collapsible (content is long enough)
  isRootContentLong = computed<boolean>(() => {
    // Don't show expander in dialogs or thread view - only in feed
    if (this.navigationDisabled()) return false;
    const rootRecordData = this.rootRecord();
    if (!rootRecordData) return false;
    // Only apply to text notes (kind 1)
    if (rootRecordData.event.kind !== 1) return false;
    const content = rootRecordData.event.content || '';
    // Don't collapse primary media posts (short posts with images/videos)
    // but DO collapse long text posts that happen to include media
    if (this.isPrimaryMediaPost(content)) return false;
    return content.length > this.CONTENT_LENGTH_THRESHOLD;
  });

  // Check if parent event content should be collapsible (content is long enough)
  isParentContentLong = computed<boolean>(() => {
    // Don't show expander in dialogs or thread view - only in feed
    if (this.navigationDisabled()) return false;
    const parentRecordData = this.parentRecord();
    if (!parentRecordData) return false;
    // Only apply to text notes (kind 1)
    if (parentRecordData.event.kind !== 1) return false;
    const content = parentRecordData.event.content || '';
    // Don't collapse primary media posts (short posts with images/videos)
    // but DO collapse long text posts that happen to include media
    if (this.isPrimaryMediaPost(content)) return false;
    return content.length > this.CONTENT_LENGTH_THRESHOLD;
  });

  // Check if main content should be collapsible (content is long enough)
  isMainContentLong = computed<boolean>(() => {
    // Don't show expander in dialogs or thread view - only in feed
    if (this.navigationDisabled()) return false;
    const targetItem = this.targetRecord();
    if (!targetItem) return false;
    // Only apply to text notes (kind 1) - not photos, videos, articles, etc.
    if (targetItem.event.kind !== 1) return false;
    const content = targetItem.event.content || '';
    // Don't collapse primary media posts (short posts with images/videos)
    // but DO collapse long text posts that happen to include media
    if (this.isPrimaryMediaPost(content)) return false;
    return content.length > this.CONTENT_LENGTH_THRESHOLD;
  });

  // Check if root content should show collapsed state
  isRootContentCollapsed = computed<boolean>(() => {
    return this.isRootContentLong() && !this.isRootEventExpanded();
  });

  // Check if parent content should show collapsed state
  isParentContentCollapsed = computed<boolean>(() => {
    return this.isParentContentLong() && !this.isParentEventExpanded();
  });

  // Check if main content should show collapsed state
  isMainContentCollapsed = computed<boolean>(() => {
    return this.isMainContentLong() && !this.isMainContentExpanded();
  });

  // Extract media (images and URLs) from collapsed content
  // These will be shown below the truncated text
  mainCollapsedMedia = computed<CollapsedContentMedia>(() => {
    // Only show previews when content is collapsed
    if (!this.isMainContentCollapsed()) return { images: [], urls: [] };
    
    const targetItem = this.targetRecord();
    if (!targetItem) return { images: [], urls: [] };
    
    const content = targetItem.event.content || '';
    return this.extractCollapsedMedia(content);
  });

  rootCollapsedMedia = computed<CollapsedContentMedia>(() => {
    if (!this.isRootContentLong() || this.isRootEventExpanded()) return { images: [], urls: [] };
    
    const rootRecordData = this.rootRecord();
    if (!rootRecordData) return { images: [], urls: [] };
    
    const content = rootRecordData.event.content || '';
    return this.extractCollapsedMedia(content);
  });

  parentCollapsedMedia = computed<CollapsedContentMedia>(() => {
    if (!this.isParentContentLong() || this.isParentEventExpanded()) return { images: [], urls: [] };
    
    const parentRecordData = this.parentRecord();
    if (!parentRecordData) return { images: [], urls: [] };
    
    const content = parentRecordData.event.content || '';
    return this.extractCollapsedMedia(content);
  });

  // Check if this event card should be clickable (only kind 1)
  isCardClickable = computed<boolean>(() => {
    // Use targetRecord to get the actual event (reposted event for reposts)
    const targetEvent = this.targetRecord()?.event;
    if (targetEvent?.kind !== 1) return false;

    // For reposts, the reposted content should always be clickable to navigate to it
    // even when viewing the repost directly
    if (this.isRepostEvent()) {
      return true;
    }

    return !this.isCurrentlySelected();
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

  // Event kinds that support reactions (NIP-25)
  // This includes: short text notes, photos, videos (short/long), audio, articles, polls, playlists, live events, starter packs, music tracks, emoji sets
  private readonly REACTABLE_KINDS = new Set([
    1,      // Short text note (kind 1)
    20,     // Photo (kind 20)
    21,     // Video (kind 21) - NIP-71 horizontal video
    22,     // Short video (kind 22) - NIP-71 vertical video
    1068,   // Poll (kind 1068)
    1222,   // Audio track (kind 1222)
    1244,   // Audio file (kind 1244)
    30023,  // Long-form article (kind 30023)
    30030,  // Emoji set (kind 30030)
    30311,  // Live event (kind 30311)
    32100,  // M3U Playlist (kind 32100)
    34235,  // Video (kind 34235) - NIP-71 addressable horizontal video
    34236,  // Short video (kind 34236) - NIP-71 addressable vertical video
    36787,  // Music track (kind 36787)
    39089,  // Starter pack (kind 39089)
  ]);

  // Check if the current event kind supports reactions
  // For reposts, check the reposted event's kind, not the repost kind itself
  supportsReactions = computed<boolean>(() => {
    const targetEvent = this.targetRecord()?.event;
    if (!targetEvent) return false;
    return this.REACTABLE_KINDS.has(targetEvent.kind);
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
  private _replyCountInternal = signal<number>(0);

  // Reply count - uses parent-provided value if available, otherwise uses internally loaded value
  replyCount = computed<number>(() => {
    const fromParent = this.replyCountFromParent();
    if (fromParent !== undefined) {
      return fromParent;
    }
    return this._replyCountInternal();
  });

  // Combined count of reposts + quotes for display
  repostCount = computed<number>(() => {
    return this.reposts().length + this.quotes().length;
  });

  quoteCount = computed<number>(() => {
    return this.quotes().length;
  });

  // Check if this is a repost event (kind 6 or 16)
  isRepostEvent = computed<boolean>(() => {
    const event = this.event();
    return !!event && this.repostService.isRepostEvent(event);
  });

  repostedRecord = computed<NostrRecord | null>(() => {
    const event = this.event();
    if (!event || !this.repostService.isRepostEvent(event)) return null;

    // First try to decode from embedded content
    const repostedContent = this.repostService.decodeRepost(event);

    if (repostedContent?.event) {
      // CRITICAL: Filter out reposted content from muted accounts (pubkey-based)
      const mutedAccounts = this.accountState.mutedAccounts();
      if (mutedAccounts.includes(repostedContent.event.pubkey)) {
        return null;
      }
      // CRITICAL: Filter out reposted content from authors matching muted words
      if (this.reportingService.isProfileBlockedByMutedWord(repostedContent.event.pubkey)) {
        return null;
      }
      // CRITICAL: Filter out reposted content that contains muted words
      if (this.reportingService.isContentBlocked(repostedContent.event)) {
        return null;
      }
      return repostedContent;
    }

    // If no embedded content, check for async-loaded event
    const asyncEvent = this.asyncRepostedEvent();
    if (asyncEvent) {
      // CRITICAL: Filter out reposted content from muted accounts (pubkey-based)
      const mutedAccounts = this.accountState.mutedAccounts();
      if (mutedAccounts.includes(asyncEvent.pubkey)) {
        return null;
      }
      // CRITICAL: Filter out reposted content from authors matching muted words
      if (this.reportingService.isProfileBlockedByMutedWord(asyncEvent.pubkey)) {
        return null;
      }
      // CRITICAL: Filter out reposted content that contains muted words
      if (this.reportingService.isContentBlocked(asyncEvent)) {
        return null;
      }
      return this.data.toRecord(asyncEvent);
    }

    return null;
  });

  // Check if reposted content is filtered by mute rules (author muted or content blocked)
  // This helps distinguish between "couldn't load" vs "filtered/hidden" in the template
  isRepostedContentFiltered = computed<boolean>(() => {
    const event = this.event();
    if (!event || !this.repostService.isRepostEvent(event)) return false;

    // Try to get the reposted content to check if it should be filtered
    const repostedContent = this.repostService.decodeRepost(event);
    const repostedEvent = repostedContent?.event || this.asyncRepostedEvent();

    if (!repostedEvent) return false; // No content to check

    // Check pubkey-based muting
    const mutedAccounts = this.accountState.mutedAccounts();
    if (mutedAccounts.includes(repostedEvent.pubkey)) {
      return true;
    }

    // Check profile word-based muting
    if (this.reportingService.isProfileBlockedByMutedWord(repostedEvent.pubkey)) {
      return true;
    }

    // Check content-based muting (muted words in content, hashtags, etc.)
    if (this.reportingService.isContentBlocked(repostedEvent)) {
      return true;
    }

    return false;
  });

  // Target record: for reposts, use the reposted content; otherwise use the regular record
  // This is the event that reactions, zaps, etc. should be associated with
  targetRecord = computed<NostrRecord | null>(() => {
    const reposted = this.repostedRecord();
    if (reposted) return reposted;
    return this.record();
  });

  // Check if this event is a quote-only event (has q tags or inline nostr: references but no meaningful reply context)
  // Quote events should NOT show the "replied to" header because the quoted content is rendered inline
  isQuoteOnly = computed<boolean>(() => {
    const event = this.event() || this.record()?.event;
    if (!event) return false;

    // Check for q tags (NIP-18 quote reposts)
    const hasQTags = event.tags.some((tag: string[]) => tag[0] === 'q');
    if (hasQTags) return true;

    // Check if content contains inline nostr: references (nevent, note, naddr)
    // These are quotes rendered inline, so we shouldn't show the reply header
    const hasInlineQuotes = /nostr:(nevent|note|naddr)1[a-z0-9]+/i.test(event.content);

    // If there are inline quotes and the e-tag references the same event being quoted inline,
    // it's likely a quote, not a reply
    if (hasInlineQuotes) {
      const eventTags = this.eventService.getEventTags(event);
      // If the only "reply" context is the quoted event itself, treat as quote-only
      // This handles legacy quotes that used e tags instead of q tags
      if (eventTags.rootId && !eventTags.replyId) {
        // Single e-tag that might be a quote reference
        return true;
      }
    }

    return false;
  });

  // Check if this event is a reply (has e-tags that are replies, not just mentions)
  isReply = computed<boolean>(() => {
    const event = this.event() || this.record()?.event;
    if (!event) return false;

    // Reposts (kind 6 and 16) are NOT replies - they have e-tags pointing to the
    // reposted event, but should not render as replies with parent events above
    if (event.kind === kinds.Repost || event.kind === kinds.GenericRepost) return false;

    // Quote-only events are NOT replies - they render their context inline
    if (this.isQuoteOnly()) return false;

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

      // Debug: Log emoji set events
      if (event.kind === 30030) {
        console.log('🎨 Event component: Detected emoji set event (kind 30030)', event);
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
        this.asyncRepostedEvent.set(null); // Clear async-loaded repost event

        // Reset the loaded interactions flag when event changes
        // This ensures each new event loads its own interactions
        this.hasLoadedInteractions.set(false);

        // Re-register with shared IntersectionObserver when event changes
        // This ensures we observe the correct event when component is reused
        this.setupIntersectionObserver();

        // Interactions will be loaded lazily via IntersectionObserver in ngAfterViewInit
        // No longer loading immediately to reduce relay requests for off-screen events
      });
    });

    // Effect to load event by ID when only id is provided (not event)
    effect(() => {
      if (this.app.initialized()) {
        const eventId = this.id();
        const type = this.type();
        const existingEvent = this.event();

        // Only load by ID if no event is provided directly
        if (!eventId || !type || existingEvent) {
          return;
        }

        untracked(async () => {
          if (type === 'e' || type === 'a') {
            this.isLoadingEvent.set(true);
            this.loadingError.set(null);
            try {
              let eventData = null;
              const hints = this.relayHints();

              // If relay hints are provided (e.g., for trending feeds), try those first
              if (hints && hints.length > 0) {
                // First check cache/database
                eventData = await this.data.getEventById(eventId, { cache: true, save: false });

                // If not found locally, try the hinted relays
                if (!eventData) {
                  const event = await this.relayPool.getEventById(hints, eventId, 10000);
                  if (event) {
                    eventData = this.data.toRecord(event);
                  }
                }
              }

              // Fall back to normal loading if relay hints didn't work
              if (!eventData) {
                // Use cache and save options to:
                // 1. Check in-memory cache first
                // 2. Check database before hitting relays
                // 3. Persist fetched events for future loads
                eventData = await this.data.getEventById(eventId, { cache: true, save: true });
              }

              this.record.set(eventData);

              // After loading the event by ID, check if we need to load interactions
              // This handles the case where the element was already visible before the event loaded
              // (e.g., trending posts) - the intersection observer won't re-trigger since the element
              // was already visible, so we need to manually trigger interaction loading
              this.checkAndLoadInteractionsIfVisible();
            } catch (error) {
              console.error('Error loading event:', error);
              this.loadingError.set('Failed to load event');
            } finally {
              this.isLoadingEvent.set(false);
            }
          }
        });
      }
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

    // Effect to load reposted event when repost has empty content
    // NIP-18: Reposts can have empty content with event reference in e tag + relay hint
    effect(() => {
      const event = this.event();

      // Only process repost events
      if (!event || !this.repostService.isRepostEvent(event)) {
        return;
      }

      // Check if this repost has embedded content
      if (this.repostService.hasEmbeddedContent(event)) {
        // Content is embedded, no need to fetch
        return;
      }

      // Get the reference info from the e tag
      const reference = this.repostService.getRepostReference(event);
      if (!reference) {
        console.warn('⚠️ [Repost] No event reference found in repost:', event.id.substring(0, 8));
        return;
      }

      untracked(async () => {
        console.log('🔄 [Repost] Loading referenced event from relay hint:',
          reference.eventId.substring(0, 8),
          'relay:', reference.relayHint);

        this.isLoadingRepostedEvent.set(true);

        try {
          let repostedEvent: Event | null = null;

          // Try to fetch from relay hint first
          if (reference.relayHint) {
            try {
              repostedEvent = await this.relayPool.getEventById(
                [reference.relayHint],
                reference.eventId,
                15000 // 15 second timeout for relay hint
              );
              if (repostedEvent) {
                console.log('✅ [Repost] Found event from relay hint:', reference.eventId.substring(0, 8));
              }
            } catch (error) {
              console.debug('Relay hint fetch failed for repost:', reference.eventId, error);
            }
          }

          // If relay hint didn't work, try fetching from data service (local DB + user relays)
          if (!repostedEvent) {
            const record = await this.data.getEventById(reference.eventId);
            if (record?.event) {
              repostedEvent = record.event;
              console.log('✅ [Repost] Found event from data service:', reference.eventId.substring(0, 8));
            }
          }

          if (repostedEvent) {
            this.asyncRepostedEvent.set(repostedEvent);
          } else {
            console.warn('⚠️ [Repost] Could not find referenced event:', reference.eventId.substring(0, 8));
          }
        } catch (error) {
          console.error('Error loading reposted event:', error);
        } finally {
          this.isLoadingRepostedEvent.set(false);
        }
      });
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
    // Unregister from shared observer first (in case this is a re-setup)
    this.intersectionObserverService.unobserve(this.elementRef.nativeElement);

    // Use shared IntersectionObserver service instead of per-component observer
    this.intersectionObserverService.observe(
      this.elementRef.nativeElement,
      (isIntersecting) => {
        if (isIntersecting && !this.hasLoadedInteractions()) {
          // CRITICAL: Capture the current event at the moment of intersection
          // This prevents loading interactions for the wrong event
          const currentRecord = this.record();
          const currentEventId = currentRecord?.event.id;

          if (!currentRecord || !currentEventId) {
            console.warn('[Lazy Load] No record available when event became visible');
            return;
          }

          console.log('[Lazy Load] Event became visible:', currentEventId.substring(0, 8));

          // Store which event we're loading for to prevent cross-contamination
          this.observedEventId = currentEventId;
          this.hasLoadedInteractions.set(true);

          // Load interactions for the specific event that became visible
          // Use supportsReactions() which correctly checks the target event kind for reposts
          if (this.supportsReactions()) {
            // Get the target record (reposted event for reposts, regular event otherwise)
            const targetRecordData = this.targetRecord();
            console.log('[Lazy Load] Loading interactions for visible event:',
              targetRecordData?.event.id.substring(0, 8), 'kind:', targetRecordData?.event.kind);

            // Double-check event ID before loading to prevent race conditions
            if (this.record()?.event.id === currentEventId) {
              // loadAllInteractions now also loads quotes
              this.loadAllInteractions();
              this.loadZaps();
            } else {
              console.warn('[Lazy Load] Event changed between intersection and loading, skipping:', currentEventId.substring(0, 8));
            }
          }
        }
      },
      {
        rootMargin: '200px', // Start loading 200px before entering viewport
        threshold: 0.01, // Trigger when at least 1% is visible
      }
    );
  }

  /**
   * Check if the element is currently visible in the viewport and load interactions if needed.
   * This is used after an event is loaded by ID, since the intersection observer may have
   * already fired while the element was visible but before the event data was available.
   */
  private checkAndLoadInteractionsIfVisible(): void {
    // Skip if interactions were already loaded
    if (this.hasLoadedInteractions()) {
      return;
    }

    const currentRecord = this.record();
    if (!currentRecord) {
      return;
    }

    const element = this.elementRef.nativeElement;
    if (!element) {
      return;
    }

    // Use getBoundingClientRect to check if element is in viewport
    const rect = element.getBoundingClientRect();
    const isVisible = (
      rect.top < (window.innerHeight || document.documentElement.clientHeight) + 200 && // Add 200px margin like observer
      rect.bottom > -200 &&
      rect.left < (window.innerWidth || document.documentElement.clientWidth) &&
      rect.right > 0
    );

    if (isVisible) {
      const currentEventId = currentRecord.event.id;
      console.log('👁️ [Lazy Load] Event was already visible when loaded:', currentEventId.substring(0, 8));

      this.observedEventId = currentEventId;
      this.hasLoadedInteractions.set(true);

      // Load interactions for the event
      if (this.supportsReactions()) {
        const targetRecordData = this.targetRecord();
        console.log('🚀 [Lazy Load] Loading interactions for already-visible event:',
          targetRecordData?.event.id.substring(0, 8), 'kind:', targetRecordData?.event.kind);

        this.loadAllInteractions();
        this.loadZaps();
      }
    }
  }

  ngOnDestroy(): void {
    // Unregister from shared IntersectionObserver service
    this.intersectionObserverService.unobserve(this.elementRef.nativeElement);
  }

  /**
   * Load reports for an event
   * Note: For initial loads, prefer using loadAllInteractions() which is more efficient.
   * Use this method only when you need to refresh reports independently.
   * For reposts, loads reports for the reposted event, not the repost itself.
   */
  async loadReports(invalidateCache = false) {
    // Use targetRecord to get the actual event for reports
    // For reposts, this will be the reposted event, not the repost event
    const targetRecordData = this.targetRecord();
    if (!targetRecordData) return;

    // Use the event author's pubkey to query their relays for reports
    const eventAuthorPubkey = targetRecordData.event.pubkey;

    try {
      const reports = await this.eventService.loadReports(
        targetRecordData.event.id,
        eventAuthorPubkey,
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
   * For reposts, loads interactions for the reposted event, not the repost itself
   */
  async loadAllInteractions(invalidateCache = false) {
    // Use targetRecord to get the actual event for interactions
    // For reposts, this will be the reposted event, not the repost event
    const targetRecordData = this.targetRecord();
    if (!targetRecordData) return;

    // Capture the event ID and author pubkey we're loading for to prevent race conditions
    const targetEventId = targetRecordData.event.id;
    // IMPORTANT: Use the EVENT AUTHOR's pubkey, not the current user's pubkey!
    // This ensures we query the author's relays where replies/reactions are likely to be found.
    // This matches what loadReplies does in loadThreadProgressively.
    const eventAuthorPubkey = targetRecordData.event.pubkey;

    // If reply count is provided from parent (e.g., event page that already loaded all replies),
    // skip loading replies from relays to avoid duplicate queries
    const skipReplies = this.replyCountFromParent() !== undefined;

    console.log('📊 [Loading Interactions] Starting load for event:', targetEventId.substring(0, 8), 'skipReplies:', skipReplies);

    this.isLoadingReactions.set(true);
    try {
      // Load main interactions and quotes in parallel
      const [interactions, quotesResult] = await Promise.all([
        this.eventService.loadEventInteractions(
          targetEventId,
          targetRecordData.event.kind,
          eventAuthorPubkey,  // Use event author's pubkey for consistent relay queries
          invalidateCache,
          skipReplies  // Skip loading replies when count is already known from parent
        ),
        this.eventService.loadQuotes(
          targetEventId,
          eventAuthorPubkey,  // Use event author's pubkey for consistent relay queries
          invalidateCache
        )
      ]);

      // CRITICAL: Verify we're still showing the same event before updating state
      // This prevents interactions from one event being applied to another
      // For reposts, we compare against targetRecord which is the reposted event
      const currentTargetRecord = this.targetRecord();
      if (currentTargetRecord?.event.id !== targetEventId) {
        console.warn('⚠️ [Loading Interactions] Event changed during load, discarding results for:', targetEventId.substring(0, 8));
        console.warn('⚠️ [Loading Interactions] Current event is now:', currentTargetRecord?.event.id.substring(0, 8));
        return;
      }

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

      // Filter quotes
      const filteredQuotes = quotesResult.filter(r => !mutedAccounts.includes(r.event.pubkey));

      // Filter reports
      const filteredReportEvents = interactions.reports.events.filter(r => !mutedAccounts.includes(r.event.pubkey));
      const filteredReportData = new Map<string, number>();
      for (const event of filteredReportEvents) {
        const reportType = event.event.content || 'other';
        filteredReportData.set(reportType, (filteredReportData.get(reportType) || 0) + 1);
      }

      // Update all states from the filtered results
      this.reactions.set({
        events: filteredReactionEvents,
        data: filteredReactionData
      });
      this.reposts.set(filteredReposts);
      this.quotes.set(filteredQuotes);
      this.reports.set({
        events: filteredReportEvents,
        data: filteredReportData
      });
      // Only update internal reply count if we actually loaded it (not skipped)
      if (!skipReplies) {
        this._replyCountInternal.set(interactions.replyCount);
      }
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
   * For reposts, loads reactions for the reposted event, not the repost itself.
   */
  async loadReactions(invalidateCache = false) {
    // Use targetRecord to get the actual event for reactions
    // For reposts, this will be the reposted event, not the repost event
    const targetRecordData = this.targetRecord();
    if (!targetRecordData) return;

    // Use the event author's pubkey to query their relays for reactions
    const eventAuthorPubkey = targetRecordData.event.pubkey;

    this.isLoadingReactions.set(true);
    try {
      const reactions = await this.eventService.loadReactions(
        targetRecordData.event.id,
        eventAuthorPubkey,
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

  /**
   * Load zaps for an event
   * For reposts, loads zaps for the reposted event, not the repost itself
   */
  async loadZaps() {
    // Use targetRecord to get the actual event for zaps
    // For reposts, this will be the reposted event, not the repost event
    const targetRecordData = this.targetRecord();
    if (!targetRecordData) return;

    // Capture the event ID we're loading for to prevent race conditions
    const targetEventId = targetRecordData.event.id;

    console.log('⚡ [Loading Zaps] Starting load for event:', targetEventId.substring(0, 8));

    try {
      const zapReceipts = await this.zapService.getZapsForEvent(targetEventId);

      // CRITICAL: Verify we're still showing the same event before updating state
      // For reposts, we compare against targetRecord which is the reposted event
      const currentTargetRecord = this.targetRecord();
      if (currentTargetRecord?.event.id !== targetEventId) {
        console.warn('⚠️ [Loading Zaps] Event changed during load, discarding results for:', targetEventId.substring(0, 8));
        console.warn('⚠️ [Loading Zaps] Current event is now:', currentTargetRecord?.event.id.substring(0, 8));
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
   * For reposts, loads reposts for the reposted event, not the repost itself.
   */
  async loadReposts() {
    // Use targetRecord to get the actual event for reposts
    // For reposts, this will be the reposted event, not the repost event
    const targetRecordData = this.targetRecord();
    if (!targetRecordData) return;

    const userPubkey = this.accountState.pubkey();
    if (!userPubkey) return;

    try {
      const reposts = await this.eventService.loadReposts(
        targetRecordData.event.id,
        targetRecordData.event.kind,
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
    // Use targetRecord to get the actual event for quotes
    // For reposts, this will be the reposted event, not the repost event
    const targetRecordData = this.targetRecord();
    if (!targetRecordData) return;

    // Capture the event ID we're loading for to prevent race conditions
    const targetEventId = targetRecordData.event.id;

    try {
      // Load quotes using the EventService method (queries for 'q' tags)
      const quotes = await this.eventService.loadQuotes(
        targetRecordData.event.id,
        targetRecordData.event.pubkey,
        false
      );

      // CRITICAL: Verify we're still showing the same event before updating state
      const currentTargetRecord = this.targetRecord();
      if (currentTargetRecord?.event.id !== targetEventId) {
        console.warn('⚠️ [Loading Quotes] Event changed during load, discarding results for:', targetEventId.substring(0, 8));
        return;
      }

      this.quotes.set(quotes);
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
    // Use targetRecord to get the actual event for reactions dialog
    // For reposts, this will be the reposted event, not the repost event
    const targetRecordData = this.targetRecord();
    if (!targetRecordData) return;

    this.dialog.open(ReactionsDialogComponent, {
      width: '650px',
      maxWidth: '90vw',
      panelClass: 'responsive-dialog',
      data: {
        event: targetRecordData.event,
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

    // Use targetRecord to get the actual event for liking
    // For reposts, this will be the reposted event, not the repost event
    const targetRecordData = this.targetRecord();
    if (!targetRecordData) return;
    const targetEvent = targetRecordData.event;

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

        const success = await this.reactionService.addLike(targetEvent);
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
    // Use targetRecord to get the actual event for reactions (reposted event for reposts)
    const targetEvent = this.targetRecord()?.event;

    if (isAdding) {
      // Create a temporary reaction event for optimistic UI
      const tempReactionEvent = {
        id: `temp-${userPubkey}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        pubkey: userPubkey,
        created_at: Math.floor(Date.now() / 1000),
        kind: kinds.Reaction,
        content: emoji,
        tags: [
          ['e', targetEvent?.id || ''],
          ['p', targetEvent?.pubkey || '']
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
        // Open bookmark list selector dialog
        this.dialog.open(BookmarkListSelectorComponent, {
          data: {
            itemId: targetItem.event.id,
            type: 'e'
          },
          width: '400px',
          panelClass: 'responsive-dialog'
        });
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
    // Get the target event (for reposts, this is the reposted event)
    const targetRecordData = this.targetRecord();
    const targetEvent = targetRecordData?.event;

    // Only handle clicks for kind 1 events (text notes)
    if (!targetEvent || targetEvent.kind !== 1) {
      return;
    }

    // For reposts, always allow navigation to the reposted event
    // This takes priority over navigationDisabled and isCurrentlySelected checks
    // because clicking a repost should navigate to the original content
    const isRepost = this.isRepostEvent();

    // Don't navigate if navigation is explicitly disabled (unless it's a repost)
    if (this.navigationDisabled() && !isRepost) {
      return;
    }

    // Don't navigate if this event is currently selected/displayed (unless it's a repost)
    if (this.isCurrentlySelected() && !isRepost) {
      return;
    }

    // Prevent navigation if clicking on interactive elements
    const target = event.target as HTMLElement;

    // In overlay mode (media grid), prevent card navigation entirely - only media click handlers should work
    if (this.showOverlay()) {
      return;
    }

    // Check if the click is on an interactive element or its children
    // Include video elements and video containers to prevent thread opening when clicking on videos
    const isInteractiveElement = target.closest(
      'img, video, button, a, mat-menu, [mat-menu-trigger-for], input, textarea, select, .user-profile-avatar, .user-profile-name, .date-link, .video-container, .video-thumbnail-container, .video-player-container, .article-preview-card, app-tagged-references'
    );

    if (isInteractiveElement) {
      return;
    }

    // Navigate to the target event (reposted event for reposts, regular event otherwise)
    // Pass reply count, replies, and parent event for instant rendering in the thread view
    this.layout.openEvent(targetEvent.id, targetEvent, undefined, {
      replyCount: this.replyCount(),
      parentEvent: this.parentEvent() ?? undefined,
      replies: this.repliesFromParent()
    });
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
    // Include video elements and video containers to prevent thread opening when clicking on videos
    const isInteractiveElement = target.closest(
      'img, video, a, mat-menu, [mat-menu-trigger-for], input, textarea, select, .user-profile-avatar, .user-profile-name, .date-link, .video-container, .video-thumbnail-container, .video-player-container'
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
    // Include video elements and video containers to prevent thread opening when clicking on videos
    const isInteractiveElement = target.closest(
      'img, video, a, mat-menu, [mat-menu-trigger-for], input, textarea, select, .user-profile-avatar, .user-profile-name, .date-link, .video-container, .video-thumbnail-container, .video-player-container'
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

  /**
   * Open collapsed image in MediaPreviewDialog
   */
  onCollapsedImageClick(event: MouseEvent, imageUrl: string, allImages: string[]) {
    event.stopPropagation(); // Prevent card click
    
    const currentIndex = allImages.indexOf(imageUrl);
    const mediaItems = allImages.map((url, index) => ({
      url,
      type: 'image/jpeg',
      title: `Image ${index + 1}`,
    }));

    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaItems,
        initialIndex: currentIndex >= 0 ? currentIndex : 0,
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      panelClass: 'image-dialog-panel',
    });
  }
}
