import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { Event } from 'nostr-tools';
import type { NostrRecord } from '../../../interfaces';
import { AccountStateService } from '../../../services/account-state.service';
import { EventService } from '../../../services/event';
import { RepostService } from '../../../services/repost.service';
import { LayoutService } from '../../../services/layout.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { UtilitiesService } from '../../../services/utilities.service';
import type { NoteEditorDialogData } from '../../../interfaces/note-editor';

type ViewMode = 'icon' | 'full';

@Component({
  selector: 'app-repost-button',
  imports: [
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatMenuModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './repost-button.component.html',
  styleUrls: ['./repost-button.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepostButtonComponent {
  private readonly eventService = inject(EventService);
  private readonly accountState = inject(AccountStateService);
  private readonly repostService = inject(RepostService);
  private readonly layout = inject(LayoutService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly utilities = inject(UtilitiesService);

  isLoadingReposts = signal<boolean>(false);
  reposts = signal<NostrRecord[]>([]);

  event = input.required<Event>();
  view = input<ViewMode>('icon');
  // Accept reposts from parent to avoid duplicate queries
  // If not provided, component will load independently
  repostsFromParent = input<NostrRecord[] | null>(null);
  canRepostOrQuote = computed(() => {
    const event = this.event();
    return !!event && !this.repostService.isProtectedEvent(event);
  });

  repostByCurrentAccount = computed<NostrRecord | undefined>(() => {
    const event = this.event();
    if (!event) return;
    return this.reposts().find(e => e.event.pubkey === this.accountState.pubkey());
  });

  constructor() {
    // Watch for parent reposts and use them when available
    effect(() => {
      const parentReposts = this.repostsFromParent();

      // If parent provides reposts (even empty array), use them
      if (parentReposts !== null) {
        this.reposts.set(parentReposts);
      }
    });

    // Fallback: Load reposts independently only if parent doesn't provide them
    // This handles standalone usage of the component
    effect(() => {
      const event = this.event();
      const parentReposts = this.repostsFromParent();

      if (!event || parentReposts !== null) {
        return;
      }

      // Load independently only if no parent data is being managed
      untracked(async () => {
        this.loadReposts();
      });
    });
  }

  async createRepost() {
    // Check if user is logged in
    const userPubkey = this.accountState.pubkey();
    const currentAccount = this.accountState.account();
    if (!userPubkey || currentAccount?.source === 'preview') {
      // Show login dialog if no account is active or if using a preview account
      await this.layout.showLoginDialog();
      return;
    }

    const event = this.event();
    if (!event) return;

    if (!this.canRepostOrQuote()) {
      return;
    }

    await this.repostService.repostNote(event);
    await this.loadReposts(true);
  }

  async deleteRepost() {
    // Check if user is logged in
    const userPubkey = this.accountState.pubkey();
    const currentAccount = this.accountState.account();
    if (!userPubkey || currentAccount?.source === 'preview') {
      // Show login dialog if no account is active or if using a preview account
      await this.layout.showLoginDialog();
      return;
    }

    const repostItem = this.repostByCurrentAccount();
    if (!repostItem) return;
    await this.repostService.deleteRepost(repostItem.event);
    await this.loadReposts(true);
  }

  async createQuote() {
    // Check if user is logged in
    const userPubkey = this.accountState.pubkey();
    const currentAccount = this.accountState.account();
    if (!userPubkey || currentAccount?.source === 'preview') {
      // Show login dialog if no account is active or if using a preview account
      await this.layout.showLoginDialog();
      return;
    }

    const event = this.event();
    if (!event) return;
    if (!this.canRepostOrQuote()) return;

    const accountRelays = this.accountRelay.getRelayUrls();
    const relayHints = accountRelays.length > 0
      ? this.utilities.normalizeRelayUrls([accountRelays[0]])
      : [];

    const identifier = this.utilities.isParameterizedReplaceableEvent(event.kind)
      ? event.tags.find(tag => tag[0] === 'd')?.[1]
      : undefined;

    const quoteData: NonNullable<NoteEditorDialogData['quote']> = {
      id: event.id,
      pubkey: event.pubkey,
      kind: event.kind,
      relays: relayHints,
    };

    if (identifier) {
      quoteData.identifier = identifier;
    }

    this.eventService.createNote({
      quote: quoteData,
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
        invalidateCache
      );
      this.reposts.set(reposts);
    } finally {
      this.isLoadingReposts.set(false);
    }
  }
}
