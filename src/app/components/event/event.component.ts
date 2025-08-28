import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Event, kinds } from 'nostr-tools';
import { NostrRecord } from '../../interfaces';
import { AgoPipe } from '../../pipes/ago.pipe';
import { ApplicationService } from '../../services/application.service';
import { BookmarkService } from '../../services/bookmark.service';
import { DataService } from '../../services/data.service';
import { LayoutService } from '../../services/layout.service';
import { RepostService } from '../../services/repost.service';
import { ContentComponent } from '../content/content.component';
import { ReplyButtonComponent } from './reply-button/reply-button.component';
import { EventHeaderComponent } from './header/header.component';
import { CommonModule, DatePipe } from '@angular/common';
import { AccountStateService } from '../../services/account-state.service';
import { EventService, ReactionEvents } from '../../services/event';
import { AccountRelayServiceEx } from '../../services/relays/account-relay';
import { ReactionService } from '../../services/reaction.service';
import {
  ArticleEventComponent,
  PhotoEventComponent,
  PlaylistEventComponent,
  VideoEventComponent,
} from '../event-types';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { BadgeComponent } from '../../pages/badges/badge/badge.component';
import { RepostButtonComponent } from './repost-button/repost-button.component';

type EventCardAppearance = 'card' | 'plain';

@Component({
  selector: 'app-event',
  imports: [
    ArticleEventComponent,
    AgoPipe,
    DatePipe,
    CommonModule,
    ReplyButtonComponent,
    RepostButtonComponent,
    EventHeaderComponent,
    ContentComponent,
    MatTooltipModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    PhotoEventComponent,
    VideoEventComponent,
    ArticleEventComponent,
    PlaylistEventComponent,
    UserProfileComponent,
    BadgeComponent,
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
  reactionService = inject(ReactionService);
  layout = inject(LayoutService);
  accountRelay = inject(AccountRelayServiceEx);
  dialog = inject(MatDialog);
  snackBar = inject(MatSnackBar);
  app = inject(ApplicationService);
  accountState = inject(AccountStateService);
  eventService = inject(EventService);
  reactions = signal<ReactionEvents>({ events: [], data: new Map() });

  // Loading states
  isLoadingEvent = signal<boolean>(false);
  isLoadingThread = signal<boolean>(false);
  isLoadingReactions = signal<boolean>(false);
  loadingError = signal<string | null>(null);

  likes = computed<NostrRecord[]>(() => {
    const event = this.event();
    if (!event) return [];
    return this.reactions().events.filter((r) => r.event.content === '+');
  });

  likeReaction = computed<NostrRecord | undefined>(() => {
    const myReactions = this.likes();
    if (!myReactions) return;
    return myReactions.find((r) => r.event.pubkey === this.accountState.pubkey());
  });

  repostedRecord = computed<NostrRecord | null>(() => {
    const event = this.event();
    if (!event || (event.kind !== kinds.Repost && event.kind !== kinds.GenericRepost)) return null;
    return this.repostService.decodeRepost(event);
  });

  followingCount = computed<number>(() => {
    const record = this.record();
    if (!record || record.event.kind !== 3) return 0;

    // Count the "p" tags in the event
    return record.event.tags.filter((tag) => tag[0] === 'p').length;
  });

  constructor() {
    effect(() => {
      const event = this.event();

      if (!event) {
        return;
      }

      untracked(async () => {
        const record = this.data.toRecord(event);
        this.record.set(record);

        if (record.event.kind == kinds.ShortTextNote) {
          this.loadReactions();
        }
      });
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
            this.isLoadingEvent.set(true);
            this.loadingError.set(null);
            try {
              const eventData = await this.data.getEventById(eventId);
              this.record.set(eventData);
              console.log('RECORD:', this.record());
            } catch (error) {
              console.error('Error loading event:', error);
              this.loadingError.set('Failed to load event');
            } finally {
              this.isLoadingEvent.set(false);
            }
          }
        }
      }
    });
  }

  async loadReactions(invalidateCache = false) {
    const record = this.record();
    if (!record) return;

    const userPubkey = this.accountState.pubkey();
    if (!userPubkey) return;

    this.isLoadingReactions.set(true);
    try {
      const reactions = await this.eventService.loadReactions(
        record.event.id,
        userPubkey,
        invalidateCache,
      );
      this.reactions.set(reactions);
    } finally {
      this.isLoadingReactions.set(false);
    }
  }

  async toggleLike() {
    const event = this.event();
    if (!event) return;
    const likeEvent = this.likeReaction();
    if (likeEvent) {
      await this.reactionService.deleteReaction(likeEvent.event);
    } else {
      await this.reactionService.addLike(event);
    }
    await this.loadReactions(true);
  }
}
