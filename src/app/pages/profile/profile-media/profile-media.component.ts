import { Component, inject, signal, computed, effect, untracked, AfterViewInit } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatGridListModule } from '@angular/material/grid-list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ProfileStateService } from '../../../services/profile-state.service';
import { EventComponent } from '../../../components/event/event.component';

@Component({
  selector: 'app-profile-media',
  imports: [MatIconModule, MatGridListModule, MatProgressSpinnerModule, EventComponent],
  templateUrl: './profile-media.component.html',
  styleUrl: './profile-media.component.scss',
  host: {
    '(window:scroll)': 'onScroll()',
  },
})
export class ProfileMediaComponent implements AfterViewInit {
  profileState = inject(ProfileStateService);

  error = signal<string | null>(null);
  private isInitialized = signal<boolean>(false);

  // Get media from profile state service
  media = computed(() => this.profileState.sortedMedia());
  isLoadingMore = computed(() => this.profileState.isLoadingMoreMedia());
  hasMore = computed(() => this.profileState.hasMoreMedia());

  // Extract just events for navigation
  mediaEvents = computed(() => this.media().map(m => m.event));

  constructor() {
    // Watch for media changes to check if we need to load more to fill viewport
    effect(() => {
      const mediaCount = this.media().length;
      const initialized = this.isInitialized();
      const isLoading = this.isLoadingMore();
      const hasMoreContent = this.hasMore();

      untracked(() => {
        if (initialized && !isLoading && hasMoreContent && mediaCount > 0) {
          // Small delay to ensure DOM is updated
          setTimeout(() => this.checkAndLoadMore(), 100);
        }
      });
    });
  }

  ngAfterViewInit() {
    // Mark as initialized and check if we need to load more content
    setTimeout(() => {
      this.isInitialized.set(true);
      this.checkAndLoadMore();
    }, 500);
  }

  private checkAndLoadMore() {
    // Check if content doesn't fill the viewport
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = document.documentElement.clientHeight;

    if (scrollHeight <= clientHeight + 100 && !this.isLoadingMore() && this.hasMore()) {
      console.log('Content does not fill viewport, loading more media...');
      this.loadMore();
    }
  }

  onScroll() {
    // Check if we're near the bottom of the page
    const scrollPosition = window.innerHeight + window.scrollY;
    const threshold = document.documentElement.scrollHeight - 800;

    if (scrollPosition >= threshold && !this.isLoadingMore() && this.hasMore()) {
      this.loadMore();
    }
  }

  async loadMore() {
    if (this.isLoadingMore() || !this.hasMore()) {
      return;
    }

    try {
      await this.profileState.loadMoreMedia();
    } catch (error) {
      console.error('Failed to load more media:', error);
      this.error.set('Failed to load more media. Please try again.');
    }
  }
}
