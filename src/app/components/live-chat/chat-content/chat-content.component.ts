import { Component, input, inject, computed, ChangeDetectionStrategy } from '@angular/core';
import { nip19 } from 'nostr-tools';
import { ProfileDisplayNameComponent } from '../../user-profile/display-name/profile-display-name.component';
import { LayoutService } from '../../../services/layout.service';

interface ContentPart {
  type: 'text' | 'url' | 'npub' | 'nprofile' | 'note' | 'nevent' | 'naddr';
  content: string;
  pubkey?: string;
  eventId?: string;
  encodedEvent?: string;
  displayUrl?: string;
}

@Component({
  selector: 'app-chat-content',
  imports: [ProfileDisplayNameComponent],
  template: `
    @for (part of parsedContent(); track $index) {
      @if (part.type === 'text') {
        <span>{{ part.content }}</span>
      } @else if (part.type === 'url') {
        <a class="message-link" [href]="part.content" target="_blank" rel="noopener noreferrer">{{ part.displayUrl || part.content }}</a>
      } @else if (part.type === 'npub' || part.type === 'nprofile') {
        <a class="nostr-mention" (click)="onProfileClick($event, part.pubkey!)">@<app-profile-display-name [pubkey]="part.pubkey!" /></a>
      } @else if (part.type === 'note' || part.type === 'nevent') {
        <a class="nostr-event-link" (click)="onEventClick($event, part.eventId!)">📝 note</a>
      } @else if (part.type === 'naddr') {
        <a class="nostr-event-link" (click)="onArticleClick($event, part.encodedEvent!)">📄 article</a>
      }
    }
  `,
  styles: [`
    :host {
      display: inline;
    }

    .message-link {
      color: var(--mat-sys-primary);
      text-decoration: none;
      word-break: break-all;

      &:hover {
        text-decoration: underline;
      }
    }
    
    .nostr-mention {
      color: var(--mat-sys-primary);
      text-decoration: none;
      cursor: pointer;
      
      &:hover {
        text-decoration: underline;
      }
      
      app-profile-display-name {
        display: inline;
      }
    }
    
    .nostr-event-link {
      color: var(--mat-sys-tertiary);
      text-decoration: none;
      padding: 2px 6px;
      background: var(--mat-sys-surface-container-highest);
      border-radius: 4px;
      font-size: 0.85em;
      
      &:hover {
        background: var(--mat-sys-surface-container-high);
        text-decoration: none;
      }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatContentComponent {
  private layout = inject(LayoutService);

  content = input.required<string>();

  // Regex to match nostr URIs and bare NIP-19 identifiers
  private readonly nostrUriRegex = /((?:nostr:)?(?:npub|nprofile|note|nevent|naddr)1(?:(?!(?:npub|nprofile|note|nevent|naddr)1)[a-zA-Z0-9])+)/g;

  // Regex to match http/https URLs
  private readonly urlRegex = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;

  parsedContent = computed<ContentPart[]>(() => {
    const text = this.content();
    if (!text) return [];

    const parts: ContentPart[] = [];
    let lastIndex = 0;

    // Reset regex
    this.nostrUriRegex.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = this.nostrUriRegex.exec(text)) !== null) {
      // Add text before this match
      if (match.index > lastIndex) {
        parts.push({
          type: 'text',
          content: text.substring(lastIndex, match.index),
        });
      }

      // Parse the nostr URI
      const uri = match[0];
      const parsed = this.parseNostrUri(uri);
      if (parsed) {
        parts.push(parsed);
      } else {
        // If parsing failed, treat as text
        parts.push({
          type: 'text',
          content: uri,
        });
      }

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push({
        type: 'text',
        content: text.substring(lastIndex),
      });
    }

    // Second pass: split text parts to extract URLs
    return parts.flatMap((part) => (part.type === 'text' ? this.parseUrls(part.content) : [part]));
  });

  private parseUrls(text: string): ContentPart[] {
    if (!text) return [];

    const parts: ContentPart[] = [];
    let lastIndex = 0;

    this.urlRegex.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = this.urlRegex.exec(text)) !== null) {
      // Add text before this URL
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: text.substring(lastIndex, match.index) });
      }

      // Strip trailing punctuation that likely isn't part of the URL
      let url = match[0];
      const trailingMatch = url.match(/[.,;:!?)]+$/);
      let trailing = '';
      if (trailingMatch) {
        trailing = trailingMatch[0];
        url = url.slice(0, -trailing.length);
      }

      parts.push({
        type: 'url',
        content: url,
        displayUrl: this.truncateUrl(url),
      });

      if (trailing) {
        parts.push({ type: 'text', content: trailing });
      }

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push({ type: 'text', content: text.substring(lastIndex) });
    }

    return parts;
  }

  private truncateUrl(url: string, maxLength = 50): string {
    if (url.length <= maxLength) return url;

    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname;
      const path = urlObj.pathname + urlObj.search;

      if (domain.length + 10 >= maxLength) {
        return domain.slice(0, maxLength - 3) + '...';
      }

      const availablePathLength = maxLength - domain.length - 3;
      if (path.length > availablePathLength) {
        return domain + path.slice(0, availablePathLength) + '...';
      }

      return domain + path;
    } catch {
      return url.slice(0, maxLength - 3) + '...';
    }
  }

  private parseNostrUri(uri: string): ContentPart | null {
    try {
      const decoded = nip19.decode(uri.replace('nostr:', ''));

      switch (decoded.type) {
        case 'npub':
          return {
            type: 'npub',
            content: uri,
            pubkey: decoded.data as string,
          };
        case 'nprofile':
          return {
            type: 'nprofile',
            content: uri,
            pubkey: (decoded.data as nip19.ProfilePointer).pubkey,
          };
        case 'note':
          return {
            type: 'note',
            content: uri,
            eventId: decoded.data as string,
          };
        case 'nevent':
          return {
            type: 'nevent',
            content: uri,
            eventId: (decoded.data as nip19.EventPointer).id,
          };
        case 'naddr': {
          // For naddr, we need to encode it back for the URL
          return {
            type: 'naddr',
            content: uri,
            encodedEvent: uri.replace('nostr:', ''),
          };
        }
        default:
          return null;
      }
    } catch (error) {
      console.warn('Failed to parse nostr URI:', uri, error);
      return null;
    }
  }

  onProfileClick(event: MouseEvent, pubkey: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.layout.openProfile(pubkey);
  }

  onEventClick(event: MouseEvent, eventId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.layout.openGenericEvent(eventId);
  }

  onArticleClick(event: MouseEvent, encodedEvent: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.layout.openArticle(encodedEvent);
  }
}
