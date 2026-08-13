import { AUTHORED_PODCASTS_KIND } from './podcast';

export type ImportEventSigner = 'identity' | 'account';

export function uniqueRelayUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const url of urls) {
    const trimmed = url.trim();
    if (!trimmed) {
      continue;
    }

    const key = trimmed.replace(/\/+$/, '');
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

export function importEventSigner(kind: number, useIdentity: boolean): ImportEventSigner {
  if (!useIdentity || kind === AUTHORED_PODCASTS_KIND) {
    return 'account';
  }

  return 'identity';
}

export function readProfileLightningAddress(profile: { data?: unknown; event?: { content?: string } } | null | undefined): string {
  if (!profile) {
    return '';
  }

  if (profile.data && typeof profile.data === 'object') {
    const fromData = (profile.data as Record<string, unknown>)['lud16'];
    if (typeof fromData === 'string' && fromData.trim()) {
      return fromData.trim();
    }
  }

  const content = profile.event?.content;
  if (!content) {
    return '';
  }

  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const fromEvent = parsed['lud16'];
    if (typeof fromEvent === 'string') {
      return fromEvent.trim();
    }
  } catch {
    return '';
  }

  return '';
}
