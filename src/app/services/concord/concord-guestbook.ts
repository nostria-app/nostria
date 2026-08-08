import { Event } from 'nostr-tools';

import {
  CORD_GUESTBOOK_FUTURE_SKEW_MS,
  CORD_KIND_JOIN_LEAVE,
  CORD_KIND_KICK,
  CORD_KIND_SNAPSHOT,
  CordGroupKey,
  CordMemberState,
} from '../../interfaces/concord';
import { CordControlState, canActOn, resolveStanding } from './concord-control';
import { isMsTagValid, openStreamEvent, tagValue, tagValues } from './concord-stream';
import { PERM_KICK } from '../../interfaces/concord';

/**
 * CORD-02 §5 Guestbook: membership motion.
 *
 * The Guestbook is deliberately *off-consensus* — nothing in the Control or
 * Chat planes depends on it, so it loads last and can lag without harm. It
 * carries only self-signed Joins and Leaves, authorized Kicks, and refounder
 * snapshots; never messages and never authority.
 */

interface GuestbookEntry {
  pubkey: string;
  status: 'present' | 'departed';
  at: number;
  source: CordMemberState['source'];
  rumorId: string;
  invite?: { creator: string; label?: string };
}

/**
 * Coalesce the Guestbook flat: one final state per pubkey, latest wins.
 *
 * @param refounder the npub whose Refounding minted this epoch; only their
 * snapshots are honored, since a snapshot is secondhand attestation rather than
 * a member's own word.
 */
export function coalesceGuestbook(
  group: CordGroupKey,
  wraps: Event[],
  control: CordControlState,
  options: { owner: string; refounder?: string; now?: number } = { owner: '' }
): Map<string, CordMemberState> {
  const now = options.now ?? Date.now();
  const entries: GuestbookEntry[] = [];

  for (const wrap of wraps) {
    let opened;
    try {
      opened = openStreamEvent(group, wrap);
    } catch {
      continue;
    }

    const { rumor, author, timestamp } = opened;

    // A malformed `ms` is dropped rather than interpreted: an out-of-range
    // value would smuggle arbitrary "future" past the clock check below.
    if (!isMsTagValid(rumor.tags)) continue;

    // Deter squatting "latest" with a forged future date. One hour is ample
    // for honest clock skew.
    if (timestamp > now + CORD_GUESTBOOK_FUTURE_SKEW_MS) continue;

    switch (rumor.kind) {
      case CORD_KIND_JOIN_LEAVE: {
        const verb = rumor.content.trim();
        if (verb !== 'join' && verb !== 'leave') continue;

        const inviteTag = rumor.tags.find(tag => tag[0] === 'invite');

        entries.push({
          pubkey: author,
          status: verb === 'join' ? 'present' : 'departed',
          at: timestamp,
          source: verb === 'join' ? 'join' : 'leave',
          rumorId: rumor.id ?? '',
          invite: inviteTag?.[1] ? { creator: inviteTag[1], label: inviteTag[2] } : undefined,
        });
        break;
      }

      case CORD_KIND_KICK: {
        const target = tagValue(rumor.tags, 'p');
        if (!target) continue;

        // A Kick is honored only if its signer holds KICK and outranks the
        // target — the same rule every authority action obeys.
        const actor = resolveStanding(control, options.owner, author);
        const victim = resolveStanding(control, options.owner, target);
        if (!canActOn(actor, victim, PERM_KICK)) continue;

        entries.push({
          pubkey: target,
          status: 'departed',
          at: timestamp,
          source: 'kick',
          rumorId: rumor.id ?? '',
        });
        break;
      }

      case CORD_KIND_SNAPSHOT: {
        // Honored only from the npub whose Refounding minted this epoch.
        if (!options.refounder || author !== options.refounder) continue;

        const members = safeParse<string[]>(rumor.content);
        if (!Array.isArray(members)) continue;

        for (const pubkey of members) {
          if (typeof pubkey !== 'string') continue;

          entries.push({
            pubkey,
            // A snapshot lists present members only; absence means "no seed",
            // never a negative state.
            status: 'present',
            at: timestamp,
            source: 'snapshot',
            rumorId: rumor.id ?? '',
          });
        }
        break;
      }

      default:
        break;
    }
  }

  const byMember = new Map<string, GuestbookEntry>();

  for (const entry of entries) {
    const current = byMember.get(entry.pubkey);
    if (!current || wins(entry, current)) byMember.set(entry.pubkey, entry);
  }

  const result = new Map<string, CordMemberState>();
  for (const [pubkey, entry] of byMember) {
    result.set(pubkey, {
      pubkey,
      status: entry.status,
      at: entry.at,
      source: entry.source,
      invite: entry.invite,
    });
  }

  return result;
}

/**
 * Later wins; a tie breaks on the lower rumor id.
 *
 * A self-signed entry supersedes a snapshot at the same instant, since a
 * snapshot is only a seed for an npub's state.
 */
function wins(candidate: GuestbookEntry, current: GuestbookEntry): boolean {
  if (candidate.at !== current.at) return candidate.at > current.at;

  if (candidate.source !== 'snapshot' && current.source === 'snapshot') return true;
  if (candidate.source === 'snapshot' && current.source !== 'snapshot') return false;

  // The tie-break is author-grindable, an accepted residual: the coalesce is
  // per-npub, so an author only ever grinds ties against their own entries.
  return candidate.rumorId.localeCompare(current.rumorId) < 0;
}

/**
 * Merge the coalesced Guestbook with observed authors, minus the banlist, to
 * produce the Complete Memberlist.
 *
 * Every valid event a client decrypts names its real author, and an author seen
 * publishing is observably present — so they are auto-included even if their
 * Join never arrived. Observation only counts *forward*: activity must be newer
 * than the member's latest Leave, Kick, or Ban, or a departed member's old
 * history would resurrect them.
 */
export function completeMemberlist(
  coalesced: Map<string, CordMemberState>,
  observed: Map<string, number>,
  banned: Set<string>
): CordMemberState[] {
  const merged = new Map<string, CordMemberState>(coalesced);

  for (const [pubkey, lastSeen] of observed) {
    const existing = merged.get(pubkey);

    if (!existing) {
      merged.set(pubkey, { pubkey, status: 'present', at: lastSeen, source: 'observed' });
      continue;
    }

    if (existing.status === 'departed' && lastSeen > existing.at) {
      merged.set(pubkey, { pubkey, status: 'present', at: lastSeen, source: 'observed' });
    }
  }

  return [...merged.values()]
    .filter(member => member.status === 'present' && !banned.has(member.pubkey))
    .sort((a, b) => a.pubkey.localeCompare(b.pubkey));
}

function safeParse<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/** Build the rumor tags for a Join, optionally attributing the invite used. */
export function joinTags(
  ms: string,
  invite?: { creator: string; label?: string }
): string[][] {
  const tags: string[][] = [['ms', ms]];
  if (invite?.creator) tags.push(['invite', invite.creator, invite.label ?? '']);
  return tags;
}

export { tagValues };
