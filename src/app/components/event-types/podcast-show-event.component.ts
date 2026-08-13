import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Event as NostrEvent } from 'nostr-tools';
import { LayoutService } from '../../services/layout.service';
import { PodcastDataService } from '../../services/podcast-data.service';
import { MediaPlayerService } from '../../services/media-player.service';
import { DataService } from '../../services/data.service';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { PodcastShowMenuComponent } from '../podcast-show-menu/podcast-show-menu.component';
import { EditShowDialogComponent } from '../../pages/podcasts/edit-show-dialog/edit-show-dialog.component';
import { MediaItem } from '../../interfaces';
import {
  getPodcastDescription,
  getPodcastImage,
  getPodcastTitle,
  getPrimaryPodcastAudioUrl,
} from '../../utils/podcast';

@Component({
  selector: 'app-podcast-show-event',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, UserProfileComponent, PodcastShowMenuComponent, EditShowDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="show-card" [class.compact]="compact()" (click)="openShow($event)" (keydown.enter)="openShow($event)"
      tabindex="0" role="button" [attr.aria-label]="title()">
      <div class="cover">
        @if (image()) {
          <img [src]="image()" [alt]="title()" loading="lazy" />
        } @else {
          <div class="cover-fallback"><mat-icon>podcasts</mat-icon></div>
        }
      </div>
      <div class="info">
        @if (!compact()) {
          <app-user-profile [pubkey]="event().pubkey" mode="list"></app-user-profile>
        }
        <span class="title">{{ title() }}</span>
        @if (description()) {
          <p class="description">{{ description() }}</p>
        }
        <span class="meta">{{ episodeCountLabel() }}</span>
      </div>
      <div class="actions">
        @if (!compact() && latestEpisode(); as episode) {
          <button mat-icon-button (click)="playLatest($event)" aria-label="Play latest episode">
            <mat-icon>play_arrow</mat-icon>
          </button>
        }
        <button mat-icon-button [matMenuTriggerFor]="showMenu.menu" (click)="$event.stopPropagation()" aria-label="More options">
          <mat-icon>more_vert</mat-icon>
        </button>
      </div>
    </div>

    <app-podcast-show-menu #showMenu="podcastShowMenu" [event]="event()" (editRequested)="openEditShow()" />
    @if (showEditDialog()) {
      <app-edit-show-dialog (closed)="onEditClosed()" />
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; }

    .show-card {
      position: relative;
      display: flex;
      gap: 12px;
      padding: 12px;
      margin: 0.5rem 0;
      border-radius: 12px;
      background: var(--mat-sys-surface-container-low);
      cursor: pointer;
      align-items: center;

      &:hover { background: var(--mat-sys-surface-container); }

      &.compact {
        flex-direction: column;
        align-items: stretch;
        padding: 0;
        overflow: hidden;

        .cover { width: 100%; height: auto; aspect-ratio: 1; border-radius: 12px 12px 0 0; }
        .info { padding: 0.5rem 0.75rem 0.75rem; padding-right: 2.5rem; }
        .actions {
          position: absolute;
          top: 8px;
          right: 8px;

          button {
            background: color-mix(in srgb, var(--mat-sys-surface) 82%, transparent);
          }
        }
      }
    }

    .cover {
      width: 88px;
      height: 88px;
      border-radius: 10px;
      overflow: hidden;
      flex-shrink: 0;
      background: var(--mat-sys-primary-container);

      img { width: 100%; height: 100%; object-fit: cover; }
    }

    .cover-fallback {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--mat-sys-on-primary-container);

      mat-icon { font-size: 36px; width: 36px; height: 36px; }
    }

    .info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .title {
      color: var(--mat-sys-on-surface);
      font-size: 1rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .description {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.8125rem;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .meta {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.75rem;
    }

    .actions {
      display: flex;
      align-items: center;
    }
  `],
})
export class PodcastShowEventComponent {
  private layout = inject(LayoutService);
  private podcastData = inject(PodcastDataService);
  private mediaPlayer = inject(MediaPlayerService);
  private data = inject(DataService);
  private snackBar = inject(MatSnackBar);

  readonly event = input.required<NostrEvent>();
  readonly compact = input(false);
  readonly showEditDialog = signal(false);

  readonly title = computed(() => getPodcastTitle(this.event()) || $localize`:@@podcasts.untitledShow:Untitled podcast`);
  readonly description = computed(() => getPodcastDescription(this.event()) || '');
  readonly image = computed(() => getPodcastImage(this.event()) || '');
  readonly latestEpisode = computed(() => this.podcastData.getEpisodesForShow(this.event().pubkey)[0] ?? null);
  readonly episodeCountLabel = computed(() => {
    const count = this.podcastData.getEpisodesForShow(this.event().pubkey).length;
    return count === 1
      ? $localize`:@@podcasts.episodeCount.one:1 episode`
      : $localize`:@@podcasts.episodeCount.other:${count}:count: episodes`;
  });

  openShow(domEvent: Event): void {
    domEvent.stopPropagation();
    this.layout.openPodcastShow(this.event().pubkey);
  }

  async playLatest(domEvent: Event): Promise<void> {
    domEvent.stopPropagation();
    const episode = this.latestEpisode();
    if (!episode) {
      return;
    }

    const source = getPrimaryPodcastAudioUrl(episode);
    if (!source) {
      this.snackBar.open($localize`:@@podcasts.error.noAudio:No audio URL found`, '', { duration: 3000 });
      return;
    }

    let artist = getPodcastTitle(this.event());
    if (!artist) {
      try {
        const profile = await this.data.getProfile(episode.pubkey);
        artist = profile?.data?.display_name || profile?.data?.name || this.title();
      } catch {
        artist = this.title();
      }
    }

    const mediaItem: MediaItem = {
      source,
      title: getPodcastTitle(episode) || $localize`:@@podcasts.untitled:Untitled episode`,
      artist: artist || this.title(),
      artwork: getPodcastImage(episode) || this.image() || '/icons/icon-192x192.png',
      type: 'Podcast',
      eventPubkey: episode.pubkey,
      eventIdentifier: episode.id,
      eventKind: episode.kind,
    };
    this.mediaPlayer.play(mediaItem);
  }

  openEditShow(): void {
    this.showEditDialog.set(true);
  }

  onEditClosed(): void {
    this.showEditDialog.set(false);
  }
}
