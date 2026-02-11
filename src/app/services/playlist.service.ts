import { Injectable, signal, computed, inject, effect, untracked } from '@angular/core';
import { LocalStorageService } from './local-storage.service';
import { ApplicationService } from './application.service';
import { NostrService } from './nostr.service';
import { AccountRelayService } from './relays/account-relay';
import { Playlist, PlaylistTrack, PlaylistDraft, OnInitialized, MediaItem } from '../interfaces';
import { Event, Filter } from 'nostr-tools';
import { formatDuration } from '../utils/format-duration';
import { LoggerService } from './logger.service';

@Injectable({
  providedIn: 'root',
})
export class PlaylistService implements OnInitialized {
  private localStorage = inject(LocalStorageService);
  private app = inject(ApplicationService);
  private nostrService = inject(NostrService);
  private accountRelay = inject(AccountRelayService);
  private readonly logger = inject(LoggerService);

  private initialized = false;

  // Storage keys
  private readonly PLAYLISTS_STORAGE_KEY = 'nostria-playlists';
  private readonly DRAFTS_STORAGE_KEY = 'nostria-playlist-drafts';

  // Signals for reactive state management
  private _playlists = signal<Playlist[]>([]);
  private _drafts = signal<PlaylistDraft[]>([]);
  private _currentEditingPlaylist = signal<PlaylistDraft | null>(null);
  private _savedPlaylistIds = signal<Set<string>>(new Set());

  // Public readonly signals
  playlists = this._playlists.asReadonly();
  drafts = this._drafts.asReadonly();
  currentEditingPlaylist = this._currentEditingPlaylist.asReadonly();
  savedPlaylistIds = this._savedPlaylistIds.asReadonly();

  // Computed signals
  userPlaylists = computed(() => {
    const currentPubkey = this.getCurrentUserPubkey();
    const savedIds = this._savedPlaylistIds();

    return this._playlists().filter(playlist => {
      // Keep if local
      if (playlist.isLocal) return true;

      // Keep if owned by current user
      if (playlist.pubkey === currentPubkey) return true;

      // Keep if saved (bookmarked)
      const coordinate = `${playlist.kind || 32100}:${playlist.pubkey}:${playlist.id}`;
      if (savedIds.has(coordinate)) return true;

      return false;
    });
  });

  hasUnsavedChanges = computed(() => {
    const currentDraft = this._currentEditingPlaylist();
    return currentDraft !== null;
  });

  constructor() {
    if (!this.app.isBrowser()) {
      return;
    }

    // Single effect that handles both initialization and account changes
    effect(() => {
      const pubkey = this.app.accountState.pubkey();
      const isInitialized = this.app.initialized();
      if (isInitialized) {
        untracked(() => {
          this.initialize();
          if (pubkey) {
            this.fetchSavedPlaylists(pubkey);
          }
        });
      }
    });
  }

  initialize(): void {
    this.loadPlaylistsFromStorage();
    this.loadDraftsFromStorage();
    this.cleanupPlaylists();
    this.initialized = true;
  }

  /**
   * Fetch saved playlists (Bookmark Set kind 30003)
   */
  async fetchSavedPlaylists(pubkey: string): Promise<void> {
    try {
      // Fetch the bookmark set
      const events = await this.accountRelay.getMany<Event>({
        kinds: [30003],
        authors: [pubkey],
        '#d': ['nostria-playlists']
      } as Filter);

      if (events.length === 0) {
        this._savedPlaylistIds.set(new Set());
        return;
      }

      // Get the most recent event
      const bookmarkEvent = events.reduce((prev, current) =>
        (prev.created_at > current.created_at) ? prev : current
      );

      // Extract playlist coordinates
      const savedIds = new Set<string>();
      const coordinatesToFetch: string[] = [];

      for (const tag of bookmarkEvent.tags) {
        if (tag[0] === 'a') {
          const coordinate = tag[1];
          // Check if it's a playlist (kind 32100)
          if (coordinate.startsWith('32100:')) {
            savedIds.add(coordinate);
            coordinatesToFetch.push(coordinate);
          }
        }
      }

      this._savedPlaylistIds.set(savedIds);

      // Fetch the actual playlist events if we don't have them
      if (coordinatesToFetch.length > 0) {
        await this.fetchPlaylistsByCoordinates(coordinatesToFetch);
      }

    } catch (error) {
      console.error('Failed to fetch saved playlists:', error);
    }
  }

  /**
   * Fetch playlists by their coordinates (kind:pubkey:d-tag)
   */
  async fetchPlaylistsByCoordinates(coordinates: string[]): Promise<void> {
    // Filter out coordinates we already have loaded
    const playlists = this._playlists();
    const missingCoordinates = coordinates.filter(coord => {
      const [, pubkey, dTag] = coord.split(':');
      return !playlists.some(p => p.pubkey === pubkey && p.id === dTag);
    });

    if (missingCoordinates.length === 0) return;

    // Group by d-tags and authors for the query
    const dTags = new Set<string>();
    const authors = new Set<string>();

    missingCoordinates.forEach(coord => {
      const [, pubkey, dTag] = coord.split(':');
      dTags.add(dTag);
      authors.add(pubkey);
    });

    try {
      const events = await this.accountRelay.getMany<Event>({
        kinds: [32100],
        authors: Array.from(authors),
        '#d': Array.from(dTags)
      } as Filter);

      for (const event of events) {
        this.importPlaylistFromNostrEvent(event);
      }
    } catch (error) {
      console.error('Failed to fetch referenced playlists:', error);
    }
  }

  /**
   * Save a playlist to the "nostria-playlists" Bookmark Set
   */
  async savePlaylistToBookmarks(playlist: Playlist): Promise<void> {
    const pubkey = this.getCurrentUserPubkey();
    if (!pubkey) throw new Error('User not logged in');

    const coordinate = `32100:${playlist.pubkey}:${playlist.id}`;

    // 1. Fetch existing bookmark set
    let bookmarkEvent: Event | undefined;
    try {
      const events = await this.accountRelay.getMany<Event>({
        kinds: [30003],
        authors: [pubkey],
        '#d': ['nostria-playlists']
      } as Filter);

      if (events.length > 0) {
        bookmarkEvent = events.reduce((prev, current) =>
          (prev.created_at > current.created_at) ? prev : current
        );
      }
    } catch {
      console.warn('Could not fetch existing bookmarks, creating new one');
    }

    // 2. Prepare tags
    let tags: string[][] = [];
    if (bookmarkEvent) {
      tags = [...bookmarkEvent.tags];
    } else {
      tags.push(['d', 'nostria-playlists']);
      tags.push(['title', 'Saved Playlists']);
      tags.push(['description', 'Playlists saved in Nostria']);
    }

    // 3. Add new playlist if not exists
    const exists = tags.some(tag => tag[0] === 'a' && tag[1] === coordinate);
    if (!exists) {
      tags.push(['a', coordinate]);
    } else {
      console.log('Playlist already saved');
      return;
    }

    // 4. Publish updated event
    const event = this.nostrService.createEvent(30003, bookmarkEvent?.content || '', tags);
    if (!event) throw new Error('Failed to create bookmark event');

    const signedEvent = await this.nostrService.signEvent(event);
    if (!signedEvent) throw new Error('Failed to sign bookmark event');

    await this.accountRelay.publish(signedEvent);

    // Update local state
    const newSavedIds = new Set(this._savedPlaylistIds());
    newSavedIds.add(coordinate);
    this._savedPlaylistIds.set(newSavedIds);

    // Ensure the playlist is in our list (it should be if we are saving it)
    // But if we are saving a playlist we just viewed but haven't "imported" yet, we might need to ensure it's there.
    // Assuming the playlist object passed here is already full.

    // If the playlist is not in _playlists, add it
    const playlists = this._playlists();
    if (!playlists.some(p => p.id === playlist.id && p.pubkey === playlist.pubkey)) {
      this._playlists.set([...playlists, playlist]);
      this.savePlaylistsToStorage();
    }
  }

  /**
   * Remove a playlist from bookmarks
   */
  async removePlaylistFromBookmarks(playlist: Playlist): Promise<void> {
    const pubkey = this.getCurrentUserPubkey();
    if (!pubkey) throw new Error('User not logged in');

    const coordinate = `32100:${playlist.pubkey}:${playlist.id}`;

    // 1. Fetch existing bookmark set
    const events = await this.accountRelay.getMany<Event>({
      kinds: [30003],
      authors: [pubkey],
      '#d': ['nostria-playlists']
    } as Filter);

    if (events.length === 0) return;

    const bookmarkEvent = events.reduce((prev, current) =>
      (prev.created_at > current.created_at) ? prev : current
    );

    // 2. Filter out the playlist
    const newTags = bookmarkEvent.tags.filter(tag =>
      !(tag[0] === 'a' && tag[1] === coordinate)
    );

    if (newTags.length === bookmarkEvent.tags.length) return; // Nothing changed

    // 3. Publish updated event
    const event = this.nostrService.createEvent(30003, bookmarkEvent.content, newTags);
    if (!event) throw new Error('Failed to create bookmark event');

    const signedEvent = await this.nostrService.signEvent(event);
    if (!signedEvent) throw new Error('Failed to sign bookmark event');

    await this.accountRelay.publish(signedEvent);

    // Update local state
    const newSavedIds = new Set(this._savedPlaylistIds());
    newSavedIds.delete(coordinate);
    this._savedPlaylistIds.set(newSavedIds);
  }

  isPlaylistSaved(playlist: Playlist): boolean {
    const coordinate = `32100:${playlist.pubkey}:${playlist.id}`;
    return this._savedPlaylistIds().has(coordinate);
  }

  /**
   * Fetch all playlists from Nostr for the current user
   * This should be called when the playlists page is opened to load fresh data
   * Uses a shorter timeout and doesn't block if network is slow
   */
  async fetchPlaylistsFromNostr(pubkey: string): Promise<void> {
    try {
      console.log('Fetching playlists from Nostr for pubkey:', pubkey);

      // Use a shorter timeout (5 seconds) to prevent long delays
      // If the user has cached playlists, they'll see those while this loads
      const timeoutPromise = new Promise<Event[]>((_, reject) =>
        setTimeout(() => reject(new Error('Fetch timeout')), 5000)
      );

      // Query for playlist events (kind 32100) authored by the user
      const fetchPromise = this.accountRelay.getMany<Event>({
        kinds: [32100],
        authors: [pubkey],
      });

      let events: Event[];
      try {
        events = await Promise.race([fetchPromise, timeoutPromise]);
      } catch (timeoutError) {
        console.warn('Playlist fetch timed out, will use cached data');
        return;
      }

      console.log(`Found ${events.length} playlist events`);

      // Group events by 'd' tag (identifier) and keep only the most recent for each
      const eventsByDTag = new Map<string, Event>();
      for (const event of events) {
        const dTag = event.tags.find(tag => tag[0] === 'd')?.[1];
        if (!dTag) continue; // Skip events without 'd' tag

        const existing = eventsByDTag.get(dTag);
        if (!existing || event.created_at > existing.created_at) {
          eventsByDTag.set(dTag, event);
        }
      }

      console.log(`Found ${eventsByDTag.size} unique playlists (by 'd' tag)`);

      // Import each unique event
      for (const event of eventsByDTag.values()) {
        this.importPlaylistFromNostrEvent(event);
      }

      console.log('Successfully loaded playlists from Nostr');
    } catch (error) {
      console.error('Failed to fetch playlists from Nostr:', error);
      throw error;
    }
  }

  private loadPlaylistsFromStorage(): void {
    const pubkey = this.getCurrentUserPubkey();
    const stored = this.localStorage.getItem(this.PLAYLISTS_STORAGE_KEY);
    if (stored && stored !== 'undefined' && stored !== '') {
      try {
        const parsed = JSON.parse(stored);

        // Check if it's the old format (array) or new format (Record<pubkey, Playlist[]>)
        if (Array.isArray(parsed)) {
          // Old format: migrate to new format
          console.log('Migrating playlists from old format to new pubkey-keyed format');
          const oldPlaylists = parsed as Playlist[];

          // Group playlists by their pubkey
          const allPlaylists: Record<string, Playlist[]> = {};
          for (const playlist of oldPlaylists) {
            const key = playlist.pubkey || pubkey || 'unknown';
            if (!allPlaylists[key]) {
              allPlaylists[key] = [];
            }
            allPlaylists[key].push(playlist);
          }

          // Save in new format
          this.localStorage.setItem(this.PLAYLISTS_STORAGE_KEY, JSON.stringify(allPlaylists));

          // Get playlists for current user
          const playlists = pubkey ? (allPlaylists[pubkey] || []) : [];
          this._playlists.set(playlists);
        } else {
          // New format: Record<pubkey, Playlist[]>
          const allPlaylists = parsed as Record<string, Playlist[]>;
          // Get playlists for current user, or empty array if none
          const playlists = pubkey ? (allPlaylists[pubkey] || []) : [];
          this._playlists.set(playlists);
        }
      } catch (error) {
        console.error('Failed to load playlists from storage:', error);
        this._playlists.set([]);
      }
    }
  }

  /**
   * Clean up playlists to remove duplicate playlists
   * (for replaceable events with same kind:pubkey:dtag, keep only the newest)
   * Note: Since playlists are now stored per-account, we no longer need to filter by account
   */
  private cleanupPlaylists(): void {
    const currentPubkey = this.getCurrentUserPubkey();
    if (!currentPubkey) {
      console.warn('No current user pubkey available for playlist cleanup');
      return;
    }

    const playlists = this._playlists();

    // Remove duplicates based on kind:pubkey:dtag (replaceable events)
    // For each unique combination of pubkey and id (d-tag), keep only the newest event
    const playlistMap = new Map<string, Playlist>();

    for (const playlist of playlists) {
      const key = `${playlist.pubkey}:${playlist.id}`;

      const existing = playlistMap.get(key);
      if (!existing || playlist.created_at > existing.created_at) {
        playlistMap.set(key, playlist);
      }
    }

    // Convert map back to array
    const cleanedPlaylists = Array.from(playlistMap.values());

    // Update state if anything changed
    if (cleanedPlaylists.length !== playlists.length) {
      this.logger.debug(`[Playlists] Dedup removed ${playlists.length - cleanedPlaylists.length} duplicates, ${cleanedPlaylists.length} remaining`);
      this._playlists.set(cleanedPlaylists);
      this.savePlaylistsToStorage();
    }
  }

  private loadDraftsFromStorage(): void {
    const pubkey = this.getCurrentUserPubkey();
    const stored = this.localStorage.getItem(this.DRAFTS_STORAGE_KEY);
    if (stored && stored !== 'undefined' && stored !== '') {
      try {
        const parsed = JSON.parse(stored);

        // Check if it's the old format (array) or new format (Record<pubkey, PlaylistDraft[]>)
        if (Array.isArray(parsed)) {
          // Old format: migrate to new format
          console.log('Migrating drafts from old format to new pubkey-keyed format');
          const oldDrafts = parsed as PlaylistDraft[];

          // All drafts belong to current user (drafts don't have pubkey field)
          const allDrafts: Record<string, PlaylistDraft[]> = {};
          if (pubkey && oldDrafts.length > 0) {
            allDrafts[pubkey] = oldDrafts;
          }

          // Save in new format
          this.localStorage.setItem(this.DRAFTS_STORAGE_KEY, JSON.stringify(allDrafts));

          // Get drafts for current user
          const drafts = pubkey ? (allDrafts[pubkey] || []) : [];
          this._drafts.set(drafts);
        } else {
          // New format: Record<pubkey, PlaylistDraft[]>
          const allDrafts = parsed as Record<string, PlaylistDraft[]>;
          // Get drafts for current user, or empty array if none
          const drafts = pubkey ? (allDrafts[pubkey] || []) : [];
          this._drafts.set(drafts);
        }
      } catch (error) {
        console.error('Failed to load drafts from storage:', error);
        this._drafts.set([]);
      }
    }
  }

  private savePlaylistsToStorage(): void {
    const pubkey = this.getCurrentUserPubkey();
    if (!pubkey) return;

    // Load existing data for all accounts
    let allPlaylists: Record<string, Playlist[]> = {};
    const stored = this.localStorage.getItem(this.PLAYLISTS_STORAGE_KEY);
    if (stored && stored !== 'undefined' && stored !== '') {
      try {
        const parsed = JSON.parse(stored);
        // Handle old format (array) - just replace with new format
        if (!Array.isArray(parsed)) {
          allPlaylists = parsed as Record<string, Playlist[]>;
        }
      } catch {
        allPlaylists = {};
      }
    }

    // Update current user's playlists
    allPlaylists[pubkey] = this._playlists();
    this.localStorage.setItem(this.PLAYLISTS_STORAGE_KEY, JSON.stringify(allPlaylists));
  }

  private saveDraftsToStorage(): void {
    const pubkey = this.getCurrentUserPubkey();
    if (!pubkey) return;

    // Load existing data for all accounts
    let allDrafts: Record<string, PlaylistDraft[]> = {};
    const stored = this.localStorage.getItem(this.DRAFTS_STORAGE_KEY);
    if (stored && stored !== 'undefined' && stored !== '') {
      try {
        const parsed = JSON.parse(stored);
        // Handle old format (array) - just replace with new format
        if (!Array.isArray(parsed)) {
          allDrafts = parsed as Record<string, PlaylistDraft[]>;
        }
      } catch {
        allDrafts = {};
      }
    }

    // Update current user's drafts
    allDrafts[pubkey] = this._drafts();
    this.localStorage.setItem(this.DRAFTS_STORAGE_KEY, JSON.stringify(allDrafts));
  }

  // Create a new playlist
  createPlaylist(title: string, description?: string, id?: string, tracks: PlaylistTrack[] = []): PlaylistDraft {
    const draft: PlaylistDraft = {
      id: id || this.generatePlaylistId(),
      title,
      description,
      tracks: tracks,
      tags: [],
      isNewPlaylist: true,
    };

    this._currentEditingPlaylist.set(draft);
    return draft;
  }

  // Load existing playlist for editing
  editPlaylist(playlist: Playlist): PlaylistDraft {
    const draft: PlaylistDraft = {
      id: playlist.id,
      title: playlist.title,
      description: playlist.description,
      tags: playlist.tags ? [...playlist.tags] : [],
      tracks: playlist.tracks.map(track => ({ ...track })), // Deep copy tracks
      isNewPlaylist: false,
    };

    this._currentEditingPlaylist.set(draft);
    return draft;
  }

  // Update current editing playlist
  updateCurrentPlaylist(updates: Partial<PlaylistDraft>): void {
    const current = this._currentEditingPlaylist();
    if (!current) return;

    this._currentEditingPlaylist.set({
      ...current,
      ...updates,
    });
  }

  // Add track to current playlist
  addTrackToCurrentPlaylist(track: PlaylistTrack): void {
    const current = this._currentEditingPlaylist();
    if (!current) return;

    this.updateCurrentPlaylist({
      tracks: [...current.tracks, track],
    });
  }

  // Remove track from current playlist
  removeTrackFromCurrentPlaylist(index: number): void {
    const current = this._currentEditingPlaylist();
    if (!current) return;

    const newTracks = [...current.tracks];
    newTracks.splice(index, 1);

    this.updateCurrentPlaylist({
      tracks: newTracks,
    });
  }

  // Update track in current playlist
  updateTrackInCurrentPlaylist(index: number, track: PlaylistTrack): void {
    const current = this._currentEditingPlaylist();
    if (!current) return;

    const newTracks = [...current.tracks];
    newTracks[index] = track;

    this.updateCurrentPlaylist({
      tracks: newTracks,
    });
  }

  // Reorder tracks in current playlist
  reorderTracksInCurrentPlaylist(fromIndex: number, toIndex: number): void {
    const current = this._currentEditingPlaylist();
    if (!current) return;

    const newTracks = [...current.tracks];
    const [movedTrack] = newTracks.splice(fromIndex, 1);
    newTracks.splice(toIndex, 0, movedTrack);

    this.updateCurrentPlaylist({
      tracks: newTracks,
    });
  }

  // Save current playlist as draft
  saveDraft(): void {
    const current = this._currentEditingPlaylist();
    if (!current) return;

    const drafts = this._drafts();
    const existingIndex = drafts.findIndex(draft => draft.id === current.id);

    if (existingIndex >= 0) {
      // Update existing draft
      const newDrafts = [...drafts];
      newDrafts[existingIndex] = { ...current };
      this._drafts.set(newDrafts);
    } else {
      // Add new draft
      this._drafts.set([...drafts, { ...current }]);
    }

    this.saveDraftsToStorage();
  }

  // Save current playlist as final playlist
  savePlaylist(): Playlist {
    const current = this._currentEditingPlaylist();
    if (!current) {
      throw new Error('No playlist is currently being edited');
    }

    const playlist: Playlist = {
      id: current.id || this.generatePlaylistId(),
      title: current.title,
      description: current.description,
      tags: current.tags,
      tracks: current.tracks,
      totalDuration: this.calculateTotalDuration(current.tracks),
      created_at: Math.floor(Date.now() / 1000), // Nostr timestamp (seconds)
      pubkey: this.getCurrentUserPubkey(),
      isLocal: true,
    };

    // Add or update playlist
    const playlists = this._playlists();
    const existingIndex = playlists.findIndex(p => p.id === playlist.id);

    if (existingIndex >= 0) {
      // Update existing playlist
      const newPlaylists = [...playlists];
      newPlaylists[existingIndex] = playlist;
      this._playlists.set(newPlaylists);
    } else {
      // Add new playlist
      this._playlists.set([...playlists, playlist]);
    }

    // Remove from drafts if it exists
    this.removeDraft(playlist.id);

    // Clear current editing state
    this._currentEditingPlaylist.set(null);

    // Save to storage
    this.savePlaylistsToStorage();

    return playlist;
  }

  // Cancel editing current playlist
  cancelEditing(): void {
    this._currentEditingPlaylist.set(null);
  }

  // Delete playlist
  deletePlaylist(playlistId: string): void {
    const playlists = this._playlists().filter(p => p.id !== playlistId);
    this._playlists.set(playlists);
    this.savePlaylistsToStorage();

    // Also remove from drafts if exists
    this.removeDraft(playlistId);
  }

  // Rename playlist
  renamePlaylist(playlistId: string, newTitle: string): void {
    const playlists = this._playlists();
    const playlistIndex = playlists.findIndex(p => p.id === playlistId);

    if (playlistIndex === -1) {
      throw new Error(`Playlist with id ${playlistId} not found`);
    }

    const playlist = playlists[playlistIndex];
    const updatedPlaylist: Playlist = {
      ...playlist,
      title: newTitle,
    };

    const newPlaylists = [...playlists];
    newPlaylists[playlistIndex] = updatedPlaylist;
    this._playlists.set(newPlaylists);
    this.savePlaylistsToStorage();
  }

  // Load draft for editing
  loadDraft(draftId: string): void {
    const draft = this._drafts().find(d => d.id === draftId);
    if (draft) {
      this._currentEditingPlaylist.set({ ...draft });
    }
  }

  // Remove draft
  removeDraft(draftId: string): void {
    const drafts = this._drafts().filter(d => d.id !== draftId);
    this._drafts.set(drafts);
    this.saveDraftsToStorage();
  }

  // Get playlist by ID
  getPlaylist(playlistId: string): Playlist | undefined {
    return this._playlists().find(p => p.id === playlistId);
  }

  // Add tracks to an existing playlist
  addTracksToPlaylist(playlistId: string, tracks: PlaylistTrack[]): void {
    const playlists = this._playlists();
    const playlistIndex = playlists.findIndex(p => p.id === playlistId);

    if (playlistIndex === -1) {
      throw new Error(`Playlist with id ${playlistId} not found`);
    }

    const playlist = playlists[playlistIndex];
    const updatedPlaylist: Playlist = {
      ...playlist,
      tracks: [...playlist.tracks, ...tracks],
      totalDuration: this.calculateTotalDuration([...playlist.tracks, ...tracks]),
    };

    const newPlaylists = [...playlists];
    newPlaylists[playlistIndex] = updatedPlaylist;
    this._playlists.set(newPlaylists);
    this.savePlaylistsToStorage();
  }

  // Convert MediaItem to PlaylistTrack
  mediaItemToPlaylistTrack(mediaItem: MediaItem): PlaylistTrack {
    return {
      url: mediaItem.source,
      title: mediaItem.title,
      artist: mediaItem.artist,
      // Duration will be calculated if possible
    };
  }

  // Convert URL to PlaylistTrack
  urlToPlaylistTrack(url: string, title?: string, artist?: string): PlaylistTrack {
    return {
      url,
      title: title || this.extractTitleFromUrl(url),
      artist,
    };
  }

  // Import playlist from Nostr event (kind 32100)
  importPlaylistFromNostrEvent(event: Event): Playlist | null {
    try {
      if (event.kind !== 32100) {
        throw new Error('Event is not a playlist event (kind 32100)');
      }

      // Parse tags
      const dTag = event.tags.find(tag => tag[0] === 'd')?.[1];
      const altTag = event.tags.find(tag => tag[0] === 'alt')?.[1];
      const uTag = event.tags.find(tag => tag[0] === 'u')?.[1];
      const tTags = event.tags.filter(tag => tag[0] === 't').map(tag => tag[1]);

      // Parse M3U content
      const tracks = this.parseM3UContent(event.content);

      const playlist: Playlist = {
        id: dTag || event.id,
        title: altTag || 'Imported Playlist',
        description: dTag,
        tags: tTags,
        url: uTag,
        tracks,
        totalDuration: this.calculateTotalDuration(tracks),
        created_at: event.created_at,
        pubkey: event.pubkey,
        eventId: event.id,
        isLocal: false,
      };

      // Check if playlist with same 'd' tag already exists and update it
      // Otherwise, check by eventId for backwards compatibility
      const playlists = this._playlists();
      let existingIndex = -1;

      if (dTag) {
        // First try to find by 'd' tag (most accurate for replaceable events)
        existingIndex = playlists.findIndex(p => p.id === dTag);
      }

      if (existingIndex === -1) {
        // Fall back to finding by eventId
        existingIndex = playlists.findIndex(p => p.eventId === event.id);
      }

      if (existingIndex >= 0) {
        // Update existing playlist if the new event is more recent
        const existing = playlists[existingIndex];
        if (event.created_at > existing.created_at) {
          const newPlaylists = [...playlists];
          newPlaylists[existingIndex] = playlist;
          this._playlists.set(newPlaylists);
          this.savePlaylistsToStorage();
        }
      } else {
        // Add new playlist
        this._playlists.set([...playlists, playlist]);
        this.savePlaylistsToStorage();
      }

      return playlist;
    } catch (error) {
      console.error('Failed to import playlist from Nostr event:', error);
      return null;
    }
  }

  // Export playlist to M3U format for Nostr event
  exportPlaylistToM3U(playlist: Playlist): string {
    let m3uContent = '#EXTM3U\n';

    for (const track of playlist.tracks) {
      if (track.duration || track.artist || track.title) {
        const duration = track.duration ? this.parseDurationToSeconds(track.duration) : -1;
        const info = track.artist && track.title
          ? `${track.artist} - ${track.title}`
          : track.title || track.artist || '';
        m3uContent += `#EXTINF:${duration},${info}\n`;
      }
      m3uContent += `${track.url}\n`;
    }

    return m3uContent;
  }

  // Generate playlist event data for sharing (without signing)
  generatePlaylistEvent(playlist: Playlist): Partial<Event> {
    // Create the event content (M3U format)
    const content = this.exportPlaylistToM3U(playlist);

    // Create the tags
    const tags = this.generateNostrEventTags(playlist);

    // Get the actual current user pubkey
    const pubkey = this.getCurrentUserPubkey();

    // Create the event object
    return {
      kind: 32100,
      created_at: Math.floor(Date.now() / 1000),
      content,
      tags,
      pubkey: pubkey,
    };
  }

  // Publish playlist to Nostr as kind 32100 event
  async publishPlaylistToNostr(playlist: Playlist): Promise<Event> {
    try {
      // Create the event content (M3U format)
      const content = this.exportPlaylistToM3U(playlist);

      // Create the tags
      const tags = this.generateNostrEventTags(playlist);

      // Create the event using NostrService
      const event = this.nostrService.createEvent(32100, content, tags);

      if (!event) {
        throw new Error('Failed to create playlist event');
      }

      // Sign the event
      const signedEvent = await this.nostrService.signEvent(event);
      if (!signedEvent) {
        throw new Error('Failed to sign playlist event');
      }

      // Publish to account relays
      const publishPromises = await this.accountRelay.publish(signedEvent);

      if (!publishPromises) {
        throw new Error('Failed to publish playlist to relays');
      }

      console.log('Playlist published successfully:', signedEvent);
      return signedEvent;
    } catch (error) {
      console.error('Failed to publish playlist to Nostr:', error);
      throw error; // Re-throw so caller can handle the error
    }
  }

  // Save and publish playlist
  async saveAndPublishPlaylist(): Promise<Playlist | null> {
    try {
      // First save the playlist locally
      const savedPlaylist = this.savePlaylist();

      // Then attempt to publish to Nostr
      const publishedEvent = await this.publishPlaylistToNostr(savedPlaylist);

      // Update the playlist with the event ID and mark as published
      const updatedPlaylist: Playlist = {
        ...savedPlaylist,
        eventId: publishedEvent.id,
        isLocal: false, // Mark as published to Nostr
      };

      // Update in storage
      const playlists = this._playlists();
      const index = playlists.findIndex(p => p.id === updatedPlaylist.id);
      if (index >= 0) {
        const newPlaylists = [...playlists];
        newPlaylists[index] = updatedPlaylist;
        this._playlists.set(newPlaylists);
        this.savePlaylistsToStorage();
      }

      return updatedPlaylist;
    } catch (error) {
      console.error('Failed to save and publish playlist:', error);
      // Return the locally saved playlist even if publishing failed
      try {
        return this.savePlaylist();
      } catch (saveError) {
        console.error('Failed to save playlist locally:', saveError);
        throw new Error('Failed to save playlist');
      }
    }
  }

  // Check if playlist ID already exists
  isPlaylistIdUnique(id: string, excludeId?: string): boolean {
    const playlists = this._playlists();
    return !playlists.some(playlist =>
      playlist.id === id && playlist.id !== excludeId
    );
  }

  // Generate tags for Nostr event
  generateNostrEventTags(playlist: Playlist): string[][] {
    const tags: string[][] = [];

    // Add 'd' tag (descriptor/ID)
    if (playlist.id) {
      tags.push(['d', playlist.id]);
    }

    // Add 'alt' tag (title)
    if (playlist.title) {
      tags.push(['alt', playlist.title]);
    }

    // Add 'u' tag (URL) if available
    if (playlist.url) {
      tags.push(['u', playlist.url]);
    }

    // Add 't' tags (topic/genre tags)
    if (playlist.tags) {
      playlist.tags.forEach(tag => {
        tags.push(['t', tag]);
      });
    }

    return tags;
  }

  // Helper methods
  private getCurrentUserPubkey(): string {
    return this.app.accountState.pubkey() || '';
  }

  private generatePlaylistId(): string {
    return `playlist_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  private extractTitleFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop() || '';

      // Remove file extension
      const title = filename.replace(/\.[^/.]+$/, '');

      return title || 'Unknown Track';
    } catch {
      return 'Unknown Track';
    }
  }

  private parseM3UContent(content: string): PlaylistTrack[] {
    if (!content) return [];

    const lines = content.split('\n').map(line => line.trim());
    const tracks: PlaylistTrack[] = [];
    let currentTrack: Partial<PlaylistTrack> = {};

    lines.forEach(line => {
      if (line.startsWith('#EXTINF:')) {
        // Parse track info: #EXTINF:duration,artist - title
        const match = line.match(/#EXTINF:([^,]*),(.*)$/);
        if (match) {
          const duration = match[1].trim();
          const info = match[2].trim();

          // Try to parse "artist - title" format
          const titleMatch = info.match(/^(.*?)\s*-\s*(.*)$/);
          if (titleMatch) {
            currentTrack.artist = titleMatch[1].trim();
            currentTrack.title = titleMatch[2].trim();
          } else {
            currentTrack.title = info;
          }

          if (duration && duration !== '-1') {
            currentTrack.duration = formatDuration(parseInt(duration, 10));
          }
        }
      } else if (line && !line.startsWith('#')) {
        // This should be a URL
        currentTrack.url = line;

        if (currentTrack.url) {
          tracks.push(currentTrack as PlaylistTrack);
          currentTrack = {};
        }
      }
    });

    return tracks;
  }

  private calculateTotalDuration(tracks: PlaylistTrack[]): string | undefined {
    let totalSeconds = 0;
    let hasValidDurations = false;

    for (const track of tracks) {
      if (track.duration) {
        const seconds = this.parseDurationToSeconds(track.duration);
        if (seconds > 0) {
          totalSeconds += seconds;
          hasValidDurations = true;
        }
      }
    }

    return hasValidDurations ? formatDuration(totalSeconds) : undefined;
  }

  private parseDurationToSeconds(duration: string): number {
    // Handle formats like "3:45" or "245" (seconds)
    if (duration.includes(':')) {
      const parts = duration.split(':').map(p => parseInt(p, 10));
      if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
      } else if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
    }
    return parseInt(duration, 10) || 0;
  }


  /**
   * Get the "Watch Later" playlist, creating it if it doesn't exist
   */
  getOrCreateWatchLaterPlaylist(): Playlist {
    const watchLaterId = 'watch-later';
    let watchLater = this._playlists().find(p => p.id === watchLaterId);

    if (!watchLater) {
      // Create the watch-later playlist
      watchLater = {
        id: watchLaterId,
        title: 'Watch Later',
        description: 'Videos and media saved for later viewing',
        tracks: [],
        created_at: Math.floor(Date.now() / 1000),
        pubkey: this.getCurrentUserPubkey(),
        isLocal: true,
      };

      this._playlists.set([...this._playlists(), watchLater]);
      this.savePlaylistsToStorage();
    }

    return watchLater;
  }

  /**
   * Add a track to a playlist by ID
   * If the playlist is 'watch-later' and doesn't exist, it will be created
   */
  addTrackToPlaylist(playlistId: string, track: PlaylistTrack): void {
    // Special handling for watch-later
    if (playlistId === 'watch-later') {
      this.getOrCreateWatchLaterPlaylist();
    }

    const playlists = this._playlists();
    const playlistIndex = playlists.findIndex(p => p.id === playlistId);

    if (playlistIndex === -1) {
      throw new Error(`Playlist with id ${playlistId} not found`);
    }

    const playlist = playlists[playlistIndex];

    // Check if track already exists (by URL)
    if (playlist.tracks.some(t => t.url === track.url)) {
      return; // Track already in playlist
    }

    const updatedPlaylist: Playlist = {
      ...playlist,
      tracks: [...playlist.tracks, track],
      totalDuration: this.calculateTotalDuration([...playlist.tracks, track]),
    };

    const newPlaylists = [...playlists];
    newPlaylists[playlistIndex] = updatedPlaylist;
    this._playlists.set(newPlaylists);
    this.savePlaylistsToStorage();
  }
}