import { DatePipe } from '@angular/common';
import { Component, input, computed } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event, nip19 } from 'nostr-tools';
import { AgoPipe } from '../../pipes/ago.pipe';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-link',
  imports: [MatTooltipModule, DatePipe, AgoPipe, RouterModule],
  templateUrl: './link.html',
  styleUrl: './link.scss'
})
export class Link {
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
      author: eventData.pubkey 
    });

    if (eventData.kind === 1) {
      prefix = '/e';
    } else if (eventData.kind === 0) {
      prefix = '/p';
    }

    return `${prefix}/${encoded}`;
  });
}
