import { Component, inject, NgZone, signal, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AddMediaDialog, AddMediaDialogData } from './add-media-dialog/add-media-dialog';
import { SelectPlaylistDialogComponent, SelectPlaylistDialogData, SelectPlaylistDialogResult } from '../../components/select-playlist-dialog/select-playlist-dialog.component';
import { MediaItem, PodcastProgress } from '../../interfaces';
import { UtilitiesService } from '../../services/utilities.service';
import { MediaPlayerService } from '../../services/media-player.service';
import { PlaylistService } from '../../services/playlist.service';
import { RssParserService } from '../../services/rss-parser.service';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTabsModule } from '@angular/material/tabs';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { PlaylistsTabComponent } from './playlists-tab/playlists-tab.component';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { PanelHeaderComponent, PanelAction } from '../../components/panel-header/panel-header.component';
import { nip19 } from 'nostr-tools';

@Component({
  selector: 'app-media-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatTooltipModule,
    MatMenuModule,
    MatTabsModule,
    DragDropModule,
    PlaylistsTabComponent,
    UserProfileComponent,
    PanelHeaderComponent,
  ],
  templateUrl: './media-queue.component.html',
  styleUrl: './media-queue.component.scss',
})
export class MediaQueueComponent implements OnInit {
  utilities = inject(UtilitiesService);
  media = inject(MediaPlayerService);
  playlistService = inject(PlaylistService);
  private rssParser = inject(RssParserService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private ngZone = inject(NgZone);

  selectedTabIndex = signal(0);

  // Queue header actions
  queueActions = signal<PanelAction[]>([
    {
      id: 'add-to-playlist',
      icon: 'playlist_add',
      label: 'Add to Playlist',
      tooltip: 'Add entire queue to playlist',
    },
  ]);

  ngOnInit(): void {
    // Set initial tab based on route
    const url = this.router.url;
    if (url.includes('/playlists') && !url.includes('/playlists/edit')) {
      this.selectedTabIndex.set(1);
    } else {
      this.selectedTabIndex.set(0);
    }
  }

  onTabChange(index: number): void {
    this.selectedTabIndex.set(index);
    if (index === 0) {
      this.router.navigate(['/queue'], { replaceUrl: true });
    } else if (index === 1) {
      this.router.navigate(['/playlists'], { replaceUrl: true });
    }
  }
  pressedItemIndex = -1;

  onMouseDown(index: number) {
    this.pressedItemIndex = index;
  }

  onMouseUp() {
    this.pressedItemIndex = -1;
  }

  onDragStarted() {
    this.pressedItemIndex = -1; // Clear pressed state when drag starts
    if (navigator.vibrate) {
      navigator.vibrate(50);
    }
  }

  drop(event: CdkDragDrop<string[]>) {
    const currentMedia = this.media.media();
    moveItemInArray(currentMedia, event.previousIndex, event.currentIndex);
    this.media.media.set(currentMedia);
    this.media.save();

    // If the currently playing item was moved, update the index
    if (this.media.index === event.previousIndex) {
      this.media.index = event.currentIndex;
    } else if (
      this.media.index > event.previousIndex &&
      this.media.index <= event.currentIndex
    ) {
      this.media.index--;
    } else if (
      this.media.index < event.previousIndex &&
      this.media.index >= event.currentIndex
    ) {
      this.media.index++;
    }
  }

  onMouseMove(event: MouseEvent, target: EventTarget | null) {
    if (!target) return;

    this.ngZone.runOutsideAngular(() => {
      const element = target as HTMLElement;
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      element.style.setProperty('--mouse-x', `${x}px`);
      element.style.setProperty('--mouse-y', `${y}px`);
    });
  }

  /**
   * Get artwork URL for media item, extracting YouTube thumbnail if applicable
   */
  getArtwork(item: MediaItem): string {
    // If we have artwork and it's not the old placeholder, use it
    if (item.artwork && item.artwork !== '/logos/youtube.png') {
      return item.artwork;
    }

    // Try to extract YouTube ID from various formats
    const youtubeId = this.extractYouTubeId(item.source || item.title);
    if (youtubeId) {
      return `https://img.youtube.com/vi/${youtubeId}/0.jpg`;
    }

    // No artwork available
    return '';
  }

  /**
   * Check if artwork is available
   */
  hasArtwork(item: MediaItem): boolean {
    const artwork = this.getArtwork(item);
    return artwork !== '';
  }

  /**
   * Check if artist is an npub
   */
  isNpubArtist(artist: string | undefined): boolean {
    return !!artist && artist.startsWith('npub1');
  }

  /**
   * Get hex pubkey from npub artist
   */
  getNpubPubkey(artist: string): string {
    try {
      const decoded = nip19.decode(artist);
      if (decoded.type === 'npub') {
        return decoded.data;
      }
    } catch {
      // Ignore decoding errors
    }
    return '';
  }

  /**
   * Extract YouTube video ID from various URL formats
   */
  private extractYouTubeId(url: string): string | null {
    if (!url) return null;

    // Handle youtube.com/embed/ format
    const embedMatch = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]+)/);
    if (embedMatch) return embedMatch[1];

    // Handle youtube.com/watch?v= format
    const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
    if (watchMatch) return watchMatch[1];

    // Handle youtu.be/ format
    const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
    if (shortMatch) return shortMatch[1];

    // Handle youtube.com/shorts/ format
    const shortsMatch = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/);
    if (shortsMatch) return shortsMatch[1];

    // Handle youtube.com/live/ format
    const liveMatch = url.match(/youtube\.com\/live\/([a-zA-Z0-9_-]+)/);
    if (liveMatch) return liveMatch[1];

    return null;
  }

  addQueue() {
    const dialogRef = this.dialog.open(AddMediaDialog, {
      data: {},
      maxWidth: '100vw',
      panelClass: 'full-width-dialog',
    });

    dialogRef.afterClosed().subscribe(async (result: AddMediaDialogData) => {
      if (!result || !result.url) {
        return;
      }

      const startIndex = this.media.media().length;

      // Try parsing as RSS first
      try {
        const feed = await this.rssParser.parse(result.url);
        if (feed && feed.items.length > 0) {
          // Determine media type based on feed medium
          let mediaType: 'Music' | 'Podcast' | 'Video';
          switch (feed.medium) {
            case 'music':
              mediaType = 'Music';
              break;
            case 'video':
            case 'film':
              mediaType = 'Video';
              break;
            default:
              mediaType = 'Podcast';
          }

          for (const item of feed.items) {
            console.log('Adding to queue - source URL:', item.mediaUrl);
            this.media.enque({
              artist: feed.author || feed.title,
              artwork: item.image || feed.image,
              title: item.title,
              source: item.mediaUrl,
              type: mediaType
            });
          }

          if (result.playImmediately) {
            this.media.index = startIndex;
            this.media.start();
          }
          return;
        }
      } catch {
        // Ignore error and continue with other checks
      }

      if (result.url.indexOf('youtu.be') > -1 || result.url.indexOf('youtube.com') > -1) {
        const youtubes = [...result.url.matchAll(this.utilities.regexpYouTube)];
        const youtube = youtubes.map(i => {
          return {
            url: `https://www.youtube.com/embed/${i[1]}`,
            id: i[1]
          };
        });

        for (const video of youtube) {
          this.media.enque({
            artist: '',
            artwork: `https://img.youtube.com/vi/${video.id}/0.jpg`,
            title: video.url,
            source: video.url,
            type: 'YouTube',
          });
        }
      } else if (result.url.indexOf('.mp4') > -1 || result.url.indexOf('.webm') > -1 || result.url.indexOf('.mov') > -1 || result.url.indexOf('.avi') > -1 || result.url.indexOf('.wmv') > -1 || result.url.indexOf('.flv') > -1 || result.url.indexOf('.mkv') > -1 || result.url.indexOf('.qt') > -1) {
        this.media.enque({
          artist: '',
          artwork: '',
          title: result.url,
          source: result.url,
          type: 'Video',
        });
      } else {
        this.media.enque({
          artist: '',
          artwork: '',
          title: result.url,
          source: result.url,
          type: 'Music',
        });
      }

      if (result.playImmediately) {
        this.media.index = startIndex;
        this.media.start();
      }
    });
  }

  remove(item: MediaItem) {
    this.media.dequeue(item);
  }

  clearQueue() {
    this.media.clearQueue();
  }

  /**
   * Handle queue header action clicks
   */
  onQueueActionClick(action: PanelAction): void {
    switch (action.id) {
      case 'add-to-playlist':
        this.addQueueToPlaylist();
        break;
    }
  }

  isCurrentPlaying(item: MediaItem, index: number): boolean {
    return this.media.current() === item && this.media.index === index;
  }

  playItem(index: number) {
    this.media.index = index;
    this.media.start();
  }

  /**
   * Add a single media item to a playlist
   */
  addToPlaylist(item: MediaItem): void {
    this.openPlaylistSelectionDialog([item]);
  }

  /**
   * Add entire queue to a playlist
   */
  addQueueToPlaylist(): void {
    const mediaItems = this.media.media();
    if (mediaItems.length === 0) {
      this.snackBar.open('No media in queue to add', 'Close', {
        duration: 3000,
      });
      return;
    }
    this.openPlaylistSelectionDialog(mediaItems);
  }

  /**
   * Open dialog to select or create a playlist and add media items
   */
  private openPlaylistSelectionDialog(mediaItems: MediaItem[]): void {
    const dialogRef = this.dialog.open(SelectPlaylistDialogComponent, {
      width: '500px',
      data: {
        mediaItems,
      } as SelectPlaylistDialogData,
    });

    dialogRef.afterClosed().subscribe((result: SelectPlaylistDialogResult) => {
      if (!result) {
        return;
      }

      // Convert media items to playlist tracks
      const tracks = mediaItems.map(item =>
        this.playlistService.mediaItemToPlaylistTrack(item)
      );

      if (result.createNew && result.newPlaylistName) {
        // Create new playlist with the tracks
        this.playlistService.createPlaylist(
          result.newPlaylistName,
          undefined,
          undefined,
          tracks
        );

        // Save the playlist
        try {
          this.playlistService.savePlaylist();
          this.snackBar.open(
            `Added ${mediaItems.length} track${mediaItems.length > 1 ? 's' : ''} to new playlist "${result.newPlaylistName}"`,
            'View',
            {
              duration: 5000,
            }
          ).onAction().subscribe(() => {
            this.router.navigate(['/playlists']);
          });
        } catch (error) {
          console.error('Failed to create playlist:', error);
          this.snackBar.open('Failed to create playlist', 'Close', {
            duration: 3000,
          });
        }
      } else if (result.playlistId) {
        // Add to existing playlist
        try {
          this.playlistService.addTracksToPlaylist(result.playlistId, tracks);
          const playlist = this.playlistService.getPlaylist(result.playlistId);
          this.snackBar.open(
            `Added ${mediaItems.length} track${mediaItems.length > 1 ? 's' : ''} to "${playlist?.title}"`,
            'View',
            {
              duration: 5000,
            }
          ).onAction().subscribe(() => {
            this.router.navigate(['/playlists']);
          });
        } catch (error) {
          console.error('Failed to add to playlist:', error);
          this.snackBar.open('Failed to add to playlist', 'Close', {
            duration: 3000,
          });
        }
      }
    });
  }

  /**
   * Handle image loading errors by hiding the image and showing the fallback icon
   */
  onImageError(event: Event, item: MediaItem) {
    console.warn('Failed to load artwork for:', item.title, 'URL:', this.getArtwork(item));
    // The image will be hidden by setting artwork to empty, triggering the fallback icon
    item.artwork = '';
  }

  /**
   * Get podcast progress for a media item
   */
  getPodcastProgress(item: MediaItem): PodcastProgress | null {
    if (item.type !== 'Podcast') {
      return null;
    }
    return this.media.getPodcastProgress(item.source);
  }

  /**
   * Check if a podcast is marked as completed
   */
  isPodcastCompleted(item: MediaItem): boolean {
    const progress = this.getPodcastProgress(item);
    return progress?.completed || false;
  }

  /**
   * Mark a podcast as completed/listened
   */
  markAsCompleted(item: MediaItem, event: Event) {
    event.stopPropagation();
    if (item.type === 'Podcast') {
      this.media.setPodcastCompleted(item.source, true);
    }
  }

  /**
   * Mark a podcast as not completed
   */
  markAsNotCompleted(item: MediaItem, event: Event) {
    event.stopPropagation();
    if (item.type === 'Podcast') {
      this.media.setPodcastCompleted(item.source, false);
    }
  }

  /**
   * Reset podcast progress
   */
  resetPodcastProgress(item: MediaItem, event: Event) {
    event.stopPropagation();
    if (item.type === 'Podcast') {
      this.media.resetPodcastProgress(item.source);
    }
  }

  /**
   * Format the last listened date
   */
  formatLastListened(timestamp: number): string {
    const date = new Date(timestamp * 1000); // Convert from seconds to milliseconds
    const now = new Date();
    const MS_PER_DAY = 1000 * 60 * 60 * 24;
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / MS_PER_DAY);

    if (diffDays === 0) {
      return 'Today';
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    } else {
      return date.toLocaleDateString();
    }
  }

  /**
   * Get listening status text for a podcast
   */
  getListeningStatus(item: MediaItem): string {
    const progress = this.getPodcastProgress(item);
    if (!progress) {
      return '';
    }

    if (progress.completed) {
      return `Completed • ${this.formatLastListened(progress.lastListenedAt)}`;
    }

    if (progress.position > 0 && progress.duration && progress.duration > 0) {
      const percentage = Math.floor((progress.position / progress.duration) * 100);
      return `${percentage}% • ${this.formatLastListened(progress.lastListenedAt)}`;
    }

    if (progress.lastListenedAt > 0) {
      return `Started • ${this.formatLastListened(progress.lastListenedAt)}`;
    }

    return '';
  }
}
