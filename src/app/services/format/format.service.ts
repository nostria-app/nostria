import { inject, Injectable } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { nip19 } from 'nostr-tools';
import { LoggerService } from '../logger.service';
import { ParsingService } from '../parsing.service';
import { UtilitiesService } from '../utilities.service';
import markdownRenderer from './markdownRenderer';
import { imageUrlsToMarkdown } from './utils';
import { DataService } from '../data.service';
import { RelayPoolService } from '../relays/relay-pool';
import { UserRelaysService } from '../relays/user-relays';

@Injectable({
  providedIn: 'root',
})
export class FormatService {
  private logger = inject(LoggerService);
  private parsingService = inject(ParsingService);
  private utilities = inject(UtilitiesService);
  private sanitizer = inject(DomSanitizer);
  private dataService = inject(DataService);
  private relayPool = inject(RelayPoolService);
  private userRelaysService = inject(UserRelaysService);

  /**
   * Escape HTML special characters to prevent XSS.
   * Uses UtilitiesService.escapeHtml() for consistency.
   */
  private escapeHtml(text: string): string {
    return this.utilities.escapeHtml(text);
  }

  /**
   * Fetch event data from relays and create preview HTML
   * Made public to allow usage in components that need to render event previews
   */
  async fetchEventPreview(
    eventId: string,
    authorPubkey?: string,
    relayHints?: string[]
  ): Promise<string | null> {
    try {
      this.logger.debug('[fetchEventPreview] Starting fetch for event:', {
        eventId,
        authorPubkey,
        relayHints,
      });

      let event = null;
      let relaysToUse: string[] = [];

      // 1. If we have relay hints, use them first
      if (relayHints && relayHints.length > 0) {
        relaysToUse = this.utilities.normalizeRelayUrls(relayHints);
        this.logger.debug('[fetchEventPreview] Trying relay hints:', relaysToUse);
        event = await this.relayPool.get(relaysToUse, { ids: [eventId] }, 3000);

        if (event) {
          this.logger.debug('[fetchEventPreview] Event found via relay hints');
        } else {
          this.logger.debug('[fetchEventPreview] Event not found via relay hints');
        }
      }

      // 2. If no event found and we have author pubkey, discover their relays
      if (!event && authorPubkey) {
        this.logger.debug('[fetchEventPreview] Discovering relays for author:', authorPubkey);
        await this.userRelaysService.ensureRelaysForPubkey(authorPubkey);
        relaysToUse = this.userRelaysService.getRelaysForPubkey(authorPubkey) || [];

        this.logger.debug('[fetchEventPreview] Author relays discovered:', relaysToUse.length);

        if (relaysToUse.length > 0) {
          // Use optimal relays for better performance
          const optimalRelays = this.utilities.pickOptimalRelays(relaysToUse, 5);
          this.logger.debug('[fetchEventPreview] Trying optimal relays:', optimalRelays);
          event = await this.relayPool.get(optimalRelays, { ids: [eventId] }, 3000);

          if (event) {
            this.logger.debug('[fetchEventPreview] Event found via author relays');
          } else {
            this.logger.debug('[fetchEventPreview] Event not found via author relays');
          }
        }
      }

      // 3. If still no event and we have author, try using account relays as fallback
      if (!event && authorPubkey) {
        this.logger.debug('[fetchEventPreview] Trying account relays as fallback');
        try {
          const record = await this.dataService.getEventById(eventId, { cache: true, save: true });
          event = record?.event || null;

          if (event) {
            this.logger.debug('[fetchEventPreview] Event found via account relays/storage');
          }
        } catch (error) {
          this.logger.debug('[fetchEventPreview] Failed to get event from account relays:', error);
        }
      }

      // 4. If still no event, try from cache or storage one more time
      if (!event) {
        this.logger.debug('[fetchEventPreview] Trying cache/storage as final fallback');
        const record = await this.dataService.getEventById(eventId, { cache: true, save: true });
        event = record?.event || null;

        if (event) {
          this.logger.debug('[fetchEventPreview] Event found in cache/storage');
        } else {
          this.logger.debug('[fetchEventPreview] Event not found in cache/storage');
        }
      }

      if (!event) {
        this.logger.warn('[fetchEventPreview] Could not fetch event for preview:', eventId);
        return null;
      }

      this.logger.debug('[fetchEventPreview] Event fetched successfully:', {
        id: event.id,
        kind: event.kind,
        author: event.pubkey.substring(0, 8),
        contentLength: event.content?.length || 0,
      });

      // Extract preview information from the event
      const author = event.pubkey;
      const content = event.content || '';
      const kind = event.kind;
      const createdAt = event.created_at;

      // Extract image URLs from content
      const imageRegex = /(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|svg)(?:\?[^\s]*)?)/gi;
      const imageUrls = content.match(imageRegex) || [];
      const firstImage = imageUrls.length > 0 ? imageUrls[0] : null;

      // Remove image URLs from text content for cleaner display
      let textContent = content;
      for (const imgUrl of imageUrls) {
        textContent = textContent.replace(imgUrl, '').trim();
      }

      // Truncate text content for preview
      const maxContentLength = 380;
      let previewContent = textContent.trim();

      // Collapse multiple newlines into single newline for cleaner display
      previewContent = previewContent.replace(/\n{2,}/g, '\n');

      if (previewContent.length > maxContentLength) {
        previewContent = previewContent.substring(0, maxContentLength) + '…';
      }

      // Escape HTML in content, then convert newlines to <br> for proper display
      const escapedContent = this.escapeHtml(previewContent).replace(/\n/g, '<br>');

      // Build image HTML if there's an image
      const imageHtml = firstImage
        ? `<div style="margin-top:8px;clear:both;"><img src="${this.escapeHtml(firstImage)}" alt="Image" style="max-width:100%;max-height:400px;border-radius:8px;object-fit:contain;" onerror="this.parentElement.style.display='none';" /></div>`
        : '';

      // Fetch author profile for avatar and display name
      let authorName = this.utilities.getTruncatedNpub(author);
      let authorPicture = '';
      let isNip05Verified = false;

      try {
        const profile = await this.dataService.getProfile(author);
        if (profile?.data) {
          authorName = profile.data.display_name || profile.data.name || authorName;
          authorPicture = profile.data.picture || '';
          isNip05Verified = !!profile.data.nip05;
        }
      } catch (error) {
        this.logger.debug('[fetchEventPreview] Could not fetch author profile:', error);
      }

      // Calculate relative time
      const relativeTime = this.getRelativeTime(createdAt);

      // Build avatar HTML with inline styles to ensure proper sizing
      const avatarHtml = authorPicture
        ? `<img src="${this.escapeHtml(authorPicture)}" alt="${this.escapeHtml(authorName)}" class="embed-avatar" style="width:36px;height:36px;min-width:36px;min-height:36px;border-radius:50%;object-fit:cover;float:left;margin-right:10px;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><div class="embed-avatar-fallback" style="display:none;width:36px;height:36px;min-width:36px;border-radius:50%;float:left;margin-right:10px;align-items:center;justify-content:center;font-size:18px;background:var(--mat-sys-surface-container-highest,#e0e0e0);">👤</div>`
        : `<div class="embed-avatar-fallback" style="width:36px;height:36px;min-width:36px;border-radius:50%;float:left;margin-right:10px;display:flex;align-items:center;justify-content:center;font-size:18px;background:var(--mat-sys-surface-container-highest,#e0e0e0);">👤</div>`;

      // Build verification badge HTML
      const verifiedBadge = isNip05Verified
        ? `<span class="embed-verified-badge" style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;background:var(--mat-sys-primary,#6200ea);color:white;font-size:9px;margin-left:4px;vertical-align:middle;">✓</span>`
        : '';

      // Use nevent encoding with full event data (id, pubkey, kind) for proper routing
      const neventEncoded = nip19.neventEncode({ id: eventId, author: author, kind: kind });

      return `<div class="nostr-embed-preview" data-event-id="${eventId}" data-author="${author}" data-kind="${kind}" style="margin:0.5rem 0;border:1px solid var(--mat-sys-outline-variant,rgba(255,255,255,0.12));border-radius:10px;background:var(--mat-sys-surface-container-low,#1e1e1e);overflow:hidden;"><a href="/e/${neventEncoded}" class="nostr-embed-link" style="display:block;padding:10px 12px;text-decoration:none;color:inherit;">${avatarHtml}<span class="embed-author-name" style="color:var(--mat-sys-on-surface,#fff);">${this.escapeHtml(authorName)}</span>${verifiedBadge}<span class="embed-time" style="color:var(--mat-sys-on-surface-variant,#999);font-size:0.8rem;margin-left:6px;">· ${relativeTime}</span><div class="embed-content" style="color:var(--mat-sys-on-surface,#fff);line-height:1.45;margin-top:2px;">${escapedContent}</div>${imageHtml}</a></div>`;
    } catch (error) {
      this.logger.error('[fetchEventPreview] Error fetching event preview:', error);
      return null;
    }
  }

  /**
   * Fetch the raw event from relays without generating preview HTML.
   * Useful when you need to render the event using a specific component (e.g., PhotoEventComponent for kind 20).
   */
  async fetchEvent(
    eventId: string,
    authorPubkey?: string,
    relayHints?: string[]
  ): Promise<import('nostr-tools').Event | null> {
    try {
      let event = null;
      let relaysToUse: string[] = [];

      // 1. If we have relay hints, use them first
      if (relayHints && relayHints.length > 0) {
        relaysToUse = this.utilities.normalizeRelayUrls(relayHints);
        event = await this.relayPool.get(relaysToUse, { ids: [eventId] }, 3000);
      }

      // 2. If no event found and we have author pubkey, discover their relays
      if (!event && authorPubkey) {
        await this.userRelaysService.ensureRelaysForPubkey(authorPubkey);
        relaysToUse = this.userRelaysService.getRelaysForPubkey(authorPubkey) || [];

        if (relaysToUse.length > 0) {
          const optimalRelays = this.utilities.pickOptimalRelays(relaysToUse, 5);
          event = await this.relayPool.get(optimalRelays, { ids: [eventId] }, 3000);
        }
      }

      // 3. Try using account relays/storage as fallback
      if (!event && authorPubkey) {
        try {
          const record = await this.dataService.getEventById(eventId, { cache: true, save: true });
          event = record?.event || null;
        } catch {
          // Ignore errors
        }
      }

      // 4. Final fallback - try cache/storage
      if (!event) {
        const record = await this.dataService.getEventById(eventId, { cache: true, save: true });
        event = record?.event || null;
      }

      return event;
    } catch (error) {
      this.logger.error('[fetchEvent] Error fetching event:', error);
      return null;
    }
  }

  /**
   * Calculate relative time from a Nostr timestamp (seconds since epoch)
   * Delegates to UtilitiesService for consistency across the codebase.
   */
  private getRelativeTime(timestamp: number): string {
    return this.utilities.getRelativeTime(timestamp);
  }

  // Helper method to process Nostr tokens and replace them with @username
  private async processNostrTokens(content: string): Promise<string> {
    const nostrRegex =
      /(nostr:(?:npub|nprofile|note|nevent|naddr)1[a-zA-Z0-9]+)(?=\s|##LINEBREAK##|$|[^\w])/g;

    // Find all matches first
    const matches = Array.from(content.matchAll(nostrRegex));

    // Process each match asynchronously
    const replacements = await Promise.all(
      matches.map(async (match: RegExpMatchArray) => {
        try {
          const nostrData = await this.parsingService.parseNostrUri(match[0]);

          if (nostrData) {
            // Generate a user-friendly mention based on the Nostr data type
            switch (nostrData.type) {
              case 'npub':
              case 'nprofile': {
                // For user profiles, create @username mention with proper link
                const pubkey = nostrData.data?.pubkey || nostrData.data;
                const username = nostrData.displayName;
                const npub = this.utilities.getNpubFromPubkey(pubkey);
                return {
                  original: match[0],
                  replacement: `<a href="/p/${npub}" class="nostr-mention" data-pubkey="${pubkey}" data-type="profile" title="View @${username}'s profile">@${username}</a>`,
                };
              }

              case 'note': {
                // For notes, try to create an embedded preview card
                const noteId = nostrData.data;

                // Attempt to fetch and render note preview
                const preview = await this.fetchEventPreview(noteId);

                if (preview) {
                  return {
                    original: match[0],
                    replacement: preview,
                  };
                }

                // Fallback: try to fetch event data for proper nevent encoding
                const noteRef = nostrData.displayName || `note${noteId.substring(0, 8)}`;
                let neventEncoded: string;
                try {
                  const record = await this.dataService.getEventById(noteId, { cache: true, save: false });
                  if (record?.event) {
                    neventEncoded = nip19.neventEncode({ id: noteId, author: record.event.pubkey, kind: record.event.kind });
                  } else {
                    // If we can't get the event, encode with just the ID (kind 1 assumed for notes)
                    neventEncoded = nip19.neventEncode({ id: noteId });
                  }
                } catch {
                  neventEncoded = nip19.neventEncode({ id: noteId });
                }
                return {
                  original: match[0],
                  replacement: `<a href="/e/${neventEncoded}" class="nostr-reference" data-event-id="${noteId}" data-type="note" title="View note">📝 ${noteRef}</a>`,
                };
              }

              case 'nevent': {
                // For events, create an embedded preview card
                const eventId = nostrData.data?.id || nostrData.data;
                const authorPubkey = nostrData.data?.author || nostrData.data?.pubkey; // Try both 'author' and 'pubkey'
                const relayHints = nostrData.data?.relays;

                this.logger.debug('[processNostrTokens] nevent parsed:', {
                  eventId,
                  authorPubkey,
                  relayHints,
                  nostrData: nostrData.data,
                });

                // Attempt to fetch and render event preview
                const preview = await this.fetchEventPreview(eventId, authorPubkey, relayHints);

                if (preview) {
                  this.logger.debug('[processNostrTokens] nevent preview generated successfully');
                  return {
                    original: match[0],
                    replacement: preview,
                  };
                }

                this.logger.debug('[processNostrTokens] nevent preview failed, using fallback');
                // Fallback to simple reference link if preview fails
                const eventRef = nostrData.displayName || `event${eventId.substring(0, 8)}`;
                const neventEncoded = nip19.neventEncode(nostrData.data);
                return {
                  original: match[0],
                  replacement: `<a href="/e/${neventEncoded}" class="nostr-reference" data-event-id="${eventId}" data-type="event" title="View event">📝 ${eventRef}</a>`,
                };
              }

              case 'naddr': {
                // For addresses (like articles), create an embedded preview card
                const identifier = nostrData.data?.identifier || '';
                const kind = nostrData.data?.kind || '';
                const authorPubkey = nostrData.data?.pubkey || '';
                const addrRef =
                  nostrData.displayName || identifier || `${kind}:${authorPubkey.substring(0, 8)}`;
                const naddrEncoded = nip19.naddrEncode(nostrData.data);

                // Create an embedded preview card for the article
                return {
                  original: match[0],
                  replacement: `<div class="nostr-embed-preview" data-naddr="${naddrEncoded}" data-identifier="${identifier}" data-kind="${kind}" data-pubkey="${authorPubkey}">
                    <a href="/a/${naddrEncoded}" class="nostr-embed-link">
                      <div class="nostr-embed-icon">
                        <span class="embed-icon">📄</span>
                      </div>
                      <div class="nostr-embed-content">
                        <div class="nostr-embed-title">${this.escapeHtml(addrRef)}</div>
                        <div class="nostr-embed-meta">Article · Kind ${kind}</div>
                      </div>
                    </a>
                  </div>`,
                };
              }

              default:
                return {
                  original: match[0],
                  replacement: `<span class="nostr-mention" title="Nostr reference">${nostrData.displayName || match[0]}</span>`,
                };
            }
          }

          return {
            original: match[0],
            replacement: match[0],
          };
        } catch (error) {
          this.logger.error('Error parsing Nostr URI:', error);
          return {
            original: match[0],
            replacement: match[0],
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

  /**
   * Process Nostr tokens without blocking on preview fetches
   * Returns content immediately with placeholders, and fetches previews in background
   */
  private processNostrTokensNonBlocking(
    content: string,
    onPreviewLoaded?: (original: string, replacement: string) => void
  ): string {
    const nostrRegex =
      /(nostr:(?:npub|nprofile|note|nevent|naddr)1[a-zA-Z0-9]+)(?=\s|##LINEBREAK##|$|[^\w])/g;

    // Find all matches first
    const matches = Array.from(content.matchAll(nostrRegex));
    let result = content;

    // Process each match
    for (const match of matches) {
      try {
        // Parse Nostr URI synchronously (this is fast)
        this.parsingService.parseNostrUri(match[0]).then(nostrData => {
          if (nostrData) {
            let replacement = '';

            // Generate replacements based on type
            switch (nostrData.type) {
              case 'npub':
              case 'nprofile': {
                // For user profiles, create @username mention with proper link
                const pubkey = nostrData.data?.pubkey || nostrData.data;
                const username = nostrData.displayName;
                const npub = this.utilities.getNpubFromPubkey(pubkey);
                replacement = `<a href="/p/${npub}" class="nostr-mention" data-pubkey="${pubkey}" data-type="profile" title="View @${username}'s profile">@${username}</a>`;
                if (onPreviewLoaded) {
                  onPreviewLoaded(match[0], replacement);
                }
                break;
              }

              case 'note': {
                // For notes, show placeholder first then fetch preview in background
                const noteId = nostrData.data;
                const noteRef = nostrData.displayName || `note${noteId.substring(0, 8)}`;
                // Use nevent with just id for immediate placeholder (will be replaced with full data in preview)
                const neventEncoded = nip19.neventEncode({ id: noteId });

                // Immediate fallback link
                replacement = `<a href="/e/${neventEncoded}" class="nostr-reference" data-event-id="${noteId}" data-type="note" title="View note">📝 ${noteRef}</a>`;
                if (onPreviewLoaded) {
                  onPreviewLoaded(match[0], replacement);
                }

                // Fetch preview in background - this will have proper nevent with full event data
                this.fetchEventPreview(noteId).then(preview => {
                  if (preview && onPreviewLoaded) {
                    onPreviewLoaded(match[0], preview);
                  }
                });
                break;
              }

              case 'nevent': {
                // For events, show placeholder first then fetch preview in background
                const eventId = nostrData.data?.id || nostrData.data;
                const authorPubkey = nostrData.data?.author || nostrData.data?.pubkey;
                const relayHints = nostrData.data?.relays;
                const eventRef = nostrData.displayName || `event${eventId.substring(0, 8)}`;
                const neventEncoded = nip19.neventEncode(nostrData.data);

                // Immediate fallback link
                replacement = `<a href="/e/${neventEncoded}" class="nostr-reference" data-event-id="${eventId}" data-type="event" title="View event">📝 ${eventRef}</a>`;
                if (onPreviewLoaded) {
                  onPreviewLoaded(match[0], replacement);
                }

                // Fetch preview in background
                this.fetchEventPreview(eventId, authorPubkey, relayHints).then(preview => {
                  if (preview && onPreviewLoaded) {
                    onPreviewLoaded(match[0], preview);
                  }
                });
                break;
              }

              case 'naddr': {
                // For addresses, create immediate preview
                const identifier = nostrData.data?.identifier || '';
                const kind = nostrData.data?.kind || '';
                const authorPubkey = nostrData.data?.pubkey || '';
                const addrRef =
                  nostrData.displayName || identifier || `${kind}:${authorPubkey.substring(0, 8)}`;
                const naddrEncoded = nip19.naddrEncode(nostrData.data);

                replacement = `<div class="nostr-embed-preview" data-naddr="${naddrEncoded}" data-identifier="${identifier}" data-kind="${kind}" data-pubkey="${authorPubkey}">
                    <a href="/a/${naddrEncoded}" class="nostr-embed-link">
                      <div class="nostr-embed-icon">
                        <span class="embed-icon">📄</span>
                      </div>
                      <div class="nostr-embed-content">
                        <div class="nostr-embed-title">${this.escapeHtml(addrRef)}</div>
                        <div class="nostr-embed-meta">Article · Kind ${kind}</div>
                      </div>
                    </a>
                  </div>`;
                if (onPreviewLoaded) {
                  onPreviewLoaded(match[0], replacement);
                }
                break;
              }

              default:
                replacement = `<span class="nostr-mention" title="Nostr reference">${nostrData.displayName || match[0]}</span>`;
                if (onPreviewLoaded) {
                  onPreviewLoaded(match[0], replacement);
                }
            }
          }
        });

        // Replace with placeholder immediately (the token itself as a link)
        const placeholder = `<span class="nostr-loading">${this.escapeHtml(match[0])}</span>`;
        result = result.replace(match[0], placeholder);
      } catch (error) {
        this.logger.error('Error parsing Nostr URI:', error);
      }
    }

    return result;
  }

  async markdownToHtml(rawMarkdown: string): Promise<SafeHtml> {
    try {
      // First, preprocess content to convert image URLs to markdown image syntax
      // Do this BEFORE any HTML sanitization since we're working with markdown

      // First, process Nostr tokens
      let content = await this.processNostrTokens(rawMarkdown);
      content = await imageUrlsToMarkdown(content);

      // Configure marked with custom renderer and options for modern marked.js
      marked.use({
        renderer: markdownRenderer,
        gfm: true,
        breaks: true,
        pedantic: false,
      });

      // Parse markdown to HTML (marked.parse returns string)
      const htmlContent = marked.parse(content) as string;

      // Now sanitize the resulting HTML to remove any malicious content
      const sanitizedHtmlContent = DOMPurify.sanitize(htmlContent);

      // Set the sanitized HTML content
      return this.sanitizer.bypassSecurityTrustHtml(sanitizedHtmlContent);
    } catch (error) {
      this.logger.error('Error parsing markdown:', error);
      // Fallback to plain text
      const sanitizedHtmlContent = DOMPurify.sanitize(rawMarkdown.replace(/\n/g, '<br>'));
      return this.sanitizer.bypassSecurityTrustHtml(sanitizedHtmlContent);
    }
  }

  /**
   * Non-blocking version of markdownToHtml that renders content immediately
   * and loads previews asynchronously in the background
   */
  markdownToHtmlNonBlocking(
    rawMarkdown: string,
    onUpdate?: (html: SafeHtml) => void
  ): SafeHtml {
    try {
      // Track updates for this specific content
      const updates = new Map<string, string>();

      // Callback for when previews are loaded
      const handlePreviewLoaded = (original: string, replacement: string) => {
        updates.set(original, replacement);

        // Reprocess content with all updates so far
        let updatedContent = rawMarkdown;
        for (const [orig, repl] of updates.entries()) {
          updatedContent = updatedContent.replace(orig, repl);
        }

        // Convert to markdown and sanitize
        imageUrlsToMarkdown(updatedContent).then(content => {
          marked.use({
            renderer: markdownRenderer,
            gfm: true,
            breaks: true,
            pedantic: false,
          });

          const htmlContent = marked.parse(content) as string;
          const sanitizedHtmlContent = DOMPurify.sanitize(htmlContent);
          const safeHtml = this.sanitizer.bypassSecurityTrustHtml(sanitizedHtmlContent);

          if (onUpdate) {
            onUpdate(safeHtml);
          }
        });
      };

      // Process Nostr tokens with non-blocking approach
      const initialContent = this.processNostrTokensNonBlocking(
        rawMarkdown,
        handlePreviewLoaded
      );

      // Convert images to markdown and render immediately
      imageUrlsToMarkdown(initialContent).then(content => {
        marked.use({
          renderer: markdownRenderer,
          gfm: true,
          breaks: true,
          pedantic: false,
        });

        const htmlContent = marked.parse(content) as string;
        const sanitizedHtmlContent = DOMPurify.sanitize(htmlContent);
        const safeHtml = this.sanitizer.bypassSecurityTrustHtml(sanitizedHtmlContent);

        if (onUpdate) {
          onUpdate(safeHtml);
        }
      });

      // Return initial content immediately (with placeholders)
      marked.use({
        renderer: markdownRenderer,
        gfm: true,
        breaks: true,
        pedantic: false,
      });

      const htmlContent = marked.parse(initialContent) as string;
      const sanitizedHtmlContent = DOMPurify.sanitize(htmlContent);

      return this.sanitizer.bypassSecurityTrustHtml(sanitizedHtmlContent);
    } catch (error) {
      this.logger.error('Error parsing markdown:', error);
      // Fallback to plain text
      const sanitizedHtmlContent = DOMPurify.sanitize(rawMarkdown.replace(/\n/g, '<br>'));
      return this.sanitizer.bypassSecurityTrustHtml(sanitizedHtmlContent);
    }
  }
}
