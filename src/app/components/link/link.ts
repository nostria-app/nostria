import { Component, input, computed, inject } from '@angular/core';
import { Event, nip19 } from 'nostr-tools';
import { AgoPipe } from '../../pipes/ago.pipe';
import { TimestampPipe } from '../../pipes/timestamp.pipe';
import { LayoutService } from '../../services/layout.service';

@Component({
  selector: 'app-link',
  imports: [AgoPipe, TimestampPipe],
  templateUrl: './link.html',
  styleUrl: './link.scss',
})
export class Link {
  private layout = inject(LayoutService);

  // Input signal for the Nostr event
  event = input.required<Event>();

  // Computed signal to generate the link
  link = computed(() => {
    const eventData = this.event();
    let prefix = '/e';

    if (!eventData) {
      return '';
    }

    const encoded = nip19.neventEncode({
      id: eventData.id,
      author: eventData.pubkey,
      kind: eventData.kind,
    });

    if (eventData.kind === 1) {
      prefix = '/e';
    } else if (eventData.kind === 0) {
      prefix = '/p';
    }

    return `${prefix}/${encoded}`;
  });

  // Method to navigate with event data - opens in right panel
  navigateToEvent() {
    const eventData = this.event();
    if (!eventData) return;

    const encoded = nip19.neventEncode({
      id: eventData.id,
      author: eventData.pubkey,
      kind: eventData.kind,
    });

    this.layout.openGenericEvent(encoded, eventData);
  }
}
