import { Component, computed, input, inject } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Event } from 'nostr-tools';
import { MediaPlayerService } from '../../services/media-player.service';
import { MediaItem, Playlist } from '../../interfaces';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LayoutService } from '../../services/layout.service';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { CommentsListComponent } from '../comments-list/comments-list.component';
import { PlaylistService } from '../../services/playlist.service';
import { MatSnackBar } from '@angular/material/snack-bar';

interface PlaylistTrack {
  url: string;
  title?: string;
  artist?: string;
  duration?: string;
}

interface PlaylistData {
  title: string;
  alt?: string;
  url?: string;
  tracks: PlaylistTrack[];
  totalDuration?: string;
}

@Component({
  selector: 'app-playlist-event',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatMenuModule,
    MatDividerModule,
    CommentsListComponent
  ],
  templateUrl: './playlist-event.component.html',
  styleUrl: './playlist-event.component.scss',
})
export class PlaylistEventComponent {
  event = input.required<Event>();

  // Inject the media player service
  private mediaPlayerService = inject(MediaPlayerService);
  private playlistService = inject(PlaylistService);
  private snackBar = inject(MatSnackBar);

  layout = inject(LayoutService);

  // Playlist data parsed from the event
  playlistData = computed(() => {
    const event = this.event();
    if (!event) return null;

    return this.getPlaylistData(event);
  });

  // Content warning check
  hasContentWarning = computed(() => {
    const event = this.event();
    if (!event) return false;

    return event.tags.some(tag => tag[0] === 'content-warning');
  });

  contentWarning = computed(() => {
    const event = this.event();
    if (!event) return null;

    const warningTag = event.tags.find(tag => tag[0] === 'content-warning');
    return warningTag?.[1] || 'Content may be sensitive';
  });

  isSaved = computed(() => {
    const event = this.event();
    if (!event) return false;

    // We need to construct a Playlist object to check if it's saved
    // This is a bit of a hack, but we only need pubkey and id
    const dTag = event.tags.find(tag => tag[0] === 'd')?.[1];
    if (!dTag) return false;

    const playlist: Partial<Playlist> = {
      id: dTag,
      pubkey: event.pubkey
    };

    return this.playlistService.isPlaylistSaved(playlist as Playlist);
  });

  async toggleSavePlaylist(): Promise<void> {
    const event = this.event();
    if (!event) return;

    const playlistData = this.playlistData();
    if (!playlistData) return;

    const dTag = event.tags.find(tag => tag[0] === 'd')?.[1];
    if (!dTag) return;

    // Construct a Playlist object
    const playlist: Playlist = {
      id: dTag,
      title: playlistData.title,
      description: playlistData.alt,
      tracks: playlistData.tracks,
      created_at: event.created_at,
      pubkey: event.pubkey,
      eventId: event.id,
      isLocal: false,
      kind: event.kind
    };

    try {
      if (this.isSaved()) {
        await this.playlistService.removePlaylistFromBookmarks(playlist);
        this.snackBar.open('Playlist removed from saved playlists', 'Close', { duration: 3000 });
      } else {
        await this.playlistService.savePlaylistToBookmarks(playlist);
        this.snackBar.open('Playlist saved to bookmarks', 'Close', { duration: 3000 });
      }
    } catch (error) {
      console.error('Failed to toggle save playlist:', error);
      this.snackBar.open('Failed to update saved playlists', 'Close', { duration: 3000 });
    }
  }

  playPlaylist(playlistData: PlaylistData): void {
    console.log('Playing playlist:', playlistData.title, 'Tracks:', playlistData.tracks.length);

    if (playlistData.tracks.length === 0) {
      console.warn('No tracks in playlist');
      this.snackBar.open('Playlist has no tracks', 'Close', { duration: 3000 });
      return;
    }

    // Clear current queue and add all tracks
    this.mediaPlayerService.clearQueue();

    // Convert playlist tracks to MediaItems
    const mediaItems: MediaItem[] = playlistData.tracks.map((track, index) => ({
      source: track.url,
      title: track.title || `Track ${index + 1}`,
      artist: track.artist || 'Unknown Artist',
      artwork: '/icons/icon-192x192.png', // Default artwork
      type: this.getMediaType(track.url),
    }));

    // Add first track and start playing
    if (mediaItems.length > 0) {
      this.mediaPlayerService.play(mediaItems[0]);

      // Add remaining tracks to queue
      for (let i = 1; i < mediaItems.length; i++) {
        this.mediaPlayerService.enque(mediaItems[i]);
      }

      this.snackBar.open(`Playing ${mediaItems.length} track${mediaItems.length > 1 ? 's' : ''}`, 'Close', { duration: 2000 });
    }
  }

  addPlaylistToQueue(playlistData: PlaylistData): void {
    console.log('Adding playlist to queue:', playlistData.title, 'Tracks:', playlistData.tracks.length);

    if (playlistData.tracks.length === 0) {
      console.warn('No tracks in playlist');
      this.snackBar.open('Playlist has no tracks', 'Close', { duration: 3000 });
      return;
    }

    // Convert playlist tracks to MediaItems and add to queue
    const mediaItems: MediaItem[] = playlistData.tracks.map((track, index) => ({
      source: track.url,
      title: track.title || `Track ${index + 1}`,
      artist: track.artist || 'Unknown Artist',
      artwork: '/icons/icon-192x192.png', // Default artwork
      type: this.getMediaType(track.url),
    }));

    // Add all tracks to queue
    mediaItems.forEach(item => {
      this.mediaPlayerService.enque(item);
    });
  }

  downloadM3U(): void {
    const event = this.event();
    if (!event) return;

    // Get the 'd' tag for filename
    const dTag = event.tags.find(tag => tag[0] === 'd');
    const filename = dTag?.[1] || 'playlist';

    // Create filename with .m3u extension
    const m3uFilename = `${filename}.m3u`;

    // Generate enhanced M3U content with metadata
    const m3uContent = this.generateEnhancedM3U(event);

    // Create blob and download
    const blob = new Blob([m3uContent], { type: 'audio/x-mpegurl' });
    const url = URL.createObjectURL(blob);

    // Create download link
    const link = document.createElement('a');
    link.href = url;
    link.download = m3uFilename;
    link.style.display = 'none';

    // Trigger download
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up
    URL.revokeObjectURL(url);

    console.log(`Downloaded M3U file: ${m3uFilename}`);
  }

  private generateEnhancedM3U(event: Event): string {
    const lines: string[] = [];

    // Start with M3U header
    lines.push('#EXTM3U');

    // Add metadata headers
    // Get playlist title from 'alt' tag
    const altTag = event.tags.find(tag => tag[0] === 'alt');
    const playlistTitle = altTag?.[1] || 'Untitled Playlist';
    lines.push(`# Playlist: ${playlistTitle}`);

    // Add creation date (convert from Nostr timestamp)
    const createdAt = new Date(event.created_at * 1000).toISOString();
    lines.push(`# Created: ${createdAt}`);

    // Add tags if available
    const tagTags = event.tags.filter(tag => tag[0] === 't');
    if (tagTags.length > 0) {
      tagTags.forEach(tag => {
        if (tag[1]) {
          lines.push(`# Tag: ${tag[1]}`);
        }
      });
    }

    // Add author (pubkey)
    lines.push(`# Author: ${event.pubkey}`);

    // Add empty line before tracks
    lines.push('');

    // Parse and add tracks with enhanced format
    const tracks = this.parseM3UContent(event.content);
    tracks.forEach(track => {
      // Parse duration from track or default to -1
      let durationSeconds = -1;
      if (track.duration) {
        durationSeconds = this.parseDuration(track.duration);
      }

      // Create track info line with group-title
      const artist = track.artist || 'Unknown';
      const title = track.title || 'Unknown Track';
      const groupTitle = track.artist || 'Unknown';

      lines.push(`#EXTINF:${durationSeconds} group-title="${groupTitle}", ${artist} - ${title}`);
      lines.push(track.url);
    });

    return lines.join('\n');
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

    // Default to Music for music playlists
    return 'Music';
  }

  private getPlaylistData(event: Event): PlaylistData | null {
    try {
      // Get title from 'alt' tag (main title, larger text)
      const altTag = event.tags.find(tag => tag[0] === 'alt');
      const title = altTag?.[1] || 'Untitled Playlist';

      // Get descriptor from 'd' tag (shown below title)
      const descriptorTag = event.tags.find(tag => tag[0] === 'd');
      const alt = descriptorTag?.[1];

      // Get playlist URL from 'u' tag as per NIP specification
      const urlTag = event.tags.find(tag => tag[0] === 'u');
      const url = urlTag?.[1];

      // Parse M3U content from event content
      const tracks = this.parseM3UContent(event.content);

      // Calculate total duration if available
      const totalDuration = this.calculateTotalDuration(tracks);

      return {
        title,
        alt,
        url,
        tracks,
        totalDuration,
      };
    } catch (error) {
      console.error('Failed to parse playlist data:', error);
      return null;
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

  private calculateTotalDuration(tracks: PlaylistTrack[]): string | undefined {
    let totalSeconds = 0;
    let hasValidDurations = false;

    for (const track of tracks) {
      if (track.duration) {
        const seconds = this.parseDuration(track.duration);
        if (seconds > 0) {
          totalSeconds += seconds;
          hasValidDurations = true;
        }
      }
    }

    return hasValidDurations ? this.formatDuration(totalSeconds) : undefined;
  }

  private parseDuration(duration: string): number {
    // Handle formats like "3:45" or "245" (seconds)
    if (duration.includes(':')) {
      const parts = duration.split(':').map(p => parseInt(p, 10));
      if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
      } else if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
    }
    return parseInt(duration, 10) || 0;
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
}
