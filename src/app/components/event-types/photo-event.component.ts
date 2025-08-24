import { Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { Event } from 'nostr-tools';
import { decode } from 'blurhash';
import { ImageDialogComponent } from '../image-dialog/image-dialog.component';

@Component({
  selector: 'app-photo-event',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule],
  templateUrl: './photo-event.component.html',
  styleUrl: './photo-event.component.scss',
})
export class PhotoEventComponent {
  event = input.required<Event>();

  private dialog = inject(MatDialog);

  // Computed image URLs from the event
  imageUrls = computed(() => {
    const event = this.event();
    if (!event) return [];

    return this.getImageUrls(event);
  });

  // Photo title
  title = computed(() => {
    const event = this.event();
    if (!event) return null;

    return this.getEventTitle(event);
  });

  // Content warning check
  hasContentWarning = computed(() => {
    const event = this.event();
    if (!event) return false;

    return event.tags.some((tag) => tag[0] === 'content-warning');
  });

  contentWarning = computed(() => {
    const event = this.event();
    if (!event) return null;

    const warningTag = event.tags.find((tag) => tag[0] === 'content-warning');
    return warningTag?.[1] || 'Content may be sensitive';
  });

  // Description text (content without hashtags)
  description = computed(() => {
    const event = this.event();
    if (!event || !event.content) return null;

    return this.removeHashtagsFromContent(event.content);
  });

  // Alt text for accessibility
  altText = computed(() => {
    const event = this.event();
    if (!event) return 'Photo';

    const altTag = event.tags.find((tag) => tag[0] === 'alt');
    return altTag?.[1] || this.getEventTitle(event) || 'Photo';
  });

  openImageDialog(imageUrl: string, alt: string): void {
    this.dialog.open(ImageDialogComponent, {
      data: { imageUrl, alt },
      maxWidth: '95vw',
      maxHeight: '95vh',
      panelClass: 'image-dialog-panel',
    });
  }

  onImageLoad(event: globalThis.Event): void {
    const target = event.target as HTMLImageElement;
    if (target && target.previousElementSibling) {
      // Hide blurhash placeholder when main image loads
      (target.previousElementSibling as HTMLElement).style.opacity = '0';
    }
  }

  getBlurhash(event: Event, imageIndex = 0): string | null {
    const blurhashTags = event.tags.filter((tag) => tag[0] === 'blurhash');
    return blurhashTags[imageIndex]?.[1] || null;
  }

  generateBlurhashDataUrl(blurhash: string, width = 400, height = 400): string {
    try {
      const pixels = decode(blurhash, width, height);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';

      const imageData = ctx.createImageData(width, height);
      imageData.data.set(pixels);
      ctx.putImageData(imageData, 0, 0);

      return canvas.toDataURL();
    } catch (error) {
      console.warn('Failed to decode blurhash:', error);
      return '';
    }
  }

  private getImageUrls(event: Event): string[] {
    const imageUrls: string[] = [];

    // Get URLs from 'url' tags (primary images)
    const urlTags = event.tags.filter((tag) => tag[0] === 'url');
    imageUrls.push(...urlTags.map((tag) => tag[1]));

    // Get URLs from 'image' tags (alternative images)
    const imageTags = event.tags.filter((tag) => tag[0] === 'image');
    imageUrls.push(...imageTags.map((tag) => tag[1]));

    // Remove duplicates
    return [...new Set(imageUrls)];
  }

  private getEventTitle(event: Event): string | null {
    const titleTag = event.tags.find((tag) => tag[0] === 'title');
    return titleTag?.[1] || null;
  }

  private removeHashtagsFromContent(content: string): string {
    return content.replace(/#\w+/g, '').trim();
  }
}
