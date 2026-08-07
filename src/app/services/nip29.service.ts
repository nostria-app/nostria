import { computed, inject, PLATFORM_ID, Service, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Event, Filter, UnsignedEvent } from 'nostr-tools';

import { LoggerService } from './logger.service';
import { UtilitiesService } from './utilities.service';
import { DatabaseService } from './database.service';
import { NostrService } from './nostr.service';
import { AccountStateService } from './account-state.service';
import { RelayPoolService } from './relays/relay-pool';
import { Nip29GroupsListService } from './nip29-groups-list.service';
import {
  NIP29_ADDRESSABLE_KINDS,
  NIP29_KIND_ADMINS,
  NIP29_KIND_CHAT,
  NIP29_KIND_DELETE_EVENT,
  NIP29_KIND_JOIN_REQUEST,
  NIP29_KIND_LEAVE_REQUEST,
  NIP29_KIND_LIVEKIT_PARTICIPANTS,
  NIP29_KIND_MEMBERS,
  NIP29_KIND_METADATA,
  NIP29_KIND_PINNED,
  NIP29_KIND_PUT_USER,
  NIP29_KIND_REMOVE_USER,
  NIP29_KIND_ROLES,
  NIP29_KIND_THREAD,
  NIP29_KIND_THREAD_REPLY,
  NIP98_KIND_HTTP_AUTH,
  Nip29Admin,
  Nip29Group,
  Nip29GroupDetails,
  Nip29GroupNode,
  Nip29LivekitToken,
  Nip29Membership,
  Nip29Message,
  Nip29Role,
  Nip29Server,
  Nip29ServerCache,
} from '../interfaces/nip29';

interface Closeable {
  close: () => void;
}

const STORAGE_KEY_SERVERS = 'nostria-nip29-servers-v1';
const STORAGE_KEY_GROUPS = 'nostria-nip29-groups-v1';
const STORAGE_KEY_INFO = 'nostria-nip29-relay-info-v1';

/** How long a cached group list stays fresh before we hit the relay again. */
const GROUPS_TTL_MS = 10 * 60 * 1000;
/** How long cached admin/member/role lists stay fresh. */
const DETAILS_TTL_MS = 5 * 60 * 1000;
/** NIP-11 relay information rarely changes. */
const RELAY_INFO_TTL_MS = 24 * 60 * 60 * 1000;
/** Number of messages fetched on the first load of a channel. */
const MESSAGE_PAGE_SIZE = 100;
/** NIP-29 timeline references are taken from the last 50 events seen. */
const TIMELINE_WINDOW = 50;
/** Number of `previous` references attached to outgoing events. */
const TIMELINE_REFERENCE_COUNT = 3;

/**
 * Relays known to host NIP-29 groups, offered as suggestions when the user has
 * not added any server yet. They are never queried until the user opens them.
 */
export const SUGGESTED_NIP29_SERVERS = [
  'wss://groups.0xchat.com/',
  'wss://relay.groups.nip29.com/',
  'wss://groups.gitcitadel.com/',
];

/**
 * NIP-29 relay-based groups.
 *
 * Relay traffic is deliberately conservative:
 *  - group lists and group state are cached in `localStorage` behind a TTL and
 *    served from cache on navigation;
 *  - messages are cached in IndexedDB and only the delta since the newest
 *    cached message is requested;
 *  - at most one channel is subscribed live at a time (two filters on a single
 *    relay), and the subscription is torn down when the channel is closed;
 *  - identical concurrent requests are de-duplicated through an in-flight map.
 */
@Service()
export class Nip29Service {
  private readonly logger = inject(LoggerService);
  private readonly utilities = inject(UtilitiesService);
  private readonly database = inject(DatabaseService);
  private readonly nostr = inject(NostrService);
  private readonly accountState = inject(AccountStateService);
  private readonly relayPool = inject(RelayPoolService);
  private readonly groupsList = inject(Nip29GroupsListService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Servers the user has added, plus the built-in suggestions. */
  readonly servers = signal<Nip29Server[]>([]);

  /** Group lists keyed by normalized relay URL. */
  private readonly groupsByServer = signal<Record<string, Nip29Group[]>>({});

  /** Group state (admins/members/roles/pins) keyed by `<relay>|<groupId>`. */
  private readonly detailsByGroup = signal<Record<string, Nip29GroupDetails>>({});

  /** Chat messages keyed by `<relay>|<groupId>`, sorted oldest first. */
  private readonly messagesByGroup = signal<Record<string, Nip29Message[]>>({});

  /** Thread roots (kind:11) keyed by `<relay>|<groupId>`, newest first. */
  private readonly threadsByGroup = signal<Record<string, Nip29Message[]>>({});

  /** Thread replies (kind:1111) keyed by thread root event id. */
  private readonly repliesByThread = signal<Record<string, Nip29Message[]>>({});

  /** Membership state keyed by `<relay>|<groupId>`. */
  private readonly membershipByGroup = signal<Record<string, Nip29Membership>>({});

  readonly loadingServer = signal<string | null>(null);
  readonly loadingGroup = signal<string | null>(null);
  readonly loadingMessages = signal(false);
  readonly loadingMore = signal(false);
  readonly sending = signal(false);

  /** Group ids whose history is fully loaded (no more pages on the relay). */
  private readonly exhaustedHistory = new Set<string>();

  /** Recently seen event ids per group, used for NIP-29 `previous` references. */
  private readonly timeline = new Map<string, string[]>();

  /** Promise de-duplication for identical concurrent relay requests. */
  private readonly inflight = new Map<string, Promise<unknown>>();

  /** Live subscriptions for the currently open channel. */
  private activeSubscriptions: Closeable[] = [];
  private activeGroupKey: string | null = null;

  /** Servers sorted for the Discord-style rail: saved first, then suggestions. */
  readonly serverRail = computed<Nip29Server[]>(() => {
    const savedRelays = new Set(this.groupsList.relays());
    return [...this.servers()].sort((a, b) => {
      const aScore = (a.added ? 2 : 0) + (savedRelays.has(a.url) ? 1 : 0);
      const bScore = (b.added ? 2 : 0) + (savedRelays.has(b.url) ? 1 : 0);
      if (aScore !== bScore) return bScore - aScore;
      return a.name.localeCompare(b.name);
    });
  });

  constructor() {
    this.restoreServers();
  }

  // ---------------------------------------------------------------------------
  // Keys and lookups
  // ---------------------------------------------------------------------------

  /** Stable cache key for a group on a specific relay. */
  groupKey(relay: string, groupId: string): string {
    return `${this.normalize(relay)}|${groupId}`;
  }

  /** Route-safe identifier for a relay URL, e.g. `groups.0xchat.com`. */
  serverSlug(relayUrl: string): string {
    try {
      const url = new URL(this.normalize(relayUrl));
      const path = url.pathname.replace(/\/+$/, '');
      return path ? `${url.host}${path}`.replace(/\//g, '~') : url.host;
    } catch {
      return relayUrl;
    }
  }

  /** Reverse of {@link serverSlug}. */
  slugToRelayUrl(slug: string): string {
    return this.normalize(`wss://${slug.replace(/~/g, '/')}`);
  }

  getServer(relayUrl: string): Nip29Server | undefined {
    const normalized = this.normalize(relayUrl);
    return this.servers().find(server => server.url === normalized);
  }

  getServerBySlug(slug: string): Nip29Server | undefined {
    return this.servers().find(server => server.slug === slug);
  }

  getGroups(relayUrl: string): Nip29Group[] {
    return this.groupsByServer()[this.normalize(relayUrl)] ?? [];
  }

  getGroup(relayUrl: string, groupId: string): Nip29Group | undefined {
    return this.getGroups(relayUrl).find(group => group.id === groupId);
  }

  getDetails(relayUrl: string, groupId: string): Nip29GroupDetails | undefined {
    return this.detailsByGroup()[this.groupKey(relayUrl, groupId)];
  }

  getMessages(relayUrl: string, groupId: string): Nip29Message[] {
    return this.messagesByGroup()[this.groupKey(relayUrl, groupId)] ?? [];
  }

  getThreads(relayUrl: string, groupId: string): Nip29Message[] {
    return this.threadsByGroup()[this.groupKey(relayUrl, groupId)] ?? [];
  }

  getThreadReplies(threadId: string): Nip29Message[] {
    return this.repliesByThread()[threadId] ?? [];
  }

  getMembership(relayUrl: string, groupId: string): Nip29Membership {
    return this.membershipByGroup()[this.groupKey(relayUrl, groupId)] ?? 'unknown';
  }

  hasMoreHistory(relayUrl: string, groupId: string): boolean {
    return !this.exhaustedHistory.has(this.groupKey(relayUrl, groupId));
  }

  isAdmin(relayUrl: string, groupId: string, pubkey: string | null | undefined): boolean {
    if (!pubkey) return false;
    return !!this.getDetails(relayUrl, groupId)?.admins.some(admin => admin.pubkey === pubkey);
  }

  /**
   * Build the sidebar tree for a server. Root groups (no `parent`) become
   * categories, children are ordered by the parent's `child` tags.
   */
  buildTree(relayUrl: string): Nip29GroupNode[] {
    const groups = this.getGroups(relayUrl);
    const byId = new Map(groups.map(group => [group.id, group]));
    const visited = new Set<string>();

    const build = (group: Nip29Group, depth: number): Nip29GroupNode => {
      visited.add(group.id);

      const orderedChildIds = group.children.filter(id => byId.has(id) && !visited.has(id));
      // Fall back to reverse links for relays that only set `parent`.
      const implicitChildIds = groups
        .filter(
          candidate =>
            candidate.parent === group.id &&
            !visited.has(candidate.id) &&
            !orderedChildIds.includes(candidate.id)
        )
        .map(candidate => candidate.id);

      const children = [...orderedChildIds, ...implicitChildIds]
        .map(id => byId.get(id))
        .filter((child): child is Nip29Group => !!child)
        .map(child => build(child, depth + 1));

      return { group, children, depth };
    };

    const roots = groups
      .filter(group => !group.parent || !byId.has(group.parent))
      .sort((a, b) => a.name.localeCompare(b.name));

    const tree = roots.filter(group => !visited.has(group.id)).map(group => build(group, 0));

    // Anything left unvisited (e.g. a parent cycle) is surfaced as a root so it
    // never silently disappears from the sidebar.
    const orphans = groups
      .filter(group => !visited.has(group.id))
      .map(group => build(group, 0));

    return [...tree, ...orphans];
  }

  // ---------------------------------------------------------------------------
  // Servers
  // ---------------------------------------------------------------------------

  /**
   * Add a relay as a server. Returns the normalized URL, or null if invalid.
   *
   * Deep links pass `markAsAdded: false` so simply opening someone's link does
   * not permanently pin the server to the rail — that happens once the user
   * joins or saves a channel on it.
   */
  addServer(relayUrl: string, markAsAdded = true): string | null {
    const normalized = this.normalize(relayUrl);
    if (!normalized) return null;

    const existing = this.getServer(normalized);
    if (existing) {
      if (markAsAdded && !existing.added) {
        this.servers.update(servers =>
          servers.map(server => (server.url === normalized ? { ...server, added: true } : server))
        );
        this.persistServers();
      }
      return normalized;
    }

    this.servers.update(servers => [...servers, this.createServer(normalized, markAsAdded)]);
    if (markAsAdded) this.persistServers();

    return normalized;
  }

  /** Remove a user-added server. Built-in suggestions are kept but unmarked. */
  removeServer(relayUrl: string): void {
    const normalized = this.normalize(relayUrl);
    const isSuggested = SUGGESTED_NIP29_SERVERS.some(url => this.normalize(url) === normalized);

    this.servers.update(servers =>
      isSuggested
        ? servers.map(server => (server.url === normalized ? { ...server, added: false } : server))
        : servers.filter(server => server.url !== normalized)
    );

    this.persistServers();
  }

  /**
   * Merge relay hints from the user's kind:10009 list into the server rail so
   * groups the user joined elsewhere show up automatically.
   */
  syncServersFromGroupsList(): void {
    const relays = this.groupsList.relays();
    if (relays.length === 0) return;

    const known = new Set(this.servers().map(server => server.url));
    const missing = relays
      .map(relay => this.normalize(relay))
      .filter(relay => relay && !known.has(relay));

    if (missing.length === 0) return;

    this.servers.update(servers => [
      ...servers,
      ...missing.map(relay => this.createServer(relay, true)),
    ]);
    this.persistServers();
  }

  /**
   * Load the NIP-11 document for a server to pick up its name, icon and the
   * `self` pubkey that signs the relay-generated group events. Cached for 24h.
   */
  async loadServerInfo(relayUrl: string, force = false): Promise<void> {
    if (!this.isBrowser) return;

    const normalized = this.normalize(relayUrl);
    const server = this.getServer(normalized);
    if (!server) return;

    const age = Date.now() - (server.infoFetchedAt ?? 0);
    if (!force && server.infoFetchedAt && age < RELAY_INFO_TTL_MS) return;

    await this.dedupe(`info:${normalized}`, async () => {
      try {
        const response = await fetch(this.toHttpUrl(normalized), {
          headers: { Accept: 'application/nostr+json' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const info = (await response.json()) as {
          name?: string;
          description?: string;
          icon?: string;
          self?: string;
          pubkey?: string;
          nip29?: { subgroups?: boolean };
          supported_nips?: number[];
        };

        this.servers.update(servers =>
          servers.map(entry =>
            entry.url === normalized
              ? {
                  ...entry,
                  name: info.name?.trim() || entry.name,
                  description: info.description,
                  icon: info.icon,
                  selfPubkey: info.self || info.pubkey,
                  supportsSubgroups: info.nip29?.subgroups === true,
                  infoFetchedAt: Date.now(),
                }
              : entry
          )
        );

        this.persistServers();
      } catch (error) {
        this.logger.debug('[NIP-29] Failed to fetch relay information document', {
          relay: normalized,
          error,
        });
        // Remember the attempt so a broken NIP-11 endpoint is not retried on
        // every navigation.
        this.servers.update(servers =>
          servers.map(entry =>
            entry.url === normalized ? { ...entry, infoFetchedAt: Date.now() } : entry
          )
        );
        this.persistServers();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Groups
  // ---------------------------------------------------------------------------

  /**
   * Load the list of groups hosted by a server. Served from the local cache
   * while it is fresh; `force` bypasses the TTL for an explicit refresh.
   */
  async loadGroups(relayUrl: string, force = false): Promise<Nip29Group[]> {
    const normalized = this.normalize(relayUrl);
    if (!normalized) return [];

    if (!force) {
      const cached = this.readGroupsCache(normalized);
      if (cached && Date.now() - cached.fetchedAt < GROUPS_TTL_MS) {
        this.groupsByServer.update(state => ({ ...state, [normalized]: cached.groups }));
        return cached.groups;
      }
      if (cached && !this.groupsByServer()[normalized]) {
        // Show stale data immediately, then refresh below.
        this.groupsByServer.update(state => ({ ...state, [normalized]: cached.groups }));
      }
    }

    return this.dedupe(`groups:${normalized}`, async () => {
      this.loadingServer.set(normalized);

      try {
        const events = await this.relayPool.query(
          [normalized],
          { kinds: [NIP29_KIND_METADATA], limit: 500 },
          8000
        );

        const groups = events
          .map(event => this.parseGroupMetadata(normalized, event))
          .sort((a, b) => a.name.localeCompare(b.name));

        this.groupsByServer.update(state => ({ ...state, [normalized]: groups }));
        this.writeGroupsCache(normalized, groups);
        return groups;
      } catch (error) {
        this.logger.error('[NIP-29] Failed to load groups', { relay: normalized, error });
        return this.getGroups(normalized);
      } finally {
        this.loadingServer.set(null);
      }
    });
  }

  /**
   * Load admins, members, roles, pins and LiveKit participants for a group.
   * All five addressable kinds are fetched with a single filter.
   */
  async loadGroupDetails(relayUrl: string, groupId: string, force = false): Promise<void> {
    const normalized = this.normalize(relayUrl);
    const key = this.groupKey(normalized, groupId);

    const existing = this.detailsByGroup()[key];
    if (!force && existing && Date.now() - existing.fetchedAt < DETAILS_TTL_MS) return;

    await this.dedupe(`details:${key}`, async () => {
      this.loadingGroup.set(key);

      try {
        const events = await this.relayPool.query(
          [normalized],
          { kinds: NIP29_ADDRESSABLE_KINDS, '#d': [groupId], limit: 20 },
          8000
        );

        // Keep only the newest event per kind — these are addressable events.
        const newestByKind = new Map<number, Event>();
        for (const event of events) {
          const current = newestByKind.get(event.kind);
          if (!current || event.created_at > current.created_at) {
            newestByKind.set(event.kind, event);
          }
        }

        const metadataEvent = newestByKind.get(NIP29_KIND_METADATA);
        if (metadataEvent) {
          this.upsertGroup(this.parseGroupMetadata(normalized, metadataEvent));
        }

        const details: Nip29GroupDetails = {
          admins: this.parseAdmins(newestByKind.get(NIP29_KIND_ADMINS)),
          members: this.tagValues(newestByKind.get(NIP29_KIND_MEMBERS), 'p'),
          roles: this.parseRoles(newestByKind.get(NIP29_KIND_ROLES)),
          pinned: this.parsePins(newestByKind.get(NIP29_KIND_PINNED)),
          livekitParticipants: this.tagValues(
            newestByKind.get(NIP29_KIND_LIVEKIT_PARTICIPANTS),
            'participant'
          ),
          fetchedAt: Date.now(),
        };

        this.detailsByGroup.update(state => ({ ...state, [key]: details }));
        this.resolveMembershipFromMembers(normalized, groupId, details.members);
      } catch (error) {
        this.logger.error('[NIP-29] Failed to load group details', { key, error });
      } finally {
        this.loadingGroup.set(null);
      }
    });
  }

  /**
   * Resolve whether the signed-in user is a member by looking at the latest
   * kind:9000 / kind:9001 addressed to them, per NIP-29.
   */
  async loadMembership(relayUrl: string, groupId: string): Promise<Nip29Membership> {
    const pubkey = this.accountState.pubkey();
    const normalized = this.normalize(relayUrl);
    const key = this.groupKey(normalized, groupId);

    if (!pubkey) {
      this.membershipByGroup.update(state => ({ ...state, [key]: 'unknown' }));
      return 'unknown';
    }

    const current = this.membershipByGroup()[key];
    if (current && current !== 'unknown') return current;

    return this.dedupe(`membership:${key}`, async () => {
      try {
        const events = await this.relayPool.query(
          [normalized],
          {
            kinds: [NIP29_KIND_PUT_USER, NIP29_KIND_REMOVE_USER],
            '#h': [groupId],
            '#p': [pubkey],
            limit: 10,
          },
          6000
        );

        if (events.length === 0) {
          this.membershipByGroup.update(state => ({ ...state, [key]: 'not-member' }));
          return 'not-member' as Nip29Membership;
        }

        const latest = events.reduce((newest, event) =>
          event.created_at > newest.created_at ? event : newest
        );
        const membership: Nip29Membership =
          latest.kind === NIP29_KIND_PUT_USER ? 'member' : 'not-member';

        this.membershipByGroup.update(state => ({ ...state, [key]: membership }));
        return membership;
      } catch (error) {
        this.logger.debug('[NIP-29] Membership lookup failed', { key, error });
        return 'unknown' as Nip29Membership;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  /**
   * Open a channel: serve cached messages instantly, request only the delta
   * from the relay, then attach the single live subscription.
   */
  async openGroup(relayUrl: string, groupId: string): Promise<void> {
    const normalized = this.normalize(relayUrl);
    const key = this.groupKey(normalized, groupId);

    if (this.activeGroupKey === key) return;

    this.closeSubscriptions();
    this.activeGroupKey = key;
    this.loadingMessages.set(true);

    try {
      await this.loadCachedMessages(normalized, groupId);

      // The channel may have been switched while reading from IndexedDB.
      if (this.activeGroupKey !== key) return;

      const newest = this.getMessages(normalized, groupId).at(-1);
      const filter: Filter = {
        kinds: [NIP29_KIND_CHAT, NIP29_KIND_THREAD],
        '#h': [groupId],
        limit: MESSAGE_PAGE_SIZE,
      };

      if (newest) {
        // Small overlap to tolerate relay clock skew and late delivery.
        filter.since = newest.createdAt - 60;
      }

      const events = await this.relayPool.query([normalized], filter, 8000);
      if (this.activeGroupKey !== key) return;

      this.ingest(normalized, groupId, events);

      if (!newest && events.length < MESSAGE_PAGE_SIZE) {
        this.exhaustedHistory.add(key);
      }

      this.subscribeToGroup(normalized, groupId);
    } catch (error) {
      this.logger.error('[NIP-29] Failed to open group', { key, error });
    } finally {
      if (this.activeGroupKey === key) {
        this.loadingMessages.set(false);
      }
    }
  }

  /** Fetch one older page of chat history for the open channel. */
  async loadOlderMessages(relayUrl: string, groupId: string): Promise<void> {
    const normalized = this.normalize(relayUrl);
    const key = this.groupKey(normalized, groupId);

    if (this.exhaustedHistory.has(key) || this.loadingMore()) return;

    const oldest = this.getMessages(normalized, groupId)[0];
    if (!oldest) return;

    this.loadingMore.set(true);

    try {
      const events = await this.relayPool.query(
        [normalized],
        {
          kinds: [NIP29_KIND_CHAT, NIP29_KIND_THREAD],
          '#h': [groupId],
          until: oldest.createdAt - 1,
          limit: MESSAGE_PAGE_SIZE,
        },
        8000
      );

      if (events.length < MESSAGE_PAGE_SIZE) {
        this.exhaustedHistory.add(key);
      }

      this.ingest(normalized, groupId, events);
    } catch (error) {
      this.logger.error('[NIP-29] Failed to load older messages', { key, error });
    } finally {
      this.loadingMore.set(false);
    }
  }

  /** Load the replies (kind:1111) of a thread root, cache-first. */
  async loadThreadReplies(relayUrl: string, threadId: string): Promise<void> {
    const normalized = this.normalize(relayUrl);

    const cached = await this.database
      .getEventsByKindsAndTagValue([NIP29_KIND_THREAD_REPLY], ['E', 'e'], threadId)
      .catch(() => [] as Event[]);

    if (cached.length > 0) {
      this.mergeReplies(threadId, cached.map(event => this.toMessage(event)));
    }

    await this.dedupe(`replies:${threadId}`, async () => {
      try {
        const events = await this.relayPool.query(
          [normalized],
          { kinds: [NIP29_KIND_THREAD_REPLY], '#E': [threadId], limit: 200 },
          8000
        );

        if (events.length > 0) {
          await this.database.saveEvents(events).catch(() => undefined);
          this.mergeReplies(threadId, events.map(event => this.toMessage(event)));
        }
      } catch (error) {
        this.logger.error('[NIP-29] Failed to load thread replies', { threadId, error });
      }
    });
  }

  /** Send a chat message (kind:9) to a group. */
  async sendMessage(
    relayUrl: string,
    groupId: string,
    content: string,
    replyTo?: Nip29Message
  ): Promise<boolean> {
    const trimmed = content.trim();
    if (!trimmed) return false;

    const tags: string[][] = [['h', groupId], ...this.previousTags(relayUrl, groupId)];

    if (replyTo) {
      tags.push(['e', replyTo.id, this.normalize(relayUrl), 'reply', replyTo.pubkey]);
      tags.push(['p', replyTo.pubkey]);
    }

    return this.publishToGroup(relayUrl, groupId, NIP29_KIND_CHAT, trimmed, tags);
  }

  /** Start a new thread (kind:11) in a group. */
  async createThread(
    relayUrl: string,
    groupId: string,
    subject: string,
    content: string
  ): Promise<boolean> {
    const trimmed = content.trim();
    if (!trimmed) return false;

    const tags: string[][] = [['h', groupId], ...this.previousTags(relayUrl, groupId)];
    if (subject.trim()) {
      tags.push(['title', subject.trim()]);
      tags.push(['subject', subject.trim()]);
    }

    return this.publishToGroup(relayUrl, groupId, NIP29_KIND_THREAD, trimmed, tags);
  }

  /** Reply to a thread root with a NIP-22 comment (kind:1111). */
  async replyToThread(
    relayUrl: string,
    groupId: string,
    thread: Nip29Message,
    content: string,
    parent?: Nip29Message
  ): Promise<boolean> {
    const trimmed = content.trim();
    if (!trimmed) return false;

    const normalized = this.normalize(relayUrl);
    const target = parent ?? thread;

    const tags: string[][] = [
      ['h', groupId],
      ['E', thread.id, normalized, thread.pubkey],
      ['K', String(thread.kind)],
      ['P', thread.pubkey],
      ['e', target.id, normalized, target.pubkey],
      ['k', String(target.kind)],
      ['p', target.pubkey],
      ...this.previousTags(relayUrl, groupId),
    ];

    return this.publishToGroup(relayUrl, groupId, NIP29_KIND_THREAD_REPLY, trimmed, tags);
  }

  // ---------------------------------------------------------------------------
  // Membership actions
  // ---------------------------------------------------------------------------

  /** Send a kind:9021 join request. Returns an error message on failure. */
  async joinGroup(
    relayUrl: string,
    groupId: string,
    inviteCode?: string,
    reason = ''
  ): Promise<string | null> {
    const tags: string[][] = [['h', groupId]];
    if (inviteCode) tags.push(['code', inviteCode]);

    const error = await this.signAndSend(relayUrl, NIP29_KIND_JOIN_REQUEST, reason, tags);

    if (error && error.startsWith('duplicate:')) {
      // Already a member — treat as success.
      this.setMembership(relayUrl, groupId, 'member');
      await this.rememberGroup(relayUrl, groupId);
      return null;
    }

    if (!error) {
      this.setMembership(relayUrl, groupId, 'member');
      await this.rememberGroup(relayUrl, groupId);
    }

    return error;
  }

  /** Send a kind:9022 leave request and forget the group locally. */
  async leaveGroup(relayUrl: string, groupId: string, reason = ''): Promise<string | null> {
    const error = await this.signAndSend(relayUrl, NIP29_KIND_LEAVE_REQUEST, reason, [
      ['h', groupId],
    ]);

    if (!error) {
      this.setMembership(relayUrl, groupId, 'not-member');
      await this.groupsList.removeGroup(relayUrl, groupId).catch(() => undefined);
    }

    return error;
  }

  private async rememberGroup(relayUrl: string, groupId: string): Promise<void> {
    // Joining a group pins its relay to the server rail.
    this.addServer(relayUrl);

    if (!this.accountState.pubkey()) return;
    const group = this.getGroup(relayUrl, groupId);
    await this.groupsList.addGroup(relayUrl, groupId, group?.name).catch(error => {
      this.logger.warn('[NIP-29] Failed to update groups list', error);
    });
  }

  // ---------------------------------------------------------------------------
  // LiveKit
  // ---------------------------------------------------------------------------

  /**
   * Request a LiveKit access token from the relay using a NIP-98 authorization
   * header, as described in NIP-29.
   */
  async requestLivekitToken(relayUrl: string, groupId: string): Promise<Nip29LivekitToken> {
    if (!this.isBrowser) throw new Error('LiveKit is only available in the browser');

    const normalized = this.normalize(relayUrl);
    const endpoint = `${this.toHttpUrl(normalized).replace(/\/$/, '')}/.well-known/nip29/livekit/${groupId}`;

    const authEvent = this.nostr.createEvent(NIP98_KIND_HTTP_AUTH, '', [
      ['u', endpoint],
      ['method', 'GET'],
    ]);
    const signed = await this.nostr.signEvent(authEvent);

    const response = await fetch(endpoint, {
      headers: { Authorization: `Nostr ${this.base64(JSON.stringify(signed))}` },
    });

    if (!response.ok) {
      throw new Error(`Relay refused the LiveKit token (HTTP ${response.status})`);
    }

    const payload = (await response.json()) as { token?: string; url?: string; jwt?: string };
    const token = payload.token ?? payload.jwt;

    if (!token || !payload.url) {
      throw new Error('Relay returned an incomplete LiveKit token');
    }

    return { token, url: payload.url };
  }

  // ---------------------------------------------------------------------------
  // Live subscriptions
  // ---------------------------------------------------------------------------

  /**
   * Attach the live subscriptions for the open channel. Two filters on one
   * relay: new content since now, and the group's addressable state events.
   */
  private subscribeToGroup(relayUrl: string, groupId: string): void {
    const normalized = this.normalize(relayUrl);
    const key = this.groupKey(normalized, groupId);
    const since = Math.floor(Date.now() / 1000);

    const contentSub = this.relayPool.subscribe(
      [normalized],
      {
        kinds: [
          NIP29_KIND_CHAT,
          NIP29_KIND_THREAD,
          NIP29_KIND_THREAD_REPLY,
          NIP29_KIND_PUT_USER,
          NIP29_KIND_REMOVE_USER,
          NIP29_KIND_DELETE_EVENT,
        ],
        '#h': [groupId],
        since,
      },
      event => {
        if (this.activeGroupKey !== key) return;

        switch (event.kind) {
          case NIP29_KIND_PUT_USER:
          case NIP29_KIND_REMOVE_USER:
            this.applyMembershipEvent(normalized, groupId, event);
            break;
          case NIP29_KIND_DELETE_EVENT:
            this.applyDeleteEvent(normalized, groupId, event);
            break;
          default:
            this.ingest(normalized, groupId, [event]);
        }
      }
    );

    const stateSub = this.relayPool.subscribe(
      [normalized],
      { kinds: NIP29_ADDRESSABLE_KINDS, '#d': [groupId] },
      event => {
        if (this.activeGroupKey !== key) return;
        this.applyStateEvent(normalized, groupId, event);
      }
    );

    this.activeSubscriptions = [contentSub, stateSub];
  }

  /** Tear down the live subscriptions for the previously open channel. */
  closeSubscriptions(): void {
    for (const subscription of this.activeSubscriptions) {
      try {
        subscription.close();
      } catch (error) {
        this.logger.debug('[NIP-29] Failed to close subscription', error);
      }
    }

    this.activeSubscriptions = [];
    this.activeGroupKey = null;
  }

  /**
   * Track our own membership as the relay emits kind:9000 / kind:9001 for us,
   * and keep the member list in the sidebar current for everyone else.
   */
  private applyMembershipEvent(relayUrl: string, groupId: string, event: Event): void {
    const key = this.groupKey(relayUrl, groupId);
    const own = this.accountState.pubkey();
    const targets = this.tagValues(event, 'p');
    const added = event.kind === NIP29_KIND_PUT_USER;

    if (own && targets.includes(own)) {
      this.setMembership(relayUrl, groupId, added ? 'member' : 'not-member');
    }

    const details = this.detailsByGroup()[key];
    if (!details) return;

    const members = added
      ? [...new Set([...details.members, ...targets])]
      : details.members.filter(member => !targets.includes(member));

    this.detailsByGroup.update(state => ({ ...state, [key]: { ...details, members } }));
  }

  /** Remove a message that a moderator deleted with a kind:9005 event. */
  private applyDeleteEvent(relayUrl: string, groupId: string, event: Event): void {
    const key = this.groupKey(relayUrl, groupId);
    const removed = new Set(this.tagValues(event, 'e'));
    if (removed.size === 0) return;

    this.messagesByGroup.update(state => ({
      ...state,
      [key]: (state[key] ?? []).filter(message => !removed.has(message.id)),
    }));

    this.threadsByGroup.update(state => ({
      ...state,
      [key]: (state[key] ?? []).filter(message => !removed.has(message.id)),
    }));

    this.database.deleteEvents([...removed]).catch(() => undefined);
  }

  private applyStateEvent(relayUrl: string, groupId: string, event: Event): void {
    const key = this.groupKey(relayUrl, groupId);

    if (event.kind === NIP29_KIND_METADATA) {
      this.upsertGroup(this.parseGroupMetadata(relayUrl, event));
      return;
    }

    const current: Nip29GroupDetails = this.detailsByGroup()[key] ?? {
      admins: [],
      members: [],
      roles: [],
      pinned: [],
      livekitParticipants: [],
      fetchedAt: Date.now(),
    };

    const next: Nip29GroupDetails = { ...current, fetchedAt: Date.now() };

    switch (event.kind) {
      case NIP29_KIND_ADMINS:
        next.admins = this.parseAdmins(event);
        break;
      case NIP29_KIND_MEMBERS:
        next.members = this.tagValues(event, 'p');
        this.resolveMembershipFromMembers(relayUrl, groupId, next.members);
        break;
      case NIP29_KIND_ROLES:
        next.roles = this.parseRoles(event);
        break;
      case NIP29_KIND_PINNED:
        next.pinned = this.parsePins(event);
        break;
      case NIP29_KIND_LIVEKIT_PARTICIPANTS:
        next.livekitParticipants = this.tagValues(event, 'participant');
        break;
      default:
        return;
    }

    this.detailsByGroup.update(state => ({ ...state, [key]: next }));
  }

  // ---------------------------------------------------------------------------
  // Ingestion
  // ---------------------------------------------------------------------------

  private async loadCachedMessages(relayUrl: string, groupId: string): Promise<void> {
    try {
      const cached = await this.database.getEventsByKindsAndTagValue(
        [NIP29_KIND_CHAT, NIP29_KIND_THREAD],
        'h',
        groupId
      );

      if (cached.length > 0) {
        this.ingest(relayUrl, groupId, cached, { persist: false });
      }
    } catch (error) {
      this.logger.debug('[NIP-29] No cached messages available', { groupId, error });
    }
  }

  private ingest(
    relayUrl: string,
    groupId: string,
    events: Event[],
    options: { persist?: boolean } = {}
  ): void {
    if (events.length === 0) return;

    const key = this.groupKey(relayUrl, groupId);
    const chat: Nip29Message[] = [];
    const threads: Nip29Message[] = [];
    const replies: Nip29Message[] = [];

    for (const event of events) {
      const message = this.toMessage(event);
      if (event.kind === NIP29_KIND_CHAT) chat.push(message);
      else if (event.kind === NIP29_KIND_THREAD) threads.push(message);
      else if (event.kind === NIP29_KIND_THREAD_REPLY) replies.push(message);
    }

    if (chat.length > 0) {
      this.messagesByGroup.update(state => ({
        ...state,
        [key]: this.mergeMessages(state[key] ?? [], chat, 'asc'),
      }));
    }

    if (threads.length > 0) {
      this.threadsByGroup.update(state => ({
        ...state,
        [key]: this.mergeMessages(state[key] ?? [], threads, 'desc'),
      }));
    }

    for (const reply of replies) {
      const threadId = reply.event.tags.find(tag => tag[0] === 'E')?.[1];
      if (threadId) this.mergeReplies(threadId, [reply]);
    }

    this.rememberTimeline(key, events);

    if (options.persist !== false) {
      this.database.saveEvents(events).catch(error => {
        this.logger.debug('[NIP-29] Failed to persist events', error);
      });
    }
  }

  private mergeMessages(
    existing: Nip29Message[],
    incoming: Nip29Message[],
    order: 'asc' | 'desc'
  ): Nip29Message[] {
    const byId = new Map(existing.map(message => [message.id, message]));
    for (const message of incoming) {
      byId.set(message.id, message);
    }

    const merged = [...byId.values()];
    merged.sort((a, b) =>
      order === 'asc' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt
    );

    return merged;
  }

  private mergeReplies(threadId: string, incoming: Nip29Message[]): void {
    this.repliesByThread.update(state => ({
      ...state,
      [threadId]: this.mergeMessages(state[threadId] ?? [], incoming, 'asc'),
    }));
  }

  /**
   * Keep the last 50 event ids seen in a group so outgoing events can carry
   * NIP-29 `previous` timeline references.
   */
  private rememberTimeline(key: string, events: Event[]): void {
    const own = this.accountState.pubkey();
    const current = this.timeline.get(key) ?? [];
    const ids = [
      ...current,
      ...events.filter(event => event.pubkey !== own).map(event => event.id),
    ];

    this.timeline.set(key, [...new Set(ids)].slice(-TIMELINE_WINDOW));
  }

  private previousTags(relayUrl: string, groupId: string): string[][] {
    const ids = this.timeline.get(this.groupKey(relayUrl, groupId)) ?? [];
    if (ids.length === 0) return [];

    const references = ids.slice(-TIMELINE_REFERENCE_COUNT).map(id => id.slice(0, 8));
    return [['previous', ...references]];
  }

  // ---------------------------------------------------------------------------
  // Publishing
  // ---------------------------------------------------------------------------

  private async publishToGroup(
    relayUrl: string,
    groupId: string,
    kind: number,
    content: string,
    tags: string[][]
  ): Promise<boolean> {
    this.sending.set(true);

    try {
      const error = await this.signAndSend(relayUrl, kind, content, tags);
      if (error) {
        this.logger.error('[NIP-29] Relay rejected event', { relayUrl, groupId, kind, error });
        return false;
      }
      return true;
    } finally {
      this.sending.set(false);
    }
  }

  /**
   * Sign an event and publish it to a single relay. NIP-29 events are only
   * meaningful on the relay that enforces the group, so we never broadcast
   * them to the account's own relays.
   *
   * @returns `null` on success, or the relay's error message.
   */
  private async signAndSend(
    relayUrl: string,
    kind: number,
    content: string,
    tags: string[][]
  ): Promise<string | null> {
    const normalized = this.normalize(relayUrl);
    if (!normalized) return 'Invalid relay URL';

    try {
      const unsigned: UnsignedEvent = this.nostr.createEvent(kind, content, tags);
      const signed = await this.nostr.signEvent(unsigned);

      await this.relayPool.publish([normalized], signed, 10000);
      await this.database.saveEvent(signed).catch(() => undefined);

      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Parsing helpers
  // ---------------------------------------------------------------------------

  private parseGroupMetadata(relayUrl: string, event: Event): Nip29Group {
    const tag = (name: string): string | undefined =>
      event.tags.find(entry => entry[0] === name)?.[1];
    const hasTag = (name: string): boolean => event.tags.some(entry => entry[0] === name);

    const id = tag('d') ?? '';
    const supportedKindsTag = event.tags.find(entry => entry[0] === 'supported_kinds');

    return {
      relay: this.normalize(relayUrl),
      id,
      name: tag('name')?.trim() || id,
      picture: tag('picture'),
      banner: tag('banner'),
      about: tag('about'),
      isPrivate: hasTag('private'),
      isRestricted: hasTag('restricted'),
      isHidden: hasTag('hidden'),
      isClosed: hasTag('closed'),
      hasLivekit: hasTag('livekit'),
      supportedKinds: supportedKindsTag
        ? supportedKindsTag
            .slice(1)
            .map(value => Number(value))
            .filter(value => Number.isFinite(value))
        : undefined,
      parent: tag('parent'),
      children: event.tags.filter(entry => entry[0] === 'child' && entry[1]).map(entry => entry[1]),
      updatedAt: event.created_at,
    };
  }

  private parseAdmins(event: Event | undefined): Nip29Admin[] {
    if (!event) return [];

    return event.tags
      .filter(tag => tag[0] === 'p' && tag[1])
      .map(tag => ({ pubkey: tag[1], roles: tag.slice(2).filter(Boolean) }));
  }

  private parseRoles(event: Event | undefined): Nip29Role[] {
    if (!event) return [];

    return event.tags
      .filter(tag => tag[0] === 'role' && tag[1])
      .map(tag => ({ name: tag[1], description: tag[2] }));
  }

  private parsePins(event: Event | undefined): string[] {
    if (!event) return [];

    return event.tags
      .filter(tag => (tag[0] === 'e' || tag[0] === 'a') && tag[1])
      .map(tag => tag[1]);
  }

  private tagValues(event: Event | undefined, name: string): string[] {
    if (!event) return [];
    return event.tags.filter(tag => tag[0] === name && tag[1]).map(tag => tag[1]);
  }

  private toMessage(event: Event): Nip29Message {
    const replyTag =
      event.tags.find(tag => tag[0] === 'e' && tag[3] === 'reply') ??
      event.tags.find(tag => tag[0] === 'e' && tag[3] !== 'root');

    return {
      id: event.id,
      pubkey: event.pubkey,
      content: event.content,
      createdAt: event.created_at,
      kind: event.kind,
      replyTo: replyTag?.[1],
      subject:
        event.tags.find(tag => tag[0] === 'title')?.[1] ??
        event.tags.find(tag => tag[0] === 'subject')?.[1],
      event,
    };
  }

  private upsertGroup(group: Nip29Group): void {
    const groups = this.groupsByServer()[group.relay] ?? [];
    const index = groups.findIndex(entry => entry.id === group.id);

    if (index >= 0 && groups[index].updatedAt >= group.updatedAt) return;

    const next =
      index >= 0
        ? groups.map(entry => (entry.id === group.id ? group : entry))
        : [...groups, group].sort((a, b) => a.name.localeCompare(b.name));

    this.groupsByServer.update(state => ({ ...state, [group.relay]: next }));
    this.writeGroupsCache(group.relay, next);
  }

  private resolveMembershipFromMembers(
    relayUrl: string,
    groupId: string,
    members: string[]
  ): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey || members.length === 0) return;

    if (members.includes(pubkey)) {
      this.setMembership(relayUrl, groupId, 'member');
    }
  }

  private setMembership(relayUrl: string, groupId: string, membership: Nip29Membership): void {
    const key = this.groupKey(relayUrl, groupId);
    this.membershipByGroup.update(state => ({ ...state, [key]: membership }));
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  private restoreServers(): void {
    const stored = this.readJson<{ url: string; added: boolean; name?: string; icon?: string; selfPubkey?: string; infoFetchedAt?: number }[]>(
      STORAGE_KEY_SERVERS,
      []
    );

    const servers = new Map<string, Nip29Server>();

    for (const suggestion of SUGGESTED_NIP29_SERVERS) {
      const normalized = this.normalize(suggestion);
      if (normalized) servers.set(normalized, this.createServer(normalized, false));
    }

    for (const entry of stored) {
      const normalized = this.normalize(entry.url);
      if (!normalized) continue;

      servers.set(normalized, {
        ...this.createServer(normalized, entry.added !== false),
        name: entry.name || this.hostName(normalized),
        icon: entry.icon,
        selfPubkey: entry.selfPubkey,
        infoFetchedAt: entry.infoFetchedAt,
      });
    }

    this.servers.set([...servers.values()]);
  }

  private persistServers(): void {
    const payload = this.servers()
      .filter(server => server.added || server.infoFetchedAt)
      .map(server => ({
        url: server.url,
        added: server.added,
        name: server.name,
        icon: server.icon,
        selfPubkey: server.selfPubkey,
        infoFetchedAt: server.infoFetchedAt,
      }));

    this.writeJson(STORAGE_KEY_SERVERS, payload);
  }

  private readGroupsCache(relayUrl: string): Nip29ServerCache | null {
    const cache = this.readJson<Record<string, Nip29ServerCache>>(STORAGE_KEY_GROUPS, {});
    return cache[relayUrl] ?? null;
  }

  private writeGroupsCache(relayUrl: string, groups: Nip29Group[]): void {
    const cache = this.readJson<Record<string, Nip29ServerCache>>(STORAGE_KEY_GROUPS, {});
    cache[relayUrl] = { relay: relayUrl, fetchedAt: Date.now(), groups };

    // Keep the cache bounded — only the eight most recently used servers.
    const entries = Object.values(cache)
      .sort((a, b) => b.fetchedAt - a.fetchedAt)
      .slice(0, 8);

    this.writeJson(
      STORAGE_KEY_GROUPS,
      Object.fromEntries(entries.map(entry => [entry.relay, entry]))
    );
  }

  private createServer(url: string, added: boolean): Nip29Server {
    return {
      url,
      slug: this.serverSlug(url),
      name: this.hostName(url),
      added,
    };
  }

  private hostName(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  private normalize(url: string): string {
    if (!url) return '';
    return this.utilities.normalizeRelayUrl(url.trim());
  }

  private toHttpUrl(relayUrl: string): string {
    return relayUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
  }

  private base64(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  /** Collapse identical concurrent requests into a single relay round-trip. */
  private dedupe<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const promise = factory().finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  private readJson<T>(key: string, fallback: T): T {
    if (!this.isBrowser) return fallback;

    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  private writeJson(key: string, value: unknown): void {
    if (!this.isBrowser) return;

    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      this.logger.debug('[NIP-29] Failed to write local cache', { key, error });
    }
  }
}

/** Re-exported for convenience in components. */
export type { Nip29Group, Nip29GroupNode, Nip29Message, Nip29Server };
