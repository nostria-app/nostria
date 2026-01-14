import { Component, Input, ViewChild, ElementRef, AfterViewInit, OnDestroy, computed, effect, inject, signal, untracked, input } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
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
import { TimestampPipe } from '../../pipes/timestamp.pipe';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LayoutService } from '../../services/layout.service';
import { TaggedReferencesComponent } from './tagged-references/tagged-references.component';
import { Event as NostrEvent } from 'nostr-tools';
import { BadgeComponent } from '../../pages/badges/badge/badge.component';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { UserRelayService } from '../../services/relays/user-relay';
import { ArticleComponent } from '../article/article.component';
import { PhotoEventComponent } from '../event-types/photo-event.component';
import { EventHeaderComponent } from '../event/header/header.component';
import { MusicEmbedComponent } from '../music-embed/music-embed.component';
import { EmojiSetMentionComponent } from '../emoji-set-mention/emoji-set-mention.component';

// Music event kinds
const MUSIC_TRACK_KIND = 36787;
const MUSIC_PLAYLIST_KIND = 34139;

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
    MatButtonModule,
    SocialPreviewComponent,
    AgoPipe,
    TimestampPipe,
    UserProfileComponent,
    TaggedReferencesComponent,
    BadgeComponent,
    ArticleComponent,
    PhotoEventComponent,
    EventHeaderComponent,
    MusicEmbedComponent,
    EmojiSetMentionComponent,
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
  private userRelayService = inject(UserRelayService);

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

  // Content length threshold for showing "Show more" button (in characters)
  private readonly CONTENT_LENGTH_THRESHOLD = 500;

  // Event mentions with loading state and expansion state
  eventMentions = signal<{ event: NostrRecord | null; contentTokens: ContentToken[]; loading: boolean; eventId: string; currentImageIndex: number; expanded: boolean }[]>([]);

  // Article mentions (naddr) - these use the ArticleComponent which handles its own loading
  articleMentions = signal<ArticleMention[]>([]);

  // Music mentions (naddr with kind 36787 or 34139) - separate for specialized rendering
  musicMentions = signal<ArticleMention[]>([]);

  // Emoji set mentions (naddr with kind 30030) - separate for specialized rendering
  emojiSetMentions = signal<ArticleMention[]>([]);

  // Proxy URL from the event's proxy tag (e.g., ActivityPub bridged content)
  proxyUrl = computed<string | null>(() => {
    const currentEvent = this.event();
    if (!currentEvent?.tags) return null;

    // Find the proxy tag: ["proxy", "url", "protocol"]
    const proxyTag = currentEvent.tags.find(tag => tag[0] === 'proxy' && tag[1]);
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

      // Collect URLs from content tokens using a Set to ensure uniqueness
      const urlSet = new Set<string>(urlTokens.map(token => token.content));

      // Also include proxy URL from event tags (e.g., ActivityPub bridged content)
      const proxyUrlValue = this.proxyUrl();
      if (proxyUrlValue) {
        urlSet.add(proxyUrlValue);
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

        // Extract event mention tokens and create initial loading placeholders
        const mentionTokens = newTokens.filter(
          t => t.type === 'nostr-mention' && (t.nostrData?.type === 'nevent' || t.nostrData?.type === 'note')
        );

        // Extract article mention tokens (naddr)
        const articleTokens = newTokens.filter(
          t => t.type === 'nostr-mention' && t.nostrData?.type === 'naddr'
        );

        // Create article mentions from naddr tokens, separating music from other articles
        const allMentions: ArticleMention[] = articleTokens.map(token => {
          const data = token.nostrData?.data as { pubkey: string; identifier: string; kind: number; relays?: string[] };
          return {
            pubkey: data.pubkey,
            identifier: data.identifier,
            kind: data.kind,
            relayHints: data.relays,
          };
        });

        // Separate music mentions (tracks and playlists) and emoji sets from regular articles
        const musicMentions = allMentions.filter(m =>
          m.kind === MUSIC_TRACK_KIND || m.kind === MUSIC_PLAYLIST_KIND
        );
        const emojiSetMentions = allMentions.filter(m => m.kind === 30030);
        const articles = allMentions.filter(m =>
          m.kind !== MUSIC_TRACK_KIND && m.kind !== MUSIC_PLAYLIST_KIND && m.kind !== 30030
        );

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
            currentImageIndex: 0,
            expanded: false,
          };
        });

        // Immediately update tokens and show loading placeholders
        untracked(() => {
          this._cachedTokens.set(newTokens);
          this.eventMentions.set(initialMentions);
          this.articleMentions.set(articles);
          this.musicMentions.set(musicMentions);
          this.emojiSetMentions.set(emojiSetMentions);
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

            // Check preloaded events first
            const preloadedMap = this.preloadedEvents();
            if (preloadedMap.has(eventId)) {
              const preloadedEvent = preloadedMap.get(eventId)!;
              // Wrap in NostrRecord structure
              eventData = {
                event: preloadedEvent,
                data: preloadedEvent.content,
                // Add other required fields with defaults
                id: preloadedEvent.id,
                pubkey: preloadedEvent.pubkey,
                created_at: preloadedEvent.created_at,
                kind: preloadedEvent.kind,
                tags: preloadedEvent.tags,
                sig: preloadedEvent.sig,
                relays: []
              } as unknown as NostrRecord; // Cast to avoid strict type issues with missing fields if any
            }

            // If not preloaded, try relay hints
            if (!eventData && relayHints && relayHints.length > 0) {
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

            // If relay hints didn't work, fall back to regular fetch (check database first, then relays)
            if (!eventData) {
              eventData = await this.data.getEventById(eventId, { save: true });
            }

            // If still not found, and we have an author hint, try fetching from author's relays
            if (!eventData) {
              const author = mention.nostrData?.type === 'nevent'
                ? mention.nostrData.data.author
                : undefined;

              if (author) {
                try {
                  const authorEvent = await this.userRelayService.getEventById(author, eventId);
                  if (authorEvent) {
                    eventData = this.data.toRecord(authorEvent);
                  }
                } catch (err) {
                  console.warn(`Failed to fetch event ${eventId} from author ${author} relays`, err);
                }
              }
            }

            if (eventData) {
              const contentTokens = await this.parsing.parseContent(eventData?.data, eventData?.event.tags, eventData?.event.pubkey);

              // Update this specific mention
              this.eventMentions.update(mentions => {
                const updated = [...mentions];
                updated[i] = {
                  event: eventData,
                  contentTokens,
                  loading: false,
                  eventId: eventId as string,
                  currentImageIndex: 0,
                  expanded: mentions[i]?.expanded ?? false,
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
                  currentImageIndex: 0,
                  expanded: false,
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
                currentImageIndex: 0,
                expanded: false,
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
          this.musicMentions.set([]);
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

    // Safety timeout: if intersection observer doesn't trigger within 2 seconds,
    // force content to be visible to prevent blank screens
    const safetyTimeout = setTimeout(() => {
      if (!this._isVisible() && !this._hasBeenVisible()) {
        console.warn('[ContentComponent] Forcing content visible after timeout');
        this._isVisible.set(true);
        this._hasBeenVisible.set(true);
      }
    }, 2000);

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
          // Clear safety timeout since observer worked
          clearTimeout(safetyTimeout);
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

  onEventMentionClick(event: Event, nostrEvent: NostrEvent) {
    // Prevent default link behavior and stop propagation
    event.preventDefault();
    event.stopPropagation();

    // Use the layout service to navigate, which properly uses Angular router
    // Pass trustedByPubkey so the dialog knows to reveal media if the sharer is trusted
    this.layoutService.openEvent(nostrEvent.id, nostrEvent, this.trustedByPubkey());
  }

  nextImage(mentionIndex: number, event: MouseEvent) {
    event.stopPropagation();
    this.eventMentions.update(mentions => {
      const updated = [...mentions];
      const mention = updated[mentionIndex];
      if (mention && mention.event) {
        const totalImages = this.getPhotoUrls(mention.event.event).length;
        updated[mentionIndex] = {
          ...mention,
          currentImageIndex: (mention.currentImageIndex + 1) % totalImages
        };
      }
      return updated;
    });
  }

  prevImage(mentionIndex: number, event: MouseEvent) {
    event.stopPropagation();
    this.eventMentions.update(mentions => {
      const updated = [...mentions];
      const mention = updated[mentionIndex];
      if (mention && mention.event) {
        const totalImages = this.getPhotoUrls(mention.event.event).length;
        updated[mentionIndex] = {
          ...mention,
          currentImageIndex: (mention.currentImageIndex - 1 + totalImages) % totalImages
        };
      }
      return updated;
    });
  }

  setImage(mentionIndex: number, imageIndex: number, event: MouseEvent) {
    event.stopPropagation();
    this.eventMentions.update(mentions => {
      const updated = [...mentions];
      const mention = updated[mentionIndex];
      if (mention) {
        updated[mentionIndex] = {
          ...mention,
          currentImageIndex: imageIndex
        };
      }
      return updated;
    });
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

  /**
   * Check if an event mention has long content that should be collapsible
   */
  isMentionContentLong(mention: { event: NostrRecord | null }): boolean {
    // Don't show expander if expansion is disabled (dialogs, direct event views)
    if (this.disableExpansion()) return false;
    if (!mention.event) return false;
    // Only apply to text notes (kind 1)
    if (mention.event.event.kind !== 1) return false;
    const content = mention.event.event.content || '';
    return content.length > this.CONTENT_LENGTH_THRESHOLD;
  }

  /**
   * Toggle expansion state for an event mention
   */
  toggleMentionExpand(eventId: string, event: MouseEvent): void {
    event.stopPropagation(); // Prevent card click navigation
    this.eventMentions.update(mentions =>
      mentions.map(m =>
        m.eventId === eventId ? { ...m, expanded: !m.expanded } : m
      )
    );
  }
}
