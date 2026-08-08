import { finalizeEvent, getEventHash, verifyEvent, type Event, type UnsignedEvent } from 'nostr-tools';
import { encrypt as nip44Encrypt, decrypt as nip44Decrypt } from 'nostr-tools/nip44';

import {
  CORD_KIND_SEAL_ENCRYPTED,
  CORD_KIND_SEAL_PLAINTEXT,
  CORD_KIND_WRAP,
  CORD_KIND_WRAP_EPHEMERAL,
  CORD_NIP44_MAX_PLAINTEXT,
  CordGroupKey,
  CordRumor,
  CordSealEvent,
} from '../../interfaces/concord';
import { randomBytes32, toHex, xonlyPubkey } from './concord-crypto';

/**
 * CORD-01 Private Streams: the wrap / seal / rumor envelope.
 *
 * A stream event looks like a NIP-59 giftwrap and blends into giftwrap traffic,
 * but reverses it: the author is *fixed* (the stream's derived key) and the `p`
 * tag is *ephemeral*. That inversion is what lets every keyholder subscribe by
 * author — and it is why Concord only works on relays that do not enforce
 * NIP-59's optional "serve only to the p-tagged recipient" guard.
 */

/** The result of opening a stream event. */
export interface CordOpenedEvent {
  /** The innermost event, carrying the functional kind. */
  rumor: CordRumor;
  /** The real author, proven by the seal's signature. */
  author: string;
  /** The seal, retained verbatim so the Control Plane can re-wrap it. */
  seal: CordSealEvent;
  /** The outer wrap's event id, an unverifiable locator hint at best. */
  wrapId: string;
  /** created_at * 1000 + the `ms` tag, the basis every comparison uses. */
  timestamp: number;
}

/** Thrown when a wrap cannot be opened; carries a reason for diagnostics. */
export class CordOpenError extends Error {
  constructor(
    message: string,
    readonly reason:
      | 'wrap-decrypt'
      | 'seal-parse'
      | 'seal-kind'
      | 'seal-signature'
      | 'rumor-decrypt'
      | 'rumor-parse'
      | 'impersonation'
      | 'oversize'
  ) {
    super(message);
    this.name = 'CordOpenError';
  }
}

/**
 * Enforce NIP-44's plaintext cap ourselves at every nesting layer.
 *
 * Libraries are lenient about this, and a lenient publisher mints events a
 * strict reader cannot decrypt — so the cap is checked on the way out.
 */
function assertWithinNip44Cap(plaintext: string, layer: string): void {
  const size = new TextEncoder().encode(plaintext).length;

  if (size > CORD_NIP44_MAX_PLAINTEXT) {
    throw new CordOpenError(
      `${layer} is ${size} bytes, over NIP-44's ${CORD_NIP44_MAX_PLAINTEXT}-byte plaintext cap`,
      'oversize'
    );
  }
}

/** Extract the sub-second remainder, ignoring a malformed value. */
export function msTagValue(tags: string[][]): number {
  const raw = tags.find(tag => tag[0] === 'ms')?.[1];
  if (raw === undefined) return 0;

  const value = Number(raw);
  // An `ms` outside 0..999 is malformed; treating it as 0 keeps ordering sane,
  // while callers that must reject the entry check `isMsTagValid` instead.
  return Number.isInteger(value) && value >= 0 && value <= 999 ? value : 0;
}

/**
 * Whether an `ms` tag is well-formed. The Guestbook drops rather than clamps a
 * bad one, since an out-of-range value would smuggle arbitrary "future" past
 * the clock check (CORD-02 §5).
 */
export function isMsTagValid(tags: string[][]): boolean {
  const raw = tags.find(tag => tag[0] === 'ms')?.[1];
  if (raw === undefined) return true;

  if (!/^\d+$/.test(raw)) return false;
  const value = Number(raw);
  return value >= 0 && value <= 999;
}

/** True event time in milliseconds (CORD-02 §4). */
export function eventTimestamp(rumor: { created_at: number; tags: string[][] }): number {
  return rumor.created_at * 1000 + msTagValue(rumor.tags);
}

/** Split a millisecond time into the `created_at` / `ms` tag pair. */
export function splitTimestamp(millis: number): { created_at: number; ms: string } {
  const created_at = Math.floor(millis / 1000);
  return { created_at, ms: String(millis - created_at * 1000) };
}

/** Compute a rumor's id from its own bytes; an embedded id is never trusted. */
export function rumorId(rumor: CordRumor): string {
  return getEventHash({
    kind: rumor.kind,
    pubkey: rumor.pubkey,
    content: rumor.content,
    tags: rumor.tags,
    created_at: rumor.created_at,
  } as UnsignedEvent);
}

/**
 * Serialize a rumor for the plaintext seal.
 *
 * The field order is fixed so two clients produce byte-identical output — a
 * plaintext seal's content must round-trip verbatim across a compaction re-wrap
 * or its signature breaks.
 */
export function serializeRumor(rumor: CordRumor): string {
  return JSON.stringify({
    id: rumor.id ?? rumorId(rumor),
    kind: rumor.kind,
    pubkey: rumor.pubkey,
    content: rumor.content,
    tags: rumor.tags,
    created_at: rumor.created_at,
  });
}

/** A signer for the author's real key; matches NostrService.signEvent. */
export type CordSigner = (event: UnsignedEvent) => Promise<Event>;

/**
 * Build a stream event: rumor → seal (signed by the author) → wrap (signed by
 * the plane's derived key).
 *
 * @param sealKind 20013 encrypts the rumor again inside the wrap; 20014 carries
 * it as verbatim JSON and is used only by the Control Plane, whose editions
 * must survive re-wrapping into a new epoch with their signatures intact.
 */
export async function buildStreamEvent(
  group: CordGroupKey,
  rumor: CordRumor,
  sign: CordSigner,
  options: { sealKind?: number; ephemeral?: boolean } = {}
): Promise<Event> {
  const sealKind = options.sealKind ?? CORD_KIND_SEAL_ENCRYPTED;
  const wrapKind = options.ephemeral ? CORD_KIND_WRAP_EPHEMERAL : CORD_KIND_WRAP;

  const complete: CordRumor = { ...rumor, id: rumor.id ?? rumorId(rumor) };
  const serialized = serializeRumor(complete);
  assertWithinNip44Cap(serialized, 'rumor');

  // The seal declares its form by kind, so a reader never sniffs the content.
  const sealContent =
    sealKind === CORD_KIND_SEAL_PLAINTEXT ? serialized : nip44Encrypt(serialized, group.convKey);

  const seal = await sign({
    kind: sealKind,
    pubkey: complete.pubkey,
    content: sealContent,
    tags: [],
    // created_at is never tweaked; sub-second ordering rides the `ms` tag.
    created_at: complete.created_at,
  } as UnsignedEvent);

  const sealJson = JSON.stringify(seal);
  assertWithinNip44Cap(sealJson, 'seal');

  // NIP-59 reversed: the author is the stream, the `p` tag is throwaway.
  const ephemeralPubkey = xonlyPubkey(randomBytes32());

  const wrapTags: string[][] = [['p', ephemeralPubkey]];

  // NIP-40 rides the wrap so relays can actually delete the ciphertext.
  const expiration = complete.tags.find(tag => tag[0] === 'expiration')?.[1];
  if (expiration) wrapTags.push(['expiration', expiration]);

  return finalizeEvent(
    {
      kind: wrapKind,
      content: nip44Encrypt(sealJson, group.convKey),
      tags: wrapTags,
      created_at: complete.created_at,
    },
    group.sk
  );
}

/**
 * Open a stream event, returning the rumor and its proven author.
 *
 * Verification order matters: the wrap's own signature is checked by the caller
 * against the plane's address (a wrap that does not verify is not ours), then
 * the seal's signature proves authorship, then the rumor's `pubkey` must equal
 * the seal's — NIP-59's impersonation check, because renderers display rumor
 * fields.
 */
export function openStreamEvent(group: CordGroupKey, wrap: Event): CordOpenedEvent {
  let sealJson: string;
  try {
    sealJson = nip44Decrypt(wrap.content, group.convKey);
  } catch (error) {
    throw new CordOpenError(`Could not decrypt the wrap: ${describe(error)}`, 'wrap-decrypt');
  }

  let seal: CordSealEvent;
  try {
    seal = JSON.parse(sealJson) as CordSealEvent;
  } catch (error) {
    throw new CordOpenError(`Seal is not valid JSON: ${describe(error)}`, 'seal-parse');
  }

  if (seal.kind !== CORD_KIND_SEAL_ENCRYPTED && seal.kind !== CORD_KIND_SEAL_PLAINTEXT) {
    throw new CordOpenError(`Unexpected seal kind ${seal.kind}`, 'seal-kind');
  }

  if (!verifyEvent(seal as unknown as Event)) {
    throw new CordOpenError('Seal signature is invalid', 'seal-signature');
  }

  let rumorJson: string;
  if (seal.kind === CORD_KIND_SEAL_PLAINTEXT) {
    // Verbatim: never re-serialize, or the hash and signature diverge.
    rumorJson = seal.content;
  } else {
    try {
      rumorJson = nip44Decrypt(seal.content, group.convKey);
    } catch (error) {
      throw new CordOpenError(`Could not decrypt the rumor: ${describe(error)}`, 'rumor-decrypt');
    }
  }

  let rumor: CordRumor;
  try {
    rumor = JSON.parse(rumorJson) as CordRumor;
  } catch (error) {
    throw new CordOpenError(`Rumor is not valid JSON: ${describe(error)}`, 'rumor-parse');
  }

  if (rumor.pubkey !== seal.pubkey) {
    throw new CordOpenError('Rumor author does not match the seal', 'impersonation');
  }

  // Recompute rather than trust: the id is the entry's identity everywhere.
  rumor.id = rumorId(rumor);

  return {
    rumor,
    author: seal.pubkey,
    seal,
    wrapId: wrap.id,
    timestamp: eventTimestamp(rumor),
  };
}

/**
 * Re-wrap an already-signed seal at a new address without touching its bytes.
 *
 * This is what a Refounding's compaction does: a plaintext seal's signature
 * survives because the content it signed is unchanged — only the envelope is
 * re-encrypted under the new epoch's key.
 */
export function rewrapSeal(group: CordGroupKey, seal: CordSealEvent): Event {
  const sealJson = JSON.stringify(seal);
  assertWithinNip44Cap(sealJson, 'seal');

  return finalizeEvent(
    {
      kind: CORD_KIND_WRAP,
      content: nip44Encrypt(sealJson, group.convKey),
      tags: [['p', xonlyPubkey(randomBytes32())]],
      created_at: seal.created_at,
    },
    group.sk
  );
}

/** Confirm a wrap was signed by the plane's key before spending effort on it. */
export function isWrapForPlane(group: CordGroupKey, wrap: Event): boolean {
  return wrap.pubkey === group.pk;
}

/** Read a tag's first value. */
export function tagValue(tags: string[][], name: string): string | undefined {
  return tags.find(tag => tag[0] === name)?.[1];
}

/** Read every value of a repeated tag. */
export function tagValues(tags: string[][], name: string): string[] {
  return tags.filter(tag => tag[0] === name && tag[1]).map(tag => tag[1]);
}

/** Random 32-byte id as lowercase hex, for channel ids and role ids. */
export function randomId(): string {
  return toHex(randomBytes32());
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
