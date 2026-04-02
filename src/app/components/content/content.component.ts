import { ChangeDetectionStrategy, Component, ViewChild, ElementRef, AfterViewInit, OnDestroy, computed, effect, inject, signal, untracked, input } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { SocialPreviewComponent } from '../social-preview/social-preview.component';
import { SettingsService } from '../../services/settings.service';
import { ContentToken, ParsingService, PendingMentionResolution } from '../../services/parsing.service';
import { NoteContentComponent } from './note-content/note-content.component';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LayoutService } from '../../services/layout.service';
import { TaggedReferencesComponent } from './tagged-references/tagged-references.component';
import { Event as NostrEvent, nip19 } from 'nostr-tools';
import { normalizePreviewUrl } from '../../utils/url-cleaner';
import { OpenGraphData, OpenGraphService } from '../../services/opengraph.service';
import { IntersectionObserverService } from '../../services/intersection-observer.service';

@Component({
  selector: 'app-content',
  imports: [
    NoteContentComponent,
    MatIconModule,
    MatTooltipModule,
    SocialPreviewComponent,
    TaggedReferencesComponent,
  ],
  templateUrl: './content.component.html',
  styleUrl: './content.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContentComponent implements AfterViewInit, OnDestroy {
  settings = inject(SettingsService);
  private parsing = inject(ParsingService);
  private openGraphService = inject(OpenGraphService);
  private intersectionObserverService = inject(IntersectionObserverService);
  layoutService = inject(LayoutService);
  private socialPreviewRequestId = 0;

  @ViewChild('contentContainer') contentContainer!: ElementRef;
  // Input for raw content
  content = input<unknown>('');

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

  // Hide social previews (when parent component is handling preview rendering)
  hideSocialPreviews = input<boolean>(false);

  // Hide inline media/link tokens (when parent component renders collapsed previews)
  hideInlineMediaAndLinks = input<boolean>(false);

  private readonly collapsedHiddenTokenTypes = new Set<ContentToken['type']>([
    'url',
    'image',
    'base64-image',
    'video',
    'base64-video',
    'youtube',
  ]);

  // Track visibility of the component
  private _isVisible = signal<boolean>(false);
  private _hasBeenVisible = signal<boolean>(false);
  isVisible = computed(() => this._isVisible());

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

  displayContentTokens = computed<ContentToken[]>(() => {
    let tokens = this.contentTokens();

    if (!this.hideSocialPreviews() && this.settings.settings().socialSharingPreview) {
      const previewsByUrl = new Map(
        this.socialPreviews().map(preview => [normalizePreviewUrl(preview.url), preview] as const)
      );

      tokens = this.decoratePreviewedUrlTokens(tokens, previewsByUrl);
      tokens = this.removeTrailingSinglePreviewUrlToken(tokens, previewsByUrl);
    }

    if (!this.hideInlineMediaAndLinks()) {
      return tokens;
    }

    return tokens.filter(token => !this.collapsedHiddenTokenTypes.has(token.type));
  });

  // Social previews for URLs
  socialPreviews = signal<OpenGraphData[]>([]);

  useProminentSocialPreviewImages = computed(() => {
    const previewCount = this.socialPreviews().length;
    return previewCount > 0 && previewCount <= 3;
  });

  useSingleSocialPreviewLayout = computed(() => this.socialPreviews().length === 1);

  // Proxy web URL from bridged content (e.g., ActivityPub/Mastodon via momostr)
  proxyWebUrl = computed<string | null>(() => {
    const currentEvent = this.event();
    if (!currentEvent?.tags) return null;
    const proxyTag = currentEvent.tags.find(tag => tag[0] === 'proxy' && tag[1] && tag[2] === 'web');
    return proxyTag ? proxyTag[1] : null;
  });

  constructor() {
    // Effect to parse content when it changes and component is visible
    effect(() => {
      const shouldRender = this._isVisible() || this._hasBeenVisible();
      const currentContent = this.normalizeContent(this.content());

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
      const proxyUrl = this.proxyWebUrl();
      const normalizedProxyUrl = proxyUrl ? normalizePreviewUrl(proxyUrl) : null;
      const urlSet = new Set<string>(
        urlTokens
          .map(token => normalizePreviewUrl(token.content))
          .filter(url => !!url && url !== normalizedProxyUrl)
      );

      if (proxyUrl) {
        urlSet.delete(proxyUrl);
      }

      if (normalizedProxyUrl) {
        urlSet.delete(normalizedProxyUrl);
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
    if (this.contentContainer?.nativeElement) {
      this.intersectionObserverService.unobserve(this.contentContainer.nativeElement);
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
        const result = await this.parsing.parseContent(content, currentEvent?.tags, authorPubkey);

        // Update cached tokens - inline rendering of event/article mentions is now handled by note-content.component
        untracked(() => {
          this._cachedTokens.set(result.tokens);
          this._lastParsedContent = content;
        });

        // Resolve any pending mention profiles in the background
        if (result.pendingMentions.length > 0) {
          this.resolvePendingMentions(result.pendingMentions);
        }
      } catch (error) {
        console.error('Error parsing content:', error);

        // Fallback: If parsing fails completely, create a simple text token
        // so the raw content is still displayed to the user
        untracked(() => {
          const fallbackTokens: ContentToken[] = [{
            id: 0,
            type: 'text',
            content: this.normalizeContent(content)
          }];
          this._cachedTokens.set(fallbackTokens);
          this._lastParsedContent = content;
        });
      } finally {
        this._isParsing.set(false);
      }
    }, this.PARSE_DEBOUNCE_TIME);
  }

  private normalizeContent(content: unknown): string {
    if (typeof content === 'string') {
      return content;
    }

    if (content == null) {
      return '';
    }

    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }

  private decoratePreviewedUrlTokens(tokens: ContentToken[], previewsByUrl: Map<string, OpenGraphData>): ContentToken[] {
    return tokens.map(token => {
      if (token.type !== 'url') {
        return token;
      }

      const preview = previewsByUrl.get(normalizePreviewUrl(token.content));
      if (!preview) {
        return token;
      }

      return {
        ...token,
        previewTitle: preview.title,
        previewSiteName: preview.siteName,
        previewLoading: preview.loading,
        previewError: preview.error,
      };
    });
  }

  private removeTrailingSinglePreviewUrlToken(tokens: ContentToken[], previewsByUrl: Map<string, OpenGraphData>): ContentToken[] {
    if (previewsByUrl.size !== 1) {
      return tokens;
    }

    const trailingUrlIndex = this.findTrailingPreviewUrlIndex(tokens, previewsByUrl);
    if (trailingUrlIndex === -1) {
      return tokens;
    }

    const trimmedTokens = [...tokens];
    trimmedTokens.splice(trailingUrlIndex, 1);

    while (trimmedTokens.length > 0) {
      const lastToken = trimmedTokens[trimmedTokens.length - 1];
      if (lastToken.type === 'linebreak') {
        trimmedTokens.pop();
        continue;
      }

      if (lastToken.type === 'text' && !lastToken.content.trim()) {
        trimmedTokens.pop();
        continue;
      }

      break;
    }

    return trimmedTokens;
  }

  private findTrailingPreviewUrlIndex(tokens: ContentToken[], previewsByUrl: Map<string, OpenGraphData>): number {
    for (let index = tokens.length - 1; index >= 0; index--) {
      const token = tokens[index];

      if (token.type === 'linebreak') {
        continue;
      }

      if (token.type === 'text' && !token.content.trim()) {
        continue;
      }

      if (token.type !== 'url') {
        return -1;
      }

      return previewsByUrl.has(normalizePreviewUrl(token.content)) ? index : -1;
    }

    return -1;
  }
  /**
   * Resolves pending mention profiles that timed out during initial parsing.
   * When a profile loads, updates the corresponding token in the cached tokens array.
   */
  private resolvePendingMentions(pendingMentions: PendingMentionResolution[]): void {
    for (const pending of pendingMentions) {
      pending.promise.then(nostrData => {
        if (!nostrData) return;

        // Update the token in the cached array
        const currentTokens = this._cachedTokens();
        const tokenIndex = currentTokens.findIndex(t => t.id === pending.tokenId);
        if (tokenIndex === -1) return;

        const token = currentTokens[tokenIndex];
        // Only update if the token still has no nostrData (hasn't been resolved by something else)
        if (token.nostrData) return;

        // Create a new array with the updated token to trigger signal change detection
        const updatedTokens = [...currentTokens];
        updatedTokens[tokenIndex] = {
          ...token,
          nostrData,
        };
        this._cachedTokens.set(updatedTokens);
      }).catch(error => {
        console.warn('Failed to resolve pending mention:', error);
      });
    }
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

    const observerRoot = this.resolveObserverRoot(element);
    const rootMargin = this.inFeedsPanel() ? '1400px 0px 2200px 0px' : '200px';

    this.intersectionObserverService.observe(
      element,
      (isIntersecting) => {
        this._isVisible.set(isIntersecting);

        // Once visible, mark as having been visible (to keep content loaded)
        if (isIntersecting) {
          this._hasBeenVisible.set(true);
        }
      },
      {
        root: observerRoot,
        rootMargin,
        threshold: 0,
      }
    );

    const isAlreadyVisible = this.isWithinPreloadBounds(element, observerRoot, rootMargin);

    if (isAlreadyVisible) {
      this._isVisible.set(true);
      this._hasBeenVisible.set(true);
    }
  }

  private resolveObserverRoot(element: HTMLElement): HTMLElement | null {
    if (!this.inFeedsPanel()) {
      return null;
    }

    return element.closest('.columns-container');
  }

  private isWithinPreloadBounds(
    element: HTMLElement,
    root: HTMLElement | null,
    rootMargin: string
  ): boolean {
    const [topMarginToken = '0px', , bottomMarginToken = topMarginToken] = rootMargin.split(/\s+/);
    const topMargin = Math.abs(parseInt(topMarginToken, 10) || 0);
    const bottomMargin = Math.abs(parseInt(bottomMarginToken, 10) || 0);
    const rect = element.getBoundingClientRect();

    if (root) {
      const rootRect = root.getBoundingClientRect();
      return rect.top < rootRect.bottom + bottomMargin && rect.bottom > rootRect.top - topMargin;
    }

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    return rect.top < viewportHeight + bottomMargin && rect.bottom > -topMargin;
  }

  private async loadSocialPreviews(urls: string[]): Promise<void> {
    const requestId = ++this.socialPreviewRequestId;

    this.socialPreviews.set(urls.map(url => ({
      url,
      loading: true,
      error: false,
    })));

    try {
      const previews = await this.openGraphService.getMultipleOpenGraphData(urls);

      if (requestId !== this.socialPreviewRequestId) {
        return;
      }

      this.socialPreviews.set(previews.map(preview => ({
        ...preview,
        url: normalizePreviewUrl(preview.url),
        loading: false,
      })));
    } catch (error) {
      console.error('Failed to load social previews:', error);

      if (requestId !== this.socialPreviewRequestId) {
        return;
      }

      this.socialPreviews.set(urls.map(url => ({
        url,
        loading: false,
        error: true,
      })));
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
        // Open address-based event by kind
        const encoded = this.parsing.extractNostrUriIdentifier(token.content);
        const record = data as Record<string, unknown>;
        let kind = Number(record['kind'] || 0);

        if (!kind) {
          try {
            const decoded = nip19.decode(encoded);
            if (decoded.type === 'naddr') {
              kind = decoded.data.kind;
            }
          } catch {
            // Ignore decode errors and fallback to generic event route
          }
        }

        if (kind === 30023) {
          this.layoutService.openArticle(encoded);
        } else if (kind === 36787) {
          // Music track - open song detail page
          const addrRecord = data as Record<string, unknown>;
          const pubkey = String(addrRecord['pubkey'] || '');
          const identifier = String(addrRecord['identifier'] || '');
          if (pubkey && identifier) {
            this.layoutService.openSongDetail(nip19.npubEncode(pubkey), identifier);
          } else {
            this.layoutService.openGenericEvent(encoded);
          }
        } else if (kind === 34139) {
          // Music album - open album page
          const addrRecord = data as Record<string, unknown>;
          const pubkey = String(addrRecord['pubkey'] || '');
          const identifier = String(addrRecord['identifier'] || '');
          if (pubkey && identifier) {
            this.layoutService.openMusicAlbum(nip19.npubEncode(pubkey), identifier);
          } else {
            this.layoutService.openGenericEvent(encoded);
          }
        } else if (kind === 30003) {
          // Music playlist bookmark set - open playlist page
          const addrRecord = data as Record<string, unknown>;
          const pubkey = String(addrRecord['pubkey'] || '');
          const identifier = String(addrRecord['identifier'] || '');
          if (pubkey && identifier) {
            this.layoutService.openMusicPlaylist(nip19.npubEncode(pubkey), identifier);
          } else {
            this.layoutService.openGenericEvent(encoded);
          }
        } else {
          this.layoutService.openGenericEvent(encoded);
        }
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
