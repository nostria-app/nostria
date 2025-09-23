import { Component, computed, input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Event } from 'nostr-tools';
import { MediaPlayerService } from '../../services/media-player.service';
import { MediaItem } from '../../interfaces';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LayoutService } from '../../services/layout.service';
import { MatMenuModule } from '@angular/material/menu';
import { AgoPipe } from '../../pipes/ago.pipe';
import { MatDividerModule } from '@angular/material/divider';

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
    CommonModule,
    MatButtonModule,
    MatIconModule,
    UserProfileComponent,
    MatTooltipModule,
    MatMenuModule,
    AgoPipe,
    MatDividerModule,
  ],
  templateUrl: './playlist-event.component.html',
  styleUrl: './playlist-event.component.scss',
})
export class PlaylistEventComponent {
  event = input.required<Event>();

  // Inject the media player service
  private mediaPlayerService = inject(MediaPlayerService);

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

  playPlaylist(playlistData: PlaylistData): void {
    console.log('Playing playlist:', playlistData.title);

    if (playlistData.tracks.length === 0) {
      console.warn('No tracks in playlist');
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
    }
  }

  addPlaylistToQueue(playlistData: PlaylistData): void {
    console.log('Adding playlist to queue:', playlistData.title);

    if (playlistData.tracks.length === 0) {
      console.warn('No tracks in playlist');
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
      // Get title
      const titleTag = event.tags.find(tag => tag[0] === 'title');
      const title = titleTag?.[1] || 'Untitled Playlist';

      // Get alt text/description
      const altTag = event.tags.find(tag => tag[0] === 'alt');
      const alt = altTag?.[1];

      // Get playlist URL
      const urlTag = event.tags.find(tag => tag[0] === 'url');
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
