import { Component, inject, signal, computed, DestroyRef, viewChild, ElementRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { MediaService, MediaItem } from '../../../services/media.service';
import { TimestampPipe } from '../../../pipes/timestamp.pipe';
import { MediaPreviewDialogComponent } from '../../../components/media-preview-dialog/media-preview.component';
import { ConfirmDialogComponent } from '../../../components/confirm-dialog/confirm-dialog.component';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MediaPublishDialogComponent, MediaPublishOptions } from '../media-publish-dialog/media-publish-dialog.component';
import { NostrService } from '../../../services/nostr.service';
import { PublishService } from '../../../services/publish.service';
import { nip19 } from 'nostr-tools';
import { AudioPlayerComponent } from '../../../components/audio-player/audio-player.component';
import { VideoControlsComponent } from '../../../components/video-controls/video-controls.component';
import { LayoutService } from '../../../services/layout.service';
import { LoggerService } from '../../../services/logger.service';

@Component({
  selector: 'app-media-details',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    TimestampPipe,
    MatTooltipModule,
    AudioPlayerComponent,
    VideoControlsComponent,
  ],
  templateUrl: './media-details.component.html',
  styleUrls: ['./media-details.component.scss'],
})
export class MediaDetailsComponent {
  private route = inject(ActivatedRoute);
  private layout = inject(LayoutService);
  private mediaService = inject(MediaService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private nostr = inject(NostrService);
  private publishService = inject(PublishService);
  private destroyRef = inject(DestroyRef);
  private readonly logger = inject(LoggerService);

  // Video element reference for video controls
  videoElement = viewChild<ElementRef<HTMLVideoElement>>('videoElement');
  // Video controls reference for showing/hiding controls on mouse events
  videoControls = viewChild(VideoControlsComponent);

  loading = signal(true);
  error = signal<string | null>(null);
  mediaItem = signal<MediaItem | null>(null);
  textContent = signal<string | null>(null);
  textLoading = signal(false);

  // Add computed signal for memoized mirror status
  isFullyMirroredStatus = computed(() => {
    const item = this.mediaItem();
    return item ? this.mediaService.isFullyMirrored(item) : false;
  });

  constructor() {
    // Subscribe to route param changes to react when navigating to different media items
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => {
        const id = params.get('id');
        if (!id) {
          this.error.set('No media ID provided');
          this.loading.set(false);
          return;
        }

        this.fetchMediaItem(id);
      });
  }

  private async fetchMediaItem(id: string): Promise<void> {
    try {
      this.loading.set(true);
      this.error.set(null);

      const item = await this.mediaService.getFileById(id);
      this.mediaItem.set(item);

      // If it's a text file, fetch its content
      if (item && this.isTextFile(item.type)) {
        await this.fetchTextContent(item.url);
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load media item');
    } finally {
      this.loading.set(false);
    }
  }

  async fetchTextContent(url: string): Promise<void> {
    try {
      this.textLoading.set(true);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to load text content (${response.status})`);
      }

      const text = await response.text();
      this.textContent.set(text);
    } catch (error) {
      this.logger.error('Error fetching text content:', error);
      this.textContent.set('Error loading text content');
    } finally {
      this.textLoading.set(false);
    }
  }

  isTextFile(mimeType: string | null | undefined): boolean {
    // Handle null/undefined type case
    if (!mimeType) return false;

    // Check for common text MIME types
    const textMimeTypes = [
      'text/plain',
      'text/html',
      'text/css',
      'text/javascript',
      'application/json',
      'application/xml',
      'text/csv',
      'text/markdown',
      'application/x-sh',
    ];

    return (
      textMimeTypes.some(type => mimeType.startsWith(type)) ||
      mimeType.includes('text/') ||
      // Check extensions for common text file formats
      this.hasTextFileExtension(mimeType)
    );
  }

  hasTextFileExtension(_mimeType: string): boolean {
    // For files where MIME type may not be correctly set,
    // check URL for common text file extensions
    const item = this.mediaItem();
    if (!item || !item.url) return false;

    const url = item.url.toLowerCase();
    const textExtensions = [
      '.txt',
      '.md',
      '.json',
      '.xml',
      '.csv',
      '.log',
      '.sh',
      '.js',
      '.ts',
      '.css',
      '.html',
      '.yml',
      '.yaml',
    ];

    return textExtensions.some(ext => url.endsWith(ext));
  }

  // Video control handlers
  onVideoPlayPause(): void {
    const video = this.videoElement()?.nativeElement;
    if (!video) return;

    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }

  onVideoSeek(time: number): void {
    const video = this.videoElement()?.nativeElement;
    if (video) {
      video.currentTime = time;
    }
  }

  onVideoVolumeChange(volume: number): void {
    const video = this.videoElement()?.nativeElement;
    if (video) {
      video.volume = volume;
      if (video.muted && volume > 0) {
        video.muted = false;
      }
    }
  }

  onVideoMuteToggle(): void {
    const video = this.videoElement()?.nativeElement;
    if (video) {
      video.muted = !video.muted;
    }
  }

  onVideoPlaybackRateChange(rate: number): void {
    const video = this.videoElement()?.nativeElement;
    if (video) {
      video.playbackRate = rate;
    }
  }

  async onVideoFullscreenToggle(): Promise<void> {
    const videoWrapper = document.querySelector('.video-wrapper');
    if (!videoWrapper) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await videoWrapper.requestFullscreen();
      }
    } catch {
      // Fullscreen not supported
    }
  }

  async onVideoPipToggle(): Promise<void> {
    const video = this.videoElement()?.nativeElement;
    if (!video) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch {
      // PiP not supported
    }
  }

  // Mouse event handlers for video controls visibility
  onVideoMouseEnter(): void {
    this.videoControls()?.showControlsAndStartTimer();
  }

  onVideoMouseLeave(): void {
    // Let the controls auto-hide via their internal timer
  }

  onVideoMouseMove(): void {
    this.videoControls()?.showControlsAndStartTimer();
  }

  async downloadMedia(): Promise<void> {
    const item = this.mediaItem();
    if (!item) return;

    try {
      // Show loading message
      this.snackBar.open('Preparing download...', '', { duration: 2000 });

      // Fetch the file
      const response = await fetch(item.url);
      const blob = await response.blob();

      // Get proper filename based on URL or mime type
      const filename = this.getFileName(item);

      // Create download link with proper download attribute
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;

      // Append to document, click, then clean up
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      this.snackBar.open('Download started', 'Close', { duration: 3000 });
    } catch (error) {
      this.snackBar.open('Failed to download media', 'Close', {
        duration: 3000,
      });
      this.logger.error('Download error:', error);
    }
  }

  openFullScreen(): void {
    const item = this.mediaItem();
    if (!item) return;

    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaUrl: item.url,
        mediaType: item.type,
        mediaTitle: item.url || 'Media',
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      panelClass: 'image-dialog-panel',
    });
  }

  async deleteMedia(): Promise<void> {
    const item = this.mediaItem();
    if (!item) return;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Media',
        message: 'Are you sure you want to delete this media? This action cannot be undone.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmColor: 'warn',
      },
    });

    const result = await dialogRef.afterClosed().toPromise();
    if (result) {
      try {
        await this.mediaService.deleteFile(item.sha256);
        this.snackBar.open('Media deleted successfully', 'Close', {
          duration: 3000,
        });
        // Close the right panel after deletion
        this.layout.closeRightPanel();
      } catch (error) {
        this.snackBar.open('Failed to delete media', 'Close', {
          duration: 3000,
        });
      }
    }
  }

  // Change the function to return the computed value
  isFullyMirrored(): boolean {
    return this.isFullyMirroredStatus();
  }

  async mirrorMedia(): Promise<void> {
    const item = this.mediaItem();
    if (!item) return;

    // Don't attempt mirroring if already mirrored to all available servers
    if (this.mediaService.isFullyMirrored(item)) {
      this.snackBar.open('Media is already mirrored to all your servers', 'Close', {
        duration: 3000,
      });
      return;
    }

    try {
      await this.mediaService.mirrorFile(item.sha256, item.url);
      this.snackBar.open('Media mirrored successfully', 'Close', {
        duration: 3000,
      });
    } catch (error) {
      this.snackBar.open('Failed to mirror media', 'Close', { duration: 3000 });
    }
  }

  async publishMedia(): Promise<void> {
    const item = this.mediaItem();
    if (!item) return;

    // Open the publish dialog
    const dialogRef = this.dialog.open(MediaPublishDialogComponent, {
      data: { mediaItem: item },
      maxWidth: '650px',
      width: '100%',
      panelClass: 'responsive-dialog',
    });

    const result: MediaPublishOptions | null = await dialogRef.afterClosed().toPromise();

    if (!result) {
      return; // User cancelled
    }

    try {
      // Show publishing message
      this.snackBar.open('Publishing to Nostr...', '', { duration: 2000 });

      // Build the event
      const event = await this.buildMediaEvent(item, result);

      // Sign and publish the event
      const signedEvent = await this.nostr.signEvent(event);
      const publishResult = await this.publishService.publish(signedEvent, {
        useOptimizedRelays: false, // Publish to ALL account relays for media events
      });

      if (publishResult.success) {
        this.snackBar.open('Successfully published to Nostr!', 'Close', {
          duration: 3000,
        });

        // Navigate to the published event
        const neventId = nip19.neventEncode({
          id: signedEvent.id,
          author: signedEvent.pubkey,
          kind: signedEvent.kind,
        });
        this.layout.openGenericEvent(neventId, signedEvent);
      } else {
        this.snackBar.open('Failed to publish to some relays', 'Close', {
          duration: 5000,
        });
      }
    } catch (error) {
      this.logger.error('Error publishing media:', error);
      this.snackBar.open('Failed to publish media', 'Close', {
        duration: 3000,
      });
    }
  } private async buildMediaEvent(item: MediaItem, options: MediaPublishOptions) {
    const tags: string[][] = [];

    // For kind 1 (regular note), build a simpler event structure
    if (options.kind === 1) {
      // Build content with description and media URL
      let content = options.content || '';
      if (content && !content.endsWith('\n')) {
        content += '\n';
      }
      content += item.url;

      // Add imeta tag according to NIP-92 for media attachment
      const imetaTag = ['imeta'];
      imetaTag.push(`url ${item.url}`);
      if (item.type) {
        imetaTag.push(`m ${item.type}`);
      }
      imetaTag.push(`x ${item.sha256}`);
      if (item.size) {
        imetaTag.push(`size ${item.size}`);
      }
      if (options.alt) {
        imetaTag.push(`alt ${options.alt}`);
      }
      // Add mirror URLs as fallback
      if (item.mirrors && item.mirrors.length > 0) {
        item.mirrors.forEach(mirrorUrl => {
          imetaTag.push(`fallback ${mirrorUrl}`);
        });
      }
      tags.push(imetaTag);

      // Add hashtags
      options.hashtags.forEach(tag => {
        tags.push(['t', tag]);
      });

      // Add content warning if provided
      if (options.contentWarning) {
        tags.push(['content-warning', options.contentWarning]);
      }

      // Add location if provided
      if (options.location) {
        tags.push(['location', options.location]);
      }

      // Add geohash if provided
      if (options.geohash) {
        tags.push(['g', options.geohash]);
      }

      // Create the event
      return this.nostr.createEvent(1, content, tags);
    }

    // Add d-tag for addressable events (kinds 34235, 34236)
    if ((options.kind === 34235 || options.kind === 34236) && options.dTag) {
      tags.push(['d', options.dTag]);
    }

    // Add title tag (required)
    tags.push(['title', options.title]);

    // Build imeta tag according to NIP-92/94
    const imetaTag = ['imeta'];

    // Add URL
    imetaTag.push(`url ${item.url}`);

    // Add MIME type
    if (item.type) {
      imetaTag.push(`m ${item.type}`);
    }

    // Add SHA-256 hash
    imetaTag.push(`x ${item.sha256}`);

    // Add file size
    if (item.size) {
      imetaTag.push(`size ${item.size}`);
    }

    // Add alt text if provided
    if (options.alt) {
      imetaTag.push(`alt ${options.alt}`);
    }

    // For videos, add duration if provided
    if (options.duration !== undefined && (options.kind === 21 || options.kind === 22 || options.kind === 34235 || options.kind === 34236)) {
      imetaTag.push(`duration ${options.duration}`);
    }

    // Add mirror URLs as fallback
    if (item.mirrors && item.mirrors.length > 0) {
      item.mirrors.forEach(mirrorUrl => {
        imetaTag.push(`fallback ${mirrorUrl}`);
      });
    }

    tags.push(imetaTag);

    // Add published_at timestamp
    tags.push(['published_at', Math.floor(Date.now() / 1000).toString()]);

    // Add alt tag separately if provided (for accessibility)
    if (options.alt) {
      tags.push(['alt', options.alt]);
    }

    // Add content warning if provided
    if (options.contentWarning) {
      tags.push(['content-warning', options.contentWarning]);
    }

    // Add hashtags
    options.hashtags.forEach(tag => {
      tags.push(['t', tag]);
    });

    // Add location if provided
    if (options.location) {
      tags.push(['location', options.location]);
    }

    // Add geohash if provided
    if (options.geohash) {
      tags.push(['g', options.geohash]);
    }

    // Add origin tag for addressable events (NIP-71)
    if ((options.kind === 34235 || options.kind === 34236) && options.origin) {
      const originTag = ['origin', options.origin.platform];
      if (options.origin.externalId) {
        originTag.push(options.origin.externalId);
      }
      if (options.origin.url) {
        originTag.push(options.origin.url);
      }
      tags.push(originTag);
    }

    // Add MIME type as m tag for filtering (for images)
    if (item.type && options.kind === 20) {
      tags.push(['m', item.type]);
    }

    // Add x tag with hash for queryability
    tags.push(['x', item.sha256]);

    // Create the event
    const event = this.nostr.createEvent(
      options.kind,
      options.content,
      tags
    );

    return event;
  }

  goBack(): void {
    // Close the right panel
    this.layout.closeRightPanel();
  }

  getMediaIcon(type: string | null | undefined): string {
    if (!type) return 'insert_drive_file'; // Default icon for unknown types
    if (type.startsWith('image')) return 'image';
    if (type.startsWith('video')) return 'videocam';
    if (type.startsWith('audio')) return 'audiotrack';
    if (this.isTextFile(type)) return 'description';
    return 'insert_drive_file';
  }

  isAudioFile(mimeType: string | null | undefined): boolean {
    if (!mimeType) return false;
    return mimeType.startsWith('audio');
  }

  getFileName(item: MediaItem): string {
    // Handle case where type might be null/undefined
    const mimeType = item.type || 'application/octet-stream';
    const extension = mimeType.split('/')[1] || 'file';
    const baseFileName = item.url?.split('/').pop() || `nostr-media.${extension}`;

    // If the URL already has a proper filename with extension, use it
    if (baseFileName.includes('.')) {
      return baseFileName;
    }

    // Otherwise construct one using the sha256 and the MIME type
    return `nostr-media-${item.sha256.substring(0, 8)}.${extension}`;
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Helper method to extract server from URL
  getServerFromUrl(url: string): string {
    try {
      const parsedUrl = new URL(url);
      return `${parsedUrl.protocol}//${parsedUrl.host}/`;
    } catch {
      return 'Unknown Server';
    }
  }

  // Helper method to get full mirror URLs
  // If a mirror is already a full URL, return it as-is
  // If it's a relative path, reconstruct it using the server base and the filename from the main URL
  getFullMirrorUrl(mirror: string, mainUrl: string): string {
    // Check if it's already a full URL
    try {
      new URL(mirror);
      return mirror; // Already a full URL
    } catch {
      // It's a relative path, reconstruct the full URL
      // Extract the filename from the main URL
      const filename = mainUrl.substring(mainUrl.lastIndexOf('/') + 1);

      // If mirror starts with '/', it's an absolute path
      if (mirror.startsWith('/')) {
        // Find the server from the configured media servers that matches this path
        const servers = this.mediaService.mediaServers();
        for (const server of servers) {
          const serverBase = server.endsWith('/') ? server.slice(0, -1) : server;
          const fullUrl = serverBase + mirror;

          // Verify this URL makes sense (contains the filename)
          if (fullUrl.includes(filename)) {
            return fullUrl;
          }
        }

        // Fallback: use the first server if no match found
        if (servers.length > 0) {
          const serverBase = servers[0].endsWith('/') ? servers[0].slice(0, -1) : servers[0];
          return serverBase + mirror;
        }
      }

      // Fallback: return the mirror as-is if we can't reconstruct it
      return mirror;
    }
  }
}
