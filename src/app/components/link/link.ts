import { Component, input, computed, inject } from '@angular/core';
import { Event, nip19 } from 'nostr-tools';
import { AgoPipe } from '../../pipes/ago.pipe';
import { TimestampPipe } from '../../pipes/timestamp.pipe';
import { Router } from '@angular/router';

@Component({
  selector: 'app-link',
  imports: [AgoPipe, TimestampPipe],
  templateUrl: './link.html',
  styleUrl: './link.scss',
})
export class Link {
  // Inject Router for programmatic navigation
  private router = inject(Router);

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

  // Method to navigate with event data
  navigateToEvent() {
    const route = this.link();
    if (route) {
      this.router.navigate([route], {
        state: { event: this.event() },
      });
    }
  }
}
