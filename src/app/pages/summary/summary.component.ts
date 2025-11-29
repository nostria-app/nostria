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
import { AccountStateService } from '../../services/account-state.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { FavoritesService } from '../../services/favorites.service';
import { Algorithms } from '../../services/algorithms';
import { StorageService } from '../../services/storage.service';
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

@Component({
  selector: 'app-summary',
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatTooltipModule,
    MatChipsModule,
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
  private readonly storage = inject(StorageService);
  private readonly data = inject(DataService);
  private readonly logger = inject(LoggerService);
  private readonly utilities = inject(UtilitiesService);
  protected readonly app = inject(ApplicationService);

  // State signals
  isLoading = signal(true);
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
  
  // Time since last check
  timeSinceLastCheck = computed(() => {
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
    // Data loading happens in the effect
  }

  ngOnDestroy(): void {
    // Update last check timestamp when leaving the page
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setLastSummaryCheck(pubkey, Date.now());
    }
  }

  async loadSummaryData(): Promise<void> {
    this.isLoading.set(true);
    
    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.isLoading.set(false);
        return;
      }

      // Get last check timestamp
      const lastCheck = this.accountLocalState.getLastSummaryCheck(pubkey);
      this.lastCheckTimestamp.set(lastCheck);

      // Calculate the timestamp in seconds for Nostr queries
      const sinceTimestamp = lastCheck ? Math.floor(lastCheck / 1000) : Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000); // Default to 7 days ago
      
      // Load all data in parallel
      await Promise.all([
        this.loadFavoritesProfiles(),
        this.loadTopRankedUsers(),
        this.loadActivitySummary(sinceTimestamp),
      ]);

    } catch (error) {
      this.logger.error('Failed to load summary data:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadFavoritesProfiles(): Promise<void> {
    const favPubkeys = this.favorites();
    if (favPubkeys.length === 0) {
      this.favoritesProfiles.set([]);
      return;
    }

    const profiles: NostrRecord[] = [];
    
    // Load profiles for each favorite (limit to 10 for performance)
    for (const pubkey of favPubkeys.slice(0, 10)) {
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
      const users = await this.algorithms.getRecommendedUsers(10);
      this.topRankedUsers.set(users);
    } catch (error) {
      this.logger.warn('Failed to load top ranked users:', error);
      this.topRankedUsers.set([]);
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
        return;
      }

      // Get events from storage since last check
      // Kind 1 = notes, Kind 30023 = articles, Kind 20 = media
      const [notes, articles, media, profiles] = await Promise.all([
        this.storage.getEventsByPubkeyAndKindSince(following, 1, sinceTimestamp),
        this.storage.getEventsByPubkeyAndKindSince(following, 30023, sinceTimestamp),
        this.storage.getEventsByPubkeyAndKindSince(following, 20, sinceTimestamp),
        this.storage.getEventsByPubkeyAndKindSince(following, 0, sinceTimestamp),
      ]);

      // Calculate activity summary
      this.activitySummary.set({
        notesCount: notes.length,
        articlesCount: articles.length,
        mediaCount: media.length,
        profileUpdates: [...new Set(profiles.map(p => p.pubkey))],
      });

      // Calculate top posters
      this.calculateTopPosters(notes, 'notes');
      this.calculateTopPosters(articles, 'articles');
      this.calculateTopPosters(media, 'media');

      // Load profiles for updated users
      await this.loadUpdatedProfiles(profiles);

    } catch (error) {
      this.logger.warn('Failed to load activity summary:', error);
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
      .slice(0, 5)
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
    const uniquePubkeys = [...new Set(profileEvents.map(p => p.pubkey))].slice(0, 10);
    
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
