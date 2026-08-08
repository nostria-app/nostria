import { inject, Service } from '@angular/core';
import { Event, UnsignedEvent } from 'nostr-tools';

import { EncryptionService } from '../encryption.service';
import { NostrService } from '../nostr.service';
import { AccountStateService } from '../account-state.service';
import { AccountRelayService } from '../relays/account-relay';
import { DatabaseService } from '../database.service';
import { LoggerService } from '../logger.service';
import {
  CORD_KIND_COMMUNITY_LIST,
  CORD_KIND_INVITE_LIST,
  CORD_MAX_MEMBERSHIPS,
  CORD_NIP44_MAX_PLAINTEXT,
  CORD_DEFAULT_RELAYS,
  CordCommunity,
  CordInviteBundle,
} from '../../interfaces/concord';
import { RelayPoolService } from '../relays/relay-pool';

/**
 * CORD-02 §8 Community List and CORD-05 §4 Invite List.
 *
 * Both are replaceable events NIP-44-encrypted to self: a member's memberships
 * and a creator's minted links, synced across their devices *and* their clients
 * (two apps can serve one npub). Neither is community state — they are private
 * bookkeeping, and every merge must be commutative so two devices never flap
 * competing republishes.
 */

/** The membership subset of an invite bundle, as stored in the list. */
export interface CordJoinMaterial {
  community_id: string;
  owner: string;
  owner_salt: string;
  community_root: string;
  root_epoch: number;
  control_pk?: string;
  /** Present only when this member holds it (staff). */
  control_root?: string;
  channels: CordInviteBundle['channels'];
  relays: string[];
  name?: string;
}

export interface CordCommunityListEntry {
  community_id: string;
  /** The earliest epoch ever held — the anchor for full-history backfill. */
  seed: CordJoinMaterial;
  /** The freshest snapshot, so a new device reconstructs instantly. */
  current: CordJoinMaterial;
  /** Milliseconds; tiebreaks against a tombstone. */
  added_at: number;
}

export interface CordCommunityList {
  entries: CordCommunityListEntry[];
  tombstones: { community_id: string; removed_at: number }[];
  /** Anything a future revision adds, round-tripped untouched. */
  [key: string]: unknown;
}

export interface CordInviteListEntry {
  token: string;
  signer_sk: string;
  community_id: string;
  url: string;
  label?: string;
  created_at: number;
  expires_at?: number;
}

export interface CordInviteList {
  entries: CordInviteListEntry[];
  tombstones: { token: string; community_id: string }[];
  [key: string]: unknown;
}

@Service()
export class ConcordListsService {
  private readonly encryption = inject(EncryptionService);
  private readonly nostr = inject(NostrService);
  private readonly accountState = inject(AccountStateService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly database = inject(DatabaseService);
  private readonly logger = inject(LoggerService);
  private readonly relayPool = inject(RelayPoolService);

  // ---------------------------------------------------------------------------
  // Community List
  // ---------------------------------------------------------------------------

  /** Fetch and decrypt the member's Community List. */
  async loadCommunityList(): Promise<CordCommunityList> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return { entries: [], tombstones: [] };

    const event = await this.fetchSelfList(CORD_KIND_COMMUNITY_LIST);
    if (!event) return { entries: [], tombstones: [] };

    try {
      const plaintext = await this.encryption.decryptNip44(event.content, pubkey);
      const parsed = JSON.parse(plaintext) as CordCommunityList;

      return {
        ...parsed,
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
        tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : [],
      };
    } catch (error) {
      this.logger.warn('[Concord] Could not read the community list', error);
      return { entries: [], tombstones: [] };
    }
  }

  /**
   * Merge held communities into the published list and republish if it changed.
   *
   * Merges are deliberately commutative: `seed` only ever moves backward,
   * `current` only forward, and an epoch tie breaks on the lexicographically
   * lowest canonical bytes — a total order, so two devices converge instead of
   * republishing over each other forever.
   */
  async syncCommunityList(held: CordCommunity[]): Promise<CordCommunityList> {
    const remote = await this.loadCommunityList();
    const tombstoned = new Map(remote.tombstones.map(entry => [entry.community_id, entry.removed_at]));
    const byId = new Map(remote.entries.map(entry => [entry.community_id, entry]));

    let changed = false;

    for (const community of held) {
      const material = this.toJoinMaterial(community);
      const existing = byId.get(community.communityId);
      const removedAt = tombstoned.get(community.communityId);

      // The newest of added_at and removed_at wins, so a re-join legitimately
      // resurrects a membership while a backfill never re-adds a left one.
      if (removedAt !== undefined && removedAt > community.addedAt) continue;

      if (!existing) {
        byId.set(community.communityId, {
          community_id: community.communityId,
          seed: material,
          current: material,
          added_at: community.addedAt,
        });
        changed = true;
        continue;
      }

      const seed = this.lowerEpoch(existing.seed, material);
      const current = this.higherEpoch(existing.current, material);

      if (seed !== existing.seed || current !== existing.current) {
        byId.set(community.communityId, { ...existing, seed, current });
        changed = true;
      }
    }

    const entries = [...byId.values()];

    if (entries.length > CORD_MAX_MEMBERSHIPS) {
      this.logger.warn('[Concord] Community list exceeds the 50-membership cap', {
        count: entries.length,
      });
    }

    // Preserve unknown top-level fields: two clients share this document.
    const merged: CordCommunityList = { ...remote, entries, tombstones: remote.tombstones };

    if (changed) await this.publishCommunityList(merged);
    return merged;
  }

  /** Tombstone a membership. Permanent, and the entry stays in the document. */
  async tombstoneCommunity(communityId: string): Promise<void> {
    const list = await this.loadCommunityList();

    const tombstones = [
      ...list.tombstones.filter(entry => entry.community_id !== communityId),
      { community_id: communityId, removed_at: Date.now() },
    ];

    await this.publishCommunityList({ ...list, tombstones });
  }

  private async publishCommunityList(list: CordCommunityList): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    const plaintext = JSON.stringify(list);

    // The cap is a protocol constant, not client taste: join material carrying
    // private channel keys can overflow the event well below 50 memberships.
    if (new TextEncoder().encode(plaintext).length > CORD_NIP44_MAX_PLAINTEXT) {
      throw new Error(
        'This community list is too large to publish. Leave a community to make room.'
      );
    }

    const content = await this.encryption.encryptNip44(plaintext, pubkey);
    await this.publishSelfList(CORD_KIND_COMMUNITY_LIST, content);
  }

  private toJoinMaterial(community: CordCommunity): CordJoinMaterial {
    // Never the icon (a device folds it from the Control Plane) and never the
    // link fields — expiry and attribution belong to the invite, not the
    // membership.
    return {
      community_id: community.communityId,
      owner: community.owner,
      owner_salt: community.ownerSalt,
      community_root: community.communityRoot,
      root_epoch: community.rootEpoch,
      control_pk: community.controlPk,
      control_root: community.controlRoot,
      channels: community.channelKeys,
      relays: community.relays,
      name: community.name,
    };
  }

  /** Seed keeps the lower epoch; ties break on canonical bytes. */
  private lowerEpoch(a: CordJoinMaterial, b: CordJoinMaterial): CordJoinMaterial {
    if (a.root_epoch !== b.root_epoch) return a.root_epoch <= b.root_epoch ? a : b;
    return JSON.stringify(a) <= JSON.stringify(b) ? a : b;
  }

  /** Current keeps the higher epoch; ties break on canonical bytes. */
  private higherEpoch(a: CordJoinMaterial, b: CordJoinMaterial): CordJoinMaterial {
    if (a.root_epoch !== b.root_epoch) return a.root_epoch >= b.root_epoch ? a : b;
    return JSON.stringify(a) <= JSON.stringify(b) ? a : b;
  }

  /** Rebuild held communities from a synced list, for a fresh device. */
  fromCommunityList(list: CordCommunityList): CordCommunity[] {
    const tombstoned = new Map(list.tombstones.map(entry => [entry.community_id, entry.removed_at]));

    return list.entries
      .filter(entry => {
        const removedAt = tombstoned.get(entry.community_id);
        return removedAt === undefined || entry.added_at > removedAt;
      })
      .map(entry => ({
        communityId: entry.community_id,
        owner: entry.current.owner,
        ownerSalt: entry.current.owner_salt,
        communityRoot: entry.current.community_root,
        rootEpoch: entry.current.root_epoch,
        controlPk: entry.current.control_pk,
        controlRoot: entry.current.control_root,
        channelKeys: entry.current.channels ?? [],
        relays: entry.current.relays ?? [],
        name: entry.current.name,
        addedAt: entry.added_at,
      }));
  }

  // ---------------------------------------------------------------------------
  // Invite List
  // ---------------------------------------------------------------------------

  async loadInviteList(): Promise<CordInviteList> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return { entries: [], tombstones: [] };

    const event = await this.fetchSelfList(CORD_KIND_INVITE_LIST);
    if (!event) return { entries: [], tombstones: [] };

    try {
      const plaintext = await this.encryption.decryptNip44(event.content, pubkey);
      const parsed = JSON.parse(plaintext) as CordInviteList;

      return {
        ...parsed,
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
        tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : [],
      };
    } catch (error) {
      this.logger.warn('[Concord] Could not read the invite list', error);
      return { entries: [], tombstones: [] };
    }
  }

  /** Record a freshly minted link. Entries are immutable once created. */
  async addInvite(entry: CordInviteListEntry): Promise<void> {
    const list = await this.loadInviteList();

    if (list.entries.some(existing => existing.token === entry.token)) return;

    await this.publishInviteList({ ...list, entries: [...list.entries, entry] });
  }

  /** Tombstone a link. A tombstone always beats an entry, terminally. */
  async revokeInvite(token: string, communityId: string): Promise<void> {
    const list = await this.loadInviteList();

    await this.publishInviteList({
      ...list,
      entries: list.entries.filter(entry => entry.token !== token),
      tombstones: [
        ...list.tombstones.filter(entry => entry.token !== token),
        { token, community_id: communityId },
      ],
    });
  }

  private async publishInviteList(list: CordInviteList): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    const content = await this.encryption.encryptNip44(JSON.stringify(list), pubkey);
    await this.publishSelfList(CORD_KIND_INVITE_LIST, content);
  }

  // ---------------------------------------------------------------------------
  // Shared plumbing
  // ---------------------------------------------------------------------------

  /**
   * Find the newest copy of a self-encrypted list.
   *
   * The account's own relays are checked first, but another Concord client may
   * well have published the list somewhere this account never writes to — so
   * the Concord stock relays are searched too. Missing the list is not a
   * cosmetic failure: it looks exactly like "I am in no communities", and a
   * subsequent republish from this device would then overwrite the real one.
   */
  private async fetchSelfList(kind: number): Promise<Event | null> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return null;

    const candidates: (Event | null)[] = [];

    candidates.push(await this.database.getEventByPubkeyAndKind(pubkey, kind).catch(() => null));
    candidates.push(await this.accountRelay.getEventByPubkeyAndKind(pubkey, kind).catch(() => null));

    try {
      const fromStock = await this.relayPool.query(
        CORD_DEFAULT_RELAYS,
        { kinds: [kind], authors: [pubkey], limit: 1 },
        6000
      );
      candidates.push(...fromStock);
    } catch (error) {
      this.logger.debug('[Concord] Stock relay lookup failed for the self list', error);
    }

    // Replaceable events: the newest wins.
    const newest = candidates
      .filter((event): event is Event => !!event)
      .sort((a, b) => b.created_at - a.created_at)[0];

    if (newest) await this.database.saveEvent(newest).catch(() => undefined);

    return newest ?? null;
  }

  private async publishSelfList(kind: number, content: string): Promise<void> {
    const unsigned = this.nostr.createEvent(kind, content, []) as UnsignedEvent;
    const signed = await this.nostr.signEvent(unsigned);

    await this.database.saveEvent(signed).catch(() => undefined);
    await this.accountRelay.publish(signed);

    // Mirror to the Concord stock relays so other Concord clients converge on
    // the same document rather than each keeping a private fork.
    await this.relayPool
      .publish(CORD_DEFAULT_RELAYS, signed, 8000)
      .catch(error => this.logger.debug('[Concord] Stock relay mirror failed', error));
  }
}
