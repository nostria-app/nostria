import { Component, inject, signal, computed } from '@angular/core';
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
export class ProfileMediaComponent {
  private profileState = inject(ProfileStateService);

  error = signal<string | null>(null);

  // Get media from profile state service
  media = computed(() => this.profileState.sortedMedia());
  isLoadingMore = computed(() => this.profileState.isLoadingMoreMedia());
  hasMore = computed(() => this.profileState.hasMoreMedia());

  onScroll() {
    // Check if we're near the bottom of the page
    const scrollPosition = window.innerHeight + window.scrollY;
    const threshold = document.documentElement.scrollHeight - 500;

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
