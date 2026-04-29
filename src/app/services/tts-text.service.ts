import { Injectable, inject } from '@angular/core';
import { nip19, type Event } from 'nostr-tools';
import { ParsingService, type ContentToken } from './parsing.service';
import { extractTextForTts, splitTtsParagraphs } from '../utils/tts-text';

export interface TtsReadableText {
  text: string;
  paragraphs: string[];
}

@Injectable({ providedIn: 'root' })
export class TtsTextService {
  private readonly parsing = inject(ParsingService);

  async fromEvent(event: Event): Promise<TtsReadableText> {
    const expandedContent = this.expandIndexedProfileReferences(event.content, event.tags);

    try {
      const parsed = await this.parsing.parseContent(expandedContent, event.tags, event.pubkey);
      const tokens = await this.resolvePendingMentionTokens(parsed.tokens, parsed.pendingMentions);
      const text = this.tokensToSpeechText(tokens) || extractTextForTts(event.content);
      return {
        text,
        paragraphs: splitTtsParagraphs(text),
      };
    } catch {
      const text = extractTextForTts(event.content);
      return {
        text,
        paragraphs: splitTtsParagraphs(event.content),
      };
    }
  }

  private expandIndexedProfileReferences(content: string, tags: string[][]): string {
    return content.replace(/#\[(\d+)\]/g, (match, indexText: string) => {
      const tag = tags[Number.parseInt(indexText, 10)];
      if (tag?.[0] !== 'p' || !tag[1]) {
        return match;
      }

      try {
        return `nostr:${nip19.npubEncode(tag[1])}`;
      } catch {
        return match;
      }
    });
  }

  private tokensToSpeechText(tokens: ContentToken[]): string {
    const text = tokens.map(token => this.tokenToSpeechText(token)).join('');
    return text
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private async resolvePendingMentionTokens(
    tokens: ContentToken[],
    pendingMentions: { tokenId: number; promise: Promise<ContentToken['nostrData'] | null> }[],
  ): Promise<ContentToken[]> {
    if (pendingMentions.length === 0) {
      return tokens;
    }

    const resolvedMentions = await Promise.all(
      pendingMentions.map(async pending => ({
        tokenId: pending.tokenId,
        nostrData: await pending.promise,
      })),
    );
    const nostrDataByTokenId = new Map(
      resolvedMentions
        .filter(mention => !!mention.nostrData)
        .map(mention => [mention.tokenId, mention.nostrData]),
    );

    return tokens.map(token => {
      const nostrData = nostrDataByTokenId.get(token.id);
      return nostrData ? { ...token, nostrData } : token;
    });
  }

  private tokenToSpeechText(token: ContentToken): string {
    switch (token.type) {
      case 'text':
        return token.content;
      case 'linebreak':
        return '\n';
      case 'hashtag':
        return `#${token.content}`;
      case 'emoji':
        return token.emoji ?? token.content;
      case 'nostr-mention':
        if (token.nostrData?.type === 'npub' || token.nostrData?.type === 'nprofile') {
          return `@${token.nostrData.displayName}`;
        }
        return '';
      default:
        return '';
    }
  }
}
