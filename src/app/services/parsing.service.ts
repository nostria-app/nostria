import { inject, Injectable } from '@angular/core';
import { DataService } from './data.service';
import { nip19 } from 'nostr-tools';
import type { ProfilePointer } from 'nostr-tools/nip19';
import { NostrService } from './nostr.service';
import type { NostrRecord } from '../interfaces';
import { UtilitiesService } from './utilities.service';
import { LoggerService } from './logger.service';
import type { SafeResourceUrl } from '@angular/platform-browser';
import { MediaPlayerService } from './media-player.service';
import { getDecodedToken } from '@cashu/cashu-ts';
import { EmojiSetService } from './emoji-set.service';

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
  | 'emoji'
  | 'base64-image'
  | 'base64-audio'
  | 'base64-video'
  | 'cashu'
  | 'hashtag'
  | 'rss-feed'
  | 'bolt12';
  content: string;
  nostrData?: NostrData;
  emoji?: string;
  customEmoji?: string; // NIP-30: URL to custom emoji image
  processedUrl?: SafeResourceUrl; // For YouTube embed URLs that are pre-processed
  waveform?: number[];
  duration?: number;
  // Media metadata from imeta tags
  blurhash?: string;
  thumbhash?: string;
  thumbnail?: string;
  dimensions?: { width: number; height: number };
  cashuData?: {
    token: string;
    mint?: string;
    amount?: number;
    unit?: string;
  };
  bolt12Data?: {
    offer: string;
    type: 'offer' | 'invoice';
  };
}

@Injectable({
  providedIn: 'root',
})
export class ParsingService {
  data = inject(DataService);
  nostr = inject(NostrService);
  utilities = inject(UtilitiesService);
  logger = inject(LoggerService);
  readonly media = inject(MediaPlayerService);
  private emojiSetService = inject(EmojiSetService);

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

      if (!decoded) {
        this.logger.debug(`Failed to decode nostr URI: ${uri}`);
        return null;
      }

      let displayName = '';
      let pubkey = '';
      let metadata: NostrRecord | undefined;

      // Handle both npub and nprofile types
      if (decoded.type === 'nprofile') {
        pubkey = (decoded.data as ProfilePointer).pubkey;
      } else if (decoded.type === 'npub') {
        pubkey = decoded.data;
      }

      if (pubkey) {
        // Fetch profile metadata to get display name
        metadata = await this.data.getProfile(pubkey);

        if (metadata) {
          displayName =
            metadata.data.display_name ||
            metadata.data.name ||
            this.utilities.getTruncatedNpub(pubkey);
          this.logger.debug(`Found profile for ${pubkey.substring(0, 8)}...: ${displayName}`);
        } else {
          // Fallback to truncated pubkey if no metadata found
          displayName = this.utilities.getTruncatedNpub(pubkey);
          this.logger.debug(`No profile found for ${pubkey.substring(0, 8)}..., using truncated npub: ${displayName}`);
        }
      } else {
        displayName = this.getDisplayNameFromNostrUri(decoded.type, decoded.data);
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

  async parseContent(content: string, tags?: string[][], authorPubkey?: string): Promise<ContentToken[]> {
    if (!content) return [];

    // Replace line breaks with placeholders
    const processedContent = content.replace(/\n/g, '##LINEBREAK##');

    // Regex for different types of content - updated to avoid capturing trailing LINEBREAK placeholders
    // URL regex: matches http/https URLs, allows #, :, ., and () in the URL path
    // Parentheses are allowed to support URL-encoded text fragments and Wikipedia-style URLs
    // Trailing punctuation (including unbalanced parens) is handled by post-processing cleanup
    // Stops at whitespace, LINEBREAK markers, quotes, or common trailing punctuation
    const urlRegex = /(https?:\/\/[^\s}\]>"]+?)(?=\s|##LINEBREAK##|$|[,;!?]\s|[,;!?]$|")/g;
    const youtubeRegex =
      /(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})(?=\s|##LINEBREAK##|$)/g;
    const imageRegex =
      /(https?:\/\/[^\s##]+\.(jpg|jpeg|png|gif|webp)(\?[^\s##]*)?(?=\s|##LINEBREAK##|$))/gi;
    const audioRegex = /(https?:\/\/[^\s##]+\.(mp3|mpga|mp2|wav|ogg|oga|opus|m4a|aac|flac|weba)(\?[^\s##]*)?(?=\s|##LINEBREAK##|$))/gi;
    const videoRegex =
      /(https?:\/\/[^\s##]+\.(mp4|webm|mov|avi|wmv|flv|mkv|qt)(\?[^\s##]*)?(?=\s|##LINEBREAK##|$))/gi;
    const nostrRegex =
      /(nostr:(?:npub|nprofile|note|nevent|naddr)1[a-zA-Z0-9]+)(?=\s|##LINEBREAK##|$|[^\w])/g;
    // NIP-30: emoji shortcodes must be alphanumeric characters and underscores only
    const emojiRegex = /(:[a-zA-Z0-9_]+:)/g;
    // Cashu regex: matches cashuA or cashuB tokens, which can span multiple lines
    // Must handle tokens that may be split across linebreaks or continue on same line
    const cashuRegex = /(cashu[AB][a-zA-Z0-9+/=_-]+)/g;
    // Hashtag regex: matches hashtags starting with # followed by word characters
    // Must handle hashtags at start of string, after whitespace, or after linebreak markers
    const hashtagRegex = /(?:^|[\s]|##LINEBREAK##)#([\w\u0080-\uFFFF]+)/g;

    // Base64 data URL regex - matches data URLs for images, audio, and video
    const base64ImageRegex = /(data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+)(?=\s|##LINEBREAK##|$)/g;
    const base64AudioRegex = /(data:audio\/[a-zA-Z0-9]+;base64,[A-Za-z0-9+/=]+)(?=\s|##LINEBREAK##|$)/g;
    const base64VideoRegex = /(data:video\/[a-zA-Z0-9]+;base64,[A-Za-z0-9+/=]+)(?=\s|##LINEBREAK##|$)/g;

    // RSS feed URL regex - matches URLs containing rss.xml, .rss, feed.xml, /feed/, or /rss/
    // Supports both with and without https:// prefix (e.g., podcast.example.com/rss.xml)
    const rssFeedRegex = /((?:https?:\/\/)?[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+(?:\/[^\s##"<>]*)?(?:rss\.xml|\.rss|feed\.xml|\/feed(?:\/|$)|\/rss(?:\/|$)|atom\.xml|\.atom))(?=\s|##LINEBREAK##|$|[),;!?])/gi;

    // BOLT12 regex - matches lightning offers (lno1...) and invoices (lni1...)
    // BOLT12 offers start with "lno1" and invoices start with "lni1"
    // They use bech32 encoding with only lowercase letters and digits (no 1, b, i, o)
    const bolt12Regex = /(ln[oi]1[ac-hj-np-z02-9]+)(?=\s|##LINEBREAK##|$|[),;!?])/gi;

    // Split content and generate tokens
    const tokens: ContentToken[] = [];
    let lastIndex = 0;

    // Extract custom emojis from tags according to NIP-30
    // Format: ["emoji", <shortcode>, <image-url>]
    const customEmojiMap = new Map<string, string>();
    if (tags) {
      for (const tag of tags) {
        if (tag[0] === 'emoji' && tag[1] && tag[2]) {
          // Store as :shortcode: -> image-url
          customEmojiMap.set(`:${tag[1]}:`, tag[2]);
        }
      }
    }

    // Note: We DON'T fetch user emoji sets here anymore to avoid performance issues.
    // User emoji sets are only needed for reactions (handled by ReactionButtonComponent)
    // and for rendering emoji set events themselves.
    // Regular content should use inline emoji tags only.

    // Find all matches and their positions
    const matches: {
      start: number;
      end: number;
      content: string;
      type: ContentToken['type'];
      nostrData?: NostrData;
      emoji?: string;
      customEmoji?: string; // NIP-30: URL to custom emoji image
      processedUrl?: SafeResourceUrl;
      waveform?: number[];
      duration?: number;
      blurhash?: string;
      thumbhash?: string;
      thumbnail?: string;
      dimensions?: { width: number; height: number };
      cashuData?: {
        token: string;
        mint?: string;
        amount?: number;
        unit?: string;
      };
      bolt12Data?: {
        offer: string;
        type: 'offer' | 'invoice';
      };
    }[] = [];

    // Find emoji codes first (highest priority after nostr)
    // Updated regex to match NIP-30: alphanumeric characters and underscores only
    let match: RegExpExecArray | null;
    while ((match = emojiRegex.exec(processedContent)) !== null) {
      const emojiCode = match[0];
      // Check custom emoji from tags first (NIP-30)
      const customEmojiUrl = customEmojiMap.get(emojiCode);
      // Fallback to built-in emoji map
      const emoji = this.emojiMap[emojiCode];
      if (customEmojiUrl || emoji) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          content: emojiCode,
          type: 'emoji',
          emoji: emoji, // Unicode emoji (if available)
          customEmoji: customEmojiUrl, // Custom emoji URL (NIP-30)
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

    // Batch process nostr URIs with a short timeout to balance speed and completeness
    const nostrDataPromises = nostrMatches.map(async nostrMatch => {
      try {
        // Add timeout protection (800ms per URI) for quick loading
        const timeoutPromise = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), 800)
        );

        const nostrDataPromise = this.parseNostrUri(nostrMatch.match[0]);
        const nostrData = await Promise.race([nostrDataPromise, timeoutPromise]);

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

    // Wait for all nostr URIs to complete (each has its own timeout)
    const processedNostrMatches = await Promise.all(nostrDataPromises);

    // Add all nostr matches to the matches array (with or without resolved data)
    for (const { match, index, length, nostrData } of processedNostrMatches) {
      matches.push({
        start: index,
        end: index + length,
        content: match[0],
        type: 'nostr-mention',
        nostrData: nostrData || undefined,
      });
    }

    // Find Cashu tokens (ecash)
    cashuRegex.lastIndex = 0;
    while ((match = cashuRegex.exec(processedContent)) !== null) {
      try {
        const tokenString = match[0];
        const decoded = getDecodedToken(tokenString);

        // Calculate total amount from all proofs
        const totalAmount = decoded.proofs.reduce((sum: number, proof: { amount: number }) => sum + proof.amount, 0);

        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          content: tokenString,
          type: 'cashu',
          cashuData: {
            token: tokenString,
            mint: decoded.mint,
            amount: totalAmount,
            unit: decoded.unit || 'sat',
          },
        });
      } catch (error) {
        console.warn('Error parsing cashu token:', match[0], error);
        // If parsing fails, treat it as regular text
      }
    }

    // Find BOLT12 offers and invoices
    bolt12Regex.lastIndex = 0;
    while ((match = bolt12Regex.exec(processedContent)) !== null) {
      const bolt12String = match[0].toLowerCase();
      // Determine if it's an offer (lno1) or invoice (lni1)
      const bolt12Type: 'offer' | 'invoice' = bolt12String.startsWith('lno1') ? 'offer' : 'invoice';

      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: bolt12String,
        type: 'bolt12',
        bolt12Data: {
          offer: bolt12String,
          type: bolt12Type,
        },
      });
    }

    // Find hashtags
    hashtagRegex.lastIndex = 0;
    while ((match = hashtagRegex.exec(processedContent)) !== null) {
      const fullMatch = match[0];
      const hashtag = match[1]; // The captured group without the #
      // Calculate the actual start position of the hashtag (excluding leading whitespace/linebreak marker)
      // fullMatch could be "#tag", " #tag", or "##LINEBREAK###tag"
      const hashtagWithHash = '#' + hashtag;
      const hashtagStart = match.index + fullMatch.indexOf(hashtagWithHash);
      matches.push({
        start: hashtagStart,
        end: hashtagStart + hashtagWithHash.length,
        content: hashtag, // Store just the tag text without #
        type: 'hashtag',
      });
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
      const url = match[0];
      let blurhash: string | undefined;
      let thumbhash: string | undefined;
      let dimensions: { width: number; height: number } | undefined;

      // Check for imeta tag with matching URL
      if (tags) {
        const imeta = tags.find(t => t[0] === 'imeta' && t.some(v => v.startsWith('url ') && v.substring(4) === url));
        if (imeta) {
          // Extract blurhash
          const blurhashTag = imeta.find(v => v.startsWith('blurhash '));
          if (blurhashTag) {
            blurhash = blurhashTag.substring(9);
          }
          // Extract thumbhash
          const thumbhashTag = imeta.find(v => v.startsWith('thumbhash '));
          if (thumbhashTag) {
            thumbhash = thumbhashTag.substring(10);
          }
          // Extract dimensions
          const dimTag = imeta.find(v => v.startsWith('dim '));
          if (dimTag) {
            const dimValue = dimTag.substring(4);
            const dimMatch = dimValue.match(/(\d+)x(\d+)/);
            if (dimMatch) {
              dimensions = {
                width: parseInt(dimMatch[1], 10),
                height: parseInt(dimMatch[2], 10)
              };
            }
          }
        }
      }

      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: url,
        type: 'image',
        blurhash,
        thumbhash,
        dimensions
      });
    }

    // Find base64 images
    base64ImageRegex.lastIndex = 0;
    while ((match = base64ImageRegex.exec(processedContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[0],
        type: 'base64-image',
      });
    }

    // Find video URLs
    videoRegex.lastIndex = 0;
    while ((match = videoRegex.exec(processedContent)) !== null) {
      const url = match[0];
      let type: 'video' | 'audio' = 'video';
      let waveform: number[] | undefined;
      let duration: number | undefined;
      let blurhash: string | undefined;
      let thumbhash: string | undefined;
      let thumbnail: string | undefined;
      let dimensions: { width: number; height: number } | undefined;

      if (tags) {
        const imeta = tags.find(t => t[0] === 'imeta' && t.some(v => v.startsWith('url ') && v.substring(4) === url));
        if (imeta) {
          const waveformTag = imeta.find(v => v.startsWith('waveform '));
          if (waveformTag) {
            waveform = waveformTag.substring(9).split(' ').map(Number);
            type = 'audio'; // Treat as audio if waveform is present
          }
          const durationTag = imeta.find(v => v.startsWith('duration '));
          if (durationTag) {
            duration = Number(durationTag.substring(9));
          }
          // Extract blurhash
          const blurhashTag = imeta.find(v => v.startsWith('blurhash '));
          if (blurhashTag) {
            blurhash = blurhashTag.substring(9);
          }
          // Extract thumbhash
          const thumbhashTag = imeta.find(v => v.startsWith('thumbhash '));
          if (thumbhashTag) {
            thumbhash = thumbhashTag.substring(10);
          }
          // Extract thumbnail image URL
          const imageTag = imeta.find(v => v.startsWith('image '));
          if (imageTag) {
            thumbnail = imageTag.substring(6);
          }
          // Extract dimensions
          const dimTag = imeta.find(v => v.startsWith('dim '));
          if (dimTag) {
            const dimValue = dimTag.substring(4);
            const dimMatch = dimValue.match(/(\d+)x(\d+)/);
            if (dimMatch) {
              dimensions = {
                width: parseInt(dimMatch[1], 10),
                height: parseInt(dimMatch[2], 10)
              };
            }
          }
        }
      }

      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: url,
        type: type,
        waveform,
        duration,
        blurhash,
        thumbhash,
        thumbnail,
        dimensions
      });
    }

    // Find base64 videos
    base64VideoRegex.lastIndex = 0;
    while ((match = base64VideoRegex.exec(processedContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[0],
        type: 'base64-video',
      });
    }

    // Find audio URLs
    audioRegex.lastIndex = 0;
    while ((match = audioRegex.exec(processedContent)) !== null) {
      const url = match[0];
      let waveform: number[] | undefined;
      let duration: number | undefined;

      if (tags) {
        // Look for imeta tag matching this URL
        // imeta tag format: ["imeta", "url <url>", "waveform <values>", "duration <seconds>"]
        const imeta = tags.find(t => t[0] === 'imeta' && t.some(v => v.startsWith('url ') && v.substring(4) === url));
        if (imeta) {
          const waveformTag = imeta.find(v => v.startsWith('waveform '));
          if (waveformTag) {
            waveform = waveformTag.substring(9).split(' ').map(Number);
          }
          const durationTag = imeta.find(v => v.startsWith('duration '));
          if (durationTag) {
            duration = Number(durationTag.substring(9));
          }
        }
      }

      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: url,
        type: 'audio',
        waveform,
        duration
      });
    }

    // Find base64 audio
    base64AudioRegex.lastIndex = 0;
    while ((match = base64AudioRegex.exec(processedContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[0],
        type: 'base64-audio',
      });
    }

    // Find RSS feed URLs (before general URL matching)
    rssFeedRegex.lastIndex = 0;
    while ((match = rssFeedRegex.exec(processedContent)) !== null) {
      let rssUrl = match[0];
      const start = match.index;

      // Trim trailing punctuation
      const trailingPattern = /[)\],;!?.]+$/;
      while (trailingPattern.test(rssUrl)) {
        const lastChar = rssUrl.slice(-1);
        if (lastChar === '/' || lastChar === '#') break;
        rssUrl = rssUrl.slice(0, -1);
      }

      if (!rssUrl) continue;

      // Check if this position is already matched by a higher-priority match
      const isAlreadyMatched = matches.some(m =>
        (start >= m.start && start < m.end) ||
        (start + rssUrl.length > m.start && start + rssUrl.length <= m.end)
      );

      if (!isAlreadyMatched) {
        // Ensure URL has protocol for fetching
        const normalizedUrl = rssUrl.startsWith('http') ? rssUrl : `https://${rssUrl}`;
        matches.push({
          start,
          end: start + rssUrl.length,
          content: normalizedUrl,
          type: 'rss-feed',
        });
      }
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

      const isSpecialType = matches.some(m => m.start === start && m.end === start + rawUrl.length);
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
      const tokenId = this.generateStableTokenId(match.start, match.content, match.type);
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

      if (match.customEmoji) {
        token.customEmoji = match.customEmoji;
      }

      if (match.processedUrl) {
        token.processedUrl = match.processedUrl;
      }

      if (match.cashuData) {
        token.cashuData = match.cashuData;
      }

      if (match.bolt12Data) {
        token.bolt12Data = match.bolt12Data;
      }

      if (match.waveform) {
        token.waveform = match.waveform;
      }

      if (match.duration) {
        token.duration = match.duration;
      }

      if (match.blurhash) {
        token.blurhash = match.blurhash;
      }

      if (match.thumbhash) {
        token.thumbhash = match.thumbhash;
      }

      if (match.thumbnail) {
        token.thumbnail = match.thumbnail;
      }

      if (match.dimensions) {
        token.dimensions = match.dimensions;
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
  private processTextSegment(segment: string, tokens: ContentToken[], basePosition: number): void {
    // Process line breaks in text segments
    const parts = segment.split('##LINEBREAK##');

    for (let i = 0; i < parts.length; i++) {
      // Add text token if there's any content (including whitespace between inline elements)
      // Empty strings (from empty lines) are skipped - they're represented by consecutive linebreaks
      if (parts[i].length > 0) {
        const tokenId = this.generateStableTokenId(basePosition + i, parts[i], 'text');
        tokens.push({
          id: tokenId,
          type: 'text',
          content: parts[i],
        });
      }

      // Add a line break token after each part except the last one
      if (i < parts.length - 1) {
        const linebreakId = this.generateStableTokenId(basePosition + i, '', 'linebreak');
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
  private generateStableTokenId(position: number, content: string, type: string): number {
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
