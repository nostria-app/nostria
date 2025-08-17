import { Component, computed, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event } from 'nostr-tools';
import { decode } from 'blurhash';

interface VideoData {
  url: string;
  thumbnail?: string;
  blurhash?: string;
  duration?: number;
  title?: string;
  alt?: string;
}

@Component({
  selector: 'app-video-event',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatTooltipModule],
  templateUrl: './video-event.component.html',
  styleUrl: './video-event.component.scss',
})
export class VideoEventComponent {
  event = input.required<Event>();

  // Video expansion state
  isExpanded = signal(false);

  // Computed video data from the event
  videoData = computed(() => {
    const event = this.event();
    if (!event) return null;

    return this.getVideoData(event);
  });

  // Video title
  title = computed(() => {
    const event = this.event();
    if (!event) return null;

    return this.getEventTitle(event);
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

  // Description text (content without hashtags)
  description = computed(() => {
    const event = this.event();
    if (!event || !event.content) return null;

    return this.removeHashtagsFromContent(event.content);
  });

  expandVideo(): void {
    this.isExpanded.set(true);
  }

  collapseVideo(): void {
    this.isExpanded.set(false);
  }

  private getVideoData(event: Event): VideoData | null {
    // Extract video URL from tags
    const urlTag = event.tags.find(tag => tag[0] === 'url');
    const imageTag = event.tags.find(tag => tag[0] === 'image');
    const thumbTag = event.tags.find(tag => tag[0] === 'thumb');
    const blurhashTag = event.tags.find(tag => tag[0] === 'blurhash');
    const durationTag = event.tags.find(tag => tag[0] === 'duration');
    const titleTag = event.tags.find(tag => tag[0] === 'title');
    const altTag = event.tags.find(tag => tag[0] === 'alt');

    if (!urlTag?.[1]) return null;

    return {
      url: urlTag[1],
      thumbnail: thumbTag?.[1] || imageTag?.[1],
      blurhash: blurhashTag?.[1],
      duration: durationTag?.[1] ? parseInt(durationTag[1], 10) : undefined,
      title: titleTag?.[1],
      alt: altTag?.[1],
    };
  }

  private getEventTitle(event: Event): string | null {
    const titleTag = event.tags.find(tag => tag[0] === 'title');
    return titleTag?.[1] || null;
  }

  private removeHashtagsFromContent(content: string): string {
    return content.replace(/#\w+/g, '').trim();
  }

  generateBlurhashDataUrl(blurhash: string, width = 400, height = 225): string {
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

  formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
}
