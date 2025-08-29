import {
  Component,
  effect,
  inject,
  signal,
  TransferState,
  untracked,
  computed,
} from '@angular/core';
import { LayoutService } from '../../services/layout.service';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { DataService } from '../../services/data.service';
import { Event, nip19 } from 'nostr-tools';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { UrlUpdateService } from '../../services/url-update.service';
import { EventComponent } from '../../components/event/event.component';
import { UtilitiesService } from '../../services/utilities.service';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApplicationService } from '../../services/application.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { EVENT_STATE_KEY, EventData } from '../../data-resolver';
import { EventService, Reaction, ThreadData, ThreadedEvent } from '../../services/event';
import { Title } from '@angular/platform-browser';

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
  standalone: true,
  imports: [CommonModule, EventComponent, MatIconModule, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './event.component.html',
  styleUrl: './event.component.scss',
})
export class EventPageComponent {
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
  id = signal<string | null>(null);
  userRelays: string[] = [];
  app = inject(ApplicationService);
  private routeParams = toSignal<ParamMap>(this.route.paramMap);
  replies = signal<Event[]>([]);
  threadedReplies = signal<ThreadedEvent[]>([]);
  transferState = inject(TransferState);
  parentEvents = signal<Event[]>([]);
  threadData = signal<ThreadData | null>(null);
  private titleService = inject(Title);

  item!: EventData;
  reactions = signal<Reaction[]>([]);

  // Computed signal to track if anything is still loading
  isAnyLoading = computed(
    () => this.isLoading() || this.isLoadingParents() || this.isLoadingReplies(),
  );

  showCompletionStatus = signal(false);

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
    const navigation = this.router.getCurrentNavigation();
    if (navigation?.extras.state?.['event']) {
      console.log('Router state event data:', navigation.extras.state['event']);
      this.event.set(navigation.extras.state['event'] as Event);
    }

    // Effect to load event when route parameter changes
    effect(() => {
      if (this.app.initialized() && this.routeParams()) {
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
  }

  async loadEvent(nevent: string) {
    this.logger.info('loadEvent called with nevent:', nevent);

    try {
      this.isLoading.set(true);
      this.isLoadingParents.set(true);
      this.isLoadingReplies.set(true);
      this.error.set(null);
      this.showCompletionStatus.set(false);

      // Reset state
      this.parentEvents.set([]);
      this.replies.set([]);
      this.threadedReplies.set([]);
      this.reactions.set([]);

      // Use progressive loading to show content as it becomes available
      const progressiveLoader = this.eventService.loadThreadProgressively(nevent, this.item);

      for await (const partialData of progressiveLoader) {
        // Update signals with partial data as it becomes available
        if (partialData.event) {
          this.event.set(partialData.event);
          const hex = partialData.event.id;
          this.id.set(hex);

          // Update URL with proper nevent encoding
          const encoded = nip19.neventEncode({
            author: partialData.event.pubkey,
            id: partialData.event.id,
          });
          this.url.updatePathSilently(['/e', encoded]);

          // Hide main loading spinner once we have the main event
          this.isLoading.set(false);
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
          this.isLoadingReplies.set(false);
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
      this.error.set(error instanceof Error ? error.message : 'Failed to load event');
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

  onViewMoreReplies(data: any): void {
    // Navigate to the specific event to view deeper replies
    const encoded = nip19.neventEncode({ id: data.deepestReplyId, author: data.event.pubkey });
    this.router.navigate(['/e', encoded]);
  }
}
