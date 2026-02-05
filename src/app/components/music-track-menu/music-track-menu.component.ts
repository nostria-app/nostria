import { Component, inject, input, output, computed, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { MatMenuModule, MatMenu } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Clipboard } from '@angular/cdk/clipboard';
import { Event, nip19 } from 'nostr-tools';
import { MediaPlayerService } from '../../services/media-player.service';
import { MusicPlaylistService } from '../../services/music-playlist.service';
import { ApplicationService } from '../../services/application.service';
import { AccountStateService } from '../../services/account-state.service';
import { UtilitiesService } from '../../services/utilities.service';
import { LayoutService } from '../../services/layout.service';
import { EventService } from '../../services/event';
import { MediaItem } from '../../interfaces';
import { UserRelaysService } from '../../services/relays/user-relays';
import { CreateMusicPlaylistDialogComponent, CreateMusicPlaylistDialogData } from '../../pages/music/create-music-playlist-dialog/create-music-playlist-dialog.component';
import { ShareArticleDialogComponent, ShareArticleDialogData } from '../share-article-dialog/share-article-dialog.component';
import { CustomDialogService } from '../../services/custom-dialog.service';

const MUSIC_KIND = 36787;

@Component({
  selector: 'app-music-track-menu',
  imports: [
    MatMenuModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <mat-menu #trackMenu="matMenu">
      @if (showEditOption() && isOwnTrack()) {
        <button mat-menu-item (click)="onEdit()">
          <mat-icon>edit</mat-icon>
          <span>Edit Track</span>
        </button>
      }
      @if (isAuthenticated()) {
        <button mat-menu-item [matMenuTriggerFor]="playlistMenu" (click)="loadPlaylists()">
          <mat-icon>playlist_add</mat-icon>
          <span>Add to Playlist</span>
        </button>
      }
      <button mat-menu-item (click)="addTrackToQueue()">
        <mat-icon>queue_music</mat-icon>
        <span>Add to Queue</span>
      </button>
      <button mat-menu-item (click)="goToTrackDetails()">
        <mat-icon>info</mat-icon>
        <span>Track Details</span>
      </button>
      <button mat-menu-item [matMenuTriggerFor]="copyMenu">
        <mat-icon>content_copy</mat-icon>
        <span>Copy</span>
      </button>
      <button mat-menu-item (click)="openShareDialog()">
        <mat-icon>share</mat-icon>
        <span>Share</span>
      </button>
      <button mat-menu-item (click)="publishEvent()">
        <mat-icon>publish</mat-icon>
        <span>Publish Event</span>
      </button>
    </mat-menu>
    
    <mat-menu #copyMenu="matMenu">
      <button mat-menu-item (click)="copyTrackLink()">
        <mat-icon>link</mat-icon>
        <span>Copy Link</span>
      </button>
      <button mat-menu-item (click)="copyEventId()">
        <mat-icon>fingerprint</mat-icon>
        <span>Copy Event ID</span>
      </button>
      <button mat-menu-item (click)="copyEventData()">
        <mat-icon>data_object</mat-icon>
        <span>Copy Event Data</span>
      </button>
    </mat-menu>
    
    <mat-menu #playlistMenu="matMenu">
      <button mat-menu-item (click)="createNewPlaylist()">
        <mat-icon>add</mat-icon>
        <span>New Playlist</span>
      </button>
      @if (playlistsLoading()) {
        <div class="playlist-loading">
          <mat-spinner diameter="20"></mat-spinner>
          <span>Loading playlists...</span>
        </div>
      } @else {
        @for (playlist of userPlaylists(); track playlist.id) {
          <button mat-menu-item (click)="addToPlaylist(playlist.id)">
            <mat-icon>queue_music</mat-icon>
            <span>{{ playlist.title }}</span>
          </button>
        }
        @if (userPlaylists().length === 0) {
          <div class="no-playlists">
            <span>No playlists yet</span>
          </div>
        }
      }
    </mat-menu>
  `,
  styles: [`
    :host {
      position: absolute;
      width: 0;
      height: 0;
      overflow: hidden;
      pointer-events: none;
    }
    
    .playlist-loading, .no-playlists {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.875rem;
    }
  `],
  exportAs: 'musicTrackMenu',
})
export class MusicTrackMenuComponent {
  private router = inject(Router);
  private mediaPlayer = inject(MediaPlayerService);
  private musicPlaylistService = inject(MusicPlaylistService);
  private app = inject(ApplicationService);
  private accountState = inject(AccountStateService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private customDialog = inject(CustomDialogService);
  private clipboard = inject(Clipboard);
  private utilities = inject(UtilitiesService);
  private layout = inject(LayoutService);
  private eventService = inject(EventService);
  private userRelaysService = inject(UserRelaysService);

  // ViewChild for exposing the menu - must be public for template access
  @ViewChild('trackMenu', { static: true }) public trackMenu!: MatMenu;

  // Inputs
  track = input.required<Event>();
  artistName = input<string>('Unknown Artist');
  showEditOption = input<boolean>(true);

  // Outputs
  editRequested = output<Event>();

  // Playlist state from service
  userPlaylists = this.musicPlaylistService.userPlaylists;
  playlistsLoading = this.musicPlaylistService.loading;
  isAuthenticated = computed(() => this.app.authenticated());

  // Check if this is the current user's track
  isOwnTrack = computed(() => {
    const ev = this.track();
    const userPubkey = this.accountState.pubkey();
    return ev && userPubkey && ev.pubkey === userPubkey;
  });

  // Get d-tag identifier
  private getIdentifier(): string {
    const ev = this.track();
    const dTag = ev.tags.find(t => t[0] === 'd');
    return dTag?.[1] || '';
  }

  // Get npub for artist
  private getArtistNpub(): string {
    const ev = this.track();
    try {
      return nip19.npubEncode(ev.pubkey);
    } catch {
      return ev.pubkey;
    }
  }

  // Get audio URL
  private getAudioUrl(): string {
    const ev = this.track();
    const urlTag = ev.tags.find(t => t[0] === 'url');
    if (urlTag?.[1]) {
      return urlTag[1];
    }
    // Fallback to content if it's a URL
    const content = ev.content;
    const match = content.match(/(https?:\/\/[^\s]+\.(mp3|wav|ogg|flac|m4a))/i);
    return match ? match[0] : '';
  }

  // Get track title
  private getTitle(): string {
    const ev = this.track();
    const titleTag = ev.tags.find(t => t[0] === 'title');
    return titleTag?.[1] || 'Untitled Track';
  }

  // Get cover image
  private getImage(): string | null {
    const ev = this.track();
    const imageTag = ev.tags.find(t => t[0] === 'image');
    return imageTag?.[1] || null;
  }

  onEdit(): void {
    this.editRequested.emit(this.track());
  }

  loadPlaylists(): void {
    this.musicPlaylistService.fetchUserPlaylists();
  }

  addTrackToQueue(): void {
    const url = this.getAudioUrl();
    if (!url) {
      this.snackBar.open('No audio URL found', 'Close', { duration: 3000 });
      return;
    }

    const mediaItem: MediaItem = {
      source: url,
      title: this.getTitle(),
      artist: this.artistName(),
      artwork: this.getImage() || '/icons/icon-192x192.png',
      type: 'Music',
      eventPubkey: this.getArtistNpub(),
      eventIdentifier: this.getIdentifier(),
      lyrics: this.utilities.extractLyricsFromEvent(this.track()),
    };

    this.mediaPlayer.enque(mediaItem);
    this.snackBar.open('Added to queue', 'Close', { duration: 2000 });
  }

  goToTrackDetails(): void {
    const ev = this.track();
    const id = this.getIdentifier();
    if (ev?.pubkey && id) {
      this.layout.openSongDetail(ev.pubkey, id, ev);
    }
  }

  copyTrackLink(): void {
    const npub = this.getArtistNpub();
    const id = this.getIdentifier();
    if (npub && id) {
      const link = `https://nostria.app/music/song/${npub}/${id}`;
      this.clipboard.copy(link);
      this.snackBar.open('Link copied!', 'Close', { duration: 2000 });
    } else {
      this.snackBar.open('Failed to generate link', 'Close', { duration: 3000 });
    }
  }

  copyEventData(): void {
    const ev = this.track();
    this.clipboard.copy(JSON.stringify(ev, null, 2));
    this.snackBar.open('Event data copied!', 'Close', { duration: 2000 });
  }

  publishEvent(): void {
    this.layout.publishEvent(this.track());
  }

  async copyEventId(): Promise<void> {
    const ev = this.track();
    const dTag = this.getIdentifier();
    try {
      await this.userRelaysService.ensureRelaysForPubkey(ev.pubkey);
      const authorRelays = this.userRelaysService.getRelaysForPubkey(ev.pubkey);
      const naddr = nip19.naddrEncode({
        kind: MUSIC_KIND,
        pubkey: ev.pubkey,
        identifier: dTag,
        relays: authorRelays.length > 0 ? authorRelays : undefined,
      });
      this.clipboard.copy(`nostr:${naddr}`);
      this.snackBar.open('Event ID copied!', 'Close', { duration: 2000 });
    } catch {
      this.snackBar.open('Failed to copy event ID', 'Close', { duration: 3000 });
    }
  }

  async openShareDialog(): Promise<void> {
    const ev = this.track();
    const npub = this.getArtistNpub();
    const id = this.getIdentifier();
    const title = this.getTitle();
    const image = this.getImage();

    if (!npub || !id) {
      this.snackBar.open('Failed to generate share link', 'Close', { duration: 3000 });
      return;
    }

    const link = `https://nostria.app/music/song/${npub}/${encodeURIComponent(id)}`;

    try {
      await this.userRelaysService.ensureRelaysForPubkey(ev.pubkey);
      const authorRelays = this.userRelaysService.getRelaysForPubkey(ev.pubkey);
      const naddr = nip19.naddrEncode({
        kind: MUSIC_KIND,
        pubkey: ev.pubkey,
        identifier: id,
        relays: authorRelays.length > 0 ? authorRelays : undefined,
      });

      const dialogData: ShareArticleDialogData = {
        title: title,
        summary: `Listen to ${title}`,
        image: image || undefined,
        url: link,
        eventId: ev.id,
        pubkey: ev.pubkey,
        identifier: id,
        kind: MUSIC_KIND,
        encodedId: naddr,
      };

      this.customDialog.open(ShareArticleDialogComponent, {
        title: 'Share',
        data: dialogData,
        width: '450px',
        maxWidth: '95vw',
      });
    } catch {
      this.snackBar.open('Failed to open share dialog', 'Close', { duration: 3000 });
    }
  }

  createNewPlaylist(): void {
    const ev = this.track();
    const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';

    const dialogRef = this.dialog.open(CreateMusicPlaylistDialogComponent, {
      width: '500px',
      maxWidth: '95vw',
      data: {
        trackPubkey: ev.pubkey,
        trackDTag: dTag,
      } as CreateMusicPlaylistDialogData,
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.playlist) {
        this.snackBar.open(`Added to "${result.playlist.title}"`, 'Close', { duration: 2000 });
      }
    });
  }

  async addToPlaylist(playlistId: string): Promise<void> {
    const ev = this.track();
    const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';

    try {
      const success = await this.musicPlaylistService.addTrackToPlaylist(
        playlistId,
        ev.pubkey,
        dTag
      );

      if (success) {
        const playlist = this.userPlaylists().find(p => p.id === playlistId);
        this.snackBar.open(`Added to "${playlist?.title || 'playlist'}"`, 'Close', { duration: 2000 });
      } else {
        this.snackBar.open('Failed to add to playlist', 'Close', { duration: 3000 });
      }
    } catch (error) {
      console.error('Error adding to playlist:', error);
      this.snackBar.open('Failed to add to playlist', 'Close', { duration: 3000 });
    }
  }
}
