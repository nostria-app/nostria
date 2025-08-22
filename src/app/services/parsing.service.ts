import { inject, Injectable } from '@angular/core';
import { DataService } from './data.service';
import { nip19 } from 'nostr-tools';
import type { ProfilePointer } from 'nostr-tools/nip19';
import { NostrService } from './nostr.service';
import { StorageService } from './storage.service';
import type { NostrRecord } from '../interfaces';
import { UtilitiesService } from './utilities.service';
import { LoggerService } from './logger.service';
import type { SafeResourceUrl } from '@angular/platform-browser';
import { MediaPlayerService } from './media-player.service';

export interface NostrData {
  type: string;
  // Narrow known shapes; keep flexible with index signature for unseen fields
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
  displayName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

export interface ContentToken {
  id: number;
  type:
    | 'text'
    | 'url'
    | 'youtube'
    | 'image'
    | 'audio'
    | 'video'
    | 'linebreak'
    | 'nostr-mention'
    | 'emoji';
  content: string;
  nostrData?: NostrData;
  emoji?: string;
  processedUrl?: SafeResourceUrl; // For YouTube embed URLs that are pre-processed
}

@Injectable({
  providedIn: 'root',
})
export class ParsingService {
  data = inject(DataService);
  nostr = inject(NostrService);
  storage = inject(StorageService);
  utilities = inject(UtilitiesService);
  logger = inject(LoggerService);
  readonly media = inject(MediaPlayerService);

  // Cache for parsed nostr URIs to prevent repeated parsing
  private nostrUriCache = new Map<
    string,
    { type: string; data: any; displayName: string } | null
  >();

  // Map to track pending nostr URI parsing to prevent race conditions
  private pendingNostrUriRequests = new Map<
    string,
    Promise<{ type: string; data: any; displayName: string } | null>
  >();

  constructor() {
    // Clean up cache periodically to prevent memory leaks
    setInterval(() => {
      if (this.nostrUriCache.size > 500) {
        this.logger.debug(
          `Parsing service cache size: ${this.nostrUriCache.size}. Consider clearing if too large.`
        );
        // Optionally clear cache if it gets too large
        if (this.nostrUriCache.size > 1000) {
          this.clearNostrUriCache();
          this.logger.info('Cleared nostr URI cache due to size limit');
        }
      }
    }, 60000); // Check every minute
  }

  async parseNostrUri(
    uri: string
  ): Promise<{ type: string; data: any; displayName: string } | null> {
    // Check cache first
    if (this.nostrUriCache.has(uri)) {
      return this.nostrUriCache.get(uri)!;
    }

    // Check if there's already a pending request for this URI
    if (this.pendingNostrUriRequests.has(uri)) {
      return this.pendingNostrUriRequests.get(uri)!;
    }

    // Create and store the promise to prevent race conditions
    const parsePromise = this.parseNostrUriInternal(uri);
    this.pendingNostrUriRequests.set(uri, parsePromise);

    try {
      const result = await parsePromise;
      // Cache the result
      this.nostrUriCache.set(uri, result);
      return result;
    } finally {
      // Always clean up the pending request
      this.pendingNostrUriRequests.delete(uri);
    }
  }

  private async parseNostrUriInternal(
    uri: string
  ): Promise<{ type: string; data: any; displayName: string } | null> {
    try {
      // Use the proper nip19 function for decoding nostr URIs
      const decoded = nip19.decodeNostrURI(uri);

      if (!decoded) return null;

      let displayName = '';
      let pubkey = '';
      let metadata: NostrRecord | undefined;

      if (decoded.type === 'nprofile') {
        pubkey = (decoded.data as ProfilePointer).pubkey;
      } else if (decoded.type === 'npub') {
        pubkey = decoded.data;
      }

      if (pubkey) {
        metadata = await this.data.getProfile(pubkey);

        if (metadata) {
          displayName =
            metadata.data.display_name ||
            metadata.data.name ||
            this.utilities.getTruncatedNpub(pubkey);
        } else {
          // Fallback to truncated pubkey if no metadata found
          displayName = this.utilities.getTruncatedNpub(pubkey);
        }
      } else {
        displayName = this.getDisplayNameFromNostrUri(
          decoded.type,
          decoded.data
        );
      }

      return {
        type: decoded.type,
        data: decoded.data,
        displayName: displayName,
      };
    } catch (error) {
      this.logger.warn(`Failed to parse nostr URI: ${uri}`, error);
      return null;
    }
  }

  private getDisplayNameFromNostrUri(type: string, data: any): string {
    switch (type) {
      case 'npub':
        return this.utilities.getTruncatedNpub(data);
      case 'nprofile':
        return this.utilities.getTruncatedNpub(data.pubkey);
      case 'note':
        return `note${data.substring(0, 8)}...`;
      case 'nevent':
        return `event${data.id.substring(0, 8)}...`;
      case 'naddr':
        return `${data.kind}:${data.identifier?.substring(0, 8) || 'addr'}...`;
      default:
        return type;
    }
  }

  isNostrUri(text: string): boolean {
    return text.startsWith('nostr:') && text.length > 6;
  }

  extractNostrUriIdentifier(uri: string): string {
    return uri.replace(/^nostr:/, '');
  }

  /**
   * Clear the nostr URI cache to free memory
   */
  clearNostrUriCache(): void {
    this.nostrUriCache.clear();
    this.pendingNostrUriRequests.clear();
  }

  /**
   * Get cache size for debugging
   */
  getNostrUriCacheSize(): number {
    return this.nostrUriCache.size;
  }

  private emojiMap: Record<string, string> = {
    ':badge:': '🏅',
    ':heart:': '❤️',
    ':fire:': '🔥',
    ':thumbs_up:': '👍',
    ':thumbs_down:': '👎',
    ':smile:': '😊',
    ':laugh:': '😂',
    ':cry:': '😢',
    ':angry:': '😠',
    ':confused:': '😕',
    ':surprised:': '😮',
    ':wink:': '😉',
    ':cool:': '😎',
    ':kiss:': '😘',
    ':heart_eyes:': '😍',
    ':thinking:': '🤔',
    ':clap:': '👏',
    ':pray:': '🙏',
    ':muscle:': '💪',
    ':ok_hand:': '👌',
    ':wave:': '👋',
    ':point_right:': '👉',
    ':point_left:': '👈',
    ':point_up:': '👆',
    ':point_down:': '👇',
    ':rocket:': '🚀',
    ':star:': '⭐',
    ':lightning:': '⚡',
    ':sun:': '☀️',
    ':moon:': '🌙',
    ':rainbow:': '🌈',
    ':coffee:': '☕',
    ':beer:': '🍺',
    ':wine:': '🍷',
    ':pizza:': '🍕',
    ':burger:': '🍔',
    ':cake:': '🎂',
    ':party:': '🎉',
    ':gift:': '🎁',
    ':music:': '🎵',
    ':note:': '🎶',
    ':phone:': '📱',
    ':computer:': '💻',
    ':email:': '📧',
    ':lock:': '🔒',
    ':unlock:': '🔓',
    ':key:': '🔑',
    ':money:': '💰',
    ':dollar:': '💵',
    ':euro:': '💶',
    ':yen:': '💴',
    ':pound:': '💷',
    ':gem:': '💎',
    ':crown:': '👑',
    ':trophy:': '🏆',
    ':medal:': '🏅',
    ':first_place:': '🥇',
    ':second_place:': '🥈',
    ':third_place:': '🥉',
    ':checkmark:': '✅',
    ':cross:': '❌',
    ':warning:': '⚠️',
    ':stop:': '🛑',
    ':green_circle:': '🟢',
    ':red_circle:': '🔴',
    ':yellow_circle:': '🟡',
    ':blue_circle:': '🔵',
    ':purple_circle:': '🟣',
    ':orange_circle:': '🟠',
    ':white_circle:': '⚪',
    ':black_circle:': '⚫',
  };

  async parseContent(content: string): Promise<ContentToken[]> {
    if (!content) return [];

    // Replace line breaks with placeholders
    const processedContent = content.replace(/\n/g, '##LINEBREAK##');

    // Regex for different types of content - updated to avoid capturing trailing LINEBREAK placeholders
    // URL regex: capture potential trailing punctuation so we can trim logic-smart (e.g. parentheses, commas, periods)
    const urlRegex =
      /(https?:\/\/[^\s##)\]\}>]+)(?=\s|##LINEBREAK##|$|[),.;!?:])/g;
    const youtubeRegex =
      /(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})(?=\s|##LINEBREAK##|$)/g;
    const imageRegex =
      /(https?:\/\/[^\s##]+\.(jpg|jpeg|png|gif|webp)(\?[^\s##]*)?(?=\s|##LINEBREAK##|$))/gi;
    const audioRegex =
      /(https?:\/\/[^\s##]+\.(mp3|wav|ogg)(\?[^\s##]*)?(?=\s|##LINEBREAK##|$))/gi;
    const videoRegex =
      /(https?:\/\/[^\s##]+\.(mp4|webm|mov|avi|wmv|flv|mkv)(\?[^\s##]*)?(?=\s|##LINEBREAK##|$))/gi;
    const nostrRegex =
      /(nostr:(?:npub|nprofile|note|nevent|naddr)1[a-zA-Z0-9]+)(?=\s|##LINEBREAK##|$|[^\w])/g;
    const emojiRegex = /(:[a-zA-Z_]+:)/g;

    // Split content and generate tokens
    const tokens: ContentToken[] = [];
    let lastIndex = 0;

    // Find all matches and their positions
    const matches: {
      start: number;
      end: number;
      content: string;
      type: ContentToken['type'];
      nostrData?: NostrData;
      emoji?: string;
      processedUrl?: SafeResourceUrl;
    }[] = [];

    // Find emoji codes first (highest priority after nostr)
    let match: RegExpExecArray | null;
    while ((match = emojiRegex.exec(processedContent)) !== null) {
      const emojiCode = match[0];
      const emoji = this.emojiMap[emojiCode];
      if (emoji) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          content: emojiCode,
          type: 'emoji',
          emoji,
        });
      }
    }

    // Find Nostr URIs (highest priority) - collect first, then batch process
    const nostrMatches: {
      match: RegExpExecArray;
      index: number;
      length: number;
    }[] = [];
    while ((match = nostrRegex.exec(processedContent)) !== null) {
      nostrMatches.push({
        match,
        index: match.index,
        length: match[0].length,
      });
    }

    // Batch process nostr URIs to avoid sequential awaits
    const nostrDataPromises = nostrMatches.map(async nostrMatch => {
      try {
        const nostrData = await this.parseNostrUri(nostrMatch.match[0]);
        return {
          ...nostrMatch,
          nostrData,
        };
      } catch (error) {
        console.warn('Error parsing nostr URI:', nostrMatch.match[0], error);
        return {
          ...nostrMatch,
          nostrData: null,
        };
      }
    });

    // Wait for all nostr URIs to be processed
    const processedNostrMatches = await Promise.all(nostrDataPromises);

    // Add valid nostr matches to the matches array
    for (const { match, index, length, nostrData } of processedNostrMatches) {
      if (nostrData) {
        matches.push({
          start: index,
          end: index + length,
          content: match[0],
          type: 'nostr-mention',
          nostrData,
        });
      }
    }

    // Find YouTube URLs
    while ((match = youtubeRegex.exec(processedContent)) !== null) {
      // Pre-process the YouTube URL to avoid repeated calls in template
      const youtubeUrl = match[0];
      const processedUrl = this.media.getYouTubeEmbedUrl()(youtubeUrl);

      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: youtubeUrl,
        type: 'youtube',
        processedUrl: processedUrl,
      });
    }

    // Find image URLs
    imageRegex.lastIndex = 0;
    while ((match = imageRegex.exec(processedContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[0],
        type: 'image',
      });
    }

    // Find video URLs
    videoRegex.lastIndex = 0;
    while ((match = videoRegex.exec(processedContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[0],
        type: 'video',
      });
    }

    // Find audio URLs
    audioRegex.lastIndex = 0;
    while ((match = audioRegex.exec(processedContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[0],
        type: 'audio',
      });
    }

    // Find remaining URLs
    urlRegex.lastIndex = 0;
    while ((match = urlRegex.exec(processedContent)) !== null) {
      let rawUrl = match[0];
      const start = match.index;

      // Trim trailing punctuation that is unlikely part of the URL
      const trailingPattern = /[)\],;!?.]+$/;
      while (trailingPattern.test(rawUrl)) {
        const lastChar = rawUrl.slice(-1);
        if (lastChar === '/' || lastChar === '#') break; // keep structural chars
        if (lastChar === ')') {
          const openCount = (rawUrl.match(/\(/g) || []).length;
          const closeCount = (rawUrl.match(/\)/g) || []).length;
          if (closeCount <= openCount) break;
        }
        if (lastChar === ']') {
          const openCount = (rawUrl.match(/\[/g) || []).length;
          const closeCount = (rawUrl.match(/\]/g) || []).length;
          if (closeCount <= openCount) break;
        }
        rawUrl = rawUrl.slice(0, -1);
      }

      if (!rawUrl) continue;

      const isSpecialType = matches.some(
        m => m.start === start && m.end === start + rawUrl.length
      );
      if (!isSpecialType) {
        matches.push({
          start,
          end: start + rawUrl.length,
          content: rawUrl,
          type: 'url',
        });
      }
    }

    // Sort matches by their starting position
    matches.sort((a, b) => a.start - b.start);

    // Process text segments and matches with deterministic IDs
    for (const match of matches) {
      // Add text segment before the match
      if (match.start > lastIndex) {
        const textSegment = processedContent.substring(lastIndex, match.start);
        this.processTextSegment(textSegment, tokens, lastIndex);
      }

      // Add the match as a token with deterministic ID based on position and content
      const tokenId = this.generateStableTokenId(
        match.start,
        match.content,
        match.type
      );
      const token: ContentToken = {
        id: tokenId,
        type: match.type,
        content: match.content,
      };

      if (match.nostrData) {
        token.nostrData = match.nostrData;
      }

      if (match.emoji) {
        token.emoji = match.emoji;
      }

      if (match.processedUrl) {
        token.processedUrl = match.processedUrl;
      }

      tokens.push(token);

      lastIndex = match.end;
    }

    // Add remaining text after the last match
    if (lastIndex < processedContent.length) {
      const textSegment = processedContent.substring(lastIndex);
      this.processTextSegment(textSegment, tokens, lastIndex);
    }

    return tokens;
  }
  private processTextSegment(
    segment: string,
    tokens: ContentToken[],
    basePosition: number
  ): void {
    // Process line breaks in text segments
    const parts = segment.split('##LINEBREAK##');

    for (let i = 0; i < parts.length; i++) {
      // Only add text token if there's actual content (not empty string)
      if (parts[i].trim()) {
        const tokenId = this.generateStableTokenId(
          basePosition + i,
          parts[i].trim(),
          'text'
        );
        tokens.push({
          id: tokenId,
          type: 'text',
          content: parts[i].trim(),
        });
      }

      // Add a line break token after each part except the last one
      if (i < parts.length - 1) {
        const linebreakId = this.generateStableTokenId(
          basePosition + i,
          '',
          'linebreak'
        );
        tokens.push({
          id: linebreakId,
          type: 'linebreak',
          content: '',
        });
      }
    }
  }

  /**
   * Generate a stable token ID based on position and content
   */
  private generateStableTokenId(
    position: number,
    content: string,
    type: string
  ): number {
    // Create a simple hash from position, content, and type
    let hash = 0;
    const str = `${position}-${type}-${content}`;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}
