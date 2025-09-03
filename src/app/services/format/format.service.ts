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

@Injectable({
  providedIn: 'root',
})
export class FormatService {
  private logger = inject(LoggerService);
  private parsingService = inject(ParsingService);
  private utilities = inject(UtilitiesService);
  private sanitizer = inject(DomSanitizer);

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
                // For notes, create a reference link
                const noteId = nostrData.data;
                const noteRef = nostrData.displayName || `note${noteId.substring(0, 8)}`;
                const noteEncoded = nip19.noteEncode(noteId);
                return {
                  original: match[0],
                  replacement: `<a href="/e/${noteEncoded}" class="nostr-reference" data-event-id="${noteId}" data-type="note" title="View note">📝 ${noteRef}</a>`,
                };
              }

              case 'nevent': {
                // For events, create a reference link
                const eventId = nostrData.data?.id || nostrData.data;
                const eventRef = nostrData.displayName || `event${eventId.substring(0, 8)}`;
                const neventEncoded = nip19.neventEncode(nostrData.data);
                return {
                  original: match[0],
                  replacement: `<a href="/e/${neventEncoded}" class="nostr-reference" data-event-id="${eventId}" data-type="event" title="View event">📝 ${eventRef}</a>`,
                };
              }

              case 'naddr': {
                // For addresses (like articles), create a reference link
                const identifier = nostrData.data?.identifier || '';
                const kind = nostrData.data?.kind || '';
                const authorPubkey = nostrData.data?.pubkey || '';
                const addrRef =
                  nostrData.displayName || identifier || `${kind}:${authorPubkey.substring(0, 8)}`;
                const naddrEncoded = nip19.naddrEncode(nostrData.data);
                return {
                  original: match[0],
                  replacement: `<a href="/a/${naddrEncoded}" class="nostr-reference" data-identifier="${identifier}" data-kind="${kind}" data-type="article" title="View article">📄 ${addrRef}</a>`,
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
      }),
    );

    // Apply all replacements to the content
    let result = content;
    for (const replacement of replacements) {
      result = result.replace(replacement.original, replacement.replacement);
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
}
