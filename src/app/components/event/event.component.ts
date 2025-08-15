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
import { CommonModule } from '@angular/common';
import { AccountStateService } from '../../services/account-state.service';
import { UserDataFactoryService } from '../../services/user-data-factory.service';
import { MatMenuModule } from '@angular/material/menu';

type EventCardAppearance = 'card' | 'plain';

@Component({
  selector: 'app-event',
  imports: [
    CommonModule,
    ReplyButtonComponent,
    EventHeaderComponent,
    ContentComponent,
    MatTooltipModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
  ],
  templateUrl: './event.component.html',
  styleUrl: './event.component.scss',
})
export class EventComponent {
  id = input<string | null | undefined>();
  type = input<'e' | 'a' | 'r' | 't'>('e');
  event = input<Event | null | undefined>(null);
  appearance = input<EventCardAppearance>('plain');
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
  accountState = inject(AccountStateService);
  userDataFactory = inject(UserDataFactoryService);
  reposts = signal<NostrRecord[]>([]);

  repostedRecord = computed<NostrRecord | null>(() => {
    const event = this.event();
    if (!event || event.kind !== kinds.Repost) return null;
    return this.repostService.decodeRepost(event);
  });

  repostByCurrentAccount = computed<NostrRecord | undefined>(() => {
    const event = this.event();
    if (!event) return;
    return this.reposts().find(
      e => e.event.pubkey === this.accountState.pubkey()
    );
  });

  constructor() {
    effect(() => {
      const event = this.event();

      if (!event) {
        return;
      }

      const record = this.data.toRecord(event);
      this.record.set(record);
      this.loadReposts();
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

  async loadReposts() {
    const record = this.repostedRecord() || this.record();
    if (!record) return;
    const userDataService = await this.userDataFactory.create(
      this.accountState.pubkey()
    );
    const reposts = await userDataService.getEventsByKindAndEventTag(
      kinds.Repost,
      record.event.id,
      {
        save: false,
        cache: false, // cannot cache until we have stale-while-revalidate strategy implemented
      }
    );
    this.reposts.set(reposts);
  }

  async createRepost() {
    const repostItem = this.repostByCurrentAccount();
    if (!repostItem) return;
    await this.repostService.deleteRepost(repostItem.event);
  }

  async deleteRepost() {
    const repostItem = this.repostByCurrentAccount();
    if (!repostItem) return;
    await this.repostService.deleteRepost(repostItem.event);
  }

  createQuote() {
    const record = this.repostedRecord() || this.record();
    if (!record) return;
    this.layout.createNote({
      quote: {
        id: record.event.id,
        pubkey: record.event.pubkey,
        // TODO: pass relay part of 'q' tag
      },
    });
  }
}
