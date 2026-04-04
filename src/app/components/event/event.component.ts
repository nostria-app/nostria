import { Component, computed, effect, inject, input, output, signal, untracked, ElementRef, AfterViewInit, OnDestroy, ChangeDetectionStrategy, PLATFORM_ID, viewChild } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { trigger, style, animate, transition } from '@angular/animations';
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
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { LoggerService } from '../../services/logger.service';
import { RepostService } from '../../services/repost.service';
import { ContentComponent } from '../content/content.component';
import { ReactionButtonComponent } from './reaction-button/reaction-button.component';
import { EventHeaderComponent } from './header/header.component';
import { CommonModule } from '@angular/common';
import { AccountStateService } from '../../services/account-state.service';
import { EventService, ReactionEvents, SharedInteractionSnapshot, ThreadedEvent } from '../../services/event';
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
  ZapPollEventComponent,
  LiveEventComponent,
  AudioEventComponent,
  MusicEventComponent,
  EmojiSetEventComponent,
  PeopleSetEventComponent,
  ProfileUpdateEventComponent,
  SettingsEventComponent,
  RelayListEventComponent,
  HighlightEventComponent,
  WotEventComponent,
  CodeSnippetEventComponent,
  UnknownEventComponent,
} from '../event-types';
import { isKnownRenderableKind } from '../../utils/kind-labels';
import { ChannelEmbedComponent } from '../channel-embed/channel-embed.component';
import { BadgeComponent } from '../../pages/badges/badge/badge.component';
import { ProfileDisplayNameComponent } from '../user-profile/display-name/profile-display-name.component';
import { EventMenuComponent } from './event-menu/event-menu.component';
import { ReportedContentComponent } from '../reported-content/reported-content.component';
import { ReportingService } from '../../services/reporting.service';
import { ZapButtonComponent } from '../zap-button/zap-button.component';
import { ZapService } from '../../services/zap.service';
import { BookmarkListSelectorComponent } from '../bookmark-list-selector/bookmark-list-selector.component';
import { ReactionsDialogComponent } from '../reactions-dialog/reactions-dialog.component';

import { ReactionSummaryComponent } from './reaction-summary/reaction-summary.component';
import { PowService } from '../../services/pow.service';
import { ContentWarningComponent } from '../content-warning/content-warning.component';
import { PlaylistService } from '../../services/playlist.service';
import { UtilitiesService } from '../../services/utilities.service';
import { UserRelaysService } from '../../services/relays/user-relays';
import { ShareArticleDialogComponent, ShareArticleDialogData } from '../share-article-dialog/share-article-dialog.component';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { IntersectionObserverService } from '../../services/intersection-observer.service';
import { ParsingService } from '../../services/parsing.service';
import { SocialPreviewComponent } from '../social-preview/social-preview.component';
import { MediaPreviewDialogComponent } from '../media-preview-dialog/media-preview.component';
import { InlineVideoPlayerComponent } from '../inline-video-player/inline-video-player.component';
import { HapticsService } from '../../services/haptics.service';
import { resolveClientLogo } from '../../utils/client-logo-map';
import { visualContentLength } from '../../utils/visual-content-length';
import { getRuntimeResourceProfile } from '../../utils/runtime-resource-profile';
import { DatabaseService } from '../../services/database.service';

type EventCardAppearance = 'card' | 'plain';

interface CollapsedVideoInfo {
  url: string;
  poster?: string;
  aspectRatio?: string;
}

interface CollapsedContentMedia {
  images: string[];
  videos: CollapsedVideoInfo[];
  urls: string[];
}

export function getTaggedXUrl(event?: Event | null): string | undefined {
  if (!event) {
    return undefined;
  }

  const proxyReference = event.tags.find(tag => {
    if (tag[0] !== 'proxy' || tag[2] !== 'web' || typeof tag[1] !== 'string') {
      return false;
    }

    try {
      const parsed = new URL(tag[1]);
      return parsed.hostname === 'x.com' || parsed.hostname === 'www.x.com' || parsed.hostname === 'twitter.com' || parsed.hostname === 'www.twitter.com';
    } catch {
      return false;
    }
  });

  return proxyReference?.[1];
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
    ReactionButtonComponent,
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
    ZapPollEventComponent,
    LiveEventComponent,
    AudioEventComponent,
    MusicEventComponent,
    EmojiSetEventComponent,
    PeopleSetEventComponent,
    ProfileUpdateEventComponent,
    SettingsEventComponent,
    RelayListEventComponent,
    HighlightEventComponent,
    WotEventComponent,
    CodeSnippetEventComponent,
    UnknownEventComponent,
    ChannelEmbedComponent,
    BadgeComponent,
    ReportedContentComponent,
    ZapButtonComponent,
    ContentWarningComponent,
    SocialPreviewComponent,
    ReactionSummaryComponent,
    InlineVideoPlayerComponent,
  ],
  templateUrl: './event.component.html',
  styleUrl: './event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('expandCollapse', [
      transition(':enter', [
        style({ height: '0', opacity: 0, overflow: 'hidden' }),
        animate('200ms ease-out', style({ height: '*', opacity: 1 }))
      ]),
      transition(':leave', [
        style({ height: '*', opacity: 1, overflow: 'hidden' }),
        animate('200ms ease-in', style({ height: '0', opacity: 0 }))
      ])
    ])
  ],
})
export class EventComponent implements AfterViewInit, OnDestroy {
  private static readonly interactionPreloadConcurrency = 4;
  private static readonly interactionPreloadBoostConcurrency = 2;
  private static readonly interactionPreloadUrgentThresholdPx = 500;
  private static readonly queuedInteractionPreloads = new Map<EventComponent, number>();
  private static readonly activeInteractionPreloads = new Map<EventComponent, number>();

  id = input<string | null | undefined>();
  type = input<'e' | 'a' | 'r' | 't'>('e');
  event = input<Event | null | undefined>(null);
  hiddenChange = output<boolean>();
  suppressNotFoundState = input<boolean>(false);
  appearance = input<EventCardAppearance>('plain');
  navigationDisabled = input<boolean>(false);
  mode = input<'timeline' | 'thread'>('timeline');
  compact = input<boolean>(false);
  hideComments = input<boolean>(false);
  showOverlay = input<boolean>(false);
  hideParentEvent = input<boolean>(false);
  hideFooter = input<boolean>(false);
  hideHeader = input<boolean>(false);
  disableEngagementLoading = input<boolean>(false);
  engagementLoadMode = input<'auto' | 'external'>('auto');
  engagementLoadRequested = input<boolean>(false);
  engagementLoadPriority = input<number>(0);
  threadInteractionDisabled = input<boolean>(false);
  threadInteractionDisabledReason = input<string | null>(null);
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
  isThreadInteractionBlocked = computed<boolean>(() => this.mode() === 'thread' && this.threadInteractionDisabled());
  threadInteractionBlockedTooltip = computed<string>(() => {
    return this.threadInteractionDisabledReason() || 'Only accounts followed by the original poster can interact in this thread.';
  });

  // IntersectionObserver for lazy loading interactions
  readonly hasLoadedInteractions = signal<boolean>(false);
  private elementRef = inject(ElementRef);
  private observedEventId?: string; // Track which event we're observing for
  private readonly intersectionObserverService = inject(IntersectionObserverService);

  // Off-screen virtualization: use CSS content-visibility to skip rendering work
  // for events that scroll far off-screen, without removing them from the DOM.
  // This avoids layout shifts that occur with @if/@else DOM swapping.
  private isOffScreen = false;
  private hasBeenActuallyVisible = false;
  private lastHeight = 0;
  private virtualizeTimer?: ReturnType<typeof setTimeout>;
  private hasViewInitialized = false;
  private visibleInteractionRetryTimer?: ReturnType<typeof setTimeout>;
  private interactionLoadGeneration = 0;
  private lastAppliedSharedInteractionSnapshotAt = 0;

  // Interaction loading: delay + abort support.
  // When an event enters the viewport, we wait a short period before starting
  // interaction queries. If it leaves within that window, the queries never fire.
  // If queries are already in-flight, the AbortController lets us skip processing
  // their results (the underlying relay queries can't be cancelled, but we avoid
  // the CPU work of filtering/parsing/updating signals for events the user scrolled past).
  private interactionLoadTimer?: ReturnType<typeof setTimeout>;
  private interactionAbortController?: AbortController;

  /**
   * Whether this event should be virtualized when off-screen.
   * Events in thread/detail view (mode="thread") and events with navigationDisabled
   * (i.e. the main event on the event detail page) are excluded from virtualization
   * since those views are typically small and the user is actively reading them.
   */
  shouldVirtualize = computed<boolean>(() => {
    return this.mode() !== 'thread' && !this.navigationDisabled();
  });

  private isExternalEngagementControlEnabled(): boolean {
    return this.engagementLoadMode() === 'external';
  }

  private isExternalEngagementRequested(): boolean {
    return this.isExternalEngagementControlEnabled() && this.engagementLoadRequested();
  }

  private getExternalInteractionPreloadPriority(): number {
    return Math.max(0, this.engagementLoadPriority());
  }

  data = inject(DataService);
  record = signal<NostrRecord | null>(null);
  bookmark = inject(BookmarkService);
  repostService = inject(RepostService);
  reactionService = inject(ReactionService);
  layout = inject(LayoutService);
  accountRelay = inject(AccountRelayService);
  dialog = inject(MatDialog);
  customDialog = inject(CustomDialogService);
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
  database = inject(DatabaseService);
  private utilities = inject(UtilitiesService);
  private userRelaysService = inject(UserRelaysService);
  private readonly logger = inject(LoggerService);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly haptics = inject(HapticsService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  reactions = signal<ReactionEvents>({ events: [], data: new Map() });
  reports = signal<ReactionEvents>({ events: [], data: new Map() });

  private consumeBlockedThreadInteraction(event?: globalThis.Event): boolean {
    if (!this.isThreadInteractionBlocked()) {
      return false;
    }

    event?.preventDefault();
    event?.stopPropagation();
    return true;
  }

  onBlockedThreadInteraction(event: globalThis.Event): void {
    this.consumeBlockedThreadInteraction(event);
  }

  onLikeActionClick(reactionBtn: ReactionButtonComponent, event: MouseEvent): void {
    if (this.consumeBlockedThreadInteraction(event)) {
      return;
    }

    reactionBtn.sendDefaultReaction();
    event.stopPropagation();
  }

  onZapActionClick(zapBtn: ZapButtonComponent, event: MouseEvent): void {
    if (this.consumeBlockedThreadInteraction(event)) {
      return;
    }

    zapBtn.onClick(event);
    event.stopPropagation();
  }

  // Display mode for action buttons: 'labels-only', 'icons-and-labels', 'icons-only'
  actionsDisplayMode = computed<string>(() => {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return this.isReply() ? 'labels-only' : 'icons-and-labels';
    }
    if (this.isReply()) {
      return this.accountLocalState.getActionsDisplayModeReplies(pubkey);
    }
    return this.accountLocalState.getActionsDisplayMode(pubkey);
  });

  onActionsDisplayModeToggle(event: globalThis.Event): void {
    event.preventDefault();
    event.stopPropagation();
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    const modes = ['icons-and-labels', 'labels-only', 'icons-only'];
    const currentMode = this.actionsDisplayMode();
    const currentIndex = modes.indexOf(currentMode);
    const nextMode = modes[(currentIndex + 1) % modes.length];

    if (this.isReply()) {
      this.accountLocalState.setActionsDisplayModeReplies(pubkey, nextMode);
    } else {
      this.accountLocalState.setActionsDisplayMode(pubkey, nextMode);
    }
  }

  // Long press on bookmark for touch devices
  private bookmarkLongPressTimeout: ReturnType<typeof setTimeout> | null = null;
  private bookmarkLongPressed = false;

  onBookmarkLongPressStart(event: TouchEvent): void {
    this.bookmarkLongPressed = false;
    this.bookmarkLongPressTimeout = setTimeout(() => {
      this.bookmarkLongPressed = true;
      event.preventDefault();
      this.onActionsDisplayModeToggle(event);
    }, 500);
  }

  onBookmarkLongPressEnd(): void {
    if (this.bookmarkLongPressTimeout) {
      clearTimeout(this.bookmarkLongPressTimeout);
      this.bookmarkLongPressTimeout = null;
    }
  }

  // Computed to check if event author is muted/blocked
  // CRITICAL: Filter out muted content from rendering
  // Checks both pubkey-based muting AND profile muted words (name, display_name, nip05)
  isLocallyDeleted = computed<boolean>(() => {
    const currentEvent = this.event() || this.record()?.event;
    if (!currentEvent) {
      return false;
    }

    return this.eventService.isEventLocallyDeleted(currentEvent.id);
  });

  isAuthorMuted = computed<boolean>(() => {
    const currentEvent = this.event() || this.record()?.event;
    if (!currentEvent) return false;

    // Check pubkey-based muting
    const mutedAccounts = this.accountState.mutedAccounts();
    if (mutedAccounts.includes(currentEvent.pubkey)) {
      return true;
    }

    // Check if profile fields match any muted words
    if (this.reportingService.isProfileBlockedByMutedWord(currentEvent.pubkey)) {
      return true;
    }

    // Check if event content contains muted words, hashtags, or is a muted event
    if (this.reportingService.isContentBlocked(currentEvent)) {
      return true;
    }

    return false;
  });

  isHiddenFromFeed = computed<boolean>(() => {
    if (this.isLoadingEvent()) {
      return false;
    }

    if (this.suppressNotFoundState() && this.id() && !this.record()) {
      return true;
    }

    return this.isLocallyDeleted()
      || this.isAuthorMuted()
      || (this.isRepostEvent() && this.isRepostedContentFiltered());
  });

  // Retry trigger: bump to re-trigger the event load effect
  private retryCounter = signal(0);

  // Loading states
  isLoadingEvent = signal<boolean>(false);
  isLoadingThread = signal<boolean>(false);
  isLoadingReactions = signal<boolean>(false);
  isLoadingParent = signal<boolean>(false);
  isLoadingRoot = signal<boolean>(false);
  isLoadingZaps = signal<boolean>(false);
  isLoadingRepostedEvent = signal<boolean>(false);
  loadingError = signal<string | null>(null);

  // Signal for async-loaded reposted event (when repost has empty content)
  asyncRepostedEvent = signal<Event | null>(null);

  // NIP-41 Edit support
  // The most recent edit event for this note (kind 1010)
  latestEditEvent = signal<NostrRecord | null>(null);
  isLoadingEdit = signal<boolean>(false);

  // Whether the event has been edited (derived from latestEditEvent)
  isEdited = computed<boolean>(() => this.latestEditEvent() !== null);

  // Timestamp of the most recent edit
  editedAt = computed<number | undefined>(() => this.latestEditEvent()?.event.created_at);

  // Parent and root events for replies
  parentEvent = signal<Event | null>(null);
  rootEvent = signal<Event | null>(null);

  // Expansion state for thread context in timeline mode
  isRootEventExpanded = signal<boolean>(false);
  isParentEventExpanded = signal<boolean>(false);

  // Expansion state for main event content
  isMainContentExpanded = signal<boolean>(false);
  collapsedVideosExpanded = signal<boolean>(false);

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
    // Use visual length to account for nostr: references rendering as short display names
    return visualContentLength(content) <= this.CONTENT_LENGTH_THRESHOLD;
  }

  /**
   * Extract images and URLs from collapsed content
   * Images will be shown in an album layout, URLs will be shown as link previews
   */
  private extractCollapsedMedia(content: string, event?: Event): CollapsedContentMedia {
    const images: string[] = [];
    const videos: CollapsedVideoInfo[] = [];
    const urls: string[] = [];

    // Simple regex patterns to extract content
    const imageRegex = /(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)(\?[^\s]*)?)/gi;
    const videoRegex = /(https?:\/\/[^\s]+\.(mp4|webm|mov|ogg|m4v|mkv|avi)(\?[^\s]*)?)/gi;
    const urlRegex = /https?:\/\/[^\s<]+/gi;

    // Track seen URLs to avoid duplicates
    const seenImages = new Set<string>();
    const seenVideos = new Set<string>();
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

    // Extract videos
    while ((match = videoRegex.exec(content)) !== null) {
      const url = match[0];
      if (!seenVideos.has(url)) {
        seenVideos.add(url);
        // Look up imeta tag for this video URL
        const videoInfo: CollapsedVideoInfo = { url };
        if (event) {
          const imetaTag = event.tags.find(t => t[0] === 'imeta' && t.some(v => v === `url ${url}`));
          if (imetaTag) {
            const parsed = this.utilities.parseImetaTag(imetaTag);
            if (parsed['image']) {
              videoInfo.poster = parsed['image'];
            }
            if (parsed['dim']) {
              const [w, h] = parsed['dim'].split('x').map(Number);
              if (w && h) {
                videoInfo.aspectRatio = `${w} / ${h}`;
              }
            }
          }
        }
        videos.push(videoInfo);
      }
    }

    // Extract all other URLs (excluding images and videos)
    urlRegex.lastIndex = 0;
    while ((match = urlRegex.exec(content)) !== null) {
      const url = match[0];
      // Skip if it's an image, video, or already seen
      if (!seenImages.has(url) && !seenVideos.has(url) && !seenUrls.has(url)) {
        seenUrls.add(url);
        urls.push(url);
      }
    }

    return { images, videos, urls };
  }

  isPortraitAspectRatio(aspectRatio?: string): boolean {
    if (!aspectRatio) {
      return false;
    }

    const normalized = aspectRatio.replace(/\s+/g, '');
    const [widthValue, heightValue] = normalized.split('/').map(Number);

    if (!Number.isFinite(widthValue) || !Number.isFinite(heightValue) || widthValue <= 0 || heightValue <= 0) {
      return false;
    }

    return heightValue > widthValue;
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
    // Use visual length to account for nostr: references rendering as short display names
    return visualContentLength(content) > this.CONTENT_LENGTH_THRESHOLD;
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
    // Use visual length to account for nostr: references rendering as short display names
    return visualContentLength(content) > this.CONTENT_LENGTH_THRESHOLD;
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
    // Use visual length to account for nostr: references rendering as short display names
    return visualContentLength(content) > this.CONTENT_LENGTH_THRESHOLD;
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
    if (!this.isMainContentCollapsed()) return { images: [], videos: [], urls: [] };

    const targetItem = this.targetRecord();
    if (!targetItem) return { images: [], videos: [], urls: [] };

    const content = targetItem.event.content || '';
    return this.extractCollapsedMedia(content, targetItem.event);
  });

  rootCollapsedMedia = computed<CollapsedContentMedia>(() => {
    if (!this.isRootContentLong() || this.isRootEventExpanded()) return { images: [], videos: [], urls: [] };

    const rootRecordData = this.rootRecord();
    if (!rootRecordData) return { images: [], videos: [], urls: [] };

    const content = rootRecordData.event.content || '';
    return this.extractCollapsedMedia(content, rootRecordData.event);
  });

  parentCollapsedMedia = computed<CollapsedContentMedia>(() => {
    if (!this.isParentContentLong() || this.isParentEventExpanded()) return { images: [], videos: [], urls: [] };

    const parentRecordData = this.parentRecord();
    if (!parentRecordData) return { images: [], videos: [], urls: [] };

    const content = parentRecordData.event.content || '';
    return this.extractCollapsedMedia(content, parentRecordData.event);
  });

  // Check if this event card should be clickable (only kind 1)
  // Event kinds that should be navigable when clicked on the card.
  // These open their content-specific pages (articles, songs, playlists, streams, etc.)
  // or the generic thread view (kind 1).
  private readonly NAVIGABLE_KINDS = new Set([
    1,      // Short text note (kind 1) - opens thread
    30023,  // Long-form article (kind 30023) - opens article page
    30311,  // Live event (kind 30311) - opens stream page
    32100,  // M3U Playlist (kind 32100) - opens event page
    34139,  // Music album (kind 34139) - opens album page
    30003,  // Music playlist bookmark set (kind 30003) - opens playlist page
    36787,  // Music track (kind 36787) - opens song detail page
    1311,   // Live event comment (kind 1311) - opens referenced stream
    9802,   // Highlight (kind 9802) - opens thread
    31871,  // Web of Trust attestation (kind 31871) - opens event detail
  ]);

  isCardClickable = computed<boolean>(() => {
    // Use targetRecord to get the actual event (reposted event for reposts)
    const targetEvent = this.targetRecord()?.event;
    if (!targetEvent) return false;

    // Navigable if it's a known navigable kind OR an unknown kind (open thread)
    if (!this.NAVIGABLE_KINDS.has(targetEvent.kind) && isKnownRenderableKind(targetEvent.kind)) return false;

    // For reposts, the reposted content should always be clickable to navigate to it
    // even when viewing the repost directly
    if (this.isRepostEvent()) {
      return true;
    }

    return !this.isCurrentlySelected();
  });

  // Check if root event card should be clickable
  isRootCardClickable = computed<boolean>(() => {
    const rootRecordData = this.rootRecord();
    return !!rootRecordData && this.NAVIGABLE_KINDS.has(rootRecordData.event.kind);
  });

  // Check if parent event card should be clickable
  isParentCardClickable = computed<boolean>(() => {
    const parentRecordData = this.parentRecord();
    return !!parentRecordData && this.NAVIGABLE_KINDS.has(parentRecordData.event.kind);
  });

  // Event kinds that support reactions (NIP-25)
  // This includes: short text notes, photos, videos (short/long), audio, articles, polls, playlists, live events, starter packs, music tracks, emoji sets
  private readonly REACTABLE_KINDS = new Set([
    1,      // Short text note (kind 1)
    20,     // Photo (kind 20)
    21,     // Video (kind 21) - NIP-71 horizontal video
    22,     // Short video (kind 22) - NIP-71 vertical video
    1068,   // Poll (kind 1068)
    6969,   // Zap Poll (kind 6969)
    1111,   // Comment (kind 1111) - NIP-22
    1222,   // Audio track (kind 1222)
    1244,   // Audio file (kind 1244)
    9802,   // Highlight (kind 9802) - NIP-84
    30023,  // Long-form article (kind 30023)
    30030,  // Emoji set (kind 30030)
    30311,  // Live event (kind 30311)
    32100,  // M3U Playlist (kind 32100)
    34235,  // Video (kind 34235) - NIP-71 addressable horizontal video
    34236,  // Short video (kind 34236) - NIP-71 addressable vertical video
    36787,  // Music track (kind 36787)
    39089,  // Starter pack (kind 39089)
    31871,  // Web of Trust attestation (kind 31871)
  ]);

  // Check if the current event kind supports reactions
  // For reposts, check the reposted event's kind, not the repost kind itself
  // Unknown kinds (not natively rendered) also support reactions
  supportsReactions = computed<boolean>(() => {
    const targetEvent = this.targetRecord()?.event;
    if (!targetEvent) return false;
    return this.REACTABLE_KINDS.has(targetEvent.kind) || !isKnownRenderableKind(targetEvent.kind);
  });

  // Expose isKnownRenderableKind to the template so @else blocks can distinguish
  // known text kinds (1, 1111, etc.) from truly unknown kinds
  isKnownRenderable(kind: number): boolean {
    return isKnownRenderableKind(kind);
  }

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
    // Check either the event input or the record signal (for events loaded by ID)
    const event = this.event() || this.record()?.event;
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

  // Top 3 most used emojis in reactions
  topEmojis = computed<{ emoji: string; url?: string; count: number }[]>(() => {
    const reactions = this.likes();
    if (!reactions || reactions.length === 0) return [];

    // Count emoji occurrences
    const emojiCounts = new Map<string, { count: number; url?: string }>();

    for (const reaction of reactions) {
      let content = reaction.event.content || '+';
      // Normalize '+' to heart emoji for display
      if (content === '+') {
        content = '❤️';
      }

      const existing = emojiCounts.get(content);
      if (existing) {
        existing.count++;
      } else {
        // Check for custom emoji URL in tags
        let url: string | undefined;
        if (content.startsWith(':') && content.endsWith(':')) {
          const shortcode = content.slice(1, -1);
          const emojiTag = reaction.event.tags.find(
            (tag: string[]) => tag[0] === 'emoji' && tag[1] === shortcode
          );
          if (emojiTag && emojiTag[2]) {
            url = emojiTag[2];
          }
        }
        emojiCounts.set(content, { count: 1, url });
      }
    }

    // Sort by count descending and take top 3
    return Array.from(emojiCounts.entries())
      .map(([emoji, data]) => ({ emoji, url: data.url, count: data.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
  });

  // ─── Community vote pill (auto-detect from event tags) ───

  /** Whether the target event is a community post/reply (has 'a'/'A' tag with 34550:) */
  isCommunityEvent = computed<boolean>(() => {
    const item = this.targetRecord();
    if (!item?.event) return false;
    return item.event.tags.some(
      (t: string[]) => (t[0] === 'a' || t[0] === 'A') && t[1]?.startsWith('34550:')
    );
  });

  /** Vote score: upvotes minus downvotes */
  voteScore = computed<number>(() => {
    if (!this.isCommunityEvent()) return 0;
    const reactions = this.reactions();
    let score = 0;
    for (const record of reactions.events) {
      if (record.event.content === '+') score++;
      else if (record.event.content === '-') score--;
    }
    return score;
  });

  /** Current user's vote: 'up', 'down', or null */
  userVote = computed<'up' | 'down' | null>(() => {
    if (!this.isCommunityEvent()) return null;
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return null;
    const reactions = this.reactions();
    const userReaction = reactions.events.find((r: NostrRecord) => r.event.pubkey === pubkey);
    if (!userReaction) return null;
    if (userReaction.event.content === '+') return 'up';
    if (userReaction.event.content === '-') return 'down';
    return null;
  });

  /** Whether a vote operation is in progress */
  communityVoting = signal(false);

  /** Upvote: toggle on/off, or switch from downvote */
  async onCommunityUpvote(ev: globalThis.Event): Promise<void> {
    ev.stopPropagation();
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      await this.layout.showLoginDialog();
      return;
    }

    const targetEvent = this.targetRecord()?.event;
    if (!targetEvent) return;

    const currentVote = this.userVote();
    this.communityVoting.set(true);

    try {
      if (currentVote === 'up') {
        const userReaction = this.reactions().events.find(
          (r: NostrRecord) => r.event.pubkey === pubkey && r.event.content === '+'
        );
        if (userReaction) {
          await this.reactionService.deleteReaction(userReaction.event);
        }
      } else {
        if (currentVote === 'down') {
          const userReaction = this.reactions().events.find(
            (r: NostrRecord) => r.event.pubkey === pubkey && r.event.content === '-'
          );
          if (userReaction) {
            await this.reactionService.deleteReaction(userReaction.event);
          }
        }
        await this.reactionService.addLike(targetEvent);
      }
      await this.loadReactions(true);
    } catch (error) {
      this.logger.error('Failed to upvote:', error);
    } finally {
      this.communityVoting.set(false);
    }
  }

  /** Downvote: toggle on/off, or switch from upvote */
  async onCommunityDownvote(ev: globalThis.Event): Promise<void> {
    ev.stopPropagation();
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      await this.layout.showLoginDialog();
      return;
    }

    const targetEvent = this.targetRecord()?.event;
    if (!targetEvent) return;

    const currentVote = this.userVote();
    this.communityVoting.set(true);

    try {
      if (currentVote === 'down') {
        const userReaction = this.reactions().events.find(
          (r: NostrRecord) => r.event.pubkey === pubkey && r.event.content === '-'
        );
        if (userReaction) {
          await this.reactionService.deleteReaction(userReaction.event);
        }
      } else {
        if (currentVote === 'up') {
          const userReaction = this.reactions().events.find(
            (r: NostrRecord) => r.event.pubkey === pubkey && r.event.content === '+'
          );
          if (userReaction) {
            await this.reactionService.deleteReaction(userReaction.event);
          }
        }
        await this.reactionService.addDislike(targetEvent);
      }
      await this.loadReactions(true);
    } catch (error) {
      this.logger.error('Failed to downvote:', error);
    } finally {
      this.communityVoting.set(false);
    }
  }

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
  private _replyEventsInternal = signal<Event[]>([]);
  replyCountAnimating = signal(false);
  private replyCountAnimationTimer?: ReturnType<typeof setTimeout>;

  // Overflow flags - true when the query limit was reached (more exist on relays)
  hasMoreReactions = signal<boolean>(false);
  hasMoreReposts = signal<boolean>(false);
  hasMoreQuotes = signal<boolean>(false);
  hasMoreReplies = signal<boolean>(false);
  hasMoreZaps = signal<boolean>(false);

  // Build threaded replies from internally loaded reply events for passing to thread view
  private threadedRepliesFromInteractions = computed<ThreadedEvent[]>(() => {
    const events = this._replyEventsInternal();
    if (events.length === 0) return [];
    const targetRecordData = this.targetRecord();
    if (!targetRecordData) return [];
    return this.eventService.buildThreadTree(events, targetRecordData.event.id, true);
  });

  // Reply count - uses parent-provided value if available, otherwise uses internally loaded value
  replyCount = computed<number>(() => {
    const fromParent = this.replyCountFromParent();
    if (fromParent !== undefined) {
      return fromParent;
    }
    return this._replyCountInternal();
  });

  // Count of reposts only (quotes are shown separately)
  repostCount = computed<number>(() => {
    return this.reposts().length;
  });

  quoteCount = computed<number>(() => {
    return this.quotes().length;
  });

  // Combined reposts + quotes count for the Share button
  shareCount = computed<number>(() => {
    return this.repostCount() + this.quoteCount();
  });

  // Display-friendly counter strings that show "10+" when the query limit was hit
  likesDisplay = computed<string>(() => {
    const count = this.likes().length;
    if (count === 0) return '';
    if (this.hasMoreReactions()) return `${count - 1}+`;
    return `${count}`;
  });

  replyCountDisplay = computed<string>(() => {
    const count = this.replyCount();
    if (count === 0) return '';
    if (this.hasMoreReplies()) return `${count - 1}+`;
    return `${count}`;
  });

  shareCountDisplay = computed<string>(() => {
    const total = this.shareCount();
    if (total === 0) return '';
    const overflowCount = (this.hasMoreReposts() ? 1 : 0) + (this.hasMoreQuotes() ? 1 : 0);
    if (overflowCount > 0) {
      const displayCount = Math.max(total - overflowCount, 1);
      return `${displayCount}+`;
    }
    return `${total}`;
  });

  hasVisibleInteractionCounters = computed<boolean>(() => {
    return this.likes().length > 0 || this.replyCount() > 0 || this.shareCount() > 0;
  });

  interactionsLoading = computed<boolean>(() => {
    return this.hasLoadedInteractions() && this.isLoadingReactions() && !this.hasVisibleInteractionCounters();
  });

  interactionsReady = computed<boolean>(() => {
    return this.hasLoadedInteractions() && !this.isLoadingReactions();
  });

  zapsLoading = computed<boolean>(() => {
    return this.mode() !== 'timeline' && this.hasLoadedInteractions() && this.isLoadingZaps();
  });

  zapsReady = computed<boolean>(() => {
    return this.hasLoadedInteractions() && (this.mode() === 'timeline' || !this.isLoadingZaps());
  });

  engagementLoading = computed<boolean>(() => {
    return this.interactionsLoading() || this.zapsLoading();
  });

  engagementReady = computed<boolean>(() => {
    return this.hasLoadedInteractions() && !this.isLoadingReactions() && !this.isLoadingZaps();
  });

  // Reactions summary panel state
  showReactionsSummary = signal<boolean>(false);
  reactionsSummaryTab = signal<'reactions' | 'reposts' | 'quotes' | 'zaps'>('reactions');

  // Check if there's any engagement to show stats row
  hasAnyEngagement = computed<boolean>(() => {
    return this.likes().length > 0
      || this.replyCount() > 0
      || this.repostCount() > 0
      || this.quoteCount() > 0
      || this.totalZapAmount() > 0;
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

  readonly taggedUsersSpamThreshold = 50;

  taggedUsersCount = computed<number>(() => {
    const targetItem = this.targetRecord();
    if (!targetItem?.event?.tags?.length) {
      return 0;
    }

    const taggedUsers = new Set(
      targetItem.event.tags
        .filter(tag => tag[0] === 'p' && typeof tag[1] === 'string' && tag[1].length > 0)
        .map(tag => tag[1])
    );

    return taggedUsers.size;
  });

  showTaggedUsersSpamWarning = computed<boolean>(() => {
    return this.taggedUsersCount() > this.taggedUsersSpamThreshold;
  });

  confirmedSpamEventId = signal<string | null>(null);

  isSpamConfirmedForCurrentEvent = computed<boolean>(() => {
    const targetItem = this.targetRecord();
    if (!targetItem) {
      return false;
    }
    return this.confirmedSpamEventId() === targetItem.event.id;
  });

  requiresSpamConfirmation = computed<boolean>(() => {
    return this.showTaggedUsersSpamWarning() && !this.isSpamConfirmedForCurrentEvent();
  });

  confirmSpamActions(event?: MouseEvent): void {
    event?.stopPropagation();
    const targetItem = this.targetRecord();
    if (!targetItem) {
      return;
    }
    this.confirmedSpamEventId.set(targetItem.event.id);
  }

  /**
   * Get the displayed record with NIP-41 edit support
   * Returns a record with the edited content if an edit exists, otherwise the original record
   * The event ID and other metadata remain from the original event (for reactions, etc.)
   */
  displayedRecord = computed<NostrRecord | null>(() => {
    const targetItem = this.targetRecord();
    if (!targetItem) return null;

    const editEvent = this.latestEditEvent();
    if (editEvent && targetItem.event.kind === 1) {
      // Return a new record with the edited content but original event metadata
      return {
        event: targetItem.event,
        data: editEvent.event.content,  // For kind 1, data is the text content
      };
    }

    return targetItem;
  });

  xLinkedPost = computed(() => {
    const targetEvent = this.targetRecord()?.event;
    const taggedXUrl = getTaggedXUrl(targetEvent);

    if (targetEvent && taggedXUrl) {
      return {
        nostrEventId: targetEvent.id,
        xPostId: '',
        url: taggedXUrl,
      };
    }

    return undefined;
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

  hasReplyContextTargets = computed<boolean>(() => {
    return !!(this.rootEventId() || this.replyEventId());
  });

  shouldShowReplyHeader = computed<boolean>(() => {
    if (!this.isReply()) {
      return false;
    }

    return !!(
      this.parentRecord()
      || this.rootRecord()
      || this.isLoadingParent()
      || this.isLoadingRoot()
      || this.hasReplyContextTargets()
    );
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
        const previousEventId = this.record()?.event.id;
        const isSameEvent = previousEventId === event.id;
        const record = this.data.toRecord(event);
        this.record.set(record);

        // console.log('📝 [Event Setup] Record created for event:', event.id.substring(0, 8), '| Kind:', event.kind);

        if (!isSameEvent) {
          // CRITICAL: Clear all interaction state only when the component is reused
          // for a different event ID. Feed/profile timelines can re-emit the same
          // event object, and resetting here would wipe counters mid-load.
          this.clearInteractionState();
          this.asyncRepostedEvent.set(null);
          this.latestEditEvent.set(null);
          this.hasLoadedInteractions.set(false);
          this.observedEventId = event.id;
          this.hasLoadedEdit = false;
          this.retriedVisibleInteractionRecoveryEventId = undefined;
          this.fullVisibleInteractionRecoveryEventId = undefined;
          this.interactionLoadGeneration += 1;
          this.interactionAbortController?.abort();
          this.interactionAbortController = undefined;
          EventComponent.cancelQueuedInteractionPreload(this);
          this.hasBeenActuallyVisible = false;

          // Re-register with shared IntersectionObserver when the component is reused
          // for a different event.
          this.setupIntersectionObserver();
        }

        if (this.hasViewInitialized) {
          if (this.isExternalEngagementControlEnabled()) {
            this.maybePreloadInteractionsFromExternalRequest();
          } else {
            this.checkAndLoadInteractionsIfVisible();
          }
        }

        if (this.isExternalEngagementControlEnabled()) {
          this.maybePreloadInteractionsFromExternalRequest();
        } else {
          this.maybePreloadInteractionsImmediately();
        }
      });
    });

    effect(() => {
      const requested = this.engagementLoadRequested();
      const priority = this.engagementLoadPriority();
      const currentRecord = this.record();

      if (!this.isExternalEngagementControlEnabled()) {
        return;
      }

      if (!requested || !currentRecord) {
        untracked(() => {
          if (this.interactionLoadTimer) {
            clearTimeout(this.interactionLoadTimer);
            this.interactionLoadTimer = undefined;
          }

          EventComponent.cancelQueuedInteractionPreload(this);
        });
        return;
      }

      void priority;

      untracked(() => {
        this.maybePreloadInteractionsFromExternalRequest();
      });
    });

    effect(() => {
      const snapshot = this.eventService.latestInteractionSnapshot();
      const targetRecordData = this.targetRecord();

      if (!snapshot || !targetRecordData || this.mode() !== 'timeline') {
        return;
      }

      if (snapshot.eventId !== targetRecordData.event.id || snapshot.publishedAt <= this.lastAppliedSharedInteractionSnapshotAt) {
        return;
      }

      untracked(() => {
        this.applySharedInteractionSnapshot(snapshot);
      });
    });

    // Effect to load event by ID when only id is provided (not event)
    effect(() => {
      if (this.app.initialized()) {
        const rawId = this.id();
        const type = this.type();
        const existingEvent = this.event();
        // Read retryCounter so bumping it re-triggers this effect
        this.retryCounter();

        // Only load by ID if no event is provided directly
        if (!rawId || !type || existingEvent) {
          return;
        }

        untracked(async () => {
          if (type === 'e' || type === 'a') {
            this.isLoadingEvent.set(true);
            this.loadingError.set(null);

            // Decode nevent1/naddr1 bech32 strings to extract hex ID and relay hints
            let eventId = rawId;
            let decodedRelayHints: string[] | undefined;
            try {
              if (rawId.startsWith('nevent1')) {
                const decoded = nip19.decode(rawId);
                if (decoded.type === 'nevent') {
                  eventId = decoded.data.id;
                  decodedRelayHints = decoded.data.relays;
                }
              } else if (rawId.startsWith('naddr1')) {
                const decoded = nip19.decode(rawId);
                if (decoded.type === 'naddr') {
                  // For addressable events, reconstruct the coordinate-based ID
                  eventId = `${decoded.data.kind}:${decoded.data.pubkey}:${decoded.data.identifier}`;
                  decodedRelayHints = decoded.data.relays;
                }
              }
            } catch {
              this.logger.warn('[EventComponent:Load] Failed to decode bech32 id, using as-is:', rawId.substring(0, 20));
            }

            // Merge relay hints: explicit input takes priority, then decoded from bech32
            const inputHints = this.relayHints();
            const hints = (inputHints && inputHints.length > 0) ? inputHints : decodedRelayHints;

            this.logger.debug('[EventComponent:Load] Starting fetch for eventId:', eventId.substring(0, 16), '| type:', type, '| hints:', hints);

            try {
              let eventData = null;

              // If relay hints are provided (explicit or decoded from nevent/naddr), try those first
              if (hints && hints.length > 0) {
                this.logger.debug('[EventComponent:Load] Has relay hints:', hints, '| checking cache first...');
                // First check cache/database
                eventData = await this.data.getEventById(eventId, { cache: true, save: false });
                this.logger.debug('[EventComponent:Load] Cache lookup result:', eventData ? 'FOUND' : 'NOT FOUND');

                // If not found locally, try the hinted relays
                if (!eventData) {
                  this.logger.debug('[EventComponent:Load] Trying hinted relays:', hints, '| eventId:', eventId);
                  const event = await this.relayPool.getEventById(hints, eventId, 10000);
                  this.logger.debug('[EventComponent:Load] Relay hint fetch result:', event ? 'FOUND' : 'NOT FOUND');
                  if (event) {
                    eventData = this.data.toRecord(event);
                  }
                }
              } else {
                this.logger.debug('[EventComponent:Load] No relay hints available');
              }

              // Fall back to normal loading if relay hints didn't work
              if (!eventData) {
                this.logger.debug('[EventComponent:Load] Falling back to normal getEventById for:', eventId.substring(0, 16));
                // Use cache and save options to:
                // 1. Check in-memory cache first
                // 2. Check database before hitting relays
                // 3. Persist fetched events for future loads
                eventData = await this.data.getEventById(eventId, { cache: true, save: true });
                this.logger.debug('[EventComponent:Load] Normal fetch result:', eventData ? `FOUND (kind: ${eventData.event?.kind})` : 'NOT FOUND');
              }

              this.record.set(eventData);

              if (!eventData) {
                this.logger.warn('[EventComponent:Load] Event NOT FOUND after all attempts. eventId:', eventId);
              } else {
                this.logger.debug('[EventComponent:Load] Event loaded successfully. id:', eventData.event?.id?.substring(0, 16), '| kind:', eventData.event?.kind);
              }

              // After loading the event by ID, check if we need to load interactions
              // This handles the case where the element was already visible before the event loaded
              // (e.g., trending posts) - the intersection observer won't re-trigger since the element
              // was already visible, so we need to manually trigger interaction loading
              if (this.isExternalEngagementControlEnabled()) {
                this.maybePreloadInteractionsFromExternalRequest();
              } else {
                this.checkAndLoadInteractionsIfVisible();
                this.maybePreloadInteractionsImmediately();
              }
            } catch (error) {
              this.logger.error('[EventComponent:Load] Error loading event:', error, '| eventId:', eventId);
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

          const loadTasks: Promise<void>[] = [];

          // Load immediate parent (reply)
          if (replyId) {
            loadTasks.push(this.loadParentEvent(replyId, eventTags));
          }

          // Load root event if it's different from reply
          if (rootId && rootId !== replyId) {
            loadTasks.push(this.loadRootEvent(rootId, eventTags));
          }

          if (loadTasks.length > 0) {
            await Promise.all(loadTasks);
          }
        });
      } else {
        this.parentEvent.set(null);
        this.rootEvent.set(null);
        this.isLoadingParent.set(false);
        this.isLoadingRoot.set(false);
      }
    });

    // Effect to reload reports when a new report is published for this event
    effect(() => {
      const reportNotification = this.reportingService.getReportPublishedSignal()();
      const currentEvent = this.event() || this.record()?.event;

      if (reportNotification && currentEvent && reportNotification.eventId === currentEvent.id) {
        untracked(async () => {
          this.logger.debug('[Report Notification] New report detected for event:', currentEvent.id.substring(0, 8));
          // Reload reports with cache invalidation to get the fresh data
          await this.loadReports(true);
        });
      }
    });

    effect(() => {
      const currentEventId = this.id() || this.event()?.id || this.record()?.event.id;

      if (!currentEventId) {
        return;
      }

      this.hiddenChange.emit(this.isHiddenFromFeed());
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
        this.logger.warn('[Repost] No event reference found in repost:', event.id.substring(0, 8));
        return;
      }

      untracked(async () => {
        this.logger.debug('[Repost] Loading referenced event from relay hint:',
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
                this.logger.debug('[Repost] Found event from relay hint:', reference.eventId.substring(0, 8));
              }
            } catch (error) {
              this.logger.debug('Relay hint fetch failed for repost:', reference.eventId, error);
            }
          }

          // If relay hint didn't work, try fetching from data service (local DB + user relays)
          if (!repostedEvent) {
            const record = await this.data.getEventById(reference.eventId);
            if (record?.event) {
              repostedEvent = record.event;
              this.logger.debug('[Repost] Found event from data service:', reference.eventId.substring(0, 8));
            }
          }

          if (repostedEvent) {
            this.asyncRepostedEvent.set(repostedEvent);
          } else {
            this.logger.warn('[Repost] Could not find referenced event:', reference.eventId.substring(0, 8));
          }
        } catch (error) {
          this.logger.error('Error loading reposted event:', error);
        } finally {
          this.isLoadingRepostedEvent.set(false);
        }
      });
    });

  }

  /**
   * Load NIP-41 edit events for kind 1 notes.
   * Only loads edits when this event is the main/focused event on the page
   * (navigationDisabled=true), not for replies in threads or events in timelines.
   */
  private async loadLatestEditForEvent(): Promise<void> {
    if (this.hasLoadedEdit) return;

    // Only load edits for the main focused event, not replies or timeline items
    if (!this.navigationDisabled()) return;

    const event = this.event() || this.record()?.event;
    if (!event || event.kind !== 1) return;

    this.hasLoadedEdit = true;
    this.isLoadingEdit.set(true);
    try {
      const editRecord = await this.eventService.loadLatestEdit(
        event.id,
        event.pubkey
      );
      this.latestEditEvent.set(editRecord);
    } catch (error) {
      this.logger.error('Error loading edit event:', error);
    } finally {
      this.isLoadingEdit.set(false);
    }
  }

  retryLoadEvent(): void {
    this.record.set(null);
    this.loadingError.set(null);
    this.retryCounter.update(c => c + 1);
  }

  private hasLoadedEdit = false;
  private readonly runtimeResourceProfile = getRuntimeResourceProfile();
  private readonly interactionPreloadDelayMs = this.runtimeResourceProfile.likelyConstrained ? 120 : 0;
  private readonly interactionViewportPreloadMarginPx = this.runtimeResourceProfile.likelyConstrained ? 700 : 1400;
  private readonly timelineInteractionRootMargin = this.runtimeResourceProfile.likelyConstrained
    ? '800px 0px 1200px 0px'
    : '1600px 0px 2200px 0px';
  private readonly viewportInteractionRootMargin = this.runtimeResourceProfile.likelyConstrained
    ? '700px 0px 1000px 0px'
    : '1400px 0px 1800px 0px';
  private readonly immediateDomPreloadAheadPx = this.runtimeResourceProfile.likelyConstrained ? 450 : 900;
  private readonly immediateDomPreloadBehindPx = this.runtimeResourceProfile.likelyConstrained ? 150 : 250;
  private readonly initialBatchPreloadCount = this.runtimeResourceProfile.likelyConstrained ? 4 : 12;
  private readonly interactionVerificationLimitMultiplier = 4;
  private readonly visibleRecoveryLimitMultiplier = 12;
  private readonly emptyInteractionRetryMinAgeSeconds = 600;
  private readonly actualVisibilityObserverOptions = {
    rootMargin: '0px',
    threshold: 0.01,
  } as const;
  private retriedEmptyInteractionEventId?: string;
  private retriedVisibleInteractionRecoveryEventId?: string;
  private fullVisibleInteractionRecoveryEventId?: string;

  private static startInteractionPreload(component: EventComponent, priority: number): void {
    EventComponent.queuedInteractionPreloads.delete(component);
    EventComponent.activeInteractionPreloads.set(component, priority);

    void component.startQueuedInteractionLoad().finally(() => {
      EventComponent.activeInteractionPreloads.delete(component);
      EventComponent.processInteractionPreloadQueue();
    });
  }

  private static processInteractionPreloadQueue(): void {
    while (
      EventComponent.activeInteractionPreloads.size < EventComponent.interactionPreloadConcurrency
      && EventComponent.queuedInteractionPreloads.size > 0
    ) {
      const nextEntry = [...EventComponent.queuedInteractionPreloads.entries()]
        .sort(([, leftPriority], [, rightPriority]) => leftPriority - rightPriority)[0];

      if (!nextEntry) {
        return;
      }

      const [component] = nextEntry;
      EventComponent.startInteractionPreload(component, nextEntry[1]);
    }
  }

  private static enqueueInteractionPreload(component: EventComponent, priority: number): void {
    const existingPriority = EventComponent.queuedInteractionPreloads.get(component);
    if (existingPriority === undefined || priority < existingPriority) {
      EventComponent.queuedInteractionPreloads.set(component, priority);
    }

    if (EventComponent.activeInteractionPreloads.has(component)) {
      return;
    }

    const canUseBoostSlot = priority <= EventComponent.interactionPreloadUrgentThresholdPx
      && EventComponent.activeInteractionPreloads.size < (EventComponent.interactionPreloadConcurrency + EventComponent.interactionPreloadBoostConcurrency);

    if (canUseBoostSlot) {
      EventComponent.startInteractionPreload(component, priority);
      return;
    }

    EventComponent.processInteractionPreloadQueue();
  }

  private static cancelQueuedInteractionPreload(component: EventComponent): void {
    EventComponent.queuedInteractionPreloads.delete(component);
  }

  private clearInteractionState(): void {
    this.reactions.set({ events: [], data: new Map() });
    this.reposts.set([]);
    this.reports.set({ events: [], data: new Map() });
    this.zaps.set([]);
    this.quotes.set([]);
    this.hasMoreReactions.set(false);
    this.hasMoreReposts.set(false);
    this.hasMoreReplies.set(false);
    this.hasMoreQuotes.set(false);
    this.hasMoreZaps.set(false);
    this._replyCountInternal.set(0);
    this._replyEventsInternal.set([]);
    this.isLoadingReactions.set(false);
    this.isLoadingZaps.set(false);
  }

  ngAfterViewInit(): void {
    this.hasViewInitialized = true;
    // Set up IntersectionObserver for lazy loading
    this.setupIntersectionObserver();

    if (this.isExternalEngagementControlEnabled()) {
      this.maybePreloadInteractionsFromExternalRequest();
      return;
    }

    this.checkAndLoadInteractionsIfVisible();
    this.maybePreloadInteractionsImmediately();
    this.scheduleVisibleInteractionRetry();
  }

  /**
   * Set up or recreate IntersectionObserver to lazy load interactions when event becomes visible.
   * Also handles off-screen virtualization: when an event that has already been rendered scrolls
   * out of the viewport (plus buffer), it is replaced with a height-preserving placeholder to
   * reduce DOM size and change detection cost.
   *
   * Uses a generous rootMargin so interactions start loading before the card reaches the viewport.
   * Virtualization on leave is debounced (200ms) to prevent rapid toggling during fast scrolls
   * or programmatic scroll-to-top (e.g. "new posts" button).
   */
  private setupIntersectionObserver(): void {
    // Unregister from shared observer first (in case this is a re-setup)
    this.intersectionObserverService.unobserve(this.elementRef.nativeElement);

    const eventElement = this.elementRef.nativeElement as HTMLElement;
    const observerRoot = this.resolveObserverRoot(eventElement);

    this.intersectionObserverService.observe(
      eventElement,
      (isIntersecting) => {
        if (isIntersecting) {
          this.hasBeenActuallyVisible = true;
        }
      },
      {
        root: observerRoot,
        ...this.actualVisibilityObserverOptions,
      }
    );

    // Use shared IntersectionObserver service instead of per-component observer
    this.intersectionObserverService.observe(
      eventElement,
      (isIntersecting) => {
        if (isIntersecting) {
          // --- Entering viewport (or buffer zone) ---
          // Cancel any pending virtualization — the event is back in view
          if (this.virtualizeTimer) {
            clearTimeout(this.virtualizeTimer);
            this.virtualizeTimer = undefined;
          }

          // Restore from CSS-hidden state if virtualized.
          // content-visibility: hidden keeps the DOM intact but skips rendering.
          // Removing it instantly paints the existing DOM — no reconstruction, no layout shift.
          if (this.isOffScreen) {
            const el = this.elementRef.nativeElement as HTMLElement;
            el.style.contentVisibility = '';
            el.style.containIntrinsicSize = '';
            this.isOffScreen = false;
          }

          if (!this.hasLoadedInteractions() && !this.isExternalEngagementControlEnabled()) {
            // CRITICAL: Capture the current event at the moment of intersection
            // This prevents loading interactions for the wrong event
            const currentRecord = this.record();
            const currentEventId = currentRecord?.event.id;

            if (!currentRecord || !currentEventId) {
              this.logger.warn('[Lazy Load] No record available when event became visible');
              return;
            }

            this.logger.debug('[Lazy Load] Event became visible:', currentEventId.substring(0, 8));

            // Store which event we're loading for to prevent cross-contamination
            this.observedEventId = currentEventId;

            this.scheduleInteractionPreload(currentEventId, observerRoot);
            this.scheduleVisibleInteractionRetry();
          }
        } else {
          // --- Leaving viewport (and buffer zone) ---

          if (!this.isExternalEngagementControlEnabled()) {
            // Cancel any pending interaction load that hasn't started yet.
            // This prevents relay queries from firing for events the user scrolled past.
            if (this.interactionLoadTimer) {
              clearTimeout(this.interactionLoadTimer);
              this.interactionLoadTimer = undefined;
            }

            if (this.visibleInteractionRetryTimer) {
              clearTimeout(this.visibleInteractionRetryTimer);
              this.visibleInteractionRetryTimer = undefined;
            }

            EventComponent.cancelQueuedInteractionPreload(this);

            // Abort any in-flight interaction queries.
            // The relay query itself will complete, but result processing is skipped.
            if (this.interactionAbortController) {
              this.interactionAbortController.abort();
              this.interactionAbortController = undefined;
              this.isLoadingReactions.set(false);
              this.isLoadingZaps.set(false);
              this.interactionLoadGeneration += 1;
            }

            // If interactions were marked as loading but results haven't been applied yet
            // (e.g. isLoadingReactions is still true), reset so they can re-trigger
            // when the event scrolls back into view.
            if (this.hasLoadedInteractions() && this.isLoadingReactions()) {
              this.hasLoadedInteractions.set(false);
            }
          }

          // Only virtualize if the event has actually been visible inside the real
          // scrollport at least once, and virtualization is appropriate for this
          // usage context. This avoids hiding items that only touched the preload
          // buffer below the viewport but were never truly seen.
          if (this.hasBeenActuallyVisible && this.shouldVirtualize()) {
            // Capture height immediately while the DOM is still rendered.
            // Use getBoundingClientRect for sub-pixel accuracy with flex layouts.
            const el = this.elementRef.nativeElement as HTMLElement;
            const height = el.getBoundingClientRect().height;

            if (height > 0) {
              // Debounce: wait 200ms before virtualizing. If the event re-enters
              // the viewport within this window (fast scroll, scroll-to-top),
              // the timer is cancelled above and the event stays rendered.
              if (this.virtualizeTimer) {
                clearTimeout(this.virtualizeTimer);
              }
              this.virtualizeTimer = setTimeout(() => {
                this.virtualizeTimer = undefined;
                // Re-check height in case layout shifted during the debounce window
                const currentHeight = el.getBoundingClientRect().height;
                const finalHeight = currentHeight > 0 ? Math.ceil(currentHeight) : Math.ceil(height);
                this.lastHeight = finalHeight;

                // Apply CSS content-visibility: hidden on the :host element.
                // This tells the browser to skip rendering all children while
                // preserving the element's space via contain-intrinsic-size.
                // The DOM stays intact — no destruction/reconstruction needed on restore.
                el.style.containIntrinsicSize = `auto ${finalHeight}px`;
                el.style.contentVisibility = 'hidden';
                this.isOffScreen = true;
              }, 200);
            }
          }

          if (!this.hasLoadedInteractions() && !this.isExternalEngagementControlEnabled()) {
            this.maybePreloadInteractionsImmediately();
          }
        }
      },
      {
        root: observerRoot,
        rootMargin: observerRoot ? this.timelineInteractionRootMargin : this.viewportInteractionRootMargin,
        threshold: 0.01, // Trigger when at least 1% is visible
      }
    );
  }

  private scheduleInteractionPreload(currentEventId: string, observerRoot: HTMLElement | null): void {
    if (this.interactionLoadTimer) {
      clearTimeout(this.interactionLoadTimer);
    }

    this.interactionLoadTimer = setTimeout(() => {
      this.interactionLoadTimer = undefined;

      if (this.record()?.event.id !== currentEventId) {
        this.logger.warn('[Lazy Load] Event changed during interaction delay, skipping:', currentEventId.substring(0, 8));
        return;
      }

      const priority = this.getInteractionPreloadPriority(observerRoot);
      EventComponent.enqueueInteractionPreload(this, priority);
      this.scheduleVisibleInteractionRetry();
    }, this.interactionPreloadDelayMs);
  }

  private scheduleVisibleInteractionRetry(): void {
    if (this.visibleInteractionRetryTimer) {
      clearTimeout(this.visibleInteractionRetryTimer);
    }

    this.visibleInteractionRetryTimer = setTimeout(() => {
      this.visibleInteractionRetryTimer = undefined;

      const element = this.elementRef.nativeElement as HTMLElement | undefined;
      const currentRecord = this.record();
      if (!element?.isConnected || !currentRecord || !this.supportsReactions()) {
        return;
      }

      const externalRequestActive = this.isExternalEngagementRequested();
      if (this.isExternalEngagementControlEnabled() && !externalRequestActive) {
        return;
      }

      if (this.hasLoadedInteractions()) {
        if (this.shouldRetryVisibleTimelineInteractions(currentRecord.event.id, element)) {
          void this.retryVisibleTimelineInteractions(currentRecord.event.id);
        }
        return;
      }

      if (!externalRequestActive && !this.isWithinImmediatePreloadBounds(element)) {
        return;
      }

      if (this.isLoadingReactions() || this.isLoadingZaps()) {
        this.scheduleVisibleInteractionRetry();
        return;
      }

      const currentEventId = currentRecord.event.id;
      this.observedEventId = currentEventId;
      const priority = externalRequestActive
        ? this.getExternalInteractionPreloadPriority()
        : this.getInteractionPreloadPriority(this.resolveObserverRoot(element));
      const retryLabel = externalRequestActive ? '[Feed Preload]' : '[Lazy Load]';
      this.logger.debug(retryLabel, 'Retrying interaction preload for event:', currentEventId.substring(0, 8), 'priority:', priority);
      EventComponent.enqueueInteractionPreload(this, priority);

      if (!this.hasLoadedInteractions()) {
        this.scheduleVisibleInteractionRetry();
      }
    }, 900);
  }

  private shouldRetryVisibleTimelineInteractions(currentEventId: string, element: HTMLElement): boolean {
    if (this.mode() !== 'timeline' || !this.inFeedsPanel()) {
      return false;
    }

    if (this.retriedVisibleInteractionRecoveryEventId === currentEventId) {
      return false;
    }

    if (!this.isExternalEngagementRequested() && !this.isWithinImmediatePreloadBounds(element)) {
      return false;
    }

    const hasAnyEngagementLoaded = this.reactions().events.length > 0
      || this.reposts().length > 0
      || this.replyCount() > 0
      || this.quotes().length > 0
      || this.zaps().length > 0;

    if (hasAnyEngagementLoaded) {
      return false;
    }

    if (this.isExternalEngagementRequested()) {
      return true;
    }

    const observerRoot = this.resolveObserverRoot(element);
    const priority = this.getInteractionPreloadPriority(observerRoot);
    return priority <= 0 || this.shouldForceInitialBatchPreload(element);
  }

  private async retryVisibleTimelineInteractions(currentEventId: string): Promise<void> {
    if (this.retriedVisibleInteractionRecoveryEventId === currentEventId) {
      return;
    }

    this.retriedVisibleInteractionRecoveryEventId = currentEventId;
    const loadGeneration = ++this.interactionLoadGeneration;
    const recoveryLimit = EventService.INTERACTION_QUERY_LIMIT * this.visibleRecoveryLimitMultiplier;

    this.logger.debug(
      '[Loading Interactions] Retrying visible timeline engagement for:',
      currentEventId.substring(0, 8),
      'limit:',
      recoveryLimit,
    );
    await Promise.allSettled([
      this.loadAllInteractions(true, undefined, loadGeneration, recoveryLimit),
      this.loadDeferredTimelineEngagement(undefined, loadGeneration, true, recoveryLimit),
    ]);

    if (this.interactionLoadGeneration === loadGeneration) {
      if (this.shouldEscalateVisibleInteractionRecovery(currentEventId)) {
        await this.loadFullVisibleInteractionRecovery(currentEventId, loadGeneration);
      }
    }
  }

  private shouldEscalateVisibleInteractionRecovery(currentEventId: string): boolean {
    if (this.fullVisibleInteractionRecoveryEventId === currentEventId) {
      return false;
    }

    const element = this.elementRef.nativeElement as HTMLElement | undefined;
    if (!element?.isConnected) {
      return false;
    }

    if (!this.isExternalEngagementRequested() && !this.isWithinImmediatePreloadBounds(element)) {
      return false;
    }

    const currentRecord = this.targetRecord();
    if (!currentRecord || currentRecord.event.id !== currentEventId) {
      return false;
    }

    const eventAgeSeconds = Math.floor(Date.now() / 1000) - currentRecord.event.created_at;
    if (eventAgeSeconds < this.emptyInteractionRetryMinAgeSeconds) {
      return false;
    }

    return this.reactions().events.length === 0
      && this.reposts().length === 0
      && this.replyCount() === 0;
  }

  private async loadFullVisibleInteractionRecovery(currentEventId: string, loadGeneration: number): Promise<void> {
    this.fullVisibleInteractionRecoveryEventId = currentEventId;
    this.logger.debug(
      '[Loading Interactions] Escalating visible timeline engagement to full recovery for:',
      currentEventId.substring(0, 8),
    );

    await this.loadAllInteractions(true, undefined, loadGeneration, null);

    if (this.interactionLoadGeneration === loadGeneration) {
      await this.loadZaps(undefined, loadGeneration, true);
    }
  }

  private maybePreloadInteractionsImmediately(): void {
    if (this.isExternalEngagementControlEnabled()) {
      return;
    }

    if (!this.hasViewInitialized || this.hasLoadedInteractions() || !this.supportsReactions()) {
      return;
    }

    const currentRecord = this.record();
    const element = this.elementRef.nativeElement as HTMLElement | undefined;

    if (!currentRecord || !element?.isConnected) {
      return;
    }

    if (!this.shouldForceInitialBatchPreload(element) && !this.isWithinImmediatePreloadBounds(element)) {
      return;
    }

    const currentEventId = currentRecord.event.id;
    this.observedEventId = currentEventId;

    const observerRoot = this.resolveObserverRoot(element);
    const priority = this.getInteractionPreloadPriority(observerRoot);
    this.logger.debug('[Lazy Load] Queueing immediate preload for event:', currentEventId.substring(0, 8), 'priority:', priority);
    EventComponent.enqueueInteractionPreload(this, priority);
    this.scheduleVisibleInteractionRetry();
  }

  private maybePreloadInteractionsFromExternalRequest(): void {
    if (!this.hasViewInitialized || this.hasLoadedInteractions() || !this.supportsReactions()) {
      return;
    }

    if (!this.isExternalEngagementRequested()) {
      return;
    }

    const currentRecord = this.record();
    const element = this.elementRef.nativeElement as HTMLElement | undefined;

    if (!currentRecord || !element?.isConnected || this.isLoadingReactions() || this.isLoadingZaps()) {
      return;
    }

    const currentEventId = currentRecord.event.id;
    this.observedEventId = currentEventId;
    const priority = this.getExternalInteractionPreloadPriority();
    this.logger.debug('[Feed Preload] Queueing feed-managed engagement preload for event:', currentEventId.substring(0, 8), 'priority:', priority);
    EventComponent.enqueueInteractionPreload(this, priority);
    this.scheduleVisibleInteractionRetry();
  }

  private getInteractionPreloadPriority(observerRoot: HTMLElement | null): number {
    const elementRect = this.elementRef.nativeElement.getBoundingClientRect();

    if (observerRoot) {
      const rootRect = observerRoot.getBoundingClientRect();
      if (elementRect.bottom < rootRect.top) {
        return 100000 + Math.round(rootRect.top - elementRect.bottom);
      }

      if (elementRect.top > rootRect.bottom) {
        return Math.round(elementRect.top - rootRect.bottom);
      }

      return 0;
    }

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

    if (elementRect.bottom < 0) {
      return 100000 + Math.round(-elementRect.bottom);
    }

    if (elementRect.top > viewportHeight) {
      return Math.round(elementRect.top - viewportHeight);
    }

    return 0;
  }

  private isWithinImmediatePreloadBounds(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    const observerRoot = this.resolveObserverRoot(element);

    if (observerRoot) {
      const rootRect = observerRoot.getBoundingClientRect();
      return rect.top < rootRect.bottom + this.immediateDomPreloadAheadPx
        && rect.bottom > rootRect.top - this.immediateDomPreloadBehindPx;
    }

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    return rect.top < viewportHeight + this.immediateDomPreloadAheadPx
      && rect.bottom > -this.immediateDomPreloadBehindPx;
  }

  private shouldForceInitialBatchPreload(element: HTMLElement): boolean {
    if (!this.inFeedsPanel()) {
      return false;
    }

    const parent = element.parentElement;
    if (!parent) {
      return false;
    }

    let eventIndex = 0;
    for (const child of Array.from(parent.children)) {
      if (child.tagName.toLowerCase() !== 'app-event') {
        continue;
      }

      if (child === element) {
        return eventIndex < this.initialBatchPreloadCount;
      }

      eventIndex += 1;
    }

    return false;
  }

  private async startQueuedInteractionLoad(): Promise<void> {
    const currentEventId = this.observedEventId;

    if (!currentEventId || this.record()?.event.id !== currentEventId || this.hasLoadedInteractions()) {
      return;
    }

    if (this.disableEngagementLoading()) {
      return;
    }

    this.clearInteractionState();
    this.hasLoadedInteractions.set(true);
    const loadGeneration = ++this.interactionLoadGeneration;

    this.interactionAbortController?.abort();
    this.interactionAbortController = new AbortController();

    if (!this.supportsReactions()) {
      return;
    }

    const targetRecordData = this.targetRecord();
    this.logger.debug('[Lazy Load] Loading prioritized interactions for event:',
      targetRecordData?.event.id.substring(0, 8), 'kind:', targetRecordData?.event.kind);

    if (this.record()?.event.id !== currentEventId) {
      this.logger.warn('[Lazy Load] Event changed before prioritized loading, skipping:', currentEventId.substring(0, 8));
      this.hasLoadedInteractions.set(false);
      return;
    }

    const signal = this.interactionAbortController.signal;

    if (this.mode() === 'timeline') {
      void this.loadDeferredTimelineEngagement(signal, loadGeneration, false);

      await Promise.allSettled([
        this.loadAllInteractions(false, signal, loadGeneration),
        this.loadLatestEditForEvent(),
      ]);

      if (this.interactionLoadGeneration === loadGeneration && !signal.aborted) {
        this.scheduleVisibleInteractionRetry();
      }
      return;
    }

    await Promise.allSettled([
      this.loadAllInteractions(false, signal, loadGeneration),
      this.loadZaps(signal, loadGeneration),
      this.loadLatestEditForEvent(),
    ]);

    if (this.interactionLoadGeneration === loadGeneration && !signal.aborted) {
      this.scheduleVisibleInteractionRetry();
    }
  }

  private async loadDeferredTimelineEngagement(
    signal?: AbortSignal,
    loadGeneration?: number,
    invalidateCache = false,
    queryLimitOverride?: number,
  ): Promise<void> {
    const targetRecordData = this.targetRecord();
    if (!targetRecordData) {
      return;
    }

    const targetEventId = targetRecordData.event.id;
    const eventAuthorPubkey = targetRecordData.event.pubkey;
    const queryLimit = queryLimitOverride ?? EventService.INTERACTION_QUERY_LIMIT;

    await Promise.allSettled([
      this.loadTimelineQuotes(targetEventId, eventAuthorPubkey, invalidateCache, queryLimit, signal, loadGeneration),
      this.loadZaps(signal, loadGeneration, invalidateCache),
    ]);
  }

  private resolveObserverRoot(element: HTMLElement): HTMLElement | null {
    let current: HTMLElement | null = element.parentElement;

    while (current) {
      if (current.classList.contains('columns-container') || current.classList.contains('right-panel') || current.classList.contains('left-panel')) {
        return current;
      }

      const styles = window.getComputedStyle(current);
      const overflowY = styles.overflowY;
      const overflow = styles.overflow;
      const isScrollable = ['auto', 'scroll', 'overlay'].includes(overflowY) || ['auto', 'scroll', 'overlay'].includes(overflow);

      if (isScrollable && current.scrollHeight > current.clientHeight) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  }

  /**
   * Check if the element is currently visible in the viewport and load interactions if needed.
   * This is used after an event is loaded by ID, since the intersection observer may have
   * already fired while the element was visible but before the event data was available.
   */
  private checkAndLoadInteractionsIfVisible(): void {
    if (this.isExternalEngagementControlEnabled()) {
      return;
    }

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
      rect.top < (window.innerHeight || document.documentElement.clientHeight) + this.interactionViewportPreloadMarginPx
      && rect.bottom > -this.interactionViewportPreloadMarginPx
      &&
      rect.left < (window.innerWidth || document.documentElement.clientWidth) &&
      rect.right > 0
    );

    if (isVisible) {
      const currentEventId = currentRecord.event.id;
      this.logger.debug('[Lazy Load] Event was already visible when loaded:', currentEventId.substring(0, 8));

      this.observedEventId = currentEventId;

      if (this.supportsReactions()) {
        this.scheduleInteractionPreload(currentEventId, this.resolveObserverRoot(element));
      }
    }
  }

  ngOnDestroy(): void {
    // Cancel any pending virtualization timer
    if (this.virtualizeTimer) {
      clearTimeout(this.virtualizeTimer);
      this.virtualizeTimer = undefined;
    }
    // Cancel any pending interaction load and abort in-flight queries
    if (this.interactionLoadTimer) {
      clearTimeout(this.interactionLoadTimer);
      this.interactionLoadTimer = undefined;
    }
    if (this.visibleInteractionRetryTimer) {
      clearTimeout(this.visibleInteractionRetryTimer);
      this.visibleInteractionRetryTimer = undefined;
    }
    if (this.replyCountAnimationTimer) {
      clearTimeout(this.replyCountAnimationTimer);
      this.replyCountAnimationTimer = undefined;
    }
    EventComponent.cancelQueuedInteractionPreload(this);
    if (this.interactionAbortController) {
      this.interactionAbortController.abort();
      this.interactionAbortController = undefined;
    }
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
      this.logger.error('Error loading reports:', error);
    }
  }

  /**
   * Load all event interactions with per-kind limits for feed optimization.
   * In timeline mode, each kind is limited to INTERACTION_QUERY_LIMIT (11) events -
   * if 11 are returned, the UI shows "10+" to indicate there are more.
   * In thread mode (detail view), no limits are applied so full counts are shown.
   *
   * For reposts, loads interactions for the reposted event, not the repost itself.
   */
  async loadAllInteractions(
    invalidateCache = false,
    signal?: AbortSignal,
    loadGeneration?: number,
    timelineQueryLimitOverride?: number | null,
  ) {
    // Use targetRecord to get the actual event for interactions
    // For reposts, this will be the reposted event, not the repost event
    const targetRecordData = this.targetRecord();
    if (!targetRecordData) return;

    // Capture the event ID and author pubkey we're loading for to prevent race conditions
    const targetEventId = targetRecordData.event.id;
    // IMPORTANT: Use the EVENT AUTHOR's pubkey, not the current user's pubkey!
    // This ensures we query the author's relays where replies/reactions are likely to be found.
    const eventAuthorPubkey = targetRecordData.event.pubkey;
    const sourceRelayUrls = targetRecordData.relayUrls ?? [];

    // If reply count is provided from parent (e.g., event page that already loaded all replies),
    // skip loading replies from relays to avoid duplicate queries
    const skipReplies = this.replyCountFromParent() !== undefined;

    this.logger.debug('[Loading Interactions] Starting load for event:', targetEventId.substring(0, 8), 'skipReplies:', skipReplies);

    // Only apply limits in timeline (feed) mode; thread (detail) mode loads all interactions
    const queryLimit = this.mode() === 'timeline'
      ? (timelineQueryLimitOverride === null ? undefined : (timelineQueryLimitOverride ?? EventService.INTERACTION_QUERY_LIMIT))
      : undefined;
    const shouldDeferSecondaryTimelineEngagement = this.mode() === 'timeline' && queryLimit != null;

    this.isLoadingReactions.set(true);
    try {
      const cachedInteractionsPromise = this.eventService.loadCachedEventInteractions(
        targetEventId,
        targetRecordData.event.kind,
        eventAuthorPubkey,
        skipReplies,
      );

      const loadInteractionBatch = (limitOverride = queryLimit, invalidateCacheOverride = invalidateCache) => {
        const interactionsPromise = this.eventService.loadEventInteractions(
          targetEventId,
          targetRecordData.event.kind,
          eventAuthorPubkey,
          invalidateCacheOverride,
          skipReplies,
          sourceRelayUrls,
          limitOverride,
        );

        if (shouldDeferSecondaryTimelineEngagement) {
          return Promise.all([
            interactionsPromise,
            Promise.resolve([] as NostrRecord[]),
          ]);
        }

        return Promise.all([
          interactionsPromise,
          this.eventService.loadQuotes(
            targetEventId,
            eventAuthorPubkey,
            invalidateCacheOverride,
            limitOverride,
          ),
        ]);
      };

      const initialInteractionBatchPromise = loadInteractionBatch();

      const cachedInteractions = await cachedInteractionsPromise;
      if (this.shouldDiscardInteractionLoadResult(targetEventId, signal, loadGeneration)) {
        return;
      }

      const normalizedCachedInteractions = this.normalizeInteractionResults(cachedInteractions, [], queryLimit);
      if (
        normalizedCachedInteractions.reactions.events.length > 0
        || normalizedCachedInteractions.reposts.length > 0
        || normalizedCachedInteractions.replyCount > 0
        || normalizedCachedInteractions.reports.events.length > 0
      ) {
        this.applyNormalizedInteractionResults(targetEventId, normalizedCachedInteractions, skipReplies, queryLimit, false);
      }

      let [interactions, quotesResult] = await initialInteractionBatchPromise;

      if (this.shouldDiscardInteractionLoadResult(targetEventId, signal, loadGeneration)) {
        return;
      }

      let normalizedInteractions = this.normalizeInteractionResults(interactions, quotesResult, queryLimit);

      if (this.shouldVerifyTimelineInteractionCounts(normalizedInteractions, queryLimit)) {
        const verifiedQueryLimit = queryLimit;
        if (verifiedQueryLimit == null) {
          return;
        }
        const verificationLimit = verifiedQueryLimit * this.interactionVerificationLimitMultiplier;
        this.logger.debug(
          '[Loading Interactions] Verifying timeline counters with broader query for:',
          targetEventId.substring(0, 8),
          'limit:',
          verificationLimit,
        );

        [interactions, quotesResult] = await loadInteractionBatch(verificationLimit);

        if (this.shouldDiscardInteractionLoadResult(targetEventId, signal, loadGeneration)) {
          return;
        }

        normalizedInteractions = this.normalizeInteractionResults(interactions, quotesResult, verifiedQueryLimit);
      }

      if (this.shouldRetryEmptyTimelineInteractions(targetRecordData.event, targetEventId, normalizedInteractions, queryLimit, invalidateCache)) {
        const retryLimit = (queryLimit ?? EventService.INTERACTION_QUERY_LIMIT) * this.interactionVerificationLimitMultiplier;
        this.retriedEmptyInteractionEventId = targetEventId;
        this.logger.debug(
          '[Loading Interactions] Retrying suspicious empty timeline counters for:',
          targetEventId.substring(0, 8),
          'limit:',
          retryLimit,
        );

        [interactions, quotesResult] = await loadInteractionBatch(retryLimit, true);

        if (this.shouldDiscardInteractionLoadResult(targetEventId, signal, loadGeneration)) {
          return;
        }

        normalizedInteractions = this.normalizeInteractionResults(interactions, quotesResult, queryLimit);
      }

      this.applyNormalizedInteractionResults(targetEventId, normalizedInteractions, skipReplies, queryLimit, true);

      if (this.mode() === 'timeline' && normalizedInteractions.reactions.events.length === 0) {
        this.logger.warn('[InteractionDebug] Timeline card resolved with zero visible reactions', {
          eventId: targetEventId,
          queryLimit,
          sourceRelayCount: sourceRelayUrls.length,
          normalizedReplyCount: normalizedInteractions.replyCount,
          repostCount: normalizedInteractions.reposts.length,
          quoteCount: normalizedInteractions.quotes.length,
          hasMoreReactions: normalizedInteractions.hasMoreReactions,
          hasMoreReplies: normalizedInteractions.hasMoreReplies,
        });
      }

    } catch (error) {
      this.logger.error('Error loading event interactions:', error);
      if (loadGeneration === this.interactionLoadGeneration) {
        this.hasLoadedInteractions.set(false);
        this.scheduleVisibleInteractionRetry();
      }
    } finally {
      this.isLoadingReactions.set(false);
    }
  }

  private applyNormalizedInteractionResults(
    targetEventId: string,
    normalizedInteractions: ReturnType<EventComponent['normalizeInteractionResults']>,
    skipReplies: boolean,
    queryLimit: number | undefined,
    publishSnapshot: boolean,
  ): void {
    const previousReplyCount = this.replyCount();

    this.reactions.set(normalizedInteractions.reactions);
    this.reposts.set(normalizedInteractions.reposts);
    this.quotes.set(normalizedInteractions.quotes);
    this.reports.set(normalizedInteractions.reports);
    this.hasMoreReactions.set(normalizedInteractions.hasMoreReactions);
    this.hasMoreReposts.set(normalizedInteractions.hasMoreReposts);
    this.hasMoreReplies.set(normalizedInteractions.hasMoreReplies);
    this.hasMoreQuotes.set(normalizedInteractions.hasMoreQuotes);

    if (!skipReplies) {
      this._replyCountInternal.set(normalizedInteractions.replyCount);
      this._replyEventsInternal.set(normalizedInteractions.replyEvents);
    }

    if (normalizedInteractions.replyCount > previousReplyCount) {
      this.triggerReplyCountAnimation();
    }

    if (publishSnapshot && queryLimit == null) {
      const sharedReplyCount = this.replyCountFromParent() ?? normalizedInteractions.replyCount;
      this.eventService.publishInteractionSnapshot({
        eventId: targetEventId,
        reactions: normalizedInteractions.reactions,
        reposts: normalizedInteractions.reposts,
        reports: normalizedInteractions.reports,
        quotes: normalizedInteractions.quotes,
        zaps: this.zaps(),
        replyCount: sharedReplyCount,
        replyEvents: normalizedInteractions.replyEvents,
        hasMoreReactions: normalizedInteractions.hasMoreReactions,
        hasMoreReposts: normalizedInteractions.hasMoreReposts,
        hasMoreReplies: sharedReplyCount >= EventService.INTERACTION_QUERY_LIMIT,
        hasMoreQuotes: normalizedInteractions.hasMoreQuotes,
        hasMoreZaps: this.hasMoreZaps(),
      });
    }
  }

  private applySharedInteractionSnapshot(snapshot: SharedInteractionSnapshot): void {
    const previousReplyCount = this.replyCount();
    const normalizedInteractions = this.normalizeInteractionResults(
      {
        reactions: snapshot.reactions,
        reposts: snapshot.reposts,
        reports: snapshot.reports,
        replyCount: snapshot.replyCount,
        replyEvents: snapshot.replyEvents,
        quotes: snapshot.quotes,
        hasMoreReactions: snapshot.hasMoreReactions,
        hasMoreReposts: snapshot.hasMoreReposts,
        hasMoreReplies: snapshot.hasMoreReplies,
      },
      snapshot.quotes,
      EventService.INTERACTION_QUERY_LIMIT,
    );

    this.lastAppliedSharedInteractionSnapshotAt = snapshot.publishedAt;
    this.reactions.set(normalizedInteractions.reactions);
    this.reposts.set(normalizedInteractions.reposts);
    this.quotes.set(normalizedInteractions.quotes);
    this.reports.set(normalizedInteractions.reports);
    this.zaps.set(snapshot.zaps);
    this.hasMoreReactions.set(normalizedInteractions.hasMoreReactions);
    this.hasMoreReposts.set(normalizedInteractions.hasMoreReposts);
    this.hasMoreReplies.set(normalizedInteractions.hasMoreReplies);
    this.hasMoreQuotes.set(snapshot.hasMoreQuotes || normalizedInteractions.hasMoreQuotes);
    this.hasMoreZaps.set(snapshot.hasMoreZaps);

    if (this.replyCountFromParent() === undefined) {
      this._replyCountInternal.set(normalizedInteractions.replyCount);
      this._replyEventsInternal.set(normalizedInteractions.replyEvents);
    }

    if (normalizedInteractions.replyCount > previousReplyCount) {
      this.triggerReplyCountAnimation();
    }

    this.hasLoadedInteractions.set(true);
    this.isLoadingReactions.set(false);
  }

  private shouldRetryEmptyTimelineInteractions(
    targetEvent: Event,
    targetEventId: string,
    normalizedInteractions: ReturnType<EventComponent['normalizeInteractionResults']>,
    queryLimit: number | undefined,
    invalidateCache: boolean,
  ): boolean {
    if (this.mode() !== 'timeline' || queryLimit == null || invalidateCache) {
      return false;
    }

    if (this.retriedEmptyInteractionEventId === targetEventId) {
      return false;
    }

    const element = this.elementRef.nativeElement as HTMLElement | undefined;
    if (!element?.isConnected) {
      return false;
    }

    if (!this.isExternalEngagementRequested() && !this.isWithinImmediatePreloadBounds(element)) {
      return false;
    }

    const eventAgeSeconds = Math.floor(Date.now() / 1000) - targetEvent.created_at;
    if (eventAgeSeconds < this.emptyInteractionRetryMinAgeSeconds) {
      return false;
    }

    return normalizedInteractions.reactions.events.length === 0
      && normalizedInteractions.reposts.length === 0
      && normalizedInteractions.replyCount === 0
      && normalizedInteractions.quotes.length === 0;
  }

  private async loadTimelineQuotes(
    targetEventId: string,
    eventAuthorPubkey: string,
    invalidateCache: boolean,
    queryLimit: number,
    signal?: AbortSignal,
    loadGeneration?: number,
  ): Promise<void> {
    try {
      const quotes = await this.eventService.loadQuotes(
        targetEventId,
        eventAuthorPubkey,
        invalidateCache,
        queryLimit,
      );

      if (signal?.aborted || this.interactionLoadGeneration !== loadGeneration) {
        return;
      }

      const currentTargetRecord = this.targetRecord();
      if (currentTargetRecord?.event.id !== targetEventId) {
        return;
      }

      const mutedAccounts = this.accountState.mutedAccounts();
      const filteredQuotes = quotes.filter((record) => !mutedAccounts.includes(record.event.pubkey));
      const visibleQuotes = filteredQuotes.slice(0, queryLimit);

      this.quotes.set(visibleQuotes);
      this.hasMoreQuotes.set(filteredQuotes.length >= queryLimit);
    } catch (error) {
      this.logger.error('Error loading timeline quotes:', error);
    }
  }

  private shouldDiscardInteractionLoadResult(targetEventId: string, signal?: AbortSignal, loadGeneration?: number): boolean {
    if (signal?.aborted) {
      this.logger.debug('[Loading Interactions] Aborted, discarding results for:', targetEventId.substring(0, 8));
      if (loadGeneration === this.interactionLoadGeneration) {
        this.hasLoadedInteractions.set(false);
        this.scheduleVisibleInteractionRetry();
      }
      return true;
    }

    const currentTargetRecord = this.targetRecord();
    if (currentTargetRecord?.event.id !== targetEventId) {
      this.logger.warn('[Loading Interactions] Event changed during load, discarding results for:', targetEventId.substring(0, 8));
      this.logger.warn('[Loading Interactions] Current event is now:', currentTargetRecord?.event.id.substring(0, 8));
      if (loadGeneration === this.interactionLoadGeneration) {
        this.hasLoadedInteractions.set(false);
        this.scheduleVisibleInteractionRetry();
      }
      return true;
    }

    return false;
  }

  private normalizeInteractionResults(
    interactions: Awaited<ReturnType<EventService['loadEventInteractions']>>,
    quotesResult: NostrRecord[],
    queryLimit?: number,
  ) {
    const mutedAccounts = this.accountState.mutedAccounts();

    const filteredReactionEvents = interactions.reactions.events.filter(r => !mutedAccounts.includes(r.event.pubkey));
    const filteredReposts = interactions.reposts.filter(r => !mutedAccounts.includes(r.event.pubkey));
    const filteredQuotes = quotesResult.filter(r => !mutedAccounts.includes(r.event.pubkey));
    const filteredReportEvents = interactions.reports.events.filter(r => !mutedAccounts.includes(r.event.pubkey));

    const visibleReactionEvents = queryLimit != null ? filteredReactionEvents.slice(0, queryLimit) : filteredReactionEvents;
    const visibleReposts = queryLimit != null ? filteredReposts.slice(0, queryLimit) : filteredReposts;
    const visibleQuotes = queryLimit != null ? filteredQuotes.slice(0, queryLimit) : filteredQuotes;
    const visibleReplyEvents = queryLimit != null ? interactions.replyEvents.slice(0, queryLimit) : interactions.replyEvents;
    const visibleReplyCount = queryLimit != null ? Math.min(interactions.replyCount, queryLimit) : interactions.replyCount;

    const reactionData = new Map<string, number>();
    for (const event of visibleReactionEvents) {
      const emoji = event.event.content || '+';
      reactionData.set(emoji, (reactionData.get(emoji) || 0) + 1);
    }

    const reportData = new Map<string, number>();
    for (const event of filteredReportEvents) {
      const reportType = event.event.content || 'other';
      reportData.set(reportType, (reportData.get(reportType) || 0) + 1);
    }

    return {
      reactions: {
        events: visibleReactionEvents,
        data: reactionData,
      },
      reposts: visibleReposts,
      quotes: visibleQuotes,
      reports: {
        events: filteredReportEvents,
        data: reportData,
      },
      replyCount: visibleReplyCount,
      replyEvents: visibleReplyEvents,
      hasMoreReactions: queryLimit != null ? filteredReactionEvents.length >= queryLimit : (interactions.hasMoreReactions ?? false),
      hasMoreReposts: queryLimit != null ? filteredReposts.length >= queryLimit : (interactions.hasMoreReposts ?? false),
      hasMoreReplies: queryLimit != null ? interactions.replyCount >= queryLimit : (interactions.hasMoreReplies ?? false),
      hasMoreQuotes: queryLimit != null ? filteredQuotes.length >= queryLimit : false,
      needsVerification: queryLimit != null && (
        ((interactions.hasMoreReactions ?? false) && filteredReactionEvents.length < queryLimit)
        || ((interactions.hasMoreReposts ?? false) && filteredReposts.length < queryLimit)
        || ((interactions.hasMoreReplies ?? false) && interactions.replyCount < queryLimit)
        || (quotesResult.length >= queryLimit && filteredQuotes.length < queryLimit)
      ),
    };
  }

  private shouldVerifyTimelineInteractionCounts(
    normalizedInteractions: ReturnType<EventComponent['normalizeInteractionResults']>,
    queryLimit?: number,
  ): boolean {
    return this.mode() === 'timeline' && queryLimit != null && normalizedInteractions.needsVerification;
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
    const sourceRelayUrls = targetRecordData.relayUrls ?? [];

    this.isLoadingReactions.set(true);
    try {
      const reactions = await this.eventService.loadReactions(
        targetRecordData.event.id,
        eventAuthorPubkey,
        invalidateCache,
        sourceRelayUrls,
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
      const localParentEvent = await this.getContextEventFromDatabase(parentId);
      if (localParentEvent) {
        this.parentEvent.set(localParentEvent);
        return;
      }

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
      this.logger.error('Error loading parent event:', error);
      this.parentEvent.set(null);
    } finally {
      this.isLoadingParent.set(false);
    }
  }

  async loadRootEvent(rootId: string, eventTags: ReturnType<typeof this.eventService.getEventTags>) {
    if (!rootId) return;

    this.isLoadingRoot.set(true);
    try {
      const localRootEvent = await this.getContextEventFromDatabase(rootId);
      if (localRootEvent) {
        this.rootEvent.set(localRootEvent);
        return;
      }

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
      this.logger.error('Error loading root event:', error);
      this.rootEvent.set(null);
    } finally {
      this.isLoadingRoot.set(false);
    }
  }

  private async getContextEventFromDatabase(eventRef: string): Promise<Event | null> {
    const addressableMatch = eventRef.match(/^(\d+):([0-9a-f]{64}):(.+)$/);

    if (addressableMatch) {
      const [, kindStr, pubkey, dTag] = addressableMatch;
      const kind = parseInt(kindStr, 10);
      return this.database.getParameterizedReplaceableEvent(pubkey, kind, dTag);
    }

    if (/^[a-f0-9]{64}$/i.test(eventRef)) {
      return this.database.getEventById(eventRef);
    }

    return null;
  }

  /**
   * Load zaps for an event
   * For reposts, loads zaps for the reposted event, not the repost itself
   */
  async loadZaps(signal?: AbortSignal, loadGeneration?: number, invalidateCache = false) {
    // Use targetRecord to get the actual event for zaps
    // For reposts, this will be the reposted event, not the repost event
    const targetRecordData = this.targetRecord();
    if (!targetRecordData) return;

    // Capture the event ID we're loading for to prevent race conditions
    const targetEventId = targetRecordData.event.id;

    this.logger.debug('[Loading Zaps] Starting load for event:', targetEventId.substring(0, 8), invalidateCache ? '(recovery)' : '');

    this.isLoadingZaps.set(true);
    try {
      // Only apply limits in timeline (feed) mode; thread (detail) mode loads all zaps
      const queryLimit = this.mode() === 'timeline' ? EventService.INTERACTION_QUERY_LIMIT : undefined;
      const zapReceipts = await this.zapService.getZapsForEvent(targetEventId, queryLimit);

      // If the load was aborted (event scrolled off-screen), skip result processing
      if (signal?.aborted) {
        this.logger.debug('[Loading Zaps] Aborted, discarding results for:', targetEventId.substring(0, 8));
        if (loadGeneration === this.interactionLoadGeneration && !this.isLoadingReactions()) {
          this.hasLoadedInteractions.set(false);
          this.scheduleVisibleInteractionRetry();
        }
        return;
      }

      // CRITICAL: Verify we're still showing the same event before updating state
      // For reposts, we compare against targetRecord which is the reposted event
      const currentTargetRecord = this.targetRecord();
      if (currentTargetRecord?.event.id !== targetEventId) {
        this.logger.warn('[Loading Zaps] Event changed during load, discarding results for:', targetEventId.substring(0, 8));
        this.logger.warn('[Loading Zaps] Current event is now:', currentTargetRecord?.event.id.substring(0, 8));
        if (loadGeneration === this.interactionLoadGeneration && !this.isLoadingReactions()) {
          this.hasLoadedInteractions.set(false);
          this.scheduleVisibleInteractionRetry();
        }
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
      // Track if zap query hit its limit (only relevant when limits are applied)
      this.hasMoreZaps.set(queryLimit != null && zapReceipts.length >= queryLimit);

      this.logger.warn('[InteractionDebug] Finalized event zaps', {
        eventId: targetEventId,
        zapReceiptCount: zapReceipts.length,
        parsedZapCount: parsedZaps.length,
        hasMoreZaps: this.hasMoreZaps(),
        queryLimit,
        invalidateCache,
        zaps: parsedZaps.map((zap) => ({
          senderPubkey: zap.senderPubkey,
          amount: zap.amount,
          timestamp: zap.timestamp,
        })),
      });

      if (queryLimit == null) {
        this.eventService.publishInteractionSnapshotPatch(targetEventId, {
          zaps: parsedZaps,
          hasMoreZaps: this.hasMoreZaps(),
        });
      }
    } catch (error) {
      this.logger.error('Error loading zaps:', error);
      if (loadGeneration === this.interactionLoadGeneration && !this.isLoadingReactions()) {
        this.hasLoadedInteractions.set(false);
        this.scheduleVisibleInteractionRetry();
      }
    } finally {
      this.isLoadingZaps.set(false);
    }
  }

  /**
   * Handler for when a zap is successfully sent from the zap button.
   * Refreshes the zap data from relays after a short delay to allow propagation.
   */
  async onZapSent(amount: number): Promise<void> {
    this.logger.debug('[Zap Sent] Received zap sent event for amount:', amount);

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

  refreshZapsFromPoll(): void {
    void this.onZapSent(0);
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
      this.logger.error('Error loading reposts:', error);
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
        this.logger.warn('[Loading Quotes] Event changed during load, discarding results for:', targetEventId.substring(0, 8));
        return;
      }

      this.quotes.set(quotes);
    } catch (error) {
      this.logger.error('Error loading quotes:', error);
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
        onReactionDeleted: async (reactionId: string) => {
          const currentReactions = this.reactions();
          const filteredEvents = currentReactions.events.filter(reaction => reaction.event.id !== reactionId);
          const reactionData = new Map<string, number>();

          for (const reaction of filteredEvents) {
            const content = reaction.event.content || '+';
            reactionData.set(content, (reactionData.get(content) || 0) + 1);
          }

          this.reactions.set({
            events: filteredEvents,
            data: reactionData,
          });
        },
      },
    });
  }

  async openShareDialog(event?: MouseEvent) {
    if (this.consumeBlockedThreadInteraction(event)) {
      return;
    }

    event?.stopPropagation();

    const targetItem = this.targetRecord();
    if (!targetItem) return;

    const ev = targetItem.event;
    const authorRelays = await this.userRelaysService.getUserRelaysForPublishing(ev.pubkey);
    const relayHints = this.utilities.getShareRelayHints(authorRelays);
    const encodedId = this.utilities.encodeEventForUrl(ev, relayHints.length > 0 ? relayHints : undefined);

    const dialogData: ShareArticleDialogData = {
      title: ev.kind === kinds.LongFormArticle ? 'Article' : this.getEventPreviewTitle(ev.content),
      summary: ev.content || undefined,
      url: window.location.href,
      eventId: ev.id,
      pubkey: ev.pubkey,
      identifier: ev.tags.find(tag => tag[0] === 'd')?.[1],
      kind: ev.kind,
      encodedId,
      event: ev,
    };

    this.customDialog.open(ShareArticleDialogComponent, {
      title: '',
      showCloseButton: false,
      panelClass: 'share-sheet-dialog',
      data: dialogData,
      width: '450px',
      maxWidth: '95vw',
    });
  }

  /**
   * Toggle the reactions summary panel visibility
   * @param tab Optional tab to open to (defaults to 'reactions')
   */
  toggleReactionsSummary(tab: 'reactions' | 'reposts' | 'quotes' | 'zaps' = 'reactions') {
    const isCurrentlyVisible = this.showReactionsSummary();
    // If the requested tab has no data, pick the first tab that does
    const resolvedTab = this.resolveTabWithData(tab);
    const currentTab = this.reactionsSummaryTab();

    if (isCurrentlyVisible && currentTab === resolvedTab) {
      // If clicking the same tab while visible, close the panel
      this.showReactionsSummary.set(false);
    } else {
      this.reactionsSummaryTab.set(resolvedTab);
      this.showReactionsSummary.set(true);
    }
  }

  openZapsFromPoll(): void {
    if (this.compact()) {
      this.openReactionsDialog('zaps');
      return;
    }

    this.toggleReactionsSummary('zaps');
  }

  private resolveTabWithData(preferredTab: 'reactions' | 'reposts' | 'quotes' | 'zaps'): 'reactions' | 'reposts' | 'quotes' | 'zaps' {
    const tabHasData: Record<string, () => boolean> = {
      reactions: () => this.likes().length > 0,
      reposts: () => this.repostCount() > 0,
      quotes: () => this.quoteCount() > 0,
      zaps: () => this.zapCount() > 0,
    };

    if (tabHasData[preferredTab]()) {
      return preferredTab;
    }

    const tabs: ('reactions' | 'reposts' | 'quotes' | 'zaps')[] = ['reactions', 'reposts', 'quotes', 'zaps'];
    return tabs.find(t => tabHasData[t]()) ?? preferredTab;
  }

  /**
   * Open the note editor dialog to reply to this event
   */
  async openReplyEditor(event: MouseEvent) {
    if (this.consumeBlockedThreadInteraction(event)) {
      return;
    }

    event.stopPropagation();
    const targetRecordData = this.targetRecord();
    if (!targetRecordData) return;

    // Check if user is logged in
    const userPubkey = this.accountState.pubkey();
    const currentAccount = this.accountState.account();
    if (!userPubkey || currentAccount?.source === 'preview') {
      await this.layout.showLoginDialog();
      return;
    }

    const ev = targetRecordData.event;
    if (ev.kind === kinds.ShortTextNote) {
      const eventTags = this.eventService.getEventTags(ev);
      const result = await this.eventService.createNote({
        navigateOnPublish: this.mode() !== 'thread',
        replyTo: {
          id: ev.id,
          pubkey: ev.pubkey,
          rootId: eventTags.rootId,
          event: ev,
        },
      });
      if (result?.published && result.event) {
        this.applyOptimisticReplyPublished(result.event, ev.id);
      }
    } else if (ev.kind === 1111) {
      // NIP-22: replying to a comment — extract root event info from the comment's tags
      const rootETag = ev.tags.find(t => t[0] === 'E');
      const rootATag = ev.tags.find(t => t[0] === 'A');
      const rootKTag = ev.tags.find(t => t[0] === 'K');
      const rootPTag = ev.tags.find(t => t[0] === 'P');

      const rootKind = rootKTag ? parseInt(rootKTag[1]) : 1;
      const rootPubkey = rootPTag?.[1] || rootETag?.[3] || '';

      // Reconstruct minimal root event for buildCommentEvent
      let rootTags: string[][] = [];
      let rootId = '';

      if (rootATag) {
        // Addressable root — extract d-tag from A tag value (kind:pubkey:d-tag)
        const parts = rootATag[1].split(':');
        rootTags = [['d', parts.slice(2).join(':')]];
      }
      if (rootETag) {
        rootId = rootETag[1];
      }

      const rootEvent = {
        id: rootId,
        pubkey: rootPubkey,
        kind: rootKind,
        content: '',
        tags: rootTags,
        created_at: 0,
        sig: '',
      } as Event;

      const result = await this.eventService.createCommentReply(rootEvent, ev);
      if (result?.published && result.event) {
        this.applyOptimisticReplyPublished(result.event, ev.id);
      }
    } else if (ev.kind === 1222 || ev.kind === 1244) {
      // Voice events can only be replied to with voice replies (kind 1244)
      const result = await this.eventService.createAudioReply(ev);
      if (result) {
        this.applyOptimisticReplyPublished(result, ev.id);
      }
    } else {
      const result = await this.eventService.createComment(ev);
      if (result?.published && result.event) {
        this.applyOptimisticReplyPublished(result.event, ev.id);
      }
    }
  }

  private applyOptimisticReplyPublished(replyEvent: Event, targetEventId: string): void {
    const existingReplyEvents = this._replyEventsInternal();
    const hasReplyAlready = existingReplyEvents.some(event => event.id === replyEvent.id);
    const currentReplyCount = this.replyCount();
    const nextReplyCount = this.hasMoreReplies()
      ? Math.max(currentReplyCount, EventService.INTERACTION_QUERY_LIMIT)
      : Math.min(currentReplyCount + (hasReplyAlready ? 0 : 1), EventService.INTERACTION_QUERY_LIMIT);
    const nextHasMoreReplies = this.hasMoreReplies() || nextReplyCount >= EventService.INTERACTION_QUERY_LIMIT;
    const nextReplyEvents = hasReplyAlready
      ? existingReplyEvents
      : [replyEvent, ...existingReplyEvents].slice(0, EventService.INTERACTION_QUERY_LIMIT);

    if (this.replyCountFromParent() === undefined) {
      this._replyCountInternal.set(nextReplyCount);
      this._replyEventsInternal.set(nextReplyEvents);
    }

    this.hasMoreReplies.set(nextHasMoreReplies);
    if (!hasReplyAlready && nextReplyCount > currentReplyCount) {
      this.triggerReplyCountAnimation();
    }

    this.eventService.publishInteractionSnapshot({
      eventId: targetEventId,
      reactions: this.reactions(),
      reposts: this.reposts(),
      reports: this.reports(),
      quotes: this.quotes(),
      zaps: this.zaps(),
      replyCount: nextReplyCount,
      replyEvents: nextReplyEvents,
      hasMoreReactions: this.hasMoreReactions(),
      hasMoreReposts: this.hasMoreReposts(),
      hasMoreReplies: nextHasMoreReplies,
      hasMoreQuotes: this.hasMoreQuotes(),
      hasMoreZaps: this.hasMoreZaps(),
    });
  }

  private triggerReplyCountAnimation(): void {
    if (this.replyCountAnimationTimer) {
      clearTimeout(this.replyCountAnimationTimer);
    }

    this.replyCountAnimating.set(false);
    requestAnimationFrame(() => {
      this.replyCountAnimating.set(true);
      this.replyCountAnimationTimer = setTimeout(() => {
        this.replyCountAnimating.set(false);
        this.replyCountAnimationTimer = undefined;
      }, 700);
    });
  }

  private getEventPreviewTitle(content: string): string {
    const cleaned = content.replace(/\s+/g, ' ').trim();
    if (!cleaned) return 'Event';
    const maxLength = 72;
    if (cleaned.length <= maxLength) return cleaned;
    return `${cleaned.slice(0, maxLength).trim()}…`;
  }

  async toggleLike(event?: MouseEvent) {
    if (this.consumeBlockedThreadInteraction(event)) {
      return;
    }

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

        const result = await this.reactionService.deleteReaction(existingLikeReaction.event);
        if (!result.success) {
          // Revert optimistic update if failed
          this.updateReactionsOptimistically(userPubkey, '+', true);
          this.snackBar.open('Failed to remove like. Please try again.', 'Dismiss', { duration: 3000 });
        }
      } else {
        // Add like - optimistically update UI first
        this.updateReactionsOptimistically(userPubkey, '+', true);

        const result = await this.reactionService.addLike(targetEvent);
        if (!result.success) {
          // Revert optimistic update if failed
          this.updateReactionsOptimistically(userPubkey, '+', false);
          this.snackBar.open('Failed to add like. Please try again.', 'Dismiss', { duration: 3000 });
        } else {
          this.haptics.triggerMedium();
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

  onReactionSummaryDeleted(reactionId: string): void {
    const currentReactions = this.reactions();
    const filteredEvents = currentReactions.events.filter(reaction => reaction.event.id !== reactionId);
    const reactionData = new Map<string, number>();

    for (const reaction of filteredEvents) {
      const content = reaction.event.content || '+';
      reactionData.set(content, (reactionData.get(content) || 0) + 1);
    }

    this.reactions.set({
      events: filteredEvents,
      data: reactionData,
    });
  }

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
    return resolveClientLogo(clientName);
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

  async onBookmarkClick(event: MouseEvent) {
    event.stopPropagation();
    // Skip bookmark action if this was a long press (display mode toggle)
    if (this.bookmarkLongPressed) {
      this.bookmarkLongPressed = false;
      return;
    }
    const targetItem = this.repostedRecord() || this.record();
    if (targetItem) {
      if (targetItem.event.kind === 32100) {
        this.togglePlaylistBookmark(targetItem.event);
      } else {
        const authorPubkey = targetItem.event.pubkey;

        // Get relay hint for the author
        await this.userRelaysService.ensureRelaysForPubkey(authorPubkey);
        const authorRelays = this.userRelaysService.getRelaysForPubkey(authorPubkey);
        const relayHint = authorRelays[0] || undefined;

        // Open bookmark list selector dialog
        this.dialog.open(BookmarkListSelectorComponent, {
          data: {
            itemId: targetItem.event.id,
            type: 'e',
            eventKind: targetItem.event.kind,
            pubkey: authorPubkey,
            relay: relayHint
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
      this.logger.error('Failed to toggle playlist bookmark:', error);
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

    // Only handle clicks for navigable event kinds
    if (!targetEvent || !this.NAVIGABLE_KINDS.has(targetEvent.kind)) {
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
      'img, video, button, a, mat-menu, [mat-menu-trigger-for], input, textarea, select, .user-profile-avatar, .user-profile-name, .date-link, .video-container, .video-thumbnail-container, .video-player-container, .article-preview-card, app-tagged-references, app-article, app-article-event, app-music-embed'
    );

    if (isInteractiveElement) {
      return;
    }

    // Navigate to the target event (reposted event for reposts, regular event otherwise)
    // Pass reply count, replies, and parent event for instant rendering in the thread view
    const threadedReplies = this.repliesFromParent() ?? this.threadedRepliesFromInteractions();
    this.layout.openEvent(targetEvent.id, targetEvent, undefined, {
      replyCount: this.replyCount(),
      parentEvent: this.parentEvent() ?? undefined,
      replies: threadedReplies.length > 0 ? threadedReplies : undefined,
    });
  }

  /**
   * Handle clicks on the root event card
   * Opens thread dialog for text notes, or navigates to content-specific pages for other kinds
   */
  onRootEventClick(event: MouseEvent) {
    event.stopPropagation(); // Prevent the main card click handler

    // Navigate to the root event (only navigable kinds)
    const rootRecordData = this.rootRecord();
    if (!rootRecordData || !this.NAVIGABLE_KINDS.has(rootRecordData.event.kind)) {
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
   * Opens thread dialog for text notes, or navigates to content-specific pages for other kinds
   */
  onParentEventClick(event: MouseEvent) {
    event.stopPropagation(); // Prevent the main card click handler

    // Navigate to the parent event (only navigable kinds)
    const parentRecordData = this.parentRecord();
    if (!parentRecordData || !this.NAVIGABLE_KINDS.has(parentRecordData.event.kind)) {
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
  toggleCollapsedVideos(event: MouseEvent) {
    event.stopPropagation();
    this.collapsedVideosExpanded.update(v => !v);
  }

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
