import {
  Component,
  effect,
  inject,
  signal,
  TransferState,
  untracked,
  computed,
  input,
} from '@angular/core';
import { LayoutService } from '../../services/layout.service';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { DataService } from '../../services/data.service';
import { Event, nip19 } from 'nostr-tools';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { UrlUpdateService } from '../../services/url-update.service';
import { EventComponent } from '../../components/event/event.component';
import { UtilitiesService } from '../../services/utilities.service';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApplicationService } from '../../services/application.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { EVENT_STATE_KEY, EventData } from '../../data-resolver';
import { EventService, Reaction, ThreadData, ThreadedEvent } from '../../services/event';
import { Title } from '@angular/platform-browser';
import { LocalSettingsService } from '../../services/local-settings.service';
import { RightPanelService } from '../../services/right-panel.service';
import { NoteEditorDialogComponent } from '../../components/note-editor-dialog/note-editor-dialog.component';

/** Description of the EventPageComponent
 *
 * Events and threads for events are retrieved from the OP's relays.
 * Nostr clients should ensure they post replies and reactions to the OP's relays.
 */

// export interface Reaction {
//   emoji: string;
//   count: number;
// }

// export interface ThreadedEvent {
//   event: Event;
//   replies: ThreadedEvent[];
//   level: number;
//   hasMoreReplies?: boolean;
//   deepestReplyId?: string;
// }

@Component({
  selector: 'app-event-page',
  imports: [CommonModule, EventComponent, MatIconModule, MatButtonModule, MatProgressSpinnerModule, MatTooltipModule, NoteEditorDialogComponent],
  templateUrl: './event.component.html',
  styleUrl: './event.component.scss',
  host: {
    '[class.dialog-mode]': 'isInDialogMode()'
  }
})
export class EventPageComponent {
  // Input for dialog mode - when provided, uses this instead of route params
  dialogEventId = input<string | undefined>(undefined);
  dialogEvent = input<Event | undefined>(undefined);
  // Optional: pubkey of a trusted user who shared this (for blur bypass on main event)
  trustedByPubkey = input<string | undefined>(undefined);

  // Computed to check if we're in dialog mode
  isInDialogMode = computed(() => !!this.dialogEventId());

  event = signal<Event | undefined>(undefined);
  private readonly utilities = inject(UtilitiesService);
  isLoading = signal(false);
  isLoadingParents = signal(false);
  isLoadingReplies = signal(false);
  error = signal<string | null>(null);
  layout = inject(LayoutService);
  nostrService = inject(NostrService);
  logger = inject(LoggerService);
  data = inject(DataService);
  url = inject(UrlUpdateService);
  eventService = inject(EventService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private rightPanel = inject(RightPanelService);
  id = signal<string | null>(null);
  userRelays: string[] = [];
  app = inject(ApplicationService);
  private routeParams = toSignal<ParamMap>(this.route.paramMap);
  replies = signal<Event[]>([]);
  threadedReplies = signal<ThreadedEvent[]>([]);

  // Track collapsed thread IDs
  collapsedThreads = signal<Set<string>>(new Set());

  /**
   * Toggle the collapsed state of a thread
   */
  toggleThreadCollapse(eventId: string): void {
    this.collapsedThreads.update(set => {
      const newSet = new Set(set);
      if (newSet.has(eventId)) {
        newSet.delete(eventId);
      } else {
        newSet.add(eventId);
      }
      return newSet;
    });
  }

  /**
   * Check if a thread is collapsed
   */
  isThreadCollapsed(eventId: string): boolean {
    return this.collapsedThreads().has(eventId);
  }

  /**
   * Count total replies (including nested) for a threaded event
   */
  countReplies(threadedEvent: ThreadedEvent): number {
    let count = threadedEvent.replies.length;
    for (const reply of threadedEvent.replies) {
      count += this.countReplies(reply);
    }
    return count;
  }

  /**
   * Navigate back - either close right panel or go to browser history
   */
  goBack(): void {
    if (this.rightPanel.canGoBack()) {
      this.rightPanel.goBack();
    } else {
      this.location.back();
    }
  }

  transferState = inject(TransferState);
  parentEvents = signal<Event[]>([]);
  threadData = signal<ThreadData | null>(null);
  private titleService = inject(Title);
  localSettings = inject(LocalSettingsService);

  item!: EventData;
  reactions = signal<Reaction[]>([]);

  // Computed signal to track if anything is still loading
  isAnyLoading = computed(
    () => this.isLoading() || this.isLoadingParents() || this.isLoadingReplies()
  );

  showCompletionStatus = signal(false);
  deepResolutionProgress = signal<string>('');

  // Track if the event has been deleted (NIP-09)
  isDeleted = signal(false);
  deletionReason = signal<string | null>(null);

  constructor() {
    // this.item = this.route.snapshot.data['data'];
    console.log('EventPageComponent initialized with data:', this.item);

    if (this.transferState.hasKey(EVENT_STATE_KEY)) {
      const data = this.transferState.get<EventData | null>(EVENT_STATE_KEY, null);
      console.log('Transferred data:', data);
      if (data) {
        this.item = data;
      }
      this.transferState.remove(EVENT_STATE_KEY); // optional cleanup
    }

    // Check for router navigation state
    const navigation = this.router.currentNavigation();
    if (navigation?.extras.state?.['event']) {
      console.log('Router state event data:', navigation.extras.state['event']);
      this.event.set(navigation.extras.state['event'] as Event);
    }

    // Effect to load event when in dialog mode with direct event ID input
    effect(() => {
      const dialogEventId = this.dialogEventId();
      const dialogEvent = this.dialogEvent();

      if (dialogEventId) {
        untracked(async () => {
          // Set the event if provided
          if (dialogEvent) {
            this.event.set(dialogEvent);
          }
          await this.loadEvent(dialogEventId);
        });
      }
    });

    // Effect to load event when route parameter changes (normal routing mode)
    effect(() => {
      if (this.app.initialized() && this.routeParams() && !this.dialogEventId()) {
        untracked(async () => {
          const id = this.routeParams()?.get('id');
          if (id) {
            await this.loadEvent(id);

            // Scroll to top when navigating to a new event
            setTimeout(() => this.layout.scrollMainContentToTop(), 100);
          }
        });
      }
    });

    // Effect to update document title with loading indicator
    effect(() => {
      const isLoading = this.isAnyLoading();
      const event = this.event();

      if (event) {
        const baseTitle = `Note by ${event.pubkey.slice(0, 8)}... - Nostria`;
        this.titleService.setTitle(isLoading ? `⏳ ${baseTitle}` : baseTitle);
      } else if (isLoading) {
        this.titleService.setTitle('⏳ Loading... - Nostria');
      }
    });

    // Effect to scroll to main event when parent events are loaded
    effect(() => {
      const isLoadingParents = this.isLoadingParents();
      const parentEvents = this.parentEvents();
      const event = this.event();

      // If parent events have finished loading and we have parent events and a main event
      if (!isLoadingParents && parentEvents.length > 0 && event) {
        // Use requestAnimationFrame and multiple retries to ensure DOM is fully rendered
        this.scrollToMainEventWithRetry();
      }
    });
  }

  async loadEvent(nevent: string) {
    // this.logger.info('loadEvent called with nevent:', nevent);

    try {
      this.isLoading.set(true);
      this.isLoadingParents.set(true);
      this.isLoadingReplies.set(true);
      this.error.set(null);
      this.showCompletionStatus.set(false);
      this.deepResolutionProgress.set('');

      // Reset state
      this.parentEvents.set([]);
      this.replies.set([]);
      this.threadedReplies.set([]);
      this.reactions.set([]);
      this.isDeleted.set(false);
      this.deletionReason.set(null);

      // Use progressive loading to show content as it becomes available
      const progressiveLoader = this.eventService.loadThreadProgressively(nevent, this.item);
      let mainEvent: Event | undefined;

      for await (const partialData of progressiveLoader) {
        // Update signals with partial data as it becomes available
        if (partialData.event) {
          mainEvent = partialData.event;
          this.event.set(partialData.event);
          const hex = partialData.event.id;
          this.id.set(hex);

          // Update URL with proper encoding (naddr for addressable events, nevent for others)
          const encoded = this.utilities.encodeEventForUrl(partialData.event);

          // Always use /e/ route for event page (articles use /a/ route separately)
          this.url.updatePathSilently(['/e', encoded]);

          // Hide main loading spinner once we have the main event
          this.isLoading.set(false);

          // Check for deletion request for the main event (NIP-09)
          // This runs asynchronously so it doesn't block the UI
          this.checkDeletionRequestForEvent(partialData.event);
        }

        if (partialData.parents !== undefined) {
          this.parentEvents.set(partialData.parents);
          this.isLoadingParents.set(false);
        }

        if (partialData.replies !== undefined) {
          this.replies.set(partialData.replies);
        }

        if (partialData.threadedReplies !== undefined) {
          this.threadedReplies.set(partialData.threadedReplies);
          // Only mark as not loading if we actually have replies OR if this is the final update
          // This prevents showing "No replies yet" during progressive loading
          if (partialData.threadedReplies.length > 0) {
            this.isLoadingReplies.set(false);
          }

          // If openThreadsExpanded is false, collapse top-level replies by default
          if (!this.localSettings.openThreadsExpanded() && partialData.threadedReplies.length > 0) {
            const collapsedIds = new Set<string>();
            for (const reply of partialData.threadedReplies) {
              if (reply.replies.length > 0) {
                collapsedIds.add(reply.event.id);
              }
            }
            this.collapsedThreads.set(collapsedIds);
          }
        }

        if (partialData.reactions !== undefined) {
          this.reactions.set(partialData.reactions);
        }

        // Update threadData with current state
        this.threadData.set({
          event: partialData.event!,
          replies: partialData.replies || [],
          threadedReplies: partialData.threadedReplies || [],
          reactions: partialData.reactions || [],
          parents: partialData.parents || [],
          isThreadRoot: partialData.isThreadRoot || false,
          rootEvent: partialData.rootEvent || null,
        });
      }

      this.logger.info('Successfully completed progressive loading for event:', this.id());
    } catch (error) {
      this.logger.error('Error loading event:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load event';

      // If event not found, check if it was deleted (NIP-09)
      if (errorMessage === 'Event not found') {
        await this.checkIfEventWasDeleted(nevent);
      } else {
        this.error.set(errorMessage);
      }
    } finally {
      // Ensure all loading states are cleared
      this.isLoading.set(false);
      this.isLoadingParents.set(false);
      this.isLoadingReplies.set(false);

      // Show completion status briefly
      if (this.event()) {
        this.showCompletionStatus.set(true);
        setTimeout(() => this.showCompletionStatus.set(false), 3000);
      }

      // Scroll to top after loading
      setTimeout(() => this.layout.scrollMainContentToTop(), 100);
    }
  }

  /**
   * Scrolls to the main event after thread context has been loaded
   * The CSS scroll-margin-top on #main-event handles the toolbar offset
   */
  private scrollToMainEvent(): void {
    const mainEventElement = document.getElementById('main-event');
    if (mainEventElement) {
      mainEventElement.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
        inline: 'nearest',
      });
    }
  }

  /**
   * Scrolls to the main event with retry logic to handle async content loading
   * Retries multiple times with increasing delays to ensure DOM is fully rendered
   * The CSS scroll-margin-top on #main-event handles the toolbar offset
   */
  private scrollToMainEventWithRetry(attempt = 0, maxAttempts = 5): void {
    const mainEventElement = document.getElementById('main-event');

    if (mainEventElement) {
      // Wait for next animation frame to ensure rendering is complete
      requestAnimationFrame(() => {
        // Additional timeout to ensure all content (including images) has loaded
        setTimeout(() => {
          const mainEventElement = document.getElementById('main-event');
          if (mainEventElement) {
            mainEventElement.scrollIntoView({
              behavior: attempt === 0 ? 'auto' : 'smooth',
              block: 'start',
              inline: 'nearest',
            });
          }
        }, 250);
      });
    } else if (attempt < maxAttempts) {
      // Element not found yet, retry with exponential backoff
      const delay = Math.min(200 * Math.pow(1.5, attempt), 1000); // Max 1 second
      setTimeout(() => {
        this.scrollToMainEventWithRetry(attempt + 1, maxAttempts);
      }, delay);
    }
  }

  async startDeepResolution() {
    const nevent = this.dialogEventId() || this.routeParams()?.get('id');
    if (!nevent) return;

    this.isLoading.set(true);
    this.error.set(null);
    this.deepResolutionProgress.set('Starting deep resolution...');

    try {
      // Decode to get hex ID
      let hex = nevent;
      if (!this.utilities.isHex(nevent)) {
        const decoded = this.utilities.decode(nevent);
        if (decoded.type === 'note') {
          hex = decoded.data;
        } else if (decoded.type === 'nevent') {
          hex = decoded.data.id;
        } else if (decoded.type === 'naddr') {
          // Addressable events might need different handling, but let's assume we can't deep resolve them by ID easily without kind/pubkey
          // But loadEventWithDeepResolution takes a string, presumably hex ID.
          // If it's naddr, we might not have a single hex ID to search for unless we know the event ID.
          // But loadEvent handles naddr separately.
          // If we are here, loadEvent failed.
          this.error.set('Cannot perform deep resolution on this event type');
          this.isLoading.set(false);
          return;
        }
      }

      const event = await this.eventService.loadEventWithDeepResolution(hex, (current, total, relays) => {
        this.deepResolutionProgress.set(`Scanning batch ${current}/${total} (${relays.length} relays)...`);
      });

      if (event) {
        this.deepResolutionProgress.set('Event found! Loading thread...');
        // Update item so loadEvent picks it up
        if (!this.item) {
          this.item = { title: '', description: '' };
        }
        this.item.event = event;

        // Restart loading
        await this.loadEvent(nevent);
      } else {
        this.error.set('Event not found');
        this.deepResolutionProgress.set('');
        this.isLoading.set(false);
      }
    } catch (err) {
      this.logger.error('Deep resolution error:', err);
      this.error.set('Deep resolution failed');
      this.isLoading.set(false);
    }
  }

  /**
   * Check if the main event has a deletion request (NIP-09)
   * If found, delete from local database and show deleted state
   */
  private async checkDeletionRequestForEvent(event: Event): Promise<void> {
    try {
      const deletionEvent = await this.eventService.checkDeletionRequest(event);

      if (deletionEvent) {
        this.logger.info('Event has been deleted by author:', {
          eventId: event.id,
          deletionEventId: deletionEvent.id,
          reason: deletionEvent.content || '(no reason given)',
        });

        // Delete from local database
        await this.eventService.deleteEventFromLocalStorage(event.id);

        // Update UI state
        this.isDeleted.set(true);
        this.deletionReason.set(deletionEvent.content || null);
        this.event.set(undefined);
        this.error.set('This event has been deleted by its author');
      }
    } catch (error) {
      this.logger.error('Error checking deletion request:', error);
      // Don't block the UI if deletion check fails
    }
  }

  /**
   * Check if an event was deleted when it cannot be found (NIP-09)
   * This extracts the event ID from the nevent/note and queries for deletion requests
   */
  private async checkIfEventWasDeleted(nevent: string): Promise<void> {
    try {
      // Extract the event ID from the nevent/note
      let eventId: string | null = null;

      if (this.utilities.isHex(nevent)) {
        eventId = nevent;
      } else {
        const decoded = this.utilities.decode(nevent);
        if (decoded.type === 'note') {
          eventId = decoded.data;
        } else if (decoded.type === 'nevent') {
          eventId = decoded.data.id;
        }
      }

      if (!eventId) {
        this.error.set('Event not found');
        return;
      }

      this.logger.info('Checking if event was deleted:', eventId);

      // Query for deletion request
      const deletionEvent = await this.eventService.checkDeletionRequestById(eventId);

      if (deletionEvent) {
        this.logger.info('Event was deleted:', {
          eventId,
          deletionEventId: deletionEvent.id,
          reason: deletionEvent.content || '(no reason given)',
        });

        // Update UI state to show deletion
        this.isDeleted.set(true);
        this.deletionReason.set(deletionEvent.content || null);
        this.error.set('This event has been deleted by its author');
      } else {
        // No deletion found, show regular "Event not found" message
        this.error.set('Event not found');
      }
    } catch (error) {
      this.logger.error('Error checking if event was deleted:', error);
      this.error.set('Event not found');
    }
  }
}
