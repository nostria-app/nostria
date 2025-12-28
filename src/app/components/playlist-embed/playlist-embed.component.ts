import { Component, computed, input, inject, signal, effect, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Event, nip19 } from 'nostr-tools';
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

const M3U_PLAYLIST_KIND = 32100;

interface PlaylistTrack {
  url: string;
  title?: string;
  artist?: string;
  duration?: string;
}

@Component({
  selector: 'app-playlist-embed',
  imports: [
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    UserProfileComponent,
    DateToggleComponent,
  ],
  template: `
    <div class="playlist-embed">
      @if (loading()) {
        <div class="loading-state">
          <mat-spinner diameter="24"></mat-spinner>
          <span>Loading playlist...</span>
        </div>
      } @else if (record()) {
        <div class="embed-content" (click)="openPlaylist()" (keydown.enter)="openPlaylist()" 
          tabindex="0" role="button" [attr.aria-label]="'Open playlist ' + title()">
          
          <!-- Playlist icon -->
          <div class="embed-cover">
            <div class="cover-placeholder">
              <mat-icon>playlist_play</mat-icon>
            </div>
          </div>
          
          <!-- Info section -->
          <div class="embed-info">
            <app-user-profile [pubkey]="authorPubkey()" view="compact"></app-user-profile>
            <h4 class="embed-title">{{ title() }}</h4>
            <div class="embed-meta">
              <span class="track-count">{{ trackCount() }} tracks</span>
              <app-date-toggle [date]="createdAt()"></app-date-toggle>
            </div>
          </div>
          
          <!-- Action buttons -->
          <div class="embed-actions">
            <button mat-icon-button class="play-btn" (click)="playNow($event)" 
              [disabled]="isLoading() || trackCount() === 0" aria-label="Play playlist" title="Play Playlist">
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
              <button mat-menu-item (click)="openPlaylist()">
                <mat-icon>open_in_new</mat-icon>
                <span>View Details</span>
              </button>
            </mat-menu>
          </div>
        </div>
      } @else {
        <div class="not-found-state">
          <mat-icon>playlist_remove</mat-icon>
          <span>Playlist not found</span>
        </div>
      }
    </div>
  `,
  styles: [`
    .playlist-embed {
      margin: 8px 0;
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
      flex-shrink: 0;
      width: 56px;
      height: 56px;
      border-radius: 8px;
      overflow: hidden;
      background: var(--mat-sys-surface-container);
      display: flex;
      align-items: center;
      justify-content: center;
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
        color: var(--mat-sys-primary);
      }
    }

    .embed-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .embed-title {
      margin: 0;
      font-size: 14px;
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
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
    }

    .track-count {
      white-space: nowrap;
    }

    .embed-actions {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .play-btn {
      color: var(--mat-sys-primary);
    }
  `],
})
export class PlaylistEmbedComponent {
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
  private router = inject(Router);
  private layout = inject(LayoutService);

  // State
  record = signal<NostrRecord | null>(null);
  loading = signal<boolean>(true);
  isLoading = signal<boolean>(false);
  private tracksCache = signal<PlaylistTrack[]>([]);

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
            this.loadPlaylist();
          });
        }
      }
    });
  }

  // Computed properties
  event = computed(() => this.record()?.event);

  title = computed(() => {
    const ev = this.event();
    if (!ev) return 'Untitled Playlist';
    // Get title from 'alt' tag (main title)
    const altTag = ev.tags.find(tag => tag[0] === 'alt');
    return altTag?.[1] || 'Untitled Playlist';
  });

  trackCount = computed(() => {
    return this.tracksCache().length;
  });

  createdAt = computed(() => {
    const ev = this.event();
    return ev?.created_at || 0;
  });

  authorPubkey = computed(() => {
    const ev = this.event();
    return ev?.pubkey || '';
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
          hostname.startsWith('172.16.') ||
          hostname.startsWith('172.17.') ||
          hostname.startsWith('172.18.') ||
          hostname.startsWith('172.19.') ||
          hostname.startsWith('172.2') ||
          hostname.startsWith('172.30.') ||
          hostname.startsWith('172.31.')
        ) {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    });
  }

  private async loadPlaylist(): Promise<void> {
    if (this.loading() && this.record()) {
      return;
    }

    this.loading.set(true);

    try {
      let event: NostrRecord | null = null;

      // Try relay hints first
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
          console.debug(`Relay hints fetch failed for playlist ${this.identifier()}`);
        }
      }

      // Try user's relays
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

      // Fallback: Try discovery relays
      if (!event) {
        try {
          const filter = {
            authors: [this.pubkey()],
            kinds: [this.kind()],
            '#d': [this.identifier()],
          };
          const discoveryRelayUrls = this.discoveryRelay.getRelayUrls();
          if (discoveryRelayUrls.length > 0) {
            const relayEvent = await this.relayPool.get(discoveryRelayUrls, filter, 10000);
            if (relayEvent) {
              event = this.data.toRecord(relayEvent);
            }
          }
        } catch {
          console.debug(`Discovery relay fetch failed for playlist ${this.identifier()}`);
        }
      }

      if (event) {
        this.record.set(event);
        // Parse tracks from M3U content
        const tracks = this.parseM3UContent(event.event.content);
        this.tracksCache.set(tracks);
      }
    } finally {
      this.loading.set(false);
    }
  }

  private parseM3UContent(content: string): PlaylistTrack[] {
    if (!content) return [];

    const lines = content.split('\n').map(line => line.trim());
    const tracks: PlaylistTrack[] = [];
    let currentTrack: Partial<PlaylistTrack> = {};

    lines.forEach(line => {
      if (line.startsWith('#EXTINF:')) {
        // Parse track info: #EXTINF:duration,artist - title
        const match = line.match(/#EXTINF:([^,]*),(.*)$/);
        if (match) {
          const duration = match[1].trim();
          const info = match[2].trim();

          // Try to parse "artist - title" format
          const titleMatch = info.match(/^(.*?)\s*-\s*(.*)$/);
          if (titleMatch) {
            currentTrack.artist = titleMatch[1].trim();
            currentTrack.title = titleMatch[2].trim();
          } else {
            currentTrack.title = info;
          }

          if (duration && duration !== '-1') {
            currentTrack.duration = this.formatDuration(parseInt(duration, 10));
          }
        }
      } else if (line && !line.startsWith('#')) {
        // This should be a URL
        currentTrack.url = line;

        if (currentTrack.url) {
          tracks.push(currentTrack as PlaylistTrack);
          currentTrack = {};
        }
      }
    });

    return tracks;
  }

  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  }

  private getMediaType(url: string): 'Music' | 'Podcast' | 'YouTube' | 'Video' {
    if (!url) return 'Music';

    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      return 'YouTube';
    }

    const videoExtensions = ['.mp4', '.webm', '.ogg', '.avi', '.mov', '.wmv', '.flv', '.mkv'];
    const lowercaseUrl = url.toLowerCase();
    if (videoExtensions.some(ext => lowercaseUrl.includes(ext))) {
      return 'Video';
    }

    return 'Music';
  }

  async playNow(event: MouseEvent): Promise<void> {
    event.stopPropagation();

    const tracks = this.tracksCache();
    if (tracks.length === 0) {
      this.snackBar.open('Playlist has no tracks', 'Close', { duration: 2000 });
      return;
    }

    this.isLoading.set(true);

    try {
      const mediaItems: MediaItem[] = tracks.map((track, index) => ({
        source: track.url,
        title: track.title || `Track ${index + 1}`,
        artist: track.artist || 'Unknown Artist',
        artwork: '/icons/icon-192x192.png',
        type: this.getMediaType(track.url),
      }));

      // Clear queue and play first track
      this.mediaPlayer.clearQueue();
      this.mediaPlayer.play(mediaItems[0]);

      // Queue the rest
      for (let i = 1; i < mediaItems.length; i++) {
        this.mediaPlayer.enque(mediaItems[i]);
      }

      this.snackBar.open(`Playing ${mediaItems.length} tracks`, 'Close', { duration: 2000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  async addToQueue(event: MouseEvent): Promise<void> {
    event.stopPropagation();

    const tracks = this.tracksCache();
    if (tracks.length === 0) {
      this.snackBar.open('Playlist has no tracks', 'Close', { duration: 2000 });
      return;
    }

    this.isLoading.set(true);

    try {
      const mediaItems: MediaItem[] = tracks.map((track, index) => ({
        source: track.url,
        title: track.title || `Track ${index + 1}`,
        artist: track.artist || 'Unknown Artist',
        artwork: '/icons/icon-192x192.png',
        type: this.getMediaType(track.url),
      }));

      mediaItems.forEach(item => {
        this.mediaPlayer.enque(item);
      });

      this.snackBar.open(`Added ${mediaItems.length} tracks to queue`, 'Close', { duration: 2000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  openPlaylist(): void {
    const ev = this.event();
    if (!ev) return;

    // Navigate to event page
    const nevent = nip19.neventEncode({
      id: ev.id,
      author: ev.pubkey,
      kind: ev.kind,
    });
    this.router.navigate(['/e', nevent], { state: { event: ev } });
  }
}
