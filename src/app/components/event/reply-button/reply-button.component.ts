import { Component, computed, inject, input } from '@angular/core';
import { Event, kinds } from 'nostr-tools';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EventService } from '../../../services/event';

@Component({
  selector: 'app-reply-button',
  standalone: true,
  imports: [MatIconModule, MatButtonModule, MatTooltipModule],
  templateUrl: './reply-button.component.html',
  styleUrls: ['./reply-button.component.scss'],
})
export class ReplyButtonComponent {
  private readonly eventService = inject(EventService);

  event = input.required<Event>();

  // we use NIP-10 replies for kind:1 and NIP-22 comments for all the other kinds
  isReply = computed(() => this.event().kind === kinds.ShortTextNote);

  onClick(): void {
    if (this.event().kind === kinds.ShortTextNote) {
      this.eventService.createNote({
        replyTo: {
          id: this.event().id,
          pubkey: this.event().pubkey,
        },
      });
    } else {
      // TODO: create kind:1111 event (NIP-22)
    }
  }
}
