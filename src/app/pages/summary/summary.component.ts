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
import { Router, RouterModule } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { AccountStateService } from '../../services/account-state.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { DatabaseService } from '../../services/database.service';
import { LoggerService } from '../../services/logger.service';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { Event, nip19 } from 'nostr-tools';
import { ApplicationService } from '../../services/application.service';
import { AgoPipe } from '../../pipes/ago.pipe';
import { FollowingDataService } from '../../services/following-data.service';
import { CustomDialogService, CustomDialogRef } from '../../services/custom-dialog.service';
import { EventDialogComponent } from '../event/event-dialog/event-dialog.component';
import { OnDemandUserDataService } from '../../services/on-demand-user-data.service';
import { MediaPreviewDialogComponent } from '../../components/media-preview-dialog/media-preview.component';
import { LayoutService } from '../../services/layout.service';

interface ActivitySummary {
  notesCount: number;
  articlesCount: number;
  mediaCount: number;
  profileUpdatesCount: number;
}

interface PosterStats {
  pubkey: string;
  notesCount: number;
  articlesCount: number;
  mediaCount: number;
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
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatTooltipModule,
    MatChipsModule,
    MatExpansionModule,
    MatCheckboxModule,
    UserProfileComponent,
    AgoPipe
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
  private readonly dialog = inject(MatDialog);
  protected readonly app = inject(ApplicationService);
  private readonly router = inject(Router);
  private readonly layout = inject(LayoutService);

  // ViewChild for load more sentinel
  loadMoreSentinel = viewChild<ElementRef<HTMLDivElement>>('loadMoreSentinel');

  // Timer for periodic timestamp saves
  private saveTimestampInterval: ReturnType<typeof setInterval> | null = null;

  // IntersectionObserver for infinite scroll
  private loadMoreObserver: IntersectionObserver | null = null;

  // Flag to prevent operations after component destruction
  private isDestroyed = false;

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

  // State signals
  isLoading = signal(true);
  isFetching = signal(false); // Whether we're fetching from relays
  fetchProgress = signal({ fetched: 0, total: 0 });
  lastCheckTimestamp = signal(0);

  // Activity summary
  activitySummary = signal<ActivitySummary>({
    notesCount: 0,
    articlesCount: 0,
    mediaCount: 0,
    profileUpdatesCount: 0,
  });

  // Active posters (people who posted in the time period)
  allActivePosters = signal<PosterStats[]>([]);

  // Posters pagination
  postersPage = signal(1);

  // Section collapse states
  postersCollapsed = signal(false);
  mediaCollapsed = signal(false);
  articlesCollapsed = signal(false);

  // Selected posters for filtering the timeline (empty means show all)
  selectedPosters = signal<Set<string>>(new Set());

  // Whether filter mode is active
  isFilterMode = computed(() => this.selectedPosters().size > 0 || this.gmFilterEnabled());

  // GM/Pura Vida filter
  gmFilterEnabled = signal(false);

  // Paginated active posters
  activePosters = computed(() => {
    const all = this.allActivePosters();
    const page = this.postersPage();
    return all.slice(0, page * MAX_POSTERS_DISPLAY);
  });

  // Check if there are more posters to load
  hasMorePosters = computed(() => {
    const all = this.allActivePosters();
    const shown = this.activePosters();
    return shown.length < all.length;
  });

  // Total posters count
  totalPostersCount = computed(() => this.allActivePosters().length);

  // Profile updates (pubkeys of people who updated their profiles)
  profileUpdates = signal<string[]>([]);

  // Raw events for timeline and drill-down
  noteEvents = signal<TimelineEvent[]>([]);
  articleEvents = signal<TimelineEvent[]>([]);
  mediaEvents = signal<TimelineEvent[]>([]);

  // Timeline pagination
  timelinePage = signal(1);

  // All timeline events (combined, filtered by selected posters, and sorted)
  allTimelineEvents = computed(() => {
    const notes = this.noteEvents().map(e => ({ ...e, type: 'note' as const }));
    const articles = this.articleEvents().map(e => ({ ...e, type: 'article' as const }));
    const media = this.mediaEvents().map(e => ({ ...e, type: 'media' as const }));
    let allEvents = [...notes, ...articles, ...media]
      .sort((a, b) => b.created_at - a.created_at);

    // Filter by selected posters if any are selected
    const selected = this.selectedPosters();
    if (selected.size > 0) {
      allEvents = allEvents.filter(e => selected.has(e.pubkey));
    }

    // Filter by GM/Pura Vida if enabled
    if (this.gmFilterEnabled()) {
      allEvents = allEvents.filter(e => this.isGmPuraVidaPost(e.content));
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
    return summary.notesCount > 0 || summary.articlesCount > 0 ||
      summary.mediaCount > 0 || summary.profileUpdatesCount > 0;
  });

  // Time since last check - reflects the selected time range
  timeSinceLastCheck = computed(() => {
    // If a preset is selected
    const preset = this.selectedPreset();
    if (preset !== null) {
      const presetInfo = this.timePresets.find(p => p.hours === preset);
      return presetInfo ? presetInfo.label + ' ago' : `${preset} hours ago`;
    }

    // Default: since last visit
    const lastCheck = this.lastCheckTimestamp();
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
        this.loadSummaryData();
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

    // Get last check timestamp
    const lastCheck = this.accountLocalState.getLastSummaryCheck(pubkey);
    this.lastCheckTimestamp.set(lastCheck);

    // Calculate the timestamp based on selected time range
    let sinceTimestamp: number;

    const preset = this.selectedPreset();

    if (preset !== null) {
      sinceTimestamp = Math.floor((Date.now() - preset * 60 * 60 * 1000) / 1000);
    } else {
      sinceTimestamp = lastCheck
        ? Math.floor(lastCheck / 1000)
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
        [1, 20, 30023], // Notes, Media, Articles
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
          articlesCount: 0,
          mediaCount: 0,
          profileUpdatesCount: 0,
        });
        this.allActivePosters.set([]);
        this.postersPage.set(1);
        this.profileUpdates.set([]);
        this.noteEvents.set([]);
        this.articleEvents.set([]);
        this.mediaEvents.set([]);
        return;
      }

      await this.database.init();

      const accountPubkey = this.accountState.pubkey();
      if (!accountPubkey) return;

      // Get events from database
      const [notes, articles, media, profiles] = await Promise.all([
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 1, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 30023, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 20, sinceTimestamp),
        this.database.getAllEventsByPubkeyKindSince(accountPubkey, following, 0, sinceTimestamp),
      ]);

      this.logger.debug(`[Summary] Queried since timestamp: ${sinceTimestamp} (${new Date(sinceTimestamp * 1000).toISOString()})`);
      this.logger.debug(`[Summary] Found ${notes.length} notes, ${articles.length} articles, ${media.length} media, ${profiles.length} profile updates`);

      const profileUpdatePubkeys = [...new Set(profiles.map(p => p.pubkey))];

      this.activitySummary.set({
        notesCount: notes.length,
        articlesCount: articles.length,
        mediaCount: media.length,
        profileUpdatesCount: profileUpdatePubkeys.length,
      });

      // Store events for timeline and drill-down
      this.noteEvents.set(notes.map(e => ({
        id: e.id,
        pubkey: e.pubkey,
        kind: e.kind,
        created_at: e.created_at,
        content: e.content,
      })));
      this.articleEvents.set(articles.map(e => ({
        id: e.id,
        pubkey: e.pubkey,
        kind: e.kind,
        created_at: e.created_at,
        content: e.content,
        tags: e.tags, // Include tags for naddr generation
      })));
      this.mediaEvents.set(media.map(e => ({
        id: e.id,
        pubkey: e.pubkey,
        kind: e.kind,
        created_at: e.created_at,
        content: e.content,
        tags: e.tags, // Include tags for media URL extraction
      })));

      this.calculatePosterStats(notes, articles, media);
      this.profileUpdates.set(profileUpdatePubkeys.slice(0, MAX_PROFILE_UPDATES));

    } catch (error) {
      this.logger.warn('Failed to load activity summary:', error);
    }
  }

  private calculatePosterStats(notes: Event[], articles: Event[], media: Event[]): void {
    const statsMap = new Map<string, PosterStats>();

    for (const event of notes) {
      const existing = statsMap.get(event.pubkey) || {
        pubkey: event.pubkey,
        notesCount: 0,
        articlesCount: 0,
        mediaCount: 0,
        totalCount: 0,
      };
      existing.notesCount++;
      existing.totalCount++;
      statsMap.set(event.pubkey, existing);
    }

    for (const event of articles) {
      const existing = statsMap.get(event.pubkey) || {
        pubkey: event.pubkey,
        notesCount: 0,
        articlesCount: 0,
        mediaCount: 0,
        totalCount: 0,
      };
      existing.articlesCount++;
      existing.totalCount++;
      statsMap.set(event.pubkey, existing);
    }

    for (const event of media) {
      const existing = statsMap.get(event.pubkey) || {
        pubkey: event.pubkey,
        notesCount: 0,
        articlesCount: 0,
        mediaCount: 0,
        totalCount: 0,
      };
      existing.mediaCount++;
      existing.totalCount++;
      statsMap.set(event.pubkey, existing);
    }

    // Sort by total count (no more slice limit here)
    const sorted = Array.from(statsMap.values())
      .sort((a, b) => b.totalCount - a.totalCount);

    this.allActivePosters.set(sorted);
    this.postersPage.set(1); // Reset pagination
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

  toggleGmFilter(): void {
    this.gmFilterEnabled.update(v => !v);
    this.timelinePage.set(1);
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
  openEventDialog(event: MouseEvent, timelineEvent: TimelineEvent & { type: string }): void {
    event.preventDefault();
    event.stopPropagation();

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
        console.error('[Summary] Failed to encode article naddr:', err);
        // Fall through to regular event handling
      }
    }

    // For regular events, navigate to event route in right outlet
    const eventId = timelineEvent.id;
    this.router.navigate([{ outlets: { right: ['e', eventId] } }]);
  }

  togglePanel(panel: 'notes' | 'articles' | 'media'): void {
    this.expandedPanel.set(this.expandedPanel() === panel ? null : panel);
  }

  getEventKindIcon(kind: number): string {
    switch (kind) {
      case 1: return 'chat';
      case 30023: return 'article';
      case 20: return 'perm_media';
      default: return 'event';
    }
  }

  getEventKindLabel(kind: number): string {
    switch (kind) {
      case 1: return 'Note';
      case 30023: return 'Article';
      case 20: return 'Media';
      default: return 'Event';
    }
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
      this.layout.openArticle(naddr);
    } catch (err) {
      console.error('[Summary] Failed to encode article naddr:', err);
      // Fallback to event dialog
      this.router.navigate([{ outlets: { right: ['e', event.id] } }]);
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

  getEventRoute(event: TimelineEvent & { type: string }): string[] {
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
    // Truncate content for preview
    const content = event.content || '';
    return content.length > 100 ? content.substring(0, 100) + '...' : content;
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
      const lastCheck = this.accountLocalState.getLastSummaryCheck(pubkey);
      sinceTimestamp = lastCheck
        ? Math.floor(lastCheck / 1000)
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

  /**
   * Check if a URL is likely a video based on extension or common video hosts
   */
  isVideoUrl(url: string): boolean {
    const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m3u8'];
    const videoHosts = ['youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv'];

    const lowerUrl = url.toLowerCase();
    if (videoExtensions.some(ext => lowerUrl.includes(ext))) return true;
    if (videoHosts.some(host => lowerUrl.includes(host))) return true;

    return false;
  }

  /**
   * Open media in a fullscreen preview dialog
   */
  openMediaDialog(event: MouseEvent, mediaEvent: TimelineEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const mediaUrl = this.getMediaUrl(mediaEvent);
    if (!mediaUrl) return;

    const isVideo = this.isVideoUrl(mediaUrl);

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
