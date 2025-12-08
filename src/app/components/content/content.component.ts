import { Component, Input, ViewChild, ElementRef, AfterViewInit, OnDestroy, computed, effect, inject, signal, untracked, input } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
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
import { TaggedReferencesComponent } from './tagged-references/tagged-references.component';
import { Event as NostrEvent } from 'nostr-tools';
import { BadgeComponent } from '../../pages/badges/badge/badge.component';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { ArticleComponent } from '../article/article.component';

interface ArticleMention {
  pubkey: string;
  identifier: string;
  kind: number;
  relayHints?: string[];
}

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
    MatIconModule,
    MatTooltipModule,
    SocialPreviewComponent,
    AgoPipe,
    DatePipe,
    UserProfileComponent,
    TaggedReferencesComponent,
    BadgeComponent,
    ArticleComponent,
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
  private relayPool = inject(RelayPoolService);

  @ViewChild('contentContainer') contentContainer!: ElementRef;
  // Input for raw content
  private _content = signal<string>('');

  // Input for the event (to access tags for mentions/articles)
  event = input<NostrEvent | null>(null);

  // Input to hide tagged references (useful for comments/replies where the parent is already visible)
  hideTaggedReferences = input<boolean>(false);

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

    // Return the cached tokens, but filter out nevent, note, and naddr mentions
    // since they're rendered separately in eventMentions() and articleMentions()
    return this._cachedTokens().filter(
      token => !(token.type === 'nostr-mention' &&
        (token.nostrData?.type === 'nevent' || token.nostrData?.type === 'note' || token.nostrData?.type === 'naddr'))
    );
  });

  // Social previews for URLs
  socialPreviews = signal<SocialPreview[]>([]);

  // Event mentions with loading state
  eventMentions = signal<{ event: NostrRecord | null; contentTokens: ContentToken[]; loading: boolean; eventId: string }[]>([]);

  // Article mentions (naddr) - these use the ArticleComponent which handles its own loading
  articleMentions = signal<ArticleMention[]>([]);

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

      if (urlTokens.length) {
        this.loadSocialPreviews(urlTokens.map(token => token.content));
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
        const newTokens = await this.parsing.parseContent(content, this.event()?.tags);

        // Extract event mention tokens and create initial loading placeholders
        const mentionTokens = newTokens.filter(
          t => t.type === 'nostr-mention' && (t.nostrData?.type === 'nevent' || t.nostrData?.type === 'note')
        );

        // Extract article mention tokens (naddr)
        const articleTokens = newTokens.filter(
          t => t.type === 'nostr-mention' && t.nostrData?.type === 'naddr'
        );

        // Create article mentions from naddr tokens
        const articles: ArticleMention[] = articleTokens.map(token => {
          const data = token.nostrData?.data as { pubkey: string; identifier: string; kind: number; relays?: string[] };
          return {
            pubkey: data.pubkey,
            identifier: data.identifier,
            kind: data.kind,
            relayHints: data.relays,
          };
        });

        // Create initial placeholders with loading state
        const initialMentions = mentionTokens.map(mention => {
          const eventId = mention.nostrData?.type === 'nevent'
            ? mention.nostrData.data.id
            : mention.nostrData?.data;
          return {
            event: null,
            contentTokens: [],
            loading: true,
            eventId: eventId as string,
          };
        });

        // Immediately update tokens and show loading placeholders
        untracked(() => {
          this._cachedTokens.set(newTokens);
          this.eventMentions.set(initialMentions);
          this.articleMentions.set(articles);
          this._lastParsedContent = content;
        });

        // Now fetch each event mention individually and update as they load
        for (let i = 0; i < mentionTokens.length; i++) {
          const mention = mentionTokens[i];
          const eventId = mention.nostrData?.type === 'nevent'
            ? mention.nostrData.data.id
            : mention.nostrData?.data;

          // Get relay hints from nevent if available
          const relayHints = mention.nostrData?.type === 'nevent'
            ? mention.nostrData.data.relays as string[] | undefined
            : undefined;

          try {
            let eventData: NostrRecord | null = null;

            // If we have relay hints, try those first (10 second timeout)
            if (relayHints && relayHints.length > 0) {
              try {
                const relayEvent = await this.relayPool.getEventById(relayHints, eventId, 10000);
                if (relayEvent) {
                  eventData = this.data.toRecord(relayEvent);
                }
              } catch {
                // Relay hints failed, will try regular fetch
                console.debug(`Relay hints fetch failed for ${eventId}, trying regular fetch`);
              }
            }

            // If relay hints didn't work, fall back to regular fetch (no artificial timeout - let it complete)
            if (!eventData) {
              eventData = await this.data.getEventById(eventId);
            }

            if (eventData) {
              const contentTokens = await this.parsing.parseContent(eventData?.data, eventData?.event.tags);

              // Update this specific mention
              this.eventMentions.update(mentions => {
                const updated = [...mentions];
                updated[i] = {
                  event: eventData,
                  contentTokens,
                  loading: false,
                  eventId: eventId as string,
                };
                return updated;
              });
            } else {
              // Event not found - mark as not loading but with null event
              this.eventMentions.update(mentions => {
                const updated = [...mentions];
                updated[i] = {
                  event: null,
                  contentTokens: [],
                  loading: false,
                  eventId: eventId as string,
                };
                return updated;
              });
            }
          } catch (error) {
            console.error(`Error loading event ${eventId}:`, error);
            // Mark this mention as failed to load
            this.eventMentions.update(mentions => {
              const updated = [...mentions];
              updated[i] = {
                event: null,
                contentTokens: [],
                loading: false,
                eventId: eventId as string,
              };
              return updated;
            });
          }
        }
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
          this.eventMentions.set([]);
          this.articleMentions.set([]);
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

    // Options for the observer (which part of item visible, etc)
    // Using rootMargin to trigger slightly before element enters viewport for seamless UX
    const options = {
      root: null, // Use viewport as root
      rootMargin: '200px', // Start loading 200px before entering viewport
      threshold: 0.01, // 1% of the item visible
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
    this.intersectionObserver.observe(this.contentContainer.nativeElement);
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

  onEventMentionClick(event: Event, nostrEvent: NostrEvent) {
    // Prevent default link behavior and stop propagation
    event.preventDefault();
    event.stopPropagation();

    // Use the layout service to navigate, which properly uses Angular router
    this.layoutService.openEvent(nostrEvent.id, nostrEvent);
  }

  // Control when content should be shown - once visible, always show
  shouldShowContent = computed(() => {
    return this._isVisible() || this._hasBeenVisible();
  });

  // Helper methods for inline photo event rendering (to avoid circular dependency with PhotoEventComponent)

  /**
   * Parse an imeta tag into a key-value object
   */
  private parseImetaTag(tag: string[]): Record<string, string> {
    const parsed: Record<string, string> = {};
    // Skip the first element which is 'imeta'
    for (let i = 1; i < tag.length; i++) {
      const part = tag[i];
      const spaceIndex = part.indexOf(' ');
      if (spaceIndex > 0) {
        const key = part.substring(0, spaceIndex);
        const value = part.substring(spaceIndex + 1);
        parsed[key] = value;
      }
    }
    return parsed;
  }

  /**
   * Get photo URLs from a kind 20 event
   */
  getPhotoUrls(event: NostrEvent): string[] {
    const imageUrls: string[] = [];

    if (event.kind === 20) {
      // NIP-68: Get URLs from 'imeta' tags
      const imetaTags = event.tags.filter(tag => tag[0] === 'imeta');
      for (const imetaTag of imetaTags) {
        const parsed = this.parseImetaTag(imetaTag);
        if (parsed['url']) {
          imageUrls.push(parsed['url']);
        }
      }
    }

    // Fallback: Get URLs from 'url' or 'image' tags
    if (imageUrls.length === 0) {
      const urlTags = event.tags.filter(tag => tag[0] === 'url');
      imageUrls.push(...urlTags.map(tag => tag[1]));

      const imageTags = event.tags.filter(tag => tag[0] === 'image');
      imageUrls.push(...imageTags.map(tag => tag[1]));
    }

    return [...new Set(imageUrls)];
  }

  /**
   * Get alt text for a photo at a specific index
   */
  getPhotoAlt(event: NostrEvent, imageIndex = 0): string {
    if (event.kind === 20) {
      const imetaTags = event.tags.filter(tag => tag[0] === 'imeta');
      const targetImeta = imetaTags[imageIndex];
      if (targetImeta) {
        const parsed = this.parseImetaTag(targetImeta);
        if (parsed['alt']) {
          return parsed['alt'];
        }
      }
    }

    // Fallback to regular alt tag or title
    const altTag = event.tags.find(tag => tag[0] === 'alt');
    const titleTag = event.tags.find(tag => tag[0] === 'title');
    return altTag?.[1] || titleTag?.[1] || 'Photo';
  }

  /**
   * Get video thumbnail from a video event (kind 21/22/34235/34236)
   */
  getVideoThumbnail(event: NostrEvent): string | null {
    // Try imeta tags first
    const imetaTags = event.tags.filter(tag => tag[0] === 'imeta');
    for (const imetaTag of imetaTags) {
      const parsed = this.parseImetaTag(imetaTag);
      if (parsed['image']) {
        return parsed['image'];
      }
    }

    // Try thumb or image tag
    const thumbTag = event.tags.find(tag => tag[0] === 'thumb');
    if (thumbTag?.[1]) return thumbTag[1];

    const imageTag = event.tags.find(tag => tag[0] === 'image');
    if (imageTag?.[1]) return imageTag[1];

    return null;
  }

  /**
   * Get video title from a video event
   */
  getVideoTitle(event: NostrEvent): string | null {
    const titleTag = event.tags.find(tag => tag[0] === 'title');
    return titleTag?.[1] || null;
  }
}
