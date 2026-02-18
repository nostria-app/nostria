import { Component, computed, inject, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event } from 'nostr-tools';
import { ReactionButtonComponent } from '../../../components/event/reaction-button/reaction-button.component';
import { ZapButtonComponent } from '../../../components/zap-button/zap-button.component';
import { InlineVideoPlayerComponent } from '../../../components/inline-video-player/inline-video-player.component';
import { BookmarkService } from '../../../services/bookmark.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { ApplicationService } from '../../../services/application.service';

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
  private app = inject(ApplicationService);

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

    const eventUrl = `https://nostria.app/e/${this.event().id}`;
    const shareData = {
      title: this.title(),
      text: this.description() || 'Check this clip on Nostria',
      url: eventUrl,
    };

    if (this.app.isBrowser() && typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // fall back to clipboard
      }
    }

    if (this.app.isBrowser() && navigator?.clipboard) {
      await navigator.clipboard.writeText(eventUrl);
      this.snackBar.open('Link copied to clipboard', 'Dismiss', { duration: 2500 });
      return;
    }

    this.snackBar.open(eventUrl, 'Dismiss', { duration: 4000 });
  }

  private getNumericTag(tagName: string): number {
    const raw = this.event().tags.find(tag => tag[0] === tagName)?.[1];
    if (!raw) return 0;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return 0;
    return parsed;
  }
}
