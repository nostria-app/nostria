import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Event as NostrEvent, nip19 } from 'nostr-tools';
import { ContentToken } from '../../services/parsing.service';
import { DataService } from '../../services/data.service';
import { UtilitiesService } from '../../services/utilities.service';

/**
 * Lightweight content renderer for poll descriptions.
 * Handles text, nostr mentions (npub/nprofile), URLs, images, hashtags, and linebreaks.
 * Does NOT embed full events (nevent/note/naddr) to avoid circular dependency
 * with NoteContentComponent which imports PollEventComponent.
 */
@Component({
  selector: 'app-poll-content',
  imports: [RouterLink],
  template: `
    @for (token of contentTokens(); track token.id) {
      @switch (token.type) {
        @case ('text') {
          <span>{{ token.content }}</span>
        }
        @case ('linebreak') {
          <br />
        }
        @case ('url') {
          <a [href]="token.content" target="_blank" rel="noopener noreferrer" class="url-link">{{ token.content }}</a>
        }
        @case ('image') {
          <div class="poll-image-container">
            <img [src]="token.content" alt="Poll image" loading="lazy" class="poll-image" />
          </div>
        }
        @case ('hashtag') {
          <a class="hashtag-link" [routerLink]="['/t', token.content]">#{{ token.content }}</a>
        }
        @case ('nostr-mention') {
          @if (token.nostrData; as nostrData) {
            @if (nostrData.type === 'npub' || nostrData.type === 'nprofile') {
              <a class="nostr-mention" [routerLink]="['/p', nostrData.data?.pubkey || nostrData.data]">@{{ resolvedName(nostrData.data?.pubkey || nostrData.data) }}</a>
            } @else {
              <a class="nostr-mention" [href]="'nostr:' + token.content">{{ nostrData.displayName || token.content }}</a>
            }
          } @else {
            <span>{{ token.content }}</span>
          }
        }
        @default {
          <span>{{ token.content }}</span>
        }
      }
    }
  `,
  styles: [`
    :host {
      display: inline;
    }
    .url-link {
      color: var(--mat-sys-primary);
      text-decoration: none;
      word-break: break-all;
      &:hover {
        text-decoration: underline;
      }
    }
    .hashtag-link {
      color: var(--mat-sys-primary);
      text-decoration: none;
      &:hover {
        text-decoration: underline;
      }
    }
    .nostr-mention {
      color: var(--mat-sys-primary);
      text-decoration: none;
      &:hover {
        text-decoration: underline;
      }
    }
    .poll-image-container {
      display: block;
      margin: 8px 0;
    }
    .poll-image {
      max-width: 100%;
      max-height: 400px;
      border-radius: 8px;
      object-fit: contain;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PollContentComponent {
  private data = inject(DataService);
  private utilities = inject(UtilitiesService);

  content = input<string>('');
  event = input<NostrEvent | null>(null);

  /** Map of pubkey → resolved display name */
  private profileNames = signal<Map<string, string>>(new Map());

  contentTokens = computed(() => {
    const content = this.content();
    if (!content) return [] as ContentToken[];
    return this.parseContentSimple(content);
  });

  constructor() {
    effect(() => {
      const tokens = this.contentTokens();
      const pubkeys: string[] = [];

      for (const token of tokens) {
        if (token.type === 'nostr-mention' && token.nostrData) {
          const nd = token.nostrData as { type: string; data: unknown };
          let pubkey: string | undefined;
          if (nd.type === 'npub') {
            pubkey = nd.data as string;
          } else if (nd.type === 'nprofile') {
            pubkey = (nd.data as { pubkey: string }).pubkey;
          }
          if (pubkey && !pubkeys.includes(pubkey)) {
            pubkeys.push(pubkey);
          }
        }
      }

      if (pubkeys.length > 0) {
        this.resolveProfiles(pubkeys);
      }
    });
  }

  /** Get resolved display name for a pubkey, falling back to truncated npub */
  resolvedName(pubkey: string): string {
    return this.profileNames().get(pubkey) || this.utilities.getTruncatedNpub(pubkey);
  }

  private async resolveProfiles(pubkeys: string[]): Promise<void> {
    const nameMap = new Map<string, string>(this.profileNames());

    await Promise.all(
      pubkeys.map(async (pubkey) => {
        try {
          const profile = await this.data.getProfile(pubkey);
          if (profile) {
            const name = profile.data.display_name || profile.data.name || this.utilities.getTruncatedNpub(pubkey);
            nameMap.set(pubkey, name);
          } else {
            nameMap.set(pubkey, this.utilities.getTruncatedNpub(pubkey));
          }
        } catch {
          nameMap.set(pubkey, this.utilities.getTruncatedNpub(pubkey));
        }
      })
    );

    this.profileNames.set(nameMap);
  }

  /**
   * Simplified synchronous content parsing for poll descriptions.
   * Uses regex to split content into basic token types.
   */
  private parseContentSimple(content: string): ContentToken[] {
    const tokens: ContentToken[] = [];
    let id = 0;
    const lines = content.split('\n');

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      if (lineIdx > 0) {
        tokens.push({ id: id++, type: 'linebreak', content: '\n' });
      }

      const line = lines[lineIdx];
      let lineLastIndex = 0;
      const linePattern = /(?:nostr:)?(npub1[a-z0-9]{58,}|nprofile1[a-z0-9]+|nevent1[a-z0-9]+|note1[a-z0-9]+|naddr1[a-z0-9]+)|(https?:\/\/[^\s}\]>"]+?)(?=\s|$|[,;!?]\s|[,;!?]$|")|(?:^|\s)#([a-zA-Z0-9_]+)/gm;

      let match: RegExpExecArray | null;
      while ((match = linePattern.exec(line)) !== null) {
        // Add text before the match
        if (match.index > lineLastIndex) {
          const textBefore = line.substring(lineLastIndex, match.index);
          if (textBefore) {
            tokens.push({ id: id++, type: 'text', content: textBefore });
          }
        }

        if (match[1]) {
          // Nostr mention
          const bech32 = match[1];
          const nostrData = this.decodeNostrMention(bech32);
          tokens.push({
            id: id++,
            type: 'nostr-mention',
            content: bech32,
            nostrData,
          });
        } else if (match[2]) {
          // URL
          const url = match[2];
          const isImage = /\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?.*)?$/i.test(url);
          tokens.push({
            id: id++,
            type: isImage ? 'image' : 'url',
            content: url,
          });
        } else if (match[3]) {
          // Hashtag - the match may include leading whitespace
          const fullMatch = match[0];
          const hashtag = match[3];
          const leadingSpace = fullMatch.substring(0, fullMatch.indexOf('#'));
          if (leadingSpace) {
            tokens.push({ id: id++, type: 'text', content: leadingSpace });
          }
          tokens.push({ id: id++, type: 'hashtag', content: hashtag });
        }

        lineLastIndex = match.index + match[0].length;
      }

      // Add remaining text
      if (lineLastIndex < line.length) {
        tokens.push({ id: id++, type: 'text', content: line.substring(lineLastIndex) });
      }
    }

    return tokens;
  }

  private decodeNostrMention(bech32: string): { type: string; displayName: string; data: unknown } | undefined {
    try {
      const decoded = nip19.decode(bech32);
      if (!decoded) return undefined;

      const type = decoded.type;
      const data = decoded.data;

      let displayName = bech32.substring(0, 12) + '...';
      if (type === 'npub') {
        displayName = (data as string).substring(0, 8) + '...';
      } else if (type === 'nprofile') {
        const profile = data as { pubkey: string; relays?: string[] };
        displayName = profile.pubkey.substring(0, 8) + '...';
      }

      return { type, displayName, data };
    } catch {
      return undefined;
    }
  }
}
