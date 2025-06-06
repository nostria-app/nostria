import { Component, inject, input, signal, effect } from '@angular/core';
import { DataService } from '../../services/data.service';
import { Event } from 'nostr-tools';
import { NostrRecord } from '../../interfaces';
import { UserProfileComponent } from "../user-profile/user-profile.component";
import { LayoutService } from '../../services/layout.service';
import { ContentComponent } from '../content/content.component';

@Component({
  selector: 'app-event',
  imports: [UserProfileComponent, ContentComponent],
  templateUrl: './event.component.html',
  styleUrl: './event.component.scss'
})
export class EventComponent {
  id = input<string | null | undefined>();
  type = input<'e' | 'a' | 'r' | 't'>('e');

  data = inject(DataService);
  record = signal<NostrRecord | null>(null);
  layout = inject(LayoutService);

  constructor() {
    effect(async () => {
      const eventId = this.id();
      const type = this.type();

      if (!eventId || !type) {
        return;
      }

      if (type === 'e' || type === 'a') {
        if (eventId) {
          const eventData = await this.data.getEventById(eventId);
          this.record.set(eventData);

          console.log('RECORD:', this.record());
        }
      };
    });
  }

  openEvent(): void {
    const id = this.id();
    const type = this.type();

    if (!id) {
      return;
    }

    if (type === 'r') {
      window.open(id, '_blank');
    } else if (type === 'e') {
      this.layout.openEvent(id, this.record()?.event);
    } else if (type === 'a') {
      this.layout.openArticle(id, this.record()?.event);
    }
  }
}
