const UNSUPPORTED_PROFILE_NAME_CHAR_REGEX = /[^\p{L}\p{N}\p{M}_.-]+/gu;
const DUPLICATE_UNDERSCORE_REGEX = /_+/g;

export function sanitizeProfileNameInput(profileName: string): string {
  return profileName
    .normalize('NFC')
    .replace(/\s+/g, '_')
    .replace(UNSUPPORTED_PROFILE_NAME_CHAR_REGEX, '')
    .replace(DUPLICATE_UNDERSCORE_REGEX, '_')
    .replace(/^_+|_+$/g, '');
}
