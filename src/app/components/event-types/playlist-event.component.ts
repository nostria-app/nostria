import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Event } from 'nostr-tools';

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
  imports: [CommonModule, MatButtonModule, MatIconModule],
  templateUrl: './playlist-event.component.html',
  styleUrl: './playlist-event.component.scss',
})
export class PlaylistEventComponent {
  event = input.required<Event>();

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
    // This would integrate with the media player service
    console.log('Playing playlist:', playlistData.title);

    // For now, just open the first track
    if (playlistData.tracks.length > 0) {
      window.open(playlistData.tracks[0].url, '_blank', 'noopener,noreferrer');
    }
  }

  addPlaylistToQueue(playlistData: PlaylistData): void {
    // This would integrate with the media player service
    console.log('Adding playlist to queue:', playlistData.title);
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
