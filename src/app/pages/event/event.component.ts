import { Component, effect, inject, signal } from '@angular/core';
import { LayoutService } from '../../services/layout.service';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { DataService } from '../../services/data.service';
import { Event, nip19 } from 'nostr-tools';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { EventPointer } from 'nostr-tools/nip19';
import { UrlUpdateService } from '../../services/url-update.service';
import { EventComponent } from '../../components/event/event.component';
import { UtilitiesService } from '../../services/utilities.service';

/** Description of the EventPageComponent
 * 
 * Events and threads for events are retrieved from the OP's relays.
 * Nostr clients should ensure they post replies and reactions to the OP's relays.
 */

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

  constructor() {
    // Effect to load article when route parameter changes
    effect(() => {
      const addrParam = this.route.snapshot.paramMap.get('id');
      if (addrParam) {
        this.loadEvent(addrParam);
        // Scroll to top when navigating to a new article
        setTimeout(() => this.layout.scrollMainContentToTop(), 100);
      }
    });
  }

  async loadEvent(nevent: string) {
    const decoded = this.utilities.decode(nevent);

    debugger;
    let hex = this.utilities.getHex(nevent);

    this.id.set(hex);

    // if (nevent.startsWith('nevent')) {
    //   // Convert hex to nevent and update the route parameter.
    //   const encoded = nip19.noteEncode(nevent);
    //   this.url.updatePathSilently(['/e', encoded])
    // }

    const receivedData = history.state.event as Event | undefined;

    if (receivedData) {
      this.event.set(receivedData);
      this.isLoading.set(false);

      // If we find event only by ID, we should update the URL to include the NIP-19 encoded value that includes the pubkey.
      const encoded = nip19.neventEncode({ author: receivedData.pubkey, id: receivedData.id });
      this.url.updatePathSilently(['/e', encoded]);

      // Scroll to top when article is received from navigation state
      setTimeout(() => this.layout.scrollMainContentToTop(), 50);
      return;
    }

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
        return;
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
