import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SafeHtml } from '@angular/platform-browser';
import { Event as NostrEvent, nip19 } from 'nostr-tools';
import { DataService } from '../../../services/data.service';
import { DatabaseService } from '../../../services/database.service';
import { FormatService } from '../../../services/format/format.service';
import { LayoutService } from '../../../services/layout.service';
import { PanelNavigationService } from '../../../services/panel-navigation.service';
import { MediaPlayerService } from '../../../services/media-player.service';
import { PodcastDataService } from '../../../services/podcast-data.service';
import { PodcastFavoritesService } from '../../../services/podcast-favorites.service';
import { AccountStateService } from '../../../services/account-state.service';
import { ApplicationService } from '../../../services/application.service';
import { CustomDialogService } from '../../../services/custom-dialog.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { UserRelaysService } from '../../../services/relays/user-relays';
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';
import { DateToggleComponent } from '../../../components/date-toggle/date-toggle.component';
import { PodcastEpisodeMenuComponent } from '../../../components/podcast-episode-menu/podcast-episode-menu.component';
import { EventActionsToolbarComponent } from '../../../components/event-actions-toolbar/event-actions-toolbar.component';
import { CommentsListComponent } from '../../../components/comments-list/comments-list.component';
import { BookmarkListSelectorComponent } from '../../../components/bookmark-list-selector/bookmark-list-selector.component';
import { ShareArticleDialogComponent, ShareArticleDialogData } from '../../../components/share-article-dialog/share-article-dialog.component';
import { MediaItem } from '../../../interfaces';
import {
  formatPodcastDuration,
  getPodcastDescription,
  getPodcastDurationSeconds,
  getPodcastImage,
  getPodcastTitle,
  getPrimaryPodcastAudioUrl,
} from '../../../utils/podcast';

@Component({
  selector: 'app-podcast-episode',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    UserProfileComponent,
    DateToggleComponent,
    PodcastEpisodeMenuComponent,
    EventActionsToolbarComponent,
    CommentsListComponent,
  ],
  template: `
    <div class="panel-header">
      <button mat-icon-button (click)="goBack()" matTooltip="Back">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h2 class="panel-title title-font">{{ title() }}</h2>
      <span class="panel-header-spacer"></span>
      @if (episode(); as currentEpisode) {
        <app-podcast-episode-menu #episodeMenu="podcastEpisodeMenu" [event]="currentEpisode" (deleted)="goBack()" />
        <button mat-icon-button [matMenuTriggerFor]="episodeMenu.menu" aria-label="More options">
          <mat-icon>more_vert</mat-icon>
        </button>
      }
    </div>

    @if (loading()) {
      <div class="empty"><mat-spinner diameter="40"></mat-spinner></div>
    } @else if (!episode()) {
      <div class="empty">
        <mat-icon>podcasts</mat-icon>
        <p i18n="@@podcasts.episode.notFound">Episode not found.</p>
      </div>
    } @else {
      <div class="page">
        <div class="hero">
          <div class="cover">
            @if (image()) {
              <button type="button" class="cover-button" (click)="openCoverPreview()" [attr.aria-label]="title()">
                <img [src]="image()" [alt]="title()" />
              </button>
            } @else {
              <mat-icon>podcasts</mat-icon>
            }
          </div>
          <div class="hero-info">
            <h1>{{ title() }}</h1>
            <button type="button" class="show-link" (click)="openShow()">{{ showTitle() }}</button>
            <div class="hero-meta">
              <app-date-toggle [date]="episode()!.created_at"></app-date-toggle>
              @if (durationLabel()) {
                <span>{{ durationLabel() }}</span>
              }
            </div>
            <app-user-profile [pubkey]="episode()!.pubkey" mode="list"></app-user-profile>
            @if (description()) {
              <p>{{ description() }}</p>
            }
            <div class="hero-actions">
              <button mat-flat-button (click)="play()">
                <mat-icon>{{ isPlaying() ? 'pause' : 'play_arrow' }}</mat-icon>
                <span>{{ isPlaying() ? pauseLabel : playLabel }}</span>
              </button>
              @if (isAuthenticated()) {
                <button mat-stroked-button (click)="toggleFavorite()">
                  <mat-icon>{{ isFavorite() ? 'bookmark' : 'bookmark_border' }}</mat-icon>
                  <span>{{ isFavorite() ? unfavoriteLabel : favoriteLabel }}</span>
                </button>
              }
            </div>
            @if (progressPercent() > 0) {
              <div class="progress">
                <span [style.width.%]="progressPercent()"></span>
              </div>
              <span class="progress-label">{{ progressLabel() }}</span>
            }
          </div>
        </div>

        <app-event-actions-toolbar
          [event]="episode()!"
          bookmarkType="e"
          likeTapBehavior="like"
          (replyClick)="scrollToComments()"
          (bookmarkClick)="onBookmarkClick($event)"
          (shareClick)="shareEpisode()"
        />

        @if (contentHtml()) {
          <article class="notes" [innerHTML]="contentHtml()"></article>
        }

        <div class="comments-section" #commentsSection>
          <app-comments-list
            [event]="episode()!"
            [autoExpand]="true"
            [label]="commentsLabel"
            [singularLabel]="commentLabel"
            [allowedKinds]="[1111]"
          />
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .panel-header {
      position: sticky; top: 0; z-index: 50; display: flex; align-items: center; gap: 8px;
      min-height: 56px; padding: 0 16px;
      background: color-mix(in srgb, var(--mat-sys-surface) 92%, transparent);
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .panel-title { margin: 0; font-size: 1.25rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .panel-header-spacer { flex: 1; }
    .page { padding: 1rem 1rem 120px; display: flex; flex-direction: column; gap: 1.5rem; min-width: 0; }
    .hero { display: flex; gap: 1.25rem; }
    .cover {
      width: 180px; height: 180px; border-radius: 16px; overflow: hidden; flex-shrink: 0;
      background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container);
      display: flex; align-items: center; justify-content: center;
      img { width: 100%; height: 100%; object-fit: cover; }
      mat-icon { font-size: 72px; width: 72px; height: 72px; }
      .cover-button {
        padding: 0; border: 0; background: transparent; cursor: pointer;
        display: flex; width: 100%; height: 100%;
      }
    }
    .hero-info { min-width: 0; display: flex; flex-direction: column; gap: 0.5rem; }
    h1 { margin: 0; font-size: 1.75rem; color: var(--mat-sys-on-surface); }
    .show-link {
      border: 0; background: transparent; padding: 0; text-align: left; cursor: pointer;
      color: var(--mat-sys-primary);
    }
    .hero-meta {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.875rem;
    }
    p {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .hero-actions { display: flex; flex-wrap: wrap; gap: 0.75rem; }
    .progress {
      height: 4px; border-radius: 999px; background: var(--mat-sys-surface-container-high);
      span { display: block; height: 100%; background: var(--mat-sys-primary); border-radius: inherit; }
    }
    .progress-label { font-size: 0.75rem; color: var(--mat-sys-on-surface-variant); }
    .comments-section { min-width: 0; }
    .notes {
      min-width: 0;
      max-width: 100%;
      overflow-x: hidden;
      color: var(--mat-sys-on-surface);
      line-height: 1.6;
      overflow-wrap: anywhere;
      word-break: break-word;

      :where(a, code, span) {
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      pre {
        max-width: 100%;
        overflow-x: auto;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
    }
    .empty { display: flex; flex-direction: column; align-items: center; gap: 1rem; padding: 3rem 1rem; color: var(--mat-sys-on-surface-variant); }
    @media (max-width: 600px) {
      .hero { flex-direction: column; }
      .cover { width: 100%; height: auto; aspect-ratio: 1; }
    }
  `],
})
export class PodcastEpisodeComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private panelNav = inject(PanelNavigationService);
  private data = inject(DataService);
  private database = inject(DatabaseService);
  private formatService = inject(FormatService);
  private layout = inject(LayoutService);
  private mediaPlayer = inject(MediaPlayerService);
  private podcastData = inject(PodcastDataService);
  private favorites = inject(PodcastFavoritesService);
  private accountState = inject(AccountStateService);
  private app = inject(ApplicationService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private customDialog = inject(CustomDialogService);
  private utilities = inject(UtilitiesService);
  private userRelays = inject(UserRelaysService);
  private readonly commentsSection = viewChild<ElementRef<HTMLElement>>('commentsSection');

  readonly loading = signal(true);
  readonly episode = signal<NostrEvent | null>(null);
  readonly contentHtml = signal<SafeHtml | string>('');
  readonly isAuthenticated = computed(() => this.app.authenticated());
  readonly title = computed(() => {
    const episode = this.episode();
    return episode ? getPodcastTitle(episode) || $localize`:@@podcasts.untitled:Untitled episode` : '';
  });
  readonly description = computed(() => {
    const episode = this.episode();
    return episode ? getPodcastDescription(episode) || '' : '';
  });
  readonly image = computed(() => {
    const episode = this.episode();
    if (!episode) return '';
    return getPodcastImage(episode) || getPodcastImage(this.podcastData.getShow(episode.pubkey) ?? episode) || '';
  });
  readonly showTitle = computed(() => {
    const episode = this.episode();
    if (!episode) return '';
    const show = this.podcastData.getShow(episode.pubkey);
    return getPodcastTitle(show ?? episode) || $localize`:@@podcasts.unknownShow:Podcast`;
  });
  readonly audioUrl = computed(() => {
    const episode = this.episode();
    return episode ? getPrimaryPodcastAudioUrl(episode) || '' : '';
  });
  readonly isFavorite = computed(() => {
    const episode = this.episode();
    return episode ? this.favorites.isFavoriteShow(episode.pubkey) : false;
  });
  readonly isPlaying = computed(() => {
    const current = this.mediaPlayer.current();
    const url = this.audioUrl();
    const episode = this.episode();
    return !!current && current.type === 'Podcast' && (!!url && current.source === url || current.eventIdentifier === episode?.id);
  });
  readonly progressPercent = computed(() => {
    const progress = this.mediaPlayer.getPodcastProgress(this.audioUrl());
    if (!progress?.duration) return 0;
    return Math.min(100, Math.round((progress.position / progress.duration) * 100));
  });
  readonly progressLabel = computed(() => {
    const progress = this.mediaPlayer.getPodcastProgress(this.audioUrl());
    if (!progress) return '';
    return `${formatPodcastDuration(progress.position) || '0:00'} / ${formatPodcastDuration(progress.duration) || ''}`;
  });
  readonly durationLabel = computed(() => {
    const episode = this.episode();
    if (!episode) {
      return '';
    }
    const progress = this.mediaPlayer.getPodcastProgress(this.audioUrl());
    return formatPodcastDuration(progress?.duration ?? getPodcastDurationSeconds(episode) ?? null) || '';
  });
  readonly playLabel = $localize`:@@podcasts.action.play:Play`;
  readonly pauseLabel = $localize`:@@podcasts.action.pause:Pause`;
  readonly favoriteLabel = $localize`:@@podcasts.action.favorite:Favorite show`;
  readonly unfavoriteLabel = $localize`:@@podcasts.action.unfavorite:Unfavorite show`;
  readonly commentsLabel = $localize`:@@podcasts.comments:Comments`;
  readonly commentLabel = $localize`:@@podcasts.comment:Comment`;

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    await this.podcastData.ensureInitialized();
    const raw = this.route.snapshot.paramMap.get('id') || '';
    const eventId = this.decodeEventId(raw);
    const stateEvent = typeof history !== 'undefined'
      ? (history.state as { podcastEpisode?: NostrEvent } | undefined)?.podcastEpisode
      : undefined;
    const cached = (stateEvent?.id === eventId ? stateEvent : null)
      ?? this.podcastData.episodes().find(episode => episode.id === eventId)
      ?? await this.database.getEventById(eventId)
      ?? (await this.data.getEventById(eventId, { cache: true }))?.event
      ?? null;

    if (cached) {
      this.podcastData.addEpisode(cached);
      this.episode.set(cached);
      if (cached.content) {
        this.contentHtml.set(this.formatService.markdownToHtmlNonBlocking(cached.content, html => {
          this.contentHtml.set(html);
        }));
      }
    }

    this.loading.set(false);
  }

  private decodeEventId(value: string): string {
    if (value.startsWith('nevent') || value.startsWith('note')) {
      try {
        const decoded = nip19.decode(value);
        if (decoded.type === 'nevent') return decoded.data.id;
        if (decoded.type === 'note') return decoded.data;
      } catch {
        return value;
      }
    }
    return value;
  }

  async play(): Promise<void> {
    const episode = this.episode();
    if (!episode) return;
    if (this.isPlaying()) {
      if (this.mediaPlayer.paused) {
        void this.mediaPlayer.resume();
      } else {
        this.mediaPlayer.pause();
      }
      return;
    }

    const source = this.audioUrl();
    if (!source) {
      this.snackBar.open($localize`:@@podcasts.error.noAudio:No audio URL found`, '', { duration: 3000 });
      return;
    }

    const mediaItem: MediaItem = {
      source,
      title: this.title(),
      artist: this.showTitle(),
      artwork: this.image() || '/icons/icon-192x192.png',
      type: 'Podcast',
      eventPubkey: episode.pubkey,
      eventIdentifier: episode.id,
      eventKind: episode.kind,
    };
    this.mediaPlayer.play(mediaItem);
  }

  async openCoverPreview(): Promise<void> {
    const url = this.image();
    if (!url) {
      return;
    }

    const { MediaPreviewDialogComponent } = await import(
      '../../../components/media-preview-dialog/media-preview.component'
    );
    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaUrl: url,
        mediaType: 'image',
        mediaTitle: this.title(),
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      panelClass: 'image-dialog-panel',
    });
  }

  openShow(): void {
    const episode = this.episode();
    if (episode) {
      this.layout.openPodcastShow(episode.pubkey);
    }
  }

  async toggleFavorite(): Promise<void> {
    const episode = this.episode();
    if (!episode || !this.accountState.pubkey()) return;
    await this.favorites.toggleShow(episode.pubkey);
  }

  scrollToComments(): void {
    this.commentsSection()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async shareEpisode(): Promise<void> {
    const ev = this.episode();
    if (!ev) {
      return;
    }

    const encoded = await this.encodeNevent(ev);
    const title = this.title();
    const dialogData: ShareArticleDialogData = {
      title,
      summary: $localize`:@@podcasts.share.summary:Listen to ${title}:title:`,
      image: this.image() || undefined,
      url: `https://nostria.app/podcasts/episode/${encoded}`,
      eventId: ev.id,
      pubkey: ev.pubkey,
      kind: ev.kind,
      encodedId: encoded,
      event: ev,
    };

    this.customDialog.open(ShareArticleDialogComponent, {
      title: $localize`:@@podcasts.action.share:Share`,
      showCloseButton: true,
      data: dialogData,
      width: '560px',
      maxWidth: 'min(560px, calc(100vw - 24px))',
    });
  }

  async onBookmarkClick(event: MouseEvent): Promise<void> {
    event.stopPropagation();
    const ev = this.episode();
    if (!ev) {
      return;
    }

    await this.userRelays.ensureRelaysForPubkey(ev.pubkey);
    const relayHint = this.userRelays.getRelaysForPubkey(ev.pubkey)[0];
    this.dialog.open(BookmarkListSelectorComponent, {
      data: {
        itemId: ev.id,
        type: 'e',
        eventKind: ev.kind,
        pubkey: ev.pubkey,
        relay: relayHint,
      },
      width: '400px',
      panelClass: 'responsive-dialog',
    });
  }

  private async encodeNevent(ev: NostrEvent): Promise<string> {
    try {
      const relays = this.utilities.getShareRelayHints(
        await this.userRelays.getUserRelaysForPublishing(ev.pubkey)
      );
      return nip19.neventEncode({
        id: ev.id,
        author: ev.pubkey,
        kind: ev.kind,
        relays: relays.length > 0 ? relays : undefined,
      });
    } catch {
      return ev.id;
    }
  }

  goBack(): void {
    if (this.route.outlet === 'right') {
      this.panelNav.goBackRight();
      return;
    }
    void this.router.navigate(['/podcasts']);
  }
}
