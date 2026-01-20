import { Component, inject, signal, computed, effect, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatGridListModule } from '@angular/material/grid-list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ProfileStateService } from '../../../services/profile-state.service';
import { EventComponent } from '../../../components/event/event.component';
import { LayoutService } from '../../../services/layout.service';
import { LoggerService } from '../../../services/logger.service';

@Component({
  selector: 'app-profile-media',
  imports: [MatIconModule, MatGridListModule, MatProgressSpinnerModule, EventComponent],
  templateUrl: './profile-media.component.html',
  styleUrl: './profile-media.component.scss',
})
export class ProfileMediaComponent {
  private logger = inject(LoggerService);
  profileState = inject(ProfileStateService);
  layout = inject(LayoutService);

  error = signal<string | null>(null);

  // Cooldown to prevent rapid-fire relay loading
  private lastLoadTime = 0;
  private readonly LOAD_COOLDOWN_MS = 2000;

  // Flag to prevent re-entry during scroll handling
  private isHandlingScroll = false;

  // Get displayed media from profile state service (limited for performance)
  media = computed(() => this.profileState.displayedMedia());
  isLoadingMore = computed(() => this.profileState.isLoadingMoreMedia());
  hasMore = computed(() => this.profileState.hasMoreMedia());
  hasMoreToDisplay = computed(() => this.profileState.hasMoreMediaToDisplay());

  // Extract just events for navigation
  mediaEvents = computed(() => this.media().map(m => m.event));

  constructor() {
    if (!this.layout.isBrowser()) {
      return;
    }

    // Effect to handle scroll events from layout service when user scrolls to bottom
    // Continuously loads more content while user is at bottom for smooth infinite scroll
    // Dynamically uses the correct panel's scroll signal based on where profile is rendered
    effect(() => {
      // Only track scroll position signals - use untracked for other state reads
      const isInRightPanel = this.profileState.isInRightPanel();
      const isAtBottom = isInRightPanel
        ? this.layout.rightPanelScrolledToBottom()
        : this.layout.leftPanelScrolledToBottom();
      const isReady = isInRightPanel
        ? this.layout.rightPanelScrollReady()
        : this.layout.leftPanelScrollReady();

      // Only proceed if we're at the bottom and scroll monitoring is ready
      if (!isReady || !isAtBottom) {
        return;
      }

      // Prevent re-entry during scroll handling
      if (this.isHandlingScroll) {
        return;
      }

      // Use untracked to read state without creating dependencies
      untracked(() => {
        // If we have no content yet, skip (initial load will handle it)
        if (this.profileState.displayedMedia().length === 0) {
          return;
        }

        this.isHandlingScroll = true;

        try {
          // First priority: show more already-loaded items (instant, no cooldown needed)
          if (this.profileState.hasMoreMediaToDisplay()) {
            this.logger.debug('Increasing media display limit to show more cached items');
            this.profileState.increaseMediaDisplayLimit();

            // Schedule a scroll position recheck after DOM updates
            // Use a longer delay to allow rendering to complete
            setTimeout(() => {
              if (this.profileState.isInRightPanel()) {
                this.layout.refreshRightPanelScroll();
              } else {
                this.layout.refreshLeftPanelScroll();
              }
            }, 100);

            // Don't preload from relays while showing cached items - wait until exhausted
            this.isHandlingScroll = false;
            return;
          }

          // No more cached items - check if we should load from relays (with cooldown)
          const now = Date.now();
          if (now - this.lastLoadTime < this.LOAD_COOLDOWN_MS) {
            this.isHandlingScroll = false;
            return;
          }

          if (this.profileState.isLoadingMoreMedia()) {
            this.isHandlingScroll = false;
            return;
          }

          if (!this.profileState.hasMoreMedia()) {
            this.isHandlingScroll = false;
            return;
          }

          this.logger.debug('Loading more media content from relays...');
          this.lastLoadTime = now;
          this.loadMore();
        } finally {
          // Reset flag after a short delay to prevent rapid re-entry
          setTimeout(() => {
            this.isHandlingScroll = false;
          }, 100);
        }
      });
    });
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
