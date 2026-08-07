import { signal, computed, inject, effect, Service } from '@angular/core';
import { Event } from 'nostr-tools';

import { NostrService } from './nostr.service';
import { AccountStateService } from './account-state.service';
import { AccountRelayService } from './relays/account-relay';
import { DatabaseService } from './database.service';
import { LayoutService } from './layout.service';
import { LoggerService } from './logger.service';
import { UtilitiesService } from './utilities.service';
import {
  NIP29_KIND_GROUPS_LIST,
  Nip29GroupsListEntry,
} from '../interfaces/nip29';

/**
 * Service managing the NIP-51 "simple groups" list (kind:10009).
 *
 * Each remembered group is stored as a `["group", "<group-id>", "<relay-url>", "<name>"]`
 * tag. The relay hint is what lets us detect group migrations and forks (NIP-29),
 * so it is always persisted alongside the id.
 */
@Service()
export class Nip29GroupsListService {
  private readonly accountRelay = inject(AccountRelayService);
  private readonly nostr = inject(NostrService);
  private readonly accountState = inject(AccountStateService);
  private readonly database = inject(DatabaseService);
  private readonly layout = inject(LayoutService);
  private readonly logger = inject(LoggerService);
  private readonly utilities = inject(UtilitiesService);

  readonly listEvent = signal<Event | null>(null);

  /** Whether the initial load from IndexedDB has completed. */
  readonly initialized = signal(false);

  /** Groups the user has chosen to remember being in. */
  readonly entries = computed<Nip29GroupsListEntry[]>(() => {
    const event = this.listEvent();
    if (!event) return [];

    return event.tags
      .filter(tag => tag[0] === 'group' && tag[1])
      .map(tag => ({
        groupId: tag[1],
        relay: this.normalizeRelay(tag[2] ?? ''),
        name: tag[3] || undefined,
      }))
      .filter(entry => entry.relay.length > 0);
  });

  /** Relay URLs referenced by the list, used to seed the server rail. */
  readonly relays = computed<string[]>(() => {
    const event = this.listEvent();
    const fromGroups = this.entries().map(entry => entry.relay);
    const fromRelayTags = (event?.tags ?? [])
      .filter(tag => tag[0] === 'relay' && tag[1])
      .map(tag => this.normalizeRelay(tag[1]));

    return [...new Set([...fromGroups, ...fromRelayTags])].filter(Boolean);
  });

  /** Fast membership lookup keyed by `<relay>|<groupId>`. */
  private readonly entryKeys = computed<Set<string>>(
    () => new Set(this.entries().map(entry => this.key(entry.relay, entry.groupId)))
  );

  constructor() {
    effect(async () => {
      const pubkey = this.accountState.pubkey();

      if (pubkey) {
        await this.initialize();
      } else {
        this.listEvent.set(null);
        this.initialized.set(false);
      }
    });
  }

  async initialize(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    try {
      const event = await this.database.getEventByPubkeyAndKind(pubkey, NIP29_KIND_GROUPS_LIST);
      this.listEvent.set(event);
    } catch (error) {
      this.logger.warn('[Nip29GroupsList] Failed to load cached list', error);
    } finally {
      this.initialized.set(true);
    }
  }

  /**
   * Apply an incoming kind:10009 event, ignoring anything older than what we
   * already have. Called from the account metadata subscription.
   */
  updateFromEvent(event: Event): void {
    const current = this.listEvent();
    if (!current || event.created_at >= current.created_at) {
      this.listEvent.set(event);
    }
  }

  isSaved(relay: string, groupId: string): boolean {
    return this.entryKeys().has(this.key(this.normalizeRelay(relay), groupId));
  }

  /** Add a group to the remembered list (no-op when already present). */
  async addGroup(relay: string, groupId: string, name?: string): Promise<void> {
    const normalized = this.normalizeRelay(relay);
    if (!normalized || !groupId) return;
    if (this.isSaved(normalized, groupId)) return;

    const tags = [...(this.listEvent()?.tags ?? [])];
    const tag = ['group', groupId, normalized];
    if (name) tag.push(name);
    tags.push(tag);

    await this.publish(tags);
  }

  /** Remove a group from the remembered list. */
  async removeGroup(relay: string, groupId: string): Promise<void> {
    const existing = this.listEvent();
    if (!existing) return;

    const normalized = this.normalizeRelay(relay);
    const tags = existing.tags.filter(
      tag =>
        !(
          tag[0] === 'group' &&
          tag[1] === groupId &&
          this.normalizeRelay(tag[2] ?? '') === normalized
        )
    );

    if (tags.length === existing.tags.length) return;

    await this.publish(tags);
  }

  /**
   * Point an existing entry at a different relay. Used when the user accepts a
   * group migration or fork detected via an admin's kind:10009.
   */
  async moveGroup(groupId: string, fromRelay: string, toRelay: string): Promise<void> {
    const existing = this.listEvent();
    if (!existing) return;

    const from = this.normalizeRelay(fromRelay);
    const to = this.normalizeRelay(toRelay);
    if (!to || from === to) return;

    const tags = existing.tags.map(tag => {
      if (tag[0] === 'group' && tag[1] === groupId && this.normalizeRelay(tag[2] ?? '') === from) {
        const next = [...tag];
        next[2] = to;
        return next;
      }
      return tag;
    });

    await this.publish(tags);
  }

  private async publish(tags: string[][]): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    const unsigned = this.nostr.createEvent(NIP29_KIND_GROUPS_LIST, '', tags);
    const signed = await this.nostr.signEvent(unsigned);

    await this.database.saveEvent(signed);
    this.listEvent.set(signed);

    const publishPromises = await this.accountRelay.publish(signed);
    await this.layout.showPublishResults(publishPromises, 'Groups');
  }

  private key(relay: string, groupId: string): string {
    return `${relay}|${groupId}`;
  }

  private normalizeRelay(url: string): string {
    if (!url) return '';
    try {
      return this.utilities.normalizeRelayUrl(url);
    } catch {
      return '';
    }
  }
}
