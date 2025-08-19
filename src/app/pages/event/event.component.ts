import {
  Component,
  effect,
  inject,
  signal,
  TransferState,
  untracked,
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
import { EventService, ThreadData } from '../../services/event';

/** Description of the EventPageComponent
 *
 * Events and threads for events are retrieved from the OP's relays.
 * Nostr clients should ensure they post replies and reactions to the OP's relays.
 */

export interface Reaction {
  emoji: string;
  count: number;
}

export interface ThreadedEvent {
  event: Event;
  replies: ThreadedEvent[];
  level: number;
  hasMoreReplies?: boolean;
  deepestReplyId?: string;
}

@Component({
  selector: 'app-event-page',
  standalone: true,
  imports: [
    CommonModule,
    EventComponent,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './event.component.html',
  styleUrl: './event.component.scss',
})
export class EventPageComponent {
  event = signal<Event | undefined>(undefined);
  private readonly utilities = inject(UtilitiesService);
  isLoading = signal(false);
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

  item!: EventData;
  reactions = signal<Reaction[]>([]);

  constructor() {
    // this.item = this.route.snapshot.data['data'];
    console.log('EventPageComponent initialized with data:', this.item);

    if (this.transferState.hasKey(EVENT_STATE_KEY)) {
      const data = this.transferState.get<EventData | null>(
        EVENT_STATE_KEY,
        null
      );
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
  }

  async loadEvent(nevent: string) {
    this.logger.info('loadEvent called with nevent:', nevent);

    try {
      this.isLoading.set(true);
      this.error.set(null);

      // Load complete thread data using the event service
      const threadData = await this.eventService.loadCompleteThread(
        nevent,
        this.item
      );

      // Update all the signals with the loaded data
      this.event.set(threadData.event);
      this.replies.set(threadData.replies);
      this.threadedReplies.set(threadData.threadedReplies);
      this.reactions.set(threadData.reactions);
      this.parentEvents.set(threadData.parents);
      this.threadData.set(threadData);

      const hex = threadData.event.id;
      this.id.set(hex);

      // Update URL with proper nevent encoding
      const encoded = nip19.neventEncode({
        author: threadData.event.pubkey,
        id: threadData.event.id,
      });
      this.url.updatePathSilently(['/e', encoded]);

      this.logger.info('Successfully loaded thread data for event:', hex);
    } catch (error) {
      this.logger.error('Error loading event:', error);
      this.error.set(
        error instanceof Error ? error.message : 'Failed to load event'
      );
    } finally {
      this.isLoading.set(false);
      // Scroll to top after loading
      setTimeout(() => this.layout.scrollMainContentToTop(), 100);
    }
  }

  onViewMoreReplies(eventId: string): void {
    // Navigate to the specific event to view deeper replies
    const encoded = nip19.neventEncode({ id: eventId });
    this.router.navigate(['/e', encoded]);
  }
}
