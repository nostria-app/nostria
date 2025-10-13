import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { AddMediaDialog, AddMediaDialogData } from './add-media-dialog/add-media-dialog';
import { MediaItem } from '../../interfaces';
import { UtilitiesService } from '../../services/utilities.service';
import { MediaPlayerService } from '../../services/media-player.service';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-media-queue',
  imports: [MatButtonModule, MatIconModule, MatListModule, RouterModule],
  templateUrl: './media-queue.component.html',
  styleUrl: './media-queue.component.scss',
})
export class MediaQueueComponent {
  utilities = inject(UtilitiesService);
  media = inject(MediaPlayerService);
  private dialog = inject(MatDialog);

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
    return this.media.current === item && this.media.index === index;
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
}
