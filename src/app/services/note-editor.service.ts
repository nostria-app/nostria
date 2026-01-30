import { Injectable, inject } from '@angular/core';
import { nip19, Event as NostrEvent } from 'nostr-tools';
import { DataService } from './data.service';
import { MentionInputService, MentionDetectionResult } from './mention-input.service';
import { UtilitiesService } from './utilities.service';

/**
 * Reply information for building tags
 */
export interface ReplyToInfo {
  id: string;
  pubkey: string;
  rootId?: string | null;
  event?: NostrEvent;
}

/**
 * Quote information for building tags
 */
export interface QuoteInfo {
  id: string;
  pubkey: string;
  kind?: number;
}

/**
 * Media metadata for imeta tags (NIP-92)
 */
export interface MediaMetadata {
  url: string;
  mimeType?: string;
  blurhash?: string;
  thumbhash?: string;
  dimensions?: { width: number; height: number };
  alt?: string;
  sha256?: string;
  image?: string;
  imageMirrors?: string[];
  fallbackUrls?: string[];
  thumbnailBlob?: Blob;
}

/**
 * Configuration for building note tags
 */
export interface BuildTagsConfig {
  replyTo?: ReplyToInfo;
  quote?: QuoteInfo;
  mentions: string[];
  content: string;
  mediaMetadata?: MediaMetadata[];
  expirationTimestamp?: number;
  addClientTag?: boolean;
  zapSplit?: {
    enabled: boolean;
    originalPercent: number;
    quoterPercent: number;
    currentUserPubkey: string;
  };
}

/**
 * Shared service for note editing functionality.
 * Extracts common logic used by both the note-editor-dialog (full featured)
 * and inline-reply-editor (simplified) components.
 */
@Injectable({
  providedIn: 'root',
})
export class NoteEditorService {
  private dataService = inject(DataService);
  private mentionInputService = inject(MentionInputService);
  private utilities = inject(UtilitiesService);

  /**
   * Process content for publishing by replacing @mentions with nostr: URIs
   */
  processContentForPublishing(content: string, mentionMap: Map<string, string>): string {
    let processedContent = content;

    // Replace each @mention with its nostr: URI
    for (const [mention, uri] of mentionMap.entries()) {
      // Escape special regex characters in the mention
      const escapedMention = mention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedMention, 'g');
      processedContent = processedContent.replace(regex, uri);
    }

    return processedContent;
  }

  /**
   * Build tags for a note based on configuration
   */
  buildTags(config: BuildTagsConfig): string[][] {
    const tags: string[][] = [];
    const {
      replyTo,
      quote,
      mentions,
      content,
      mediaMetadata,
      expirationTimestamp,
      addClientTag,
      zapSplit,
    } = config;

    // Add reply tags (NIP-10)
    if (replyTo) {
      this.buildReplyTags(replyTo, tags);
    }

    // Add quote tag (NIP-18)
    if (quote) {
      this.buildQuoteTags(quote, tags, zapSplit);
    }

    // Parse NIP-27 references from content
    this.extractNip27Tags(content, tags);

    // Extract hashtags from content
    this.extractHashtags(content, tags);

    // Add mention tags (avoid duplicates)
    const existingPubkeys = new Set(tags.filter(tag => tag[0] === 'p').map(tag => tag[1]));
    mentions.forEach(pubkey => {
      if (!existingPubkeys.has(pubkey)) {
        tags.push(['p', pubkey]);
      }
    });

    // Add expiration tag if provided
    if (expirationTimestamp) {
      tags.push(['expiration', expirationTimestamp.toString()]);
    }

    // Add client tag if enabled
    if (addClientTag) {
      tags.push(['client', 'nostria']);
    }

    // Add imeta tags for uploaded media (NIP-92)
    if (mediaMetadata) {
      mediaMetadata.forEach(metadata => {
        const imetaTag = this.utilities.buildImetaTag(metadata);
        if (imetaTag) {
          tags.push(imetaTag);
        }
      });
    }

    return tags;
  }

  /**
   * Build reply tags (NIP-10)
   */
  private buildReplyTags(replyTo: ReplyToInfo, tags: string[][]): void {
    const parentEvent = replyTo.event;

    if (parentEvent) {
      // Get all existing e and p tags from the parent event
      const existingETags = parentEvent.tags.filter(tag => tag[0] === 'e');
      const existingPTags = parentEvent.tags.filter(tag => tag[0] === 'p');

      // Step 1: Add all existing "e" tags from the parent event
      existingETags.forEach(eTag => {
        const tagCopy = [...eTag];
        // If this tag has "reply" marker, remove it
        if (tagCopy[3] === 'reply') {
          tagCopy[3] = '';
        }
        tags.push(tagCopy);
      });

      // Step 2: Add the parent event as a new "e" tag
      const marker = existingETags.length === 0 ? 'root' : 'reply';
      tags.push(['e', replyTo.id, '', marker, replyTo.pubkey]);

      // Step 3: Add all existing "p" tags from the parent event
      existingPTags.forEach(pTag => {
        tags.push([...pTag]);
      });

      // Step 4: Add the author of the parent event as a "p" tag if not already included
      const authorAlreadyIncluded = existingPTags.some(tag => tag[1] === replyTo.pubkey);
      if (!authorAlreadyIncluded) {
        tags.push(['p', replyTo.pubkey, '']);
      }
    } else {
      // Fallback behavior if no event is provided
      if (replyTo.rootId) {
        tags.push(['e', replyTo.rootId, '', 'root']);
        tags.push(['e', replyTo.id, '', 'reply']);
      } else {
        tags.push(['e', replyTo.id, '', 'root']);
      }
      tags.push(['p', replyTo.pubkey]);
    }
  }

  /**
   * Build quote tags (NIP-18)
   */
  private buildQuoteTags(
    quote: QuoteInfo,
    tags: string[][],
    zapSplit?: BuildTagsConfig['zapSplit']
  ): void {
    const relay = '';
    tags.push(['q', quote.id, relay, quote.pubkey]);

    // Add p-tag for the quoted author
    const existingPubkeys = tags.filter(tag => tag[0] === 'p').map(tag => tag[1]);
    if (!existingPubkeys.includes(quote.pubkey)) {
      tags.push(['p', quote.pubkey]);
    }

    // Add zap split tags if enabled (NIP-57 Appendix G)
    if (zapSplit?.enabled && zapSplit.currentUserPubkey) {
      if (zapSplit.originalPercent > 0) {
        tags.push(['zap', quote.pubkey, relay, zapSplit.originalPercent.toString()]);
      }
      if (zapSplit.quoterPercent > 0) {
        tags.push(['zap', zapSplit.currentUserPubkey, '', zapSplit.quoterPercent.toString()]);
      }
    }
  }

  /**
   * Extract NIP-27 references from content and add corresponding tags
   */
  private extractNip27Tags(content: string, tags: string[][]): void {
    const nostrUriPattern = /nostr:(note1|nevent1|npub1|nprofile1|naddr1)([a-zA-Z0-9]+)/g;
    const matches = content.matchAll(nostrUriPattern);

    const addedQuoteEventIds = new Set(tags.filter(tag => tag[0] === 'q').map(tag => tag[1]));
    const addedPubkeys = new Set(tags.filter(tag => tag[0] === 'p').map(tag => tag[1]));

    for (const match of matches) {
      const fullIdentifier = match[1] + match[2];

      try {
        const decoded = nip19.decode(fullIdentifier);

        switch (decoded.type) {
          case 'note':
            if (!addedQuoteEventIds.has(decoded.data)) {
              tags.push(['q', decoded.data, '', '']);
              addedQuoteEventIds.add(decoded.data);
            }
            break;

          case 'nevent':
            if (!addedQuoteEventIds.has(decoded.data.id)) {
              const relay = decoded.data.relays?.[0] || '';
              const pubkey = decoded.data.author || '';
              tags.push(['q', decoded.data.id, relay, pubkey]);
              addedQuoteEventIds.add(decoded.data.id);
            }
            if (decoded.data.author && !addedPubkeys.has(decoded.data.author)) {
              tags.push(['p', decoded.data.author, '']);
              addedPubkeys.add(decoded.data.author);
            }
            break;

          case 'npub':
            if (!addedPubkeys.has(decoded.data)) {
              tags.push(['p', decoded.data, '']);
              addedPubkeys.add(decoded.data);
            }
            break;

          case 'nprofile':
            if (!addedPubkeys.has(decoded.data.pubkey)) {
              tags.push(['p', decoded.data.pubkey, '']);
              addedPubkeys.add(decoded.data.pubkey);
            }
            break;

          case 'naddr': {
            const aTagValue = `${decoded.data.kind}:${decoded.data.pubkey}:${decoded.data.identifier}`;
            const relay = decoded.data.relays?.[0] || '';
            tags.push(['q', aTagValue, relay, decoded.data.pubkey]);
            if (!addedPubkeys.has(decoded.data.pubkey)) {
              tags.push(['p', decoded.data.pubkey, '']);
              addedPubkeys.add(decoded.data.pubkey);
            }
            break;
          }
        }
      } catch {
        console.warn('Failed to decode NIP-19 identifier:', fullIdentifier);
      }
    }
  }

  /**
   * Extract hashtags from content and add as t-tags
   */
  extractHashtags(content: string, tags: string[][]): void {
    const hashtagRegex = /#([a-zA-Z0-9_]+)/g;
    const hashtags = new Set<string>();

    let match;
    while ((match = hashtagRegex.exec(content)) !== null) {
      const hashtag = match[1].toLowerCase();
      hashtags.add(hashtag);
    }

    hashtags.forEach(hashtag => {
      tags.push(['t', hashtag]);
    });
  }

  /**
   * Extract hashtags from content and return as array
   */
  getHashtagsFromContent(content: string): string[] {
    const hashtagRegex = /#([a-zA-Z0-9_]+)/g;
    const hashtagSet = new Set<string>();

    let match;
    while ((match = hashtagRegex.exec(content)) !== null) {
      hashtagSet.add(match[1].toLowerCase());
    }

    return Array.from(hashtagSet);
  }

  /**
   * Load profile display name for a pubkey
   */
  async loadProfileName(pubkey: string): Promise<string | null> {
    try {
      const profile = await this.dataService.getProfile(pubkey);
      if (profile?.data) {
        return profile.data.display_name || profile.data.name || null;
      }
    } catch (error) {
      console.warn('Failed to load profile name:', error);
    }
    return null;
  }

  /**
   * Detect mention from text and cursor position
   */
  detectMention(text: string, cursorPosition: number): MentionDetectionResult {
    return this.mentionInputService.detectMention(text, cursorPosition);
  }

  /**
   * Replace mention in content
   */
  replaceMention(detection: MentionDetectionResult, replacementText: string) {
    return this.mentionInputService.replaceMention(detection, replacementText);
  }
}
