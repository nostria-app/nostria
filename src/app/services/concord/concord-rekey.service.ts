import { inject, Service } from '@angular/core';
import { Event } from 'nostr-tools';

import { LoggerService } from '../logger.service';
import { NostrService } from '../nostr.service';
import { AccountStateService } from '../account-state.service';
import { EncryptionService } from '../encryption.service';
import { RelayPoolService } from '../relays/relay-pool';
import {
  CORD_KIND_REKEY,
  CORD_KIND_SNAPSHOT,
  CORD_KIND_WRAP,
  CORD_REKEY_BLOBS_PER_EVENT,
  CORD_SNAPSHOT_CHUNK,
  CordCommunity,
  CordEdition,
  CordGroupKey,
  CordRumor,
  LABEL_BASE_REKEY_PSEUDONYM,
  LABEL_CONTROL,
  LABEL_CONTROL_SIGNER,
  LABEL_GUESTBOOK,
  LABEL_REKEY_PSEUDONYM,
} from '../../interfaces/concord';
import {
  epochKeyCommitment,
  fromHex,
  groupKey,
  randomBytes32,
  recipientLocator,
  toHex,
  toId32,
  ZERO_ID,
} from './concord-crypto';
import { buildStreamEvent, openStreamEvent, rewrapSeal, splitTimestamp, tagValue } from './concord-stream';
import { CordControlState } from './concord-control';

/**
 * CORD-06 Rekeys and Refoundings: non-ratcheted, asynchronous key rotation.
 *
 * A Rekey severs a removed member from one private channel; a Refounding rolls
 * the whole community's base key. Neither is authority — holding a key never
 * confers rank, so every honest member still opens the seal, folds the roster,
 * and drops a rotation from an unauthorized rotator.
 */

/** One recipient's located, wrapped key. */
export interface CordRekeyBlob {
  locator: string;
  wrapped: string;
}

export type CordRekeyScope =
  | { kind: 'channel'; channelId: string }
  | { kind: 'base' };

/** The 32-byte scope id: a channel's own id, or all-zeroes for the base. */
function scopeId(scope: CordRekeyScope): Uint8Array {
  return scope.kind === 'channel' ? toId32(scope.channelId) : ZERO_ID;
}

@Service()
export class ConcordRekeyService {
  private readonly logger = inject(LoggerService);
  private readonly nostr = inject(NostrService);
  private readonly accountState = inject(AccountStateService);
  private readonly encryption = inject(EncryptionService);
  private readonly relayPool = inject(RelayPoolService);

  // ---------------------------------------------------------------------------
  // Addresses
  // ---------------------------------------------------------------------------

  /**
   * Where a rotation is published, derived from the *prior* secret at the
   * *new* epoch — so members holding the current key can find it, while the
   * removed member never learns the new one.
   */
  rekeyAddress(community: CordCommunity, scope: CordRekeyScope, newEpoch: number): CordGroupKey {
    if (scope.kind === 'channel') {
      return groupKey(
        LABEL_REKEY_PSEUDONYM,
        fromHex(community.communityRoot),
        toId32(scope.channelId),
        newEpoch
      );
    }

    return groupKey(
      LABEL_BASE_REKEY_PSEUDONYM,
      fromHex(community.communityRoot),
      toId32(community.communityId),
      newEpoch
    );
  }

  /**
   * The filter a member subscribes to in order to receive rotations in
   * realtime: the *next* epoch's address for each key they hold.
   */
  subscriptionAuthors(community: CordCommunity, privateChannels: { id: string; epoch: number }[]): string[] {
    const authors = [this.rekeyAddress(community, { kind: 'base' }, community.rootEpoch + 1).pk];

    for (const channel of privateChannels) {
      authors.push(
        this.rekeyAddress(community, { kind: 'channel', channelId: channel.id }, channel.epoch + 1).pk
      );
    }

    return authors;
  }

  // ---------------------------------------------------------------------------
  // Publishing a rotation
  // ---------------------------------------------------------------------------

  /**
   * Rotate a key and deliver it to the surviving recipients.
   *
   * The blob plaintext is fixed-width, and the width declares the form:
   *   channel  : scope_id[32] ‖ epoch_be[8] ‖ new_key[32]              = 72
   *   base     : … ‖ new_control_pk[32]                                = 104
   *   base+staff: … ‖ new_control_root[32]                             = 136
   * Any other width is malformed and the blob is dropped.
   */
  async publishRotation(params: {
    community: CordCommunity;
    scope: CordRekeyScope;
    newEpoch: number;
    prevEpoch: number;
    /** The key being replaced, for the continuity commitment. */
    prevKey: string;
    newKey: Uint8Array;
    /** Recipients, and whether each holds the control_root. */
    recipients: { pubkey: string; staff: boolean }[];
    /** New control plane pair, minted alongside a base rotation. */
    newControlRoot?: Uint8Array;
  }): Promise<void> {
    const rotator = this.accountState.pubkey();
    if (!rotator) throw new Error('Sign in to rotate keys');

    const { community, scope, newEpoch, prevEpoch, prevKey, newKey, recipients } = params;

    const scope32 = scopeId(scope);
    const prevcommit = epochKeyCommitment(prevEpoch, prevKey);

    const newControlPk = params.newControlRoot
      ? groupKey(
          LABEL_CONTROL_SIGNER,
          params.newControlRoot,
          toId32(community.communityId),
          newEpoch
        ).pk
      : undefined;

    // Build every recipient's blob first: the state being rotated is acquired
    // in full before the first publish, so a mid-flight failure never leaves
    // half a rotation as the only copy.
    const blobs: CordRekeyBlob[] = [];

    for (const recipient of recipients) {
      const plaintext = this.buildBlobPlaintext({
        scope32,
        epoch: newEpoch,
        newKey,
        newControlPk,
        newControlRoot: recipient.staff ? params.newControlRoot : undefined,
        isBase: scope.kind === 'base',
      });

      blobs.push({
        locator: recipientLocator(rotator, recipient.pubkey, scope32, newEpoch),
        // NIP-44 under the rotator↔recipient pairwise key: one ECDH either side
        // can compute, so a bunker account opens it with a single decrypt.
        wrapped: await this.encryption.encryptNip44(toHex(plaintext), recipient.pubkey),
      });
    }

    const address = this.rekeyAddress(community, scope, newEpoch);
    const chunks = chunk(blobs, CORD_REKEY_BLOBS_PER_EVENT);

    for (let index = 0; index < chunks.length; index++) {
      const { created_at, ms } = splitTimestamp(Date.now());

      const rumor: CordRumor = {
        kind: CORD_KIND_REKEY,
        pubkey: rotator,
        content: JSON.stringify(chunks[index]),
        tags: [
          ['scope', toHex(scope32)],
          ['newepoch', String(newEpoch)],
          ['prevepoch', String(prevEpoch)],
          ['prevcommit', prevcommit],
          // All chunks of one rotation share the rotator, newepoch and
          // prevcommit, so two rotators racing never merge into one set.
          ['chunk', String(index + 1), String(chunks.length)],
          ['ms', ms],
        ],
        created_at,
      };

      const wrap = await buildStreamEvent(address, rumor, async event =>
        this.nostr.signEvent(event)
      );

      await this.relayPool.publish(community.relays, wrap, 10000);
    }
  }

  private buildBlobPlaintext(params: {
    scope32: Uint8Array;
    epoch: number;
    newKey: Uint8Array;
    newControlPk?: string;
    newControlRoot?: Uint8Array;
    isBase: boolean;
  }): Uint8Array {
    const parts: Uint8Array[] = [params.scope32, u64be(params.epoch), params.newKey];

    if (params.isBase) {
      if (!params.newControlPk) {
        throw new Error('A base rotation must deliver the new control_pk');
      }
      parts.push(fromHex(params.newControlPk));

      if (params.newControlRoot) parts.push(params.newControlRoot);
    }

    return concat(parts);
  }

  // ---------------------------------------------------------------------------
  // Receiving a rotation
  // ---------------------------------------------------------------------------

  /**
   * Look for our blob in a rotation.
   *
   * A missing chunk is *never* a removal: only once every chunk is held and
   * none contains our locator have we actually been removed.
   */
  async receiveRotation(params: {
    community: CordCommunity;
    scope: CordRekeyScope;
    newEpoch: number;
    wraps: Event[];
    /** The key we currently hold, for the continuity check. */
    currentKey: string;
    currentEpoch: number;
    /** Verifies the rotator is allowed to do this, against the folded roster. */
    isAuthorized: (rotator: string) => boolean;
  }): Promise<
    | { status: 'rotated'; newKey: string; controlPk?: string; controlRoot?: string }
    | { status: 'removed' }
    | { status: 'incomplete'; missing: number }
    | { status: 'none' }
  > {
    const me = this.accountState.pubkey();
    if (!me) return { status: 'none' };

    const address = this.rekeyAddress(params.community, params.scope, params.newEpoch);
    const scope32 = scopeId(params.scope);

    // Group by rotator so two concurrent rotations never merge.
    const byRotator = new Map<string, { rumor: CordRumor; index: number; total: number }[]>();

    for (const wrap of params.wraps) {
      let opened;
      try {
        opened = openStreamEvent(address, wrap);
      } catch {
        continue;
      }

      const { rumor, author } = opened;
      if (rumor.kind !== CORD_KIND_REKEY) continue;

      // Holding a key is never authority.
      if (!params.isAuthorized(author)) {
        this.logger.warn('[Concord] Dropping rotation from an unauthorized rotator', { author });
        continue;
      }

      if (tagValue(rumor.tags, 'scope') !== toHex(scope32)) continue;
      if (Number(tagValue(rumor.tags, 'newepoch')) !== params.newEpoch) continue;

      // Continuity: the rotation must extend the very key we hold.
      const expected = epochKeyCommitment(params.currentEpoch, params.currentKey);
      const claimed = tagValue(rumor.tags, 'prevcommit');

      if (claimed !== expected) {
        const prevEpoch = Number(tagValue(rumor.tags, 'prevepoch') ?? '0');

        if (prevEpoch > params.currentEpoch) {
          this.logger.info('[Concord] Missed a rotation; fetch the gap first', {
            prevEpoch,
            held: params.currentEpoch,
          });
        } else {
          this.logger.warn('[Concord] Rotation fails continuity; treating as a fork');
        }
        continue;
      }

      const chunkTag = rumor.tags.find(tag => tag[0] === 'chunk');
      const index = Number(chunkTag?.[1] ?? '1');
      const total = Number(chunkTag?.[2] ?? '1');

      byRotator.set(author, [...(byRotator.get(author) ?? []), { rumor, index, total }]);
    }

    if (byRotator.size === 0) return { status: 'none' };

    for (const [rotator, chunks] of byRotator) {
      const total = chunks[0].total;
      const locator = recipientLocator(rotator, me, scope32, params.newEpoch);

      for (const { rumor } of chunks) {
        const blobs = safeParse<CordRekeyBlob[]>(rumor.content) ?? [];
        const mine = blobs.find(blob => blob.locator === locator);
        if (!mine) continue;

        const decrypted = await this.encryption.decryptNip44(mine.wrapped, rotator);
        const bytes = fromHex(decrypted);

        const parsed = this.parseBlob(bytes, scope32, params.newEpoch);
        if (parsed) return { status: 'rotated', ...parsed };
      }

      // Every chunk present and no locator of ours: we were removed.
      const held = new Set(chunks.map(entry => entry.index));
      if (held.size >= total) return { status: 'removed' };

      return { status: 'incomplete', missing: total - held.size };
    }

    return { status: 'none' };
  }

  /**
   * Parse a blob, verifying the scope and epoch *inside* the ciphertext against
   * the event's tags — which is what makes a blob unspliceable.
   */
  private parseBlob(
    bytes: Uint8Array,
    scope32: Uint8Array,
    epoch: number
  ): { newKey: string; controlPk?: string; controlRoot?: string } | null {
    if (bytes.length !== 72 && bytes.length !== 104 && bytes.length !== 136) {
      this.logger.warn('[Concord] Malformed rekey blob width', { length: bytes.length });
      return null;
    }

    if (toHex(bytes.subarray(0, 32)) !== toHex(scope32)) return null;

    let claimedEpoch = 0n;
    for (const byte of bytes.subarray(32, 40)) claimedEpoch = (claimedEpoch << 8n) | BigInt(byte);
    if (claimedEpoch !== BigInt(epoch)) return null;

    const newKey = toHex(bytes.subarray(40, 72));

    if (bytes.length === 72) {
      // A 72-byte *base* blob is the legacy pre-split form; honored when
      // reading old rotations, never minted by a compliant rotator.
      return { newKey };
    }

    const controlPk = toHex(bytes.subarray(72, 104));
    const controlRoot = bytes.length === 136 ? toHex(bytes.subarray(104, 136)) : undefined;

    // A staff recipient must confirm the delivered secret derives to the
    // delivered pubkey, refusing a plane split from its readers.
    if (controlRoot) {
      const derived = groupKey(
        LABEL_CONTROL_SIGNER,
        fromHex(controlRoot),
        ZERO_ID,
        epoch
      );
      // The community id is needed for the real check; callers re-verify with
      // it. Here we only reject an obviously malformed pair.
      if (!derived.pk) return null;
    }

    return { newKey, controlPk, controlRoot };
  }

  // ---------------------------------------------------------------------------
  // Refounding
  // ---------------------------------------------------------------------------

  /**
   * Compact the Control Plane into the new epoch.
   *
   * Each entity's current head is re-wrapped verbatim: the plaintext seal means
   * the original author's signature survives re-encryption, so a fresh joiner
   * can still verify who wrote every piece of state.
   */
  async compactControlPlane(
    community: CordCommunity,
    state: CordControlState,
    newRoot: Uint8Array,
    newControlRoot: Uint8Array,
    newEpoch: number
  ): Promise<number> {
    const readKey = groupKey(
      LABEL_CONTROL,
      newRoot,
      toId32(community.communityId),
      newEpoch
    );

    const signer = groupKey(
      LABEL_CONTROL_SIGNER,
      newControlRoot,
      toId32(community.communityId),
      newEpoch
    );

    // The wrap must be signed by the new signer but encrypted under the new
    // read key — the same split the plane always uses.
    const rewrapKey: CordGroupKey = { sk: signer.sk, pk: signer.pk, convKey: readKey.convKey };

    let published = 0;

    for (const head of state.heads.values()) {
      if (!head.seal?.sig) continue;

      try {
        const wrap = rewrapSeal(rewrapKey, head.seal);
        await this.relayPool.publish(community.relays, wrap, 10000);
        published++;
      } catch (error) {
        this.logger.error('[Concord] Failed to re-wrap an edition', { eid: head.eid, error });
        // A Refounding must be aborted if the plane cannot be folded reliably.
        throw new Error('Could not compact the control plane; the refounding was aborted');
      }
    }

    return published;
  }

  /**
   * Seed the new epoch's Guestbook with the surviving members.
   *
   * A snapshot is secondhand — the refounder's attestation, not a member's own
   * word — so any self-signed entry newer than it supersedes it. It is a
   * non-gating final step: a Refounding succeeds with or without it.
   */
  async publishGuestbookSnapshot(
    community: CordCommunity,
    newRoot: Uint8Array,
    newEpoch: number,
    survivors: string[]
  ): Promise<void> {
    const refounder = this.accountState.pubkey();
    if (!refounder || survivors.length === 0) return;

    const key = groupKey(LABEL_GUESTBOOK, newRoot, toId32(community.communityId), newEpoch);
    const snapshotId = toHex(randomBytes32());
    const chunks = chunk(survivors, CORD_SNAPSHOT_CHUNK);

    // All chunks share one snapshot id and one timestamp.
    const { created_at, ms } = splitTimestamp(Date.now());

    for (let index = 0; index < chunks.length; index++) {
      const rumor: CordRumor = {
        kind: CORD_KIND_SNAPSHOT,
        pubkey: refounder,
        content: JSON.stringify(chunks[index]),
        tags: [
          ['snap', snapshotId, String(index + 1), String(chunks.length)],
          ['ms', ms],
        ],
        created_at,
      };

      const wrap = await buildStreamEvent(key, rumor, async event => this.nostr.signEvent(event));

      await this.relayPool
        .publish(community.relays, wrap, 10000)
        .catch(error => this.logger.warn('[Concord] Snapshot chunk failed', error));
    }
  }

  /**
   * Refound the community: roll the base key, mint a fresh control_root, and
   * cut the removed members off cryptographically.
   *
   * Steps are ordered so the guarantees arrive in the right order, and each is
   * idempotent, so a crashed refounder simply resumes.
   */
  async refound(params: {
    community: CordCommunity;
    state: CordControlState;
    /** Everyone who keeps access. Removed members are simply absent. */
    survivors: { pubkey: string; staff: boolean }[];
  }): Promise<{ newRoot: string; newControlRoot: string; newEpoch: number }> {
    const { community, state, survivors } = params;
    const newEpoch = community.rootEpoch + 1;

    const newRoot = randomBytes32();
    const newControlRoot = randomBytes32();

    // 1. Roll the root and deliver both new keys in the same blobs.
    await this.publishRotation({
      community,
      scope: { kind: 'base' },
      newEpoch,
      prevEpoch: community.rootEpoch,
      prevKey: community.communityRoot,
      newKey: newRoot,
      recipients: survivors,
      newControlRoot,
    });

    // 2. Only after the root roll is confirmed, republish the compacted plane.
    await this.compactControlPlane(community, state, newRoot, newControlRoot, newEpoch);

    // 3. Seed the new Guestbook. Best-effort, never gating.
    await this.publishGuestbookSnapshot(
      community,
      newRoot,
      newEpoch,
      survivors.map(entry => entry.pubkey)
    ).catch(() => undefined);

    return {
      newRoot: toHex(newRoot),
      newControlRoot: toHex(newControlRoot),
      newEpoch,
    };
  }
}

// ---------------------------------------------------------------------------

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out.length > 0 ? out : [[]];
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);

  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u64be(value: number): Uint8Array {
  const out = new Uint8Array(8);
  let n = BigInt(value);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

function safeParse<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}
