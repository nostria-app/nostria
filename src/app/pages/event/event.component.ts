import { Component, effect, inject, OnInit, signal, TransferState, untracked } from '@angular/core';
import { LayoutService } from '../../services/layout.service';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { DataService } from '../../services/data.service';
import { Event, kinds, nip19, SimplePool } from 'nostr-tools';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { DecodedNaddr, DecodedNevent, EventPointer } from 'nostr-tools/nip19';
import { UrlUpdateService } from '../../services/url-update.service';
import { EventComponent } from '../../components/event/event.component';
import { UtilitiesService } from '../../services/utilities.service';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { ApplicationService } from '../../services/application.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { EVENT_STATE_KEY, EventData } from '../../data-resolver';

/** Description of the EventPageComponent
 * 
 * Events and threads for events are retrieved from the OP's relays.
 * Nostr clients should ensure they post replies and reactions to the OP's relays.
 */

export interface Reaction {
  emoji: string;
  count: number;
}

export interface Reposts {
  pubkey: string;
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
  imports: [CommonModule, EventComponent, MatIconModule, MatButtonModule],
  templateUrl: './event.component.html',
  styleUrl: './event.component.scss'
})
export class EventPageComponent implements OnInit {
  event = signal<Event | undefined>(undefined);
  private readonly utilities = inject(UtilitiesService);
  isLoading = signal(false);
  error = signal<string | null>(null);
  layout = inject(LayoutService);
  nostrService = inject(NostrService);
  logger = inject(LoggerService);
  data = inject(DataService);
  url = inject(UrlUpdateService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  id = signal<string | null>(null);
  pool: SimplePool | undefined = undefined;
  userRelays: string[] = [];
  app = inject(ApplicationService);
  private routeParams = toSignal<ParamMap>(this.route.paramMap);
  replies = signal<Event[]>([]);
  threadedReplies = signal<ThreadedEvent[]>([]);
  transferState = inject(TransferState);

  item!: EventData;

  constructor() {
    // this.item = this.route.snapshot.data['data'];
    console.log('EventPageComponent initialized with data:', this.item);

    if (this.transferState.hasKey(EVENT_STATE_KEY)) {
      const data = this.transferState.get<any>(EVENT_STATE_KEY, null);
      console.log('Transferred data:', data);
      this.item = data;
      this.transferState.remove(EVENT_STATE_KEY); // optional cleanup
    }

    // Effect to load event when route parameter changes
    effect(async () => {
      if (this.app.initialized() && this.routeParams()) {

        // this.item = this.route.snapshot.data['data'];
        // console.log('EventPageComponent initialized with data:', this.route.snapshot);

        let id = this.routeParams()?.get('id');
        if (id) {
          // Clean up previous pool if it exists
          if (this.pool) {
            this.pool.destroy();
          }

          this.pool = new SimplePool();
          await this.loadEvent(id);

          // Scroll to top when navigating to a new event
          setTimeout(() => this.layout.scrollMainContentToTop(), 100);
        }
      }
    });
  }

  ngOnInit() {

  }

  ngOnDestroy() {
    this.pool?.destroy();
  }

  reactions = signal<Reaction[]>([]);
  reposts = signal<Reposts[]>([]);

  private getEventTags(event: Event): { rootId: string | null; replyId: string | null; pTags: string[] } {
    const eTags = event.tags.filter(tag => tag[0] === 'e');
    const pTags = event.tags.filter(tag => tag[0] === 'p').map(tag => tag[1]);

    let rootId: string | null = null;
    let replyId: string | null = null;

    // Find root tag
    const rootTag = eTags.find(tag => tag[3] === 'root');
    if (rootTag) {
      rootId = rootTag[1];
    }

    // Find reply tag
    const replyTag = eTags.find(tag => tag[3] === 'reply');
    if (replyTag) {
      replyId = replyTag[1];
    } else if (eTags.length > 0 && !rootTag) {
      // If no explicit reply tag but has e tags, assume replying to the last e tag
      replyId = eTags[eTags.length - 1][1];
    }

    return { rootId, replyId, pTags };
  }

  private buildThreadTree(events: Event[], rootEventId: string, maxDepth: number = 5): ThreadedEvent[] {
    const eventMap = new Map<string, Event>();
    const childrenMap = new Map<string, Event[]>();

    // Build maps
    events.forEach(event => {
      eventMap.set(event.id, event);

      const { replyId } = this.getEventTags(event);
      const parentId = replyId || rootEventId;

      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, []);
      }
      childrenMap.get(parentId)!.push(event);
    });

    // Build tree recursively with depth limit
    const buildNode = (eventId: string, level: number = 0): ThreadedEvent[] => {
      const children = childrenMap.get(eventId) || [];

      return children
        .sort((a, b) => a.created_at - b.created_at) // Sort by creation time
        .map(child => {
          const threadedEvent: ThreadedEvent = {
            event: child,
            replies: [],
            level
          };

          // If we're at max depth, check if there are deeper replies
          if (level >= maxDepth - 1) {
            const hasDeepReplies = childrenMap.has(child.id) && childrenMap.get(child.id)!.length > 0;
            if (hasDeepReplies) {
              threadedEvent.hasMoreReplies = true;
              threadedEvent.deepestReplyId = child.id;
            }
          } else {
            // Continue building the tree if we haven't reached max depth
            threadedEvent.replies = buildNode(child.id, level + 1);
          }

          return threadedEvent;
        });
    };

    return buildNode(rootEventId);
  }

  async loadReplies(eventId: string, pubkey: string) {
    this.logger.info('loadReplies called with eventId:', eventId, 'pubkey:', pubkey);
    this.logger.info('Current userRelays length:', this.userRelays.length);

    if (this.userRelays.length === 0) {
      this.logger.info('No user relays cached, discovering relays for pubkey:', pubkey);
      // We need to discover the event from user's relays.
      const userRelays = await this.data.getUserRelays(pubkey);
      this.userRelays = userRelays;
      this.logger.info('Retrieved user relays from data service:', userRelays);
    }

    if (!this.userRelays || this.userRelays.length === 0) {
      this.logger.info('No user relays found for author when loading replies. userRelays:', this.userRelays);
      this.error.set('No user relays found for the author when loading replies.');
      return;
    }

    // Track reactions by emoji
    const reactionCounts = new Map<string, number>();
    const allReplies: Event[] = [];

    this.pool?.subscribeEose(this.userRelays, {
      kinds: [kinds.ShortTextNote, kinds.Reaction, kinds.Repost],
      ['#e']: [eventId],
    }, {
      onevent: (event) => {
        console.log('Received event:', event);

        if (event.kind === kinds.ShortTextNote && event.content) {
          // Handle text replies
          console.log('Text reply:', event);

          const existingReply = allReplies.find(reply => reply.id === event.id);
          if (!existingReply) {
            allReplies.push(event);
            this.replies.set([...allReplies]);

            // Build threaded structure with max depth of 4
            const threaded = this.buildThreadTree(allReplies, eventId, 4);
            this.threadedReplies.set(threaded);
          }

        } else if (event.kind === kinds.Reaction && event.content) {
          // Count each unique reaction emoji
          const emoji = event.content;
          reactionCounts.set(emoji, (reactionCounts.get(emoji) || 0) + 1);

          // Convert map to Reaction array and update signal
          const reactionsArray: Reaction[] = Array.from(reactionCounts.entries()).map(([emoji, count]) => ({
            emoji,
            count
          }));

          this.reactions.set(reactionsArray);
        } else if (event.kind === kinds.Repost) {
          this.reposts.update(currentReposts => [...currentReposts, { pubkey: event.pubkey }]);
        }
      },
      onclose(reasons) {
        console.log('CLOSED!!!', reasons);
      }
    });
  }

  async loadEvent(nevent: string) {
    this.logger.info('loadEvent called with nevent:', nevent);

    if (this.utilities.isHex(nevent)) {
      this.logger.info('Input is hex string, encoding to nevent');
      // If the input is a hex string, we assume it's an event ID.
      nevent = nip19.neventEncode({ id: nevent }) as string;
      this.logger.info('Encoded to nevent:', nevent);
    }

    const decoded = this.utilities.decode(nevent) as DecodedNevent;
    const hex = decoded.data.id;
    this.logger.info('Decoded event ID:', hex, 'Author:', decoded.data.author);
    this.id.set(hex);

    if (this.item?.event && this.item.event.id === hex) {
      // If this happens, we have NOT loaded the user relays yet and made them available for "loadReplies".
      // We need to discover the event from user's relays.
      const userRelays = await this.data.getUserRelays(this.item.event.pubkey);
      this.userRelays = userRelays;

      this.logger.info('Using cached event from item');
      // If we already have the event in the item, use it directly.
      this.event.set(this.item.event);
      this.isLoading.set(false);
      await this.loadReplies(this.item.event.id, this.item.event.pubkey);
      return;
    }

    const receivedData = history.state.event as Event | undefined;

    if (receivedData) {
      this.logger.info('Using event from navigation state:', receivedData.id);
      this.event.set(receivedData);
      this.isLoading.set(false);

      // If we find event only by ID, we should update the URL to include the NIP-19 encoded value that includes the pubkey.
      const encoded = nip19.neventEncode({ author: receivedData.pubkey, id: receivedData.id });
      this.url.updatePathSilently(['/e', encoded]);

      // Scroll to top when article is received from navigation state
      setTimeout(() => this.layout.scrollMainContentToTop(), 50);

      await this.loadReplies(receivedData.id, receivedData.pubkey);
    } else {
      this.logger.info('No cached event, attempting to load from storage or relays');

      try {
        this.isLoading.set(true);
        this.error.set(null);
        let event = await this.data.getEventById(hex);

        if (event) {
          this.logger.info('Loaded article event from storage or relays:', event.event.id);
          this.logger.debug('Loaded article event from storage or relays:', event);
          this.event.set(event.event);

          // If we find event only by ID, we should update the URL to include the NIP-19 encoded value that includes the pubkey.
          const encoded = nip19.neventEncode({ author: event.event.pubkey, id: event.event.id });
          this.url.updatePathSilently(['/e', encoded]);

          this.isLoading.set(false);
          await this.loadReplies(event.event.id, event.event.pubkey);
        } else {
          this.logger.info('Event not found in storage, attempting relay discovery');

          if (!decoded.data.author) {
            this.logger.info('No author in decoded data, cannot discover relays');
            this.error.set('Event not found. There is no pubkey to discover the event from.');
            this.isLoading.set(false);
            return;
          }

          this.logger.info('Discovering user relays for author:', decoded.data.author);
          // We need to discover the event from user's relays.
          const userRelays = await this.data.getUserRelays(decoded.data.author);
          this.userRelays = userRelays;
          this.logger.info('Retrieved user relays from data service:', userRelays);

          if (!this.userRelays || this.userRelays.length === 0) {
            this.logger.info('No user relays found, attempting relay discovery via NostrService');
            // If the current user is anonymous, we will end up here. Let's discover the user relays.
            const discoveredRelays = await this.nostrService.discoverRelays(decoded.data.author);
            this.userRelays = discoveredRelays.relayUrls;
            this.logger.info('Discovered relays via NostrService:', discoveredRelays.relayUrls);
          }

          if (!this.userRelays || this.userRelays.length === 0) {
            this.logger.info('Still no user relays found after all discovery attempts. userRelays:', this.userRelays);
            this.error.set('No user relays found for the author.');
            this.isLoading.set(false);
            return;
          }

          this.logger.info('Attempting to fetch event from user relays:', this.userRelays);
          const event = await this.pool!.get(this.userRelays, { ids: [decoded.data.id] }, { maxWait: 4000 });

          if (!event) {
            this.logger.info('Event not found on user relays');
            this.error.set('Event not found on user relays.');
            this.isLoading.set(false);
            return;
          }

          this.logger.info('Successfully fetched event from user relays:', event.id);
          this.event.set(event);

          // We found the event, now we'll discover reactions and replies.
          this.logger.debug('Loaded article event from user relays:', event);

          await this.loadReplies(event.id, decoded.data.author);
        }
      } catch (error) {
        this.logger.error('Error loading article:', error);
        this.error.set('Failed to load article');
      } finally {
        this.isLoading.set(false);
        // Scroll to top after article loads (whether successful or not)
        setTimeout(() => this.layout.scrollMainContentToTop(), 100);
      }
    }
  }

  onViewMoreReplies(eventId: string): void {
    // Navigate to the specific event to view deeper replies
    const encoded = nip19.neventEncode({ id: eventId });
    this.router.navigate(['/e', encoded]);
  }
}