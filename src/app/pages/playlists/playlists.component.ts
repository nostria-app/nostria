import { Component, inject, signal, effect } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { nip19 } from 'nostr-tools';
import { PlaylistService } from '../../services/playlist.service';
import { MediaPlayerService } from '../../services/media-player.service';
import { ApplicationService } from '../../services/application.service';
import { Playlist } from '../../interfaces';
import { CreatePlaylistDialogComponent } from './create-playlist-dialog/create-playlist-dialog.component';

@Component({
  selector: 'app-playlists',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatMenuModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './playlists.component.html',
  styleUrl: './playlists.component.scss',
})
export class PlaylistsComponent {
  private playlistService = inject(PlaylistService);
  private mediaPlayer = inject(MediaPlayerService);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private app = inject(ApplicationService);

  playlists = this.playlistService.playlists;
  drafts = this.playlistService.drafts;

  // Local state
  selectedView = signal<'grid' | 'list'>('grid');
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
    this.isLoading.set(true);
    try {
      await this.playlistService.fetchPlaylistsFromNostr(pubkey);
    } catch (error) {
      console.error('Failed to load playlists:', error);
      this.snackBar.open('Failed to load playlists from Nostr', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
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
        const draft = this.playlistService.createPlaylist(result.title, result.description, result.id);
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

    // Clear current queue and play playlist
    this.mediaPlayer.clearQueue();

    // Convert playlist tracks to MediaItems
    const mediaItems = playlist.tracks.map((track, index) => ({
      source: track.url,
      title: track.title || `Track ${index + 1}`,
      artist: track.artist || 'Unknown Artist',
      artwork: '/icons/icon-192x192.png',
      type: this.getMediaType(track.url),
    }));

    // Play first track and add rest to queue
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

    // Convert playlist tracks to MediaItems and add to queue
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
  }

  deletePlaylist(playlist: Playlist): void {
    if (confirm(`Are you sure you want to delete "${playlist.title}"?`)) {
      this.playlistService.deletePlaylist(playlist.id);
    }
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

  toggleView(): void {
    this.selectedView.update(view => view === 'grid' ? 'list' : 'grid');
  }

  private getMediaType(url: string): 'Music' | 'Podcast' | 'YouTube' | 'Video' {
    if (!url) return 'Music';

    // Check for YouTube URLs
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      return 'YouTube';
    }

    // Check for video file extensions
    const videoExtensions = ['.mp4', '.webm', '.ogg', '.avi', '.mov', '.wmv', '.flv', '.mkv'];
    const lowercaseUrl = url.toLowerCase();
    if (videoExtensions.some(ext => lowercaseUrl.includes(ext))) {
      return 'Video';
    }

    return 'Music';
  }

  /**
   * Copy nevent address for the playlist to clipboard
   */
  async copyNeventAddress(playlist: Playlist): Promise<void> {
    try {
      // For playlist events (kind 32100), we use naddr instead of nevent
      // since it's a replaceable event with a 'd' tag identifier
      const naddr = nip19.naddrEncode({
        kind: 32100,
        pubkey: playlist.pubkey,
        identifier: playlist.id,
        // Add relay hints if available (optional)
        relays: [] // TODO: Add user's preferred relays
      });

      await navigator.clipboard.writeText(naddr);
      this.snackBar.open('Playlist address copied to clipboard!', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
    } catch (error) {
      console.error('Failed to copy nevent address:', error);
      this.snackBar.open('Failed to copy address', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
    }
  }

  /**
   * Copy raw event data as JSON to clipboard
   */
  async copyEventData(playlist: Playlist): Promise<void> {
    try {
      // Generate the event data that would be published to Nostr
      const eventData = this.playlistService.generatePlaylistEvent(playlist);

      const jsonData = JSON.stringify(eventData, null, 2);
      await navigator.clipboard.writeText(jsonData);

      this.snackBar.open('Event data copied to clipboard!', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
    } catch (error) {
      console.error('Failed to copy event data:', error);
      this.snackBar.open('Failed to copy event data', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
    }
  }
}