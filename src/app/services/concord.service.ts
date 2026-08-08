import { computed, effect, inject, PLATFORM_ID, Service, signal, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Event, Filter, UnsignedEvent } from 'nostr-tools';
import {
  encrypt as nip44EncryptWithKey,
  decrypt as nip44DecryptWithKey,
} from 'nostr-tools/nip44';

import { LoggerService } from './logger.service';
import { NostrService } from './nostr.service';
import { AccountStateService } from './account-state.service';
import { RelayPoolService } from './relays/relay-pool';
import { DatabaseService } from './database.service';
import { ConcordListsService } from './concord/concord-lists.service';
import { EmojiSetService } from './emoji-set.service';
import {
  buildPinEntry,
  buildPinListContent,
  parsePinList,
  verifyPinEntry,
  type CordPinEntry,
  type CordVerifiedPin,
} from './concord/concord-pins';
import {
  CORD_KIND_DELETE,
  CORD_KIND_EDIT,
  CORD_KIND_MESSAGE,
  CORD_KIND_REACTION,
  CORD_KIND_REPLY,
  CORD_KIND_TYPING,
  CORD_KIND_WRAP,
  CordChannel,
  CordCommunity,
  CordInviteBundle,
  CordMemberState,
  CordMessage,
  CordReaction,
  CordRumor,
  LABEL_CHANNEL,
  LABEL_CONTROL,
  LABEL_CONTROL_SIGNER,
  LABEL_GUESTBOOK,
  LABEL_PINS,
} from '../interfaces/concord';
import {
  cordHkdf,
  fromHex,
  groupKey,
  isHex32,
  toHex,
  toId32,
} from './concord/concord-crypto';
import {
  buildStreamEvent,
  eventTimestamp,
  openStreamEvent,
  splitTimestamp,
  tagValue,
  tagValues,
} from './concord/concord-stream';
import {
  CordControlState,
  CordStanding,
  emptyControlState,
  foldControl,
  hasPermission,
  isPublicCommunity,
  isStaff,
  parseEdition,
  resolveStanding,
} from './concord/concord-control';
import { coalesceGuestbook, completeMemberlist, joinTags } from './concord/concord-guestbook';
import {
  decryptInviteBundle,
  isInviteExpired,
  parseInviteLink,
  validateInviteBundle,
} from './concord/concord-invite';
import { CordGroupKey } from '../interfaces/concord';

const STORAGE_KEY_COMMUNITIES = 'nostria-concord-communities-v1';
const STORAGE_KEY_BROKER = 'nostria-concord-voice-broker-v1';

/** How long a folded Control Plane stays fresh before a background refetch. */
const CONTROL_TTL_MS = 5 * 60 * 1000;
/** Messages fetched on first opening a channel. */
const MESSAGE_PAGE_SIZE = 100;

interface Closeable {
  close: () => void;
}

/**
 * Concord: end-to-end encrypted communities (the CORD specs).
 *
 * Unlike NIP-29 there is no authoritative relay. Relays only ever carry sealed
 * blobs addressed to derived, rotating pubkeys, so every plane must be derived
 * locally before it can even be found, and all authority is re-verified by this
 * client against an owner-rooted roster.
 *
 * Relay budget follows the same discipline as the NIP-29 service: the control
 * fold is cached behind a TTL, only the open channel holds a live subscription,
 * and identical concurrent requests are de-duplicated.
 */
@Service()
export class ConcordService {
  private readonly logger = inject(LoggerService);
  private readonly nostr = inject(NostrService);
  private readonly accountState = inject(AccountStateService);
  private readonly relayPool = inject(RelayPoolService);
  private readonly database = inject(DatabaseService);
  private readonly lists = inject(ConcordListsService);
  private readonly emojiSets = inject(EmojiSetService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Communities this client holds keys for. */
  readonly communities = signal<CordCommunity[]>([]);

  /** Folded Control Plane state, keyed by community id. */
  private readonly controlByCommunity = signal<Record<string, CordControlState>>({});
  private readonly controlFetchedAt = new Map<string, number>();

  /** Chat messages keyed by `<communityId>|<channelId>`. */
  private readonly messagesByChannel = signal<Record<string, CordMessage[]>>({});

  /** Guestbook + observed members keyed by community id. */
  private readonly membersByCommunity = signal<Record<string, CordMemberState[]>>({});

  /** Authors observed publishing, per community, for the memberlist merge. */
  private readonly observed = new Map<string, Map<string, number>>();

  /**
   * The A/V broker this client prefers (CORD-07).
   *
   * Deliberately unset by default: brokers are operator-run, the protocol
   * defines no well-known list, and pointing calls at an unverified host would
   * hand it every participant's IP and connection timing. Rendezvous still
   * joins whatever broker peers are already using, so this only matters when
   * you open an empty room.
   */
  readonly voiceBroker = signal<string>('');

  /** True while the kind:10009-equivalent membership list is syncing. */
  readonly syncing = signal(false);

  readonly loadingCommunity = signal<string | null>(null);
  readonly loadingMessages = signal(false);
  readonly sending = signal(false);

  private readonly inflight = new Map<string, Promise<unknown>>();
  private activeSubscriptions: Closeable[] = [];
  private activeChannelKey: string | null = null;

  readonly pubkey = computed(() => this.accountState.pubkey());

  constructor() {
    this.restore();

    // Communities are keyed to an account. On sign-in, pull the membership list
    // so communities joined on another device or client appear here too; on
    // sign-out, drop the live subscriptions.
    effect(() => {
      const pubkey = this.accountState.pubkey();

      untracked(() => {
        if (!pubkey) {
          this.closeSubscriptions();
          return;
        }

        void this.syncMemberships();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Lookups
  // ---------------------------------------------------------------------------

  channelKey(communityId: string, channelId: string): string {
    return `${communityId}|${channelId}`;
  }

  getCommunity(communityId: string): CordCommunity | undefined {
    return this.communities().find(entry => entry.communityId === communityId);
  }

  getControl(communityId: string): CordControlState {
    return this.controlByCommunity()[communityId] ?? emptyControlState();
  }

  getMessages(communityId: string, channelId: string): CordMessage[] {
    return this.messagesByChannel()[this.channelKey(communityId, channelId)] ?? [];
  }

  getMembers(communityId: string): CordMemberState[] {
    return this.membersByCommunity()[communityId] ?? [];
  }

  /** Channels a member can actually open: folded, undeleted, and readable. */
  getChannels(communityId: string): CordChannel[] {
    const community = this.getCommunity(communityId);
    const control = this.getControl(communityId);
    if (!community) return [];

    return [...control.channels.values()]
      .filter(channel => !channel.deleted)
      .map(channel => {
        // A private channel is readable only if the invite delivered its key.
        const held = community.channelKeys.find(entry => entry.id === channel.channelId);
        return {
          ...channel,
          key: held?.key,
          epoch: held?.epoch ?? community.rootEpoch,
        };
      })
      .filter(channel => !channel.private || !!channel.key)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The signed-in member's standing in a community. */
  standing(communityId: string): CordStanding | null {
    const community = this.getCommunity(communityId);
    const pubkey = this.pubkey();
    if (!community || !pubkey) return null;

    return resolveStanding(this.getControl(communityId), community.owner, pubkey);
  }

  can(communityId: string, bit: bigint): boolean {
    const standing = this.standing(communityId);
    return !!standing && hasPermission(standing, bit);
  }

  isStaffHere(communityId: string): boolean {
    const standing = this.standing(communityId);
    return !!standing && isStaff(standing);
  }

  isPublic(communityId: string): boolean {
    return isPublicCommunity(this.getControl(communityId));
  }

  // ---------------------------------------------------------------------------
  // Plane derivations
  // ---------------------------------------------------------------------------

  /**
   * The Control Plane's read key: its conv_key decrypts every wrap, and on a
   * legacy pre-split community its pk is also the address and wrap signer.
   */
  private controlReadKey(community: CordCommunity): CordGroupKey {
    return groupKey(
      LABEL_CONTROL,
      fromHex(community.communityRoot),
      toId32(community.communityId),
      community.rootEpoch
    );
  }

  /**
   * The address to subscribe to for the Control Plane.
   *
   * A community minted before the control_root split has no `control_pk`; its
   * plane lives at the member-derived legacy address, which a client must
   * retain to read such communities at all (CORD-06 §3).
   */
  private controlAddress(community: CordCommunity): string {
    return community.controlPk || this.controlReadKey(community).pk;
  }

  /** The staff-only signer, present only once a community has been upgraded. */
  private controlSignerKey(community: CordCommunity): CordGroupKey | null {
    if (!community.controlRoot) return null;

    return groupKey(
      LABEL_CONTROL_SIGNER,
      fromHex(community.controlRoot),
      toId32(community.communityId),
      community.rootEpoch
    );
  }

  private guestbookKey(community: CordCommunity): CordGroupKey {
    return groupKey(
      LABEL_GUESTBOOK,
      fromHex(community.communityRoot),
      toId32(community.communityId),
      community.rootEpoch
    );
  }

  /**
   * A channel's stream key.
   *
   * Public channels derive from the community_root and rotate for free with the
   * base; private ones carry an independent key and their own epoch, so a leak
   * exposes only that channel.
   */
  private channelGroupKey(community: CordCommunity, channel: CordChannel): CordGroupKey {
    const secret = channel.key ? fromHex(channel.key) : fromHex(community.communityRoot);
    const epoch = channel.key ? channel.epoch : community.rootEpoch;

    return groupKey(LABEL_CHANNEL, secret, toId32(channel.channelId), epoch);
  }

  // ---------------------------------------------------------------------------
  // Joining
  // ---------------------------------------------------------------------------

  /** Preview an invite without joining: nothing is published or subscribed. */
  async previewInvite(link: string): Promise<{ bundle: CordInviteBundle; relays: string[] }> {
    const parsed = parseInviteLink(link);
    const relays = [...new Set(parsed.relays)];

    if (relays.length === 0) throw new Error('This invite names no relays');

    const events = await this.relayPool.query(
      relays,
      { kinds: [33301], authors: [parsed.pointer.pubkey], limit: 5 },
      8000
    );

    if (events.length === 0) throw new Error('The invite bundle could not be found');

    // A revocation tombstone replaces the bundle at the same coordinate, and is
    // exactly as durable as what it replaced.
    const live = events
      .filter(event => tagValue(event.tags, 'vsk') !== '9')
      .sort((a, b) => b.created_at - a.created_at)[0];

    if (!live) throw new Error('This invite link has been revoked');

    const bundle = decryptInviteBundle(live.content, parsed.token);

    if (isInviteExpired(bundle)) throw new Error('This invite link has expired');

    return { bundle, relays: [...new Set([...relays, ...bundle.relays])] };
  }

  /**
   * Accept an invite: keep the keys, announce a Join, and load the community.
   * Possession of the keys *is* membership — the Join is courtesy, not a gate.
   */
  async joinFromInvite(link: string): Promise<string> {
    const { bundle, relays } = await this.previewInvite(link);
    const communityId = await this.adoptBundle(bundle, relays);

    await this.publishJoin(communityId, bundle.creator_npub, bundle.label);
    await this.loadCommunity(communityId, true);

    return communityId;
  }

  /** Adopt a validated bundle (from a link or a Direct Invite) as membership. */
  async adoptBundle(bundle: CordInviteBundle, extraRelays: string[] = []): Promise<string> {
    const validated = validateInviteBundle(bundle);

    const community: CordCommunity = {
      communityId: validated.community_id,
      owner: validated.owner,
      ownerSalt: validated.owner_salt,
      communityRoot: validated.community_root,
      rootEpoch: validated.root_epoch,
      controlPk: validated.control_pk,
      controlRoot: validated.control_root,
      channelKeys: validated.channels,
      relays: [...new Set([...validated.relays, ...extraRelays])],
      name: validated.name,
      addedAt: Date.now(),
    };

    this.communities.update(list => {
      const existing = list.find(entry => entry.communityId === community.communityId);
      if (!existing) return [...list, community];

      // Merge rather than replace: never lose a channel key or the control_root
      // we already hold, and only ever move forward in epoch.
      return list.map(entry =>
        entry.communityId === community.communityId
          ? {
              ...community,
              controlRoot: community.controlRoot ?? entry.controlRoot,
              channelKeys: mergeChannelKeys(entry.channelKeys, community.channelKeys),
              rootEpoch: Math.max(entry.rootEpoch, community.rootEpoch),
              addedAt: entry.addedAt,
            }
          : entry
      );
    });

    this.persist();

    // Record it in the membership list so the member's other devices and
    // clients pick it up.
    void this.lists
      .syncCommunityList(this.communities())
      .catch(error => this.logger.warn('[Concord] Could not publish the membership list', error));

    return community.communityId;
  }

  /** Publish a self-signed Join to the Guestbook. */
  async publishJoin(communityId: string, inviteCreator?: string, label?: string): Promise<void> {
    const community = this.getCommunity(communityId);
    const pubkey = this.pubkey();
    if (!community || !pubkey) return;

    const { created_at, ms } = splitTimestamp(Date.now());

    await this.publishRumor(
      community,
      this.guestbookKey(community),
      {
        kind: 3306,
        pubkey,
        content: 'join',
        tags: joinTags(ms, inviteCreator ? { creator: inviteCreator, label } : undefined),
        created_at,
      }
    );
  }

  /** Publish a Leave and forget the community's keys locally. */
  async leaveCommunity(communityId: string): Promise<void> {
    const community = this.getCommunity(communityId);
    const pubkey = this.pubkey();

    if (community && pubkey) {
      const { created_at, ms } = splitTimestamp(Date.now());

      await this.publishRumor(community, this.guestbookKey(community), {
        kind: 3306,
        pubkey,
        content: 'leave',
        tags: [['ms', ms]],
        created_at,
      }).catch(error => this.logger.warn('[Concord] Leave failed to publish', error));
    }

    this.closeSubscriptions();
    this.communities.update(list => list.filter(entry => entry.communityId !== communityId));
    this.persist();

    // A tombstone is permanent: without it, the next sync would re-adopt the
    // community from our own published list.
    await this.lists
      .tombstoneCommunity(communityId)
      .catch(error => this.logger.warn('[Concord] Could not tombstone the membership', error));
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  /** Fold a community's Control Plane and Guestbook. */
  async loadCommunity(communityId: string, force = false): Promise<void> {
    const community = this.getCommunity(communityId);
    if (!community) return;

    const age = Date.now() - (this.controlFetchedAt.get(communityId) ?? 0);
    if (!force && age < CONTROL_TTL_MS) return;

    await this.dedupe(`community:${communityId}`, async () => {
      this.loadingCommunity.set(communityId);

      try {
        const readKey = this.controlReadKey(community);
        const address = this.controlAddress(community);

        const wraps = await this.relayPool.query(
          community.relays,
          { kinds: [CORD_KIND_WRAP], authors: [address], limit: 1000 },
          10000
        );

        const editions = wraps
          .map(wrap => parseEdition(readKey, wrap))
          .filter((edition): edition is NonNullable<typeof edition> => !!edition);

        const state = foldControl(editions, {
          owner: community.owner,
          // We hold no prior chain across a compaction unless we were tracking,
          // so treat a first load as a fresh joiner.
          freshJoiner: !this.controlByCommunity()[communityId],
        });

        this.controlByCommunity.update(current => ({ ...current, [communityId]: state }));
        this.controlFetchedAt.set(communityId, Date.now());

        // The Guestbook is off-consensus, so it never blocks the Control fold.
        void this.loadGuestbook(communityId);
      } catch (error) {
        this.logger.error('[Concord] Failed to load community', { communityId, error });
      } finally {
        this.loadingCommunity.set(null);
      }
    });
  }

  private async loadGuestbook(communityId: string): Promise<void> {
    const community = this.getCommunity(communityId);
    if (!community) return;

    try {
      const key = this.guestbookKey(community);

      const wraps = await this.relayPool.query(
        community.relays,
        { kinds: [CORD_KIND_WRAP], authors: [key.pk], limit: 1000 },
        8000
      );

      const control = this.getControl(communityId);
      const coalesced = coalesceGuestbook(key, wraps, control, {
        owner: community.owner,
        refounder: community.owner,
      });

      const members = completeMemberlist(
        coalesced,
        this.observed.get(communityId) ?? new Map(),
        control.banned
      );

      this.membersByCommunity.update(current => ({ ...current, [communityId]: members }));
    } catch (error) {
      this.logger.debug('[Concord] Guestbook load failed', { communityId, error });
    }
  }

  // ---------------------------------------------------------------------------
  // Channels
  // ---------------------------------------------------------------------------

  /** Open a channel: load history, then attach the single live subscription. */
  async openChannel(communityId: string, channelId: string): Promise<void> {
    const community = this.getCommunity(communityId);
    const channel = this.getChannels(communityId).find(entry => entry.channelId === channelId);
    if (!community || !channel) return;

    const key = this.channelKey(communityId, channelId);
    if (this.activeChannelKey === key) return;

    this.closeSubscriptions();
    this.activeChannelKey = key;
    this.loadingMessages.set(true);

    try {
      const group = this.channelGroupKey(community, channel);

      // Paint from the local cache first so the channel opens instantly.
      await this.loadCachedMessages(communityId, channel);
      if (this.activeChannelKey !== key) return;

      const newest = this.getMessages(communityId, channel.channelId).at(-1);

      const filter: Filter = {
        kinds: [CORD_KIND_WRAP],
        authors: [group.pk],
        limit: MESSAGE_PAGE_SIZE,
      };

      // Ask only for the delta. The wrap's created_at is untweaked in Concord,
      // so it can be compared directly; a small overlap absorbs clock skew.
      if (newest) filter.since = Math.floor(newest.timestamp / 1000) - 60;

      const wraps = await this.relayPool.query(community.relays, filter, 10000);

      if (this.activeChannelKey !== key) return;

      this.ingest(communityId, channel, group, wraps);
      this.subscribeToChannel(communityId, channel, group);
    } catch (error) {
      this.logger.error('[Concord] Failed to open channel', { key, error });
    } finally {
      if (this.activeChannelKey === key) this.loadingMessages.set(false);
    }
  }

  private subscribeToChannel(
    communityId: string,
    channel: CordChannel,
    group: CordGroupKey
  ): void {
    const community = this.getCommunity(communityId);
    if (!community) return;

    const key = this.channelKey(communityId, channel.channelId);
    const since = Math.floor(Date.now() / 1000);

    const subscription = this.relayPool.subscribe(
      community.relays,
      { kinds: [CORD_KIND_WRAP], authors: [group.pk], since },
      event => {
        if (this.activeChannelKey !== key) return;
        this.ingest(communityId, channel, group, [event]);
      }
    );

    this.activeSubscriptions = [subscription];
  }

  /**
   * Decrypt wraps into the timeline, applying edits, deletes and reactions.
   *
   * Every rumor must commit `channel` and `epoch` matching the key that opened
   * it (CORD-03 §3), so no member can re-wrap another's message into a
   * different channel or replay it across an epoch.
   */
  private ingest(
    communityId: string,
    channel: CordChannel,
    group: CordGroupKey,
    wraps: Event[],
    options: { persist?: boolean } = {}
  ): void {
    const key = this.channelKey(communityId, channel.channelId);
    const control = this.getControl(communityId);
    const existing = new Map(this.getMessages(communityId, channel.channelId).map(m => [m.id, m]));

    const edits = new Map<string, { content: string; at: number; author: string }>();
    const deletes = new Map<string, string>();
    const reactions: { target: string; reaction: CordReaction }[] = [];
    const observed = this.observed.get(communityId) ?? new Map<string, number>();

    for (const wrap of wraps) {
      let opened;
      try {
        opened = openStreamEvent(group, wrap);
      } catch {
        continue;
      }

      const { rumor, author, timestamp, seal, wrapId } = opened;

      // A banned member vanishes entirely — messages, reactions, everything.
      if (control.banned.has(author)) continue;

      // The binding check: strict-equal against the channel and epoch whose key
      // decrypted this wrap; absence fails.
      if (tagValue(rumor.tags, 'channel') !== channel.channelId) continue;
      const epochTag = tagValue(rumor.tags, 'epoch');
      if (epochTag === undefined || Number(epochTag) !== channel.epoch) continue;

      // NIP-40: never store an already-expired rumor.
      const expiration = Number(tagValue(rumor.tags, 'expiration') ?? '0');
      if (expiration > 0 && expiration * 1000 <= Date.now()) continue;

      observed.set(author, Math.max(observed.get(author) ?? 0, timestamp));

      switch (rumor.kind) {
        case CORD_KIND_MESSAGE:
        case CORD_KIND_REPLY: {
          const message = this.toMessage(channel.channelId, rumor, author, timestamp);
          // Pinning needs the seal verbatim and the wrap id as a locator hint.
          message.seal = seal;
          message.wrapId = wrapId;
          existing.set(rumor.id!, message);
          break;
        }

        case CORD_KIND_EDIT: {
          const target = tagValue(rumor.tags, 'e');
          if (!target) break;

          const current = edits.get(target);
          if (!current || timestamp > current.at) {
            edits.set(target, { content: rumor.content, at: timestamp, author });
          }
          break;
        }

        case CORD_KIND_DELETE: {
          for (const target of tagValues(rumor.tags, 'e')) deletes.set(target, author);
          break;
        }

        case CORD_KIND_REACTION: {
          const target = tagValue(rumor.tags, 'e');
          if (target) {
            const { emoji, url } = this.parseReaction(rumor);

            reactions.push({
              target,
              reaction: { emoji, pubkey: author, timestamp, url },
            });
          }
          break;
        }

        default:
          break;
      }
    }

    this.observed.set(communityId, observed);

    // Only the author may edit or delete their own message.
    for (const [target, edit] of edits) {
      const message = existing.get(target);
      if (message && message.pubkey === edit.author) {
        message.editedContent = edit.content;
        message.editedAt = edit.at;
      }
    }

    for (const [target, author] of deletes) {
      const message = existing.get(target);
      if (message && message.pubkey === author) message.deleted = true;
    }

    for (const { target, reaction } of reactions) {
      const message = existing.get(target);
      if (!message) continue;

      message.reactions = [
        ...(message.reactions ?? []).filter(
          entry => !(entry.pubkey === reaction.pubkey && entry.emoji === reaction.emoji)
        ),
        reaction,
      ];
    }

    const ordered = [...existing.values()]
      .filter(message => !message.deleted)
      .sort((a, b) => a.timestamp - b.timestamp);

    this.messagesByChannel.update(current => ({ ...current, [key]: ordered }));

    if (options.persist !== false) {
      void this.persistRumors(channel.channelId, wraps, group);
    }
  }

  /**
   * Cache decrypted rumors locally so a channel opens instantly next time.
   *
   * Only the inner rumor is stored, never the wrap: the wrap is useless without
   * the channel key, and the rumor is what the timeline renders. Rumors are
   * unsigned by construction (the seal carries the signature), so they are
   * stored with an empty `sig` and are never republished from here.
   */
  private async persistRumors(
    channelId: string,
    wraps: Event[],
    group: CordGroupKey
  ): Promise<void> {
    const events: (Event & { dTag?: string })[] = [];

    for (const wrap of wraps) {
      try {
        const { rumor } = openStreamEvent(group, wrap);

        events.push({
          id: rumor.id!,
          kind: rumor.kind,
          pubkey: rumor.pubkey,
          content: rumor.content,
          tags: rumor.tags,
          created_at: rumor.created_at,
          sig: '',
        } as Event);
      } catch {
        // Not ours, or already reported by the caller.
      }
    }

    if (events.length === 0) return;

    try {
      await this.database.saveEvents(events);
    } catch (error) {
      this.logger.debug('[Concord] Could not cache messages', { channelId, error });
    }
  }

  /**
   * Load a channel's cached history from IndexedDB.
   *
   * Cached rumors are rendered immediately, then the relay is asked only for
   * what arrived since the newest one — the same delta discipline the NIP-29
   * chat uses, so reopening a channel costs one small request rather than a
   * full backfill.
   */
  private async loadCachedMessages(communityId: string, channel: CordChannel): Promise<void> {
    const key = this.channelKey(communityId, channel.channelId);

    try {
      const cached = await this.database.getEventsByKindsAndTagValue(
        [CORD_KIND_MESSAGE, CORD_KIND_REPLY, CORD_KIND_REACTION, CORD_KIND_DELETE, CORD_KIND_EDIT],
        'channel',
        channel.channelId
      );

      if (cached.length === 0) return;

      const messages: CordMessage[] = [];
      const edits = new Map<string, { content: string; at: number; author: string }>();
      const deletes = new Map<string, string>();
      const reactions: { target: string; reaction: CordReaction }[] = [];

      for (const event of cached) {
        // The binding still has to hold, even from our own cache.
        if (tagValue(event.tags, 'channel') !== channel.channelId) continue;

        const timestamp = eventTimestamp(event);
        const rumor = event as unknown as CordRumor;

        switch (event.kind) {
          case CORD_KIND_MESSAGE:
          case CORD_KIND_REPLY:
            messages.push(this.toMessage(channel.channelId, rumor, event.pubkey, timestamp));
            break;
          case CORD_KIND_EDIT: {
            const target = tagValue(event.tags, 'e');
            if (target) edits.set(target, { content: event.content, at: timestamp, author: event.pubkey });
            break;
          }
          case CORD_KIND_DELETE:
            for (const target of tagValues(event.tags, 'e')) deletes.set(target, event.pubkey);
            break;
          case CORD_KIND_REACTION: {
            const target = tagValue(event.tags, 'e');
            if (target) {
              const { emoji, url } = this.parseReaction(rumor);
              reactions.push({ target, reaction: { emoji, pubkey: event.pubkey, timestamp, url } });
            }
            break;
          }
          default:
            break;
        }
      }

      const byId = new Map(messages.map(message => [message.id, message]));

      for (const [target, edit] of edits) {
        const message = byId.get(target);
        if (message && message.pubkey === edit.author) {
          message.editedContent = edit.content;
          message.editedAt = edit.at;
        }
      }

      for (const [target, author] of deletes) {
        const message = byId.get(target);
        if (message && message.pubkey === author) message.deleted = true;
      }

      for (const { target, reaction } of reactions) {
        const message = byId.get(target);
        if (!message) continue;
        message.reactions = [...(message.reactions ?? []), reaction];
      }

      const ordered = [...byId.values()]
        .filter(message => !message.deleted)
        .sort((a, b) => a.timestamp - b.timestamp);

      this.messagesByChannel.update(current => ({ ...current, [key]: ordered }));
    } catch (error) {
      this.logger.debug('[Concord] No cached history available', { channelId: channel.channelId, error });
    }
  }

  /**
   * Normalize a reaction into an emoji and, for custom ones, its image URL.
   *
   * Three shapes occur in the wild: a plain emoji, a `:shortcode:` with a
   * NIP-30 `emoji` tag, and — from some clients — a `:shortcode:` with the URL
   * concatenated straight onto the content. The last renders as raw text
   * unless it is split apart here.
   */
  private parseReaction(rumor: CordRumor): { emoji: string; url?: string } {
    const raw = (rumor.content || '+').trim();

    // `:shortcode:https://…` — split the glued-on URL back off.
    const glued = raw.match(/^(:[a-zA-Z0-9_]+:)\s*(https?:\/\/\S+)$/);
    if (glued) {
      return { emoji: glued[1], url: glued[2] };
    }

    // A bare URL used as the whole reaction.
    if (/^https?:\/\/\S+$/.test(raw)) {
      return { emoji: ':custom:', url: raw };
    }

    const shortcode = raw.replace(/^:|:$/g, '');
    const emojiTag = rumor.tags.find(
      tag => tag[0] === 'emoji' && (tag[1] === shortcode || `:${tag[1]}:` === raw)
    );

    return { emoji: raw, url: emojiTag?.[2] };
  }

  private toMessage(
    channelId: string,
    rumor: CordRumor,
    author: string,
    timestamp: number
  ): CordMessage {
    const threadRoot = rumor.tags.find(tag => tag[0] === 'E')?.[1];
    const parent = rumor.tags.find(tag => tag[0] === 'e')?.[1];

    return {
      id: rumor.id!,
      channelId,
      pubkey: author,
      content: rumor.content,
      timestamp,
      kind: rumor.kind,
      threadRoot,
      parent: rumor.kind === CORD_KIND_REPLY ? parent : undefined,
      quote: tagValue(rumor.tags, 'q'),
      expiration: Number(tagValue(rumor.tags, 'expiration') ?? '0') || undefined,
      rumor,
    };
  }

  // ---------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------

  /** Send a chat message, optionally as an inline quote or a threaded reply. */
  async sendMessage(
    communityId: string,
    channelId: string,
    content: string,
    options: { quote?: CordMessage; replyTo?: CordMessage } = {}
  ): Promise<boolean> {
    const community = this.getCommunity(communityId);
    const channel = this.getChannels(communityId).find(entry => entry.channelId === channelId);
    const pubkey = this.pubkey();
    const trimmed = content.trim();

    if (!community || !channel || !pubkey || !trimmed) return false;

    this.sending.set(true);

    try {
      const { created_at, ms } = splitTimestamp(Date.now());
      const tags: string[][] = [
        ['channel', channel.channelId],
        ['epoch', String(channel.epoch)],
        ['ms', ms],
      ];

      // The community-wide disappearing timer, computed from this rumor's own
      // created_at so a message keeps the expiry it was sent under.
      const timer = this.getControl(communityId).metadata?.message_expiration ?? 0;
      if (timer > 0) tags.push(['expiration', String(created_at + timer)]);

      // NIP-30: carry the URL for every custom emoji the text mentions.
      tags.push(...(await this.emojiTags(trimmed)));

      let kind = CORD_KIND_MESSAGE;

      if (options.replyTo) {
        // A threaded reply is a NIP-22 comment, distinct from an inline quote.
        kind = CORD_KIND_REPLY;
        const root = options.replyTo.threadRoot ?? options.replyTo.id;
        const rootAuthor = options.replyTo.threadRoot
          ? (options.replyTo.rumor.tags.find(tag => tag[0] === 'P')?.[1] ?? options.replyTo.pubkey)
          : options.replyTo.pubkey;

        tags.push(['K', String(options.replyTo.threadRoot ? CORD_KIND_MESSAGE : options.replyTo.kind)]);
        tags.push(['E', root, '', rootAuthor]);
        tags.push(['P', rootAuthor]);
        tags.push(['k', String(options.replyTo.kind)]);
        tags.push(['e', options.replyTo.id, '', options.replyTo.pubkey]);
        tags.push(['p', options.replyTo.pubkey]);
      } else if (options.quote) {
        tags.push(['q', options.quote.id, '', options.quote.pubkey]);
      }

      await this.publishRumor(
        community,
        this.channelGroupKey(community, channel),
        { kind, pubkey, content: trimmed, tags, created_at },
        { expiration: timer > 0 ? String(created_at + timer) : undefined }
      );

      return true;
    } catch (error) {
      this.logger.error('[Concord] Failed to send message', error);
      return false;
    } finally {
      this.sending.set(false);
    }
  }

  /**
   * Resolve `:shortcode:` references to NIP-30 `emoji` tags.
   *
   * Without these the shortcode stays literal text for every other client, so
   * outgoing messages must carry the URL for each custom emoji they mention.
   */
  private async emojiTags(content: string): Promise<string[][]> {
    const pubkey = this.pubkey();
    if (!pubkey) return [];

    const matches = [...content.matchAll(/:([a-zA-Z0-9_]+):/g)];
    if (matches.length === 0) return [];

    try {
      const available = await this.emojiSets.getUserEmojiSets(pubkey);
      const tags: string[][] = [];
      const seen = new Set<string>();

      for (const match of matches) {
        const shortcode = match[1];
        if (seen.has(shortcode)) continue;

        const url = available.get(shortcode) ?? available.get(`:${shortcode}:`);
        if (!url) continue;

        seen.add(shortcode);
        tags.push(['emoji', shortcode, url]);
      }

      return tags;
    } catch (error) {
      this.logger.debug('[Concord] Could not resolve custom emoji', error);
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Pins (CORD-04 §7)
  // ---------------------------------------------------------------------------

  /**
   * The verified pins for a channel.
   *
   * `readable` is false when the list is sealed under a key epoch this client
   * never held — which must be surfaced as "unavailable" rather than "no pins",
   * because a writer must never rebuild a list it could not read.
   */
  getPins(communityId: string, channelId: string): { pins: CordVerifiedPin[]; readable: boolean } {
    const community = this.getCommunity(communityId);
    const channel = this.getChannels(communityId).find(entry => entry.channelId === channelId);
    if (!community || !channel) return { pins: [], readable: true };

    const coordinate = this.pinsCoordinate(communityId, channelId);
    const content = this.getControl(communityId).pins.get(coordinate);
    if (!content) return { pins: [], readable: true };

    const group = this.channelGroupKey(community, channel);

    const { entries, readable } = parsePinList(content, (epoch, sealed) => {
      // Only openable if we hold the key for the epoch it names.
      if (Number(epoch) !== channel.epoch) return null;

      try {
        return nip44DecryptWithKey(sealed, group.convKey);
      } catch {
        return null;
      }
    });

    const pins = entries
      .map(entry => verifyPinEntry(entry, channelId))
      .filter((pin): pin is CordVerifiedPin => !!pin);

    return { pins, readable };
  }

  private pinsCoordinate(communityId: string, channelId: string): string {
    return toHex(cordHkdf(fromHex(communityId), LABEL_PINS, toId32(channelId)));
  }

  /** Build the replacement pin list after adding or removing an entry. */
  buildPinList(
    communityId: string,
    channelId: string,
    change: { pin?: CordMessage; unpin?: string }
  ): { content: string; readable: boolean } | null {
    const community = this.getCommunity(communityId);
    const channel = this.getChannels(communityId).find(entry => entry.channelId === channelId);
    if (!community || !channel) return null;

    const coordinate = this.pinsCoordinate(communityId, channelId);
    const existingContent = this.getControl(communityId).pins.get(coordinate);
    const group = this.channelGroupKey(community, channel);

    let entries: CordPinEntry[] = [];
    let readable = true;

    if (existingContent) {
      const parsed = parsePinList(existingContent, (epoch, sealed) => {
        if (Number(epoch) !== channel.epoch) return null;
        try {
          return nip44DecryptWithKey(sealed, group.convKey);
        } catch {
          return null;
        }
      });

      entries = parsed.entries;
      readable = parsed.readable;
    }

    if (!readable) return { content: '', readable: false };

    if (change.unpin) {
      entries = entries.filter(entry => {
        const verified = verifyPinEntry(entry, channelId);
        return verified?.id !== change.unpin;
      });
    }

    if (change.pin?.seal) {
      const entry = buildPinEntry(change.pin.seal, group.convKey, change.pin.wrapId);
      if (entry) entries = [...entries, entry];
    }

    return {
      content: buildPinListContent(entries, {
        private: channel.private,
        epoch: channel.epoch,
        seal: plaintext => nip44EncryptWithKey(plaintext, group.convKey),
      }),
      readable: true,
    };
  }

  /** React to a message (NIP-25 shape). */
  async react(
    communityId: string,
    channelId: string,
    target: CordMessage,
    emoji: string
  ): Promise<void> {
    const community = this.getCommunity(communityId);
    const channel = this.getChannels(communityId).find(entry => entry.channelId === channelId);
    const pubkey = this.pubkey();
    if (!community || !channel || !pubkey) return;

    const { created_at, ms } = splitTimestamp(Date.now());

    // A custom-emoji reaction is a `:shortcode:` in the content, so it needs
    // the same NIP-30 tag a message does or it renders as literal text.
    const emojiTags = await this.emojiTags(emoji);

    // Never echo a glued `:shortcode:https://…` back onto the wire.
    const content = emoji.replace(/^(:[a-zA-Z0-9_]+:)\s*https?:\/\/\S+$/, '$1');

    await this.publishRumor(community, this.channelGroupKey(community, channel), {
      kind: CORD_KIND_REACTION,
      pubkey,
      content,
      tags: [
        ['channel', channel.channelId],
        ['epoch', String(channel.epoch)],
        ['ms', ms],
        ...emojiTags,
        ['e', target.id],
        ['p', target.pubkey],
        ['k', String(target.kind)],
      ],
      created_at,
    });
  }

  /** Delete one of your own messages (NIP-09 shape). */
  async deleteMessage(
    communityId: string,
    channelId: string,
    target: CordMessage
  ): Promise<void> {
    const community = this.getCommunity(communityId);
    const channel = this.getChannels(communityId).find(entry => entry.channelId === channelId);
    const pubkey = this.pubkey();
    if (!community || !channel || !pubkey) return;

    const { created_at, ms } = splitTimestamp(Date.now());

    // A delete never carries an expiration: its target may outlive it, and an
    // expiring tombstone would let the erased message come back (CORD-08 §2).
    await this.publishRumor(community, this.channelGroupKey(community, channel), {
      kind: CORD_KIND_DELETE,
      pubkey,
      content: '',
      tags: [
        ['channel', channel.channelId],
        ['epoch', String(channel.epoch)],
        ['ms', ms],
        ['e', target.id],
        ['k', String(target.kind)],
      ],
      created_at,
    });
  }

  /** Broadcast a typing indicator; realtime-only, never stored. */
  async sendTyping(communityId: string, channelId: string): Promise<void> {
    const community = this.getCommunity(communityId);
    const channel = this.getChannels(communityId).find(entry => entry.channelId === channelId);
    const pubkey = this.pubkey();
    if (!community || !channel || !pubkey) return;

    const { created_at, ms } = splitTimestamp(Date.now());

    await this.publishRumor(
      community,
      this.channelGroupKey(community, channel),
      {
        kind: CORD_KIND_TYPING,
        pubkey,
        content: '',
        tags: [
          ['channel', channel.channelId],
          ['epoch', String(channel.epoch)],
          ['ms', ms],
        ],
        created_at,
      },
      { ephemeral: true }
    ).catch(() => undefined);
  }

  /**
   * Seal, wrap, and publish a rumor to a community's relays.
   *
   * The seal is signed by the member's real key — that signature is what proves
   * authorship and survives every re-wrap — while the wrap is signed by the
   * plane's derived key, which is what makes it findable.
   */
  private async publishRumor(
    community: CordCommunity,
    group: CordGroupKey,
    rumor: CordRumor,
    options: { sealKind?: number; ephemeral?: boolean; expiration?: string } = {}
  ): Promise<Event> {
    const sign = async (event: UnsignedEvent) => this.nostr.signEvent(event);

    const wrap = await buildStreamEvent(group, rumor, sign, {
      sealKind: options.sealKind,
      ephemeral: options.ephemeral,
    });

    await this.relayPool.publish(community.relays, wrap, 10000);
    return wrap;
  }

  /** Exposed for the admin layer, which publishes Control Plane editions. */
  async publishStreamEvent(
    community: CordCommunity,
    group: CordGroupKey,
    rumor: CordRumor,
    options: { sealKind?: number; ephemeral?: boolean } = {}
  ): Promise<Event> {
    return this.publishRumor(community, group, rumor, options);
  }

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------

  closeSubscriptions(): void {
    for (const subscription of this.activeSubscriptions) {
      try {
        subscription.close();
      } catch (error) {
        this.logger.debug('[Concord] Failed to close subscription', error);
      }
    }

    this.activeSubscriptions = [];
    this.activeChannelKey = null;
  }

  // ---------------------------------------------------------------------------
  // Membership sync (CORD-02 §8)
  // ---------------------------------------------------------------------------

  /**
   * Reconcile this device with the member's published Community List.
   *
   * Membership is key possession, and those keys live in a kind:13302 event
   * encrypted to the member themselves — so a community joined in Vector or
   * Soapbox only reaches Nostria through this list. The merge runs both ways:
   * anything the list knows is adopted locally, then anything held only here is
   * published back, so no device is authoritative.
   */
  async syncMemberships(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey || this.syncing()) return;

    this.syncing.set(true);

    try {
      const list = await this.lists.loadCommunityList();
      const remote = this.lists.fromCommunityList(list);

      let adopted = 0;

      for (const community of remote) {
        const existing = this.getCommunity(community.communityId);

        if (!existing) {
          this.communities.update(current => [...current, community]);
          adopted++;
          continue;
        }

        // Only ever move forward in epoch, and never drop a key we already
        // hold — a stale device's snapshot must not undo a rotation.
        if (community.rootEpoch > existing.rootEpoch) {
          this.communities.update(current =>
            current.map(entry =>
              entry.communityId === community.communityId
                ? {
                    ...community,
                    controlRoot: community.controlRoot ?? existing.controlRoot,
                    channelKeys: mergeChannelKeys(existing.channelKeys, community.channelKeys),
                    addedAt: existing.addedAt,
                  }
                : entry
            )
          );
          adopted++;
        }
      }

      if (adopted > 0) {
        this.persist();
        this.logger.info('[Concord] Adopted communities from the membership list', { adopted });
      }

      // Push anything this device holds that the list has not recorded.
      await this.lists.syncCommunityList(this.communities());
    } catch (error) {
      this.logger.warn('[Concord] Could not sync memberships', error);
    } finally {
      this.syncing.set(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  private restore(): void {
    if (!this.isBrowser) return;

    try {
      const raw = localStorage.getItem(STORAGE_KEY_COMMUNITIES);
      if (raw) this.communities.set(JSON.parse(raw) as CordCommunity[]);

      this.voiceBroker.set(localStorage.getItem(STORAGE_KEY_BROKER) ?? '');
    } catch (error) {
      this.logger.warn('[Concord] Could not restore held communities', error);
    }
  }

  /** Remember the preferred A/V broker for empty rooms. */
  setVoiceBroker(origin: string): void {
    const trimmed = origin.trim();
    this.voiceBroker.set(trimmed);

    if (!this.isBrowser) return;

    try {
      localStorage.setItem(STORAGE_KEY_BROKER, trimmed);
    } catch (error) {
      this.logger.warn('[Concord] Could not persist the broker setting', error);
    }
  }

  private persist(): void {
    if (!this.isBrowser) return;

    try {
      localStorage.setItem(STORAGE_KEY_COMMUNITIES, JSON.stringify(this.communities()));
    } catch (error) {
      this.logger.warn('[Concord] Could not persist held communities', error);
    }
  }

  private dedupe<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const promise = factory().finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }
}

/** Union of channel keys, keeping the highest epoch we have seen for each. */
function mergeChannelKeys(
  current: CordCommunity['channelKeys'],
  incoming: CordCommunity['channelKeys']
): CordCommunity['channelKeys'] {
  const byId = new Map(current.map(entry => [entry.id, entry]));

  for (const entry of incoming) {
    const existing = byId.get(entry.id);
    if (!existing || entry.epoch >= existing.epoch) byId.set(entry.id, entry);
  }

  return [...byId.values()];
}
