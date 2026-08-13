import { bytesToHex } from '@noble/hashes/utils.js';
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
}

export interface GeneratedPodcastKeypair {
  secretKey: Uint8Array;
  pubkey: string;
  npub: string;
}

export function generatePodcastKeypair(): GeneratedPodcastKeypair {
  const secretKey = generateSecretKey();
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

  return JSON.stringify(content);
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
  };
}
