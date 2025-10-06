import { Component, input, inject, effect, signal } from '@angular/core';
import { Router } from '@angular/router';
import { UtilitiesService } from '../../../services/utilities.service';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { ImageDialogComponent } from '../../image-dialog/image-dialog.component';
import { ContentToken } from '../../../services/parsing.service';
import { FormatService } from '../../../services/format/format.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-note-content',
  standalone: true,
  imports: [MatIconModule],
  templateUrl: './note-content.component.html',
  styleUrl: './note-content.component.scss',
})
export class NoteContentComponent {
  contentTokens = input<ContentToken[]>([]);
  private router = inject(Router);
  private utilities = inject(UtilitiesService);
  private dialog = inject(MatDialog);
  private formatService = inject(FormatService);
  private sanitizer = inject(DomSanitizer);

  // Store rendered HTML for nevent/note previews
  private eventPreviewsMap = signal<Map<number, SafeHtml>>(new Map());

  constructor() {
    // When tokens change, fetch event previews for nevent/note types
    effect(() => {
      const tokens = this.contentTokens();
      this.loadEventPreviews(tokens);
    });
  }

  private async loadEventPreviews(tokens: ContentToken[]): Promise<void> {
    const previewsMap = new Map<number, SafeHtml>();

    for (const token of tokens) {
      if (token.type === 'nostr-mention' && token.nostrData) {
        const { type, data } = token.nostrData;

        if (type === 'nevent' || type === 'note') {
          try {
            const eventId = type === 'nevent' ? data.id : data;
            const authorPubkey = type === 'nevent' ? (data.author || data.pubkey) : undefined;
            const relayHints = type === 'nevent' ? data.relays : undefined;

            console.debug(`[NoteContent] Loading preview for ${type}:`, eventId);

            const previewHtml = await this.formatService.fetchEventPreview(
              eventId,
              authorPubkey,
              relayHints
            );

            if (previewHtml) {
              previewsMap.set(token.id, this.sanitizer.bypassSecurityTrustHtml(previewHtml));
              console.debug(`[NoteContent] Preview loaded for token ${token.id}`);
            }
          } catch (error) {
            console.error(`[NoteContent] Error loading preview for token ${token.id}:`, error);
          }
        }
      }
    }

    this.eventPreviewsMap.set(previewsMap);
  }

  getEventPreview(tokenId: number): SafeHtml | undefined {
    return this.eventPreviewsMap().get(tokenId);
  }

  onNostrMentionClick(token: ContentToken) {
    if (!token.nostrData) return;

    const { type, data } = token.nostrData;

    switch (type) {
      case 'npub':
      case 'nprofile': {
        // Navigate to profile page
        const record = data as Record<string, unknown>;
        const pubkey = type === 'npub' ? String(data) : String(record['pubkey'] || '');
        this.router.navigate(['/p', this.utilities.getNpubFromPubkey(pubkey)]);
        break;
      }
      case 'note':
      default:
        console.warn('Unsupported nostr URI type:', type);
    }
  }

  getVideoType(url: string): string {
    const extension = url.split('.').pop()?.split('?')[0]?.toLowerCase();
    switch (extension) {
      case 'mp4':
        return 'mp4';
      case 'webm':
        return 'webm';
      case 'mov':
        return 'quicktime';
      case 'avi':
        return 'x-msvideo';
      case 'wmv':
        return 'x-ms-wmv';
      case 'flv':
        return 'x-flv';
      case 'mkv':
        return 'x-matroska';
      default:
        return 'mp4';
    }
  }

  /**
   * Check if a video format is likely to be supported by modern browsers
   */
  isVideoFormatSupported(url: string): boolean {
    const extension = url.split('.').pop()?.split('?')[0]?.toLowerCase();
    // Only MP4 and WebM have good cross-browser support
    return extension === 'mp4' || extension === 'webm';
  }

  /**
   * Handle video load errors by showing a download link
   */
  onVideoError(event: Event, videoUrl: string): void {
    const target = event.target as HTMLVideoElement;
    if (target) {
      console.warn('Video failed to load:', videoUrl);
      // The template will handle showing the fallback
    }
  }

  /**
   * Opens an image dialog to view the image with zoom capabilities
   */
  openImageDialog(imageUrl: string): void {
    console.log('Opening image dialog for URL:', imageUrl);
    this.dialog.open(ImageDialogComponent, {
      data: { imageUrl },
      maxWidth: '95vw',
      maxHeight: '95vh',
      width: '100%',
      height: '100%',
      panelClass: 'image-dialog',
    });
  }
}
