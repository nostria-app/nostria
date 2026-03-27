/**
 * Estimates the visible text length used for post collapsing.
 *
 * Social preview URLs are rendered separately below the post, and Nostr references
 * such as `nostr:nevent1...` or bare `naddr1...` values are rendered as embeds or
 * compact mentions. Those tokens should not contribute to the "Show more" threshold.
 */

const EXCLUDED_CONTENT_REGEX = /(?:nostr:)?(?:npub|nprofile|note|nevent|naddr)1[a-zA-Z0-9]+|https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;

export function visualContentLength(content: string): number {
  if (!content) return 0;

  return content.replace(EXCLUDED_CONTENT_REGEX, '').length;
}
