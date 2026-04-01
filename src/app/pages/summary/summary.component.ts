import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
  ElementRef,
  viewChild,
} from '@angular/core';
import { Location } from '@angular/common';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatMenuModule } from '@angular/material/menu';
import { OverlayModule, ConnectedPosition } from '@angular/cdk/overlay';
import { CommonModule } from '@angular/common';
import { AccountStateService } from '../../services/account-state.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { DatabaseService } from '../../services/database.service';
import { LoggerService } from '../../services/logger.service';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { ProfileDisplayNameComponent } from '../../components/user-profile/display-name/profile-display-name.component';
import { Event, nip19 } from 'nostr-tools';
import { ApplicationService } from '../../services/application.service';
import { AgoPipe } from '../../pipes/ago.pipe';
import { FollowingDataService } from '../../services/following-data.service';
import { FollowSetsService, FollowSet } from '../../services/follow-sets.service';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { OnDemandUserDataService } from '../../services/on-demand-user-data.service';
import { MediaPreviewDialogComponent } from '../../components/media-preview-dialog/media-preview.component';
import { LayoutService } from '../../services/layout.service';
import { ListFilterValue } from '../../components/list-filter-menu/list-filter-menu.component';
import { LocalSettingsService, DEFAULT_CONTENT_FILTER } from '../../services/local-settings.service';
import { getKindLabel } from '../../utils/kind-labels';
import { COMMUNITY_DEFINITION_KIND } from '../../services/community.service';

interface ActivitySummary {
  notesCount: number;
  repostsCount: number;
  articlesCount: number;
  audioCount: number;
  mediaCount: number;
  communitiesCount: number;
  chatsCount: number;
  liveEventsCount: number;
  calendarCount: number;
  musicCount: number;
  profileUpdatesCount: number;
}

interface PosterStats {
  pubkey: string;
  notesCount: number;
  repostsCount: number;
  articlesCount: number;
  audioCount: number;
  mediaCount: number;
  communitiesCount: number;
  chatsCount: number;
  liveEventsCount: number;
  calendarCount: number;
  musicCount: number;
  totalCount: number;
}

interface TimelineEvent {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  content: string;
  tags?: string[][]; // For article d-tag
}

interface MediaPreviewSource {
  previewUrl: string | null;
  mediaUrl: string | null;
  isVideo: boolean;
}

type GmFilterMode = 'all' | 'only' | 'exclude';

interface ContentTypeOption {
  id: 'posts' | 'articles' | 'reposts' | 'voicePosts' | 'photoPosts' | 'videoPosts' | 'communities' | 'chats' | 'liveEvents' | 'calendar' | 'music' | 'profiles';
  label: string;
  description: string;
  kinds: number[];
  icon: string;
}

interface SummaryTimelineSection {
  id: 'audio' | 'communities' | 'chats' | 'liveEvents' | 'calendar' | 'music';
  title: string;
  description: string;
  icon: string;
  events: TimelineEvent[];
}

type PosterStatsCountKey =
  | 'notesCount'
  | 'repostsCount'
  | 'articlesCount'
  | 'audioCount'
  | 'mediaCount'
  | 'communitiesCount'
  | 'chatsCount'
  | 'liveEventsCount'
  | 'calendarCount'
  | 'musicCount';

const POST_KINDS = [1];
const MEDIA_KINDS = [20, 21, 22, 34235, 34236];
const VIDEO_KINDS = [21, 22, 34235, 34236];
const AUDIO_KINDS = [1222, 1244];
const CHAT_KINDS = [40, 42];
const LIVE_EVENT_KINDS = [30311];
const CALENDAR_KINDS = [31922, 31923, 31925];
const MUSIC_KINDS = [32100, 34139, 36787];
const COMMUNITY_KINDS = [COMMUNITY_DEFINITION_KIND];
const PROFILE_KINDS = [0];
const SUMMARY_FETCH_KINDS = [
  1,
  6,
  16,
  20,
  21,
  22,
  40,
  42,
  1222,
  1244,
  30023,
  30311,
  31922,
  31923,
  31925,
  32100,
  34139,
  34235,
  34236,
  COMMUNITY_DEFINITION_KIND,
  36787,
];
const SUMMARY_DEFAULT_CONTENT_KINDS = [
  ...POST_KINDS,
  6,
  16,
  30023,
  ...AUDIO_KINDS,
  ...MEDIA_KINDS,
  ...COMMUNITY_KINDS,
  ...CHAT_KINDS,
  ...LIVE_EVENT_KINDS,
  ...CALENDAR_KINDS,
  ...MUSIC_KINDS,
  ...PROFILE_KINDS,
];

const SUMMARY_CONTENT_TYPES: ContentTypeOption[] = [
  { id: 'posts', label: 'Posts', description: 'Short text posts', kinds: POST_KINDS, icon: 'description' },
  { id: 'articles', label: 'Articles', description: 'Long-form writing', kinds: [30023], icon: 'article' },
  { id: 'reposts', label: 'Reposts', description: 'Shared content from others', kinds: [6, 16], icon: 'repeat' },
  { id: 'voicePosts', label: 'Audio Posts', description: 'Voice notes and audio uploads', kinds: AUDIO_KINDS, icon: 'mic' },
  { id: 'photoPosts', label: 'Photo Posts', description: 'Image galleries', kinds: [20], icon: 'image' },
  { id: 'videoPosts', label: 'Video Posts', description: 'Video posts and clips', kinds: VIDEO_KINDS, icon: 'movie' },
  { id: 'communities', label: 'Communities', description: 'New community definitions', kinds: COMMUNITY_KINDS, icon: 'groups' },
  { id: 'chats', label: 'Chats', description: 'Public channel activity', kinds: CHAT_KINDS, icon: 'forum' },
  { id: 'liveEvents', label: 'Live Events', description: 'Streams and live sessions', kinds: LIVE_EVENT_KINDS, icon: 'live_tv' },
  { id: 'calendar', label: 'Calendar', description: 'Events and RSVPs', kinds: CALENDAR_KINDS, icon: 'event' },
  { id: 'music', label: 'Music', description: 'Tracks and playlists', kinds: MUSIC_KINDS, icon: 'music_note' },
  { id: 'profiles', label: 'Profiles', description: 'Profile updates and metadata changes', kinds: PROFILE_KINDS, icon: 'badge' },
];

const SUMMARY_TIMELINE_KIND_LABELS: Record<number, string> = {
  0: 'Profile',
  1: 'Note',
  6: 'Repost',
  16: 'Repost',
  40: 'Chat Channel',
  42: 'Chat Message',
  20: 'Photo',
  21: 'Video',
  22: 'Video',
  1111: 'Reply',
  1222: 'Audio',
  1244: 'Audio',
  30023: 'Article',
  30311: 'Live Event',
  31922: 'Calendar Event',
  31923: 'Calendar Event',
  31925: 'Event RSVP',
  32100: 'Playlist',
  34139: 'Music Playlist',
  34235: 'Video',
  34236: 'Video',
  [COMMUNITY_DEFINITION_KIND]: 'Community',
  36787: 'Music Track',
};

// Constants for configurable limits
const DEFAULT_DAYS_LOOKBACK = 1; // 1 day lookback for first-time users
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_POSTERS_DISPLAY = 100;
const MAX_PROFILE_UPDATES = 10;
const TIMELINE_PAGE_SIZE = 20; // Events per page
const SAVE_INTERVAL_MS = 5000; // Save timestamp every 5 seconds

@Component({
  selector: 'app-summary',
  imports: [
    CommonModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatTooltipModule,
    MatChipsModule,
    MatExpansionModule,
    MatCheckboxModule,
    MatMenuModule,
    OverlayModule,
    UserProfileComponent,
    ProfileDisplayNameComponent,
    AgoPipe,
  ],
  templateUrl: './summary.component.html',
  styleUrl: './summary.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SummaryComponent implements OnInit, OnDestroy {
  private readonly accountState = inject(AccountStateService);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly database = inject(DatabaseService);
  private readonly logger = inject(LoggerService);
  private readonly followingData = inject(FollowingDataService);
  private readonly customDialog = inject(CustomDialogService);
  private readonly location = inject(Location);
  private readonly onDemandUserData = inject(OnDemandUserDataService);
  private readonly followSetsService = inject(FollowSetsService);
  private readonly dialog = inject(MatDialog);
  protected readonly app = inject(ApplicationService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly layout = inject(LayoutService);
  protected readonly localSettings = inject(LocalSettingsService);

  readonly summaryContentTypes = SUMMARY_CONTENT_TYPES;

  // ViewChild for load more sentinel
  loadMoreSentinel = viewChild<ElementRef<HTMLDivElement>>('loadMoreSentinel');

  // Timer for periodic timestamp saves
  private saveTimestampInterval: ReturnType<typeof setInterval> | null = null;

  // IntersectionObserver for infinite scroll
  private loadMoreObserver: IntersectionObserver | null = null;

  // Flag to prevent operations after component destruction
  private isDestroyed = false;

  // Time panel state
  timePanelOpen = signal(false);
  filterPanelOpen = signal(false);
  timePanelPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -8 },
  ];
  filterPanelPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -8 },
  ];

  // Time range presets
  readonly timePresets = [
    { label: '1 hour', hours: 1 },
    { label: '6 hours', hours: 6 },
    { label: '12 hours', hours: 12 },
    { label: '1 day', hours: 24 },
    { label: '2 days', hours: 48 },
    { label: '1 week', hours: 168 },
  ];

  // Selected time range
  selectedPreset = signal<number | null>(null); // hours, null = since last visit

  // Computed label for the selected time range
  selectedTimeLabel = computed(() => {
    const preset = this.selectedPreset();
    if (preset === null) return 'Last visit';
    const found = this.timePresets.find(p => p.hours === preset);
    return found ? found.label : `${preset}h`;
  });

  // State signals
  isLoading = signal(true);
  isFetching = signal(false); // Whether we're fetching from relays
  fetchProgress = signal({ fetched: 0, total: 0 });
  lastCheckTimestamp = signal(0);

  // Captured "last visit" timestamp - frozen at component init, doesn't update during session
  private frozenLastVisitTimestamp = 0;

  // Activity summary
  activitySummary = signal<ActivitySummary>({
    notesCount: 0,
    repostsCount: 0,
    articlesCount: 0,
    audioCount: 0,
    mediaCount: 0,
    communitiesCount: 0,
    chatsCount: 0,
    liveEventsCount: 0,
    calendarCount: 0,
    musicCount: 0,
    profileUpdatesCount: 0,
  });

  // Active posters (people who posted in the time period)
  allActivePosters = signal<PosterStats[]>([]);

  // Posters pagination
  postersPage = signal(1);

  // Section collapse states
  postersCollapsed = signal(false);
  timelineCollapsed = signal(false); // Expanded by default
  mediaCollapsed = signal(true); // Collapsed by default
  articlesCollapsed = signal(true); // Collapsed by default
  profilesCollapsed = signal(true); // Collapsed by default

  // Track which timeline events have been opened (local, non-persisted)
  readEventIds = signal<Set<string>>(new Set());

  // Media items whose preview image failed to load
  failedMediaPreviewIds = signal<Set<string>>(new Set());

  // Selected posters for filtering the timeline (empty means show all)
  selectedPosters = signal<Set<string>>(new Set());

  // Whether filter mode is active
  isFilterMode = computed(() => this.selectedPosters().size > 0 || this.gmFilterMode() !== 'all' || !!this.selectedList());

  // GM/Pura Vida filter mode
  gmFilterMode = signal<GmFilterMode>('all');

  // Selected list filter (from FollowSetsService)
  selectedList = signal<FollowSet | null>(null);

  // URL query param for list filter (for passing to ListFilterMenuComponent)
  // Set from route snapshot at construction time
  urlListFilter = signal<string | undefined>(this.route.snapshot.queryParams['list']);

  // Content filter: whether the filter has been modified from defaults
  isUsingDefaultContentFilter = computed(() => {
    const filter = this.localSettings.contentFilter();
    const kindsMatch = filter.kinds.length === DEFAULT_CONTENT_FILTER.kinds.length
      && filter.kinds.every(k => DEFAULT_CONTENT_FILTER.kinds.includes(k));
    return kindsMatch && filter.showReplies === DEFAULT_CONTENT_FILTER.showReplies && filter.showReposts === DEFAULT_CONTENT_FILTER.showReposts;
  });

  hasActiveListFilter = computed(() => !!this.selectedList() || this.currentListFilter() !== 'following');

  hasActiveCombinedFilter = computed(() => this.hasActiveContentFilter() || this.hasActiveListFilter());

  currentListFilter = signal<ListFilterValue>('following');

  favoritesSet = computed(() => this.followSets().find(set => set.dTag === 'nostria-favorites') ?? null);

  otherFollowSets = computed(() =>
    this.followSets()
      .filter(set => set.dTag !== 'nostria-favorites')
      .sort((a, b) => a.title.localeCompare(b.title))
  );

  currentContentKinds = computed(() => this.isUsingDefaultContentFilter()
    ? SUMMARY_DEFAULT_CONTENT_KINDS
    : this.localSettings.contentFilter().kinds);
  currentShowReplies = computed(() => this.localSettings.contentFilter().showReplies);
  currentShowReposts = computed(() => this.localSettings.contentFilter().showReposts);
  hasActiveContentFilter = computed(() => {
    const filter = this.localSettings.contentFilter();
    const effectiveKinds = this.currentContentKinds();
    const kindsMatch = effectiveKinds.length === SUMMARY_DEFAULT_CONTENT_KINDS.length
      && effectiveKinds.every(kind => SUMMARY_DEFAULT_CONTENT_KINDS.includes(kind));
    return !kindsMatch || filter.showReplies !== DEFAULT_CONTENT_FILTER.showReplies || filter.showReposts !== DEFAULT_CONTENT_FILTER.showReposts;
  });

  // Determine which poster stat categories are visible based on content filter
  showNotesStats = computed(() => this.currentContentKinds().some(k => POST_KINDS.includes(k)));
  showRepostsStats = computed(() => this.currentShowReposts() || this.currentContentKinds().some(k => [6, 16].includes(k)));
  showArticlesStats = computed(() => this.currentContentKinds().includes(30023));
  showAudioStats = computed(() => this.currentContentKinds().some(k => AUDIO_KINDS.includes(k)));
  showMediaStats = computed(() => this.currentContentKinds().some(k => MEDIA_KINDS.includes(k)));
  showCommunitiesStats = computed(() => this.currentContentKinds().some(k => COMMUNITY_KINDS.includes(k)));
  showChatsStats = computed(() => this.currentContentKinds().some(k => CHAT_KINDS.includes(k)));
  showLiveEventsStats = computed(() => this.currentContentKinds().some(k => LIVE_EVENT_KINDS.includes(k)));
  showCalendarStats = computed(() => this.currentContentKinds().some(k => CALENDAR_KINDS.includes(k)));
  showMusicStats = computed(() => this.currentContentKinds().some(k => MUSIC_KINDS.includes(k)));
  showProfilesStats = computed(() => this.currentContentKinds().some(k => PROFILE_KINDS.includes(k)));

  currentListFilterLabel = computed(() => {
    const filter = this.currentListFilter();
    if (filter === 'following') {
      return 'Following';
    }
    const selectedSet = this.selectedList();
    return selectedSet?.title ?? 'List filter';
  });

  // Expose follow sets from service
  followSets = this.followSetsService.followSets;
  followSetsLoading = this.followSetsService.isLoading;

  // Filtered active posters (by list filter, then by content filter, then paginated)
  filteredActivePosters = computed(() => {
    const all = this.allActivePosters();
    const list = this.selectedList();

    let filtered = all;

    if (list) {
      // Filter by pubkeys in the selected list
      const listPubkeys = new Set(list.pubkeys);
      filtered = filtered.filter(poster => listPubkeys.has(poster.pubkey));
    }

    // Apply content filter: recalculate totalCount based on visible stat categories
    const showNotes = this.showNotesStats();
    const showReposts = this.showRepostsStats();
    const showArticles = this.showArticlesStats();
    const showAudio = this.showAudioStats();
    const showMedia = this.showMediaStats();
    const showCommunities = this.showCommunitiesStats();
    const showChats = this.showChatsStats();
    const showLiveEvents = this.showLiveEventsStats();
    const showCalendar = this.showCalendarStats();
    const showMusic = this.showMusicStats();
    const hasFilter = this.hasActiveContentFilter();

    if (hasFilter) {
      filtered = filtered
        .map(poster => {
          const filteredTotal =
            (showNotes ? poster.notesCount : 0) +
            (showReposts ? poster.repostsCount : 0) +
            (showArticles ? poster.articlesCount : 0) +
            (showAudio ? poster.audioCount : 0) +
            (showMedia ? poster.mediaCount : 0) +
            (showCommunities ? poster.communitiesCount : 0) +
            (showChats ? poster.chatsCount : 0) +
            (showLiveEvents ? poster.liveEventsCount : 0) +
            (showCalendar ? poster.calendarCount : 0) +
            (showMusic ? poster.musicCount : 0);
          return { ...poster, totalCount: filteredTotal };
        })
        .filter(poster => poster.totalCount > 0)
        .sort((a, b) => b.totalCount - a.totalCount);
    }

    return filtered;
  });

  // Paginated active posters (from filtered list)
  activePosters = computed(() => {
    const all = this.filteredActivePosters();
    const page = this.postersPage();
    return all.slice(0, page * MAX_POSTERS_DISPLAY);
  });

  // Check if there are more posters to load
  hasMorePosters = computed(() => {
    const all = this.filteredActivePosters();
    const shown = this.activePosters();
    return shown.length < all.length;
  });

  // Total posters count (filtered)
  totalPostersCount = computed(() => this.filteredActivePosters().length);

  // Total unfiltered posters count (for showing "X of Y" in UI)
  totalUnfilteredPostersCount = computed(() => this.allActivePosters().length);

  // Profile updates (pubkeys of people who updated their profiles)
  profileUpdatesRaw = signal<string[]>([]);

  // Filtered profile updates (by list filter)
  profileUpdates = computed(() => {
    if (!this.showProfilesStats()) return [];

    const all = this.profileUpdatesRaw();
    const list = this.selectedList();
    if (!list) return all;
    const listPubkeys = new Set(list.pubkeys);
    return all.filter(pubkey => listPubkeys.has(pubkey));
  });

  // Raw events for timeline and drill-down
  noteEvents = signal<TimelineEvent[]>([]);
  repostEvents = signal<TimelineEvent[]>([]);
  articleEventsRaw = signal<TimelineEvent[]>([]);
  audioEventsRaw = signal<TimelineEvent[]>([]);
  mediaEventsRaw = signal<TimelineEvent[]>([]);
  communityEventsRaw = signal<TimelineEvent[]>([]);
  chatEventsRaw = signal<TimelineEvent[]>([]);
  liveEventsRaw = signal<TimelineEvent[]>([]);
  calendarEventsRaw = signal<TimelineEvent[]>([]);
  musicEventsRaw = signal<TimelineEvent[]>([]);

  // Filtered audio events (by list filter)
  audioEvents = computed(() => this.filterSectionEvents(this.audioEventsRaw(), AUDIO_KINDS));

  // Filtered article events (by list filter)
  articleEvents = computed(() => this.filterSectionEvents(this.articleEventsRaw(), [30023]));

  // Filtered media events (by list filter)
  mediaEvents = computed(() => this.filterSectionEvents(this.mediaEventsRaw(), MEDIA_KINDS));
  communityEvents = computed(() => this.filterSectionEvents(this.communityEventsRaw(), COMMUNITY_KINDS));
  chatEvents = computed(() => this.filterSectionEvents(this.chatEventsRaw(), CHAT_KINDS));
  liveEvents = computed(() => this.filterSectionEvents(this.liveEventsRaw(), LIVE_EVENT_KINDS));
  calendarEvents = computed(() => this.filterSectionEvents(this.calendarEventsRaw(), CALENDAR_KINDS));
  musicEvents = computed(() => this.filterSectionEvents(this.musicEventsRaw(), MUSIC_KINDS));

  summaryTimelineSections = computed(() => {
    const sections: SummaryTimelineSection[] = [
      {
        id: 'audio',
        title: 'Audio Posts',
        description: 'Voice notes and other audio shared recently',
        icon: 'mic',
        events: this.audioEvents(),
      },
      {
        id: 'communities',
        title: 'Communities',
        description: 'New communities published by people you follow',
        icon: 'groups',
        events: this.communityEvents(),
      },
      {
        id: 'chats',
        title: 'Chats',
        description: 'Public chat channels and new messages',
        icon: 'forum',
        events: this.chatEvents(),
      },
      {
        id: 'liveEvents',
        title: 'Live Events',
        description: 'Streams and live sessions started recently',
        icon: 'live_tv',
        events: this.liveEvents(),
      },
      {
        id: 'calendar',
        title: 'Calendar',
        description: 'Published events and RSVPs from your following',
        icon: 'event',
        events: this.calendarEvents(),
      },
      {
        id: 'music',
        title: 'Music',
        description: 'Tracks and playlists published recently',
        icon: 'music_note',
        events: this.musicEvents(),
      },
    ];

    return sections.filter(section => section.events.length > 0);
  });

  // Timeline pagination
  timelinePage = signal(1);

  // All timeline events (combined, filtered by content filter, selected posters and list, and sorted)
  allTimelineEvents = computed(() => {
    const allowedKinds = this.currentContentKinds();
    const showReposts = this.currentShowReposts();
    const showReplies = this.currentShowReplies();

    let allEvents = [
      ...this.noteEvents(),
      ...this.repostEvents(),
      ...this.articleEventsRaw(),
      ...this.audioEventsRaw(),
      ...this.mediaEventsRaw(),
      ...this.communityEventsRaw(),
      ...this.chatEventsRaw(),
      ...this.liveEventsRaw(),
      ...this.calendarEventsRaw(),
      ...this.musicEventsRaw(),
    ]
      .sort((a, b) => b.created_at - a.created_at);

    // Apply content filter - filter by allowed kinds
    if (allowedKinds.length > 0) {
      allEvents = allEvents.filter(e => allowedKinds.includes(e.kind));
    }

    // Filter reposts based on showReposts setting
    if (!showReposts) {
      allEvents = allEvents.filter(e => e.kind !== 6 && e.kind !== 16);
    }

    // Filter replies based on showReplies setting
    if (!showReplies) {
      allEvents = allEvents.filter(e => {
        if (e.kind !== 1) return true;
        // Check if note is a reply (has 'e' tags)
        return !e.tags?.some(tag => tag[0] === 'e');
      });
    }

    // Filter by selected posters if any are selected
    const selected = this.selectedPosters();
    if (selected.size > 0) {
      allEvents = allEvents.filter(e => selected.has(e.pubkey));
    }

    // Filter by selected list if active (applies to timeline too)
    const list = this.selectedList();
    if (list) {
      const listPubkeys = new Set(list.pubkeys);
      allEvents = allEvents.filter(e => listPubkeys.has(e.pubkey));
    }

    // Filter by GM/Pura Vida mode
    const gmMode = this.gmFilterMode();
    if (gmMode === 'only') {
      allEvents = allEvents.filter(e => this.isGmPuraVidaPost(e.content));
    } else if (gmMode === 'exclude') {
      allEvents = allEvents.filter(e => !this.isGmPuraVidaPost(e.content));
    }

    return allEvents;
  });

  // Paginated timeline events
  timelineEvents = computed(() => {
    const all = this.allTimelineEvents();
    const page = this.timelinePage();
    return all.slice(0, page * TIMELINE_PAGE_SIZE);
  });

  // Check if there are more events to load
  hasMoreTimelineEvents = computed(() => {
    const all = this.allTimelineEvents();
    const shown = this.timelineEvents();
    return shown.length < all.length;
  });

  // Total timeline events count
  totalTimelineCount = computed(() => this.allTimelineEvents().length);

  // Expanded panel state
  expandedPanel = signal<'notes' | 'articles' | 'media' | null>(null);

  // Check if user has following list
  hasFollowing = computed(() => this.accountState.followingList().length > 0);

  // Check if there's any activity
  hasActivity = computed(() => {
    const summary = this.activitySummary();
    return summary.notesCount > 0 || summary.repostsCount > 0 || summary.articlesCount > 0 ||
      summary.audioCount > 0 || summary.mediaCount > 0 || summary.communitiesCount > 0 ||
      summary.chatsCount > 0 || summary.liveEventsCount > 0 || summary.calendarCount > 0 ||
      summary.musicCount > 0 || summary.profileUpdatesCount > 0;
  });

  // Time since last check - reflects the selected time range
  timeSinceLastCheck = computed(() => {
    // If a preset is selected
    const preset = this.selectedPreset();
    if (preset !== null) {
      const presetInfo = this.timePresets.find(p => p.hours === preset);
      return presetInfo ? presetInfo.label + ' ago' : `${preset} hours ago`;
    }

    // Default: since last visit - use the frozen timestamp
    const lastCheck = this.frozenLastVisitTimestamp;
    if (!lastCheck) return 'your first visit';

    const now = Date.now();
    const diff = now - lastCheck;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    return 'just now';
  });

  constructor() {
    // Load data when account changes
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        // Restore saved time selection
        this.restoreTimeSelection(pubkey);
        this.restoreListSelection(pubkey);
        this.loadSummaryData();
      } else {
        this.currentListFilter.set('following');
        this.selectedList.set(null);
      }
    });

    // Setup IntersectionObserver when sentinel becomes available
    effect(() => {
      const sentinel = this.loadMoreSentinel();
      const hasMore = this.hasMoreTimelineEvents();

      // Only setup observer if we have the sentinel and more data to load
      if (sentinel && hasMore) {
        // Use setTimeout to ensure DOM is updated
        setTimeout(() => this.setupLoadMoreObserver(), 0);
      }
    });
  }

  private restoreTimeSelection(pubkey: string): void {
    const savedPreset = this.accountLocalState.getSummaryTimePreset(pubkey);

    if (savedPreset !== undefined && savedPreset !== null) {
      this.selectedPreset.set(savedPreset);
    } else {
      // Default to last visit
      this.selectedPreset.set(null);
    }
  }

  private restoreListSelection(pubkey: string): void {
    const initialFilter = this.urlListFilter() ?? this.accountLocalState.getSummaryListFilter(pubkey);
    this.selectListFilter(initialFilter, false);
  }

  ngOnInit(): void {
    // Start periodic timestamp saving while on the summary page
    this.startTimestampSaveInterval();
  }

  ngOnDestroy(): void {
    // Mark as destroyed to prevent further operations
    this.isDestroyed = true;

    // Stop the interval
    this.stopTimestampSaveInterval();

    // Cleanup IntersectionObserver
    this.cleanupLoadMoreObserver();

    // Save final timestamp when leaving the page
    this.saveCurrentTimestamp();
  }

  private setupLoadMoreObserver(): void {
    // Cleanup any existing observer first
    this.cleanupLoadMoreObserver();

    const sentinel = this.loadMoreSentinel();
    if (!sentinel) return;

    this.loadMoreObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && this.hasMoreTimelineEvents() && !this.isLoading()) {
          this.loadMoreTimelineEvents();
        }
      },
      { rootMargin: '300px' }
    );

    this.loadMoreObserver.observe(sentinel.nativeElement);
  }

  private cleanupLoadMoreObserver(): void {
    if (this.loadMoreObserver) {
      this.loadMoreObserver.disconnect();
      this.loadMoreObserver = null;
    }
  }

  private startTimestampSaveInterval(): void {
    this.saveTimestampInterval = setInterval(() => {
      this.saveCurrentTimestamp();
    }, SAVE_INTERVAL_MS);
  }

  private stopTimestampSaveInterval(): void {
    if (this.saveTimestampInterval) {
      clearInterval(this.saveTimestampInterval);
      this.saveTimestampInterval = null;
    }
  }

  private saveCurrentTimestamp(): void {
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setLastSummaryCheck(pubkey, Date.now());
    }
  }

  async loadSummaryData(): Promise<void> {
    if (this.isDestroyed) return;

    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.isLoading.set(false);
      return;
    }

    this.isLoading.set(true);

    // Get last check timestamp and freeze it if not already frozen
    const lastCheck = this.accountLocalState.getLastSummaryCheck(pubkey);
    this.lastCheckTimestamp.set(lastCheck);

    // Freeze the "last visit" timestamp on first load - this won't change during the session
    if (this.frozenLastVisitTimestamp === 0) {
      this.frozenLastVisitTimestamp = lastCheck;
    }

    // Calculate the timestamp based on selected time range
    let sinceTimestamp: number;

    const preset = this.selectedPreset();

    if (preset !== null) {
      sinceTimestamp = Math.floor((Date.now() - preset * 60 * 60 * 1000) / 1000);
    } else {
      // Use the frozen timestamp for "since last visit" queries
      sinceTimestamp = this.frozenLastVisitTimestamp
        ? Math.floor(this.frozenLastVisitTimestamp / 1000)
        : Math.floor((Date.now() - DEFAULT_DAYS_LOOKBACK * MS_PER_DAY) / 1000);
    }

    // STEP 1: Load from database FIRST for instant UI
    await this.loadActivitySummary(sinceTimestamp);
    this.isLoading.set(false); // Show cached data immediately

    // STEP 2: Fetch new events from relays for the selected time range
    await this.fetchEventsFromRelays(sinceTimestamp);

    // STEP 3: Reload from database to include newly fetched events
    await this.loadActivitySummary(sinceTimestamp);
  }

  /**
   * Fetch events from relays for the specified time range.
   * Events are saved to the database for future queries.
   * 
   * @param sinceTimestamp The unix timestamp (seconds) to fetch events from
   * @param forceRefresh If true, forces a refresh from relays even if recently fetched
   */
  private async fetchEventsFromRelays(sinceTimestamp: number, forceRefresh = false): Promise<void> {
    if (this.isDestroyed) return;

    const following = this.accountState.followingList();
    if (following.length === 0) return;

    this.isFetching.set(true);
    this.fetchProgress.set({ fetched: 0, total: following.length });

    try {
      this.logger.info(`[Summary] Fetching events since ${new Date(sinceTimestamp * 1000).toISOString()}${forceRefresh ? ' (forced refresh)' : ''}`);

      // Use the FollowingDataService with the user's selected time range
      const events = await this.followingData.ensureFollowingData(
        SUMMARY_FETCH_KINDS,
        forceRefresh, // Force fetch if doing manual refresh
        // Progress callback for new events from relays
        (newEvents: Event[]) => {
          this.fetchProgress.update(p => ({
            ...p,
            fetched: p.fetched + newEvents.length,
          }));
        },
        undefined, // onCacheLoaded - not needed here
        sinceTimestamp // Always use the user's selected time range
      );

      this.logger.info(`[Summary] Total ${events.length} events available from following`);

    } catch (error) {
      this.logger.warn('[Summary] Error fetching from relays:', error);
    } finally {
      this.isFetching.set(false);
    }
  }

  private async loadActivitySummary(sinceTimestamp: number): Promise<void> {
    if (this.isDestroyed) return;

    try {
      const following = this.accountState.followingList();
      if (following.length === 0) {
        this.activitySummary.set({
          notesCount: 0,
          repostsCount: 0,
          articlesCount: 0,
          audioCount: 0,
          mediaCount: 0,
          communitiesCount: 0,
          chatsCount: 0,
          liveEventsCount: 0,
          calendarCount: 0,
          musicCount: 0,
          profileUpdatesCount: 0,
        });
        this.allActivePosters.set([]);
        this.postersPage.set(1);
        this.profileUpdatesRaw.set([]);
        this.noteEvents.set([]);
        this.repostEvents.set([]);
        this.articleEventsRaw.set([]);
        this.audioEventsRaw.set([]);
        this.mediaEventsRaw.set([]);
        this.communityEventsRaw.set([]);
        this.chatEventsRaw.set([]);
        this.liveEventsRaw.set([]);
        this.calendarEventsRaw.set([]);
        this.musicEventsRaw.set([]);
        return;
      }

      await this.database.init();

      const accountPubkey = this.accountState.pubkey();
      if (!accountPubkey) return;

      // Get events from database
      const [notes, reposts6, reposts16, articles, audio1222, audio1244, media20, media21, media22, media34235, media34236, communities, chatChannels, chatMessages, liveEvents, calendarDateEvents, calendarTimeEvents, calendarRsvps, music32100, music34139, music36787, profiles] = await Promise.all([
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 1, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 6, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 16, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 30023, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 1222, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 1244, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 20, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 21, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 22, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 34235, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 34236, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, COMMUNITY_DEFINITION_KIND, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 40, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 42, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 30311, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 31922, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 31923, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 31925, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 32100, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 34139, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 36787, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 0, sinceTimestamp),
      ]);

      const reposts = [...reposts6, ...reposts16];
      const audio = [...audio1222, ...audio1244];
      const media = [...media20, ...media21, ...media22, ...media34235, ...media34236];
      const chats = [...chatChannels, ...chatMessages];
      const calendar = [...calendarDateEvents, ...calendarTimeEvents, ...calendarRsvps];
      const music = [...music32100, ...music34139, ...music36787];

      this.logger.debug(`[Summary] Queried since timestamp: ${sinceTimestamp} (${new Date(sinceTimestamp * 1000).toISOString()})`);
      this.logger.debug(`[Summary] Found ${notes.length} notes, ${reposts.length} reposts, ${articles.length} articles, ${audio.length} audio posts, ${media.length} media events, ${communities.length} communities, ${chats.length} chats, ${liveEvents.length} live events, ${calendar.length} calendar events, ${music.length} music events, ${profiles.length} profile updates`);

      const profileUpdatePubkeys = [...new Set(profiles.map(p => p.pubkey))];

      this.activitySummary.set({
        notesCount: notes.length,
        repostsCount: reposts.length,
        articlesCount: articles.length,
        audioCount: audio.length,
        mediaCount: media.length,
        communitiesCount: communities.length,
        chatsCount: chats.length,
        liveEventsCount: liveEvents.length,
        calendarCount: calendar.length,
        musicCount: music.length,
        profileUpdatesCount: profileUpdatePubkeys.length,
      });

      // Store events for timeline and drill-down
      this.noteEvents.set(this.mapTimelineEvents(notes));
      this.repostEvents.set(this.mapTimelineEvents(reposts));
      this.articleEventsRaw.set(this.mapTimelineEvents(articles));
      this.audioEventsRaw.set(this.mapTimelineEvents(audio));
      this.mediaEventsRaw.set(this.mapTimelineEvents(media));
      this.communityEventsRaw.set(this.mapTimelineEvents(communities));
      this.chatEventsRaw.set(this.mapTimelineEvents(chats));
      this.liveEventsRaw.set(this.mapTimelineEvents(liveEvents));
      this.calendarEventsRaw.set(this.mapTimelineEvents(calendar));
      this.musicEventsRaw.set(this.mapTimelineEvents(music));

      this.calculatePosterStats(notes, reposts, articles, audio, media, communities, chats, liveEvents, calendar, music);
      this.profileUpdatesRaw.set(profileUpdatePubkeys.slice(0, MAX_PROFILE_UPDATES));

    } catch (error) {
      this.logger.warn('Failed to load activity summary:', error);
    }
  }

  private calculatePosterStats(notes: Event[], reposts: Event[], articles: Event[], audio: Event[], media: Event[], communities: Event[], chats: Event[], liveEvents: Event[], calendar: Event[], music: Event[]): void {
    const statsMap = new Map<string, PosterStats>();

    this.incrementPosterStats(statsMap, notes, 'notesCount');
    this.incrementPosterStats(statsMap, reposts, 'repostsCount');
    this.incrementPosterStats(statsMap, articles, 'articlesCount');
    this.incrementPosterStats(statsMap, audio, 'audioCount');
    this.incrementPosterStats(statsMap, media, 'mediaCount');
    this.incrementPosterStats(statsMap, communities, 'communitiesCount');
    this.incrementPosterStats(statsMap, chats, 'chatsCount');
    this.incrementPosterStats(statsMap, liveEvents, 'liveEventsCount');
    this.incrementPosterStats(statsMap, calendar, 'calendarCount');
    this.incrementPosterStats(statsMap, music, 'musicCount');

    // Sort by total count (no more slice limit here)
    const sorted = Array.from(statsMap.values())
      .sort((a, b) => b.totalCount - a.totalCount);

    this.allActivePosters.set(sorted);
    this.postersPage.set(1); // Reset pagination
  }

  private createEmptyPosterStats(pubkey: string): PosterStats {
    return {
      pubkey,
      notesCount: 0,
      repostsCount: 0,
      articlesCount: 0,
      audioCount: 0,
      mediaCount: 0,
      communitiesCount: 0,
      chatsCount: 0,
      liveEventsCount: 0,
      calendarCount: 0,
      musicCount: 0,
      totalCount: 0,
    };
  }

  private incrementPosterStats(statsMap: Map<string, PosterStats>, events: Event[], key: PosterStatsCountKey): void {
    for (const event of events) {
      const existing = statsMap.get(event.pubkey) || this.createEmptyPosterStats(event.pubkey);
      existing[key]++;
      existing.totalCount++;
      statsMap.set(event.pubkey, existing);
    }
  }

  private mapTimelineEvents(events: Event[]): TimelineEvent[] {
    return events.map(event => ({
      id: event.id,
      pubkey: event.pubkey,
      kind: event.kind,
      created_at: event.created_at,
      content: event.content,
      tags: event.tags,
    }));
  }

  private filterEventsBySelectedList(events: TimelineEvent[]): TimelineEvent[] {
    const list = this.selectedList();
    if (!list) {
      return events;
    }

    const listPubkeys = new Set(list.pubkeys);
    return events.filter(event => listPubkeys.has(event.pubkey));
  }

  private filterSectionEvents(events: TimelineEvent[], allowedKinds: number[]): TimelineEvent[] {
    const filteredByList = this.filterEventsBySelectedList(events);
    const currentKinds = this.currentContentKinds();

    if (!allowedKinds.some(kind => currentKinds.includes(kind))) {
      return [];
    }

    return filteredByList.filter(event => currentKinds.includes(event.kind));
  }

  toggleTimePanel(): void {
    this.timePanelOpen.update(v => !v);
  }

  closeTimePanel(): void {
    this.timePanelOpen.set(false);
  }

  toggleFilterPanel(): void {
    this.filterPanelOpen.update(isOpen => !isOpen);
  }

  closeFilterPanel(): void {
    this.filterPanelOpen.set(false);
  }

  isContentTypeSelected(type: ContentTypeOption): boolean {
    return type.kinds.some(kind => this.currentContentKinds().includes(kind));
  }

  toggleContentType(type: ContentTypeOption): void {
    const currentKinds = this.currentContentKinds();
    const isSelected = this.isContentTypeSelected(type);

    let nextKinds: number[];
    if (isSelected) {
      nextKinds = currentKinds.filter(kind => !type.kinds.includes(kind));
      if (nextKinds.length === 0) {
        return;
      }
    } else {
      nextKinds = [...new Set([...currentKinds, ...type.kinds])];
    }

    this.localSettings.setContentFilterKinds(nextKinds);
    if (type.id === 'reposts') {
      this.localSettings.setContentFilterShowReposts(!isSelected);
    }
    this.timelinePage.set(1);
  }

  toggleShowReplies(): void {
    this.localSettings.setContentFilterShowReplies(!this.currentShowReplies());
    this.timelinePage.set(1);
  }

  selectAllContentTypes(): void {
    const allKinds = [...new Set(this.summaryContentTypes.flatMap(type => type.kinds))];
    this.localSettings.setContentFilterKinds(allKinds);
    this.localSettings.setContentFilterShowReposts(true);
    this.timelinePage.set(1);
  }

  clearContentTypes(): void {
    this.localSettings.setContentFilterKinds(POST_KINDS);
    this.localSettings.setContentFilterShowReposts(false);
    this.timelinePage.set(1);
  }

  resetContentFilter(): void {
    this.localSettings.resetContentFilter();
    this.timelinePage.set(1);
  }

  selectListFilter(filter: ListFilterValue, persist = true): void {
    this.currentListFilter.set(filter);

    const followSet = filter === 'following'
      ? null
      : this.followSets().find(set => set.dTag === filter) ?? null;

    this.selectedList.set(followSet);

    if (persist) {
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        this.accountLocalState.setSummaryListFilter(pubkey, filter);
      }
    }

    this.postersPage.set(1);
    this.timelinePage.set(1);
  }

  selectPreset(hours: number): void {
    this.selectedPreset.set(hours);
    // Reset timeline pagination when changing time range
    this.timelinePage.set(1);
    // Reset posters pagination when changing time range
    this.postersPage.set(1);
    // Clear poster filter when changing time range
    this.selectedPosters.set(new Set());
    // Save selection
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setSummaryTimePreset(pubkey, hours);
    }
    // Close the panel
    this.closeTimePanel();
    this.loadSummaryData();
  }

  resetToLastVisit(): void {
    this.selectedPreset.set(null);
    // Reset timeline pagination when changing time range
    this.timelinePage.set(1);
    // Clear poster filter when changing time range
    this.selectedPosters.set(new Set());
    // Save selection
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setSummaryTimePreset(pubkey, null);
    }
    // Close the panel
    this.closeTimePanel();
    this.loadSummaryData();
  }

  loadMoreTimelineEvents(): void {
    this.timelinePage.update(p => p + 1);
  }

  loadMorePosters(): void {
    this.postersPage.update(p => p + 1);
  }

  // Poster filter methods
  togglePosterSelection(pubkey: string): void {
    this.selectedPosters.update(set => {
      const newSet = new Set(set);
      if (newSet.has(pubkey)) {
        newSet.delete(pubkey);
      } else {
        newSet.add(pubkey);
      }
      return newSet;
    });
    // Reset timeline pagination when filter changes
    this.timelinePage.set(1);
  }

  isPosterSelected(pubkey: string): boolean {
    return this.selectedPosters().has(pubkey);
  }

  clearPosterFilter(): void {
    this.selectedPosters.set(new Set());
    this.timelinePage.set(1);
  }

  clearListFilter(): void {
    this.selectListFilter('following');
  }

  onFilterChanged(filter: ListFilterValue): void {
    this.selectListFilter(filter);
  }

  onFollowSetChanged(followSet: FollowSet | null): void {
    this.selectedList.set(followSet);
    this.postersPage.set(1);
    this.timelinePage.set(1);
  }

  onProfileClick(event: globalThis.Event, pubkey: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.layout.openProfile(pubkey);
  }

  toggleGmFilter(): void {
    this.gmFilterMode.update(mode => {
      if (mode === 'all') return 'only';
      if (mode === 'only') return 'exclude';
      return 'all';
    });
    this.timelinePage.set(1);
  }

  clearGmFilter(): void {
    this.gmFilterMode.set('all');
    this.timelinePage.set(1);
  }

  getGmFilterLabel(): string {
    const mode = this.gmFilterMode();
    if (mode === 'only') return 'GM / Pura Vida: Only';
    if (mode === 'exclude') return 'GM / Pura Vida: Exclude';
    return 'GM / Pura Vida';
  }

  getGmFilterTooltip(): string {
    const mode = this.gmFilterMode();
    if (mode === 'all') return 'Mode: Not selected. Click for only GM/PV posts.';
    if (mode === 'only') return 'Mode: Showing only GM/PV. Click to filter out GM/PV.';
    return 'Mode: Filtering out GM/PV. Click to clear this filter.';
  }

  /**
   * Check if content starts with GM, PV, or Pura Vida (case-insensitive)
   */
  private isGmPuraVidaPost(content: string): boolean {
    if (!content) return false;
    const trimmed = content.trim().toLowerCase();
    return trimmed.startsWith('gm') || trimmed.startsWith('pv') || trimmed.startsWith('pura vida');
  }

  selectAllPosters(): void {
    const allPubkeys = this.allActivePosters().map(p => p.pubkey);
    this.selectedPosters.set(new Set(allPubkeys));
    this.timelinePage.set(1);
  }

  // Open event detail in the right panel
  openEventDialog(event: MouseEvent, timelineEvent: TimelineEvent): void {
    event.preventDefault();
    event.stopPropagation();

    // Mark event as read
    this.readEventIds.update(ids => {
      const next = new Set(ids);
      next.add(timelineEvent.id);
      return next;
    });

    // For articles (kind 30023), use layout service to open in right panel
    if (timelineEvent.kind === 30023) {
      const dTag = timelineEvent.tags?.find(t => t[0] === 'd')?.[1] || '';
      try {
        const naddr = nip19.naddrEncode({
          kind: 30023,
          pubkey: timelineEvent.pubkey,
          identifier: dTag,
        });
        this.layout.openArticle(naddr);
        return;
      } catch (err) {
        this.logger.error('[Summary] Failed to encode article naddr:', err);
        // Fall through to regular event handling
      }
    }

    if (
      timelineEvent.kind === 30311 ||
      timelineEvent.kind === 31922 ||
      timelineEvent.kind === 31923 ||
      timelineEvent.kind === 34139 ||
      timelineEvent.kind === 36787
    ) {
      this.layout.openEvent(timelineEvent.id, this.toNostrEvent(timelineEvent));
      return;
    }

    // For regular events, navigate to event route in right outlet
    this.layout.openGenericEvent(timelineEvent.id);
  }

  togglePanel(panel: 'notes' | 'articles' | 'media'): void {
    this.expandedPanel.set(this.expandedPanel() === panel ? null : panel);
  }

  getEventKindIcon(kind: number): string {
    switch (kind) {
      case 1: return 'chat';
      case 6: return 'repeat';
      case 16: return 'repeat';
      case 30023: return 'article';
      case 20: return 'perm_media';
      default: return 'event';
    }
  }

  getEventKindLabel(kind: number): string {
    return SUMMARY_TIMELINE_KIND_LABELS[kind] ?? getKindLabel(kind);
  }

  // Open article in the right panel
  openArticle(event: TimelineEvent): void {
    const dTag = event.tags?.find(t => t[0] === 'd')?.[1] || '';
    try {
      const naddr = nip19.naddrEncode({
        kind: 30023,
        pubkey: event.pubkey,
        identifier: dTag,
      });
      // Pass the event to avoid re-fetching
      this.layout.openArticle(naddr, this.toNostrEvent(event));
    } catch (err) {
      this.logger.error('[Summary] Failed to encode article naddr:', err);
      // Fallback to event dialog
      this.layout.openGenericEvent(event.id);
    }
  }

  getArticleRoute(event: TimelineEvent): string[] {
    // For articles (kind 30023), generate naddr route
    if (event.tags) {
      const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
      try {
        const naddr = nip19.naddrEncode({
          kind: 30023,
          pubkey: event.pubkey,
          identifier: dTag,
        });
        return ['/a', naddr];
      } catch {
        // Fallback to event ID
        return ['/e', event.id];
      }
    }
    return ['/e', event.id];
  }

  getEventRoute(event: TimelineEvent): string[] {
    // For articles (kind 30023), generate naddr route
    if (event.kind === 30023 && event.tags) {
      const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
      try {
        const naddr = nip19.naddrEncode({
          kind: 30023,
          pubkey: event.pubkey,
          identifier: dTag,
        });
        return ['/a', naddr];
      } catch {
        // Fallback to event ID
        return ['/e', event.id];
      }
    }
    // For notes and media, use event ID
    return ['/e', event.id];
  }

  getEventPreview(event: TimelineEvent): string {
    if (event.kind === 30023 && event.tags) {
      // For articles, get title from tags
      const title = event.tags.find(t => t[0] === 'title')?.[1];
      if (title) return title;
    }
    if (event.kind === COMMUNITY_DEFINITION_KIND) {
      return this.getTaggedValue(event, 'name') || this.getTaggedValue(event, 'description') || 'Published a new community';
    }
    if (event.kind === 40) {
      return this.getEventJsonString(event, 'name') || this.getEventJsonString(event, 'about') || 'Created a public chat';
    }
    if (event.kind === 31925) {
      const status = this.getTaggedValue(event, 'status');
      return status ? `RSVP: ${status}` : 'Responded to a calendar event';
    }
    if (
      event.kind === 30311 ||
      event.kind === 31922 ||
      event.kind === 31923 ||
      event.kind === 32100 ||
      event.kind === 34139 ||
      event.kind === 36787 ||
      event.kind === 1222 ||
      event.kind === 1244
    ) {
      return this.getTaggedValue(event, 'title') ||
        this.getTaggedValue(event, 'name') ||
        this.getTaggedValue(event, 'summary') ||
        this.getTaggedValue(event, 'description') ||
        this.getTaggedValue(event, 'alt') ||
        (event.kind === 30311 ? 'Started a live event' : 'Published new content');
    }
    // For reposts, try to extract content from embedded event or show referenced event info
    if (event.kind === 6 || event.kind === 16) {
      if (event.content) {
        try {
          const embedded = JSON.parse(event.content);
          if (embedded.content) {
            const content = embedded.content;
            return content.length > 100 ? content.substring(0, 100) + '...' : content;
          }
        } catch {
          // Not valid JSON, use content directly
        }
      }
      return 'Reposted a note';
    }
    // Truncate content for preview
    const content = event.content || '';
    return content.length > 100 ? content.substring(0, 100) + '...' : content;
  }

  private getTaggedValue(event: TimelineEvent, tagName: string): string {
    return event.tags?.find(tag => tag[0] === tagName)?.[1] || '';
  }

  private getEventJsonString(event: TimelineEvent, key: string): string {
    if (!event.content) {
      return '';
    }

    try {
      const parsed = JSON.parse(event.content) as unknown;
      if (typeof parsed !== 'object' || parsed === null) {
        return '';
      }

      const value = (parsed as Record<string, unknown>)[key];
      return typeof value === 'string' ? value : '';
    } catch {
      return '';
    }
  }

  private toNostrEvent(event: TimelineEvent): Event {
    return {
      id: event.id,
      pubkey: event.pubkey,
      kind: event.kind,
      created_at: event.created_at,
      tags: event.tags ?? [],
      content: event.content,
      sig: '',
    };
  }

  async refresh(): Promise<void> {
    if (this.isDestroyed) return;

    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    // Calculate the timestamp based on selected time range
    const preset = this.selectedPreset();
    let sinceTimestamp: number;

    if (preset !== null) {
      sinceTimestamp = Math.floor((Date.now() - preset * 60 * 60 * 1000) / 1000);
    } else {
      // Use the frozen timestamp for "since last visit" queries
      sinceTimestamp = this.frozenLastVisitTimestamp
        ? Math.floor(this.frozenLastVisitTimestamp / 1000)
        : Math.floor((Date.now() - DEFAULT_DAYS_LOOKBACK * MS_PER_DAY) / 1000);
    }

    this.isLoading.set(true);

    // Force full refresh from relays for the selected time range
    await this.fetchEventsFromRelays(sinceTimestamp, true);

    // Reload from database to show all events
    await this.loadActivitySummary(sinceTimestamp);

    this.isLoading.set(false);
  }

  formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  /**
   * Get article title from tags
   */
  getArticleTitle(event: TimelineEvent): string {
    if (event.tags) {
      const title = event.tags.find(t => t[0] === 'title')?.[1];
      if (title) return title;
    }
    // Fallback to content preview
    const content = event.content || '';
    return content.length > 60 ? content.substring(0, 60) + '...' : content || 'Untitled';
  }

  /**
   * Get article summary/description from tags
   */
  getArticleSummary(event: TimelineEvent): string {
    if (event.tags) {
      const summary = event.tags.find(t => t[0] === 'summary')?.[1];
      if (summary) return summary.length > 120 ? summary.substring(0, 120) + '...' : summary;
    }
    // Fallback to content preview
    const content = event.content || '';
    return content.length > 120 ? content.substring(0, 120) + '...' : content;
  }

  /**
   * Get article image from tags
   */
  getArticleImage(event: TimelineEvent): string | null {
    if (!event.tags) return null;
    // Look for image tag
    const imageTag = event.tags.find(t => t[0] === 'image')?.[1];
    if (imageTag) return imageTag;
    // Fallback to thumb tag
    const thumbTag = event.tags.find(t => t[0] === 'thumb')?.[1];
    if (thumbTag) return thumbTag;
    return null;
  }

  /**
   * Extract media URL from event tags (imeta tag format: ["imeta", "url <url>", ...])
   */
  getMediaUrl(event: TimelineEvent): string | null {
    if (!event.tags) return null;

    // Look for imeta tag
    const imetaTag = event.tags.find(t => t[0] === 'imeta');
    if (imetaTag) {
      // Find the url entry in imeta tag
      const urlEntry = imetaTag.find(v => v.startsWith('url '));
      if (urlEntry) {
        return urlEntry.substring(4).trim();
      }
    }

    // Fallback: check content for URL
    if (event.content) {
      const urlMatch = event.content.match(/https?:\/\/[^\s]+/);
      if (urlMatch) return urlMatch[0];
    }

    return null;
  }

  getMediaPreviewSource(event: TimelineEvent): MediaPreviewSource {
    const mediaUrl = this.getMediaUrl(event);

    if (!mediaUrl) {
      return { previewUrl: null, mediaUrl: null, isVideo: false };
    }

    const isVideo = this.isVideoEvent(event, mediaUrl);
    if (!isVideo) {
      return { previewUrl: mediaUrl, mediaUrl, isVideo: false };
    }

    const previewUrl = this.getImetaValue(event, 'image')
      ?? this.getImetaValue(event, 'thumb');

    if (this.failedMediaPreviewIds().has(event.id)) {
      return { previewUrl: null, mediaUrl, isVideo: true };
    }

    return { previewUrl, mediaUrl, isVideo: true };
  }

  onMediaPreviewError(eventId: string): void {
    this.failedMediaPreviewIds.update(ids => {
      if (ids.has(eventId)) {
        return ids;
      }

      const next = new Set(ids);
      next.add(eventId);
      return next;
    });
  }

  private getImetaValue(event: TimelineEvent, key: string): string | null {
    const imetaTags = event.tags?.filter(tag => tag[0] === 'imeta') ?? [];

    for (const imetaTag of imetaTags) {
      const value = imetaTag.find(entry => entry.startsWith(`${key} `));
      if (value) {
        return value.substring(key.length + 1).trim();
      }
    }

    return null;
  }

  /**
   * Check if a URL is likely a video based on extension or common video hosts
   */
  isVideoUrl(url: string): boolean {
    const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m3u8', '.qt'];
    const videoHosts = ['youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv'];

    const lowerUrl = url.toLowerCase();
    if (videoExtensions.some(ext => lowerUrl.includes(ext))) return true;
    if (videoHosts.some(host => lowerUrl.includes(host))) return true;

    return false;
  }

  private isVideoEvent(event: TimelineEvent, mediaUrl: string): boolean {
    if (VIDEO_KINDS.includes(event.kind)) {
      return true;
    }

    const mimeType = this.getImetaValue(event, 'm');
    if (mimeType?.toLowerCase().startsWith('video/')) {
      return true;
    }

    return this.isVideoUrl(mediaUrl);
  }

  /**
   * Open media in a fullscreen preview dialog
   */
  openMediaDialog(event: MouseEvent, mediaEvent: TimelineEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const mediaUrl = this.getMediaUrl(mediaEvent);
    if (!mediaUrl) return;

    const isVideo = this.isVideoEvent(mediaEvent, mediaUrl);

    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaUrl: mediaUrl,
        mediaType: isVideo ? 'video' : 'image',
        mediaTitle: 'Media',
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      panelClass: 'image-dialog-panel',
    });
  }
}
