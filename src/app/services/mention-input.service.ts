import { Injectable } from '@angular/core';

export interface MentionDetectionResult {
  /** Whether @ mention is currently being typed */
  isTypingMention: boolean;
  /** The mention query (text after @) */
  query: string;
  /** Position where @ mention starts */
  mentionStart: number;
  /** Current cursor position */
  cursorPosition: number;
  /** Full text content */
  fullText: string;
}

export interface MentionReplacement {
  /** The text to replace the mention with */
  replacementText: string;
  /** Position to start replacement */
  startPosition: number;
  /** Position to end replacement */
  endPosition: number;
  /** New cursor position after replacement */
  newCursorPosition: number;
}

@Injectable({
  providedIn: 'root',
})
export class MentionInputService {

  /**
   * Detect if user is typing a mention and extract relevant information
   */
  detectMention(text: string, cursorPosition: number): MentionDetectionResult {
    // Look backwards from cursor position to find @
    let mentionStart = -1;
    const searchStart = Math.min(cursorPosition, text.length);

    // Search backwards for @ symbol
    for (let i = searchStart - 1; i >= 0; i--) {
      const char = text[i];

      if (char === '@') {
        mentionStart = i;
        break;
      }

      // Stop if we hit whitespace or other mention delimiters
      if (char === ' ' || char === '\n' || char === '\t') {
        break;
      }
    }

    if (mentionStart === -1) {
      return {
        isTypingMention: false,
        query: '',
        mentionStart: -1,
        cursorPosition,
        fullText: text,
      };
    }

    // Extract the query after @
    const mentionEnd = cursorPosition;
    const query = text.substring(mentionStart + 1, mentionEnd);

    // Check if this is a valid mention context
    // @ should be at start of text or preceded by whitespace
    const isValidMentionContext =
      mentionStart === 0 ||
      /\s/.test(text[mentionStart - 1]);

    if (!isValidMentionContext) {
      return {
        isTypingMention: false,
        query: '',
        mentionStart: -1,
        cursorPosition,
        fullText: text,
      };
    }

    return {
      isTypingMention: true,
      query,
      mentionStart,
      cursorPosition,
      fullText: text,
    };
  }

  /**
   * Replace the @ mention with the selected nostr: URI
   */
  replaceMention(
    detection: MentionDetectionResult,
    nprofileUri: string
  ): MentionReplacement {
    const { fullText, mentionStart, cursorPosition } = detection;

    // For NIP-27, we want to insert the nostr: URI in the content
    // and keep the display name for visual purposes in the text
    const replacementText = nprofileUri;

    // Replace from @ symbol to current cursor position
    const beforeMention = fullText.substring(0, mentionStart);
    const afterMention = fullText.substring(cursorPosition);

    // Add a space after the mention if there isn't one already
    // This ensures proper separation when user continues typing
    const needsSpace = afterMention.length === 0 || !/^\s/.test(afterMention);
    const spacer = needsSpace ? ' ' : '';

    const newText = beforeMention + replacementText + spacer + afterMention;
    const newCursorPosition = mentionStart + replacementText.length + spacer.length;

    return {
      replacementText: newText,
      startPosition: mentionStart,
      endPosition: cursorPosition,
      newCursorPosition,
    };
  }

  /**
   * For visual display, replace nostr: URIs with display names
   * This is used for showing user-friendly text while preserving NIP-27 URIs in the actual content
   */
  replaceNostrUrisWithDisplayNames(
    text: string,
    mentionMap: Map<string, string>
  ): string {
    let displayText = text;

    // Replace nostr: URIs with their display names
    for (const [uri, displayName] of mentionMap.entries()) {
      // Use a more careful replacement to avoid partial matches
      const regex = new RegExp(this.escapeRegExp(uri), 'g');
      displayText = displayText.replace(regex, `@${displayName}`);
    }

    return displayText;
  }

  /**
   * Extract all nostr: URIs from text
   */
  extractNostrUris(text: string): string[] {
    const nostrUriRegex = /nostr:(npub1[0-9a-z]{58}|nprofile1[0-9a-z]+)/g;
    const matches = text.match(nostrUriRegex);
    return matches || [];
  }

  /**
   * Check if cursor is at the end of a potential mention
   */
  isCursorAtMentionEnd(text: string, cursorPosition: number): boolean {
    if (cursorPosition === 0) return false;

    const detection = this.detectMention(text, cursorPosition);
    return detection.isTypingMention &&
      detection.cursorPosition === cursorPosition;
  }

  /**
   * Escape special regex characters
   */
  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Extract the current word being typed (for mention detection)
   */
  getCurrentWord(text: string, cursorPosition: number): { word: string; start: number; end: number } {
    let start = cursorPosition;
    let end = cursorPosition;

    // Find start of word
    while (start > 0 && !/\s/.test(text[start - 1])) {
      start--;
    }

    // Find end of word
    while (end < text.length && !/\s/.test(text[end])) {
      end++;
    }

    return {
      word: text.substring(start, end),
      start,
      end,
    };
  }
}