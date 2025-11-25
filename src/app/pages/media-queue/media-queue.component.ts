import { Component, inject, NgZone } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { AddMediaDialog, AddMediaDialogData } from './add-media-dialog/add-media-dialog';
import { MediaItem, PodcastProgress } from '../../interfaces';
import { UtilitiesService } from '../../services/utilities.service';
import { MediaPlayerService } from '../../services/media-player.service';
import { RssParserService } from '../../services/rss-parser.service';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';

@Component({
  selector: 'app-media-queue',
  imports: [MatButtonModule, MatIconModule, MatListModule, RouterModule, DragDropModule, MatMenuModule, MatTooltipModule],
  templateUrl: './media-queue.component.html',
  styleUrl: './media-queue.component.scss',
})
export class MediaQueueComponent {
  utilities = inject(UtilitiesService);
  media = inject(MediaPlayerService);
  private rssParser = inject(RssParserService);
  private dialog = inject(MatDialog);
  private ngZone = inject(NgZone);

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

  onMouseMove(event: MouseEvent, target: any) {
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

      // Try parsing as RSS first
      try {
        const feed = await this.rssParser.parse(result.url);
        if (feed && feed.items.length > 0) {
          for (const item of feed.items) {
            this.media.enque({
              artist: feed.title,
              artwork: item.image || feed.image,
              title: item.title,
              source: item.mediaUrl,
              type: 'Podcast'
            });
          }
          return;
        }
      } catch (e) {
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
      } else if (result.url.indexOf('.mp4') > -1 || result.url.indexOf('.webm') > -1 || result.url.indexOf('.mov') > -1 || result.url.indexOf('.avi') > -1 || result.url.indexOf('.wmv') > -1 || result.url.indexOf('.flv') > -1 || result.url.indexOf('.mkv') > -1) {
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
    });
  }

  remove(item: MediaItem) {
    this.media.dequeue(item);
  }

  clearQueue() {
    this.media.clearQueue();
  }

  isCurrentPlaying(item: MediaItem, index: number): boolean {
    return this.media.current() === item && this.media.index === index;
  }

  playItem(index: number) {
    this.media.index = index;
    this.media.start();
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
