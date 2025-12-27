import { Component, computed, input, inject, signal, effect, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { Event, Filter, nip19 } from 'nostr-tools';
import { DataService } from '../../services/data.service';
import { AccountStateService } from '../../services/account-state.service';
import { MediaPlayerService } from '../../services/media-player.service';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { UtilitiesService } from '../../services/utilities.service';
import { UserDataService } from '../../services/user-data.service';
import { NostrRecord, MediaItem } from '../../interfaces';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { DateToggleComponent } from '../date-toggle/date-toggle.component';
import { LayoutService } from '../../services/layout.service';

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
          <div class="embed-cover" [style.background]="gradient() || ''">
            @if (coverImage() && !gradient()) {
              <img [src]="coverImage()" [alt]="title()" class="cover-image" loading="lazy" />
            } @else if (!gradient()) {
              <div class="cover-placeholder">
                <mat-icon>{{ isTrack() ? 'music_note' : 'queue_music' }}</mat-icon>
              </div>
            }
          </div>
          
          <!-- Info section -->
          <div class="embed-info">
            <app-user-profile [pubkey]="authorPubkey()" mode="list"></app-user-profile>
            <h4 class="embed-title">{{ title() }}</h4>
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
          </div>
          
          <!-- Action buttons -->
          <div class="embed-actions">
            <button mat-icon-button class="play-btn" (click)="playNow($event)" 
              [disabled]="isLoading()" aria-label="Play now" title="Play Now">
              @if (isLoading()) {
                <mat-spinner diameter="20"></mat-spinner>
              } @else {
                <mat-icon>play_arrow</mat-icon>
              }
            </button>
            <button mat-icon-button [matMenuTriggerFor]="menu" aria-label="More options">
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
      } @else {
        <div class="not-found-state">
          <mat-icon>music_off</mat-icon>
          <span>{{ isTrack() ? 'Track' : 'Playlist' }} not found</span>
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
    }

    .embed-cover {
      width: 64px;
      height: 64px;
      min-width: 64px;
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, var(--mat-sys-tertiary-container) 0%, var(--mat-sys-secondary-container) 100%);

      .cover-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
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
    }

    .embed-info {
      flex: 1;
      min-width: 0;
      overflow: hidden;

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
      }

      .embed-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 4px;

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
      }
    }

    .embed-actions {
      display: flex;
      align-items: center;
      gap: 4px;

      .play-btn {
        background: var(--mat-sys-primary);
        color: var(--mat-sys-on-primary);

        &:hover:not(:disabled) {
          background: var(--mat-sys-primary-container);
          color: var(--mat-sys-on-primary-container);
        }

        mat-spinner {
          ::ng-deep circle {
            stroke: var(--mat-sys-on-primary) !important;
          }
        }
      }
    }

    :host-context(.dark) .music-embed {
      background: var(--mat-sys-surface-container-low);
    }
  `],
})
export class MusicEmbedComponent {
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
  private utilities = inject(UtilitiesService);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);
  private layout = inject(LayoutService);

  // State
  record = signal<NostrRecord | null>(null);
  loading = signal<boolean>(true);
  isLoading = signal<boolean>(false);
  private tracksCache = signal<Event[]>([]);

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

  private async loadItem(): Promise<void> {
    if (this.loading() && this.record()) {
      return;
    }

    this.loading.set(true);

    try {
      let event: NostrRecord | null = null;

      const validRelayHints = this.getValidRelayHints();
      if (validRelayHints.length > 0) {
        try {
          const filter = {
            authors: [this.pubkey()],
            kinds: [this.kind()],
            '#d': [this.identifier()],
          };
          const relayEvent = await this.relayPool.get(validRelayHints, filter, 10000);
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
          event = await this.userDataService.getEventByPubkeyAndKindAndReplaceableEvent(
            this.pubkey(),
            this.kind(),
            this.identifier(),
            { save: false, cache: false }
          );
        } else {
          event = await this.data.getEventByPubkeyAndKindAndReplaceableEvent(
            this.pubkey(),
            this.kind(),
            this.identifier(),
            { save: false, cache: false }
          );
        }
      }

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
      type: 'Music',
      eventPubkey: npub,
      eventIdentifier: this.identifier(),
    };

    this.mediaPlayer.play(mediaItem);
    this.snackBar.open('Now playing', 'Close', { duration: 2000 });
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
      type: 'Music',
      eventPubkey: npub,
      eventIdentifier: this.identifier(),
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

    this.snackBar.open(`Playing ${mediaItems.length} tracks`, 'Close', { duration: 2000 });
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
      if (!ev) return [];

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

      if (trackRefs.length === 0) return [];

      // Fetch tracks
      const filters: Filter[] = trackRefs.map(ref => ({
        kinds: [ref.kind],
        authors: [ref.pubkey],
        '#d': [ref.identifier],
      }));

      const tracks: Event[] = [];
      const validRelayHints = this.getValidRelayHints();
      const relays = validRelayHints.length > 0 ? validRelayHints : undefined;

      for (const filter of filters) {
        try {
          const track = relays
            ? await this.relayPool.get(relays, filter, 5000)
            : await this.relayPool.get([], filter, 5000);
          if (track) {
            tracks.push(track);
          }
        } catch {
          // Skip failed tracks
        }
      }

      this.tracksCache.set(tracks);
      return tracks;
    } finally {
      this.isLoading.set(false);
    }
  }

  private tracksToMediaItems(tracks: Event[]): MediaItem[] {
    return tracks
      .map(track => {
        const urlTag = track.tags.find(t => t[0] === 'url');
        const titleTag = track.tags.find(t => t[0] === 'title');
        const artistTag = track.tags.find(t => t[0] === 'artist');
        const imageTag = track.tags.find(t => t[0] === 'image');
        const dTag = track.tags.find(t => t[0] === 'd');

        if (!urlTag?.[1]) return null;

        const item: MediaItem = {
          source: urlTag[1],
          title: titleTag?.[1] || 'Untitled',
          artist: artistTag?.[1] || 'Unknown Artist',
          artwork: imageTag?.[1] || '/icons/icon-192x192.png',
          type: 'Music',
          eventPubkey: nip19.npubEncode(track.pubkey),
          eventIdentifier: dTag?.[1] || '',
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
}
