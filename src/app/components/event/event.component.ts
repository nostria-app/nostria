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
import { MatMenuModule } from '@angular/material/menu';
import { EventService, ReactionEvents } from '../../services/event';
import { AccountRelayServiceEx } from '../../services/relays/account-relay';
import { ReactionService } from '../../services/reaction.service';
import { ArticleEventComponent } from '../event-types';

type EventCardAppearance = 'card' | 'plain';

@Component({
  selector: 'app-event',
  imports: [
    ArticleEventComponent,
    AgoPipe,
    DatePipe,
    CommonModule,
    ReplyButtonComponent,
    EventHeaderComponent,
    ContentComponent,
    MatTooltipModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
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
  reposts = signal<NostrRecord[]>([]);
  reactions = signal<ReactionEvents>({ events: [], data: new Map() });

  // Loading states
  isLoadingEvent = signal<boolean>(false);
  isLoadingThread = signal<boolean>(false);
  isLoadingReposts = signal<boolean>(false);
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

  repostByCurrentAccount = computed<NostrRecord | undefined>(() => {
    const event = this.event();
    if (!event) return;
    return this.reposts().find((e) => e.event.pubkey === this.accountState.pubkey());
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
        this.loadReactions();
        this.loadReposts();
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

  async loadReposts(invalidateCache = false) {
    const record = this.repostedRecord() || this.record();
    if (!record) return;

    const userPubkey = this.accountState.pubkey();
    if (!userPubkey) return;

    this.isLoadingReposts.set(true);
    try {
      const reposts = await this.eventService.loadReposts(
        record.event.id,
        userPubkey,
        invalidateCache,
      );
      this.reposts.set(reposts);
    } finally {
      this.isLoadingReposts.set(false);
    }
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

  async createRepost() {
    const event = this.event();
    if (!event) return;
    await this.repostService.repostNote(event);
    await this.loadReposts(true);
  }

  async deleteRepost() {
    const repostItem = this.repostByCurrentAccount();
    if (!repostItem) return;
    await this.repostService.deleteRepost(repostItem.event);
    await this.loadReposts(true);
  }

  createQuote() {
    const record = this.repostedRecord() || this.record();
    if (!record) return;
    this.eventService.createNote({
      quote: {
        id: record.event.id,
        pubkey: record.event.pubkey,
        // TODO: pass relay part of 'q' tag
      },
    });
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
