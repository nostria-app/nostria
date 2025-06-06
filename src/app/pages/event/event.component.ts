import { Component, effect, inject, signal } from '@angular/core';
import { LayoutService } from '../../services/layout.service';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { DataService } from '../../services/data.service';
import { Event, kinds, nip19, SimplePool } from 'nostr-tools';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { DecodedNaddr, DecodedNevent, EventPointer } from 'nostr-tools/nip19';
import { UrlUpdateService } from '../../services/url-update.service';
import { EventComponent } from '../../components/event/event.component';
import { UtilitiesService } from '../../services/utilities.service';

/** Description of the EventPageComponent
 * 
 * Events and threads for events are retrieved from the OP's relays.
 * Nostr clients should ensure they post replies and reactions to the OP's relays.
 */

export interface Reaction {
  emoji: string;
  count: number;
}

@Component({
  selector: 'app-event-page',
  imports: [CommonModule, EventComponent],
  templateUrl: './event.component.html',
  styleUrl: './event.component.scss'
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
  private route = inject(ActivatedRoute);
  id = signal<string | null>(null);
  pool: SimplePool | undefined = undefined;
  userRelays: string[] = [];


  constructor() {
    // Effect to load article when route parameter changes
    effect(() => {
      const addrParam = this.route.snapshot.paramMap.get('id');
      if (addrParam) {
        this.pool = new SimplePool();

        this.loadEvent(addrParam);
        // Scroll to top when navigating to a new article
        setTimeout(() => this.layout.scrollMainContentToTop(), 100);
      }
    });
  }

  ngOnDestroy() {
    this.pool?.destroy();
  }

  createUserPool() {

  }

  reactions = signal<Reaction[]>([]);

  async loadReactions(eventId: string, pubkey: string) {
    if (this.userRelays.length === 0) {
      // We need to discover the event from user's relays.
      const userRelays = await this.data.getUserRelays(pubkey);
      this.userRelays = userRelays;
    }

    if (!this.userRelays || this.userRelays.length === 0) {
      this.error.set('No user relays found for the author.');
      return;
    }

    // Track reactions by emoji
    const reactionCounts = new Map<string, number>();

    this.pool?.subscribeEose(this.userRelays, {
      kinds: [kinds.Reaction, kinds.Repost],
      ['#e']: [eventId],
    }, {
      onevent: (event) => {
        console.log('Received event:', event);
        
        if (event.kind === kinds.Reaction && event.content) {
          // Count each unique reaction emoji
          const emoji = event.content;
          reactionCounts.set(emoji, (reactionCounts.get(emoji) || 0) + 1);
          
          // Convert map to Reaction array and update signal
          const reactionsArray: Reaction[] = Array.from(reactionCounts.entries()).map(([emoji, count]) => ({
            emoji,
            count
          }));
          
          this.reactions.set(reactionsArray);
        }
      },
      onclose(reasons) {
        console.log('CLOSED!!!', reasons);
      }
    })
  }

  async loadEvent(nevent: string) {
    if (this.utilities.isHex(nevent)) {
      // If the input is a hex string, we assume it's an event ID.
      nevent = nip19.neventEncode({ id: nevent }) as string;
    }

    const decoded = this.utilities.decode(nevent) as DecodedNevent;
    const hex = decoded.data.id;
    this.id.set(hex);

    const receivedData = history.state.event as Event | undefined;

    if (receivedData) {
      this.event.set(receivedData);
      this.isLoading.set(false);

      // If we find event only by ID, we should update the URL to include the NIP-19 encoded value that includes the pubkey.
      const encoded = nip19.neventEncode({ author: receivedData.pubkey, id: receivedData.id });
      this.url.updatePathSilently(['/e', encoded]);

      // Scroll to top when article is received from navigation state
      setTimeout(() => this.layout.scrollMainContentToTop(), 50);

      await this.loadReactions(receivedData.id, receivedData.pubkey);
    } else {

      try {
        this.isLoading.set(true);
        this.error.set(null);
        let event = await this.data.getEventById(hex);

        if (event) {
          this.logger.debug('Loaded article event from storage or relays:', event);
          this.event.set(event.event);

          // If we find event only by ID, we should update the URL to include the NIP-19 encoded value that includes the pubkey.
          const encoded = nip19.neventEncode({ author: event.event.pubkey, id: event.event.id });
          this.url.updatePathSilently(['/e', encoded]);

          this.isLoading.set(false);
          await this.loadReactions(event.event.id, event.event.pubkey);
        } else {

          if (!decoded.data.author) {
            this.error.set('Event not found. There is no pubkey to discover the event from.');
            this.isLoading.set(false);
            return;
          }

          // We need to discover the event from user's relays.
          const userRelays = await this.data.getUserRelays(decoded.data.author);
          this.userRelays = userRelays;

          if (!userRelays || userRelays.length === 0) {
            this.error.set('No user relays found for the author.');
            this.isLoading.set(false);
            return;
          }

          const event = await this.pool?.get(userRelays, { ids: [decoded.data.id] });

          if (!event) {
            this.error.set('Event not found on user relays.');
            this.isLoading.set(false);
            return;
          }

          this.event.set(event);

          // We found the event, now we'll discover reactions and replies.
          this.logger.debug('Loaded article event from user relays:', event);

          await this.loadReactions(event.id, decoded.data.author);
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
}