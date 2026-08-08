import { nip19 } from 'nostr-tools';
import { decrypt as nip44Decrypt } from 'nostr-tools/nip44';

import {
  CORD_FRAGMENT_VERSION,
  CORD_MAX_BUNDLE_CHANNELS,
  CORD_MAX_FRAGMENT_RELAYS,
  CORD_MAX_RELAYS,
  CORD_RELAY_DICTIONARY,
  CORD_STOCK_RELAYS,
  CordInviteBundle,
  LABEL_INVITE_KEY,
} from '../../interfaces/concord';
import { cordHkdf, fromHex, isHex32, toHex, verifyCommunityId, ZERO_ID } from './concord-crypto';

/**
 * CORD-05 Invites.
 *
 * An invite link is `$BASE/invite/<naddr>#<fragment>`: a public locator in the
 * path and a secret in the fragment. A fragment is never sent to any server, so
 * the hosting domain and the relays learn where a bundle sits but can never
 * open one.
 */

export interface CordParsedInviteLink {
  /** Addressable coordinate of the bundle: (33301, link_signer, ""). */
  pointer: nip19.AddressPointer;
  /** 16-byte unlock token, lowercase hex. */
  token: string;
  /** Bootstrap relays for finding the bundle (at most 3). */
  relays: string[];
  /** Fragment format version, which also selects the dictionary generation. */
  version: number;
}

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Fragment codec (CORD-05 §3)
// ---------------------------------------------------------------------------

const FLAG_STOCK_RELAYS = 0x01;

/**
 * Decode `[version][flags][relays?][token:16]`.
 *
 * Relay entries are one byte each when they name a dictionary id, which is what
 * keeps an invite link short enough for length-restricted platforms.
 */
export function decodeInviteFragment(fragment: string): {
  version: number;
  relays: string[];
  token: string;
} {
  const bytes = base64UrlDecode(fragment.replace(/^#/, '').trim());

  if (bytes.length < 2 + 16) throw new Error('Invite fragment is too short');

  let offset = 0;
  const version = bytes[offset++];
  const flags = bytes[offset++];

  const relays: string[] = [];

  if (flags & FLAG_STOCK_RELAYS) {
    // The stock set costs zero relay bytes — the common invite carries none.
    relays.push(...CORD_STOCK_RELAYS);
  } else {
    const count = bytes[offset++];

    for (let i = 0; i < count; i++) {
      const lead = bytes[offset++];

      if (lead === 0) {
        // wss-implied literal: [len][host]
        const length = bytes[offset++];
        const host = new TextDecoder().decode(bytes.subarray(offset, offset + length));
        offset += length;
        relays.push(`wss://${host}`);
      } else if (lead === 255) {
        // verbatim literal: [len][full URL]
        const length = bytes[offset++];
        const url = new TextDecoder().decode(bytes.subarray(offset, offset + length));
        offset += length;
        relays.push(url);
      } else {
        const url = CORD_RELAY_DICTIONARY[lead];
        // An unknown dictionary id means a newer generation than we know; skip
        // it rather than fail, the remaining relays still locate the bundle.
        if (url) relays.push(url);
      }
    }
  }

  const token = bytes.subarray(offset, offset + 16);
  if (token.length !== 16) throw new Error('Invite fragment carries no token');

  return { version, relays: relays.slice(0, CORD_MAX_FRAGMENT_RELAYS), token: toHex(token) };
}

/** Encode a fragment, preferring dictionary ids and the stock-set flag. */
export function encodeInviteFragment(token: string, relays: string[]): string {
  const tokenBytes = fromHex(token);
  if (tokenBytes.length !== 16) throw new Error('An invite token is 16 bytes');

  const chosen = relays.slice(0, CORD_MAX_FRAGMENT_RELAYS);
  const usesStock =
    chosen.length === CORD_STOCK_RELAYS.length &&
    chosen.every(relay => CORD_STOCK_RELAYS.includes(relay));

  const parts: number[] = [CORD_FRAGMENT_VERSION, usesStock ? FLAG_STOCK_RELAYS : 0];

  if (!usesStock) {
    parts.push(chosen.length);

    for (const relay of chosen) {
      const dictionaryId = Number(
        Object.keys(CORD_RELAY_DICTIONARY).find(
          id => CORD_RELAY_DICTIONARY[Number(id)] === relay
        ) ?? 0
      );

      if (dictionaryId) {
        parts.push(dictionaryId);
      } else if (relay.startsWith('wss://')) {
        const host = new TextEncoder().encode(relay.slice('wss://'.length));
        parts.push(0, host.length, ...host);
      } else {
        const full = new TextEncoder().encode(relay);
        parts.push(255, full.length, ...full);
      }
    }
  }

  return base64UrlEncode(new Uint8Array([...parts, ...tokenBytes]));
}

// ---------------------------------------------------------------------------
// Link parsing
// ---------------------------------------------------------------------------

/**
 * Parse an invite link from any base domain.
 *
 * The base is interchangeable by design — only the naddr and the fragment are
 * protocol — so a link minted by Vector opens in Nostria and vice versa.
 */
export function parseInviteLink(link: string): CordParsedInviteLink {
  const trimmed = link.trim();
  const hashIndex = trimmed.indexOf('#');

  if (hashIndex < 0) throw new Error('This invite link is missing its unlock fragment');

  const path = trimmed.slice(0, hashIndex);
  const fragment = trimmed.slice(hashIndex + 1);

  const naddrMatch = path.match(/(naddr1[0-9a-z]+)/i);
  if (!naddrMatch) throw new Error('This invite link carries no group address');

  const decoded = nip19.decode(naddrMatch[1]);
  if (decoded.type !== 'naddr') throw new Error('Invite address is not an naddr');

  const { version, relays, token } = decodeInviteFragment(fragment);

  return { pointer: decoded.data, token, relays, version };
}

/** The key that decrypts a bundle, derived from the link's off-network token. */
export function inviteBundleKey(token: string): Uint8Array {
  // hkdf(token, "concord/invite-key") — no id, no epoch.
  return cordHkdf(fromHex(token), LABEL_INVITE_KEY, ZERO_ID);
}

// ---------------------------------------------------------------------------
// Bundle validation
// ---------------------------------------------------------------------------

/**
 * Decrypt and validate a bundle.
 *
 * A bundle is attacker-crafted input reached by following a link, so every
 * field is bounded before anything is allocated or connected to, and the
 * self-certifying `community_id` is checked against the owner it names.
 */
export function decryptInviteBundle(ciphertext: string, token: string): CordInviteBundle {
  const plaintext = nip44Decrypt(ciphertext, inviteBundleKey(token));

  let bundle: CordInviteBundle;
  try {
    bundle = JSON.parse(plaintext) as CordInviteBundle;
  } catch {
    throw new Error('The invite bundle is not valid JSON');
  }

  return validateInviteBundle(bundle);
}

export function validateInviteBundle(bundle: CordInviteBundle): CordInviteBundle {
  if (!isHex32(bundle.community_id)) throw new Error('Invite has no valid community id');
  if (!isHex32(bundle.owner)) throw new Error('Invite has no valid owner key');
  if (!isHex32(bundle.owner_salt)) throw new Error('Invite has no valid owner salt');
  if (!isHex32(bundle.community_root)) throw new Error('Invite has no valid access key');

  // The whole trust model: the id must be a commitment to the owner it names,
  // so a bundle cannot smuggle a false owner or a fake key for a real community.
  if (!verifyCommunityId(bundle.community_id, bundle.owner, bundle.owner_salt)) {
    throw new Error('This invite fails its owner proof and may be forged');
  }

  if (bundle.control_pk !== undefined && !isHex32(bundle.control_pk)) {
    throw new Error('Invite carries an invalid control key');
  }

  const channels = Array.isArray(bundle.channels) ? bundle.channels : [];
  if (channels.length > CORD_MAX_BUNDLE_CHANNELS) {
    throw new Error('Invite declares an implausible number of channels');
  }

  for (const channel of channels) {
    if (!isHex32(channel.id) || !isHex32(channel.key)) {
      throw new Error('Invite carries a malformed channel key');
    }
    if (!Number.isInteger(channel.epoch) || channel.epoch < 0) {
      throw new Error('Invite carries a malformed channel epoch');
    }
  }

  const rootEpoch = Number(bundle.root_epoch ?? 0);
  if (!Number.isInteger(rootEpoch) || rootEpoch < 0) {
    throw new Error('Invite carries a malformed epoch');
  }

  const relays = (Array.isArray(bundle.relays) ? bundle.relays : [])
    .filter(relay => typeof relay === 'string' && /^wss?:\/\//i.test(relay))
    // A hostile relay list is a connect-storm vector; truncate to the cap.
    .slice(0, CORD_MAX_RELAYS);

  return { ...bundle, root_epoch: rootEpoch, channels, relays };
}

/** Whether a bundle's optional expiry has passed. Previews still render. */
export function isInviteExpired(bundle: CordInviteBundle, now = Date.now()): boolean {
  return typeof bundle.expires_at === 'number' && bundle.expires_at > 0 && bundle.expires_at < now;
}

/** Build a shareable link for a minted invite. */
export function buildInviteLink(
  base: string,
  linkSignerPubkey: string,
  token: string,
  relays: string[]
): string {
  const naddr = nip19.naddrEncode({
    identifier: '',
    pubkey: linkSignerPubkey,
    kind: 33301,
    relays: [],
  });

  return `${base.replace(/\/$/, '')}/invite/${naddr}#${encodeInviteFragment(token, relays)}`;
}
