import { expand } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { chacha20 } from '@noble/ciphers/chacha.js';
import { verifyEvent } from 'nostr-tools';

import {
  CORD_KIND_EDIT,
  CORD_KIND_MESSAGE,
  CORD_KIND_REPLY,
  CORD_KIND_SEAL_ENCRYPTED,
  CORD_MAX_PINS,
  CORD_MAX_PIN_BYTES,
  CordGroupKey,
  CordRumor,
  CordSealEvent,
} from '../../interfaces/concord';
import { concatBytes, fromHex, toHex } from './concord-crypto';
import { rumorId } from './concord-stream';

/**
 * CORD-04 §7 Pins.
 *
 * A pin does not quote a message, it *proves* one. The entry carries the
 * original seal verbatim plus that message's one-shot NIP-44 keys, so any
 * reader — including one holding no channel keys at all — can verify the
 * author, the words, the channel and the signed timestamp for themselves.
 *
 * Disclosing those keys is safe by construction: NIP-44 v2 derives per-message
 * keys as `hkdf_expand(conversation_key, nonce)`, which is one-way, so the
 * disclosure exposes that one message and nothing else — not the conversation
 * key, not the epoch, not the author's other traffic.
 */

/** A single pinned message, with everything needed to verify it. */
export interface CordPinEntry {
  seal: CordSealEvent;
  /** 76 bytes hex: chacha_key[32] || chacha_nonce[12] || hmac_key[32]. */
  keys: string;
  /** Optional, unverifiable jump-to-context hint. */
  wrap?: string;
  /** Optional proof of the author's own Edit, so keyless readers see current text. */
  edit?: { seal: CordSealEvent; keys: string };
}

/** The pin list content, in one of its two self-describing forms. */
export type CordPinList =
  | { entries: CordPinEntry[] }
  | { epoch: string; sealed: string };

/** A verified pin, ready to render. */
export interface CordVerifiedPin {
  /** Recomputed rumor id — the entry's identity for dedupe and deletion. */
  id: string;
  author: string;
  content: string;
  createdAt: number;
  kind: number;
  /** The proven rumor's tags, so custom emoji resolve in a pinned message. */
  tags: string[][];
  /** Replacement text from a proven Edit, when the entry carries one. */
  editedContent?: string;
  wrap?: string;
}

// ---------------------------------------------------------------------------
// NIP-44 v2 message keys
// ---------------------------------------------------------------------------

/** Decode a NIP-44 v2 payload: version(1) || nonce(32) || ciphertext || mac(32). */
function decodePayload(payload: string): {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  mac: Uint8Array;
} | null {
  if (payload.startsWith('#')) return null; // unsupported future version

  let bytes: Uint8Array;
  try {
    const binary = atob(payload);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    return null;
  }

  if (bytes.length < 1 + 32 + 32 || bytes[0] !== 2) return null;

  return {
    nonce: bytes.subarray(1, 33),
    ciphertext: bytes.subarray(33, bytes.length - 32),
    mac: bytes.subarray(bytes.length - 32),
  };
}

/**
 * Derive the per-message keys NIP-44 v2 uses.
 *
 * nostr-tools does not export this, so it is reimplemented here against the
 * spec: `hkdf_expand(sha256, conversation_key, nonce, 76)`.
 */
function messageKeys(conversationKey: Uint8Array, nonce: Uint8Array): Uint8Array {
  return expand(sha256, conversationKey, nonce, 76);
}

/** Split the 76-byte expansion into its three parts. */
function splitKeys(keys: Uint8Array): {
  chachaKey: Uint8Array;
  chachaNonce: Uint8Array;
  hmacKey: Uint8Array;
} {
  return {
    chachaKey: keys.subarray(0, 32),
    chachaNonce: keys.subarray(32, 44),
    hmacKey: keys.subarray(44, 76),
  };
}

/** NIP-44 unpadding: the plaintext length is a big-endian u16 prefix. */
function unpad(padded: Uint8Array): string | null {
  if (padded.length < 2) return null;

  const length = (padded[0] << 8) | padded[1];
  if (length === 0 || 2 + length > padded.length) return null;

  return new TextDecoder().decode(padded.subarray(2, 2 + length));
}

// ---------------------------------------------------------------------------
// Building a pin
// ---------------------------------------------------------------------------

/**
 * Build the proof bundle for a message the curator can read.
 *
 * @param seal the original kind:20013 seal, carried byte-verbatim
 * @param conversationKey the channel's conversation key at that epoch
 */
export function buildPinEntry(
  seal: CordSealEvent,
  conversationKey: Uint8Array,
  wrapId?: string
): CordPinEntry | null {
  const payload = decodePayload(seal.content);
  if (!payload) return null;

  const keys = messageKeys(conversationKey, payload.nonce);

  return {
    seal,
    keys: toHex(keys),
    wrap: wrapId,
  };
}

// ---------------------------------------------------------------------------
// Verifying a pin
// ---------------------------------------------------------------------------

/**
 * Verify a pin entry against the five checks of CORD-04 §7.
 *
 * A verifier holds nothing but the entry and the list's own coordinates. On any
 * failure the entry is invalid and MUST be dropped — its edition still folds
 * normally.
 */
export function verifyPinEntry(entry: CordPinEntry, channelId: string): CordVerifiedPin | null {
  const rumor = openProof(entry.seal, entry.keys, channelId, [
    CORD_KIND_MESSAGE,
    CORD_KIND_REPLY,
  ]);

  if (!rumor) return null;

  const verified: CordVerifiedPin = {
    id: rumorId(rumor),
    author: rumor.pubkey,
    content: rumor.content,
    createdAt: rumor.created_at,
    kind: rumor.kind,
    tags: rumor.tags,
    wrap: entry.wrap,
  };

  // The optional Edit proof: same checks, plus the author must match and its
  // `e` tag must name the original. These are deliberately the fold's own
  // rules, so a keyless reader reaches the verdict a keyed reader would.
  if (entry.edit) {
    const editRumor = openProof(entry.edit.seal, entry.edit.keys, channelId, [CORD_KIND_EDIT]);

    if (
      editRumor &&
      editRumor.pubkey === verified.author &&
      editRumor.tags.some(tag => tag[0] === 'e' && tag[1] === verified.id)
    ) {
      verified.editedContent = editRumor.content;
    }
  }

  return verified;
}

/** Shared verification for an entry's seal and its optional Edit. */
function openProof(
  seal: CordSealEvent,
  keysHex: string,
  channelId: string,
  allowedKinds: number[]
): CordRumor | null {
  // 1. The seal must be an encrypted seal, and its signature must verify.
  if (seal?.kind !== CORD_KIND_SEAL_ENCRYPTED) return null;
  if (!verifyEvent(seal as never)) return null;

  const payload = decodePayload(seal.content);
  if (!payload) return null;

  let keys: Uint8Array;
  try {
    keys = fromHex(keysHex);
  } catch {
    return null;
  }

  if (keys.length !== 76) return null;

  const { chachaKey, chachaNonce, hmacKey } = splitKeys(keys);

  // 2. Check the MAC with the disclosed hmac key.
  const mac = hmac(sha256, hmacKey, concatBytes(payload.nonce, payload.ciphertext));
  if (toHex(mac) !== toHex(payload.mac)) return null;

  // 3. Decrypt, 4. unpad and parse.
  let plaintext: string | null;
  try {
    plaintext = unpad(chacha20(chachaKey, chachaNonce, payload.ciphertext));
  } catch {
    return null;
  }

  if (!plaintext) return null;

  let rumor: CordRumor;
  try {
    rumor = JSON.parse(plaintext) as CordRumor;
  } catch {
    return null;
  }

  // 5. The impersonation check, the kind, and above all the channel binding —
  // without it a private channel's keyholder could pin its messages into a
  // public list, disclosing them community-wide with proof.
  if (rumor.pubkey !== seal.pubkey) return null;
  if (!allowedKinds.includes(rumor.kind)) return null;
  if (!rumor.tags.some(tag => tag[0] === 'channel' && tag[1] === channelId)) return null;

  return rumor;
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/** Parse a pin list, returning null when the caller could not read its form. */
export function parsePinList(
  content: string,
  decryptSealed: (epoch: string, sealed: string) => string | null
): { entries: CordPinEntry[]; readable: boolean } {
  // A violating edition still folds and chains; it just reads as empty.
  if (new TextEncoder().encode(content).length > CORD_MAX_PIN_BYTES) {
    return { entries: [], readable: true };
  }

  let parsed: CordPinList;
  try {
    parsed = JSON.parse(content) as CordPinList;
  } catch {
    return { entries: [], readable: true };
  }

  if ('sealed' in parsed) {
    const plaintext = decryptSealed(parsed.epoch, parsed.sealed);

    // An empty view has two innocent causes and they are indistinguishable, so
    // the caller must be told it could not read rather than shown "no pins".
    if (!plaintext) return { entries: [], readable: false };

    try {
      const inner = JSON.parse(plaintext) as { entries: CordPinEntry[] };
      return { entries: inner.entries ?? [], readable: true };
    } catch {
      return { entries: [], readable: false };
    }
  }

  const entries = parsed.entries ?? [];
  return { entries: entries.slice(0, CORD_MAX_PINS), readable: true };
}

/** Serialize a pin list in the form matching the channel's folded type. */
export function buildPinListContent(
  entries: CordPinEntry[],
  options: { private: boolean; epoch: number; seal: (plaintext: string) => string }
): string {
  const capped = entries.slice(0, CORD_MAX_PINS);

  if (!options.private) {
    // Plaintext: the plane's wrap is the gate, and compaction re-wrapping it to
    // each new root *is* the re-encryption.
    return JSON.stringify({ entries: capped });
  }

  return JSON.stringify({
    epoch: String(options.epoch),
    sealed: options.seal(JSON.stringify({ entries: capped })),
  });
}

export { CORD_MAX_PINS, CORD_MAX_PIN_BYTES };
