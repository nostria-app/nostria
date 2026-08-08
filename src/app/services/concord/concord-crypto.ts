import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { getConversationKey } from 'nostr-tools/nip44';

import {
  CordGroupKey,
  LABEL_COMMUNITY,
  LABEL_EDITION,
  LABEL_EPOCH_COMMITMENT,
} from '../../interfaces/concord';

/**
 * Concord's frozen key derivations (CORD-02 Appendix A).
 *
 * Every byte here is wire format. A single changed byte in a label, a field
 * order, or an integer encoding re-addresses every event Concord has ever
 * published and silently breaks interoperability with other clients — the
 * failure mode is an empty community, not an error. Treat this file as
 * append-only.
 */

const encoder = new TextEncoder();

/** 32 zero bytes, used wherever a label has no meaningful id. */
export const ZERO_ID = new Uint8Array(32);

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

export function utf8(value: string): Uint8Array {
  return encoder.encode(value);
}

export function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();

  if (clean.length % 2 !== 0 || /[^0-9a-f]/.test(clean)) {
    throw new Error('Invalid hex string');
  }

  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** A 32-byte value as required by every `id` input. */
export function toId32(value: string | Uint8Array): Uint8Array {
  const bytes = typeof value === 'string' ? fromHex(value) : value;
  if (bytes.length !== 32) throw new Error(`Expected a 32-byte id, got ${bytes.length}`);
  return bytes;
}

/** u64 big-endian, the encoding every epoch uses on the wire. */
export function u64be(value: number | bigint): Uint8Array {
  const out = new Uint8Array(8);
  let n = BigInt(value);

  if (n < 0n) throw new Error('u64 cannot be negative');

  for (let i = 7; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);

  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// A.1 — HKDF
// ---------------------------------------------------------------------------

/**
 * Build the HKDF `info` field: `utf8(label) || 0x00 || id[32] || epoch_be[8]`.
 *
 * The epoch is the only omittable field: labels with no epoch in the registry
 * omit its 8 bytes entirely rather than passing zero.
 */
function buildInfo(
  label: string,
  id: Uint8Array,
  epoch: number | bigint | undefined,
  counter?: number
): Uint8Array {
  const parts: Uint8Array[] = [utf8(label), new Uint8Array([0x00]), id];

  if (epoch !== undefined) parts.push(u64be(epoch));
  // The scalar_normalize retry counter appends after whatever fields exist.
  if (counter !== undefined) parts.push(new Uint8Array([counter]));

  return concatBytes(...parts);
}

/**
 * Concord's HKDF: HKDF-SHA256 with a zero-length salt, 32 bytes out.
 *
 * @param secret input keying material
 * @param label a frozen label from the registry
 * @param id 32 bytes, all-zero where the label has no meaningful id
 * @param epoch omitted entirely for labels that carry no epoch
 */
export function cordHkdf(
  secret: Uint8Array,
  label: string,
  id: Uint8Array = ZERO_ID,
  epoch?: number | bigint,
  counter?: number
): Uint8Array {
  return hkdf(sha256, secret, new Uint8Array(0), buildInfo(label, id, epoch, counter), 32);
}

// ---------------------------------------------------------------------------
// A.3 — scalar_normalize
// ---------------------------------------------------------------------------

const SECP256K1_ORDER = secp256k1.Point.Fn.ORDER;

function isValidScalar(seed: Uint8Array): boolean {
  let value = 0n;
  for (const byte of seed) value = (value << 8n) | BigInt(byte);
  return value > 0n && value < SECP256K1_ORDER;
}

/**
 * Turn an HKDF seed into a valid secp256k1 secret key.
 *
 * A rejected seed is ~2^-128 rare, but the retry must be deterministic across
 * implementations: append an incrementing counter byte to the HKDF `info` and
 * derive again, starting at 0.
 */
export function scalarNormalize(
  secret: Uint8Array,
  label: string,
  id: Uint8Array,
  epoch: number | bigint | undefined,
  seed: Uint8Array
): Uint8Array {
  if (isValidScalar(seed)) return seed;

  for (let counter = 0; counter < 256; counter++) {
    const retry = cordHkdf(secret, label, id, epoch, counter);
    if (isValidScalar(retry)) return retry;
  }

  throw new Error('scalar_normalize exhausted its counter space');
}

// ---------------------------------------------------------------------------
// A.2 — group_key
// ---------------------------------------------------------------------------

/**
 * Derive a plane's stream keypair and its NIP-44 self-conversation key.
 *
 * The `pk` is the stream address (`{"kinds":[1059],"authors":[pk]}`), the `sk`
 * signs its wraps, and `convKey` — the NIP-44 self-ECDH of the pair — encrypts
 * the wrap content. Only a holder of `secret` can derive any of them, so an
 * outsider cannot even identify the address.
 */
export function groupKey(
  label: string,
  secret: Uint8Array,
  id: Uint8Array = ZERO_ID,
  epoch?: number | bigint
): CordGroupKey {
  const seed = cordHkdf(secret, label, id, epoch);
  const sk = scalarNormalize(secret, label, id, epoch, seed);
  const pk = toHex(schnorr.getPublicKey(sk));

  return { sk, pk, convKey: getConversationKey(sk, pk) };
}

// ---------------------------------------------------------------------------
// A.4 — community_id
// ---------------------------------------------------------------------------

/**
 * A community's permanent, self-certifying identity: a plain SHA-256
 * commitment to its owner, deliberately *not* the HKDF construction.
 */
export function communityId(ownerXonly: string | Uint8Array, ownerSalt: string | Uint8Array): string {
  const owner = toId32(ownerXonly);
  const salt = toId32(ownerSalt);

  return toHex(sha256(concatBytes(utf8(LABEL_COMMUNITY), owner, salt)));
}

/** Confirm a bundle's owner and salt actually produce the claimed id. */
export function verifyCommunityId(
  claimedId: string,
  ownerXonly: string,
  ownerSalt: string
): boolean {
  try {
    return communityId(ownerXonly, ownerSalt) === claimedId.trim().toLowerCase();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// A.5 — epoch-key commitment
// ---------------------------------------------------------------------------

/**
 * The continuity proof a rekey carries in `prevcommit`: a receiver recomputes
 * it over the key it currently holds and requires a match, proving the rotation
 * extends its own chain rather than a fork.
 */
export function epochKeyCommitment(prevEpoch: number | bigint, prevKey: string | Uint8Array): string {
  const key = toId32(prevKey);
  return toHex(sha256(concatBytes(utf8(LABEL_EPOCH_COMMITMENT), u64be(prevEpoch), key)));
}

// ---------------------------------------------------------------------------
// CORD-04 §1 — edition hash
// ---------------------------------------------------------------------------

/** u64 big-endian length prefix, as used by the edition preimage. */
function len64(value: number): Uint8Array {
  return u64be(value);
}

/**
 * An edition's identity, cited by its successor's `ep`.
 *
 * Every field is fixed-width or length-prefixed so distinct inputs can never
 * collide, and `content` is hashed as the exact bytes on the wire — never
 * re-serialized — so a compaction re-wrap preserves the hash.
 */
export function editionHash(
  entityId: string | Uint8Array,
  version: number,
  prev: string | undefined,
  content: string
): string {
  const label = utf8(LABEL_EDITION);
  const contentBytes = utf8(content);

  const prevPart = prev
    ? concatBytes(new Uint8Array([0x01]), toId32(prev))
    : concatBytes(new Uint8Array([0x00]), new Uint8Array(32));

  return toHex(
    sha256(
      concatBytes(
        len64(label.length),
        label,
        toId32(entityId),
        u64be(version),
        prevPart,
        len64(contentBytes.length),
        contentBytes
      )
    )
  );
}

// ---------------------------------------------------------------------------
// Rekey blob locator (CORD-06 §2)
// ---------------------------------------------------------------------------

/**
 * Where a recipient finds their blob in a rekey event.
 *
 * The inputs are deliberately public, so a NIP-46 bunker account can compute
 * its own locator without touching a raw private key. It leaks nothing to an
 * outsider: the locator list lives inside the encrypted event.
 */
export function recipientLocator(
  rotatorXonly: string,
  recipientXonly: string,
  scopeId: Uint8Array,
  epoch: number | bigint
): string {
  const ikm = concatBytes(toId32(rotatorXonly), toId32(recipientXonly));
  return toHex(cordHkdf(ikm, 'concord/recipient-pseudonym', scopeId, epoch));
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** 32 fresh random bytes, for a community root, salt, channel id, or role id. */
export function randomBytes32(): Uint8Array {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** Lowercase-hex x-only pubkey for a secret key. */
export function xonlyPubkey(sk: Uint8Array): string {
  return toHex(schnorr.getPublicKey(sk));
}

/** Validate a lowercase 64-character hex string. */
export function isHex32(value: string | undefined | null): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
