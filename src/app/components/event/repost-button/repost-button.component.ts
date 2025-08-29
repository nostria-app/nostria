import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { Event } from 'nostr-tools';
import { kinds } from 'nostr-tools';
import type { NostrRecord } from '../../../interfaces';
import { AccountStateService } from '../../../services/account-state.service';
import { EventService } from '../../../services/event';
import { RepostService } from '../../../services/repost.service';

type ViewMode = 'icon' | 'full';

@Component({
  selector: 'app-repost-button',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatMenuModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './repost-button.component.html',
  styleUrls: ['./repost-button.component.scss'],
})
export class RepostButtonComponent {
  private readonly eventService = inject(EventService);
  private readonly accountState = inject(AccountStateService);
  private readonly repostService = inject(RepostService);

  isLoadingReposts = signal<boolean>(false);
  reposts = signal<NostrRecord[]>([]);

  event = input.required<Event>();
  view = input<ViewMode>('icon');

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
        this.loadReposts();
      });
    });
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
    const event = this.event();
    if (!event) return;
    this.eventService.createNote({
      quote: {
        id: event.id,
        pubkey: event.pubkey,
        // TODO: pass relay part of 'q' tag
      },
    });
  }

  async loadReposts(invalidateCache = false) {
    const event = this.event();
    if (!event) return;

    const userPubkey = this.accountState.pubkey();
    if (!userPubkey) return;

    this.isLoadingReposts.set(true);
    try {
      const reposts = await this.eventService.loadReposts(
        event.id,
        event.kind,
        userPubkey,
        invalidateCache,
      );
      this.reposts.set(reposts);
    } finally {
      this.isLoadingReposts.set(false);
    }
  }
}
