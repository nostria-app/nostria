import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event as NostrEvent } from 'nostr-tools';
import { MediaPlayerService } from '../../services/media-player.service';
import { LayoutService } from '../../services/layout.service';
import { DataService } from '../../services/data.service';
import { PodcastDataService } from '../../services/podcast-data.service';
import { DateToggleComponent } from '../date-toggle/date-toggle.component';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { PodcastEpisodeMenuComponent } from '../podcast-episode-menu/podcast-episode-menu.component';
import { MediaItem } from '../../interfaces';
import {
  formatPodcastDuration,
  getPodcastDescription,
  getPodcastImage,
  getPodcastTitle,
  getPrimaryPodcastAudioUrl,
} from '../../utils/podcast';

export type PodcastEventMode = 'list' | 'card' | 'row';

@Component({
  selector: 'app-podcast-event',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    DateToggleComponent,
    UserProfileComponent,
    PodcastEpisodeMenuComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (mode() === 'card') {
      <div class="podcast-card">
        <div class="cover" (click)="play($event)" (keydown.enter)="play($event)" tabindex="0" role="button"
          [attr.aria-label]="isPlaying() ? playPauseLabel.pause : playPauseLabel.play">
          @if (image()) {
            <img [src]="image()" [alt]="title()" loading="lazy" />
          } @else {
            <div class="cover-fallback"><mat-icon>podcasts</mat-icon></div>
          }
          <button mat-icon-button class="play-overlay" (click)="play($event)"
            [attr.aria-label]="isPlaying() ? playPauseLabel.pause : playPauseLabel.play">
            <mat-icon>{{ isPlaying() ? 'pause' : 'play_arrow' }}</mat-icon>
          </button>
          @if (progressPercent() > 0) {
            <div class="progress-bar"><span [style.width.%]="progressPercent()"></span></div>
          }
        </div>
        <div class="card-info">
          <div class="card-title-row">
            <a class="title" [href]="episodeHref()" (click)="openDetails($event)">{{ title() }}</a>
            <button mat-icon-button class="menu-btn" [matMenuTriggerFor]="episodeMenu.menu" (click)="$event.stopPropagation()" aria-label="More options">
              <mat-icon>more_vert</mat-icon>
            </button>
          </div>
          <a class="show" [href]="showHref()" (click)="openShow($event)">{{ showTitle() }}</a>
        </div>
      </div>
    } @else if (mode() === 'row') {
      <div class="podcast-row">
        <button mat-icon-button class="row-play" (click)="play($event)"
          [attr.aria-label]="isPlaying() ? playPauseLabel.pause : playPauseLabel.play">
          <mat-icon>{{ isPlaying() ? 'pause' : 'play_arrow' }}</mat-icon>
        </button>
        <button type="button" class="row-cover" (click)="play($event)"
          [attr.aria-label]="isPlaying() ? playPauseLabel.pause : playPauseLabel.play">
          @if (image()) {
            <img [src]="image()" [alt]="title()" loading="lazy" />
          } @else {
            <mat-icon>podcasts</mat-icon>
          }
        </button>
        <div class="row-main">
          <a class="row-title" [href]="episodeHref()" (click)="openDetails($event)">{{ title() }}</a>
          <a class="row-show" [href]="showHref()" (click)="openShow($event)">{{ showTitle() }}</a>
        </div>
        <span class="row-duration">{{ durationLabel() }}</span>
        <button mat-icon-button [matMenuTriggerFor]="episodeMenu.menu" (click)="$event.stopPropagation()" aria-label="More options">
          <mat-icon>more_horiz</mat-icon>
        </button>
      </div>
    } @else {
      <div class="podcast-list">
        <div class="list-cover" (click)="play($event)" (keydown.enter)="play($event)" tabindex="0" role="button"
          [attr.aria-label]="isPlaying() ? playPauseLabel.pause : playPauseLabel.play">
          @if (image()) {
            <img [src]="image()" [alt]="title()" loading="lazy" />
          } @else {
            <div class="cover-fallback"><mat-icon>podcasts</mat-icon></div>
          }
          @if (progressPercent() > 0) {
            <div class="progress-bar"><span [style.width.%]="progressPercent()"></span></div>
          }
        </div>
        <div class="list-info">
          <app-user-profile [pubkey]="event().pubkey" mode="list"></app-user-profile>
          <a class="title" [href]="episodeHref()" (click)="openDetails($event)">{{ title() }}</a>
          @if (description()) {
            <p class="description">{{ description() }}</p>
          }
          <div class="meta">
            <app-date-toggle [date]="event().created_at"></app-date-toggle>
            @if (durationLabel()) {
              <span>{{ durationLabel() }}</span>
            }
          </div>
        </div>
        <div class="list-actions">
          <button mat-icon-button class="play-btn" (click)="play($event)"
            [attr.aria-label]="isPlaying() ? playPauseLabel.pause : playPauseLabel.play">
            <mat-icon>{{ isPlaying() ? 'pause' : 'play_arrow' }}</mat-icon>
          </button>
          <button mat-icon-button [matMenuTriggerFor]="episodeMenu.menu" (click)="$event.stopPropagation()" aria-label="More options">
            <mat-icon>more_vert</mat-icon>
          </button>
        </div>
      </div>
    }

    <app-podcast-episode-menu #episodeMenu="podcastEpisodeMenu" [event]="event()" />
  `,
  styles: [`
    :host { display: block; min-width: 0; }

    .cover-fallback {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      background: linear-gradient(135deg, var(--mat-sys-primary-container), var(--mat-sys-tertiary-container));
      color: var(--mat-sys-on-primary-container);

      mat-icon {
        font-size: 36px;
        width: 36px;
        height: 36px;
        opacity: 0.8;
      }
    }

    .progress-bar {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 3px;
      background: color-mix(in srgb, var(--mat-sys-on-surface) 18%, transparent);

      span {
        display: block;
        height: 100%;
        background: var(--mat-sys-primary);
      }
    }

    .podcast-card {
      display: flex;
      flex-direction: column;
      border-radius: 12px;
      background: var(--mat-sys-surface-container-low);
      overflow: hidden;
      cursor: pointer;
      min-width: 0;

      &:hover, &:focus-within {
        background: var(--mat-sys-surface-container);
        .play-overlay { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      }

      .cover {
        position: relative;
        aspect-ratio: 1;
        overflow: hidden;
        cursor: pointer;

        img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
      }

      .play-overlay {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 56px;
        height: 56px;
        opacity: 0;
        transform: translate(-50%, -44%) scale(0.92);
        background: color-mix(in srgb, var(--mat-sys-surface-container-highest) 78%, transparent);
        color: var(--mat-sys-on-surface);
        padding: 0 !important;
        display: flex !important;
        align-items: center;
        justify-content: center;
      }

      .card-info {
        padding: 0.5rem 0.625rem;
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        min-width: 0;
      }

      .card-title-row {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        min-width: 0;

        .title { flex: 1; }
        .menu-btn {
          flex-shrink: 0;
          width: 28px;
          height: 28px;
          padding: 0 !important;
          display: flex !important;
          align-items: center;
          justify-content: center;
        }
      }

      .title, .show {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-decoration: none;
        width: fit-content;
        max-width: 100%;
        cursor: pointer;
      }

      .title {
        font-size: 0.875rem;
        color: var(--mat-sys-on-surface);

        &:hover { color: var(--mat-sys-primary); text-decoration: underline; }
      }

      .show {
        font-size: 0.75rem;
        color: var(--mat-sys-on-surface-variant);

        &:hover { color: var(--mat-sys-primary); text-decoration: underline; }
      }
    }

    .podcast-row {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      padding: 0.4rem 0.75rem;
      border-bottom: 1px solid color-mix(in srgb, var(--mat-sys-outline-variant) 78%, transparent);

      &:hover { background: color-mix(in srgb, var(--mat-sys-surface-container-high) 38%, transparent); }

      .row-play {
        width: 34px;
        height: 34px;
        padding: 0 !important;
        display: flex !important;
        align-items: center;
        justify-content: center;
        background: var(--mat-sys-surface-container);
      }

      .row-cover {
        width: 40px;
        height: 40px;
        padding: 0;
        border: 0;
        border-radius: var(--mat-sys-corner-extra-small);
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--mat-sys-primary-container);
        color: var(--mat-sys-on-primary-container);
        flex-shrink: 0;
        cursor: pointer;

        img { width: 100%; height: 100%; object-fit: cover; }
        mat-icon { font-size: 20px; width: 20px; height: 20px; }
      }

      .row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.125rem; }

      .row-title, .row-show {
        text-decoration: none;
        text-align: left;
        width: fit-content;
        max-width: 100%;
        cursor: pointer;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .row-title {
        color: var(--mat-sys-on-surface);
        font-size: 1rem;

        &:hover { color: var(--mat-sys-primary); text-decoration: underline; }
      }

      .row-show {
        color: var(--mat-sys-on-surface-variant);
        font-size: 0.8125rem;

        &:hover { color: var(--mat-sys-primary); text-decoration: underline; }
      }
      .row-duration {
        color: var(--mat-sys-on-surface-variant);
        font-variant-numeric: tabular-nums;
        font-size: 0.8125rem;
      }
    }

    .podcast-list {
      display: flex;
      align-items: stretch;
      gap: 12px;
      padding: 12px;
      margin: 0.5rem 0;
      border-radius: 12px;
      background: var(--mat-sys-surface-container-low);
      cursor: pointer;

      &:hover { background: var(--mat-sys-surface-container); }

      .list-cover {
        position: relative;
        width: 88px;
        height: 88px;
        border-radius: 10px;
        overflow: hidden;
        flex-shrink: 0;
        cursor: pointer;

        img { width: 100%; height: 100%; object-fit: cover; }
      }

      .list-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .title {
        font-size: 1rem;
        color: var(--mat-sys-on-surface);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-decoration: none;
        cursor: pointer;

        &:hover { color: var(--mat-sys-primary); text-decoration: underline; }
      }

      .description {
        margin: 0;
        color: var(--mat-sys-on-surface-variant);
        font-size: 0.8125rem;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .meta {
        display: flex;
        gap: 0.75rem;
        color: var(--mat-sys-on-surface-variant);
        font-size: 0.75rem;
      }

      .list-actions {
        display: flex;
        align-items: center;
        align-self: center;
      }

      .play-btn {
        background: var(--mat-sys-surface-container);
      }
    }
  `],
})
export class PodcastEventComponent {
  private mediaPlayer = inject(MediaPlayerService);
  private layout = inject(LayoutService);
  private data = inject(DataService);
  private podcastData = inject(PodcastDataService);
  private snackBar = inject(MatSnackBar);

  readonly event = input.required<NostrEvent>();
  readonly mode = input<PodcastEventMode>('list');
  readonly queueEpisodes = input<NostrEvent[] | undefined>(undefined);
  readonly queueIndex = input<number | null>(null);

  readonly playPauseLabel = {
    play: $localize`:@@podcasts.action.play:Play`,
    pause: $localize`:@@podcasts.action.pause:Pause`,
  };

  readonly title = computed(() => getPodcastTitle(this.event()) || $localize`:@@podcasts.untitled:Untitled episode`);
  readonly episodeHref = computed(() => `/podcasts/episode/${this.event().id}`);
  readonly showHref = computed(() => `/podcasts/show/${this.event().pubkey}`);
  readonly description = computed(() => getPodcastDescription(this.event()) || '');
  readonly image = computed(() => {
    const event = this.event();
    return getPodcastImage(event) || getPodcastImage(this.podcastData.getShow(event.pubkey) ?? event) || '';
  });
  readonly showTitle = computed(() => {
    const show = this.podcastData.getShow(this.event().pubkey);
    return getPodcastTitle(show ?? this.event()) || $localize`:@@podcasts.unknownShow:Podcast`;
  });
  readonly audioUrl = computed(() => getPrimaryPodcastAudioUrl(this.event()) || '');

  readonly isPlaying = computed(() => {
    const current = this.mediaPlayer.current();
    const url = this.audioUrl();
    if (!current || current.type !== 'Podcast' || !url) {
      return false;
    }
    return current.source === url || current.eventIdentifier === this.event().id;
  });

  readonly progressPercent = computed(() => {
    const progress = this.mediaPlayer.getPodcastProgress(this.audioUrl());
    if (!progress?.duration || progress.duration <= 0) {
      return 0;
    }
    return Math.min(100, Math.round((progress.position / progress.duration) * 100));
  });

  readonly durationLabel = computed(() => {
    const progress = this.mediaPlayer.getPodcastProgress(this.audioUrl());
    return formatPodcastDuration(progress?.duration ?? null) || '';
  });

  async play(domEvent: Event): Promise<void> {
    domEvent.stopPropagation();
    if (domEvent instanceof KeyboardEvent) {
      domEvent.preventDefault();
    }

    if (this.isPlaying()) {
      if (this.mediaPlayer.paused) {
        void this.mediaPlayer.resume();
      } else {
        this.mediaPlayer.pause();
      }
      return;
    }

    const queue = this.queueEpisodes();
    const index = this.queueIndex();
    if (queue && index != null && index >= 0) {
      const items = (await Promise.all(queue.map(episode => this.buildMediaItem(episode))))
        .filter((item): item is MediaItem => !!item);
      const startIndex = items.findIndex(item => item.eventIdentifier === this.event().id);
      if (items.length > 0 && startIndex >= 0) {
        this.mediaPlayer.replaceQueue(items, startIndex);
        return;
      }
    }

    const mediaItem = await this.buildMediaItem(this.event());
    if (!mediaItem) {
      this.snackBar.open($localize`:@@podcasts.error.noAudio:No audio URL found`, '', { duration: 3000 });
      return;
    }
    this.mediaPlayer.play(mediaItem);
  }

  openDetails(domEvent: Event): void {
    if (this.shouldKeepNativeNavigation(domEvent)) {
      return;
    }
    domEvent.preventDefault();
    domEvent.stopPropagation();
    this.layout.openPodcastEpisode(this.event().id, this.event());
  }

  openShow(domEvent: Event): void {
    if (this.shouldKeepNativeNavigation(domEvent)) {
      return;
    }
    domEvent.preventDefault();
    domEvent.stopPropagation();
    this.layout.openPodcastShow(this.event().pubkey);
  }

  private shouldKeepNativeNavigation(domEvent: Event): boolean {
    if (!(domEvent instanceof MouseEvent)) {
      return false;
    }
    return domEvent.metaKey || domEvent.ctrlKey || domEvent.shiftKey || domEvent.button === 1;
  }

  private async buildMediaItem(episode: NostrEvent): Promise<MediaItem | null> {
    const source = getPrimaryPodcastAudioUrl(episode);
    if (!source) {
      return null;
    }

    let artist = getPodcastTitle(this.podcastData.getShow(episode.pubkey) ?? episode);
    if (!artist) {
      try {
        const profile = await this.data.getProfile(episode.pubkey);
        artist = profile?.data?.display_name || profile?.data?.name || $localize`:@@podcasts.unknownShow:Podcast`;
      } catch {
        artist = $localize`:@@podcasts.unknownShow:Podcast`;
      }
    }

    return {
      source,
      title: getPodcastTitle(episode) || $localize`:@@podcasts.untitled:Untitled episode`,
      artist: artist || $localize`:@@podcasts.unknownShow:Podcast`,
      artwork: getPodcastImage(episode) || getPodcastImage(this.podcastData.getShow(episode.pubkey) ?? episode) || '/icons/icon-192x192.png',
      type: 'Podcast',
      eventPubkey: episode.pubkey,
      eventIdentifier: episode.id,
      eventKind: episode.kind,
    };
  }
}
