/**
 * Estimates the visual display length of Nostr event content.
 *
 * Raw content contains `nostr:nprofile1...`, `nostr:npub1...`, `nostr:nevent1...` etc.
 * references that are 100-250+ characters each, but render as short display names
 * (e.g., "@Username"). This function replaces those references with a short placeholder
 * before measuring length, so the "Show more" threshold reflects what the user actually sees.
 */

// Matches nostr: URI references (nprofile, npub, note, nevent, naddr)
const NOSTR_REF_REGEX = /nostr:(?:npub|nprofile|note|nevent|naddr)1[a-zA-Z0-9]+/g;

// Average display length of a rendered nostr reference (e.g., "@DisplayName")
const NOSTR_REF_DISPLAY_LENGTH = 15;

export function visualContentLength(content: string): number {
  if (!content) return 0;
  return content.replace(NOSTR_REF_REGEX, 'x'.repeat(NOSTR_REF_DISPLAY_LENGTH)).length;
}
