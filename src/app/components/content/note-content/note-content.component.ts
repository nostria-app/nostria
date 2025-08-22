import { Component, input, inject } from '@angular/core';
import { Router } from '@angular/router';
import { UtilitiesService } from '../../../services/utilities.service';
import { MatDialog } from '@angular/material/dialog';
import { ImageDialogComponent } from '../../image-dialog/image-dialog.component';
import { ContentToken } from '../../../services/parsing.service';

@Component({
  selector: 'app-note-content',
  standalone: true,
  imports: [],
  templateUrl: './note-content.component.html',
  styleUrl: './note-content.component.scss',
})
export class NoteContentComponent {
  contentTokens = input<ContentToken[]>([]);
  private router = inject(Router);
  private utilities = inject(UtilitiesService);
  private dialog = inject(MatDialog);

  onNostrMentionClick(token: ContentToken) {
    if (!token.nostrData) return;

    const { type, data } = token.nostrData;

    switch (type) {
      case 'npub':
      case 'nprofile': {
        // Navigate to profile page
        const record = data as Record<string, unknown>;
        const pubkey =
          type === 'npub' ? String(data) : String(record['pubkey'] || '');
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
