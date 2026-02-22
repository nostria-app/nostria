import { ChangeDetectionStrategy, Component, computed, input, signal, inject, effect } from '@angular/core';
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
import { EthiopianCalendarService } from '../../services/ethiopian-calendar.service';
import { MatDialog } from '@angular/material/dialog';
import { MediaPreviewDialogComponent } from '../media-preview-dialog/media-preview.component';

@Component({
  selector: 'app-article-event',
  imports: [CommonModule, MatButtonModule, MatIconModule, MentionHoverDirective],
  templateUrl: './article-event.component.html',
  styleUrl: './article-event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleEventComponent {
  private layout = inject(LayoutService);
  private dialog = inject(MatDialog);
  private formatService = inject(FormatService);
  private localSettings = inject(LocalSettingsService);
  private chroniaCalendar = inject(ChroniaCalendarService);
  private ethiopianCalendar = inject(EthiopianCalendarService);
  private readonly MAX_LENGTH = 300;
  private readonly MAX_SUMMARY_LENGTH = 200;
  private readonly MIN_SUMMARY_PARAGRAPH_LENGTH = 20;
  // Compile regex patterns once to avoid repeated compilation in computed properties
  private readonly MARKDOWN_IMAGE_REGEX = /!\[.*?\]\((https?:\/\/[^\s)]+\.(jpg|jpeg|png|gif|webp)(\?[^\s)]*)?)\)/i;
  private readonly STANDALONE_IMAGE_REGEX = /https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)(\?[^\s]*)?/i;

  event = input.required<Event>();
  showAuthor = input<boolean>(true);

  // Article title
  title = computed(() => {
    const event = this.event();
    if (!event) return null;

    const tagTitle = this.getEventTitle(event);
    if (tagTitle) return tagTitle;

    // Fallback: Extract title from first heading in markdown content
    if (event.content) {
      const firstHeadingMatch = event.content.match(/^#\s+(.+?)\s*$/m);
      if (firstHeadingMatch) {
        return firstHeadingMatch[1].trim();
      }
    }

    return null;
  });

  // Article summary/description
  summary = computed(() => {
    const event = this.event();
    if (!event) return null;

    const summaryTag = event.tags.find(tag => tag[0] === 'summary');
    if (summaryTag?.[1]) return summaryTag[1];

    // Fallback: Extract first paragraph from content (after title if present)
    if (event.content) {
      let content = event.content;

      // Remove title if it exists (first # heading)
      content = content.replace(/^#\s+.+$/m, '').trim();

      // Get first substantial paragraph (at least MIN_SUMMARY_PARAGRAPH_LENGTH chars)
      const paragraphs = content.split(/\n\n+/);
      for (const para of paragraphs) {
        const cleaned = para.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim(); // Remove images
        if (cleaned.length >= this.MIN_SUMMARY_PARAGRAPH_LENGTH) {
          return cleaned;
        }
      }
    }

    return null;
  });

  // Truncated summary for display in listings
  truncatedSummary = computed(() => {
    const fullSummary = this.summary();
    if (!fullSummary) return null;

    if (fullSummary.length <= this.MAX_SUMMARY_LENGTH) {
      return fullSummary;
    }

    return fullSummary.substring(0, this.MAX_SUMMARY_LENGTH).trimEnd() + '…';
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
    if (imageTag?.[1]) return imageTag[1];

    // Fallback: Extract first image from markdown content
    if (event.content) {
      // Try markdown image syntax: ![alt](url)
      const markdownImageMatch = event.content.match(this.MARKDOWN_IMAGE_REGEX);
      if (markdownImageMatch) {
        return markdownImageMatch[1];
      }

      // Try standalone image URLs
      const standaloneImageMatch = event.content.match(this.STANDALONE_IMAGE_REGEX);
      if (standaloneImageMatch) {
        return standaloneImageMatch[0];
      }
    }

    return null;
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

    const tags = event.tags
      .filter(tag => tag[0] === 't')
      .map(tag => tag[1])
      .filter(Boolean);
    return [...new Set(tags)];
  });

  // Truncated content for preview (always show preview in feeds)
  contentToShow = computed<SafeHtml>(() => {
    const previewContent = this.previewContent();
    const content = this.articleContent();
    // In feeds, show truncated preview if available, otherwise full content
    return previewContent || content || '';
  });

  openFullArticle(interactionEvent?: MouseEvent | KeyboardEvent): void {
    if (interactionEvent instanceof MouseEvent) {
      const target = interactionEvent.target as HTMLElement;
      const imageElement = target.closest('img');
      const imageSource = imageElement?.getAttribute('src');

      if (imageSource) {
        this.openImagePreview(imageSource, interactionEvent);
        return;
      }
    }

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

  openImagePreview(imageUrl: string, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();

    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaUrl: imageUrl,
        mediaType: 'image',
        mediaTitle: this.title() || 'Article image',
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      panelClass: 'image-dialog-panel',
    });
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

    const calendarType = this.localSettings.calendarType();

    if (calendarType === 'chronia') {
      const chroniaDate = this.chroniaCalendar.fromDate(date);
      return this.chroniaCalendar.format(chroniaDate, 'mediumDate');
    }

    if (calendarType === 'ethiopian') {
      const ethiopianDate = this.ethiopianCalendar.fromDate(date);
      return this.ethiopianCalendar.format(ethiopianDate, 'mediumDate');
    }

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
}
