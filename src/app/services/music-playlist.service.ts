import { Injectable, inject, signal, effect } from '@angular/core';
import { Event, Filter } from 'nostr-tools';
import { AccountStateService } from './account-state.service';
import { AccountRelayService } from './relays/account-relay';
import { RelayPoolService } from './relays/relay-pool';
import { RelaysService } from './relays/relays';
import { UtilitiesService } from './utilities.service';
import { NostrService } from './nostr.service';
import { ApplicationService } from './application.service';
import { LoggerService } from './logger.service';

const MUSIC_PLAYLIST_KIND = 34139;
const MUSIC_KIND = 36787;

export interface MusicPlaylist {
  id: string; // d-tag
  title: string;
  description?: string;
  image?: string;
  pubkey: string;
  isPublic: boolean;
  isCollaborative: boolean;
  trackRefs: string[]; // a-tags referencing tracks
  created_at: number;
  event?: Event;
}

export interface CreateMusicPlaylistData {
  title: string;
  description?: string;
  image?: string;
  isPublic: boolean;
  isCollaborative: boolean;
  customRelays?: string[]; // Optional custom relay URLs to publish to
}

@Injectable({
  providedIn: 'root',
})
export class MusicPlaylistService {
  private accountState = inject(AccountStateService);
  private accountRelay = inject(AccountRelayService);
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private nostrService = inject(NostrService);
  private app = inject(ApplicationService);
  private logger = inject(LoggerService);

  // User's music playlists
  private _userPlaylists = signal<MusicPlaylist[]>([]);
  userPlaylists = this._userPlaylists.asReadonly();

  // Loading state
  private _loading = signal(false);
  loading = this._loading.asReadonly();

  private playlistMap = new Map<string, MusicPlaylist>();
  private lastFetchedPubkey: string | null = null;

  constructor() {
    // Refetch when account changes
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey && this.app.initialized() && pubkey !== this.lastFetchedPubkey) {
        this.fetchUserPlaylists(pubkey);
      }
    });
  }

  /**
   * Fetch all music playlists for the current user
   */
  async fetchUserPlaylists(pubkey?: string): Promise<MusicPlaylist[]> {
    const userPubkey = pubkey || this.accountState.pubkey();
    if (!userPubkey) {
      this.logger.warn('No user pubkey available to fetch playlists');
      return [];
    }

    this._loading.set(true);
    this.lastFetchedPubkey = userPubkey;

    try {
      const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);

      if (relayUrls.length === 0) {
        this.logger.warn('No relays available to fetch music playlists');
        this._loading.set(false);
        return [];
      }

      const filter: Filter = {
        kinds: [MUSIC_PLAYLIST_KIND],
        authors: [userPubkey],
        limit: 100,
      };

      return new Promise<MusicPlaylist[]>((resolve) => {
        const timeout = setTimeout(() => {
          subscription?.close();
          this._loading.set(false);
          resolve(Array.from(this.playlistMap.values()));
        }, 5000);

        const subscription = this.pool.subscribe(relayUrls, filter, (event: Event) => {
          const playlist = this.parsePlaylistEvent(event);
          if (playlist) {
            const key = `${event.pubkey}:${playlist.id}`;
            const existing = this.playlistMap.get(key);
            if (!existing || existing.created_at < playlist.created_at) {
              this.playlistMap.set(key, playlist);
              this._userPlaylists.set(Array.from(this.playlistMap.values()));
            }
          }
        });

        // Resolve after a short delay to get initial results
        setTimeout(() => {
          clearTimeout(timeout);
          subscription?.close();
          this._loading.set(false);
          resolve(Array.from(this.playlistMap.values()));
        }, 3000);
      });
    } catch (error) {
      this.logger.error('Failed to fetch music playlists:', error);
      this._loading.set(false);
      return [];
    }
  }

  /**
   * Parse a Nostr event into a MusicPlaylist
   */
  private parsePlaylistEvent(event: Event): MusicPlaylist | null {
    const dTag = event.tags.find(t => t[0] === 'd')?.[1];
    if (!dTag) return null;

    const titleTag = event.tags.find(t => t[0] === 'title');
    const descTag = event.tags.find(t => t[0] === 'description');
    const imageTag = event.tags.find(t => t[0] === 'image');
    const publicTag = event.tags.find(t => t[0] === 'public');
    const privateTag = event.tags.find(t => t[0] === 'private');
    const collaborativeTag = event.tags.find(t => t[0] === 'collaborative');

    const trackRefs = event.tags
      .filter(t => t[0] === 'a' && t[1]?.startsWith(`${MUSIC_KIND}:`))
      .map(t => t[1]);

    // Per spec: 'public' tag means public, 'private' tag means private, default to public
    const isPublic = publicTag?.[1] === 'true' || privateTag?.[1] !== 'true';

    return {
      id: dTag,
      title: titleTag?.[1] || 'Untitled Playlist',
      description: descTag?.[1] || event.content || undefined,
      image: imageTag?.[1] || undefined,
      pubkey: event.pubkey,
      isPublic,
      isCollaborative: collaborativeTag?.[1] === 'true',
      trackRefs,
      created_at: event.created_at,
      event,
    };
  }

  /**
   * Create a new music playlist
   */
  async createPlaylist(data: CreateMusicPlaylistData): Promise<MusicPlaylist | null> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.error('Cannot create playlist: no user logged in');
      return null;
    }

    // Generate unique d-tag
    const dTag = this.generatePlaylistId(data.title);

    const tags: string[][] = [
      ['d', dTag],
      ['title', data.title],
      ['t', 'playlist'],
      ['alt', `Playlist: ${data.title}`],
    ];

    if (data.description) {
      tags.push(['description', data.description]);
    }

    if (data.image) {
      tags.push(['image', data.image]);
    }

    // Per spec: use 'public' tag for public playlists, 'private' tag for private ones
    if (data.isPublic) {
      tags.push(['public', 'true']);
    } else {
      tags.push(['private', 'true']);
    }
    tags.push(['collaborative', data.isCollaborative ? 'true' : 'false']);
    tags.push(['client', 'nostria']);

    const content = data.description || '';

    const event = this.nostrService.createEvent(MUSIC_PLAYLIST_KIND, content, tags);
    if (!event) {
      this.logger.error('Failed to create playlist event');
      return null;
    }

    const signedEvent = await this.nostrService.signEvent(event);
    if (!signedEvent) {
      this.logger.error('Failed to sign playlist event');
      return null;
    }

    // Publish to relays - use custom relays if provided, otherwise use account relays
    if (data.customRelays && data.customRelays.length > 0) {
      await this.pool.publish(data.customRelays, signedEvent);
    } else {
      await this.accountRelay.publish(signedEvent);
    }

    const playlist = this.parsePlaylistEvent(signedEvent);
    if (playlist) {
      const key = `${signedEvent.pubkey}:${playlist.id}`;
      this.playlistMap.set(key, playlist);
      this._userPlaylists.set(Array.from(this.playlistMap.values()));
    }

    return playlist;
  }

  /**
   * Add a track to a playlist
   */
  async addTrackToPlaylist(
    playlistId: string,
    trackPubkey: string,
    trackDTag: string
  ): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.error('Cannot add track: no user logged in');
      return false;
    }

    // Find the playlist
    const key = `${pubkey}:${playlistId}`;
    const playlist = this.playlistMap.get(key);
    if (!playlist || !playlist.event) {
      this.logger.error('Playlist not found:', playlistId);
      return false;
    }

    // Check if track already exists
    const trackRef = `${MUSIC_KIND}:${trackPubkey}:${trackDTag}`;
    if (playlist.trackRefs.includes(trackRef)) {
      this.logger.info('Track already in playlist');
      return true;
    }

    // Create updated event with the new track
    const newTags = [...playlist.event.tags];
    newTags.push(['a', trackRef]);

    const event = this.nostrService.createEvent(
      MUSIC_PLAYLIST_KIND,
      playlist.event.content,
      newTags
    );

    if (!event) {
      this.logger.error('Failed to create updated playlist event');
      return false;
    }

    const signedEvent = await this.nostrService.signEvent(event);
    if (!signedEvent) {
      this.logger.error('Failed to sign updated playlist event');
      return false;
    }

    // Publish to relays
    await this.accountRelay.publish(signedEvent);

    // Update local state
    const updatedPlaylist = this.parsePlaylistEvent(signedEvent);
    if (updatedPlaylist) {
      this.playlistMap.set(key, updatedPlaylist);
      this._userPlaylists.set(Array.from(this.playlistMap.values()));
    }

    return true;
  }

  /**
   * Update an existing music playlist
   */
  async updatePlaylist(
    playlistId: string,
    updates: Partial<CreateMusicPlaylistData> & { trackRefs?: string[]; zapSplits?: string[][] }
  ): Promise<MusicPlaylist | null> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.error('Cannot update playlist: no user logged in');
      return null;
    }

    // Find the playlist
    const key = `${pubkey}:${playlistId}`;
    const playlist = this.playlistMap.get(key);
    if (!playlist || !playlist.event) {
      this.logger.error('Playlist not found:', playlistId);
      return null;
    }

    // Build new tags
    const newTags: string[][] = [['d', playlist.id]];

    // Title
    const title = updates.title ?? playlist.title;
    newTags.push(['title', title]);
    newTags.push(['t', 'playlist']);
    newTags.push(['alt', `Playlist: ${title}`]);

    // Description
    const description = updates.description ?? playlist.description;
    if (description) {
      newTags.push(['description', description]);
    }

    // Image
    const image = updates.image ?? playlist.image;
    if (image) {
      newTags.push(['image', image]);
    }

    // Keep gradient if it exists
    const gradientTag = playlist.event.tags.find(t => t[0] === 'gradient');
    if (gradientTag) {
      newTags.push(gradientTag);
    }

    // Public/Collaborative - use spec format
    const isPublic = updates.isPublic ?? playlist.isPublic;
    const isCollaborative = updates.isCollaborative ?? playlist.isCollaborative;
    if (isPublic) {
      newTags.push(['public', 'true']);
    } else {
      newTags.push(['private', 'true']);
    }
    newTags.push(['collaborative', isCollaborative ? 'true' : 'false']);
    newTags.push(['client', 'nostria']);

    // Track refs (use new order if provided, otherwise keep existing)
    const trackRefs = updates.trackRefs ?? playlist.trackRefs;
    for (const ref of trackRefs) {
      newTags.push(['a', ref]);
    }

    // Add zap splits
    if (updates.zapSplits && updates.zapSplits.length > 0) {
      for (const zapTag of updates.zapSplits) {
        newTags.push(zapTag);
      }
    }

    const content = description || '';

    const event = this.nostrService.createEvent(MUSIC_PLAYLIST_KIND, content, newTags);
    if (!event) {
      this.logger.error('Failed to create updated playlist event');
      return null;
    }

    const signedEvent = await this.nostrService.signEvent(event);
    if (!signedEvent) {
      this.logger.error('Failed to sign updated playlist event');
      return null;
    }

    // Publish to relays - use custom relays if provided, otherwise use account relays
    if (updates.customRelays && updates.customRelays.length > 0) {
      await this.pool.publish(updates.customRelays, signedEvent);
    } else {
      await this.accountRelay.publish(signedEvent);
    }

    // Update local state
    const updatedPlaylist = this.parsePlaylistEvent(signedEvent);
    if (updatedPlaylist) {
      this.playlistMap.set(key, updatedPlaylist);
      this._userPlaylists.set(Array.from(this.playlistMap.values()));
    }

    return updatedPlaylist;
  }

  /**
   * Remove a track from a playlist
   */
  async removeTrackFromPlaylist(
    playlistId: string,
    trackRef: string
  ): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.error('Cannot remove track: no user logged in');
      return false;
    }

    // Find the playlist
    const key = `${pubkey}:${playlistId}`;
    const playlist = this.playlistMap.get(key);
    if (!playlist || !playlist.event) {
      this.logger.error('Playlist not found:', playlistId);
      return false;
    }

    // Remove the track from refs
    const newTrackRefs = playlist.trackRefs.filter(ref => ref !== trackRef);
    if (newTrackRefs.length === playlist.trackRefs.length) {
      this.logger.info('Track not found in playlist');
      return true;
    }

    // Update the playlist with new track refs
    const result = await this.updatePlaylist(playlistId, { trackRefs: newTrackRefs });
    return result !== null;
  }

  /**
   * Reorder tracks in a playlist
   */
  async reorderPlaylistTracks(
    playlistId: string,
    newOrder: string[]
  ): Promise<boolean> {
    const result = await this.updatePlaylist(playlistId, { trackRefs: newOrder });
    return result !== null;
  }

  /**
   * Generate a unique playlist ID based on title
   */
  private generatePlaylistId(title: string): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '')
      .substring(0, 30);

    const timestamp = Date.now();
    return `${slug}-${timestamp}`;
  }

  /**
   * Clear cached playlists (useful when switching accounts)
   */
  clearCache(): void {
    this.playlistMap.clear();
    this._userPlaylists.set([]);
    this.lastFetchedPubkey = null;
  }
}
