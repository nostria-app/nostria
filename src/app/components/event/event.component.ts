import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event, kinds } from 'nostr-tools';
import { NostrRecord } from '../../interfaces';
import { AccountRelayService } from '../../services/account-relay.service';
import { ApplicationService } from '../../services/application.service';
import { BookmarkService } from '../../services/bookmark.service';
import { DataService } from '../../services/data.service';
import { LayoutService } from '../../services/layout.service';
import { RepostService } from '../../services/repost.service';
import { ContentComponent } from '../content/content.component';
import { ReplyButtonComponent } from './reply-button/reply-button.component';
import { EventHeaderComponent } from './header/header.component';

type EventCardAppearance = 'card' | 'plain';

@Component({
  selector: 'app-event',
  imports: [
    ReplyButtonComponent,
    EventHeaderComponent,
    ContentComponent,
    MatTooltipModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './event.component.html',
  styleUrl: './event.component.scss',
})
export class EventComponent {
  id = input<string | null | undefined>();
  type = input<'e' | 'a' | 'r' | 't'>('e');
  event = input<Event | null | undefined>(null);
  appearance = input<EventCardAppearance>('plain');
  repostsCount = input<number>(0);
  isPlain = computed<boolean>(() => this.appearance() === 'plain');

  data = inject(DataService);
  record = signal<NostrRecord | null>(null);
  bookmark = inject(BookmarkService);
  repostService = inject(RepostService);
  layout = inject(LayoutService);
  accountRelayService = inject(AccountRelayService);
  dialog = inject(MatDialog);
  snackBar = inject(MatSnackBar);
  app = inject(ApplicationService);
  repostedRecord = computed<NostrRecord | null>(() => {
    const event = this.event();
    if (!event || event.kind !== kinds.Repost) return null;
    return this.repostService.decodeRepost(event);
  });

  constructor() {
    effect(() => {
      const event = this.event();

      if (!event) {
        return;
      }

      const record = this.data.toRecord(event);
      this.record.set(record);
    });

    effect(async () => {
      if (this.app.initialized()) {
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
        }
      }
    });
  }
}
