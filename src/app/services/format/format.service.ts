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
   * Escape HTML special characters to prevent XSS
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

      // Truncate content for preview
      const maxContentLength = 200;
      let previewContent = content.trim();
      if (previewContent.length > maxContentLength) {
        previewContent = previewContent.substring(0, maxContentLength) + '…';
      }

      // Escape HTML in content
      const escapedContent = this.escapeHtml(previewContent);
      const authorShort = this.utilities.getTruncatedNpub(author);


      // Determine icon based on kind
      let icon = '📝';
      let kindLabel = 'Note';
      if (kind === 1) {
        icon = '📝';
        kindLabel = 'Note';
      } else if (kind === 30023) {
        icon = '📄';
        kindLabel = 'Article';
      } else if (kind === 6) {
        icon = '🔁';
        kindLabel = 'Repost';
      } else if (kind === 7) {
        icon = '❤️';
        kindLabel = 'Reaction';
      } else {
        kindLabel = `Kind ${kind}`;
      }

      return `<div class="nostr-embed-preview" data-event-id="${eventId}" data-author="${author}" data-kind="${kind}">
        <a href="/e/${nip19.noteEncode(eventId)}" class="nostr-embed-link">
          <div class="nostr-embed-icon">
            <span class="embed-icon">${icon}</span>
          </div>
          <div class="nostr-embed-content">
            <div class="nostr-embed-title">${escapedContent}</div>
            <div class="nostr-embed-meta">${kindLabel} · by ${authorShort}</div>
          </div>
        </a>
      </div>`;
    } catch (error) {
      this.logger.error('[fetchEventPreview] Error fetching event preview:', error);
      return null;
    }
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

                // Fallback to simple reference link if preview fails
                const noteRef = nostrData.displayName || `note${noteId.substring(0, 8)}`;
                const noteEncoded = nip19.noteEncode(noteId);
                return {
                  original: match[0],
                  replacement: `<a href="/e/${noteEncoded}" class="nostr-reference" data-event-id="${noteId}" data-type="note" title="View note">📝 ${noteRef}</a>`,
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
                const noteEncoded = nip19.noteEncode(noteId);

                // Immediate fallback link
                replacement = `<a href="/e/${noteEncoded}" class="nostr-reference" data-event-id="${noteId}" data-type="note" title="View note">📝 ${noteRef}</a>`;
                if (onPreviewLoaded) {
                  onPreviewLoaded(match[0], replacement);
                }

                // Fetch preview in background
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
