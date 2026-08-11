import { inject, Service } from '@angular/core';
import { Event } from 'nostr-tools';

import { LoggerService } from '../logger.service';
import { NostrService } from '../nostr.service';
import { AccountStateService } from '../account-state.service';
import { RelayPoolService } from '../relays/relay-pool';
import { EncryptionService } from '../encryption.service';
import {
  CORD_KIND_EDITION,
  CORD_KIND_KICK,
  CORD_KIND_SEAL_PLAINTEXT,
  CORD_MAX_PINS,
  CORD_MAX_PIN_BYTES,
  CORD_NAME_MAX_BYTES,
  CordChannelMetadata,
  CordCommunity,
  CordCommunityMetadata,
  CordEdition,
  CordGrant,
  CordGroupKey,
  CordRole,
  CordRumor,
  LABEL_BANLIST,
  LABEL_CHANNEL,
  LABEL_CONTROL,
  LABEL_CONTROL_SIGNER,
  LABEL_GRANT,
  LABEL_GUESTBOOK,
  LABEL_INVITE_LINKS,
  LABEL_PINS,
  PERM_BAN,
  PERM_KICK,
  PERM_MANAGE_CHANNELS,
  PERM_MANAGE_METADATA,
  PERM_MANAGE_ROLES,
  PERM_PIN_MESSAGES,
  VSK_BANLIST,
  VSK_CHANNEL,
  VSK_DISSOLVED,
  VSK_GRANT,
  VSK_METADATA,
  VSK_PINS,
  VSK_ROLE,
} from '../../interfaces/concord';
import {
  cordHkdf,
  communityId as deriveCommunityId,
  editionHash,
  fromHex,
  groupKey,
  randomBytes32,
  toHex,
  toId32,
  ZERO_ID,
} from './concord-crypto';
import { buildStreamEvent, splitTimestamp } from './concord-stream';
import { CordControlState, CordStanding, canActOn, hasPermission, resolveStanding } from './concord-control';

/**
 * CORD-04 authority actions: everything that lands as a Control Plane edition,
 * plus community creation and the Guestbook Kick.
 *
 * Publishing requires the staff-held control_root on an upgraded community, or
 * simply the community_root on a legacy pre-split one. That is a *spam gate*,
 * never a verdict: every reader still judges an edition by its sealed actor's
 * rank in the owner-rooted Roster, so possession of the write key can flood but
 * can never forge authority.
 */
@Service()
export class ConcordAdminService {
  private readonly logger = inject(LoggerService);
  private readonly nostr = inject(NostrService);
  private readonly accountState = inject(AccountStateService);
  private readonly relayPool = inject(RelayPoolService);
  private readonly encryption = inject(EncryptionService);

  // ---------------------------------------------------------------------------
  // Coordinates (CORD-02 A.6)
  // ---------------------------------------------------------------------------

  /** Every derived coordinate binds to the community_id, never to a key or an
   * epoch, so it survives every Refounding and a fresh joiner resolves it too. */
  grantCoordinate(communityId: string, member: string): string {
    return toHex(cordHkdf(fromHex(communityId), LABEL_GRANT, toId32(member)));
  }

  banlistCoordinate(communityId: string): string {
    return toHex(cordHkdf(fromHex(communityId), LABEL_BANLIST, ZERO_ID));
  }

  pinsCoordinate(communityId: string, channelId: string): string {
    return toHex(cordHkdf(fromHex(communityId), LABEL_PINS, toId32(channelId)));
  }

  inviteRegistryCoordinate(communityId: string, creator: string): string {
    return toHex(cordHkdf(fromHex(communityId), LABEL_INVITE_LINKS, toId32(creator)));
  }

  // ---------------------------------------------------------------------------
  // Publishing editions
  // ---------------------------------------------------------------------------

  /** The keypair that signs Control Plane wraps for this community. */
  private controlSigner(community: CordCommunity): CordGroupKey {
    if (community.controlRoot) {
      return groupKey(
        LABEL_CONTROL_SIGNER,
        fromHex(community.controlRoot),
        toId32(community.communityId),
        community.rootEpoch
      );
    }

    // Legacy pre-split: the member-derived key is both address and signer.
    return groupKey(
      LABEL_CONTROL,
      fromHex(community.communityRoot),
      toId32(community.communityId),
      community.rootEpoch
    );
  }

  /** The key whose conv_key encrypts Control Plane wraps, for every member. */
  private controlRead(community: CordCommunity): CordGroupKey {
    return groupKey(
      LABEL_CONTROL,
      fromHex(community.communityRoot),
      toId32(community.communityId),
      community.rootEpoch
    );
  }

  /** The split Control Plane write key: signer identity plus member read encryption. */
  private controlWrite(community: CordCommunity): CordGroupKey {
    const signer = this.controlSigner(community);
    const reader = this.controlRead(community);

    return { ...signer, convKey: reader.convKey };
  }

  /**
   * Publish one edition.
   *
   * The wrap is signed by the control signer but encrypted under the *read* key
   * every member derives — the write-restricted stream split of CORD-01.
   */
  async publishEdition(
    community: CordCommunity,
    state: CordControlState,
    params: {
      vsk: number;
      eid: string;
      content: string;
      /** The permission this action requires, checked before publishing. */
      requires?: bigint;
    }
  ): Promise<CordEdition> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) throw new Error('Sign in to act in this community');

    const standing = resolveStanding(state, community.owner, pubkey);

    if (params.requires && !hasPermission(standing, params.requires)) {
      throw new Error('You do not have permission to do that');
    }

    const key = `${params.vsk}:${params.eid}`;
    const head = state.heads.get(key);
    const version = (head?.version ?? 0) + 1;
    const prev = head?.hash;

    const { created_at, ms } = splitTimestamp(Date.now());

    const tags: string[][] = [
      ['vsk', String(params.vsk)],
      ['eid', params.eid],
      ['ev', String(version)],
    ];

    if (prev) tags.push(['ep', prev]);
    tags.push(['ms', ms]);

    // The authority citation: the exact Grant this actor claims their rank
    // under, pinned by coordinate, version and content hash. Absent for the
    // owner, whose rank comes from the community_id itself.
    if (!standing.isOwner) {
      const grantKey = `${VSK_GRANT}:${this.grantCoordinate(community.communityId, pubkey)}`;
      const grantHead = state.heads.get(grantKey);

      if (!grantHead) throw new Error('Your authority grant has not synced yet');
      tags.push(['vac', grantHead.eid, String(grantHead.version), grantHead.hash]);
    }

    const rumor: CordRumor = {
      kind: CORD_KIND_EDITION,
      pubkey,
      content: params.content,
      tags,
      created_at,
    };

    const wrap = await buildStreamEvent(
      this.controlWrite(community),
      rumor,
      async event => this.nostr.signEvent(event),
      {
        // The Control Plane's seals MUST be plaintext: a compaction re-wraps
        // them into a new epoch, and a signature over ciphertext could not
        // survive re-encryption.
        sealKind: CORD_KIND_SEAL_PLAINTEXT,
      }
    );

    await this.publishWrap(community, wrap);

    return {
      vsk: params.vsk,
      eid: params.eid,
      version,
      prev,
      hash: editionHash(params.eid, version, prev, params.content),
      content: params.content,
      actor: pubkey,
      createdAt: created_at,
      rumor,
      seal: {} as CordEdition['seal'],
    };
  }

  private async publishWrap(community: CordCommunity, wrap: Event): Promise<void> {
    await this.relayPool.publish(community.relays, wrap, 10000);
  }

  // ---------------------------------------------------------------------------
  // Community creation
  // ---------------------------------------------------------------------------

  /**
   * Create a community.
   *
   * Genesis is exactly two owner-signed editions: the metadata and one public
   * channel named #general. No default roles and no scaffolding — the creator
   * shapes everything else.
   */
  async createCommunity(params: {
    name: string;
    description?: string;
    relays: string[];
  }): Promise<CordCommunity> {
    const owner = this.accountState.pubkey();
    if (!owner) throw new Error('Sign in to create a community');

    if (!params.name.trim()) throw new Error('A community needs a name');
    if (byteLength(params.name) > CORD_NAME_MAX_BYTES) {
      throw new Error(`The name must be at most ${CORD_NAME_MAX_BYTES} bytes`);
    }
    if (params.relays.length === 0) throw new Error('Pick at least one relay');

    const ownerSalt = randomBytes32();
    const communityId = deriveCommunityId(owner, ownerSalt);

    // Access and identity are deliberately independent, so access can rotate
    // while the identity stays fixed.
    const communityRoot = randomBytes32();
    const controlRoot = randomBytes32();

    const community: CordCommunity = {
      communityId,
      owner,
      ownerSalt: toHex(ownerSalt),
      communityRoot: toHex(communityRoot),
      rootEpoch: 0,
      controlRoot: toHex(controlRoot),
      controlPk: groupKey(LABEL_CONTROL_SIGNER, controlRoot, fromHex(communityId), 0).pk,
      channelKeys: [],
      relays: params.relays,
      name: params.name.trim(),
      addedAt: Date.now(),
    };

    const emptyState: CordControlState = {
      channels: new Map(),
      roles: new Map(),
      grants: new Map(),
      banned: new Set(),
      inviteRegistry: new Map(),
      pins: new Map(),
      dissolved: false,
      heads: new Map(),
      suspended: new Set(),
    };

    const metadata: CordCommunityMetadata = {
      name: params.name.trim(),
      description: params.description?.trim() || '',
      relays: params.relays,
    };

    await this.publishEdition(community, emptyState, {
      vsk: VSK_METADATA,
      eid: communityId,
      content: JSON.stringify(metadata),
    });

    const generalId = toHex(randomBytes32());
    await this.publishEdition(community, emptyState, {
      vsk: VSK_CHANNEL,
      eid: generalId,
      content: JSON.stringify({ name: 'general', private: false } satisfies CordChannelMetadata),
    });

    // Announce our own arrival in the Guestbook.
    await this.publishGuestbookJoin(community);

    return community;
  }

  private async publishGuestbookJoin(community: CordCommunity): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    const key = groupKey(
      LABEL_GUESTBOOK,
      fromHex(community.communityRoot),
      toId32(community.communityId),
      community.rootEpoch
    );

    const { created_at, ms } = splitTimestamp(Date.now());

    const wrap = await buildStreamEvent(
      key,
      { kind: 3306, pubkey, content: 'join', tags: [['ms', ms]], created_at },
      async event => this.nostr.signEvent(event)
    );

    await this.publishWrap(community, wrap);
  }

  // ---------------------------------------------------------------------------
  // Channels
  // ---------------------------------------------------------------------------

  /** Create a channel. A private one mints its own independent key. */
  async createChannel(
    community: CordCommunity,
    state: CordControlState,
    params: { name: string; private: boolean }
  ): Promise<{ channelId: string; key?: string }> {
    if (byteLength(params.name) > CORD_NAME_MAX_BYTES) {
      throw new Error(`The name must be at most ${CORD_NAME_MAX_BYTES} bytes`);
    }

    const channelId = toHex(randomBytes32());

    await this.publishEdition(community, state, {
      vsk: VSK_CHANNEL,
      eid: channelId,
      content: JSON.stringify({ name: params.name.trim(), private: params.private }),
      requires: PERM_MANAGE_CHANNELS,
    });

    // A private channel needs real independence: a leaked key exposes only that
    // channel, and it rotates on its own epoch.
    return params.private
      ? { channelId, key: toHex(randomBytes32()) }
      : { channelId };
  }

  /** Publish the owner-only, terminal CORD-02 dissolution tombstone. */
  async dissolveCommunity(community: CordCommunity, state: CordControlState): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (pubkey !== community.owner) throw new Error('Only the community owner can dissolve it');
    if (state.dissolved) return;

    const edition = await this.publishEdition(community, state, {
      vsk: VSK_DISSOLVED,
      eid: community.communityId,
      content: '{}',
    });

    state.dissolved = true;
    state.heads.set(`${edition.vsk}:${edition.eid}`, edition);
  }

  async renameChannel(
    community: CordCommunity,
    state: CordControlState,
    channelId: string,
    name: string
  ): Promise<void> {
    const existing = state.channels.get(channelId);

    await this.publishEdition(community, state, {
      vsk: VSK_CHANNEL,
      eid: channelId,
      content: JSON.stringify({ name: name.trim(), private: existing?.private ?? false }),
      requires: PERM_MANAGE_CHANNELS,
    });
  }

  /** Delete a channel. Terminal: the id is never reused. */
  async deleteChannel(
    community: CordCommunity,
    state: CordControlState,
    channelId: string
  ): Promise<void> {
    const existing = state.channels.get(channelId);

    await this.publishEdition(community, state, {
      vsk: VSK_CHANNEL,
      eid: channelId,
      content: JSON.stringify({
        name: existing?.name ?? 'deleted',
        private: existing?.private ?? false,
        deleted: true,
      }),
      requires: PERM_MANAGE_CHANNELS,
    });
  }

  // ---------------------------------------------------------------------------
  // Metadata
  // ---------------------------------------------------------------------------

  async updateMetadata(
    community: CordCommunity,
    state: CordControlState,
    metadata: CordCommunityMetadata
  ): Promise<void> {
    if (byteLength(metadata.name) > CORD_NAME_MAX_BYTES) {
      throw new Error(`The name must be at most ${CORD_NAME_MAX_BYTES} bytes`);
    }

    // Round-trip whatever we do not understand: editing the name must never
    // wipe another client's fields.
    const merged = { ...(state.metadata ?? {}), ...metadata };

    await this.publishEdition(community, state, {
      vsk: VSK_METADATA,
      eid: community.communityId,
      content: JSON.stringify(merged),
      requires: PERM_MANAGE_METADATA,
    });
  }

  /** Set or clear the community-wide disappearing-messages timer (CORD-08). */
  async setMessageTimer(
    community: CordCommunity,
    state: CordControlState,
    seconds: number
  ): Promise<void> {
    await this.updateMetadata(community, state, {
      ...(state.metadata ?? { name: community.name ?? 'Community' }),
      message_expiration: seconds > 0 ? seconds : 0,
    });
  }

  // ---------------------------------------------------------------------------
  // Roles and grants
  // ---------------------------------------------------------------------------

  async saveRole(
    community: CordCommunity,
    state: CordControlState,
    role: Omit<CordRole, 'role_id'> & { role_id?: string }
  ): Promise<string> {
    if (byteLength(role.name) > CORD_NAME_MAX_BYTES) {
      throw new Error(`The name must be at most ${CORD_NAME_MAX_BYTES} bytes`);
    }
    if (role.position <= 0) {
      throw new Error('Position 0 belongs to the owner; use 1 or higher');
    }

    const roleId = role.role_id ?? toHex(randomBytes32());

    await this.publishEdition(community, state, {
      vsk: VSK_ROLE,
      eid: roleId,
      content: JSON.stringify({
        role_id: roleId,
        name: role.name.trim(),
        position: role.position,
        // Always written as a decimal string: a JSON number is a float in JS
        // and silently corrupts past 2^53.
        permissions: String(role.permissions),
        scope: role.scope ?? { kind: 'server' },
        color: role.color ?? 0,
      } satisfies CordRole),
      requires: PERM_MANAGE_ROLES,
    });

    return roleId;
  }

  /**
   * Grant roles to a member.
   *
   * A grant that first makes its member staff must deliver the control_root in
   * the same edition, pairwise-encrypted — promotion and delivery are one
   * signed action, so there is nothing separate to race or watch an inbox for.
   */
  async grantRoles(
    community: CordCommunity,
    state: CordControlState,
    member: string,
    roleIds: string[],
    options: { deliverControlRoot?: boolean } = {}
  ): Promise<void> {
    const grant: CordGrant = { member, role_ids: roleIds };

    if (options.deliverControlRoot && community.controlRoot) {
      // Fixed-width plaintext: epoch_be[8] || control_root[32] = 40 bytes.
      const payload = new Uint8Array(40);
      payload.set(u64beBytes(community.rootEpoch), 0);
      payload.set(fromHex(community.controlRoot), 8);

      grant.control_wrap = await this.encryption.encryptNip44(
        toHex(payload),
        member
      );
    }

    await this.publishEdition(community, state, {
      vsk: VSK_GRANT,
      eid: this.grantCoordinate(community.communityId, member),
      content: JSON.stringify(grant),
      requires: PERM_MANAGE_ROLES,
    });
  }

  /** Revoke every role from a member: an empty role list is the revoke. */
  async revokeRoles(
    community: CordCommunity,
    state: CordControlState,
    member: string
  ): Promise<void> {
    await this.grantRoles(community, state, member, []);
  }

  // ---------------------------------------------------------------------------
  // Bans and kicks
  // ---------------------------------------------------------------------------

  /**
   * Ban a member. This is only the *silencing* layer: honest clients drop every
   * event from a banned npub instantly. Cutting their read access needs a
   * Refounding, which is heavier and asynchronous.
   */
  async ban(
    community: CordCommunity,
    state: CordControlState,
    targets: string[]
  ): Promise<void> {
    const actor = this.requireStanding(community, state);

    for (const target of targets) {
      const victim = resolveStanding(state, community.owner, target);
      if (!canActOn(actor, victim, PERM_BAN)) {
        throw new Error('You cannot ban someone at or above your own rank');
      }
    }

    // Replaced entire on every edit, so bulk-ban rather than racing edits.
    const next = [...new Set([...state.banned, ...targets])];

    await this.publishEdition(community, state, {
      vsk: VSK_BANLIST,
      eid: this.banlistCoordinate(community.communityId),
      content: JSON.stringify(next),
      requires: PERM_BAN,
    });
  }

  async unban(
    community: CordCommunity,
    state: CordControlState,
    target: string
  ): Promise<void> {
    const next = [...state.banned].filter(pubkey => pubkey !== target);

    await this.publishEdition(community, state, {
      vsk: VSK_BANLIST,
      eid: this.banlistCoordinate(community.communityId),
      content: JSON.stringify(next),
      requires: PERM_BAN,
    });
  }

  /**
   * Kick: the cooperative removal. A compliant client tears the community down
   * locally; a defiant one still holds every key. Callers should strip the
   * target's roles first, so their rank is gone before the departure lands.
   */
  async kick(
    community: CordCommunity,
    state: CordControlState,
    target: string
  ): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) throw new Error('Sign in to act in this community');

    const actor = this.requireStanding(community, state);
    const victim = resolveStanding(state, community.owner, target);

    if (!canActOn(actor, victim, PERM_KICK)) {
      throw new Error('You cannot kick someone at or above your own rank');
    }

    const grantKey = `${VSK_GRANT}:${this.grantCoordinate(community.communityId, pubkey)}`;
    const grantHead = state.heads.get(grantKey);

    const { created_at, ms } = splitTimestamp(Date.now());
    const tags: string[][] = [['ms', ms], ['p', target]];

    if (!actor.isOwner) {
      if (!grantHead) throw new Error('Your authority grant has not synced yet');
      tags.push(['vac', grantHead.eid, String(grantHead.version), grantHead.hash]);
    }

    // A Kick lives on the Guestbook, not the Control Plane: it is membership
    // motion, never authority.
    const key = groupKey(
      LABEL_GUESTBOOK,
      fromHex(community.communityRoot),
      toId32(community.communityId),
      community.rootEpoch
    );

    const wrap = await buildStreamEvent(
      key,
      { kind: CORD_KIND_KICK, pubkey, content: '', tags, created_at },
      async event => this.nostr.signEvent(event)
    );

    await this.publishWrap(community, wrap);
  }

  // ---------------------------------------------------------------------------
  // Pins
  // ---------------------------------------------------------------------------

  /**
   * Replace a channel's pin list.
   *
   * A writer MUST NOT build an edition from a list it could not read: an empty
   * view is indistinguishable from an empty list, and publishing from one
   * silently drops every entry the writer cannot see.
   */
  async setPins(
    community: CordCommunity,
    state: CordControlState,
    channelId: string,
    content: string,
    options: { couldRead: boolean }
  ): Promise<void> {
    if (!options.couldRead) {
      throw new Error('This pin list cannot be read on this device, so it must not be replaced');
    }

    const bytes = byteLength(content);
    if (bytes > CORD_MAX_PIN_BYTES) {
      throw new Error(`Pin lists are capped at ${CORD_MAX_PIN_BYTES} bytes`);
    }

    const edition = await this.publishEdition(community, state, {
      vsk: VSK_PINS,
      eid: this.pinsCoordinate(community.communityId, channelId),
      content,
      requires: PERM_PIN_MESSAGES,
    });

    state.pins.set(edition.eid, content);
    state.heads.set(`${edition.vsk}:${edition.eid}`, edition);
  }

  /** The per-channel pin cap, surfaced so the UI can show remaining budget. */
  readonly maxPins = CORD_MAX_PINS;

  private requireStanding(community: CordCommunity, state: CordControlState): CordStanding {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) throw new Error('Sign in to act in this community');

    return resolveStanding(state, community.owner, pubkey);
  }
}

function byteLength(value: string | undefined): number {
  return value ? new TextEncoder().encode(value).length : 0;
}

function u64beBytes(value: number): Uint8Array {
  const out = new Uint8Array(8);
  let n = BigInt(value);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}
