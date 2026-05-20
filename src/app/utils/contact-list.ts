export interface ContactListProfileMetadata {
  relayUrl?: string;
  petname?: string;
}

const HEX_PUBKEY_REGEX = /^[0-9a-f]{64}$/i;

function normalizePubkey(pubkey: string | undefined): string | null {
  const value = pubkey?.trim().toLowerCase();
  if (!value || !HEX_PUBKEY_REGEX.test(value)) {
    return null;
  }

  return value;
}

function readOptionalTagValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function serializeContactTag(pubkey: string, metadata: ContactListProfileMetadata): string[] {
  if (metadata.petname) {
    return ['p', pubkey, metadata.relayUrl || '', metadata.petname];
  }

  if (metadata.relayUrl) {
    return ['p', pubkey, metadata.relayUrl];
  }

  return ['p', pubkey];
}

export function normalizeContactListTags(tags: string[][]): string[][] {
  const orderedEntries: Array<{ type: 'other'; tag: string[] } | { type: 'p'; pubkey: string }> = [];
  const metadataByPubkey = new Map<string, ContactListProfileMetadata>();

  for (const tag of tags) {
    if (tag[0] !== 'p') {
      orderedEntries.push({ type: 'other', tag: [...tag] });
      continue;
    }

    const pubkey = normalizePubkey(tag[1]);
    if (!pubkey) {
      continue;
    }

    const relayUrl = readOptionalTagValue(tag[2]);
    const petname = readOptionalTagValue(tag[3]);
    const existing = metadataByPubkey.get(pubkey);

    if (!existing) {
      metadataByPubkey.set(pubkey, { relayUrl, petname });
      orderedEntries.push({ type: 'p', pubkey });
      continue;
    }

    if (!existing.relayUrl && relayUrl) {
      existing.relayUrl = relayUrl;
    }

    if (!existing.petname && petname) {
      existing.petname = petname;
    }
  }

  return orderedEntries.map((entry) => {
    if (entry.type === 'other') {
      return entry.tag;
    }

    return serializeContactTag(entry.pubkey, metadataByPubkey.get(entry.pubkey) || {});
  });
}

export function getContactListProfileMap(tags: string[][]): Map<string, ContactListProfileMetadata> {
  const normalizedTags = normalizeContactListTags(tags);
  const metadataByPubkey = new Map<string, ContactListProfileMetadata>();

  for (const tag of normalizedTags) {
    if (tag[0] !== 'p') {
      continue;
    }

    const pubkey = normalizePubkey(tag[1]);
    if (!pubkey) {
      continue;
    }

    metadataByPubkey.set(pubkey, {
      relayUrl: readOptionalTagValue(tag[2]),
      petname: readOptionalTagValue(tag[3]),
    });
  }

  return metadataByPubkey;
}