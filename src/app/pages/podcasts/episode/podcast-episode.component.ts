import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
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
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';
import { PodcastEpisodeMenuComponent } from '../../../components/podcast-episode-menu/podcast-episode-menu.component';
import { MediaItem } from '../../../interfaces';
import {
  formatPodcastDuration,
  getPodcastDescription,
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
    PodcastEpisodeMenuComponent,
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
              <img [src]="image()" [alt]="title()" />
            } @else {
              <mat-icon>podcasts</mat-icon>
            }
          </div>
          <div class="hero-info">
            <h1>{{ title() }}</h1>
            <button type="button" class="show-link" (click)="openShow()">{{ showTitle() }}</button>
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

        @if (contentHtml()) {
          <article class="notes" [innerHTML]="contentHtml()"></article>
        }
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
    }
    .hero-info { min-width: 0; display: flex; flex-direction: column; gap: 0.5rem; }
    h1 { margin: 0; font-size: 1.75rem; color: var(--mat-sys-on-surface); }
    .show-link {
      border: 0; background: transparent; padding: 0; text-align: left; cursor: pointer;
      color: var(--mat-sys-primary);
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
  readonly playLabel = $localize`:@@podcasts.action.play:Play`;
  readonly pauseLabel = $localize`:@@podcasts.action.pause:Pause`;
  readonly favoriteLabel = $localize`:@@podcasts.action.favorite:Favorite show`;
  readonly unfavoriteLabel = $localize`:@@podcasts.action.unfavorite:Unfavorite show`;

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

  goBack(): void {
    if (this.route.outlet === 'right') {
      this.panelNav.goBackRight();
      return;
    }
    void this.router.navigate(['/podcasts']);
  }
}
