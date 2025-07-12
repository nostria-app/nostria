import { Component, inject, computed, signal, effect } from '@angular/core';
import { Event, kinds, nip19 } from 'nostr-tools';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { UtilitiesService } from '../../services/utilities.service';
import { NostrService } from '../../services/nostr.service';
import { StorageService } from '../../services/storage.service';
import { LoggerService } from '../../services/logger.service';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { DateToggleComponent } from '../../components/date-toggle/date-toggle.component';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import { DataService } from '../../services/data.service';
import { LayoutService } from '../../services/layout.service';
import { ParsingService } from '../../services/parsing.service';
import { UrlUpdateService } from '../../services/url-update.service';
import { BookmarkService } from '../../services/bookmark.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-article',
  standalone: true,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    UserProfileComponent,
    DateToggleComponent,
    CommonModule
  ],
  templateUrl: './article.component.html',
  styleUrl: './article.component.scss'
})
export class ArticleComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private utilities = inject(UtilitiesService);
  private nostrService = inject(NostrService);
  private storageService = inject(StorageService); private logger = inject(LoggerService);
  private sanitizer = inject(DomSanitizer);
  private data = inject(DataService);
  private layout = inject(LayoutService);
  private parsing = inject(ParsingService);
  private url = inject(UrlUpdateService);
  bookmark = inject(BookmarkService);

  event = signal<Event | undefined>(undefined);
  isLoading = signal(false);
  error = signal<string | null>(null);

  constructor() {
    if (!this.layout.isBrowser()) {
      return;
    }

    // Effect to load article when route parameter changes
    effect(() => {
      const addrParam = this.route.snapshot.paramMap.get('id');
      if (addrParam) {
        this.loadArticle(addrParam);
        // Scroll to top when navigating to a new article
        setTimeout(() => this.layout.scrollMainContentToTop(), 100);
      }
    });
  }

  bookmarkArticle() {
    this.bookmark.toggleBookmark(this.id(), 'a');
  }

  id = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return `${this.event()?.kind}:${this.authorPubkey()}:${this.slug()}`;
  });

  slug = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('d', ev.tags)[0] || '';
  });

  async loadArticle(naddr: string): Promise<void> {
    const receivedData = history.state.event as Event | undefined;

    let pubkey = '';
    let slug = '';

    if (receivedData) {
      this.logger.debug('Received event from navigation state:', receivedData);
      this.event.set(receivedData);
      this.isLoading.set(false);
      // Scroll to top when article is received from navigation state
      setTimeout(() => this.layout.scrollMainContentToTop(), 50);
      return;
    } else if (naddr.startsWith('naddr1')) {

      // Decode the naddr1 parameter using nip19.decode()
      const decoded = this.utilities.decode(naddr);

      if (decoded.type !== 'naddr') {
        throw new Error('Invalid article address format');
      }

      const addrData = decoded.data as any;
      this.logger.debug('Decoded naddr:', addrData);

      pubkey = addrData.pubkey;
      slug = decoded.data.identifier;
    } else {
      const slugParam = this.route.snapshot.paramMap.get('slug');

      // If we have slug, the 
      if (slugParam) {
        slug = slugParam;
        pubkey = this.utilities.getPubkeyFromNpub(naddr);

        // Let's make the URL nicer, TODO add support for replacing with username, for now replace with npub.
        const npub = this.utilities.getNpubFromPubkey(pubkey);
        this.url.updatePathSilently(['/a', npub, slug]);
      }
    }

    try {
      this.isLoading.set(true);
      this.error.set(null);

      let event = await this.data.getEventByPubkeyAndKindAndReplaceableEvent(pubkey, kinds.LongFormArticle, slug, true);

      if (event) {
        this.logger.debug('Loaded article event from storage or relays:', event);
        this.event.set(event.event);
        this.isLoading.set(false);
        return;
      }
    } catch (error) {
      this.logger.error('Error loading article:', error);
      this.error.set('Failed to load article');
    } finally {
      this.isLoading.set(false);
      // Scroll to top after article loads (whether successful or not)
      setTimeout(() => this.layout.scrollMainContentToTop(), 100);
    }
  }

  // Computed properties for parsed event data
  title = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('title', ev.tags)[0] || '';
  });

  image = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('image', ev.tags)[0] || '';
  });

  summary = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('summary', ev.tags)[0] || '';
  });

  publishedAt = computed(() => {
    const ev = this.event();
    if (!ev) return null;
    const publishedAtTag = this.utilities.getTagValues('published_at', ev.tags)[0];
    if (publishedAtTag) {
      return new Date(parseInt(publishedAtTag) * 1000);
    }
    return new Date(ev.created_at * 1000);
  });

  publishedAtTimestamp = computed(() => {
    const ev = this.event();
    if (!ev) return 0;
    const publishedAtTag = this.utilities.getTagValues('published_at', ev.tags)[0];
    if (publishedAtTag) {
      return parseInt(publishedAtTag);
    }
    return ev.created_at;
  });

  hashtags = computed(() => {
    const ev = this.event();
    if (!ev) return [];
    return this.utilities.getTagValues('t', ev.tags);
  });

  content = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    try {
      // Try to parse as JSON first, fall back to raw content
      const parsed = JSON.parse(ev.content);
      return typeof parsed === 'string' ? parsed : ev.content;
    } catch {
      return ev.content;
    }
  });

  // Signal to hold the parsed markdown content
  private _parsedContent = signal<SafeHtml>('');

  // Computed property that returns the parsed content signal value
  parsedContent = computed(() => this._parsedContent());  // Effect to handle async content parsing

  private parseContentEffect = effect(async () => {
    const content = this.content();
    if (!content) {
      this._parsedContent.set('');
      return;
    }

    try {
      // First, preprocess content to convert image URLs to markdown image syntax
      const preprocessedContent = await this.preprocessImageUrls(content);

      // Create a custom renderer for enhanced image handling
      const renderer = new marked.Renderer();

      // Custom image renderer with enhanced attributes and link support
      renderer.image = ({ href, title, text }: { href: string | null; title: string | null; text: string }): string => {
        if (!href) return '';

        // Sanitize the href URL
        const sanitizedHref = href.replace(/[<>"']/g, '');
        const sanitizedTitle = title ? title.replace(/[<>"']/g, '') : '';
        const sanitizedAlt = text ? text.replace(/[<>"']/g, '') : '';

        return `<img 
          src="${sanitizedHref}" 
          alt="${sanitizedAlt}" 
          ${sanitizedTitle ? `title="${sanitizedTitle}"` : ''}
          class="article-image" 
          loading="lazy"
          decoding="async"
          onload="this.style.opacity='1'"
          onerror="this.style.opacity='1'; this.style.border='1px solid var(--mat-sys-error)'; this.alt='Failed to load image: ${sanitizedAlt}'"
          onclick="window.open('${sanitizedHref}', '_blank')"
          style="opacity: 0; transition: opacity 0.3s ease-in-out; cursor: pointer;"
        />`;
      };

      // Custom link renderer that preserves markdown image links and handles standalone image URLs
      renderer.link = (link: any): string => {
        const { href, title, tokens } = link;
        // Extract text from tokens
        const text = tokens && tokens.length > 0 ? tokens[0].raw || href : href;

        if (!href) return text || '';

        // Check if this link contains an image (markdown image link syntax: [![alt](image)](link))
        const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/;
        const imageMatch = text.match(imageRegex);

        if (imageMatch) {
          // This is a markdown image link: [![alt](image)](link)
          const [, altText, imageSrc] = imageMatch;
          const sanitizedHref = href.replace(/[<>"']/g, '');
          const sanitizedImageSrc = imageSrc.replace(/[<>"']/g, '');
          const sanitizedAlt = altText.replace(/[<>"']/g, '');
          const sanitizedTitle = title ? title.replace(/[<>"']/g, '') : '';

          return `<a href="${sanitizedHref}" target="_blank" rel="noopener noreferrer" ${sanitizedTitle ? `title="${sanitizedTitle}"` : ''}>
            <img 
              src="${sanitizedImageSrc}" 
              alt="${sanitizedAlt}" 
              class="article-image linked-image" 
              loading="lazy"
              decoding="async"
              onload="this.style.opacity='1'"
              onerror="this.style.opacity='1'; this.style.border='1px solid var(--mat-sys-error)'; this.alt='Failed to load image: ${sanitizedAlt}'"
              style="opacity: 0; transition: opacity 0.3s ease-in-out; cursor: pointer;"
            />
          </a>`;
        }

        // Check if the link URL itself points to an image (standalone image URLs)
        if (this.isImageUrl(href)) {
          // Render as image instead of link
          const sanitizedHref = href.replace(/[<>"']/g, '');
          const sanitizedTitle = title ? title.replace(/[<>"']/g, '') : '';
          const sanitizedAlt = text || 'Image';

          return `<img 
            src="${sanitizedHref}" 
            alt="${sanitizedAlt}" 
            ${sanitizedTitle ? `title="${sanitizedTitle}"` : ''}
            class="article-image" 
            loading="lazy"
            decoding="async"
            onload="this.style.opacity='1'"
            onerror="this.style.opacity='1'; this.style.border='1px solid var(--mat-sys-error)'; this.alt='Failed to load image: ${sanitizedAlt}'"
            onclick="window.open('${sanitizedHref}', '_blank')"
            style="opacity: 0; transition: opacity 0.3s ease-in-out; cursor: pointer;"
          />`;
        }

        // Regular link rendering
        const sanitizedHref = href.replace(/[<>"']/g, '');
        const sanitizedTitle = title ? title.replace(/[<>"']/g, '') : '';
        return `<a href="${sanitizedHref}" ${sanitizedTitle ? `title="${sanitizedTitle}"` : ''} target="_blank" rel="noopener noreferrer">${text}</a>`;
      };

      // Configure marked with custom renderer and options
      marked.setOptions({
        renderer: renderer,
        gfm: true,
        breaks: true,
        pedantic: false,
      });

      // Parse markdown to HTML (marked.parse returns string)
      const htmlContent = marked.parse(preprocessedContent) as string;

      // Sanitize and return safe HTML
      this._parsedContent.set(this.sanitizer.bypassSecurityTrustHtml(htmlContent));
    } catch (error) {
      this.logger.error('Error parsing markdown:', error);
      // Fallback to plain text
      this._parsedContent.set(this.sanitizer.bypassSecurityTrustHtml(
        content.replace(/\n/g, '<br>')
      ));
    }
  });

  authorPubkey = computed(() => {
    const ev = this.event();
    return ev?.pubkey || '';
  });

  formatLocalDate(date: Date | null): string {
    if (!date) return '';
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  retryLoad(): void {
    const addrParam = this.route.snapshot.paramMap.get('id');
    if (addrParam) {
      this.loadArticle(addrParam);
    }
  }

  async shareArticle() {
    const event = this.event();
    if (!event) return;

    // Parse title and summary from the Nostr event tags
    const title = this.title();
    const summary = this.summary();

    const shareData: ShareData = {
      title: title || 'Nostr Article',
      text: summary || `Check out this article: ${title || 'Nostr Article'}`,
      url: window.location.href,
    };

    try {
      if (navigator.share && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        // Fallback to clipboard
        const textToShare = `${title || 'Nostr Article'}\n\n${summary || ''}\n\n${window.location.href}`;
        await navigator.clipboard.writeText(textToShare);

        // You might want to show a toast/snackbar here indicating the content was copied
        console.log('Article details copied to clipboard');
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Error sharing article:', error);
        // Fallback to clipboard if sharing fails
        try {
          const textToShare = `${title || 'Nostr Article'}\n\n${summary || ''}\n\n${window.location.href}`;
          await navigator.clipboard.writeText(textToShare);
          console.log('Article details copied to clipboard');
        } catch (clipboardError) {
          console.error('Failed to copy to clipboard:', clipboardError);
        }
      }
    }
  }

  // Helper method to check if a URL points to an image
  private isImageUrl(url: string): boolean {
    if (!url) return false;

    // Remove query parameters and fragments for extension check
    const urlWithoutParams = url.split('?')[0].split('#')[0];

    // Common image extensions
    const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff|avif|heic|heif)$/i;

    // Check file extension
    if (imageExtensions.test(urlWithoutParams)) {
      return true;
    }

    // Check for common image hosting patterns and CDNs
    const imageHostPatterns = [
      /imgur\.com\/\w+$/i,
      /i\.imgur\.com/i,
      /images\.unsplash\.com/i,
      /unsplash\.com\/photos/i,
      /cdn\.pixabay\.com/i,
      /pexels\.com\/photo/i,
      /flickr\.com\/.*\.(jpg|jpeg|png|gif)/i,
      /githubusercontent\.com.*\.(jpg|jpeg|png|gif|svg|webp)/i,
      /media\.giphy\.com/i,
      /tenor\.com\/view/i,
      /prnt\.sc\/\w+/i,
      /gyazo\.com\/\w+/i,
      /postimg\.cc/i,
      /imgbb\.com/i,
      /imageban\.ru/i,
      /photobucket\.com/i,
      /tinypic\.com/i,
      /imageshack\.us/i,
      /cloud\.githubusercontent\.com/i,
      /avatars\.githubusercontent\.com/i,
      /raw\.githubusercontent\.com.*\.(jpg|jpeg|png|gif|svg|webp)/i,
      /discord\.com\/attachments.*\.(jpg|jpeg|png|gif|webp)/i,
      /cdn\.discordapp\.com.*\.(jpg|jpeg|png|gif|webp)/i,
      /media\.discordapp\.net.*\.(jpg|jpeg|png|gif|webp)/i,
      /.*\.cloudfront\.net.*\.(jpg|jpeg|png|gif|svg|webp)/i,
      /.*\.amazonaws\.com.*\.(jpg|jpeg|png|gif|svg|webp)/i
    ];

    return imageHostPatterns.some(pattern => pattern.test(url));
  }

  // Helper method to preprocess content and convert standalone image URLs to markdown images
  private async preprocessImageUrls(content: string) {
    // First, process Nostr tokens
    content = await this.processNostrTokens(content);

    // Pattern to match standalone URLs that point to images
    // This will match URLs on their own line or URLs not already in markdown syntax
    // Updated to be more careful about existing markdown syntax
    const standaloneImageUrlPattern = /(?:^|\s)(https?:\/\/[^\s<>"\]]+)(?=\s|$)/gm;

    return content.replace(standaloneImageUrlPattern, (match, url) => {
      // Don't convert if already in markdown image syntax
      const beforeMatch = content.substring(0, content.indexOf(match));

      // Check if it's already part of markdown image syntax ![alt](url) or [![alt](url)](link)
      if (beforeMatch.endsWith('](') || beforeMatch.endsWith('![') || beforeMatch.match(/!\[[^\]]*\]$/)) {
        return match;
      }

      // Check if it's already part of markdown link syntax [text](url)
      if (beforeMatch.match(/\[[^\]]*\]$/)) {
        return match;
      }

      // If the URL points to an image, convert it to markdown image syntax
      if (this.isImageUrl(url.trim())) {
        const filename = url.split('/').pop()?.split('.')[0] || 'Image';
        return match.replace(url, `![${filename}](${url.trim()})`);
      }

      return match;
    });
  }
  // Helper method to process Nostr tokens and replace them with @username
  private async processNostrTokens(content: string): Promise<string> {
    const nostrRegex = /(nostr:(?:npub|nprofile|note|nevent|naddr)1[a-zA-Z0-9]+)(?=\s|##LINEBREAK##|$|[^\w])/g;

    // Find all matches first
    const matches = Array.from(content.matchAll(nostrRegex));

    // Process each match asynchronously
    const replacements = await Promise.all(
      matches.map(async (match: RegExpMatchArray) => {
        try {
          const nostrData = await this.parsing.parseNostrUri(match[0]);

          if (nostrData) {
            // Generate a user-friendly mention based on the Nostr data type
            switch (nostrData.type) {
              case 'npub':
              case 'nprofile':
                // For user profiles, create @username mention with proper link
                const pubkey = nostrData.data?.pubkey || nostrData.data;
                const username = nostrData.displayName;
                const npub = this.utilities.getNpubFromPubkey(pubkey);
                return {
                  original: match[0],
                  replacement: `<a href="/p/${npub}" class="nostr-mention" data-pubkey="${pubkey}" data-type="profile" title="View @${username}'s profile">@${username}</a>`
                };

              case 'note':
                // For notes, create a reference link
                const noteId = nostrData.data;
                const noteRef = nostrData.displayName || `note${noteId.substring(0, 8)}`;
                const noteEncoded = nip19.noteEncode(noteId);
                return {
                  original: match[0],
                  replacement: `<a href="/e/${noteEncoded}" class="nostr-reference" data-event-id="${noteId}" data-type="note" title="View note">📝 ${noteRef}</a>`
                };

              case 'nevent':
                // For events, create a reference link
                const eventId = nostrData.data?.id || nostrData.data;
                const eventRef = nostrData.displayName || `event${eventId.substring(0, 8)}`;
                const neventEncoded = nip19.neventEncode(nostrData.data);
                return {
                  original: match[0],
                  replacement: `<a href="/e/${neventEncoded}" class="nostr-reference" data-event-id="${eventId}" data-type="event" title="View event">📝 ${eventRef}</a>`
                };

              case 'naddr':
                // For addresses (like articles), create a reference link
                const identifier = nostrData.data?.identifier || '';
                const kind = nostrData.data?.kind || '';
                const authorPubkey = nostrData.data?.pubkey || '';
                const addrRef = nostrData.displayName || identifier || `${kind}:${authorPubkey.substring(0, 8)}`;
                const naddrEncoded = nip19.naddrEncode(nostrData.data);
                return {
                  original: match[0],
                  replacement: `<a href="/a/${naddrEncoded}" class="nostr-reference" data-identifier="${identifier}" data-kind="${kind}" data-type="article" title="View article">📄 ${addrRef}</a>`
                };

              default:
                return {
                  original: match[0],
                  replacement: `<span class="nostr-mention" title="Nostr reference">${nostrData.displayName || match[0]}</span>`
                };
            }
          }

          return {
            original: match[0],
            replacement: match[0]
          };
        } catch (error) {
          this.logger.error('Error parsing Nostr URI:', error);
          return {
            original: match[0],
            replacement: match[0]
          };
        }
      })
    );

    // Apply all replacements to the content
    let result = content;
    for (const replacement of replacements) {
      result = result.replace(replacement.original, replacement.replacement);
    }

    return result;
  }
}
