import { ChangeDetectionStrategy, Component, inject, computed } from '@angular/core';
import { MediaPlayerService } from '../../services/media-player.service';
import { LayoutService } from '../../services/layout.service';

@Component({
  selector: 'app-standalone-video-player',
  imports: [],
  templateUrl: './video-player.component.html',
  styleUrl: './video-player.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StandaloneVideoPlayerComponent {
  media = inject(MediaPlayerService);
  layout = inject(LayoutService);

  // Computed MIME type for video based on URL
  videoMimeType = computed(() => {
    const videoUrl = this.media.videoUrl();
    if (!videoUrl) return 'video/mp4';

    const url = String(videoUrl);
    return this.getMimeTypeFromUrl(url);
  });

  /**
   * Determines the correct MIME type based on the video file extension
   * Modern .mov files are typically MPEG-4 videos that can be played by modern browsers
   */
  private getMimeTypeFromUrl(url: string): string {
    const urlLower = url.toLowerCase();

    // Extract file extension
    const extension = urlLower.split('?')[0].split('#')[0].split('.').pop();

    // Map file extensions to MIME types
    const mimeTypeMap: Record<string, string> = {
      'mp4': 'video/mp4',
      'm4v': 'video/mp4',
      'mov': 'video/mp4', // Modern .mov files are usually MPEG-4
      'qt': 'video/quicktime',
      'webm': 'video/webm',
      'ogg': 'video/ogg',
      'ogv': 'video/ogg',
      'avi': 'video/x-msvideo',
      'wmv': 'video/x-ms-wmv',
      'flv': 'video/x-flv',
      'mkv': 'video/x-matroska',
      '3gp': 'video/3gpp',
      '3g2': 'video/3gpp2',
    };

    // Return the MIME type or default to mp4
    return mimeTypeMap[extension || ''] || 'video/mp4';
  }
}
