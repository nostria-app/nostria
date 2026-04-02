import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Event, nip19 } from 'nostr-tools';
import { MusicBookmarkPlaylistService } from '../../../services/music-bookmark-playlist.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { MediaPlayerService } from '../../../services/media-player.service';
import { DatabaseService } from '../../../services/database.service';
import { DataService } from '../../../services/data.service';
import { LoggerService } from '../../../services/logger.service';
import { LayoutService } from '../../../services/layout.service';
import { MediaItem } from '../../../interfaces';

@Component({
  selector: 'app-music-bookmark-playlist',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="panel-header">
      <button mat-icon-button (click)="goBack()">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h2 class="panel-title title-font">Playlist</h2>
    </div>

    <div class="container">
      @if (loading()) {
        <div class="state"><mat-spinner diameter="42"></mat-spinner><p>Loading playlist...</p></div>
      } @else if (!playlist()) {
        <div class="state"><mat-icon>playlist_remove</mat-icon><p>Playlist not found.</p></div>
      } @else {
        <div class="hero">
          <div class="hero-art" [style.background]="gradient() || ''">
            @if (coverImage()) {
              <img [src]="coverImage()!" [alt]="title()" />
            } @else {
              <mat-icon>playlist_play</mat-icon>
            }
          </div>
          <div class="hero-info">
            <h1>{{ title() }}</h1>
            @if (description()) {
              <p>{{ description() }}</p>
            }
            <div class="meta">{{ tracks().length }} tracks</div>
            <div class="actions">
              <button mat-flat-button (click)="playAll()" [disabled]="tracks().length === 0">
                <mat-icon>play_arrow</mat-icon>
                <span>Play</span>
              </button>
            </div>
          </div>
        </div>

        <div class="track-list">
          @for (track of tracks(); track track.id; let i = $index) {
            <button type="button" class="track-row" (click)="playTrack(i)">
              <span class="index">{{ i + 1 }}</span>
              <span class="track-title">{{ getTrackTitle(track) }}</span>
              <span class="track-artist">{{ getTrackArtist(track) }}</span>
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .panel-header {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 56px;
      padding: 0 16px;
      background: color-mix(in srgb, var(--mat-sys-surface) 92%, transparent);
      backdrop-filter: blur(20px);
    }
    .panel-title { margin: 0; font-size: 1.25rem; }
    .container { padding: 1rem; padding-bottom: 120px; }
    .state {
      min-height: 260px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      color: var(--mat-sys-on-surface-variant);
      text-align: center;
    }
    .hero {
      display: grid;
      grid-template-columns: 160px 1fr;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .hero-art {
      aspect-ratio: 1;
      border-radius: 12px;
      overflow: hidden;
      background: linear-gradient(135deg, var(--mat-sys-primary-container), var(--mat-sys-secondary-container));
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .hero-art img { width: 100%; height: 100%; object-fit: cover; }
    .hero-art mat-icon { font-size: 4rem; width: 4rem; height: 4rem; color: var(--mat-sys-on-primary-container); }
    .hero-info h1 { margin: 0 0 0.5rem; }
    .hero-info p, .meta { color: var(--mat-sys-on-surface-variant); }
    .actions { margin-top: 1rem; }
    .track-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .track-row {
      width: 100%;
      border: 0;
      border-radius: 12px;
      background: var(--mat-sys-surface-container-low);
      padding: 0.875rem 1rem;
      display: grid;
      grid-template-columns: 32px 1fr auto;
      gap: 0.75rem;
      align-items: center;
      text-align: left;
      color: inherit;
    }
    .index, .track-artist { color: var(--mat-sys-on-surface-variant); }
    @media (max-width: 720px) {
      .hero { grid-template-columns: 1fr; }
    }
  `],
})
export class MusicBookmarkPlaylistComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private playlistService = inject(MusicBookmarkPlaylistService);
  private utilities = inject(UtilitiesService);
  private mediaPlayer = inject(MediaPlayerService);
  private database = inject(DatabaseService);
  private data = inject(DataService);
  private logger = inject(LoggerService);
  private layout = inject(LayoutService);

  playlist = signal<Event | null>(null);
  tracks = signal<Event[]>([]);
  loading = signal(true);

  title = computed(() => this.playlist()?.tags.find(tag => tag[0] === 'title')?.[1] || 'Untitled Playlist');
  description = computed(() => this.playlist()?.tags.find(tag => tag[0] === 'description')?.[1] || this.playlist()?.content || '');
  coverImage = computed(() => this.playlist()?.tags.find(tag => tag[0] === 'image')?.[1] || null);
  gradient = computed(() => this.playlist() ? this.utilities.getMusicGradient(this.playlist()!) : null);

  constructor() {
    void this.loadPlaylist();
  }

  private async loadPlaylist(): Promise<void> {
    const pubkeyParam = this.route.snapshot.paramMap.get('pubkey');
    const identifier = this.route.snapshot.paramMap.get('identifier');
    if (!pubkeyParam || !identifier) {
      this.loading.set(false);
      return;
    }

    let pubkey = pubkeyParam;
    if (pubkey.startsWith('npub')) {
      try {
        const decoded = nip19.decode(pubkey);
        if (decoded.type === 'npub') {
          pubkey = decoded.data;
        }
      } catch {
        // keep original value
      }
    }

    try {
      const event = await this.playlistService.fetchPlaylistEvent(pubkey, identifier);
      this.playlist.set(event);
      if (event) {
        await this.loadTracks(event);
      }
    } catch (error) {
      this.logger.error('[MusicBookmarkPlaylist] Failed to load playlist:', error);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadTracks(playlist: Event): Promise<void> {
    const refs = this.utilities.getMusicPlaylistTrackRefs(playlist);
    const loaded: Event[] = [];

    for (const ref of refs) {
      const coordinate = this.utilities.parseMusicTrackCoordinate(ref);
      if (!coordinate) {
        continue;
      }

      let event = await this.database.getParameterizedReplaceableEvent(
        coordinate.pubkey,
        coordinate.kind,
        coordinate.identifier,
      );

      if (!event) {
        try {
          const record = await this.data.getEventByPubkeyAndKindAndReplaceableEvent(
            coordinate.pubkey,
            coordinate.kind,
            coordinate.identifier,
            { save: false, cache: false },
          );
          event = record?.event || null;
        } catch {
          event = null;
        }
      }

      if (event) {
        loaded.push(event);
      }
    }

    this.tracks.set(loaded);
  }

  getTrackTitle(track: Event): string {
    return this.utilities.getMusicTitle(track) || 'Untitled Track';
  }

  getTrackArtist(track: Event): string {
    return this.utilities.getMusicArtist(track) || 'Unknown Artist';
  }

  playAll(): void {
    this.playTrack(0);
  }

  playTrack(index: number): void {
    const tracks = this.tracks();
    if (index < 0 || index >= tracks.length) {
      return;
    }

    this.mediaPlayer.clearQueue();

    for (let i = index; i < tracks.length; i++) {
      const track = tracks[i];
      const source = this.utilities.getMusicAudioUrl(track);
      if (!source) {
        continue;
      }

      const dTag = track.tags.find(tag => tag[0] === 'd')?.[1] || '';
      const item: MediaItem = {
        source,
        title: this.getTrackTitle(track),
        artist: this.getTrackArtist(track),
        artwork: this.utilities.getMusicImage(track) || '',
        video: track.tags.find(tag => tag[0] === 'video')?.[1] || undefined,
        type: 'Music',
        eventPubkey: track.pubkey,
        eventIdentifier: dTag,
        eventKind: track.kind,
        lyrics: this.utilities.extractLyricsFromEvent(track),
      };

      if (i === index) {
        this.mediaPlayer.play(item);
      } else {
        this.mediaPlayer.enque(item);
      }
    }
  }

  goBack(): void {
    void this.router.navigate(['/music']);
  }
}
