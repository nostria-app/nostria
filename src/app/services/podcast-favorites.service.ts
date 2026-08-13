import { computed, effect, inject, signal, Service } from '@angular/core';
import { Event } from 'nostr-tools';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NostrService } from './nostr.service';
import { AccountStateService } from './account-state.service';
import { AccountRelayService } from './relays/account-relay';
import { DatabaseService } from './database.service';
import { LayoutService } from './layout.service';
import { FAVORITE_PODCASTS_KIND } from '../utils/podcast';

export interface FavoriteRssPodcast {
  url: string;
}

/**
 * NIP-51 kind 10054 favorite podcasts.
 * Stores `p` tags for NIP-F4 show pubkeys and `url` tags for RSS feeds.
 */
@Service()
export class PodcastFavoritesService {
  private accountRelay = inject(AccountRelayService);
  private nostr = inject(NostrService);
  private accountState = inject(AccountStateService);
  private snackBar = inject(MatSnackBar);
  private layout = inject(LayoutService);
  private database = inject(DatabaseService);

  readonly listEvent = signal<Event | null>(null);
  readonly initialized = signal(false);

  readonly showPubkeys = computed(() => {
    return this.listEvent()
      ?.tags.filter(tag => tag[0] === 'p' && !!tag[1])
      .map(tag => tag[1]) ?? [];
  });

  readonly showPubkeySet = computed(() => new Set(this.showPubkeys()));

  readonly rssUrls = computed(() => {
    return this.listEvent()
      ?.tags.filter(tag => tag[0] === 'url' && !!tag[1])
      .map(tag => tag[1]) ?? [];
  });

  constructor() {
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        void this.initialize();
      } else {
        this.listEvent.set(null);
        this.initialized.set(false);
      }
    });
  }

  async initialize(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.listEvent.set(null);
      this.initialized.set(true);
      return;
    }

    const event = await this.database.getEventByPubkeyAndKind(pubkey, FAVORITE_PODCASTS_KIND);
    this.listEvent.set(event);
    this.initialized.set(true);
  }

  updateFromEvent(event: Event): void {
    const current = this.listEvent();
    if (!current || event.created_at >= current.created_at) {
      this.listEvent.set(event);
    }
  }

  isFavoriteShow(pubkey: string): boolean {
    return this.showPubkeySet().has(pubkey);
  }

  isFavoriteRss(url: string): boolean {
    return this.rssUrls().includes(url);
  }

  async toggleShow(pubkey: string): Promise<void> {
    if (this.isFavoriteShow(pubkey)) {
      await this.removeShow(pubkey);
      return;
    }
    await this.addShow(pubkey);
  }

  async addShow(pubkey: string): Promise<void> {
    const event = this.ensureListEvent();
    if (event.tags.some(tag => tag[0] === 'p' && tag[1] === pubkey)) {
      return;
    }
    event.tags.push(['p', pubkey]);
    await this.publish(event);
  }

  async removeShow(pubkey: string): Promise<void> {
    const existing = this.listEvent();
    if (!existing) {
      return;
    }
    await this.publish({
      ...existing,
      tags: existing.tags.filter(tag => !(tag[0] === 'p' && tag[1] === pubkey)),
    });
  }

  async addRss(url: string): Promise<void> {
    const event = this.ensureListEvent();
    if (event.tags.some(tag => tag[0] === 'url' && tag[1] === url)) {
      return;
    }
    event.tags.push(['url', url]);
    await this.publish(event);
  }

  async removeRss(url: string): Promise<void> {
    const existing = this.listEvent();
    if (!existing) {
      return;
    }
    await this.publish({
      ...existing,
      tags: existing.tags.filter(tag => !(tag[0] === 'url' && tag[1] === url)),
    });
  }

  private ensureListEvent(): Event {
    const existing = this.listEvent();
    if (existing) {
      return { ...existing, tags: [...existing.tags] };
    }

    return {
      kind: FAVORITE_PODCASTS_KIND,
      pubkey: this.accountState.pubkey() ?? '',
      created_at: Math.floor(Date.now() / 1000),
      content: '',
      tags: [],
      id: '',
      sig: '',
    } as Event;
  }

  private async publish(event: Event): Promise<void> {
    if (!this.accountState.pubkey()) {
      this.snackBar.open($localize`:@@podcasts.favorites.signIn:Sign in to save favorites`, '', {
        duration: 3000,
      });
      return;
    }

    event.id = '';
    event.sig = '';
    event.created_at = Math.floor(Date.now() / 1000);

    const signedEvent = await this.nostr.signEvent(event);
    await this.database.saveReplaceableEvent(signedEvent);
    this.listEvent.set(signedEvent);

    const publishPromises = await this.accountRelay.publish(signedEvent);
    await this.layout.showPublishResults(publishPromises, $localize`:@@podcasts.favorites.publishLabel:Favorite podcasts`);
  }
}
