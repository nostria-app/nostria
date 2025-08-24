import {
  Component,
  Input,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SocialPreviewComponent } from '../social-preview/social-preview.component';
import { SettingsService } from '../../services/settings.service';
import { UtilitiesService } from '../../services/utilities.service';
import { Router } from '@angular/router';
import { ContentToken, ParsingService } from '../../services/parsing.service';
import { NoteContentComponent } from './note-content/note-content.component';
import { DataService } from '../../services/data.service';
import { NostrRecord } from '../../interfaces';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { AgoPipe } from '../../pipes/ago.pipe';
import { DatePipe } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LayoutService } from '../../services/layout.service';

interface SocialPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  loading: boolean;
  error: boolean;
}

@Component({
  selector: 'app-content',
  standalone: true,
  imports: [
    NoteContentComponent,
    MatCardModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    SocialPreviewComponent,
    AgoPipe,
    DatePipe,
    UserProfileComponent,
  ],
  templateUrl: './content.component.html',
  styleUrl: './content.component.scss',
})
export class ContentComponent implements AfterViewInit, OnDestroy {
  settings = inject(SettingsService);
  private utilities = inject(UtilitiesService);
  private router = inject(Router);
  private parsing = inject(ParsingService);
  layoutService = inject(LayoutService);
  data = inject(DataService);

  @ViewChild('contentContainer') contentContainer!: ElementRef;
  // Input for raw content
  private _content = signal<string>('');

  // Track visibility of the component
  private _isVisible = signal<boolean>(false);
  private _hasBeenVisible = signal<boolean>(false);
  isVisible = computed(() => this._isVisible());

  // Observer for intersection
  private intersectionObserver: IntersectionObserver | null = null;

  // Cached parsed tokens - managed outside of computed
  private _cachedTokens = signal<ContentToken[]>([]);
  private _lastParsedContent = '';

  // Debouncing for content parsing
  private parseDebounceTimer?: number;
  private readonly PARSE_DEBOUNCE_TIME = 100; // milliseconds

  // Track if parsing is in progress to prevent overlapping operations
  private _isParsing = signal<boolean>(false);

  // Processed content tokens - returns cached or empty based on visibility
  contentTokens = computed<ContentToken[]>(() => {
    const shouldRender = this._isVisible() || this._hasBeenVisible();

    if (!shouldRender) {
      return [];
    }

    // Return the cached tokens
    return this._cachedTokens();
  });

  // Social previews for URLs
  socialPreviews = signal<SocialPreview[]>([]);

  eventMentions = signal<{ event: NostrRecord; contentTokens: ContentToken[] }[]>([]);

  @Input() set content(value: string) {
    const newContent = value || '';
    const currentContent = this._content();

    // Only update if content actually changed
    if (newContent !== currentContent) {
      this._content.set(newContent);
    }
  }

  get content(): string {
    return this._content();
  }

  constructor() {
    // Effect to parse content when it changes and component is visible
    effect(() => {
      const shouldRender = this._isVisible() || this._hasBeenVisible();
      const currentContent = this._content() as string;

      if (!shouldRender || this._isParsing()) {
        return;
      }

      // Only reparse if content has actually changed
      if (currentContent !== this._lastParsedContent) {
        this.debouncedParseContent(currentContent);
      }
    });

    // Use effect to load social previews when content changes AND component is visible
    effect(() => {
      if (!this._isVisible() && !this._hasBeenVisible()) return;

      const tokens = this.contentTokens();
      const urlTokens = tokens.filter((token) => token.type === 'url');

      if (urlTokens.length) {
        this.loadSocialPreviews(urlTokens.map((token) => token.content));
      } else {
        this.socialPreviews.set([]);
      }
    });
  }

  ngAfterViewInit() {
    this.setupIntersectionObserver();
  }
  ngOnDestroy() {
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }

    // Clear debounce timer
    if (this.parseDebounceTimer) {
      window.clearTimeout(this.parseDebounceTimer);
    }

    // Clean up cached state
    this._cachedTokens.set([]);
    this._lastParsedContent = '';

    // Clear parsing service cache for this content
    this.parsing.clearNostrUriCache();
  }

  /**
   * Debounced content parsing to prevent rapid re-parsing
   */
  private debouncedParseContent(content: string): void {
    // Clear any existing timer
    if (this.parseDebounceTimer) {
      window.clearTimeout(this.parseDebounceTimer);
    }

    // Set a new timer
    this.parseDebounceTimer = window.setTimeout(async () => {
      try {
        this._isParsing.set(true);
        const newTokens = await this.parsing.parseContent(content);

        const eventMentions = await Promise.all(
          newTokens
            .filter((t) => t.type === 'nostr-mention' && t.nostrData?.type === 'nevent')
            .map(async (mention) => {
              const eventData = await this.data.getEventById(mention.nostrData?.data.id);
              if (!eventData) return null;
              const contentTokens = await this.parsing.parseContent(eventData?.data);
              return {
                event: eventData,
                contentTokens,
              };
            }),
        );

        // Use untracked to prevent triggering effects during token update
        untracked(() => {
          this._cachedTokens.set(newTokens);
          this.eventMentions.set(eventMentions.filter((m) => !!m));
          this._lastParsedContent = content;
        });
      } catch (error) {
        console.error('Error parsing content:', error);
      } finally {
        this._isParsing.set(false);
      }
    }, this.PARSE_DEBOUNCE_TIME);
  }

  private setupIntersectionObserver() {
    // Ensure the element reference exists before proceeding
    if (!this.contentContainer?.nativeElement) {
      // If element isn't available yet, set a default visible state to true
      // and try again later with a slight delay
      this._isVisible.set(true); // Make content visible by default

      setTimeout(() => {
        if (this.contentContainer?.nativeElement) {
          this.setupIntersectionObserver();
        }
      }, 100);

      return;
    }

    // Options for the observer (which part of item visible, etc)
    const options = {
      root: null, // Use viewport as root
      rootMargin: '0px',
      threshold: 0.1, // 10% of the item visible
    };
    this.intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const isIntersecting = entry.isIntersecting;
        this._isVisible.set(isIntersecting);

        // Once visible, mark as having been visible (to keep content loaded)
        if (isIntersecting) {
          this._hasBeenVisible.set(true);
        }
      });
    }, options);

    // Start observing the element
    this.intersectionObserver.observe(this.contentContainer.nativeElement);
  }

  private async loadSocialPreviews(urls: string[]): Promise<void> {
    // Initialize previews with loading state
    const initialPreviews = urls.map((url) => ({
      url,
      loading: true,
      error: false,
    }));

    this.socialPreviews.set(initialPreviews);

    // Load previews for each URL
    const previewPromises = urls.map(async (url) => {
      try {
        // In a real implementation, you would call an API to fetch the metadata
        // For example, using a service like Open Graph or your own backend API
        await fetch(`https://metadata.nostria.app/og?url=${encodeURIComponent(url)}`);

        // This is a mock response - replace with actual API call
        // const preview = await response.json();

        // Mock preview data
        const preview = await this.mockFetchPreview(url);

        return {
          ...preview,
          url,
          loading: false,
          error: false,
        };
      } catch (error) {
        console.error(`Failed to load preview for ${url}:`, error);
        return {
          url,
          loading: false,
          error: true,
        };
      }
    });

    // Update previews as they complete
    const previews = await Promise.all(previewPromises);
    this.socialPreviews.set(previews);
  }

  // Mock function for demonstration purposes
  private async mockFetchPreview(url: string): Promise<Partial<SocialPreview>> {
    // In a real application, replace this with an actual API call
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate network delay

    // Return mock data based on URL type
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      return {
        title: 'YouTube Video Title',
        description: 'This is a YouTube video description',
        image: 'https://i.ytimg.com/vi/SAMPLE_ID/hqdefault.jpg',
      };
    } else if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
      return {
        title: 'Image',
        description: 'Image from the web',
        image: url,
      };
    } else {
      return {
        title: `Website Title for ${new URL(url).hostname}`,
        description: 'Website description would appear here',
        image: 'https://via.placeholder.com/300x200?text=Website+Preview',
      };
    }
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
      case 'nevent': {
        // Navigate to event page
        const record = data as Record<string, unknown>;
        const eventId = type === 'note' ? String(data) : String(record['id'] || '');
        this.router.navigate(['/e', eventId]);
        break;
      }
      case 'naddr': {
        // Navigate to address-based event
        const encoded = this.parsing.extractNostrUriIdentifier(token.content);
        this.router.navigate(['/a', encoded]);
        break;
      }
      default:
        console.warn('Unsupported nostr URI type:', type);
    }
  }

  // Control when content should be shown - once visible, always show
  shouldShowContent = computed(() => {
    return this._isVisible() || this._hasBeenVisible();
  });
}
