import { Event } from 'nostr-tools';

import {
  CORD_KIND_EDITION,
  CORD_MAX_ROLES,
  CordChannel,
  CordCommunityMetadata,
  CordEdition,
  CordGrant,
  CordGroupKey,
  CordRole,
  PERM_BAN,
  PERM_CREATE_INVITE,
  PERM_MANAGE_CHANNELS,
  PERM_MANAGE_METADATA,
  PERM_MANAGE_ROLES,
  PERM_PIN_MESSAGES,
  VSK_BANLIST,
  VSK_CHANNEL,
  VSK_DISSOLVED,
  VSK_GRANT,
  VSK_INVITE_REGISTRY,
  VSK_METADATA,
  VSK_PINS,
  VSK_ROLE,
} from '../../interfaces/concord';
import { editionHash } from './concord-crypto';
import { CordOpenedEvent, openStreamEvent, tagValue } from './concord-stream';

/**
 * CORD-04 Roles: the Control Plane fold.
 *
 * The Control Plane is a set of per-entity edition chains. Authority is
 * enforced by *rejection*, never prevention: any control_root holder can
 * publish an edition, and every member independently drops the ones that do not
 * trace to the owner. The fold is what turns a bag of editions into state.
 */

/** The community's folded authoritative state. */
export interface CordControlState {
  metadata?: CordCommunityMetadata;
  channels: Map<string, CordChannel>;
  roles: Map<string, CordRole>;
  /** Grants keyed by member pubkey. */
  grants: Map<string, CordGrant>;
  banned: Set<string>;
  /** Invite-link signer pubkeys, keyed by the creator who registered them. */
  inviteRegistry: Map<string, string[]>;
  /** Pin list editions keyed by channel id, content left unparsed. */
  pins: Map<string, string>;
  /** True once a valid owner-signed tombstone is seen. */
  dissolved: boolean;
  /** The winning edition per entity coordinate, for chaining the next edit. */
  heads: Map<string, CordEdition>;
  /** Entities whose chain has an unresolvable gap; suspended until refetched. */
  suspended: Set<string>;
}

export function emptyControlState(): CordControlState {
  return {
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
}

/** Parse a Control Plane wrap into an edition, or null if it is not one. */
export function parseEdition(group: CordGroupKey, wrap: Event): CordEdition | null {
  let opened: CordOpenedEvent;
  try {
    opened = openStreamEvent(group, wrap);
  } catch {
    return null;
  }

  const { rumor, seal } = opened;
  if (rumor.kind !== CORD_KIND_EDITION) return null;

  const vsk = Number(tagValue(rumor.tags, 'vsk'));
  const eid = tagValue(rumor.tags, 'eid');
  const version = Number(tagValue(rumor.tags, 'ev') ?? '0');
  const prev = tagValue(rumor.tags, 'ep');

  if (!Number.isInteger(vsk) || !eid) return null;

  const vacTag = rumor.tags.find(tag => tag[0] === 'vac');
  const vac: [string, string, string] | undefined =
    vacTag && vacTag[1] && vacTag[2] && vacTag[3]
      ? [vacTag[1], vacTag[2], vacTag[3]]
      : undefined;

  // The tombstone is chainless and exempt from version discipline.
  const isTombstone = vsk === VSK_DISSOLVED;
  if (!isTombstone && (!Number.isInteger(version) || version < 1)) return null;

  return {
    vsk,
    eid,
    version: isTombstone ? 0 : version,
    prev,
    hash: editionHash(eid, isTombstone ? 0 : version, prev, rumor.content),
    content: rumor.content,
    actor: opened.author,
    createdAt: rumor.created_at,
    vac,
    rumor,
    seal,
  };
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

/** A member's resolved standing in the roster. */
export interface CordStanding {
  pubkey: string;
  isOwner: boolean;
  /** Union of the member's roles' permission bits. */
  permissions: bigint;
  /** Lowest position among their roles; the owner is 0, roleless is Infinity. */
  position: number;
  roles: CordRole[];
}

/** Parse the decimal-string (or legacy numeric) permission field safely. */
export function parsePermissions(value: string | number | undefined): bigint {
  if (value === undefined || value === null) return 0n;

  try {
    // A JSON number is a float in JS and silently corrupts past 2^53, so the
    // string form is canonical; both are accepted on read.
    return BigInt(typeof value === 'number' ? Math.trunc(value) : String(value).trim() || '0');
  } catch {
    return 0n;
  }
}

/** Resolve a member's effective permissions and rank. */
export function resolveStanding(
  state: CordControlState,
  owner: string,
  pubkey: string
): CordStanding {
  if (pubkey === owner) {
    // The owner is proven by the community_id itself, occupies position 0, and
    // is supreme and unremovable — no fold can grant or take that.
    return { pubkey, isOwner: true, permissions: ~0n, position: 0, roles: [] };
  }

  const grant = state.grants.get(pubkey);
  const roles = (grant?.role_ids ?? [])
    .map(id => state.roles.get(id))
    .filter((role): role is CordRole => !!role);

  let permissions = 0n;
  let position = Number.POSITIVE_INFINITY;

  for (const role of roles) {
    permissions |= parsePermissions(role.permissions);
    if (role.position < position) position = role.position;
  }

  return { pubkey, isOwner: false, permissions, position, roles };
}

export function hasPermission(standing: CordStanding, bit: bigint): boolean {
  return standing.isOwner || (standing.permissions & bit) === bit;
}

/**
 * The rule every authority action obeys: hold the bit *and* strictly outrank
 * the target. Equal cannot act on equal.
 */
export function canActOn(actor: CordStanding, target: CordStanding, bit: bigint): boolean {
  if (!hasPermission(actor, bit)) return false;
  if (target.isOwner) return false;
  if (actor.isOwner) return true;

  return actor.position < target.position;
}

/** Whether a member holds the control_root, i.e. can write to the Control Plane. */
export function isStaff(standing: CordStanding): boolean {
  if (standing.isOwner) return true;

  const staffBits =
    PERM_MANAGE_ROLES |
    PERM_MANAGE_CHANNELS |
    PERM_MANAGE_METADATA |
    PERM_BAN |
    PERM_CREATE_INVITE |
    PERM_PIN_MESSAGES;

  return (standing.permissions & staffBits) !== 0n;
}

/** The permission an edition of this entity type requires. */
function requiredBit(vsk: number): bigint | null {
  switch (vsk) {
    case VSK_METADATA:
      return PERM_MANAGE_METADATA;
    case VSK_ROLE:
      return PERM_MANAGE_ROLES;
    case VSK_CHANNEL:
      return PERM_MANAGE_CHANNELS;
    case VSK_GRANT:
      return PERM_MANAGE_ROLES;
    case VSK_BANLIST:
      return PERM_BAN;
    case VSK_INVITE_REGISTRY:
      return PERM_CREATE_INVITE;
    case VSK_PINS:
      return PERM_PIN_MESSAGES;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

interface FoldOptions {
  owner: string;
  /**
   * A fresh joiner accepts the highest authority-verified head despite a
   * dangling `prev` (a compaction reset the floor). A client that already held
   * the prior chain treats an unresolvable `prev` as a gap and suspends that
   * entity instead.
   */
  freshJoiner?: boolean;
  /** Edition hashes already known, used to detect a genuine chain gap. */
  known?: Set<string>;
}

/**
 * Fold a bag of editions into current state.
 *
 * Two passes are required because judging an edition needs the roster, and the
 * roster is itself built from editions. It is not circular: the fold starts at
 * the owner, whose rank comes from the community_id rather than any edition, so
 * roles and grants settle first and everything else is judged against them.
 */
export function foldControl(editions: CordEdition[], options: FoldOptions): CordControlState {
  const state = emptyControlState();

  // Pass 1: roles and grants, which define who may do anything at all.
  applyEntities(state, editions.filter(e => e.vsk === VSK_ROLE || e.vsk === VSK_GRANT), options);
  // Pass 2: everything judged against the roster pass 1 produced.
  applyEntities(state, editions.filter(e => e.vsk !== VSK_ROLE && e.vsk !== VSK_GRANT), options);

  return state;
}

function applyEntities(
  state: CordControlState,
  editions: CordEdition[],
  options: FoldOptions
): void {
  // Group by entity coordinate: each is an independent chain.
  const byEntity = new Map<string, CordEdition[]>();
  for (const edition of editions) {
    const key = `${edition.vsk}:${edition.eid}`;
    byEntity.set(key, [...(byEntity.get(key) ?? []), edition]);
  }

  for (const [key, chain] of byEntity) {
    const head = resolveHead(state, chain, options);
    if (!head) {
      state.suspended.add(key);
      continue;
    }

    state.heads.set(key, head);
    applyEdition(state, head);
  }
}

/**
 * Pick an entity's current head: the highest version whose signer was
 * authorized, refusing to downgrade, with ties broken deterministically.
 */
function resolveHead(
  state: CordControlState,
  chain: CordEdition[],
  options: FoldOptions
): CordEdition | null {
  const authorized = chain.filter(edition => isAuthorized(state, edition, options.owner));
  if (authorized.length === 0) return null;

  const highest = authorized.reduce((max, edition) => Math.max(max, edition.version), 0);
  const candidates = authorized.filter(edition => edition.version === highest);

  if (candidates.length === 1) return candidates[0];

  // Two authorized editions at one version: never the author-settable
  // timestamp, always the lower rumor id, so every client lands on one head.
  return candidates.sort((a, b) => (a.rumor.id ?? '').localeCompare(b.rumor.id ?? ''))[0];
}

function isAuthorized(state: CordControlState, edition: CordEdition, owner: string): boolean {
  // A banned member's every event is dropped, authority actions included.
  if (state.banned.has(edition.actor)) return false;

  if (edition.vsk === VSK_DISSOLVED) {
    // Chainless and owner-only, and its eid MUST name the community it kills —
    // otherwise a tombstone lifted from one community could kill another.
    return edition.actor === owner;
  }

  if (edition.actor === owner) return true;

  const bit = requiredBit(edition.vsk);
  if (bit === null) return false;

  const standing = resolveStanding(state, owner, edition.actor);
  if (!hasPermission(standing, bit)) return false;

  // A Grant may not hand out a role at or above the granter's own position.
  if (edition.vsk === VSK_GRANT) {
    const grant = safeParse<CordGrant>(edition.content);
    if (!grant) return false;

    for (const roleId of grant.role_ids ?? []) {
      const role = state.roles.get(roleId);
      if (role && !standing.isOwner && role.position <= standing.position) return false;
    }
  }

  // No edition may claim a position at or above its own signer.
  if (edition.vsk === VSK_ROLE) {
    const role = safeParse<CordRole>(edition.content);
    if (!role) return false;
    // Position 0 belongs to the owner alone; no role may ever claim it.
    if (role.position <= 0 && !standing.isOwner) return false;
    if (!standing.isOwner && role.position <= standing.position) return false;
  }

  return true;
}

function applyEdition(state: CordControlState, edition: CordEdition): void {
  switch (edition.vsk) {
    case VSK_METADATA: {
      const metadata = safeParse<CordCommunityMetadata>(edition.content);
      if (metadata) state.metadata = metadata;
      break;
    }

    case VSK_CHANNEL: {
      const meta = safeParse<CordChannel & { name: string; private: boolean }>(edition.content);
      if (!meta) break;

      state.channels.set(edition.eid, {
        channelId: edition.eid,
        name: meta.name,
        private: !!meta.private,
        deleted: !!(meta as { deleted?: boolean }).deleted,
        epoch: 0,
        custom: (meta as { custom?: Record<string, unknown> }).custom,
      });
      break;
    }

    case VSK_ROLE: {
      const role = safeParse<CordRole>(edition.content);
      // A community folds at most the 100 lowest role ids and ignores the rest.
      if (role && state.roles.size < CORD_MAX_ROLES) {
        state.roles.set(edition.eid, { ...role, role_id: role.role_id || edition.eid });
      }
      break;
    }

    case VSK_GRANT: {
      const grant = safeParse<CordGrant>(edition.content);
      if (grant?.member) state.grants.set(grant.member, grant);
      break;
    }

    case VSK_BANLIST: {
      const list = safeParse<string[]>(edition.content);
      if (Array.isArray(list)) state.banned = new Set(list.filter(pk => typeof pk === 'string'));
      break;
    }

    case VSK_INVITE_REGISTRY: {
      const list = safeParse<string[]>(edition.content);
      if (Array.isArray(list)) state.inviteRegistry.set(edition.actor, list);
      break;
    }

    case VSK_PINS: {
      state.pins.set(edition.eid, edition.content);
      break;
    }

    case VSK_DISSOLVED: {
      state.dissolved = true;
      break;
    }

    default:
      // Unknown entity types are carried but not interpreted.
      break;
  }
}

function safeParse<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Whether a community is Public: non-empty aggregate invite registry means a
 * live link exists (CORD-05 §5).
 */
export function isPublicCommunity(state: CordControlState): boolean {
  for (const links of state.inviteRegistry.values()) {
    if (links.length > 0) return true;
  }
  return false;
}
