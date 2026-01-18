import { Component, effect, inject, signal } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { LoggerService } from '../../../services/logger.service';
import { ProfileStateService } from '../../../services/profile-state.service';
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
  profileState = inject(ProfileStateService);
  bookmark = inject(BookmarkService);
  layout = inject(LayoutService);
  pinned = inject(PinnedService);
  database = inject(DatabaseService);
  data = inject(DataService);
  userRelay = inject(UserRelayService);

  error = signal<string | null>(null);
  pinnedNotes = signal<NostrRecord[]>([]);
  isLoadingPinned = signal<boolean>(false);

  // Cooldown to prevent rapid-fire relay loading
  private lastLoadTime = 0;
  private readonly LOAD_COOLDOWN_MS = 1000;

  constructor() {
    if (!this.layout.isBrowser()) {
      return;
    }

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
    effect(() => {
      const currentPubkey = this.profileState.pubkey();
      const currentNotes = this.profileState.displayedTimeline();

      // If we have a pubkey but no notes, and we're not already loading, load some notes
      if (currentPubkey && currentNotes.length === 0 && !this.profileState.isLoadingMoreNotes()) {
        this.logger.debug('No notes found for profile, loading initial notes...');
        this.loadMoreNotes();
      }
    });

    // Effect to auto-load more content when filtered view has insufficient items
    // This handles the case where user filters to "notes only" but most cached events are replies
    effect(() => {
      const hasInsufficientContent = this.profileState.hasInsufficientFilteredContent();
      const isLoading = this.profileState.isLoadingMoreNotes();
      const isInitiallyLoading = this.profileState.isInitiallyLoading();

      // Only auto-load if we have insufficient filtered content and not already loading
      if (hasInsufficientContent && !isLoading && !isInitiallyLoading) {
        this.logger.debug('Insufficient filtered content, auto-loading more events...');
        this.loadMoreNotes();
      }
    });

    // Effect to handle scroll events from layout service when user scrolls to bottom
    // Continuously loads more content while user is at bottom for smooth infinite scroll
    // Uses leftPanelScrolledToBottom since profile pages render in the left panel
    effect(() => {
      const isAtBottom = this.layout.leftPanelScrolledToBottom();
      const isReady = this.layout.leftPanelScrollReady();

      // Only proceed if we're at the bottom and scroll monitoring is ready
      if (!isReady || !isAtBottom) {
        return;
      }

      // If we have no content yet, skip (initial load will handle it)
      if (this.profileState.displayedTimeline().length === 0) {
        return;
      }

      // First priority: show more already-loaded items (instant, no cooldown needed)
      if (this.profileState.hasMoreToDisplay()) {
        this.logger.debug('Increasing display limit to show more cached items');
        this.profileState.increaseDisplayLimit();

        // After DOM updates, recheck scroll position to continue loading if still at bottom
        setTimeout(() => this.layout.refreshLeftPanelScroll(), 50);

        // Also check if we should preload more from relays (with cooldown)
        const now = Date.now();
        if (this.profileState.shouldLoadMoreFromRelay() && 
            !this.profileState.isLoadingMoreNotes() &&
            now - this.lastLoadTime >= this.LOAD_COOLDOWN_MS) {
          this.logger.debug('Preloading more items from relays');
          this.lastLoadTime = now;
          this.loadMoreNotes();
        }
        return;
      }

      // No more cached items - need to load from relays (with cooldown)
      const now = Date.now();
      if (now - this.lastLoadTime < this.LOAD_COOLDOWN_MS) {
        return;
      }

      if (this.profileState.isLoadingMoreNotes()) {
        return;
      }

      if (!this.profileState.hasMoreNotes()) {
        return;
      }

      this.logger.debug('Loading more timeline content from relays...');
      this.lastLoadTime = now;
      this.loadMoreNotes();
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
}
