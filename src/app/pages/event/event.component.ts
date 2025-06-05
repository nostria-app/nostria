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

@Component({
  selector: 'app-event',
  imports: [CommonModule],
  templateUrl: './event.component.html',
  styleUrl: './event.component.scss'
})
export class EventComponent {
  event = signal<Event | undefined>(undefined);
  isLoading = signal(false);
  error = signal<string | null>(null);
  layout = inject(LayoutService);
  nostrService = inject(NostrService);
  logger = inject(LoggerService);
  data = inject(DataService);
  url = inject(UrlUpdateService);
  private route = inject(ActivatedRoute);

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
    let hex = this.nostrService.getHex(nevent);

    // if (nevent.startsWith('nevent')) {
    //   // Convert hex to nevent and update the route parameter.
    //   const encoded = nip19.noteEncode(nevent);
    //   this.url.updatePathSilently(['/e', encoded])
    // }

    const receivedData = history.state.event as Event | undefined;

    if (receivedData) {
      this.event.set(receivedData);
      this.isLoading.set(false);
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
