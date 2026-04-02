import { Injectable, effect, inject, signal } from '@angular/core';
import { Event, Filter } from 'nostr-tools';
import { AccountStateService } from './account-state.service';
import { AccountRelayService } from './relays/account-relay';
import { ApplicationService } from './application.service';
import { LoggerService } from './logger.service';
import { NostrService } from './nostr.service';
import { RelayPoolService } from './relays/relay-pool';
import { RelaysService } from './relays/relays';
import { UtilitiesService } from './utilities.service';

const MUSIC_PLAYLIST_KIND = 30003;
const PLAYLIST_D_TAG_PREFIX = 'playlist-';

export interface MusicBookmarkPlaylist {
  id: string;
  title: string;
  description?: string;
  image?: string;
  pubkey: string;
  trackRefs: string[];
  created_at: number;
  event?: Event;
}

export interface CreateMusicBookmarkPlaylistData {
  title: string;
  description?: string;
  image?: string | null;
  gradient?: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class MusicBookmarkPlaylistService {
  private accountState = inject(AccountStateService);
  private accountRelay = inject(AccountRelayService);
  private app = inject(ApplicationService);
  private logger = inject(LoggerService);
  private nostrService = inject(NostrService);
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);

  private _userPlaylists = signal<MusicBookmarkPlaylist[]>([]);
  userPlaylists = this._userPlaylists.asReadonly();

  private _loading = signal(false);
  loading = this._loading.asReadonly();

  private playlistMap = new Map<string, MusicBookmarkPlaylist>();
  private lastFetchedPubkey: string | null = null;

  constructor() {
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey && this.app.initialized() && pubkey !== this.lastFetchedPubkey) {
        void this.fetchUserPlaylists(pubkey);
      }
    });
  }

  isMusicPlaylistEvent(event: Event): boolean {
    if (event.kind !== MUSIC_PLAYLIST_KIND) {
      return false;
    }

    const hasPlaylistTag = event.tags.some(tag => tag[0] === 't' && tag[1] === 'playlist');
    const hasMusicTag = event.tags.some(tag => tag[0] === 't' && tag[1] === 'music');
    const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || '';

    return dTag.startsWith(PLAYLIST_D_TAG_PREFIX) && hasPlaylistTag && hasMusicTag;
  }

  parsePlaylistEvent(event: Event): MusicBookmarkPlaylist | null {
    if (!this.isMusicPlaylistEvent(event)) {
      return null;
    }

    const dTag = event.tags.find(tag => tag[0] === 'd')?.[1];
    if (!dTag) {
      return null;
    }

    const title = event.tags.find(tag => tag[0] === 'title')?.[1]
      || event.tags.find(tag => tag[0] === 'alt')?.[1]?.replace(/^Playlist:\s*/i, '')
      || 'Untitled Playlist';

    const description = event.tags.find(tag => tag[0] === 'description')?.[1] || event.content || undefined;
    const image = event.tags.find(tag => tag[0] === 'image')?.[1] || undefined;
    const trackRefs = this.utilities.getMusicPlaylistTrackRefs(event);

    return {
      id: dTag,
      title,
      description,
      image,
      pubkey: event.pubkey,
      trackRefs,
      created_at: event.created_at,
      event,
    };
  }

  async fetchUserPlaylists(pubkey?: string): Promise<MusicBookmarkPlaylist[]> {
    const userPubkey = pubkey || this.accountState.pubkey();
    if (!userPubkey) {
      return [];
    }

    this._loading.set(true);
    this.lastFetchedPubkey = userPubkey;

    try {
      const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);
      if (relayUrls.length === 0) {
        return this._userPlaylists();
      }

      // Bookmark playlists are music content and may exist on the user's music relays
      // even when account relays do not surface them consistently.
      const events = await this.pool.query(relayUrls, {
        kinds: [MUSIC_PLAYLIST_KIND],
        authors: [userPubkey],
        limit: 200,
      } as Filter, 5000);

      const nextMap = new Map<string, MusicBookmarkPlaylist>();
      for (const event of events) {
        const playlist = this.parsePlaylistEvent(event);
        if (!playlist) {
          continue;
        }

        const key = `${playlist.pubkey}:${playlist.id}`;
        const existing = nextMap.get(key);
        if (!existing || existing.created_at < playlist.created_at) {
          nextMap.set(key, playlist);
        }
      }

      this.playlistMap = nextMap;
      const playlists = Array.from(nextMap.values()).sort((a, b) => b.created_at - a.created_at);
      this._userPlaylists.set(playlists);
      return playlists;
    } catch (error) {
      this.logger.error('[MusicBookmarkPlaylist] Failed to fetch user playlists:', error);
      return this._userPlaylists();
    } finally {
      this._loading.set(false);
    }
  }

  async fetchPublicPlaylists(limit = 200): Promise<Event[]> {
    const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);
    if (relayUrls.length === 0) {
      return [];
    }

    const events = await this.pool.query(relayUrls, {
      kinds: [MUSIC_PLAYLIST_KIND],
      '#t': ['playlist'],
      limit,
    }, 5000);

    const latestByKey = new Map<string, Event>();
    for (const event of events) {
      if (!this.isMusicPlaylistEvent(event)) {
        continue;
      }

      const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || '';
      const key = `${event.pubkey}:${dTag}`;
      const existing = latestByKey.get(key);
      if (!existing || existing.created_at < event.created_at) {
        latestByKey.set(key, event);
      }
    }

    return Array.from(latestByKey.values()).sort((a, b) => b.created_at - a.created_at);
  }

  async fetchPlaylistEvent(pubkey: string, identifier: string): Promise<Event | null> {
    const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);
    if (relayUrls.length === 0) {
      return null;
    }

    const events = await this.pool.query(relayUrls, {
      kinds: [MUSIC_PLAYLIST_KIND],
      authors: [pubkey],
      '#d': [identifier],
      limit: 5,
    }, 5000);

    const matching = events.filter(event => this.isMusicPlaylistEvent(event));
    if (matching.length === 0) {
      return null;
    }

    return matching.reduce((latest, event) => event.created_at > latest.created_at ? event : latest);
  }

  async createPlaylist(data: CreateMusicBookmarkPlaylistData): Promise<MusicBookmarkPlaylist | null> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return null;
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const dTag = `${PLAYLIST_D_TAG_PREFIX}${timestamp}`;
    const tags: string[][] = [
      ['d', dTag],
      ['title', data.title],
      ['alt', `Playlist: ${data.title}`],
      ['t', 'music'],
      ['t', 'playlist'],
    ];

    if (data.description) {
      tags.push(['description', data.description]);
    }

    if (data.image) {
      tags.push(['image', data.image]);
    } else if (data.gradient) {
      tags.push(['gradient', 'colors', data.gradient]);
    }

    const event = this.nostrService.createEvent(MUSIC_PLAYLIST_KIND, data.description || '', tags);
    if (!event) {
      return null;
    }

    const signedEvent = await this.nostrService.signEvent(event);
    if (!signedEvent) {
      return null;
    }

    await this.accountRelay.publish(signedEvent);

    const playlist = this.parsePlaylistEvent(signedEvent);
    if (playlist) {
      const key = `${playlist.pubkey}:${playlist.id}`;
      this.playlistMap.set(key, playlist);
      this._userPlaylists.set(Array.from(this.playlistMap.values()).sort((a, b) => b.created_at - a.created_at));
    }

    return playlist;
  }

  async updatePlaylist(
    playlistId: string,
    updates: Partial<CreateMusicBookmarkPlaylistData>,
  ): Promise<MusicBookmarkPlaylist | null> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return null;
    }

    let playlist: MusicBookmarkPlaylist | undefined = this.userPlaylists().find(
      item => item.id === playlistId && item.pubkey === pubkey,
    );
    if (!playlist?.event) {
      const event = await this.fetchPlaylistEvent(pubkey, playlistId);
      playlist = event ? this.parsePlaylistEvent(event) || undefined : undefined;
    }

    if (!playlist?.event) {
      this.logger.warn('[MusicBookmarkPlaylist] Playlist not found:', playlistId);
      return null;
    }

    const title = updates.title ?? playlist.title;
    const description = updates.description ?? playlist.description;
    const image = updates.image === undefined ? playlist.image : updates.image;

    const tags: string[][] = [
      ['d', playlist.id],
      ['title', title],
      ['alt', `Playlist: ${title}`],
      ['t', 'music'],
      ['t', 'playlist'],
    ];

    if (description) {
      tags.push(['description', description]);
    }

    if (image) {
      tags.push(['image', image]);
    } else {
      const gradient = updates.gradient === undefined
        ? this.utilities.getMusicGradient(playlist.event)
        : updates.gradient;
      if (gradient) {
        tags.push(['gradient', 'colors', gradient]);
      }
    }

    for (const ref of playlist.trackRefs) {
      tags.push(['a', ref]);
    }

    const event = this.nostrService.createEvent(MUSIC_PLAYLIST_KIND, description || '', tags);
    if (!event) {
      return null;
    }

    const signedEvent = await this.nostrService.signEvent(event);
    if (!signedEvent) {
      return null;
    }

    await this.accountRelay.publish(signedEvent);

    const updatedPlaylist = this.parsePlaylistEvent(signedEvent);
    if (updatedPlaylist) {
      const key = `${updatedPlaylist.pubkey}:${updatedPlaylist.id}`;
      this.playlistMap.set(key, updatedPlaylist);
      this._userPlaylists.set(Array.from(this.playlistMap.values()).sort((a, b) => b.created_at - a.created_at));
      return updatedPlaylist;
    }

    return null;
  }

  async addTrackToPlaylist(
    playlistId: string,
    trackPubkey: string,
    trackDTag: string,
    trackKind = UtilitiesService.PRIMARY_MUSIC_KIND,
  ): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return false;
    }

    let playlist: MusicBookmarkPlaylist | undefined = this.userPlaylists().find(
      item => item.id === playlistId && item.pubkey === pubkey,
    );
    if (!playlist?.event) {
      const event = await this.fetchPlaylistEvent(pubkey, playlistId);
      playlist = event ? this.parsePlaylistEvent(event) || undefined : undefined;
    }

    if (!playlist?.event) {
      this.logger.warn('[MusicBookmarkPlaylist] Playlist not found:', playlistId);
      return false;
    }

    const trackRef = `${trackKind}:${trackPubkey}:${trackDTag}`;
    if (playlist.trackRefs.includes(trackRef)) {
      return true;
    }

    const tags = [...playlist.event.tags, ['a', trackRef]];
    const updatedEvent = this.nostrService.createEvent(MUSIC_PLAYLIST_KIND, playlist.event.content, tags);
    if (!updatedEvent) {
      return false;
    }

    const signedEvent = await this.nostrService.signEvent(updatedEvent);
    if (!signedEvent) {
      return false;
    }

    await this.accountRelay.publish(signedEvent);

    const updatedPlaylist = this.parsePlaylistEvent(signedEvent);
    if (updatedPlaylist) {
      const key = `${updatedPlaylist.pubkey}:${updatedPlaylist.id}`;
      this.playlistMap.set(key, updatedPlaylist);
      this._userPlaylists.set(Array.from(this.playlistMap.values()).sort((a, b) => b.created_at - a.created_at));
    }

    return true;
  }

  async removeTrackFromPlaylist(
    playlistId: string,
    trackPubkey: string,
    trackDTag: string,
    trackKind = UtilitiesService.PRIMARY_MUSIC_KIND,
  ): Promise<boolean> {
    const trackRef = `${trackKind}:${trackPubkey}:${trackDTag}`;
    return this.updatePlaylistTrackRefs(playlistId, refs => {
      const nextRefs = refs.filter(ref => ref !== trackRef);
      return nextRefs.length === refs.length ? refs : nextRefs;
    });
  }

  async reorderPlaylistTracks(playlistId: string, orderedTrackRefs: string[]): Promise<boolean> {
    return this.updatePlaylistTrackRefs(playlistId, refs => {
      if (refs.length !== orderedTrackRefs.length) {
        return refs;
      }

      const currentSorted = [...refs].sort();
      const nextSorted = [...orderedTrackRefs].sort();
      if (currentSorted.some((ref, index) => ref !== nextSorted[index])) {
        return refs;
      }

      return [...orderedTrackRefs];
    });
  }

  private async updatePlaylistTrackRefs(
    playlistId: string,
    updater: (trackRefs: string[]) => string[],
  ): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return false;
    }

    let playlist: MusicBookmarkPlaylist | undefined = this.userPlaylists().find(
      item => item.id === playlistId && item.pubkey === pubkey,
    );
    if (!playlist?.event) {
      const event = await this.fetchPlaylistEvent(pubkey, playlistId);
      playlist = event ? this.parsePlaylistEvent(event) || undefined : undefined;
    }

    if (!playlist?.event) {
      this.logger.warn('[MusicBookmarkPlaylist] Playlist not found:', playlistId);
      return false;
    }

    const nextTrackRefs = updater(playlist.trackRefs);
    if (nextTrackRefs.length === playlist.trackRefs.length && nextTrackRefs.every((ref, index) => ref === playlist.trackRefs[index])) {
      return true;
    }

    const nonTrackTags = playlist.event.tags.filter(tag => tag[0] !== 'a' || !this.utilities.parseMusicTrackCoordinate(tag[1]));
    const tags = [...nonTrackTags, ...nextTrackRefs.map(ref => ['a', ref] as string[])];
    const updatedEvent = this.nostrService.createEvent(MUSIC_PLAYLIST_KIND, playlist.event.content, tags);
    if (!updatedEvent) {
      return false;
    }

    const signedEvent = await this.nostrService.signEvent(updatedEvent);
    if (!signedEvent) {
      return false;
    }

    await this.accountRelay.publish(signedEvent);

    const updatedPlaylist = this.parsePlaylistEvent(signedEvent);
    if (updatedPlaylist) {
      const key = `${updatedPlaylist.pubkey}:${updatedPlaylist.id}`;
      this.playlistMap.set(key, updatedPlaylist);
      this._userPlaylists.set(Array.from(this.playlistMap.values()).sort((a, b) => b.created_at - a.created_at));
    }

    return true;
  }
}
