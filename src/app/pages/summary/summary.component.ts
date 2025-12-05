import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';

import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { AccountStateService } from '../../services/account-state.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { DatabaseService } from '../../services/database.service';
import { LoggerService } from '../../services/logger.service';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { Event, nip19 } from 'nostr-tools';
import { ApplicationService } from '../../services/application.service';
import { AgoPipe } from '../../pipes/ago.pipe';

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
const DEFAULT_DAYS_LOOKBACK = 2;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_POSTERS_DISPLAY = 20;
const MAX_PROFILE_UPDATES = 10;
const MAX_TIMELINE_EVENTS = 50;
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
  protected readonly app = inject(ApplicationService);

  // Timer for periodic timestamp saves
  private saveTimestampInterval: ReturnType<typeof setInterval> | null = null;

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
  lastCheckTimestamp = signal(0);

  // Activity summary
  activitySummary = signal<ActivitySummary>({
    notesCount: 0,
    articlesCount: 0,
    mediaCount: 0,
    profileUpdatesCount: 0,
  });

  // Active posters (people who posted in the time period)
  activePosters = signal<PosterStats[]>([]);

  // Profile updates (pubkeys of people who updated their profiles)
  profileUpdates = signal<string[]>([]);

  // Raw events for timeline and drill-down
  noteEvents = signal<TimelineEvent[]>([]);
  articleEvents = signal<TimelineEvent[]>([]);
  mediaEvents = signal<TimelineEvent[]>([]);

  // Timeline events (combined and sorted)
  timelineEvents = computed(() => {
    const notes = this.noteEvents().map(e => ({ ...e, type: 'note' as const }));
    const articles = this.articleEvents().map(e => ({ ...e, type: 'article' as const }));
    const media = this.mediaEvents().map(e => ({ ...e, type: 'media' as const }));
    return [...notes, ...articles, ...media]
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, MAX_TIMELINE_EVENTS);
  });

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

    // Save final timestamp when leaving the page
    this.saveCurrentTimestamp();
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

    await this.loadActivitySummary(sinceTimestamp);
    this.isLoading.set(false);
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
        this.activePosters.set([]);
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

    const sorted = Array.from(statsMap.values())
      .sort((a, b) => b.totalCount - a.totalCount)
      .slice(0, MAX_POSTERS_DISPLAY);

    this.activePosters.set(sorted);
  }

  selectPreset(hours: number): void {
    this.selectedPreset.set(hours);
    // Save selection
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setSummaryTimePreset(pubkey, hours);
    }
    this.loadSummaryData();
  }

  resetToLastVisit(): void {
    this.selectedPreset.set(null);
    // Save selection
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setSummaryTimePreset(pubkey, null);
    }
    this.loadSummaryData();
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
    await this.loadSummaryData();
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
}
