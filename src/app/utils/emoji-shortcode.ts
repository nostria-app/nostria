const INVALID_SHORTCODE_SEPARATOR_REGEX = /[\s-]+/g;
const INVALID_SHORTCODE_CHAR_REGEX = /[^A-Za-z0-9_]/g;
const DUPLICATE_UNDERSCORE_REGEX = /_+/g;

export const NIP30_SHORTCODE_REGEX = /^[A-Za-z0-9_]+$/;

export function normalizeEmojiShortcode(shortcode: string): string {
  return shortcode
    .trim()
    .replace(INVALID_SHORTCODE_SEPARATOR_REGEX, '_')
    .replace(INVALID_SHORTCODE_CHAR_REGEX, '')
    .replace(DUPLICATE_UNDERSCORE_REGEX, '_')
    .replace(/^_+|_+$/g, '');
}

export function isValidEmojiShortcode(shortcode: string): boolean {
  return NIP30_SHORTCODE_REGEX.test(shortcode);
}