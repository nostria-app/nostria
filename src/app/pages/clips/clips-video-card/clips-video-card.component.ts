import { Component, computed, effect, inject, input, OnDestroy, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event } from 'nostr-tools';
import { BookmarkListSelectorComponent } from '../../../components/bookmark-list-selector/bookmark-list-selector.component';
import { ReactionButtonComponent } from '../../../components/event/reaction-button/reaction-button.component';
import { ZapButtonComponent } from '../../../components/zap-button/zap-button.component';
import { InlineVideoPlayerComponent } from '../../../components/inline-video-player/inline-video-player.component';
import { ShareArticleDialogComponent, ShareArticleDialogData } from '../../../components/share-article-dialog/share-article-dialog.component';
import { AccountStateService } from '../../../services/account-state.service';
import { BookmarkService } from '../../../services/bookmark.service';
import { CustomDialogService } from '../../../services/custom-dialog.service';
import { LayoutService } from '../../../services/layout.service';
import { EventService } from '../../../services/event';
import { SharedRelayService } from '../../../services/relays/shared-relay';
import { UserRelaysService } from '../../../services/relays/user-relays';
import { UtilitiesService } from '../../../services/utilities.service';

const CLIP_KINDS = [22, 34236];

@Component({
  selector: 'app-clips-video-card',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatTooltipModule,
    ReactionButtonComponent,
    ZapButtonComponent,
    InlineVideoPlayerComponent,
  ],
  templateUrl: './clips-video-card.component.html',
  styleUrl: './clips-video-card.component.scss',
})
export class ClipsVideoCardComponent implements OnDestroy {
  event = input.required<Event>();
  active = input<boolean>(true);

  commentsClick = output<void>();

  bookmark = inject(BookmarkService);
  private utilities = inject(UtilitiesService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private customDialog = inject(CustomDialogService);
  private layout = inject(LayoutService);
  private eventService = inject(EventService);
  private sharedRelay = inject(SharedRelayService);
  private accountState = inject(AccountStateService);
  private userRelaysService = inject(UserRelaysService);
  private interactionsRefreshTimer: ReturnType<typeof setInterval> | null = null;

  private liveLikes = signal<number | null>(null);
  private liveComments = signal<number | null>(null);

  objectFitMode = computed<'cover' | 'contain'>(() => this.layout.isHandset() ? 'cover' : 'contain');

  videoUrl = computed(() => {
    const imetaTag = this.event().tags.find(tag => tag[0] === 'imeta');
    if (!imetaTag) return '';
    const parsed = this.utilities.parseImetaTag(imetaTag, true);
    return parsed['url'] || '';
  });

  posterUrl = computed(() => {
    const imetaTag = this.event().tags.find(tag => tag[0] === 'imeta');
    if (!imetaTag) return '';
    const parsed = this.utilities.parseImetaTag(imetaTag, true);
    return parsed['image'] || '';
  });

  title = computed(() => this.event().tags.find(tag => tag[0] === 'title')?.[1] || 'Clip');

  description = computed(() => {
    const text = this.event().content?.trim();
    if (!text) return '';
    return text;
  });

  authorLabel = computed(() => this.utilities.getNpubShort(this.event().pubkey, 14));

  likesCount = computed(() => this.liveLikes() ?? this.getNumericTag('likes'));
  commentsCount = computed(() => this.liveComments() ?? this.getNumericTag('comments'));
  sharesCount = computed(() => this.getNumericTag('reposts'));

  constructor() {
    effect(() => {
      const clipEvent = this.event();
      const isActive = this.active();

      this.stopInteractionsRefreshTimer();

      this.liveLikes.set(null);
      this.liveComments.set(null);

      void this.refreshInteractionCounts(false, clipEvent.id);

      if (isActive) {
        this.interactionsRefreshTimer = setInterval(() => {
          void this.refreshInteractionCounts(true, clipEvent.id);
        }, 6000);
      }
    });
  }

  ngOnDestroy(): void {
    this.stopInteractionsRefreshTimer();
  }

  async toggleBookmark(event: MouseEvent): Promise<void> {
    event.stopPropagation();

    const clipEvent = this.event();
    await this.userRelaysService.ensureRelaysForPubkey(clipEvent.pubkey);
    const authorRelays = this.userRelaysService.getRelaysForPubkey(clipEvent.pubkey);
    const relayHint = authorRelays[0] || undefined;

    this.dialog.open(BookmarkListSelectorComponent, {
      data: {
        itemId: clipEvent.id,
        type: 'e',
        eventKind: clipEvent.kind,
        pubkey: clipEvent.pubkey,
        relay: relayHint,
      },
      width: '400px',
      panelClass: 'responsive-dialog',
    });
  }

  openAuthorProfile(event: MouseEvent): void {
    event.stopPropagation();
    this.layout.openProfile(this.event().pubkey);
  }

  onComments(event: MouseEvent): void {
    event.stopPropagation();
    void this.refreshInteractionCounts(true);
    this.commentsClick.emit();
  }

  onReactionChanged(): void {
    void this.refreshInteractionCounts(true);
    setTimeout(() => {
      void this.refreshInteractionCounts(true);
    }, 1800);
  }

  async onShare(event: MouseEvent): Promise<void> {
    event.stopPropagation();

    try {
      const clipEvent = this.event();
      await this.userRelaysService.ensureRelaysForPubkey(clipEvent.pubkey);

      const authorRelays = this.userRelaysService.getRelaysForPubkey(clipEvent.pubkey);
      const relayHint = authorRelays[0];
      const relayHints = this.utilities.normalizeRelayUrls(relayHint ? [relayHint] : []);
      const encodedId = this.utilities.encodeEventForUrl(clipEvent, relayHints.length > 0 ? relayHints : undefined);

      const dialogData: ShareArticleDialogData = {
        title: this.title(),
        summary: this.description() || undefined,
        image: this.posterUrl() || undefined,
        url: `https://nostria.app/e/${encodedId}`,
        eventId: clipEvent.id,
        pubkey: clipEvent.pubkey,
        identifier: clipEvent.tags.find(tag => tag[0] === 'd')?.[1],
        kind: clipEvent.kind,
        encodedId,
        event: clipEvent,
      };

      this.customDialog.open(ShareArticleDialogComponent, {
        title: '',
        showCloseButton: false,
        panelClass: 'share-sheet-dialog',
        data: dialogData,
        width: '450px',
        maxWidth: '95vw',
      });
    } catch {
      this.snackBar.open('Unable to open share dialog', 'Dismiss', { duration: 2500 });
    }
  }

  private getNumericTag(tagName: string): number {
    const raw = this.event().tags.find(tag => tag[0] === tagName)?.[1];
    if (!raw) return 0;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return 0;
    return parsed;
  }

  private async refreshInteractionCounts(invalidateCache = false, expectedEventId?: string): Promise<void> {
    const clipEvent = this.event();
    const targetEventId = expectedEventId || clipEvent.id;

    try {
      const [reactions, commentsCount] = await Promise.all([
        this.eventService.loadReactions(clipEvent.id, clipEvent.pubkey, invalidateCache),
        this.loadCommentCount(clipEvent),
      ]);

      if (this.event().id !== targetEventId) {
        return;
      }

      this.liveLikes.set(reactions.events.length);
      this.liveComments.set(commentsCount);
    } catch {
      // Keep tag-based fallback values if live counts fail
    }
  }

  private async loadCommentCount(clipEvent: Event): Promise<number> {
    if (!CLIP_KINDS.includes(clipEvent.kind)) {
      const replies = await this.eventService.loadReplies(clipEvent.id, clipEvent.pubkey);
      return replies.length;
    }

    const queryPubkey = this.accountState.pubkey() || clipEvent.pubkey;

    const [lowercaseTagComments, uppercaseTagComments] = await Promise.all([
      this.sharedRelay.getMany(queryPubkey, {
        kinds: [1111],
        '#e': [clipEvent.id],
        limit: 200,
      }),
      this.sharedRelay.getMany(queryPubkey, {
        kinds: [1111],
        '#E': [clipEvent.id],
        limit: 200,
      }),
    ]);

    const uniqueCommentIds = new Set<string>();
    for (const commentEvent of [...lowercaseTagComments, ...uppercaseTagComments]) {
      uniqueCommentIds.add(commentEvent.id);
    }

    return uniqueCommentIds.size;
  }

  private stopInteractionsRefreshTimer(): void {
    if (!this.interactionsRefreshTimer) {
      return;
    }

    clearInterval(this.interactionsRefreshTimer);
    this.interactionsRefreshTimer = null;
  }
}
