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
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { FormsModule } from '@angular/forms';
import { AccountStateService } from '../../services/account-state.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { FavoritesService } from '../../services/favorites.service';
import { Algorithms } from '../../services/algorithms';
import { DatabaseService } from '../../services/database.service';
import { DataService } from '../../services/data.service';
import { LoggerService } from '../../services/logger.service';
import { UtilitiesService } from '../../services/utilities.service';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { NostrRecord } from '../../interfaces';
import { UserMetric } from '../../interfaces/metrics';
import { Event } from 'nostr-tools';
import { ApplicationService } from '../../services/application.service';

interface ActivitySummary {
  notesCount: number;
  articlesCount: number;
  mediaCount: number;
  profileUpdates: string[]; // pubkeys of users who updated profiles
}

interface TopPoster {
  pubkey: string;
  count: number;
  profile?: NostrRecord;
}

// Constants for configurable limits
const DEFAULT_DAYS_LOOKBACK = 2;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_FAVORITES_DISPLAY = 10;
const MAX_TOP_RANKED_USERS = 10;
const MAX_TOP_POSTERS = 5;
const MAX_UPDATED_PROFILES = 10;
const SAVE_INTERVAL_MS = 5000; // Save timestamp every 5 seconds

@Component({
  selector: 'app-summary',
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatTooltipModule,
    MatChipsModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    UserProfileComponent,
  ],
  templateUrl: './summary.component.html',
  styleUrl: './summary.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SummaryComponent implements OnInit, OnDestroy {
  private readonly accountState = inject(AccountStateService);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly favoritesService = inject(FavoritesService);
  private readonly algorithms = inject(Algorithms);
  private readonly database = inject(DatabaseService);
  private readonly data = inject(DataService);
  private readonly logger = inject(LoggerService);
  private readonly utilities = inject(UtilitiesService);
  protected readonly app = inject(ApplicationService);

  // Timer for periodic timestamp saves
  private saveTimestampInterval: ReturnType<typeof setInterval> | null = null;

  // Max date for date picker
  readonly today = new Date();

  // Time range presets
  readonly timePresets = [
    { label: '1 hour', hours: 1 },
    { label: '2 hours', hours: 2 },
    { label: '6 hours', hours: 6 },
    { label: '12 hours', hours: 12 },
    { label: '1 day', hours: 24 },
    { label: '2 days', hours: 48 },
    { label: '3 days', hours: 72 },
    { label: '1 week', hours: 168 },
  ];

  // Selected time range
  selectedPreset = signal<number | null>(null); // hours, null = since last visit
  customDate = signal<Date | null>(null);

  // State signals
  isLoading = signal(true);
  isLoadingActivity = signal(true);
  isLoadingTopRanked = signal(true);
  lastCheckTimestamp = signal(0);

  // Favorites
  favorites = computed(() => this.favoritesService.favorites());
  favoritesProfiles = signal<NostrRecord[]>([]);

  // Algorithm recommended users
  topRankedUsers = signal<UserMetric[]>([]);

  // Activity summary
  activitySummary = signal<ActivitySummary>({
    notesCount: 0,
    articlesCount: 0,
    mediaCount: 0,
    profileUpdates: [],
  });

  // Top posters by category
  topNotePosters = signal<TopPoster[]>([]);
  topArticlePosters = signal<TopPoster[]>([]);
  topMediaPosters = signal<TopPoster[]>([]);

  // Profile updates
  updatedProfiles = signal<NostrRecord[]>([]);

  // Time since last check - reflects the selected time range
  timeSinceLastCheck = computed(() => {
    // If a preset is selected
    const preset = this.selectedPreset();
    if (preset !== null) {
      const presetInfo = this.timePresets.find(p => p.hours === preset);
      return presetInfo ? presetInfo.label + ' ago' : `${preset} hours ago`;
    }

    // If a custom date is selected
    const custom = this.customDate();
    if (custom) {
      return this.formatDate(custom);
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

  // Format date for display
  private formatDate(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffDays === 0) {
      return 'today at ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'yesterday at ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
        ' at ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  // Check if user has any favorites
  hasFavorites = computed(() => this.favorites().length > 0);

  // Check if user has following list
  hasFollowing = computed(() => this.accountState.followingList().length > 0);

  constructor() {
    // Load data when account changes
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        this.loadSummaryData();
      }
    });
  }

  ngOnInit(): void {
    // Start periodic timestamp saving while on the summary page
    this.startTimestampSaveInterval();
  }

  ngOnDestroy(): void {
    // Stop the interval
    this.stopTimestampSaveInterval();

    // Save final timestamp when leaving the page
    this.saveCurrentTimestamp();
  }

  /**
   * Start the interval to periodically save the last summary check timestamp
   */
  private startTimestampSaveInterval(): void {
    this.saveTimestampInterval = setInterval(() => {
      this.saveCurrentTimestamp();
    }, SAVE_INTERVAL_MS);
  }

  /**
   * Stop the timestamp save interval
   */
  private stopTimestampSaveInterval(): void {
    if (this.saveTimestampInterval) {
      clearInterval(this.saveTimestampInterval);
      this.saveTimestampInterval = null;
    }
  }

  /**
   * Save the current timestamp as the last summary check
   */
  private saveCurrentTimestamp(): void {
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setLastSummaryCheck(pubkey, Date.now());
    }
  }

  async loadSummaryData(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.isLoading.set(false);
      return;
    }

    // Get last check timestamp immediately
    const lastCheck = this.accountLocalState.getLastSummaryCheck(pubkey);
    this.lastCheckTimestamp.set(lastCheck);

    // Calculate the timestamp based on selected time range
    let sinceTimestamp: number;

    const preset = this.selectedPreset();
    const custom = this.customDate();

    if (preset !== null) {
      // Use preset hours
      sinceTimestamp = Math.floor((Date.now() - preset * 60 * 60 * 1000) / 1000);
    } else if (custom) {
      // Use custom date
      sinceTimestamp = Math.floor(custom.getTime() / 1000);
    } else {
      // Default: since last visit or DEFAULT_DAYS_LOOKBACK days ago
      sinceTimestamp = lastCheck
        ? Math.floor(lastCheck / 1000)
        : Math.floor((Date.now() - DEFAULT_DAYS_LOOKBACK * MS_PER_DAY) / 1000);
    }

    // Stop showing main loading spinner - show content progressively
    this.isLoading.set(false);

    // Reset section loading states
    this.isLoadingActivity.set(true);
    this.isLoadingTopRanked.set(true);

    // Load all data in parallel - each section updates independently
    // Don't await - let each section render as it completes
    this.loadFavoritesProfiles();
    this.loadTopRankedUsers();
    this.loadActivitySummary(sinceTimestamp);
  }

  private async loadFavoritesProfiles(): Promise<void> {
    const favPubkeys = this.favorites();
    if (favPubkeys.length === 0) {
      this.favoritesProfiles.set([]);
      return;
    }

    const profiles: NostrRecord[] = [];

    // Load profiles for each favorite (limited for performance)
    for (const pubkey of favPubkeys.slice(0, MAX_FAVORITES_DISPLAY)) {
      try {
        const profile = await this.data.getProfile(pubkey);
        if (profile) {
          profiles.push(profile);
        }
      } catch (error) {
        this.logger.warn(`Failed to load profile for ${pubkey}:`, error);
      }
    }

    this.favoritesProfiles.set(profiles);
  }

  private async loadTopRankedUsers(): Promise<void> {
    try {
      const users = await this.algorithms.getRecommendedUsers(MAX_TOP_RANKED_USERS);
      this.topRankedUsers.set(users);
    } catch (error) {
      this.logger.warn('Failed to load top ranked users:', error);
      this.topRankedUsers.set([]);
    } finally {
      this.isLoadingTopRanked.set(false);
    }
  }

  private async loadActivitySummary(sinceTimestamp: number): Promise<void> {
    try {
      const following = this.accountState.followingList();
      if (following.length === 0) {
        this.activitySummary.set({
          notesCount: 0,
          articlesCount: 0,
          mediaCount: 0,
          profileUpdates: [],
        });
        this.isLoadingActivity.set(false);
        return;
      }

      // Ensure database is initialized
      await this.database.init();

      // Get events from database since last check
      // Kind 1 = notes, Kind 30023 = articles, Kind 20 = media
      const [notes, articles, media, profiles] = await Promise.all([
        this.database.getEventsByPubkeyAndKindSince(following, 1, sinceTimestamp),
        this.database.getEventsByPubkeyAndKindSince(following, 30023, sinceTimestamp),
        this.database.getEventsByPubkeyAndKindSince(following, 20, sinceTimestamp),
        this.database.getEventsByPubkeyAndKindSince(following, 0, sinceTimestamp),
      ]);

      // Calculate activity summary - update immediately
      this.activitySummary.set({
        notesCount: notes.length,
        articlesCount: articles.length,
        mediaCount: media.length,
        profileUpdates: [...new Set(profiles.map(p => p.pubkey))],
      });

      // Activity stats are now available
      this.isLoadingActivity.set(false);

      // Calculate top posters
      this.calculateTopPosters(notes, 'notes');
      this.calculateTopPosters(articles, 'articles');
      this.calculateTopPosters(media, 'media');

      // Load profiles for updated users (don't block)
      this.loadUpdatedProfiles(profiles);

    } catch (error) {
      this.logger.warn('Failed to load activity summary:', error);
      this.isLoadingActivity.set(false);
    }
  }

  private calculateTopPosters(events: Event[], type: 'notes' | 'articles' | 'media'): void {
    const posterCounts = new Map<string, number>();

    for (const event of events) {
      const count = posterCounts.get(event.pubkey) || 0;
      posterCounts.set(event.pubkey, count + 1);
    }

    const sorted = Array.from(posterCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_TOP_POSTERS)
      .map(([pubkey, count]) => ({ pubkey, count }));

    switch (type) {
      case 'notes':
        this.topNotePosters.set(sorted);
        break;
      case 'articles':
        this.topArticlePosters.set(sorted);
        break;
      case 'media':
        this.topMediaPosters.set(sorted);
        break;
    }
  }

  private async loadUpdatedProfiles(profileEvents: Event[]): Promise<void> {
    // Get unique pubkeys
    const uniquePubkeys = [...new Set(profileEvents.map(p => p.pubkey))].slice(0, MAX_UPDATED_PROFILES);

    const profiles: NostrRecord[] = [];

    for (const pubkey of uniquePubkeys) {
      try {
        const profile = await this.data.getProfile(pubkey);
        if (profile) {
          profiles.push(profile);
        }
      } catch (error) {
        this.logger.warn(`Failed to load updated profile for ${pubkey}:`, error);
      }
    }

    this.updatedProfiles.set(profiles);
  }

  // Select a time preset
  selectPreset(hours: number): void {
    this.selectedPreset.set(hours);
    this.customDate.set(null);
    this.loadSummaryData();
  }

  // Select custom date
  onCustomDateChange(date: Date | null): void {
    if (date) {
      this.customDate.set(date);
      this.selectedPreset.set(null);
      this.loadSummaryData();
    }
  }

  // Reset to "since last visit"
  resetToLastVisit(): void {
    this.selectedPreset.set(null);
    this.customDate.set(null);
    this.loadSummaryData();
  }

  // Check if using custom time range
  isUsingCustomRange(): boolean {
    return this.selectedPreset() !== null || this.customDate() !== null;
  }

  // Refresh data
  async refresh(): Promise<void> {
    await this.loadSummaryData();
  }

  // Navigate to people discover page
  navigateToPeople(): void {
    // Router navigation will be handled by routerLink in template
  }

  // Format large numbers
  formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }
}
