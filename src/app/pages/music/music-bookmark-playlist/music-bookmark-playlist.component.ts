import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event, nip19 } from 'nostr-tools';
import { MusicBookmarkPlaylistService } from '../../../services/music-bookmark-playlist.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { MediaPlayerService } from '../../../services/media-player.service';
import { DatabaseService } from '../../../services/database.service';
import { DataService } from '../../../services/data.service';
import { LoggerService } from '../../../services/logger.service';
import { LayoutService } from '../../../services/layout.service';
import { ImageCacheService } from '../../../services/image-cache.service';
import { AccountStateService } from '../../../services/account-state.service';
import { MusicLikedSongsService } from '../../../services/music-liked-songs.service';
import { MusicTrackMenuComponent } from '../../../components/music-track-menu/music-track-menu.component';
import { MediaItem } from '../../../interfaces';

@Component({
  selector: 'app-music-bookmark-playlist',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatMenuModule, MatProgressSpinnerModule, MatTooltipModule, DragDropModule, MusicTrackMenuComponent],
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
          <div class="header-icon hero-art" [style.background]="gradient() || ''">
            @if (coverImage(); as cover) {
              <img [src]="cover" [alt]="title()" />
            } @else {
              <mat-icon>playlist_play</mat-icon>
            }
          </div>
          <div class="header-text hero-info">
            <h1>{{ title() }}</h1>
            <p class="subtitle">{{ tracks().length }} tracks</p>
            @if (description()) {
              <p class="playlist-description">{{ description() }}</p>
            }
            <div class="playlist-visibility">
              <mat-icon>public</mat-icon>
              <span>Public playlist</span>
            </div>
          </div>
          <div class="header-actions">
            <button mat-fab extended class="play-all-button" (click)="playAll()" [disabled]="tracks().length === 0">
                <mat-icon>play_arrow</mat-icon>
                <span>Play All</span>
            </button>
          </div>
        </div>

        <div class="track-list-header hide-small">
          <span class="track-list-header-number">#</span>
          <span class="track-list-header-title">Title</span>
          <span class="track-list-header-album">Album</span>
          <span class="track-list-header-duration">
            <mat-icon>schedule</mat-icon>
          </span>
        </div>

        <div class="track-list" cdkDropList cdkDropListLockAxis="y" (cdkDropListDropped)="onTrackDrop($event)">
          @for (track of tracks(); track track.id; let i = $index) {
            <div class="track-row" cdkDrag [cdkDragDisabled]="!isOwnPlaylist()" [cdkDragStartDelay]="{ touch: 250, mouse: 180 }">
              <button type="button" class="track-play-button" (click)="playTrack(i)"
                [attr.aria-label]="'Play ' + getTrackTitle(track)">
                <span class="track-number">{{ i + 1 }}</span>
                <mat-icon class="play-icon">play_arrow</mat-icon>
              </button>

              <div class="track-drag-handle" cdkDragHandle [class.is-disabled]="!isOwnPlaylist()" matTooltip="Drag to reorder">
                <mat-icon>drag_indicator</mat-icon>
              </div>

              <div class="track-main">
                <button type="button" class="track-cover-button" (click)="playTrack(i)"
                  [attr.aria-label]="'Play ' + getTrackTitle(track)">
                  @if (getTrackImage(track); as image) {
                    <img [src]="image" [alt]="getTrackTitle(track)" class="track-cover" />
                  } @else if (getTrackGradient(track); as trackGradient) {
                    <div class="track-cover track-cover-gradient" [style.background]="trackGradient"></div>
                  } @else {
                    <div class="track-cover track-cover-placeholder">
                      <mat-icon>music_note</mat-icon>
                    </div>
                  }
                </button>

                <div class="track-text">
                  <button type="button" class="track-title-button" (click)="openTrack(track)">
                    <span class="track-title">{{ getTrackTitle(track) }}</span>
                  </button>
                  <span class="track-artist">{{ getTrackArtist(track) }}</span>
                </div>
              </div>

              <div class="track-meta">
                <button type="button" class="track-liked-button" [class.is-empty]="!isTrackLiked(track)"
                  (click)="toggleTrackLike(track, $event)" [attr.aria-label]="isTrackLiked(track) ? 'Unlike track' : 'Like track'">
                  <mat-icon>{{ isTrackLiked(track) ? 'favorite' : 'favorite_border' }}</mat-icon>
                </button>
                <span class="track-album">{{ getTrackAlbum(track) }}</span>
                <span class="track-duration">{{ getTrackDuration(track) }}</span>
                <app-music-track-menu [track]="track" [artistName]="getTrackArtist(track)" [showEditOption]="false"
                  [playlistId]="playlistId()" [showRemoveFromPlaylist]="isOwnPlaylist()"
                  (removedFromPlaylist)="onTrackRemoved($event)" #trackMenuRef="musicTrackMenu"></app-music-track-menu>
                <button mat-icon-button type="button" class="track-menu-button" [matMenuTriggerFor]="trackMenuRef.trackMenu"
                  (click)="$event.stopPropagation()">
                  <mat-icon>more_horiz</mat-icon>
                </button>
              </div>
            </div>
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
    .container {
      padding: 1rem;
      padding-bottom: 120px;
    }
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
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 1rem;
      padding: 0.5rem 0 1.25rem;
    }
    .header-icon {
      width: 64px;
      height: 64px;
      border-radius: var(--mat-sys-corner-medium);
    }
    .hero-art {
      aspect-ratio: 1;
      overflow: hidden;
      background: linear-gradient(135deg, var(--mat-sys-primary-container), var(--mat-sys-secondary-container));
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .hero-art img { width: 100%; height: 100%; object-fit: cover; }
    .hero-art mat-icon { font-size: 2rem; width: 2rem; height: 2rem; color: var(--mat-sys-on-primary-container); }
    .header-text {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      min-width: 0;
    }
    .hero-info h1 {
      margin: 0;
      font-size: 2.25rem;
      line-height: 1.05;
      color: var(--mat-sys-on-surface);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .subtitle,
    .playlist-description {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
    }
    .playlist-visibility {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.8125rem;
    }
    .playlist-visibility mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .playlist-description {
      font-size: 0.875rem;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .header-actions {
      display: flex;
      justify-content: flex-end;
    }
    .play-all-button {
      border-radius: var(--mat-sys-corner-large);
      min-height: 56px;
      padding: 0 1.5rem;
      background: linear-gradient(135deg, #946200, #c88900);
      color: #fff6db;
    }
    .track-list-header {
      display: grid;
      grid-template-columns: 2rem minmax(0, 1fr) minmax(8rem, 20vw) 3.25rem;
      align-items: center;
      gap: 0.625rem;
      padding: 0 0.75rem 0.35rem;
      border-bottom: 1px solid color-mix(in srgb, var(--mat-sys-outline-variant) 78%, transparent);
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.75rem;
    }
    .track-list-header-number,
    .track-list-header-duration {
      text-align: right;
    }
    .track-list-header-duration {
      display: flex;
      justify-content: flex-end;
    }
    .track-list-header-duration mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .track-list {
      display: flex;
      flex-direction: column;
      gap: 0;
    }
    .track-row {
      display: grid;
      grid-template-columns: 2.5rem 1.5rem minmax(0, 1fr) minmax(10rem, 18rem);
      gap: 0.75rem;
      align-items: center;
      min-height: 3.25rem;
      border-bottom: 1px solid color-mix(in srgb, var(--mat-sys-outline-variant) 78%, transparent);
    }
    .track-row:hover {
      background: color-mix(in srgb, var(--mat-sys-surface-container-high) 24%, transparent);
    }
    .track-row:hover .track-number {
      opacity: 0;
    }
    .track-row:hover .play-icon {
      opacity: 1;
    }
    .track-play-button,
    .track-cover-button,
    .track-title-button,
    .track-liked-button {
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
    }
    .track-drag-handle {
      width: 1.5rem;
      height: 1.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--mat-sys-on-surface-variant);
      cursor: grab;
    }
    .track-drag-handle.is-disabled {
      opacity: 0.35;
      cursor: default;
    }
    .track-drag-handle mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .track-play-button {
      position: relative;
      width: 2.5rem;
      height: 2.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .track-number,
    .play-icon {
      position: absolute;
      inset: 50% auto auto 50%;
      transform: translate(-50%, -50%);
      transition: opacity 0.15s ease;
    }
    .track-number {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.875rem;
      font-variant-numeric: tabular-nums;
    }
    .play-icon {
      opacity: 0;
      font-size: 1.1rem;
      width: 1.1rem;
      height: 1.1rem;
      color: var(--mat-sys-on-surface);
    }
    .track-main {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-width: 0;
    }
    .track-cover-button {
      cursor: pointer;
    }
    .track-cover {
      width: 36px;
      height: 36px;
      min-width: 36px;
      border-radius: var(--mat-sys-corner-extra-small);
      object-fit: cover;
      display: block;
    }
    .track-cover-gradient,
    .track-cover-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .track-cover-placeholder {
      background: linear-gradient(135deg, var(--mat-sys-tertiary-container) 0%, var(--mat-sys-secondary-container) 100%);
    }
    .track-cover-placeholder mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--mat-sys-on-tertiary-container);
      opacity: 0.7;
    }
    .track-text {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .track-title-button {
      min-width: 0;
      max-width: 100%;
      cursor: pointer;
      text-align: left;
    }
    .track-title {
      display: block;
      color: var(--mat-sys-on-surface);
      font-size: 1rem;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .track-title-button:hover .track-title {
      color: var(--mat-sys-primary);
      text-decoration: underline;
    }
    .track-artist,
    .track-album,
    .track-duration {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.875rem;
    }
    .track-artist,
    .track-album {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .track-meta {
      display: grid;
      grid-template-columns: 1rem minmax(0, 1fr) 3.25rem 2rem;
      align-items: center;
      gap: 0.75rem;
      min-width: 0;
    }
    .track-liked-button {
      width: 1rem;
      height: 1rem;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #f0a7a2;
      cursor: pointer;
    }
    .track-liked-button.is-empty {
      color: var(--mat-sys-on-surface-variant);
    }
    .track-liked-button mat-icon {
      font-size: 0.95rem;
      width: 0.95rem;
      height: 0.95rem;
    }
    .track-duration {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .track-menu-button {
      width: 32px;
      height: 32px;
      padding: 0 !important;
      display: flex !important;
      align-items: center;
      justify-content: center;
      color: var(--mat-sys-on-surface-variant);
    }
    .track-menu-button mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    @media (max-width: 720px) {
      .hero {
        grid-template-columns: 1fr;
        align-items: flex-start;
      }
      .header-actions {
        width: 100%;
        justify-content: flex-start;
      }
      .track-list-header {
        grid-template-columns: minmax(0, 1fr) 3.25rem;
      }
      .track-list-header-number,
      .track-list-header-album,
      .track-play-button,
      .track-drag-handle,
      .track-liked-button,
      .track-album,
      .track-menu-button {
        display: none !important;
      }
      .track-row {
        grid-template-columns: minmax(0, 1fr) 3.25rem;
      }
      .track-meta {
        grid-template-columns: 3.25rem;
        justify-self: end;
      }
    }
    @media (max-width: 520px) {
      .container {
        padding-left: 0.5rem;
        padding-right: 0.5rem;
      }
      .hero-info h1 {
        font-size: 2rem;
      }
      .track-list-header {
        grid-template-columns: minmax(0, 1fr) 3rem;
        gap: 0.5rem;
        padding-left: 0.5rem;
        padding-right: 0.5rem;
      }
      .track-row {
        grid-template-columns: minmax(0, 1fr) 3rem;
        gap: 0.5rem;
      }
      .track-cover {
        width: 32px;
        height: 32px;
        min-width: 32px;
      }
      .track-meta {
        grid-template-columns: 3rem;
      }
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
  private imageCache = inject(ImageCacheService);
  private accountState = inject(AccountStateService);
  private likedSongs = inject(MusicLikedSongsService);

  playlist = signal<Event | null>(null);
  tracks = signal<Event[]>([]);
  loading = signal(true);
  savingOrder = signal(false);

  title = computed(() => this.playlist()?.tags.find(tag => tag[0] === 'title')?.[1] || 'Untitled Playlist');
  description = computed(() => this.playlist()?.tags.find(tag => tag[0] === 'description')?.[1] || this.playlist()?.content || '');
  coverImage = computed(() => this.playlist()?.tags.find(tag => tag[0] === 'image')?.[1] || null);
  gradient = computed(() => this.playlist() ? this.utilities.getMusicGradient(this.playlist()!) : null);
  playlistId = computed(() => this.playlist()?.tags.find(tag => tag[0] === 'd')?.[1] || null);
  isOwnPlaylist = computed(() => {
    const playlist = this.playlist();
    const currentPubkey = this.accountState.pubkey();
    return !!playlist && !!currentPubkey && playlist.pubkey === currentPubkey;
  });

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
        await this.likedSongs.ensureInitialized();
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

  getTrackImage(track: Event): string | null {
    const rawUrl = this.utilities.getMusicImage(track) || null;
    if (!rawUrl) {
      return null;
    }

    return this.imageCache.getOptimizedImageUrlWithSize(rawUrl, 64, 64);
  }

  getTrackGradient(track: Event): string | null {
    return this.utilities.getMusicGradient(track);
  }

  getTrackArtist(track: Event): string {
    return this.utilities.getMusicArtist(track) || 'Unknown Artist';
  }

  getTrackAlbum(track: Event): string {
    return track.tags.find(tag => tag[0] === 'album')?.[1] || this.title();
  }

  getTrackDuration(track: Event): string {
    const seconds = this.utilities.getMusicDuration(track);
    if (!seconds || Number.isNaN(seconds)) {
      return '--:--';
    }

    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${minutes}:${remainder.toString().padStart(2, '0')}`;
  }

  openTrack(track: Event): void {
    const dTag = track.tags.find(tag => tag[0] === 'd')?.[1] || '';
    if (!track.pubkey || !dTag) {
      return;
    }

    this.layout.openSongDetail(track.pubkey, dTag, track);
  }

  isTrackLiked(track: Event): boolean {
    return this.likedSongs.isTrackLiked(track);
  }

  async toggleTrackLike(track: Event, event: MouseEvent): Promise<void> {
    event.stopPropagation();

    if (this.isTrackLiked(track)) {
      await this.likedSongs.removeTrack(track);
      return;
    }

    await this.likedSongs.addTrack(track);
  }

  onTrackRemoved(track: Event): void {
    const dTag = track.tags.find(tag => tag[0] === 'd')?.[1] || '';
    this.tracks.update(current => current.filter(item => {
      const itemDTag = item.tags.find(tag => tag[0] === 'd')?.[1] || '';
      return !(item.kind === track.kind && item.pubkey === track.pubkey && itemDTag === dTag);
    }));
  }

  async onTrackDrop(event: CdkDragDrop<Event[]>): Promise<void> {
    if (!this.isOwnPlaylist()) {
      return;
    }

    const previousTracks = this.tracks();
    const reordered = [...previousTracks];
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);
    this.tracks.set(reordered);

    const playlistId = this.playlistId();
    if (!playlistId) {
      return;
    }

    const orderedRefs = reordered.map(track => {
      const dTag = track.tags.find(tag => tag[0] === 'd')?.[1] || '';
      return `${track.kind}:${track.pubkey}:${dTag}`;
    });

    this.savingOrder.set(true);
    const success = await this.playlistService.reorderPlaylistTracks(playlistId, orderedRefs);
    this.savingOrder.set(false);

    if (!success) {
      this.tracks.set(previousTracks);
    }
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
    this.layout.closeRightPanel();
  }
}
