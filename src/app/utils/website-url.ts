const CONTROL_CHARACTERS_REGEX = /[\u0000-\u001F\u007F]/g;
const INVISIBLE_CHARACTERS_REGEX = /[\u200B-\u200D\u2060\uFEFF]/g;
const URL_SCHEME_REGEX = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export function cleanWebsiteValue(website: string | null | undefined): string {
  if (!website) {
    return '';
  }

  return website
    .replace(CONTROL_CHARACTERS_REGEX, '')
    .replace(INVISIBLE_CHARACTERS_REGEX, '')
    .trim();
}

export function normalizeWebsiteUrl(website: string | null | undefined): string {
  const cleanedWebsite = cleanWebsiteValue(website);
  if (!cleanedWebsite) {
    return '';
  }

  if (URL_SCHEME_REGEX.test(cleanedWebsite)) {
    return cleanedWebsite;
  }

  return `https://${cleanedWebsite}`;
}
