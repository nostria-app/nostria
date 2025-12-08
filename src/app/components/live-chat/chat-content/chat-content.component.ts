import { Component, input, inject, computed, ChangeDetectionStrategy } from '@angular/core';
import { RouterModule } from '@angular/router';
import { nip19 } from 'nostr-tools';
import { UtilitiesService } from '../../../services/utilities.service';
import { ProfileDisplayNameComponent } from '../../user-profile/display-name/profile-display-name.component';

interface ContentPart {
  type: 'text' | 'npub' | 'nprofile' | 'note' | 'nevent' | 'naddr';
  content: string;
  pubkey?: string;
  eventId?: string;
  encodedEvent?: string;
}

@Component({
  selector: 'app-chat-content',
  imports: [RouterModule, ProfileDisplayNameComponent],
  template: `
    @for (part of parsedContent(); track $index) {
      @if (part.type === 'text') {
        <span>{{ part.content }}</span>
      } @else if (part.type === 'npub' || part.type === 'nprofile') {
        <a class="nostr-mention" [routerLink]="['/p', part.pubkey]">@<app-profile-display-name [pubkey]="part.pubkey!" /></a>
      } @else if (part.type === 'note' || part.type === 'nevent') {
        <a class="nostr-event-link" [routerLink]="['/e', part.eventId]">📝 note</a>
      } @else if (part.type === 'naddr') {
        <a class="nostr-event-link" [routerLink]="['/a', part.encodedEvent]">📄 article</a>
      }
    }
  `,
  styles: [`
    :host {
      display: inline;
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
  private utilities = inject(UtilitiesService);

  content = input.required<string>();

  // Regex to match nostr URIs
  private readonly nostrUriRegex = /(nostr:(?:npub|nprofile|note|nevent|naddr)1[a-zA-Z0-9]+)/g;

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

    return parts;
  });

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
}
