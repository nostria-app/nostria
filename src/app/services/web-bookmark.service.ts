import { Injectable, inject, signal } from '@angular/core';
import { Event } from 'nostr-tools';
import { AccountStateService } from './account-state.service';
import { DatabaseService } from './database.service';
import { DeletionFilterService } from './deletion-filter.service';
import { DeleteEventService } from './delete-event.service';
import { LoggerService } from './logger.service';
import { NostrService } from './nostr.service';
import { PublishService } from './publish.service';
import { RelayPoolService } from './relays/relay-pool';
import { UserRelayService } from './relays/user-relay';
import { UtilitiesService } from './utilities.service';

export const WEB_BOOKMARK_KIND = 39701;

export interface WebBookmark {
  id: string;
  event: Event;
  url: string;
  dTag: string;
  title: string;
  description: string;
  tags: string[];
  publishedAt: number;
  createdAt: number;
  authorPubkey: string;
  domain: string;
}

@Injectable({
  providedIn: 'root',
})
export class WebBookmarkService {
  private readonly accountState = inject(AccountStateService);
  private readonly database = inject(DatabaseService);
  private readonly deletionFilter = inject(DeletionFilterService);
  private readonly deleteEvent = inject(DeleteEventService);
  private readonly logger = inject(LoggerService);
  private readonly nostr = inject(NostrService);
  private readonly publish = inject(PublishService);
  private readonly userRelay = inject(UserRelayService);
  private readonly relayPool = inject(RelayPoolService);
  private readonly utilities = inject(UtilitiesService);
  private personalSubscription: { close: () => void } | null = null;
  private personalSubscriptionPubkey = '';

  readonly personalBookmarks = signal<WebBookmark[]>([]);
  readonly socialBookmarks = signal<WebBookmark[]>([]);
  readonly loadingPersonal = signal(false);
  readonly loadingSocial = signal(false);

  normalizeUrl(input: string): { url: string; dTag: string; domain: string } | null {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }

    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

    try {
      const parsed = new URL(withScheme);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return null;
      }

      parsed.hash = '';
      const normalizedPath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
      const dTag = `${parsed.host}${normalizedPath}${parsed.search}`;
      const url = `${parsed.protocol}//${dTag}`;

      return {
        url,
        dTag,
        domain: parsed.hostname.replace(/^www\./i, ''),
      };
    } catch {
      return null;
    }
  }

  bookmarkFromEvent(event: Event): WebBookmark | null {
    if (event.kind !== WEB_BOOKMARK_KIND) {
      return null;
    }

    const dTag = event.tags.find(tag => tag[0] === 'd')?.[1]?.trim();
    if (!dTag) {
      return null;
    }

    const title = event.tags.find(tag => tag[0] === 'title')?.[1]?.trim() || this.titleFromDTag(dTag);
    const publishedAt = Number.parseInt(event.tags.find(tag => tag[0] === 'published_at')?.[1] || '', 10);
    const tags = event.tags
      .filter(tag => tag[0] === 't' && tag[1]?.trim())
      .map(tag => tag[1].trim().toLowerCase());
    const url = this.urlFromDTag(dTag);

    return {
      id: event.id,
      event,
      url,
      dTag,
      title,
      description: event.content || '',
      tags,
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : event.created_at,
      createdAt: event.created_at,
      authorPubkey: event.pubkey,
      domain: this.domainFromUrl(url),
    };
  }

  async loadPersonal(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.closePersonalSubscription();
      this.personalBookmarks.set([]);
      return;
    }

    this.loadingPersonal.set(true);
    try {
      await this.database.init();
      let events = await this.database.getEventsByPubkeyAndKind(pubkey, WEB_BOOKMARK_KIND);

      try {
        const relayEvents = await this.userRelay.getEventsByPubkeyAndKind(pubkey, WEB_BOOKMARK_KIND, {
          useFullRelaySet: true,
          refreshRelays: true,
        });
        events = [...events, ...relayEvents];
        await this.saveReplaceableEvents(relayEvents);
      } catch (error) {
        this.logger.warn('[WebBookmarkService] Failed to sync personal web bookmarks from relays', error);
      }

      events = await this.deletionFilter.filterDeletedEventsFromDatabase(events);
      this.personalBookmarks.set(this.toLatestBookmarks(events));
      await this.ensurePersonalSubscription(pubkey);
    } catch (error) {
      this.logger.error('[WebBookmarkService] Failed to load personal web bookmarks', error);
      this.personalBookmarks.set([]);
    } finally {
      this.loadingPersonal.set(false);
    }
  }

  async loadSocial(pubkeys: string[]): Promise<void> {
    const authors = [...new Set(pubkeys.filter(Boolean))].slice(0, 160);
    if (authors.length === 0) {
      this.socialBookmarks.set([]);
      return;
    }

    this.loadingSocial.set(true);
    try {
      await this.database.init();
      let events = await this.database.getEventsByPubkeyAndKind(authors, WEB_BOOKMARK_KIND);

      try {
        const relayEvents = await this.userRelay.getEventsByPubkeyAndKind(authors, WEB_BOOKMARK_KIND);
        events = [...events, ...relayEvents];
        await this.saveReplaceableEvents(relayEvents);
      } catch (error) {
        this.logger.warn('[WebBookmarkService] Failed to sync social web bookmarks from author relays', error);
      }

      this.socialBookmarks.set(this.toLatestBookmarks(events));
    } catch (error) {
      this.logger.error('[WebBookmarkService] Failed to load social web bookmarks', error);
      this.socialBookmarks.set([]);
    } finally {
      this.loadingSocial.set(false);
    }
  }

  async loadPublic(limit = 200): Promise<void> {
    this.loadingSocial.set(true);
    try {
      const events = await this.relayPool.query(
        this.utilities.preferredRelays,
        { kinds: [WEB_BOOKMARK_KIND], limit },
        4500
      );
      await this.saveReplaceableEvents(events);
      this.socialBookmarks.set(this.toLatestBookmarks(events));
    } catch (error) {
      this.logger.error('[WebBookmarkService] Failed to load public social bookmarks', error);
      this.socialBookmarks.set([]);
    } finally {
      this.loadingSocial.set(false);
    }
  }

  async queryRelays(relayUrls: string[], limit = 80): Promise<void> {
    if (relayUrls.length === 0) {
      return;
    }

    this.loadingSocial.set(true);
    try {
      const events = await this.relayPool.query(
        relayUrls,
        { kinds: [WEB_BOOKMARK_KIND], limit },
        3500
      );
      await this.saveReplaceableEvents(events);
      this.socialBookmarks.update(current => this.toLatestBookmarks([...current.map(item => item.event), ...events]));
    } finally {
      this.loadingSocial.set(false);
    }
  }

  async saveBookmark(input: {
    url: string;
    title?: string;
    description?: string;
    tags?: string[];
  }): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return false;
    }

    const normalized = this.normalizeUrl(input.url);
    if (!normalized) {
      return false;
    }

    const now = this.utilities.currentDate();
    const eventTags: string[][] = [
      ['d', normalized.dTag],
      ['published_at', String(now)],
    ];

    const title = input.title?.trim();
    if (title) {
      eventTags.push(['title', title]);
    }

    for (const tag of input.tags ?? []) {
      const normalizedTag = tag.replace(/^#/, '').trim().toLowerCase();
      if (normalizedTag) {
        eventTags.push(['t', normalizedTag]);
      }
    }

    const unsigned = this.nostr.createEvent(
      WEB_BOOKMARK_KIND,
      input.description?.trim() || '',
      eventTags
    );
    const signed = await this.nostr.signEvent(unsigned);
    await this.database.saveReplaceableEvent(signed);

    const result = await this.publish.publish(signed, { useOptimizedRelays: false });
    if (result.success) {
      const bookmark = this.bookmarkFromEvent(signed);
      if (bookmark) {
        this.personalBookmarks.update(current => this.toLatestBookmarks([signed, ...current.map(item => item.event)]));
      }
    }

    return result.success;
  }

  async deleteBookmark(bookmark: WebBookmark): Promise<boolean> {
    const result = await this.deleteEvent.confirmDeletion({
      event: bookmark.event,
      title: 'Delete Social Bookmark',
      entityLabel: bookmark.title,
      confirmText: 'Delete',
    });

    if (!result) {
      return false;
    }

    const unsigned = this.deleteEvent.createRetractionEvent(
      (kind, content, tags) => this.nostr.createEvent(kind, content, tags),
      bookmark.event,
      result.referenceMode,
      'Deleted social bookmark'
    );
    const signed = await this.nostr.signEvent(unsigned);
    await this.database.saveEvent(signed);
    const publishResult = await this.publish.publish(signed, { useOptimizedRelays: false });

    if (publishResult.success) {
      this.personalBookmarks.update(items => items.filter(item => item.dTag !== bookmark.dTag));
    }

    return publishResult.success;
  }

  closePersonalSubscription(): void {
    this.personalSubscription?.close();
    this.personalSubscription = null;
    this.personalSubscriptionPubkey = '';
  }

  private async ensurePersonalSubscription(pubkey: string): Promise<void> {
    if (this.personalSubscription && this.personalSubscriptionPubkey === pubkey) {
      return;
    }

    this.closePersonalSubscription();
    const subscription = await this.userRelay.subscribe(
      pubkey,
      { authors: [pubkey], kinds: [WEB_BOOKMARK_KIND, 5], limit: 200 },
      event => {
        void this.handlePersonalSubscriptionEvent(event);
      }
    );

    if (subscription && typeof subscription === 'object' && 'close' in subscription) {
      this.personalSubscription = subscription as { close: () => void };
      this.personalSubscriptionPubkey = pubkey;
    }
  }

  private async handlePersonalSubscriptionEvent(event: Event): Promise<void> {
    if (event.kind === 5) {
      await this.database.saveEvent(event);
      const filtered = await this.deletionFilter.filterDeletedEventsFromDatabase(
        this.personalBookmarks().map(item => item.event)
      );
      this.personalBookmarks.set(this.toLatestBookmarks(filtered));
      return;
    }

    if (event.kind !== WEB_BOOKMARK_KIND) {
      return;
    }

    await this.database.saveReplaceableEvent(event);
    this.personalBookmarks.update(current => this.toLatestBookmarks([event, ...current.map(item => item.event)]));
  }

  private async saveReplaceableEvents(events: Event[]): Promise<void> {
    for (const event of events) {
      await this.database.saveReplaceableEvent(event);
    }
  }

  private toLatestBookmarks(events: Event[]): WebBookmark[] {
    const latestByAddress = new Map<string, Event>();

    for (const event of events) {
      const dTag = event.tags.find(tag => tag[0] === 'd')?.[1];
      if (!dTag) {
        continue;
      }

      const key = `${event.pubkey}:${dTag}`;
      const existing = latestByAddress.get(key);
      if (!existing || event.created_at >= existing.created_at) {
        latestByAddress.set(key, event);
      }
    }

    return Array.from(latestByAddress.values())
      .map(event => this.bookmarkFromEvent(event))
      .filter((bookmark): bookmark is WebBookmark => bookmark !== null)
      .sort((a, b) => b.publishedAt - a.publishedAt);
  }

  private urlFromDTag(dTag: string): string {
    if (/^https?:\/\//i.test(dTag)) {
      return dTag;
    }

    return `https://${dTag}`;
  }

  private titleFromDTag(dTag: string): string {
    try {
      const url = this.urlFromDTag(dTag);
      const parsed = new URL(url);
      const lastSegment = parsed.pathname.split('/').filter(Boolean).pop();
      return lastSegment ? decodeURIComponent(lastSegment).replace(/[-_]/g, ' ') : parsed.hostname;
    } catch {
      return dTag;
    }
  }

  private domainFromUrl(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./i, '');
    } catch {
      return url;
    }
  }
}
