import { Component, computed, input, signal, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Event } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { LayoutService } from '../../services/layout.service';
import { FormatService } from '../../services/format/format.service';
import { SafeHtml } from '@angular/platform-browser';
import { MentionHoverDirective } from '../../directives/mention-hover.directive';
import { LocalSettingsService } from '../../services/local-settings.service';
import { ChroniaCalendarService } from '../../services/chronia-calendar.service';

@Component({
  selector: 'app-article-event',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MentionHoverDirective],
  templateUrl: './article-event.component.html',
  styleUrl: './article-event.component.scss',
})
export class ArticleEventComponent {
  private layout = inject(LayoutService);
  private formatService = inject(FormatService);
  private localSettings = inject(LocalSettingsService);
  private chroniaCalendar = inject(ChroniaCalendarService);
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
  isJsonContent = signal<boolean>(false);
  jsonData = signal<Record<string, unknown> | unknown[] | null>(null);

  constructor() {
    effect(() => {
      const event = this.event();
      if (!event || !event.content) return;

      // Check if content is JSON
      const jsonResult = this.tryParseJson(event.content);
      if (jsonResult.isJson) {
        this.isJsonContent.set(true);
        this.jsonData.set(jsonResult.data);
        // For JSON, we'll render it specially, so set empty HTML
        this.previewContent.set('');
        this.articleContent.set('');
        return;
      }

      this.isJsonContent.set(false);
      this.jsonData.set(null);

      // Use non-blocking markdown rendering for immediate content display
      // Preview content (truncated)
      if (event.content.length > this.MAX_LENGTH) {
        const truncatedContent = `${event.content.substring(0, this.MAX_LENGTH)}…`;
        const initialPreview = this.formatService.markdownToHtmlNonBlocking(
          truncatedContent,
          (updatedHtml) => {
            this.previewContent.set(updatedHtml);
          }
        );
        this.previewContent.set(initialPreview);
      }

      // Full article content - render immediately with placeholders, update as previews load
      const initialContent = this.formatService.markdownToHtmlNonBlocking(
        event.content,
        (updatedHtml) => {
          this.articleContent.set(updatedHtml);
        }
      );
      this.articleContent.set(initialContent);
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

  // Article image
  image = computed(() => {
    const event = this.event();
    if (!event) return null;

    const imageTag = event.tags.find(tag => tag[0] === 'image');
    return imageTag?.[1] || null;
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

  /**
   * Try to parse content as JSON
   */
  private tryParseJson(content: string): { isJson: boolean; data: Record<string, unknown> | unknown[] | null } {
    try {
      const trimmed = content.trim();
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return { isJson: false, data: null };
      }

      const parsed = JSON.parse(trimmed);
      // Only consider objects and arrays as JSON content
      if (typeof parsed === 'object' && parsed !== null) {
        return { isJson: true, data: parsed };
      }
      return { isJson: false, data: null };
    } catch {
      return { isJson: false, data: null };
    }
  }

  /**
   * Get keys from an object for template iteration
   */
  getObjectKeys(obj: unknown): string[] {
    if (!obj || typeof obj !== 'object') return [];
    return Object.keys(obj);
  }

  /**
   * Get value from object by key
   */
  getObjectValue(obj: unknown, key: string): unknown {
    if (!obj || typeof obj !== 'object') return null;
    return (obj as Record<string, unknown>)[key];
  }

  /**
   * Format JSON value for display
   */
  formatJsonValue(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return `Array(${value.length})`;
    if (typeof value === 'object') return 'Object';
    return String(value);
  }

  /**
   * Check if value is a primitive (string, number, boolean, null)
   */
  isPrimitive(value: unknown): boolean {
    return value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean';
  }

  /**
   * Stringify complex values (objects/arrays) for display
   */
  stringifyValue(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  /**
   * Format the published date based on selected calendar type
   */
  formatPublishedDate(): string {
    const date = this.publishedAt();
    if (!date) return '';

    if (this.localSettings.calendarType() === 'chronia') {
      const chroniaDate = this.chroniaCalendar.fromDate(date);
      return this.chroniaCalendar.format(chroniaDate, 'mediumDate');
    }

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
}
