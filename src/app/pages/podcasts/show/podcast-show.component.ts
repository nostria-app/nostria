import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event as NostrEvent, nip19 } from 'nostr-tools';
import { PanelNavigationService } from '../../../services/panel-navigation.service';
import { PodcastDataService } from '../../../services/podcast-data.service';
import { PodcastFavoritesService } from '../../../services/podcast-favorites.service';
import { MediaPlayerService } from '../../../services/media-player.service';
import { AccountStateService } from '../../../services/account-state.service';
import { ApplicationService } from '../../../services/application.service';
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';
import { PodcastEventComponent } from '../../../components/event-types/podcast-event.component';
import { PodcastShowMenuComponent } from '../../../components/podcast-show-menu/podcast-show-menu.component';
import { EditShowDialogComponent } from '../edit-show-dialog/edit-show-dialog.component';
import { EventActionsToolbarComponent } from '../../../components/event-actions-toolbar/event-actions-toolbar.component';
import { CommentsListComponent } from '../../../components/comments-list/comments-list.component';
import { BookmarkListSelectorComponent } from '../../../components/bookmark-list-selector/bookmark-list-selector.component';
import { ShareArticleDialogComponent, ShareArticleDialogData } from '../../../components/share-article-dialog/share-article-dialog.component';
import { CustomDialogService } from '../../../services/custom-dialog.service';
import { UserRelaysService } from '../../../services/relays/user-relays';
import { MediaItem } from '../../../interfaces';
import {
  getPodcastAuthors,
  getPodcastDescription,
  getPodcastImage,
  getPodcastTitle,
  getPodcastWebsites,
  getPrimaryPodcastAudioUrl,
} from '../../../utils/podcast';

@Component({
  selector: 'app-podcast-show',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    UserProfileComponent,
    PodcastEventComponent,
    PodcastShowMenuComponent,
    EditShowDialogComponent,
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
      @if (isAuthenticated()) {
        <button mat-icon-button (click)="toggleFavorite()" [matTooltip]="isFavorite() ? unfavoriteLabel : favoriteLabel">
          <mat-icon>{{ isFavorite() ? 'bookmark' : 'bookmark_border' }}</mat-icon>
        </button>
      }
      @if (show(); as currentShow) {
        <app-podcast-show-menu #showMenu="podcastShowMenu" [event]="currentShow" (editRequested)="openEditShow()" (deleted)="goBack()" />
        <button mat-icon-button [matMenuTriggerFor]="showMenu.menu" aria-label="More options">
          <mat-icon>more_vert</mat-icon>
        </button>
      }
    </div>

    @if (loading()) {
      <div class="empty"><mat-spinner diameter="40"></mat-spinner></div>
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
            <app-user-profile [pubkey]="pubkey()" mode="list"></app-user-profile>
            @if (description()) {
              <p>{{ description() }}</p>
            }
            @if (website(); as site) {
              <a [href]="site" target="_blank" rel="noopener noreferrer">{{ site }}</a>
            }
            <div class="hero-actions">
              <button mat-flat-button (click)="playAll()" [disabled]="episodes().length === 0">
                <mat-icon>play_arrow</mat-icon>
                <span i18n="@@podcasts.playAll">Play all</span>
              </button>
              <span class="count">{{ episodes().length }} {{ episodes().length === 1 ? 'episode' : 'episodes' }}</span>
            </div>
          </div>
        </div>

        @if (show(); as currentShow) {
          <app-event-actions-toolbar
            [event]="currentShow"
            bookmarkType="e"
            likeTapBehavior="like"
            (replyClick)="scrollToComments()"
            (bookmarkClick)="onBookmarkClick($event)"
            (shareClick)="shareShow()"
          />
        }

        @if (episodes().length === 0) {
          <div class="empty">
            <p i18n="@@podcasts.show.noEpisodes">No episodes from this show yet.</p>
          </div>
        } @else {
          @for (episode of episodes(); track episode.id; let i = $index) {
            <app-podcast-event [event]="episode" mode="row" [queueEpisodes]="episodes()" [queueIndex]="i"></app-podcast-event>
          }
        }

        @if (show(); as currentShow) {
          <div class="comments-section" #commentsSection>
            <app-comments-list
              [event]="currentShow"
              [autoExpand]="true"
              [label]="commentsLabel"
              [singularLabel]="commentLabel"
              [allowedKinds]="[1111]"
            />
          </div>
        }
      </div>
    }

    @if (showEditDialog()) {
      <app-edit-show-dialog (closed)="onEditClosed()" />
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
    .page { padding: 1rem 1rem 120px; }
    .hero { display: flex; gap: 1.25rem; margin-bottom: 1.5rem; }
    .cover {
      width: 160px; height: 160px; border-radius: 16px; overflow: hidden; flex-shrink: 0;
      background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container);
      display: flex; align-items: center; justify-content: center;
      img { width: 100%; height: 100%; object-fit: cover; }
      mat-icon { font-size: 64px; width: 64px; height: 64px; }
      .cover-button {
        padding: 0; border: 0; background: transparent; cursor: pointer;
        display: flex; width: 100%; height: 100%;
      }
    }
    .hero-info { min-width: 0; display: flex; flex-direction: column; gap: 0.5rem; }
    h1 { margin: 0; font-size: 1.75rem; color: var(--mat-sys-on-surface); }
    p, a {
      color: var(--mat-sys-on-surface-variant);
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .hero-actions { display: flex; align-items: center; gap: 1rem; }
    .count { color: var(--mat-sys-on-surface-variant); }
    .comments-section { margin-top: 1.5rem; min-width: 0; }
    .empty { display: flex; justify-content: center; padding: 3rem 1rem; color: var(--mat-sys-on-surface-variant); }
    @media (max-width: 600px) {
      .hero { flex-direction: column; }
      .cover { width: 100%; height: auto; aspect-ratio: 1; }
    }
  `],
})
export class PodcastShowComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private panelNav = inject(PanelNavigationService);
  private podcastData = inject(PodcastDataService);
  private favorites = inject(PodcastFavoritesService);
  private mediaPlayer = inject(MediaPlayerService);
  private accountState = inject(AccountStateService);
  private app = inject(ApplicationService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private customDialog = inject(CustomDialogService);
  private userRelays = inject(UserRelaysService);
  private readonly commentsSection = viewChild<ElementRef<HTMLElement>>('commentsSection');

  readonly refreshing = signal(false);
  readonly showEditDialog = signal(false);
  readonly pubkey = signal('');
  readonly show = computed(() => {
    this.podcastData.shows();
    return this.podcastData.getShow(this.pubkey()) ?? null;
  });
  readonly episodes = computed(() => {
    this.podcastData.episodes();
    return this.podcastData.getEpisodesForShow(this.pubkey());
  });
  readonly loading = computed(() => {
    if (!this.pubkey()) {
      return true;
    }
    const hasCache = !!this.show() || this.episodes().length > 0;
    return !hasCache && this.refreshing();
  });
  readonly isAuthenticated = computed(() => this.app.authenticated());
  readonly isFavorite = computed(() => this.favorites.isFavoriteShow(this.pubkey()));
  readonly title = computed(() => getPodcastTitle(this.show() ?? { tags: [] } as unknown as NostrEvent) || $localize`:@@podcasts.untitledShow:Untitled podcast`);
  readonly description = computed(() => getPodcastDescription(this.show() ?? { tags: [] } as unknown as NostrEvent) || '');
  readonly image = computed(() => getPodcastImage(this.show() ?? { tags: [] } as unknown as NostrEvent) || '');
  readonly website = computed(() => getPodcastWebsites(this.show() ?? { tags: [] } as unknown as NostrEvent)[0] || '');
  readonly authors = computed(() => getPodcastAuthors(this.show() ?? { tags: [] } as unknown as NostrEvent));
  readonly favoriteLabel = $localize`:@@podcasts.action.favorite:Favorite show`;
  readonly unfavoriteLabel = $localize`:@@podcasts.action.unfavorite:Unfavorite show`;
  readonly commentsLabel = $localize`:@@podcasts.comments:Comments`;
  readonly commentLabel = $localize`:@@podcasts.comment:Comment`;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(params => {
      void this.loadShow(params.get('pubkey') || '');
    });
  }

  private async loadShow(raw: string): Promise<void> {
    const pubkey = this.decodePubkey(raw);
    this.pubkey.set(pubkey);
    if (!pubkey) {
      return;
    }

    await this.podcastData.ensureInitialized();

    this.refreshing.set(true);
    try {
      await this.podcastData.refreshShowAndEpisodes(pubkey);
    } finally {
      if (this.pubkey() === pubkey) {
        this.refreshing.set(false);
      }
    }
  }

  private decodePubkey(value: string): string {
    if (value.startsWith('npub') || value.startsWith('nprofile')) {
      try {
        const decoded = nip19.decode(value);
        if (decoded.type === 'npub') return decoded.data;
        if (decoded.type === 'nprofile') return decoded.data.pubkey;
      } catch {
        return value;
      }
    }
    return value;
  }

  async playAll(): Promise<void> {
    const items: MediaItem[] = [];
    for (const episode of this.episodes()) {
      const source = getPrimaryPodcastAudioUrl(episode);
      if (!source) continue;
      items.push({
        source,
        title: getPodcastTitle(episode) || $localize`:@@podcasts.untitled:Untitled episode`,
        artist: this.title(),
        artwork: getPodcastImage(episode) || this.image() || '/icons/icon-192x192.png',
        type: 'Podcast',
        eventPubkey: episode.pubkey,
        eventIdentifier: episode.id,
        eventKind: episode.kind,
      });
    }
    if (items.length === 0) {
      this.snackBar.open($localize`:@@podcasts.error.noAudio:No audio URL found`, '', { duration: 3000 });
      return;
    }
    this.mediaPlayer.replaceQueue(items, 0);
  }

  async toggleFavorite(): Promise<void> {
    if (!this.accountState.pubkey()) return;
    await this.favorites.toggleShow(this.pubkey());
  }

  scrollToComments(): void {
    this.commentsSection()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  shareShow(): void {
    const ev = this.show();
    if (!ev) {
      return;
    }

    const npub = nip19.npubEncode(ev.pubkey);
    const title = this.title();
    const dialogData: ShareArticleDialogData = {
      title,
      summary: this.description() || $localize`:@@podcasts.share.showSummary:Listen to ${title}:title:`,
      image: this.image() || undefined,
      url: `https://nostria.app/podcasts/show/${npub}`,
      eventId: ev.id,
      pubkey: ev.pubkey,
      kind: ev.kind,
      encodedId: npub,
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
    const ev = this.show();
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

  goBack(): void {
    if (this.route.outlet === 'right') {
      this.panelNav.goBackRight();
      return;
    }
    void this.router.navigate(['/podcasts']);
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

  openEditShow(): void {
    this.showEditDialog.set(true);
  }

  onEditClosed(): void {
    this.showEditDialog.set(false);
  }
}
