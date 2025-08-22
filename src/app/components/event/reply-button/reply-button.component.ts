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

  isLongFormArticle = computed(
    () => this.event().kind === kinds.LongFormArticle
  );

  onClick(): void {
    this.eventService.createNote({
      replyTo: {
        id: this.event().id,
        pubkey: this.event().pubkey,
      },
    });
  }
}
