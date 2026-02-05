import { Component, inject, signal, effect, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { nip19 } from 'nostr-tools';
import { PlaylistService } from '../../../services/playlist.service';
import { MediaPlayerService } from '../../../services/media-player.service';
import { ApplicationService } from '../../../services/application.service';
import { Playlist } from '../../../interfaces';
import { UserRelaysService } from '../../../services/relays/user-relays';
import { CreatePlaylistDialogComponent } from '../../playlists/create-playlist-dialog/create-playlist-dialog.component';
import { RenamePlaylistDialogComponent, RenamePlaylistDialogData, RenamePlaylistDialogResult } from '../../../components/rename-playlist-dialog/rename-playlist-dialog.component';

@Component({
  selector: 'app-playlists-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './playlists-tab.component.html',
  styleUrl: './playlists-tab.component.scss',
})
export class PlaylistsTabComponent {
  private playlistService = inject(PlaylistService);
  private mediaPlayer = inject(MediaPlayerService);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private app = inject(ApplicationService);
  private userRelaysService = inject(UserRelaysService);

  playlists = this.playlistService.playlists;
  drafts = this.playlistService.drafts;
  isLoading = signal(false);

  constructor() {
    // Fetch playlists from Nostr when pubkey becomes available
    effect(() => {
      const pubkey = this.app.accountState.pubkey();
      if (pubkey) {
        this.loadPlaylists(pubkey);
      }
    });
  }

  private async loadPlaylists(pubkey: string): Promise<void> {
    // Only show loading if we have no playlists yet
    if (this.playlists().length === 0) {
      this.isLoading.set(true);
    }
    try {
      await this.playlistService.fetchPlaylistsFromNostr(pubkey);
    } catch (error) {
      console.error('Failed to load playlists:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  createNewPlaylist(): void {
    const dialogRef = this.dialog.open(CreatePlaylistDialogComponent, {
      width: '400px',
      data: {},
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        const draft = this.playlistService.createPlaylist(result.title, result.description, result.id, result.tracks);
        this.router.navigate(['/playlists/edit', draft.id]);
      }
    });
  }

  editPlaylist(playlist: Playlist): void {
    const draft = this.playlistService.editPlaylist(playlist);
    this.router.navigate(['/playlists/edit', draft.id]);
  }

  playPlaylist(playlist: Playlist): void {
    if (playlist.tracks.length === 0) {
      console.warn('No tracks in playlist');
      return;
    }

    this.mediaPlayer.clearQueue();

    const mediaItems = playlist.tracks.map((track, index) => ({
      source: track.url,
      title: track.title || `Track ${index + 1}`,
      artist: track.artist || 'Unknown Artist',
      artwork: '/icons/icon-192x192.png',
      type: this.getMediaType(track.url),
    }));

    if (mediaItems.length > 0) {
      this.mediaPlayer.play(mediaItems[0]);

      for (let i = 1; i < mediaItems.length; i++) {
        this.mediaPlayer.enque(mediaItems[i]);
      }
    }
  }

  addPlaylistToQueue(playlist: Playlist): void {
    if (playlist.tracks.length === 0) {
      console.warn('No tracks in playlist');
      return;
    }

    const mediaItems = playlist.tracks.map((track, index) => ({
      source: track.url,
      title: track.title || `Track ${index + 1}`,
      artist: track.artist || 'Unknown Artist',
      artwork: '/icons/icon-192x192.png',
      type: this.getMediaType(track.url),
    }));

    mediaItems.forEach(item => {
      this.mediaPlayer.enque(item);
    });

    this.snackBar.open(`Added ${mediaItems.length} tracks to queue`, 'Close', {
      duration: 3000,
    });
  }

  deletePlaylist(playlist: Playlist): void {
    if (confirm(`Are you sure you want to delete "${playlist.title}"?`)) {
      this.playlistService.deletePlaylist(playlist.id);
    }
  }

  renamePlaylist(playlist: Playlist): void {
    const dialogRef = this.dialog.open(RenamePlaylistDialogComponent, {
      width: '400px',
      data: {
        playlist,
      } as RenamePlaylistDialogData,
    });

    dialogRef.afterClosed().subscribe((result: RenamePlaylistDialogResult) => {
      if (result && result.name) {
        try {
          this.playlistService.renamePlaylist(playlist.id, result.name);
          this.snackBar.open(`Playlist renamed to "${result.name}"`, 'Close', {
            duration: 3000,
          });
        } catch (error) {
          console.error('Failed to rename playlist:', error);
          this.snackBar.open('Failed to rename playlist', 'Close', {
            duration: 3000,
          });
        }
      }
    });
  }

  loadDraft(draftId: string): void {
    this.playlistService.loadDraft(draftId);
    this.router.navigate(['/playlists/edit', draftId]);
  }

  deleteDraft(draftId: string): void {
    if (confirm('Are you sure you want to delete this draft?')) {
      this.playlistService.removeDraft(draftId);
    }
  }

  async copyNeventAddress(playlist: Playlist): Promise<void> {
    try {
      await this.userRelaysService.ensureRelaysForPubkey(playlist.pubkey);
      const authorRelays = this.userRelaysService.getRelaysForPubkey(playlist.pubkey);
      const naddr = nip19.naddrEncode({
        kind: 32100,
        pubkey: playlist.pubkey,
        identifier: playlist.id,
        relays: authorRelays.length > 0 ? authorRelays : undefined,
      });

      await navigator.clipboard.writeText(naddr);
      this.snackBar.open('Playlist address copied!', 'Close', {
        duration: 3000,
      });
    } catch (error) {
      console.error('Failed to copy nevent address:', error);
      this.snackBar.open('Failed to copy address', 'Close', {
        duration: 3000,
      });
    }
  }

  async copyEventData(playlist: Playlist): Promise<void> {
    try {
      const eventData = this.playlistService.generatePlaylistEvent(playlist);
      const jsonData = JSON.stringify(eventData, null, 2);
      await navigator.clipboard.writeText(jsonData);

      this.snackBar.open('Event data copied!', 'Close', {
        duration: 3000,
      });
    } catch (error) {
      console.error('Failed to copy event data:', error);
      this.snackBar.open('Failed to copy event data', 'Close', {
        duration: 3000,
      });
    }
  }

  private getMediaType(url: string): 'Music' | 'Podcast' | 'YouTube' | 'Video' {
    if (!url) return 'Music';

    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      return 'YouTube';
    }

    const videoExtensions = ['.mp4', '.webm', '.ogg', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.qt'];
    const lowercaseUrl = url.toLowerCase();
    if (videoExtensions.some(ext => lowercaseUrl.includes(ext))) {
      return 'Video';
    }

    return 'Music';
  }
}
