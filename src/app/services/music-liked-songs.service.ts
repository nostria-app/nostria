import { Injectable, effect, inject, signal } from '@angular/core';
import { Event, Filter, kinds } from 'nostr-tools';
import { AccountStateService } from './account-state.service';
import { AccountRelayService } from './relays/account-relay';
import { ApplicationService } from './application.service';
import { DatabaseService } from './database.service';
import { LoggerService } from './logger.service';
import { NostrService } from './nostr.service';
import { RelayPoolService } from './relays/relay-pool';
import { RelaysService } from './relays/relays';
import { UtilitiesService } from './utilities.service';

const BOOKMARK_SET_KIND = 30003;
const LIKED_SONGS_D_TAG = 'liked-songs';
const LIKED_ALBUMS_D_TAG = 'liked-albums';

export interface LikedSongsReference {
  ref: string;
  eventId?: string;
}

type LikedCollectionType = 'tracks' | 'albums';

@Injectable({
  providedIn: 'root',
})
export class MusicLikedSongsService {
  private accountState = inject(AccountStateService);
  private accountRelay = inject(AccountRelayService);
  private app = inject(ApplicationService);
  private database = inject(DatabaseService);
  private logger = inject(LoggerService);
  private nostr = inject(NostrService);
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);

  private likedSongsEventState = signal<Event | null>(null);
  likedSongsEvent = this.likedSongsEventState.asReadonly();

  private likedSongRefsState = signal<LikedSongsReference[]>([]);
  likedSongRefs = this.likedSongRefsState.asReadonly();

  private likedAlbumsEventState = signal<Event | null>(null);
  likedAlbumsEvent = this.likedAlbumsEventState.asReadonly();

  private likedAlbumRefsState = signal<LikedSongsReference[]>([]);
  likedAlbumRefs = this.likedAlbumRefsState.asReadonly();

  private loadingState = signal(false);
  loading = this.loadingState.asReadonly();

  private initializedPubkey: string | null = null;
  private initializePromise: Promise<void> | null = null;

  constructor() {
    effect(() => {
      const pubkey = this.accountState.pubkey();
      const initialized = this.app.initialized();

      if (!initialized) {
        return;
      }

      if (!pubkey) {
        this.resetState();
        return;
      }

      if (pubkey !== this.initializedPubkey) {
        void this.initialize(pubkey);
      }
    });
  }

  async ensureInitialized(pubkey = this.accountState.pubkey()): Promise<void> {
    if (!pubkey) {
      this.resetState();
      return;
    }

    if (this.initializedPubkey === pubkey && !this.initializePromise) {
      return;
    }

    if (this.initializedPubkey === pubkey && this.initializePromise) {
      await this.initializePromise;
      return;
    }

    await this.initialize(pubkey);
  }

  isTrackLiked(track: Event): boolean {
    const trackRef = this.getTrackRef(track);
    if (!trackRef) {
      return false;
    }

    return this.likedSongRefsState().some(item => item.ref === trackRef);
  }

  async addTrack(track: Event): Promise<boolean> {
    const trackRef = this.getTrackRef(track);
    if (!trackRef) {
      return false;
    }

    await this.ensureInitialized();

    if (this.hasRef(trackRef, 'tracks')) {
      return true;
    }

    return this.publishUpdatedSet([...this.likedSongRefsState(), { ref: trackRef }], 'tracks');
  }

  async removeTrack(track: Event): Promise<boolean> {
    const trackRef = this.getTrackRef(track);
    if (!trackRef) {
      return false;
    }

    return this.removeRef(trackRef, 'tracks');
  }

  isAlbumLiked(album: Event): boolean {
    const albumRef = this.getTrackRef(album);
    if (!albumRef) {
      return false;
    }

    return this.likedAlbumRefsState().some(item => item.ref === albumRef);
  }

  async addAlbum(album: Event): Promise<boolean> {
    const albumRef = this.getTrackRef(album);
    if (!albumRef) {
      return false;
    }

    await this.ensureInitialized();

    if (this.hasRef(albumRef, 'albums')) {
      return true;
    }

    return this.publishUpdatedSet([...this.likedAlbumRefsState(), { ref: albumRef }], 'albums');
  }

  async removeAlbum(album: Event): Promise<boolean> {
    const albumRef = this.getTrackRef(album);
    if (!albumRef) {
      return false;
    }

    return this.removeRef(albumRef, 'albums');
  }

  async removeRef(ref: string, type: LikedCollectionType = 'tracks'): Promise<boolean> {
    await this.ensureInitialized();

    if (!this.hasRef(ref, type)) {
      return true;
    }

    const refs = this.getRefs(type).filter(item => item.ref !== ref);
    return this.publishUpdatedSet(refs, type);
  }

  async importExistingLikes(): Promise<number> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return 0;
    }

    await this.ensureInitialized(pubkey);

    const likedRefs = await this.fetchLikedRefsFromReactions(pubkey, 'tracks');
    return this.importRefs(likedRefs, 'tracks');
  }

  async importExistingAlbumLikes(): Promise<number> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return 0;
    }

    await this.ensureInitialized(pubkey);

    const likedRefs = await this.fetchLikedRefsFromReactions(pubkey, 'albums');
    return this.importRefs(likedRefs, 'albums');
  }

  private async importRefs(likedRefs: string[], type: LikedCollectionType): Promise<number> {
    if (likedRefs.length === 0) {
      if (!this.getEvent(type)) {
        await this.publishUpdatedSet([], type);
      }
      return 0;
    }

    const merged = this.mergeRefs(this.getRefs(type), likedRefs.map(ref => ({ ref })));
    const previousCount = this.getRefs(type).length;
    const saved = await this.publishUpdatedSet(merged, type);
    if (!saved) {
      return 0;
    }

    return Math.max(0, merged.length - previousCount);
  }

  private async initialize(pubkey: string): Promise<void> {
    this.initializedPubkey = pubkey;
    this.loadingState.set(true);

    const initPromise = (async () => {
      try {
        const [cachedTracks, cachedAlbums] = await Promise.all([
          this.database.getParameterizedReplaceableEvent(pubkey, BOOKMARK_SET_KIND, LIKED_SONGS_D_TAG),
          this.database.getParameterizedReplaceableEvent(pubkey, BOOKMARK_SET_KIND, LIKED_ALBUMS_D_TAG),
        ]);
        if (this.initializedPubkey !== pubkey) {
          return;
        }

        this.applyLikedEvent(cachedTracks, 'tracks');
        this.applyLikedEvent(cachedAlbums, 'albums');

        const [relayTracks, relayAlbums] = await Promise.all([
          this.fetchLikedEventFromRelays(pubkey, 'tracks'),
          this.fetchLikedEventFromRelays(pubkey, 'albums'),
        ]);
        if (this.initializedPubkey !== pubkey) {
          return;
        }

        if (relayTracks) {
          await this.database.saveReplaceableEvent(relayTracks);
          this.applyLikedEvent(relayTracks, 'tracks');
        }

        if (relayAlbums) {
          await this.database.saveReplaceableEvent(relayAlbums);
          this.applyLikedEvent(relayAlbums, 'albums');
        }

        if (!relayTracks && !this.likedSongsEventState()) {
          const importedTrackRefs = await this.fetchLikedRefsFromReactions(pubkey, 'tracks');
          const importedTrackCount = await this.importRefs(importedTrackRefs, 'tracks');
          if (importedTrackCount === 0 && !this.likedSongsEventState()) {
            await this.publishUpdatedSet([], 'tracks');
          }
        }

        if (!relayAlbums && !this.likedAlbumsEventState()) {
          const importedAlbumRefs = await this.fetchLikedRefsFromReactions(pubkey, 'albums');
          const importedAlbumCount = await this.importRefs(importedAlbumRefs, 'albums');
          if (importedAlbumCount === 0 && !this.likedAlbumsEventState()) {
            await this.publishUpdatedSet([], 'albums');
          }
        }
      } catch (error) {
        this.logger.error('[MusicLikedSongs] Failed to initialize liked songs:', error);
      } finally {
        if (this.initializedPubkey === pubkey) {
          this.loadingState.set(false);
        }
      }
    })();

    this.initializePromise = initPromise;

    try {
      await initPromise;
    } finally {
      if (this.initializePromise === initPromise) {
        this.initializePromise = null;
      }
    }
  }

  private resetState(): void {
    this.initializedPubkey = null;
    this.initializePromise = null;
    this.loadingState.set(false);
    this.applyLikedEvent(null, 'tracks');
    this.applyLikedEvent(null, 'albums');
  }

  private async fetchLikedEventFromRelays(pubkey: string, type: LikedCollectionType): Promise<Event | null> {
    const relayUrls = this.getRelayUrls();
    if (relayUrls.length === 0) {
      return null;
    }

    const filter: Filter = {
      kinds: [BOOKMARK_SET_KIND],
      authors: [pubkey],
      '#d': [this.getDTag(type)],
      limit: 10,
    };

    const events = await this.pool.query(relayUrls, filter, 5000);
    if (events.length === 0) {
      return null;
    }

    return events.reduce((latest, event) => {
      if (event.created_at !== latest.created_at) {
        return event.created_at > latest.created_at ? event : latest;
      }

      return event.id.localeCompare(latest.id) > 0 ? event : latest;
    });
  }

  private async fetchLikedRefsFromReactions(pubkey: string, type: LikedCollectionType): Promise<string[]> {
    const reactions = await this.accountRelay.getMany<Event>({
      kinds: [kinds.Reaction],
      authors: [pubkey],
      limit: 1000,
    }, { timeout: 5000 });

    const newestReactionByRef = new Map<string, Event>();

    for (const reaction of reactions) {
      if (!this.isPositiveReaction(reaction)) {
        continue;
      }

      const ref = this.getMusicReactionRef(reaction, type);
      if (!ref) {
        continue;
      }

      const existing = newestReactionByRef.get(ref);
      if (!existing || reaction.created_at > existing.created_at) {
        newestReactionByRef.set(ref, reaction);
      }
    }

    return Array.from(newestReactionByRef.keys());
  }

  private isPositiveReaction(reaction: Event): boolean {
    return reaction.content === '+'
      || reaction.content === '❤️'
      || reaction.content === '🤙'
      || reaction.content === '👍';
  }

  private getMusicReactionRef(reaction: Event, type: LikedCollectionType): string | null {
    const aTag = reaction.tags.find(tag => tag[0] === 'a')?.[1]?.trim();
    if (aTag) {
      const parsed = this.utilities.parseMusicTrackCoordinate(aTag);
      if (parsed && type === 'tracks') {
        return aTag;
      }

      const parts = aTag.split(':');
      if (parts.length >= 3 && Number.parseInt(parts[0], 10) === 34139 && type === 'albums') {
        return aTag;
      }
    }

    const eTag = reaction.tags.find(tag => tag[0] === 'e')?.[1]?.trim();
    const kindTag = reaction.tags.find(tag => tag[0] === 'k')?.[1]?.trim();
    if (!eTag || !kindTag) {
      return null;
    }

    const kind = Number.parseInt(kindTag, 10);
    if (Number.isNaN(kind)) {
      return null;
    }

    if (type === 'tracks' && !this.utilities.isMusicKind(kind)) {
      return null;
    }

    if (type === 'albums' && kind !== 34139) {
      return null;
    }

    return eTag;
  }

  private getTrackRef(track: Event): string | null {
    if (this.utilities.isParameterizedReplaceableEvent(track.kind)) {
      const dTag = track.tags.find(tag => tag[0] === 'd')?.[1] || '';
      if (dTag) {
        return `${track.kind}:${track.pubkey}:${dTag}`;
      }

      if (track.kind === 34139 && track.id) {
        return track.id;
      }

      return null;
    }

    return track.id || null;
  }

  private hasRef(ref: string, type: LikedCollectionType): boolean {
    return this.getRefs(type).some(item => item.ref === ref);
  }

  private mergeRefs(existing: LikedSongsReference[], additions: LikedSongsReference[]): LikedSongsReference[] {
    const merged = new Map<string, LikedSongsReference>();

    for (const item of existing) {
      merged.set(item.ref, item);
    }

    for (const item of additions) {
      merged.set(item.ref, item);
    }

    return Array.from(merged.values());
  }

  private buildLikedTags(refs: LikedSongsReference[], type: LikedCollectionType): string[][] {
    const title = type === 'tracks' ? 'Liked Songs' : 'Liked Albums';
    const tags: string[][] = [
      ['d', this.getDTag(type)],
      ['title', title],
      ['alt', title],
      ['t', 'music'],
      ['t', type === 'tracks' ? 'liked-songs' : 'liked-albums'],
      ['public', 'true'],
    ];

    for (const item of refs) {
      if (item.ref.includes(':')) {
        tags.push(['a', item.ref]);
      } else {
        tags.push(['e', item.ref]);
      }
    }

    return tags;
  }

  private parseLikedRefs(event: Event | null): LikedSongsReference[] {
    if (!event) {
      return [];
    }

    const refs: LikedSongsReference[] = [];
    for (const tag of event.tags) {
      if ((tag[0] === 'a' || tag[0] === 'e') && tag[1]) {
        refs.push({ ref: tag[1], eventId: tag[0] === 'e' ? tag[1] : undefined });
      }
    }

    return this.mergeRefs([], refs);
  }

  private applyLikedEvent(event: Event | null, type: LikedCollectionType): void {
    if (type === 'tracks') {
      this.likedSongsEventState.set(event);
      this.likedSongRefsState.set(this.parseLikedRefs(event));
      return;
    }

    this.likedAlbumsEventState.set(event);
    this.likedAlbumRefsState.set(this.parseLikedRefs(event));
  }

  private async publishUpdatedSet(refs: LikedSongsReference[], type: LikedCollectionType): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return false;
    }

    const tags = this.buildLikedTags(refs, type);
    const content = this.getEvent(type)?.content || '';
    const unsignedEvent = this.nostr.createEvent(BOOKMARK_SET_KIND, content, tags);
    const result = await this.nostr.signAndPublish(unsignedEvent, this.getRelayUrls());
    if (!result.success || !result.event) {
      return false;
    }

    await this.database.saveReplaceableEvent(result.event);
    this.applyLikedEvent(result.event, type);
    return true;
  }

  private getDTag(type: LikedCollectionType): string {
    return type === 'tracks' ? LIKED_SONGS_D_TAG : LIKED_ALBUMS_D_TAG;
  }

  private getRefs(type: LikedCollectionType): LikedSongsReference[] {
    return type === 'tracks' ? this.likedSongRefsState() : this.likedAlbumRefsState();
  }

  private getEvent(type: LikedCollectionType): Event | null {
    return type === 'tracks' ? this.likedSongsEventState() : this.likedAlbumsEventState();
  }

  private getRelayUrls(): string[] {
    return this.utilities.getUniqueNormalizedRelayUrls([
      ...this.accountRelay.getRelayUrls(),
      ...this.relaysService.getOptimalRelays(this.utilities.preferredRelays),
    ]);
  }
}
