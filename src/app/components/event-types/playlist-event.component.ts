import { ChangeDetectionStrategy, Component, computed, input, inject, signal, effect, untracked } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Event } from 'nostr-tools';
import { MediaPlayerService } from '../../services/media-player.service';
import { MediaItem, Playlist, NostrRecord } from '../../interfaces';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LayoutService } from '../../services/layout.service';
import { MatMenuModule } from '@angular/material/menu';
import { formatDuration } from '../../utils/format-duration';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CommentsListComponent } from '../comments-list/comments-list.component';
import { PlaylistService } from '../../services/playlist.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DataService } from '../../services/data.service';
import { LoggerService } from '../../services/logger.service';
import { MusicEventComponent } from './music-event.component';

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
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatMenuModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    CommentsListComponent,
    MusicEventComponent
  ],
  templateUrl: './playlist-event.component.html',
  styleUrl: './playlist-event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaylistEventComponent {
  event = input.required<Event>();

  // Inject services
  private mediaPlayerService = inject(MediaPlayerService);
  private playlistService = inject(PlaylistService);
  private snackBar = inject(MatSnackBar);
  private dataService = inject(DataService);
  private logger = inject(LoggerService);

  layout = inject(LayoutService);

  // Track events loaded from 'a' tags
  trackEvents = signal<Event[]>([]);
  loadingTracks = signal<boolean>(false);

  constructor() {
    // Load track events when playlist event changes
    effect(() => {
      const event = this.event();
      if (event) {
        untracked(() => {
          this.loadTrackEvents(event);
        });
      }
    });
  }

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
      this.logger.error('Failed to toggle save playlist:', error);
      this.snackBar.open('Failed to update saved playlists', 'Close', { duration: 3000 });
    }
  }

  playPlaylist(playlistData: PlaylistData): void {
    const tracks = this.trackEvents();

    if (tracks.length === 0) {
      this.logger.warn('No tracks in playlist');
      this.snackBar.open('Playlist has no tracks', 'Close', { duration: 3000 });
      return;
    }

    this.logger.debug('Playing playlist:', playlistData.title, 'Tracks:', tracks.length);

    // Clear current queue and add all tracks
    this.mediaPlayerService.clearQueue();

    // Convert track events to MediaItems
    const mediaItems: MediaItem[] = tracks.map((trackEvent, index) => {
      const urlTag = trackEvent.tags.find(t => t[0] === 'url');
      const titleTag = trackEvent.tags.find(t => t[0] === 'title');
      const artistTag = trackEvent.tags.find(t => t[0] === 'artist');
      const imageTag = trackEvent.tags.find(t => t[0] === 'image');

      return {
        source: urlTag?.[1] || '',
        title: titleTag?.[1] || `Track ${index + 1}`,
        artist: artistTag?.[1] || 'Unknown Artist',
        artwork: imageTag?.[1] || '/icons/icon-192x192.png',
        type: this.getMediaType(urlTag?.[1] || ''),
      };
    });

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
    const tracks = this.trackEvents();

    if (tracks.length === 0) {
      this.logger.warn('No tracks in playlist');
      this.snackBar.open('Playlist has no tracks', 'Close', { duration: 3000 });
      return;
    }

    this.logger.debug('Adding playlist to queue:', playlistData.title, 'Tracks:', tracks.length);

    // Convert track events to MediaItems and add to queue
    const mediaItems: MediaItem[] = tracks.map((trackEvent, index) => {
      const urlTag = trackEvent.tags.find(t => t[0] === 'url');
      const titleTag = trackEvent.tags.find(t => t[0] === 'title');
      const artistTag = trackEvent.tags.find(t => t[0] === 'artist');
      const imageTag = trackEvent.tags.find(t => t[0] === 'image');

      return {
        source: urlTag?.[1] || '',
        title: titleTag?.[1] || `Track ${index + 1}`,
        artist: artistTag?.[1] || 'Unknown Artist',
        artwork: imageTag?.[1] || '/icons/icon-192x192.png',
        type: this.getMediaType(urlTag?.[1] || ''),
      };
    });

    // Add all tracks to queue
    mediaItems.forEach(item => {
      this.mediaPlayerService.enque(item);
    });

    this.snackBar.open(`Added ${mediaItems.length} track${mediaItems.length > 1 ? 's' : ''} to queue`, 'Close', { duration: 2000 });
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
    const videoExtensions = ['.mp4', '.webm', '.ogg', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.qt'];
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
      this.logger.error('Failed to parse playlist data:', error);
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
            currentTrack.duration = formatDuration(parseInt(duration, 10));
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

    return hasValidDurations ? formatDuration(totalSeconds) : undefined;
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


  private async loadTrackEvents(event: Event): Promise<void> {
    // Get all 'a' tags that reference track events (kind 36787)
    const aTags = event.tags.filter(tag => tag[0] === 'a');

    this.logger.debug('[PlaylistEvent] Loading tracks from a-tags:', aTags.length);

    if (aTags.length === 0) {
      this.logger.debug('[PlaylistEvent] No a-tags found in playlist event');
      return;
    }

    this.loadingTracks.set(true);
    const tracks: Event[] = [];

    try {
      for (const aTag of aTags) {
        const coordinate = aTag[1];
        if (!coordinate) continue;

        // Parse coordinate format: kind:pubkey:d-tag
        const parts = coordinate.split(':');
        if (parts.length !== 3) continue;

        const [kindStr, pubkey, dTag] = parts;
        const kind = parseInt(kindStr, 10);

        this.logger.debug(`[PlaylistEvent] Loading track: kind=${kind}, pubkey=${pubkey.substring(0, 8)}..., dTag=${dTag}`);

        // Only load track events (kind 36787)
        if (kind !== 36787) continue;

        try {
          const record = await this.dataService.getEventByPubkeyAndKindAndReplaceableEvent(
            pubkey,
            kind,
            dTag,
            { cache: true, save: true }
          );

          if (record && record.event) {
            this.logger.debug(`[PlaylistEvent] Successfully loaded track: ${record.event.id}`);
            tracks.push(record.event);
          } else {
            this.logger.warn(`[PlaylistEvent] Track not found: ${coordinate}`);
          }
        } catch (error) {
          this.logger.error(`[PlaylistEvent] Failed to load track ${coordinate}:`, error);
        }
      }

      this.logger.debug(`[PlaylistEvent] Loaded ${tracks.length} tracks total`);
      this.trackEvents.set(tracks);
    } finally {
      this.loadingTracks.set(false);
    }
  }
}
