import { Component, computed, inject, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event } from 'nostr-tools';
import { ReactionButtonComponent } from '../../../components/event/reaction-button/reaction-button.component';
import { ZapButtonComponent } from '../../../components/zap-button/zap-button.component';
import { InlineVideoPlayerComponent } from '../../../components/inline-video-player/inline-video-player.component';
import { ShareArticleDialogComponent, ShareArticleDialogData } from '../../../components/share-article-dialog/share-article-dialog.component';
import { BookmarkService } from '../../../services/bookmark.service';
import { CustomDialogService } from '../../../services/custom-dialog.service';
import { UserRelaysService } from '../../../services/relays/user-relays';
import { UtilitiesService } from '../../../services/utilities.service';

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
export class ClipsVideoCardComponent {
  event = input.required<Event>();
  active = input<boolean>(true);

  commentsClick = output<void>();

  bookmark = inject(BookmarkService);
  private utilities = inject(UtilitiesService);
  private snackBar = inject(MatSnackBar);
  private customDialog = inject(CustomDialogService);
  private userRelaysService = inject(UserRelaysService);

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

  likesCount = computed(() => this.getNumericTag('likes'));
  commentsCount = computed(() => this.getNumericTag('comments'));
  sharesCount = computed(() => this.getNumericTag('reposts'));

  async toggleBookmark(event: MouseEvent): Promise<void> {
    event.stopPropagation();
    await this.bookmark.toggleBookmark(this.event().id);
  }

  onComments(event: MouseEvent): void {
    event.stopPropagation();
    this.commentsClick.emit();
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
}
