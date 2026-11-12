import { Event } from 'nostr-tools';

/**
 * Longer than the nsec PIN prompt, extension popups, the NIP-55 dialog, and
 * NIP-46 approvals (30s plus retries). A stuck signer must not hold the queue.
 */
export const SIGNER_RESPONSE_TIMEOUT_MS = 180_000;

export interface MuteListChange {
  action: 'add' | 'remove';
  type: string;
  value: string;
}

/**
 * NIP-51 kind 10000 stores public entries as tags and private entries as a
 * JSON array of tags. Unknown tags are part of the list and must round-trip.
 */
export function cloneMuteTags(tags: readonly (readonly string[])[] | undefined): string[][] {
  if (!tags) return [];
  return tags.map(tag => [...tag]);
}

export function collectMuteValues(
  publicTags: readonly (readonly string[])[] | undefined,
  privateTags: readonly (readonly string[])[] | undefined,
  type: string,
): string[] {
  const values: string[] = [];
  const seen = new Set<string>();

  for (const tags of [publicTags, privateTags]) {
    if (!tags) continue;
    for (const tag of tags) {
      if (tag[0] !== type || !tag[1] || seen.has(tag[1])) continue;
      seen.add(tag[1]);
      values.push(tag[1]);
    }
  }

  return values;
}

/**
 * Parse the decrypted NIP-51 private list. Anything that is not an array of
 * string tags is a failure: callers must not publish over a list they could
 * not read.
 */
export function parsePrivateMuteTags(plaintext: string): string[][] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new Error('Private mute list is not valid JSON');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Private mute list is not a tag array');
  }

  return parsed.map(tag => {
    if (!Array.isArray(tag) || tag.length === 0 || tag.some(part => typeof part !== 'string')) {
      throw new Error('Private mute list contains a malformed tag');
    }
    return [...tag];
  });
}

function tagMatches(tag: readonly string[], change: MuteListChange): boolean {
  return tag[0] === change.type && tag[1] === change.value;
}

/**
 * Apply one public add/remove without dropping unrelated public tags or
 * private tags. New entries stay public, matching the existing mute UI.
 * Removals apply to both copies so a private entry can be unmuted.
 */
export function applyMuteListChange(
  publicTags: readonly (readonly string[])[] | undefined,
  privateTags: readonly (readonly string[])[] | undefined,
  change: MuteListChange,
): { publicTags: string[][]; privateTags: string[][] } {
  const nextPublic = cloneMuteTags(publicTags);
  const nextPrivate = cloneMuteTags(privateTags);

  if (change.action === 'remove') {
    return {
      publicTags: nextPublic.filter(tag => !tagMatches(tag, change)),
      privateTags: nextPrivate.filter(tag => !tagMatches(tag, change)),
    };
  }

  if (nextPublic.some(tag => tagMatches(tag, change)) || nextPrivate.some(tag => tagMatches(tag, change))) {
    return { publicTags: nextPublic, privateTags: nextPrivate };
  }

  nextPublic.push([change.type, change.value]);
  return { publicTags: nextPublic, privateTags: nextPrivate };
}

/**
 * Newest created_at wins. NIP-01: when timestamps match, keep the lowest id.
 */
export function pickNewestMuteList(events: readonly Event[]): Event | null {
  let newest: Event | null = null;

  for (const event of events) {
    if (!newest) {
      newest = event;
      continue;
    }

    if (event.created_at !== newest.created_at) {
      if (event.created_at > newest.created_at) newest = event;
      continue;
    }

    if (event.id < newest.id) newest = event;
  }

  return newest;
}
