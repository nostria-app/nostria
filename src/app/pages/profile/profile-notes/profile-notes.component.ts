import { Component, effect, inject, signal, untracked } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { LoggerService } from '../../../services/logger.service';
import { PROFILE_STATE } from '../../../services/profile-state-factory.service';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BookmarkService } from '../../../services/bookmark.service';
import { MatButtonModule } from '@angular/material/button';
import { LayoutService } from '../../../services/layout.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { EventComponent } from '../../../components/event/event.component';
import { PinnedService } from '../../../services/pinned.service';
import { DatabaseService } from '../../../services/database.service';
import { NostrRecord } from '../../../interfaces';
import { DataService } from '../../../services/data.service';
import { UserRelayService } from '../../../services/relays/user-relay';

@Component({
  selector: 'app-profile-notes',
  imports: [
    EventComponent,
    MatIconModule,
    RouterModule,
    MatTooltipModule,
    MatButtonModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './profile-notes.component.html',
  styleUrl: './profile-notes.component.scss',
})
export class ProfileNotesComponent {
  private logger = inject(LoggerService);
  profileState = inject(PROFILE_STATE);
  bookmark = inject(BookmarkService);
  layout = inject(LayoutService);
  pinned = inject(PinnedService);
  database = inject(DatabaseService);
  data = inject(DataService);
  userRelay = inject(UserRelayService);

  error = signal<string | null>(null);
  pinnedNotes = signal<NostrRecord[]>([]);
  isLoadingPinned = signal<boolean>(false);
  isSearchingForPosts = signal<boolean>(false);

  // Cooldown to prevent rapid-fire relay loading
  private lastLoadTime = 0;
  private readonly LOAD_COOLDOWN_MS = 2000; // Increased to 2 seconds
  
  // Flag to prevent re-entry during scroll handling
  private isHandlingScroll = false;

  constructor() {
    if (!this.layout.isBrowser()) {
      return;
    }

    this.logger.info('[ProfileNotes] Component constructed, setting up effects...');
    this.logger.debug(`[ProfileNotes] Initial state: pubkey=${this.profileState.pubkey()}, notes=${this.profileState.notes().length}, displayedTimeline=${this.profileState.displayedTimeline().length}`);

    // Effect to load pinned notes when profile changes
    effect(async () => {
      const currentPubkey = this.profileState.pubkey();

      if (currentPubkey) {
        await this.loadPinnedNotes(currentPubkey);
      } else {
        this.pinnedNotes.set([]);
      }
    });

    // Effect to reload pinned notes when the pinned service updates
    effect(async () => {
      // React to changes in the pinned service's pinnedEvent signal
      const pinnedEvent = this.pinned.pinnedEvent();
      const currentPubkey = this.profileState.pubkey();

      // Only reload if we're on our own profile and the pubkey matches
      if (currentPubkey && pinnedEvent && pinnedEvent.pubkey === currentPubkey) {
        this.logger.info('Pinned event changed, reloading pinned notes');
        // Small delay to ensure the event is saved to storage
        setTimeout(async () => {
          await this.loadPinnedNotes(currentPubkey);
        }, 100);
      }
    });

    // Effect to load initial notes if none are present and profile is loaded
    // IMPORTANT: Wait for cachedEventsLoaded to be true before loading from relays
    // This ensures cached data is displayed first for instant feedback
    effect(() => {
      const currentPubkey = this.profileState.pubkey();
      const currentNotes = this.profileState.displayedTimeline();
      const cachedEventsLoaded = this.profileState.cachedEventsLoaded();

      this.logger.debug(`[ProfileNotes] Effect triggered: pubkey=${currentPubkey}, displayedTimeline=${currentNotes.length}, cachedLoaded=${cachedEventsLoaded}, notes=${this.profileState.notes().length}, replies=${this.profileState.replies().length}`);

      // Wait for cached events to be loaded first - this gives instant UI feedback
      if (!cachedEventsLoaded) {
        this.logger.debug('[ProfileNotes] Waiting for cached events to load...');
        return;
      }

      // Check if we have ANY timeline content loaded (not just filtered timeline)
      // This prevents loading from relays when we have cached content that's just filtered out
      const hasAnyTimelineContent = 
        this.profileState.notes().length > 0 || 
        this.profileState.replies().length > 0 || 
        this.profileState.reposts().length > 0 ||
        this.profileState.audio().length > 0 ||
        this.profileState.reactions().length > 0;

      this.logger.debug(`[ProfileNotes] Has any timeline content: ${hasAnyTimelineContent}`);

      // If we have a pubkey but NO content at all (not even filtered), and we're not already loading, load some notes
      if (currentPubkey && !hasAnyTimelineContent && currentNotes.length === 0 && !this.profileState.isLoadingMoreNotes()) {
        this.logger.debug('No notes found for profile after cache check, loading from relays...');
        this.loadMoreNotes();
      }
    });

    // Effect to auto-load more content when filtered view has insufficient items
    // This handles the case where user filters to "notes only" but most cached events are replies
    effect(() => {
      const hasInsufficientContent = this.profileState.hasInsufficientFilteredContent();
      const isLoading = this.profileState.isLoadingMoreNotes();
      const isInitiallyLoading = this.profileState.isInitiallyLoading();
      const cachedEventsLoaded = this.profileState.cachedEventsLoaded();

      // Wait for cached events to be loaded first
      if (!cachedEventsLoaded) {
        return;
      }

      // Only auto-load if we have insufficient filtered content and not already loading
      if (hasInsufficientContent && !isLoading && !isInitiallyLoading) {
        // Apply cooldown to prevent rapid-fire loading
        const now = Date.now();
        if (now - this.lastLoadTime < this.LOAD_COOLDOWN_MS) {
          return;
        }
        this.logger.debug('Insufficient filtered content, auto-loading more events...');
        this.lastLoadTime = now;
        this.loadMoreNotes();
      }
    });

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
        if (this.profileState.displayedTimeline().length === 0) {
          return;
        }

        this.isHandlingScroll = true;

        try {
          // First priority: show more already-loaded items (instant, no cooldown needed)
          if (this.profileState.hasMoreToDisplay()) {
            this.logger.debug('Increasing display limit to show more cached items');
            this.profileState.increaseDisplayLimit();

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

          if (this.profileState.isLoadingMoreNotes()) {
            this.isHandlingScroll = false;
            return;
          }

          if (!this.profileState.hasMoreNotes()) {
            this.isHandlingScroll = false;
            return;
          }

          this.logger.debug('Loading more timeline content from relays...');
          this.lastLoadTime = now;

          // Load more notes and schedule a scroll recheck after completion
          // This ensures continuous loading while user stays at bottom
          this.loadMoreNotes().then(() => {
            // After loading completes, schedule a scroll position recheck
            // This will trigger another load cycle if we're still at bottom and there's more content
            setTimeout(() => {
              if (this.profileState.isInRightPanel()) {
                this.layout.refreshRightPanelScroll();
              } else {
                this.layout.refreshLeftPanelScroll();
              }
            }, 150);
          });
        } finally {
          // Reset flag after a short delay to prevent rapid re-entry
          setTimeout(() => {
            this.isHandlingScroll = false;
          }, 100);
        }
      });
    });
  }

  /**
   * Load pinned notes for the current profile
   */
  async loadPinnedNotes(pubkey: string): Promise<void> {
    this.isLoadingPinned.set(true);
    try {
      const pinnedEventIds = await this.pinned.getPinnedNotesForUser(pubkey);
      this.logger.info(`Found ${pinnedEventIds.length} pinned notes for ${pubkey}`, pinnedEventIds);

      if (pinnedEventIds.length === 0) {
        this.pinnedNotes.set([]);
        this.isLoadingPinned.set(false);
        return;
      }

      // Fetch the actual events from storage
      this.logger.info('Fetching pinned events from storage:', pinnedEventIds);
      const eventPromises = pinnedEventIds.map(id => this.database.getEventById(id));
      const events = await Promise.all(eventPromises);

      this.logger.info('Retrieved events from storage:', events.filter(e => e !== null).length, 'of', pinnedEventIds.length);

      // For any events not found in storage, try to fetch from user relays
      const missingEventIds = pinnedEventIds.filter((id, index) => events[index] === null);
      if (missingEventIds.length > 0) {
        this.logger.info('Fetching missing events from user relays:', missingEventIds);
        const relayEventPromises = missingEventIds.map(id => this.userRelay.getEventById(pubkey, id));
        const relayEvents = await Promise.all(relayEventPromises);

        // Save found events to storage and merge with existing events
        for (let i = 0; i < relayEvents.length; i++) {
          const event = relayEvents[i];
          if (event) {
            await this.database.saveEvent(event);
            // Replace the null entry with the found event
            const originalIndex = pinnedEventIds.indexOf(missingEventIds[i]);
            events[originalIndex] = event;
          }
        }

        this.logger.info('After relay fetch, have', events.filter(e => e !== null).length, 'events');
      }

      // Filter out nulls and convert to records
      const validEvents = events.filter(e => e !== null);

      if (validEvents.length === 0) {
        this.logger.warn('No valid events found for pinned notes');
        this.pinnedNotes.set([]);
        this.isLoadingPinned.set(false);
        return;
      }

      const records = this.data.toRecords(validEvents);

      // Sort them in the order from pinnedEventIds (most recent first)
      const sortedRecords = pinnedEventIds
        .map(id => records.find(r => r.event.id === id))
        .filter(r => r !== undefined) as NostrRecord[];

      this.pinnedNotes.set(sortedRecords);
      this.logger.debug(`Loaded ${sortedRecords.length} pinned note records`);
    } catch (err) {
      this.logger.error('Failed to load pinned notes', err);
    } finally {
      this.isLoadingPinned.set(false);
    }
  }

  /**
   * Load more notes (older notes)
   */
  async loadMoreNotes(): Promise<void> {
    if (this.profileState.isLoadingMoreNotes() || !this.profileState.hasMoreNotes()) {
      this.logger.debug('Already loading more notes or no more notes available, skipping');
      return;
    }

    this.logger.debug('Loading more timeline content for profile');

    try {
      // Load older notes from the profile state service
      // The service tracks the oldest relay timestamp internally for proper pagination
      const olderNotes = await this.profileState.loadMoreNotes();

      this.logger.debug(`Loaded ${olderNotes.length} older timeline items`);

      if (olderNotes.length === 0) {
        this.logger.debug('No more timeline content available');
      }
    } catch (err) {
      this.logger.error('Failed to load more timeline content', err);
      this.error.set('Failed to load older timeline content. Please try again.');
    }
  }

  /**
   * Show replies by enabling the replies filter.
   * Called when user clicks "Show replies" in the hidden-replies state.
   */
  showReplies(): void {
    this.logger.info('User requested to show replies');
    this.profileState.updateTimelineFilter({ showReplies: true });
  }

  /**
   * Search for more posts by loading additional pages from relays.
   * Called when user clicks "Search for more posts" in the hidden-replies state.
   * This keeps loading batches until we find at least one original post or run out of events.
   */
  async loadMoreToFindPosts(): Promise<void> {
    if (this.isSearchingForPosts() || !this.profileState.hasMoreNotes()) {
      return;
    }

    this.isSearchingForPosts.set(true);
    this.logger.info('Searching for original posts by loading more events...');

    const MAX_ATTEMPTS = 5; // Limit attempts to avoid infinite loading
    let attempts = 0;

    try {
      while (attempts < MAX_ATTEMPTS && this.profileState.hasMoreNotes()) {
        attempts++;
        this.logger.debug(`Search attempt ${attempts}/${MAX_ATTEMPTS}`);

        await this.profileState.loadMoreNotes();

        // Check if we found any original posts now
        const filteredTimeline = this.profileState.sortedTimeline();
        if (filteredTimeline.length > 0) {
          this.logger.info(`Found ${filteredTimeline.length} posts after ${attempts} attempts`);
          break;
        }

        // Small delay between attempts to avoid hammering relays
        if (this.profileState.hasMoreNotes() && attempts < MAX_ATTEMPTS) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      if (this.profileState.sortedTimeline().length === 0) {
        this.logger.info(`No original posts found after ${attempts} attempts`);
      }
    } catch (err) {
      this.logger.error('Error while searching for posts', err);
      this.error.set('Failed to search for posts. Please try again.');
    } finally {
      this.isSearchingForPosts.set(false);
    }
  }
}
