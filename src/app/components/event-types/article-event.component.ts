import { Component, computed, input, signal, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Event } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { LayoutService } from '../../services/layout.service';
import { FormatService } from '../../services/format/format.service';
import { SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-article-event',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  templateUrl: './article-event.component.html',
  styleUrl: './article-event.component.scss',
})
export class ArticleEventComponent {
  private layout = inject(LayoutService);
  private formatService = inject(FormatService);
  private readonly MAX_LENGTH = 300;

  event = input.required<Event>();
  showAuthor = input<boolean>(true);

  // Signal to track if content is expanded
  isExpanded = signal(false);

  // Article title
  title = computed(() => {
    const event = this.event();
    if (!event) return null;

    return this.getEventTitle(event);
  });

  // Article summary/description
  summary = computed(() => {
    const event = this.event();
    if (!event) return null;

    const summaryTag = event.tags.find(tag => tag[0] === 'summary');
    return summaryTag?.[1] || null;
  });

  previewContent = signal<SafeHtml>('');
  articleContent = signal<SafeHtml>('');

  constructor() {
    effect(async () => {
      const event = this.event();
      if (!event || !event.content) return;

      if (event.content.length > this.MAX_LENGTH) {
        this.previewContent.set(
          await this.formatService.markdownToHtml(`${event.content.substring(0, this.MAX_LENGTH)}…`)
        );
      }

      this.articleContent.set(await this.formatService.markdownToHtml(event.content));
    });
  }

  // Article URL if available
  articleUrl = computed(() => {
    const event = this.event();
    if (!event) return null;

    const urlTag = event.tags.find(tag => tag[0] === 'r' || tag[0] === 'url');
    return urlTag?.[1] || null;
  });

  // Published date
  publishedAt = computed(() => {
    const event = this.event();
    if (!event) return null;

    const publishedTag = event.tags.find(tag => tag[0] === 'published_at');
    if (publishedTag?.[1]) {
      return new Date(parseInt(publishedTag[1]) * 1000);
    }

    // Fallback to event created_at
    return new Date(event.created_at * 1000);
  });

  // Author information from tags
  authorName = computed(() => {
    const event = this.event();
    if (!event) return null;

    const authorTag = event.tags.find(tag => tag[0] === 'author');
    return authorTag?.[1] || null;
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

  // Tags for categorization
  articleTags = computed(() => {
    const event = this.event();
    if (!event) return [];

    return event.tags
      .filter(tag => tag[0] === 't')
      .map(tag => tag[1])
      .filter(Boolean);
  });

  // Truncated content for preview
  contentToShow = computed<SafeHtml>(() => {
    const content = this.articleContent();
    const previewContent = this.previewContent();
    if (!content) return '';

    // If expanded, show full content
    if (this.isExpanded() || !previewContent) return content;

    return previewContent;
  });

  // Check if content exceeds MAX_LENGTH and thus has a preview
  isLongArticle = computed<boolean>(() => {
    return !!this.previewContent();
  });

  expandContent(): void {
    this.isExpanded.set(!this.isExpanded());
  }

  openFullArticle(): void {
    const event = this.event();
    if (!event) return;

    // Get the article identifier (d tag)
    const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || '';

    // Create naddr for the article
    const naddr = nip19.naddrEncode({
      identifier: dTag,
      kind: event.kind,
      pubkey: event.pubkey,
    });

    // Navigate to the article page using layout service
    this.layout.openArticle(naddr, event);
  }

  private getEventTitle(event: Event): string | null {
    const titleTag = event.tags.find(tag => tag[0] === 'title');
    return titleTag?.[1] || null;
  }
}
