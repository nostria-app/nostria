import { Component, inject, signal, Input, OnChanges, SimpleChanges, effect } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { ProfileStateService } from '../../../services/profile-state.service';
import { MatCardModule } from '@angular/material/card';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BookmarkService } from '../../../services/bookmark.service';
import { MatButtonModule } from '@angular/material/button';
import { UtilitiesService } from '../../../services/utilities.service';
import { ArticleEventComponent } from '../../../components/event-types';
import { LayoutService } from '../../../services/layout.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-profile-reads',
  standalone: true,
  imports: [
    MatIconModule,
    MatCardModule,
    RouterModule,
    MatTooltipModule,
    MatButtonModule,
    ArticleEventComponent,
    MatProgressSpinnerModule
],
  templateUrl: './profile-reads.component.html',
  styleUrl: './profile-reads.component.scss',
})
export class ProfileReadsComponent implements OnChanges {
  @Input() isVisible = false;

  private route = inject(ActivatedRoute);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);
  profileState = inject(ProfileStateService);
  bookmark = inject(BookmarkService);
  utilities = inject(UtilitiesService);
  private layoutService = inject(LayoutService);

  isLoading = signal(true);
  error = signal<string | null>(null);

  constructor() {
    // Effect to load initial articles if none are present and profile is loaded
    effect(() => {
      const currentPubkey = this.profileState.pubkey();
      const currentArticles = this.profileState.articles();

      // If we have a pubkey but no articles, and we're not already loading, load some articles
      if (currentPubkey && currentArticles.length === 0 && !this.profileState.isLoadingMoreArticles()) {
        this.logger.debug('No articles found for profile, loading initial articles...');
        this.loadMoreArticles();
      }
    });

    // Initial load of reads
    this.loadReads();

    // Set up continuous scrolling effect
    effect(() => {
      // Only proceed if scroll monitoring is ready and user has scrolled to bottom
      if (
        this.layoutService.scrollMonitoringReady() &&
        this.layoutService.scrolledToBottom() &&
        !this.profileState.isLoadingMoreArticles() &&
        this.profileState.hasMoreArticles()
      ) {
        this.logger.debug('Scrolled to bottom, loading more articles...');
        this.loadMoreArticles();
      }
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Check if visibility changed to true
    if (
      changes['isVisible'] &&
      changes['isVisible'].currentValue === true &&
      (!changes['isVisible'].firstChange || changes['isVisible'].previousValue === false)
    ) {
      this.logger.debug('Profile reads tab became visible, reloading data');
      this.loadReads();
    }
  }

  // Get the pubkey from the parent route
  getPubkey(): string {
    return this.route.parent?.snapshot.paramMap.get('id') || '';
  }

  async loadReads(): Promise<void> {
    // Don't load if not visible (unless it's the initial load)
    // if (!this.isVisible && this.reads().length > 0) {
    //   return;
    // }
    // const pubkey = this.getPubkey();
    // if (!pubkey) {
    //   this.error.set('No pubkey provided');
    //   this.isLoading.set(false);
    //   return;
    // }
    // try {
    //   this.isLoading.set(true);
    //   this.error.set(null);
    //   // Mock data for now - would be replaced with actual fetch from NostrService
    //   await new Promise(resolve => setTimeout(resolve, 500));
    //   // Set empty array for now
    //   this.reads.set([]);
    //   this.logger.debug('Loaded reads for pubkey:', pubkey);
    // } catch (err) {
    //   this.logger.error('Error loading reads:', err);
    //   this.error.set('Failed to load reads');
    // } finally {
    //   this.isLoading.set(false);
    // }
  }

  /**
   * Load more articles (older articles)
   */
  async loadMoreArticles(): Promise<void> {
    if (this.profileState.isLoadingMoreArticles() || !this.profileState.hasMoreArticles()) {
      this.logger.debug('Already loading more articles or no more articles available, skipping');
      return;
    }

    this.logger.debug('Loading more articles for profile');

    try {
      const currentArticles = this.profileState.articles();
      const oldestTimestamp =
        currentArticles.length > 0
          ? Math.min(...currentArticles.map(a => a.event.created_at)) - 1
          : undefined;

      this.logger.debug(
        `Current articles count: ${currentArticles.length}, oldest timestamp: ${oldestTimestamp}`
      );

      // Load older articles from the profile state service
      const olderArticles = await this.profileState.loadMoreArticles(oldestTimestamp);

      this.logger.debug(`Loaded ${olderArticles.length} older articles`);

      if (olderArticles.length === 0) {
        this.logger.debug('No more articles available');
      }
    } catch (err) {
      this.logger.error('Failed to load more articles', err);
      this.error.set('Failed to load older articles. Please try again.');
    }
  }
}
