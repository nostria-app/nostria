import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import type { PodcastShowDraft } from './podcast';

/** Login-dialog compatible credentials file. */
export interface PodcastLoginCredentials {
  npub: string;
  pubkey: string;
  nsec: string;
  privkey: string;
}

export interface PodcastProfileDraft {
  name: string;
  displayName: string;
  about: string;
  picture: string;
  website: string;
  lud16: string;
}

export interface GeneratedPodcastKeypair {
  secretKey: Uint8Array;
  pubkey: string;
  npub: string;
}

export function generatePodcastKeypair(): GeneratedPodcastKeypair {
  return keypairFromSecret(generateSecretKey());
}

export function parsePodcastIdentitySecret(input: string): GeneratedPodcastKeypair {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Empty identity');
  }

  if (trimmed.startsWith('nsec')) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== 'nsec') {
      throw new Error('Invalid nsec');
    }
    return keypairFromSecret(decoded.data);
  }

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return keypairFromSecret(hexToBytes(trimmed));
  }

  throw new Error('Invalid nsec or private key');
}

export function parsePodcastIdentityJson(json: string): GeneratedPodcastKeypair {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid credentials file format');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid credentials file format');
  }

  const credentials = parsed as Record<string, unknown>;
  if (typeof credentials['nsec'] === 'string') {
    return parsePodcastIdentitySecret(credentials['nsec']);
  }
  if (typeof credentials['privkey'] === 'string') {
    return parsePodcastIdentitySecret(credentials['privkey']);
  }

  throw new Error('Invalid credentials file format');
}

function keypairFromSecret(secretKey: Uint8Array): GeneratedPodcastKeypair {
  const pubkey = getPublicKey(secretKey);
  return {
    secretKey,
    pubkey,
    npub: nip19.npubEncode(pubkey),
  };
}

export function buildPodcastLoginCredentials(secretKey: Uint8Array): PodcastLoginCredentials {
  const pubkey = getPublicKey(secretKey);
  return {
    npub: nip19.npubEncode(pubkey),
    pubkey,
    nsec: nip19.nsecEncode(secretKey),
    privkey: bytesToHex(secretKey),
  };
}

export function buildPodcastProfileContent(profile: PodcastProfileDraft): string {
  const content: Record<string, string> = {};
  const name = profile.name.trim();
  const displayName = profile.displayName.trim();
  const about = profile.about.trim();
  const picture = profile.picture.trim();
  const website = profile.website.trim();
  const lud16 = profile.lud16.trim();

  if (name) {
    content['name'] = name;
  }
  if (displayName) {
    content['display_name'] = displayName;
  }
  if (about) {
    content['about'] = about;
  }
  if (picture) {
    content['picture'] = picture;
  }
  if (website) {
    content['website'] = website;
  }
  if (lud16) {
    content['lud16'] = lud16;
  }

  return JSON.stringify(content);
}

export function deriveShortProfileName(displayName: string): string {
  return displayName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 30);
}

export function profileToShowDraft(profile: PodcastProfileDraft): PodcastShowDraft {
  return {
    title: profile.displayName.trim() || profile.name.trim(),
    description: profile.about,
    imageUrl: profile.picture,
    website: profile.website,
  };
}

export function emptyPodcastProfile(): PodcastProfileDraft {
  return {
    name: '',
    displayName: '',
    about: '',
    picture: '',
    website: '',
    lud16: '',
  };
}
