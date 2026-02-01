import { Component, Input, ViewChild, ElementRef, AfterViewInit, OnDestroy, computed, effect, inject, signal, untracked, input } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { SocialPreviewComponent } from '../social-preview/social-preview.component';
import { SettingsService } from '../../services/settings.service';
import { ContentToken, ParsingService } from '../../services/parsing.service';
import { NoteContentComponent } from './note-content/note-content.component';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LayoutService } from '../../services/layout.service';
import { TaggedReferencesComponent } from './tagged-references/tagged-references.component';
import { Event as NostrEvent } from 'nostr-tools';

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
    MatIconModule,
    MatTooltipModule,
    SocialPreviewComponent,
    TaggedReferencesComponent,
  ],
  templateUrl: './content.component.html',
  styleUrl: './content.component.scss',
})
export class ContentComponent implements AfterViewInit, OnDestroy {
  settings = inject(SettingsService);
  private parsing = inject(ParsingService);
  layoutService = inject(LayoutService);

  @ViewChild('contentContainer') contentContainer!: ElementRef;
  // Input for raw content
  private _content = signal<string>('');

  // Input for the event (to access tags for mentions/articles)
  event = input<NostrEvent | null>(null);

  // Input for preloaded events (to render previews of events not yet published)
  preloadedEvents = input<Map<string, NostrEvent>>(new Map());

  // Input to hide tagged references (useful for comments/replies where the parent is already visible)
  hideTaggedReferences = input<boolean>(false);

  // Pubkey of someone who shared/reposted this content - if trusted, media should be revealed
  trustedByPubkey = input<string | undefined>(undefined);

  // Disable content expansion (for dialogs and direct event views)
  disableExpansion = input<boolean>(false);

  // Whether this content is rendered inside the Feeds panel (for video auto-play control)
  inFeedsPanel = input<boolean>(false);

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

    // Return all cached tokens - nevent, note, and naddr are now rendered inline
    return this._cachedTokens();
  });

  // Social previews for URLs
  socialPreviews = signal<SocialPreview[]>([]);

  // Proxy web URL from bridged content (e.g., ActivityPub/Mastodon via momostr)
  proxyWebUrl = computed<string | null>(() => {
    const currentEvent = this.event();
    if (!currentEvent?.tags) return null;
    const proxyTag = currentEvent.tags.find(tag => tag[0] === 'proxy' && tag[1] && tag[2] === 'web');
    return proxyTag ? proxyTag[1] : null;
  });

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

      if (!shouldRender) {
        return;
      }

      // Read isParsing without creating a dependency to avoid re-triggering
      const isParsing = untracked(() => this._isParsing());
      if (isParsing) {
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
      const urlTokens = tokens.filter(token => token.type === 'url');

      // Collect URLs from content tokens, excluding proxy web URL (shown as globe icon instead)
      const urlSet = new Set<string>(urlTokens.map(token => token.content));
      const proxyUrl = this.proxyWebUrl();
      if (proxyUrl) {
        urlSet.delete(proxyUrl);
      }

      const uniqueUrls = [...urlSet];

      if (uniqueUrls.length) {
        this.loadSocialPreviews(uniqueUrls);
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
        const currentEvent = this.event();
        const authorPubkey = currentEvent?.pubkey;
        const newTokens = await this.parsing.parseContent(content, currentEvent?.tags, authorPubkey);

        // Update cached tokens - inline rendering of event/article mentions is now handled by note-content.component
        untracked(() => {
          this._cachedTokens.set(newTokens);
          this._lastParsedContent = content;
        });
      } catch (error) {
        console.error('Error parsing content:', error);

        // Fallback: If parsing fails completely, create a simple text token
        // so the raw content is still displayed to the user
        untracked(() => {
          const fallbackTokens: ContentToken[] = [{
            id: 0,
            type: 'text',
            content: content
          }];
          this._cachedTokens.set(fallbackTokens);
          this._lastParsedContent = content;
        });
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

    const element = this.contentContainer.nativeElement;

    // Options for the observer (which part of item visible, etc)
    // Using rootMargin to trigger slightly before element enters viewport for seamless UX
    const options = {
      root: null, // Use viewport as root
      rootMargin: '200px', // Start loading 200px before entering viewport
      threshold: 0, // Trigger as soon as any part is visible
    };

    this.intersectionObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const isIntersecting = entry.isIntersecting;
        this._isVisible.set(isIntersecting);

        // Once visible, mark as having been visible (to keep content loaded)
        if (isIntersecting) {
          this._hasBeenVisible.set(true);
        }
      });
    }, options);

    // Start observing the element
    this.intersectionObserver.observe(element);

    // Check if element is already visible in viewport immediately
    // This handles the case where content is already on screen when observer attaches
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const margin = 200; // Match rootMargin

    // Element is considered visible if it's within viewport + margin
    const isAlreadyVisible = rect.top < viewportHeight + margin && rect.bottom > -margin;

    if (isAlreadyVisible) {
      this._isVisible.set(true);
      this._hasBeenVisible.set(true);
    }
  }

  private async loadSocialPreviews(urls: string[]): Promise<void> {
    // Initialize previews with loading state
    const initialPreviews = urls.map(url => ({
      url,
      loading: true,
      error: false,
    }));

    this.socialPreviews.set(initialPreviews);

    // Load previews for each URL
    const previewPromises = urls.map(async url => {
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
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate network delay

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
        // Open profile in right panel
        const record = data as Record<string, unknown>;
        const pubkey = type === 'npub' ? String(data) : String(record['pubkey'] || '');
        this.layoutService.openProfile(pubkey);
        break;
      }
      case 'note':
      case 'nevent': {
        // Open event in right panel using nevent format
        const record = data as Record<string, unknown>;
        const eventId = type === 'note' ? String(data) : String(record['id'] || '');
        this.layoutService.openGenericEvent(eventId);
        break;
      }
      case 'naddr': {
        // Open address-based event (article) in right panel
        const encoded = this.parsing.extractNostrUriIdentifier(token.content);
        this.layoutService.openArticle(encoded);
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
