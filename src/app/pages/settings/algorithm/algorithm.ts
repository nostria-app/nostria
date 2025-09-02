import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { MatTabsModule } from '@angular/material/tabs';
import { Metrics } from '../../../services/metrics';
import { Algorithms } from '../../../services/algorithms';
import { UserMetric } from '../../../interfaces/metrics';
import { UtilitiesService } from '../../../services/utilities.service';
import { ConfirmDialogComponent } from '../../../components/confirm-dialog/confirm-dialog.component';
import { RouterModule } from '@angular/router';
import { FavoritesService } from '../../../services/favorites.service';

@Component({
  selector: 'app-algorithm',
  standalone: true,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatTableModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatDialogModule,
    MatSlideToggleModule,
    MatDividerModule,
    MatMenuModule,
    MatTabsModule,
    RouterModule,
  ],
  templateUrl: './algorithm.html',
  styleUrl: './algorithm.scss',
})
export class AlgorithmComponent implements OnInit {
  private readonly metrics = inject(Metrics);
  private readonly algorithms = inject(Algorithms);
  private readonly utilities = inject(UtilitiesService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly favoritesService = inject(FavoritesService);

  // Data signals
  allMetrics = signal<UserMetric[]>([]);
  topEngagedUsers = signal<UserMetric[]>([]);
  recentlyViewed = signal<UserMetric[]>([]);
  decliningUsers = signal<UserMetric[]>([]);

  // UI state signals
  isLoading = signal(false);
  selectedTabIndex = signal(0);

  // Computed signal for template access to favorites
  favoriteUsers = computed(() => this.favoritesService.favorites());

  // Table columns
  displayedColumns = [
    'position',
    'pubkey',
    'name',
    'engagementScore',
    'viewed',
    'liked',
    'timeSpent',
    'actions',
  ];

  // Algorithm stats
  algorithmStats = computed(() => {
    const metrics = this.allMetrics();
    const favorites = this.favoritesService.favorites();

    return {
      totalUsers: metrics.length,
      favoriteUsers: favorites.length,
      activeUsers: metrics.filter((m) => m.lastInteraction > Date.now() - 7 * 24 * 60 * 60 * 1000)
        .length,
      averageEngagement:
        metrics.length > 0
          ? Math.round(
              (metrics.reduce((sum, m) => sum + (m.engagementScore || 0), 0) / metrics.length) *
                100,
            ) / 100
          : 0,
    };
  });

  async ngOnInit() {
    await this.loadData();
  }

  async loadData() {
    this.isLoading.set(true);

    try {
      // Load all metrics
      const metrics = await this.metrics.getMetrics();
      this.allMetrics.set(metrics);

      // Load top engaged users
      const topEngaged = await this.algorithms.getRecommendedUsers(50);
      this.topEngagedUsers.set(topEngaged);

      // Load recently viewed users
      const recentlyViewed = await this.metrics.queryMetrics({
        sortBy: 'lastInteraction',
        sortOrder: 'desc',
        limit: 20,
      });
      this.recentlyViewed.set(recentlyViewed);

      // Load declining users
      const declining = await this.algorithms.getDeclineingEngagementUsers(20);
      this.decliningUsers.set(declining);

      // Favorites are handled by the service automatically
    } catch (error) {
      console.error('Error loading algorithm data:', error);
      this.snackBar.open('Failed to load algorithm data', 'Close', {
        duration: 3000,
      });
    } finally {
      this.isLoading.set(false);
    }
  }

  async resetUserMetrics(pubkey: string) {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Reset User Metrics',
        message: `Are you sure you want to reset all metrics for this user? This action cannot be undone.`,
        confirmText: 'Reset',
        cancelText: 'Cancel',
      },
    });

    const result = await dialogRef.afterClosed().toPromise();
    if (result) {
      try {
        await this.metrics.resetUserMetrics(pubkey);
        this.snackBar.open('User metrics reset successfully', 'Close', {
          duration: 3000,
        });
        await this.loadData();
      } catch (error) {
        console.error('Error resetting user metrics:', error);
        this.snackBar.open('Failed to reset user metrics', 'Close', {
          duration: 3000,
        });
      }
    }
  }

  async resetAllMetrics() {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Reset All Metrics',
        message: `Are you sure you want to reset ALL user metrics? This will permanently delete all engagement data and cannot be undone.`,
        confirmText: 'Reset All',
        cancelText: 'Cancel',
      },
    });

    const result = await dialogRef.afterClosed().toPromise();
    if (result) {
      try {
        await this.metrics.resetAllMetrics();
        this.snackBar.open('All metrics reset successfully', 'Close', {
          duration: 3000,
        });
        await this.loadData();
      } catch (error) {
        console.error('Error resetting all metrics:', error);
        this.snackBar.open('Failed to reset all metrics', 'Close', {
          duration: 3000,
        });
      }
    }
  }

  toggleFavorite(pubkey: string) {
    const success = this.favoritesService.toggleFavorite(pubkey);
    if (success) {
      const isFavorite = this.favoritesService.isFavorite(pubkey);
      if (isFavorite) {
        this.snackBar.open('Added to favorites', 'Close', { duration: 2000 });
      } else {
        this.snackBar.open('Removed from favorites', 'Close', {
          duration: 2000,
        });
      }
    }
  }

  isFavorite(pubkey: string): boolean {
    return this.favoritesService.isFavorite(pubkey);
  }

  getTruncatedPubkey(pubkey: string): string {
    try {
      return this.utilities.getTruncatedNpub(pubkey);
    } catch (error) {
      console.warn('Invalid pubkey format:', pubkey, error);
      // Return a truncated version of the raw pubkey as fallback
      if (pubkey && pubkey.length > 16) {
        return `${pubkey.substring(0, 8)}...${pubkey.substring(pubkey.length - 8)}`;
      }
      return pubkey || 'Invalid pubkey';
    }
  }

  getDisplayName(pubkey: string): string {
    // Remove debugger statement and validate pubkey first
    if (!this.utilities.isValidPubkey(pubkey)) {
      console.warn('Invalid pubkey in getDisplayName:', pubkey);
      return this.getTruncatedPubkey(pubkey);
    }

    // In a real app, you'd look up the user's display name from metadata
    return this.getTruncatedPubkey(pubkey);
  }

  formatTimeSpent(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h`;
  }

  formatLastInteraction(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  getEngagementColor(score: number): string {
    if (score >= 100) return 'primary';
    if (score >= 50) return 'accent';
    if (score >= 20) return 'warn';
    return '';
  }

  async refreshData() {
    await this.loadData();
    this.snackBar.open('Data refreshed', 'Close', { duration: 2000 });
  }
}
