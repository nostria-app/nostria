import { Component, computed, input, inject, signal, effect, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { Event, Filter, nip19 } from 'nostr-tools';
import { DataService } from '../../services/data.service';
import { AccountStateService } from '../../services/account-state.service';
import { MediaPlayerService } from '../../services/media-player.service';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { DiscoveryRelayService } from '../../services/relays/discovery-relay';
import { UtilitiesService } from '../../services/utilities.service';
import { UserDataService } from '../../services/user-data.service';
import { NostrRecord, MediaItem } from '../../interfaces';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { DateToggleComponent } from '../date-toggle/date-toggle.component';
import { LayoutService } from '../../services/layout.service';
import { MediaPreviewDialogComponent } from '../media-preview-dialog/media-preview.component';

const MUSIC_KIND = 36787;

@Component({
  selector: 'app-music-embed',
  imports: [
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    UserProfileComponent,
    DateToggleComponent,
  ],
  template: `
    <div class="music-embed" [class.track]="isTrack()" [class.playlist]="!isTrack()">
      @if (loading()) {
        <div class="loading-state">
          <mat-spinner diameter="24"></mat-spinner>
          <span>Loading...</span>
        </div>
      } @else if (record()) {
        <div class="embed-content" (click)="openItem()" (keydown.enter)="openItem()" 
          tabindex="0" role="button" [attr.aria-label]="'Open ' + title()">
          
          <!-- Cover image/placeholder -->
          <button type="button" class="embed-cover" [style.background]="gradient() || ''"
            (click)="openCoverImage($event)" [attr.aria-label]="'Open album art for ' + title()"
            [disabled]="!coverImage()" title="Open album art">
            @if (coverImage() && !gradient()) {
              <img [src]="coverImage()" [alt]="title()" class="cover-image" loading="lazy" />
            } @else if (!gradient()) {
              <div class="cover-placeholder">
                <mat-icon>{{ isTrack() ? 'music_note' : 'queue_music' }}</mat-icon>
              </div>
            }
          </button>
          
          <!-- Info section -->
          <div class="embed-info">
            @if (isTrack()) {
              <div class="embed-title">{{ title() }}</div>
              <div class="embed-artist">{{ artistName() || 'Unknown Artist' }}</div>
            } @else {
              <app-user-profile [pubkey]="authorPubkey()" view="compact"></app-user-profile>
              <div class="embed-title">{{ title() }}</div>
              <div class="embed-meta">
                <app-date-toggle [date]="createdAt()"></app-date-toggle>
                @if (hashtags().length > 0) {
                  <mat-chip-set>
                    @for (hashtag of hashtags().slice(0, 3); track hashtag) {
                      <mat-chip>{{ hashtag }}</mat-chip>
                    }
                  </mat-chip-set>
                }
              </div>
            }
          </div>
          
          <!-- Action buttons -->
          <div class="embed-actions">
            @if (!isTrack()) {
              <button mat-icon-button class="expand-btn" (click)="togglePlaylistExpanded($event)"
                [attr.aria-label]="playlistExpanded() ? 'Collapse playlist tracks' : 'Expand playlist tracks'"
                [attr.aria-expanded]="playlistExpanded()" title="Toggle track list">
                <mat-icon>{{ playlistExpanded() ? 'expand_less' : 'expand_more' }}</mat-icon>
              </button>
            }
            <button mat-icon-button class="play-btn" (click)="playNow($event)" 
              [disabled]="isLoading()" aria-label="Play now" title="Play Now">
              @if (isLoading()) {
                <mat-spinner diameter="20"></mat-spinner>
              } @else {
                <mat-icon>play_arrow</mat-icon>
              }
            </button>
            <button mat-icon-button [matMenuTriggerFor]="menu" (click)="$event.stopPropagation()" aria-label="More options">
              <mat-icon>more_vert</mat-icon>
            </button>
            <mat-menu #menu="matMenu">
              <button mat-menu-item (click)="playNow($event)">
                <mat-icon>play_arrow</mat-icon>
                <span>Play Now</span>
              </button>
              <button mat-menu-item (click)="addToQueue($event)">
                <mat-icon>queue_music</mat-icon>
                <span>Add to Queue</span>
              </button>
              <button mat-menu-item (click)="openItem()">
                <mat-icon>open_in_new</mat-icon>
                <span>View Details</span>
              </button>
            </mat-menu>
          </div>
        </div>

        @if (!isTrack() && playlistExpanded()) {
          <div class="playlist-tracks" (click)="$event.stopPropagation()">
            @if (playlistTracksLoading()) {
              <div class="playlist-loading">
                <mat-spinner diameter="18"></mat-spinner>
                <span>Loading tracks...</span>
              </div>
            } @else if (playlistTracks().length === 0) {
              <div class="playlist-empty">No tracks in playlist</div>
            } @else {
              @for (track of playlistTracks(); track track.id) {
                <div class="playlist-track-row">
                  <button type="button" class="track-cover" (click)="openTrackCoverImage(track, $event)"
                    [disabled]="!getTrackImage(track)" [attr.aria-label]="'Open album art for ' + getTrackTitle(track)"
                    title="Open album art">
                    @if (getTrackImage(track)) {
                      <img [src]="getTrackImage(track)" [alt]="getTrackTitle(track)" loading="lazy" />
                    } @else {
                      <mat-icon>music_note</mat-icon>
                    }
                  </button>
                  <div class="track-info">
                    <div class="track-title">{{ getTrackTitle(track) }}</div>
                    <div class="track-artist">{{ getTrackArtist(track) }}</div>
                  </div>
                  <button mat-icon-button class="track-play-btn" (click)="playTrackFromPlaylist(track, $event)"
                    [disabled]="!getTrackAudioUrl(track)" [attr.aria-label]="'Play ' + getTrackTitle(track)"
                    title="Play track">
                    <mat-icon>play_arrow</mat-icon>
                  </button>
                </div>
              }
            }
          </div>
        }
      } @else {
        <div class="not-found-state">
          <mat-icon>music_off</mat-icon>
          <span>{{ isTrack() ? 'Track' : 'Playlist' }} not found</span>
          <button mat-button type="button" (click)="retryLoad($event)" aria-label="Retry loading music item">
            <mat-icon>refresh</mat-icon>
            <span>Retry</span>
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .music-embed {
      margin: 0.5rem 0;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
      background: var(--mat-sys-surface-container-low);
      overflow: hidden;
    }

    .music-embed.track {
      margin: 0.35rem 0;
      border-radius: 10px;

      .embed-content {
        padding: 6px 8px;
        gap: 8px;
      }

      .embed-cover {
        width: 44px;
        height: 44px;
        min-width: 44px;

        .cover-placeholder mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
        }
      }

      .embed-info {
        display: flex;
        flex-direction: column;
        justify-content: center;

        .embed-title {
          font-size: 1rem;
          line-height: 1.15;
        }

        .embed-artist {
          margin-top: 2px;
          font-size: 0.86rem;
          color: var(--mat-sys-on-surface-variant);
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .embed-meta {
          display: none;
        }
      }

      .embed-actions {
        .play-btn,
        button[mat-icon-button] {
          width: 32px;
          height: 32px;
          padding: 4px;
        }
      }
    }

    .loading-state,
    .not-found-state {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 16px;
      color: var(--mat-sys-on-surface-variant);
    }

    .not-found-state {
      justify-content: center;
      flex-direction: column;

      button[mat-button] {
        margin-top: 4px;
      }
    }

    .embed-content {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      cursor: pointer;
      transition: background-color 0.2s ease;

      &:hover {
        background-color: var(--mat-sys-surface-container);
      }

      &:focus {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: -2px;
      }

      @media (max-width: 400px) {
        flex-wrap: wrap;
        gap: 8px;
      }
    }

    .embed-cover {
      width: 64px;
      height: 64px;
      min-width: 64px;
      border-radius: 8px;
      border: none;
      padding: 0;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, var(--mat-sys-tertiary-container) 0%, var(--mat-sys-secondary-container) 100%);
      flex-shrink: 0;
      cursor: pointer;

      .cover-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      &:disabled {
        cursor: default;
      }

      .cover-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;

        mat-icon {
          font-size: 32px;
          width: 32px;
          height: 32px;
          color: var(--mat-sys-on-tertiary-container);
          opacity: 0.7;
        }
      }

      @media (max-width: 400px) {
        width: 56px;
        height: 56px;
        min-width: 56px;
      }
    }

    .embed-info {
      flex: 1;
      min-width: 0;
      overflow: hidden;

      .embed-artist {
        margin-top: 2px;
        color: var(--mat-sys-on-surface-variant);
        font-size: 0.85rem;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      app-user-profile {
        margin-bottom: 4px;
      }

      .embed-title {
        margin: 0;
        font-size: 1rem;
        line-height: 1.3;
        color: var(--mat-sys-on-surface);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;

        @media (max-width: 400px) {
          white-space: normal;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          line-clamp: 2;
          -webkit-box-orient: vertical;
        }
      }

      .embed-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 4px;
        flex-wrap: wrap;

        app-date-toggle {
          font-size: 0.8rem;
          color: var(--mat-sys-on-surface-variant);
        }

        mat-chip-set {
          display: inline-flex;
          
          mat-chip {
            --mdc-chip-label-text-size: 0.75rem;
            height: 24px;
          }
        }

        @media (max-width: 400px) {
          mat-chip-set {
            display: none;
          }
        }
      }

      @media (max-width: 400px) {
        flex: 1 1 calc(100% - 130px);
      }
    }

    .embed-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;

      .play-btn {
        background: var(--mat-sys-primary);
        color: var(--mat-sys-on-primary);
        position: relative;

        &:hover:not(:disabled) {
          background: var(--mat-sys-primary-container);
          color: var(--mat-sys-on-primary-container);
        }

        mat-spinner {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          
          ::ng-deep {
            svg {
              display: block;
            }
            
            circle {
              stroke: var(--mat-sys-on-primary) !important;
            }
          }
        }
      }
    }

    .playlist-tracks {
      border-top: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container-lowest);
      padding: 6px 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .playlist-loading,
    .playlist-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: var(--mat-sys-on-surface-variant);
      padding: 10px 6px;
    }

    .playlist-track-row {
      display: flex;
      align-items: center;
      gap: 8px;
      border-radius: 8px;
      padding: 4px;
      background: var(--mat-sys-surface-container-low);
    }

    .track-cover {
      width: 34px;
      height: 34px;
      min-width: 34px;
      border-radius: 6px;
      border: none;
      padding: 0;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
      cursor: pointer;

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      &:disabled {
        cursor: default;
      }
    }

    .track-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .track-title,
    .track-artist {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.2;
    }

    .track-title {
      color: var(--mat-sys-on-surface);
      font-size: 0.88rem;
    }

    .track-artist {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.8rem;
    }

    .track-play-btn {
      width: 30px;
      height: 30px;
    }

    :host-context(.dark) .music-embed {
      background: var(--mat-sys-surface-container-low);
    }
  `],
})
export class MusicEmbedComponent {
  private static readonly MAX_CONCURRENT_LOOKUPS = 4;
  private static activeLookups = 0;
  private static lookupQueue: (() => void)[] = [];
  private static lookupCache = new Map<string, NostrRecord | null>();
  private static inFlightLookups = new Map<string, Promise<NostrRecord | null>>();

  // Required inputs
  identifier = input.required<string>();
  pubkey = input.required<string>();
  kind = input.required<number>();

  // Optional inputs
  relayHints = input<string[] | undefined>(undefined);

  // Services
  private data = inject(DataService);
  private userDataService = inject(UserDataService);
  private accountState = inject(AccountStateService);
  private mediaPlayer = inject(MediaPlayerService);
  private relayPool = inject(RelayPoolService);
  private discoveryRelay = inject(DiscoveryRelayService);
  private utilities = inject(UtilitiesService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private layout = inject(LayoutService);

  // State
  record = signal<NostrRecord | null>(null);
  loading = signal<boolean>(true);
  isLoading = signal<boolean>(false);
  private tracksCache = signal<Event[]>([]);
  playlistExpanded = signal<boolean>(false);
  playlistTracksLoading = signal<boolean>(false);
  playlistTracks = signal<Event[]>([]);

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
    return Promise.race([
      promise,
      new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  }

  constructor() {
    let lastLoadKey = '';

    effect(() => {
      const pubkey = this.pubkey();
      const identifier = this.identifier();
      const kind = this.kind();

      if (pubkey && identifier && kind) {
        const currentLoadKey = `${pubkey}:${kind}:${identifier}`;

        if (currentLoadKey !== lastLoadKey) {
          lastLoadKey = currentLoadKey;

          untracked(() => {
            this.loadItem();
          });
        }
      }
    });
  }

  // Computed properties
  isTrack = computed(() => this.kind() === MUSIC_KIND);

  event = computed(() => this.record()?.event);

  title = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('title', ev.tags)[0] || 'Untitled';
  });

  coverImage = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('image', ev.tags)[0] || '';
  });

  gradient = computed(() => {
    const ev = this.event();
    if (!ev) return null;
    const gradientTag = ev.tags.find(t => t[0] === 'gradient' && t[1] === 'colors');
    if (gradientTag?.[2]) {
      return `linear-gradient(135deg, ${gradientTag[2]})`;
    }
    return null;
  });

  hashtags = computed(() => {
    const ev = this.event();
    if (!ev) return [];
    return this.utilities.getTagValues('t', ev.tags);
  });

  authorPubkey = computed(() => {
    const ev = this.event();
    return ev?.pubkey || this.pubkey();
  });

  createdAt = computed(() => {
    const ev = this.event();
    return ev?.created_at || 0;
  });

  audioUrl = computed(() => {
    const ev = this.event();
    if (!ev || !this.isTrack()) return '';
    return this.utilities.getTagValues('url', ev.tags)[0] || '';
  });

  videoUrl = computed(() => {
    const ev = this.event();
    if (!ev || !this.isTrack()) return '';
    return this.utilities.getTagValues('video', ev.tags)[0] || '';
  });

  artistName = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('artist', ev.tags)[0] || '';
  });

  private getValidRelayHints(): string[] {
    const hints = this.relayHints();
    if (!hints || hints.length === 0) return [];

    return hints.filter(relay => {
      try {
        const url = new URL(relay);
        const hostname = url.hostname.toLowerCase();
        if (
          hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname.startsWith('192.168.') ||
          hostname.startsWith('10.') ||
          hostname.startsWith('172.')
        ) {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    });
  }

  private getLookupKey(): string {
    return `${this.pubkey()}:${this.kind()}:${this.identifier()}`;
  }

  private invalidateLookupCache(lookupKey: string): void {
    MusicEmbedComponent.lookupCache.delete(lookupKey);
    MusicEmbedComponent.inFlightLookups.delete(lookupKey);
  }

  private async runLookupWithLimit<T>(task: () => Promise<T>): Promise<T> {
    if (MusicEmbedComponent.activeLookups >= MusicEmbedComponent.MAX_CONCURRENT_LOOKUPS) {
      await new Promise<void>(resolve => {
        MusicEmbedComponent.lookupQueue.push(resolve);
      });
    }

    MusicEmbedComponent.activeLookups++;
    try {
      return await task();
    } finally {
      MusicEmbedComponent.activeLookups = Math.max(0, MusicEmbedComponent.activeLookups - 1);
      const next = MusicEmbedComponent.lookupQueue.shift();
      next?.();
    }
  }

  private async getOrLoadLookupResult(lookupKey: string): Promise<NostrRecord | null> {
    if (MusicEmbedComponent.lookupCache.has(lookupKey)) {
      return MusicEmbedComponent.lookupCache.get(lookupKey) ?? null;
    }

    const inFlight = MusicEmbedComponent.inFlightLookups.get(lookupKey);
    if (inFlight) {
      return await inFlight;
    }

    const lookupPromise = this.runLookupWithLimit(() => this.fetchAddressableEvent())
      .finally(() => {
        MusicEmbedComponent.inFlightLookups.delete(lookupKey);
      });

    MusicEmbedComponent.inFlightLookups.set(lookupKey, lookupPromise);

    const result = await lookupPromise;
    MusicEmbedComponent.lookupCache.set(lookupKey, result);
    return result;
  }

  private async fetchAddressableEvent(): Promise<NostrRecord | null> {
    let event: NostrRecord | null = null;

    const validRelayHints = this.getValidRelayHints();
    if (validRelayHints.length > 0) {
      try {
        const filter = {
          authors: [this.pubkey()],
          kinds: [this.kind()],
          '#d': [this.identifier()],
        };
        const relayEvent = await this.withTimeout(
          this.relayPool.get(validRelayHints, filter, 10000),
          6000
        );
        if (relayEvent) {
          event = this.data.toRecord(relayEvent);
        }
      } catch {
        console.debug(`Relay hints fetch failed for music item ${this.identifier()}`);
      }
    }

    if (!event) {
      const isNotCurrentUser = !this.accountState.isCurrentUser(this.pubkey());

      if (isNotCurrentUser) {
        event = await this.withTimeout(
          this.userDataService.getEventByPubkeyAndKindAndReplaceableEvent(
            this.pubkey(),
            this.kind(),
            this.identifier(),
            { save: false, cache: false }
          ),
          5000
        );
      } else {
        event = await this.withTimeout(
          this.data.getEventByPubkeyAndKindAndReplaceableEvent(
            this.pubkey(),
            this.kind(),
            this.identifier(),
            { save: false, cache: false }
          ),
          5000
        );
      }
    }

    if (!event) {
      try {
        const filter = {
          authors: [this.pubkey()],
          kinds: [this.kind()],
          '#d': [this.identifier()],
        };
        const discoveryRelayUrls = this.discoveryRelay.getRelayUrls();
        if (discoveryRelayUrls.length > 0) {
          const relayEvent = await this.withTimeout(
            this.relayPool.get(discoveryRelayUrls, filter, 10000),
            6000
          );
          if (relayEvent) {
            event = this.data.toRecord(relayEvent);
          }
        }
      } catch {
        console.debug(`Discovery relay fetch failed for music item ${this.identifier()}`);
      }
    }

    if (!event) {
      try {
        const filter = {
          authors: [this.pubkey()],
          kinds: [this.kind()],
          '#d': [this.identifier()],
        };
        const preferredRelays = this.utilities.preferredRelays.slice(0, 5);
        if (preferredRelays.length > 0) {
          const relayEvent = await this.withTimeout(
            this.relayPool.get(preferredRelays, filter, 10000),
            6000
          );
          if (relayEvent) {
            event = this.data.toRecord(relayEvent);
          }
        }
      } catch {
        console.debug(`Preferred relay fetch failed for music item ${this.identifier()}`);
      }
    }

    return event;
  }

  private async loadItem(): Promise<void> {
    if (this.loading() && this.record()) {
      return;
    }

    this.loading.set(true);
    const lookupKey = this.getLookupKey();

    try {
      const event = await this.getOrLoadLookupResult(lookupKey);

      this.record.set(event);
    } catch (error) {
      console.error('Error loading music item:', error);
      this.record.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  async playNow(event: MouseEvent): Promise<void> {
    event.stopPropagation();

    if (this.isTrack()) {
      await this.playTrack();
    } else {
      await this.playPlaylist();
    }
  }

  async addToQueue(event: MouseEvent): Promise<void> {
    event.stopPropagation();

    if (this.isTrack()) {
      await this.queueTrack();
    } else {
      await this.queuePlaylist();
    }
  }

  private async playTrack(): Promise<void> {
    const ev = this.event();
    const url = this.audioUrl();

    if (!ev || !url) {
      this.snackBar.open('No audio URL available', 'Close', { duration: 2000 });
      return;
    }

    const npub = nip19.npubEncode(ev.pubkey);
    const mediaItem: MediaItem = {
      source: url,
      title: this.title(),
      artist: this.artistName() || 'Unknown Artist',
      artwork: this.coverImage() || '/icons/icon-192x192.png',
      video: this.videoUrl() || undefined,
      type: 'Music',
      eventPubkey: npub,
      eventIdentifier: this.identifier(),
      lyrics: this.utilities.extractLyricsFromEvent(ev),
    };

    this.mediaPlayer.play(mediaItem);
  }

  private async queueTrack(): Promise<void> {
    const ev = this.event();
    const url = this.audioUrl();

    if (!ev || !url) {
      this.snackBar.open('No audio URL available', 'Close', { duration: 2000 });
      return;
    }

    const npub = nip19.npubEncode(ev.pubkey);
    const mediaItem: MediaItem = {
      source: url,
      title: this.title(),
      artist: this.artistName() || 'Unknown Artist',
      artwork: this.coverImage() || '/icons/icon-192x192.png',
      video: this.videoUrl() || undefined,
      type: 'Music',
      eventPubkey: npub,
      eventIdentifier: this.identifier(),
      lyrics: this.utilities.extractLyricsFromEvent(ev),
    };

    this.mediaPlayer.enque(mediaItem);
    this.snackBar.open('Added to queue', 'Close', { duration: 2000 });
  }

  private async playPlaylist(): Promise<void> {
    const tracks = await this.loadPlaylistTracks();

    if (tracks.length === 0) {
      this.snackBar.open('Playlist is empty', 'Close', { duration: 2000 });
      return;
    }

    const mediaItems = this.tracksToMediaItems(tracks);

    // Clear queue and play first track
    this.mediaPlayer.clearQueue();
    this.mediaPlayer.play(mediaItems[0]);

    // Queue the rest
    for (let i = 1; i < mediaItems.length; i++) {
      this.mediaPlayer.enque(mediaItems[i]);
    }

    this.snackBar.open(`Queued ${mediaItems.length} tracks`, 'Close', { duration: 2000 });
  }

  private async queuePlaylist(): Promise<void> {
    const tracks = await this.loadPlaylistTracks();

    if (tracks.length === 0) {
      this.snackBar.open('Playlist is empty', 'Close', { duration: 2000 });
      return;
    }

    const mediaItems = this.tracksToMediaItems(tracks);

    for (const item of mediaItems) {
      this.mediaPlayer.enque(item);
    }

    this.snackBar.open(`Added ${mediaItems.length} tracks to queue`, 'Close', { duration: 2000 });
  }

  private async loadPlaylistTracks(): Promise<Event[]> {
    if (this.tracksCache().length > 0) {
      return this.tracksCache();
    }

    this.isLoading.set(true);

    try {
      const ev = this.event();
      if (!ev) {
        console.warn('[MusicEmbed] No event loaded for playlist');
        return [];
      }

      console.log('[MusicEmbed] Loading playlist tracks from event:', ev.id, 'tags:', ev.tags);

      // Get track references from playlist tags
      const trackRefs = ev.tags
        .filter(t => t[0] === 'a' && t[1]?.startsWith(`${MUSIC_KIND}:`))
        .map(t => {
          const parts = t[1].split(':');
          return {
            kind: parseInt(parts[0]),
            pubkey: parts[1],
            identifier: parts[2],
          };
        });

      console.log('[MusicEmbed] Found track references:', trackRefs.length, trackRefs);

      if (trackRefs.length === 0) {
        console.warn('[MusicEmbed] No track references found in playlist tags');
        return [];
      }

      // Build relay list with fallbacks (same approach as loadItem)
      const validRelayHints = this.getValidRelayHints();
      const discoveryRelayUrls = this.discoveryRelay.getRelayUrls();
      const preferredRelays = this.utilities.preferredRelays.slice(0, 5);

      // Combine all relay sources, removing duplicates
      const allRelays = [...new Set([
        ...validRelayHints,
        ...discoveryRelayUrls,
        ...preferredRelays,
      ])];

      if (allRelays.length === 0) {
        console.warn('[MusicEmbed] No relays available for fetching tracks');
        return [];
      }

      console.log('[MusicEmbed] Using relays for track fetch:', allRelays);

      // Fetch tracks
      const tracks: Event[] = [];

      for (const ref of trackRefs) {
        const filter: Filter = {
          kinds: [ref.kind],
          authors: [ref.pubkey],
          '#d': [ref.identifier],
        };

        try {
          const track = await this.relayPool.get(allRelays, filter, 5000);
          if (track) {
            tracks.push(track);
          }
        } catch {
          // Skip failed tracks
        }
      }

      console.log('[MusicEmbed] Loaded tracks:', tracks.length);
      this.tracksCache.set(tracks);
      return tracks;
    } finally {
      this.isLoading.set(false);
    }
  }

  private async ensureExpandedPlaylistTracksLoaded(): Promise<void> {
    if (this.playlistTracks().length > 0) {
      return;
    }

    this.playlistTracksLoading.set(true);
    try {
      const tracks = await this.loadPlaylistTracks();
      this.playlistTracks.set(tracks);
    } finally {
      this.playlistTracksLoading.set(false);
    }
  }

  private tracksToMediaItems(tracks: Event[]): MediaItem[] {
    return tracks
      .map(track => {
        const urlTag = track.tags.find(t => t[0] === 'url');
        const titleTag = track.tags.find(t => t[0] === 'title');
        const artistTag = track.tags.find(t => t[0] === 'artist');
        const imageTag = track.tags.find(t => t[0] === 'image');
        const videoTag = track.tags.find(t => t[0] === 'video');
        const dTag = track.tags.find(t => t[0] === 'd');

        if (!urlTag?.[1]) return null;

        const item: MediaItem = {
          source: urlTag[1],
          title: titleTag?.[1] || 'Untitled',
          artist: artistTag?.[1] || 'Unknown Artist',
          artwork: imageTag?.[1] || '/icons/icon-192x192.png',
          video: videoTag?.[1] || undefined,
          type: 'Music',
          eventPubkey: nip19.npubEncode(track.pubkey),
          eventIdentifier: dTag?.[1] || '',
          lyrics: this.utilities.extractLyricsFromEvent(track),
        };
        return item;
      })
      .filter((item): item is MediaItem => item !== null);
  }

  openItem(): void {
    if (this.isTrack()) {
      this.router.navigate(['/music/song', nip19.npubEncode(this.pubkey()), this.identifier()]);
    } else {
      this.router.navigate(['/music/playlist', nip19.npubEncode(this.pubkey()), this.identifier()]);
    }
  }

  retryLoad(event: MouseEvent): void {
    event.stopPropagation();
    const lookupKey = this.getLookupKey();
    this.invalidateLookupCache(lookupKey);

    untracked(() => {
      this.loadItem();
    });
  }

  async togglePlaylistExpanded(event: MouseEvent): Promise<void> {
    event.stopPropagation();

    if (this.isTrack()) {
      return;
    }

    const next = !this.playlistExpanded();
    this.playlistExpanded.set(next);

    if (next) {
      await this.ensureExpandedPlaylistTracksLoaded();
    }
  }

  openCoverImage(event: MouseEvent): void {
    event.stopPropagation();

    const imageUrl = this.coverImage();
    if (!imageUrl) {
      return;
    }

    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaUrl: imageUrl,
        mediaType: 'image',
        mediaTitle: this.title() || 'Album art',
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      panelClass: 'image-dialog-panel',
    });
  }

  openTrackCoverImage(track: Event, event: MouseEvent): void {
    event.stopPropagation();

    const imageUrl = this.getTrackImage(track);
    if (!imageUrl) {
      return;
    }

    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaUrl: imageUrl,
        mediaType: 'image',
        mediaTitle: this.getTrackTitle(track) || 'Album art',
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      panelClass: 'image-dialog-panel',
    });
  }

  async playTrackFromPlaylist(track: Event, event: MouseEvent): Promise<void> {
    event.stopPropagation();

    const mediaItem = this.trackToMediaItem(track);
    if (!mediaItem) {
      this.snackBar.open('No audio URL available', 'Close', { duration: 2000 });
      return;
    }

    this.mediaPlayer.play(mediaItem);
  }

  getTrackTitle(track: Event): string {
    return track.tags.find(tag => tag[0] === 'title')?.[1] || 'Untitled';
  }

  getTrackArtist(track: Event): string {
    return track.tags.find(tag => tag[0] === 'artist')?.[1] || 'Unknown Artist';
  }

  getTrackImage(track: Event): string {
    return track.tags.find(tag => tag[0] === 'image')?.[1] || '';
  }

  getTrackAudioUrl(track: Event): string {
    return track.tags.find(tag => tag[0] === 'url')?.[1] || '';
  }

  private trackToMediaItem(track: Event): MediaItem | null {
    const url = this.getTrackAudioUrl(track);
    if (!url) {
      return null;
    }

    const dTag = track.tags.find(t => t[0] === 'd');
    const videoTag = track.tags.find(t => t[0] === 'video');

    return {
      source: url,
      title: this.getTrackTitle(track),
      artist: this.getTrackArtist(track),
      artwork: this.getTrackImage(track) || '/icons/icon-192x192.png',
      video: videoTag?.[1] || undefined,
      type: 'Music',
      eventPubkey: nip19.npubEncode(track.pubkey),
      eventIdentifier: dTag?.[1] || '',
      lyrics: this.utilities.extractLyricsFromEvent(track),
    };
  }
}
