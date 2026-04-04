import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { Event } from 'nostr-tools';
import { firstValueFrom } from 'rxjs';
import type { NostrRecord } from '../../../interfaces';
import { AccountStateService } from '../../../services/account-state.service';
import { EventService } from '../../../services/event';
import { RepostService } from '../../../services/repost.service';
import { LayoutService } from '../../../services/layout.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { UserRelaysService } from '../../../services/relays/user-relays';
import { UtilitiesService } from '../../../services/utilities.service';
import type { NoteEditorDialogData } from '../../../interfaces/note-editor';
import { ConfirmDialogComponent, type ConfirmDialogData } from '../../confirm-dialog/confirm-dialog.component';

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
  private readonly userRelaysService = inject(UserRelaysService);
  private readonly utilities = inject(UtilitiesService);
  private readonly dialog = inject(MatDialog);

  isLoadingReposts = signal<boolean>(false);
  reposts = signal<NostrRecord[]>([]);

  event = input.required<Event>();
  view = input<ViewMode>('icon');
  // Accept reposts from parent to avoid duplicate queries
  // If not provided, component will load independently
  repostsFromParent = input<NostrRecord[] | null>(null);
  canRepostOrQuote = computed(() => {
    return !!this.event();
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

    // Check if the original event has an expiration tag (NIP-40)
    const expiration = this.repostService.getEventExpiration(event);
    let repostExpiration: number | undefined;

    if (expiration !== null && expiration > Math.floor(Date.now() / 1000)) {
      const confirmed = await this.promptExpirationCopy(expiration);
      if (confirmed === undefined) {
        return; // User dismissed the dialog
      }
      repostExpiration = confirmed ? expiration : undefined;
    }

    const authorRelays = await this.userRelaysService.getUserRelaysForPublishing(event.pubkey);
    const relayHints = this.utilities.getShareRelayHints(authorRelays);
    const relayUrl = relayHints[0];

    await this.repostService.repostNote(event, { expiration: repostExpiration, relayUrl });
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

    // Pass expiration from the original event if it's still in the future
    const expiration = this.repostService.getEventExpiration(event);
    if (expiration !== null && expiration > Math.floor(Date.now() / 1000)) {
      quoteData.expiration = expiration;
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

  /**
   * Prompt the user whether to copy the expiration from the original event to the repost.
   * Returns true if the user wants to copy, false if not, and undefined if they dismissed.
   */
  private async promptExpirationCopy(expiration: number): Promise<boolean | undefined> {
    const expirationLabel = this.formatExpirationDistance(expiration);
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Expiring Post',
        message: `This post expires in ${expirationLabel}. Apply the same expiration to your repost?`,
        confirmText: 'Apply Expiration',
        cancelText: 'Repost Without',
      } satisfies ConfirmDialogData,
    });

    return firstValueFrom(dialogRef.afterClosed());
  }

  private formatExpirationDistance(expirationTimestamp: number): string {
    const diff = Math.max(0, expirationTimestamp - Math.floor(Date.now() / 1000));

    if (diff < 5) {
      return 'a few seconds';
    }

    const minute = 60;
    const hour = minute * 60;
    const day = hour * 24;
    const week = day * 7;
    const month = day * 30;

    if (diff < minute) {
      return `${Math.floor(diff)} seconds`;
    }
    if (diff < minute * 2) {
      return 'a minute';
    }
    if (diff < hour) {
      return `${Math.floor(diff / minute)} minutes`;
    }
    if (diff < hour * 2) {
      return 'an hour';
    }
    if (diff < day) {
      return `${Math.floor(diff / hour)} hours`;
    }
    if (diff < day * 2) {
      return 'a day';
    }
    if (diff < week) {
      return `${Math.floor(diff / day)} days`;
    }
    if (diff < week * 2) {
      return 'a week';
    }
    if (diff < month) {
      return `${Math.floor(diff / week)} weeks`;
    }
    if (diff < month * 2) {
      return 'a month';
    }

    return `${Math.floor(diff / month)} months`;
  }
}
