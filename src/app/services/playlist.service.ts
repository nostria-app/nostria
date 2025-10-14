import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { LocalStorageService } from './local-storage.service';
import { ApplicationService } from './application.service';
import { NostrService } from './nostr.service';
import { AccountRelayService } from './relays/account-relay';
import { Playlist, PlaylistTrack, PlaylistDraft, OnInitialized, MediaItem } from '../interfaces';
import { Event } from 'nostr-tools';

@Injectable({
  providedIn: 'root',
})
export class PlaylistService implements OnInitialized {
  private localStorage = inject(LocalStorageService);
  private app = inject(ApplicationService);
  private nostrService = inject(NostrService);
  private accountRelay = inject(AccountRelayService);

  // Storage keys
  private readonly PLAYLISTS_STORAGE_KEY = 'nostria-playlists';
  private readonly DRAFTS_STORAGE_KEY = 'nostria-playlist-drafts';

  // Signals for reactive state management
  private _playlists = signal<Playlist[]>([]);
  private _drafts = signal<PlaylistDraft[]>([]);
  private _currentEditingPlaylist = signal<PlaylistDraft | null>(null);

  // Public readonly signals
  playlists = this._playlists.asReadonly();
  drafts = this._drafts.asReadonly();
  currentEditingPlaylist = this._currentEditingPlaylist.asReadonly();

  // Computed signals
  userPlaylists = computed(() => {
    const currentPubkey = this.getCurrentUserPubkey();
    return this._playlists().filter(playlist => playlist.isLocal || playlist.pubkey === currentPubkey);
  });

  hasUnsavedChanges = computed(() => {
    const currentDraft = this._currentEditingPlaylist();
    return currentDraft !== null;
  });

  constructor() {
    if (!this.app.isBrowser()) {
      return;
    }

    effect(() => {
      if (this.app.initialized()) {
        this.initialize();
      }
    });
  }

  initialize(): void {
    this.loadPlaylistsFromStorage();
    this.loadDraftsFromStorage();
  }

  /**
   * Fetch all playlists from Nostr for the current user
   * This should be called when the playlists page is opened to load fresh data
   */
  async fetchPlaylistsFromNostr(pubkey: string): Promise<void> {
    try {
      console.log('Fetching playlists from Nostr for pubkey:', pubkey);

      // Query for playlist events (kind 32100) authored by the user
      const events = await this.accountRelay.getMany<Event>({
        kinds: [32100],
        authors: [pubkey],
      }, { timeout: 10000 }); // 10 second timeout

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
    const stored = this.localStorage.getItem(this.PLAYLISTS_STORAGE_KEY);
    if (stored && stored !== 'undefined' && stored !== '') {
      try {
        const playlists = JSON.parse(stored) as Playlist[];
        this._playlists.set(playlists);
      } catch (error) {
        console.error('Failed to load playlists from storage:', error);
        this._playlists.set([]);
      }
    }
  }

  private loadDraftsFromStorage(): void {
    const stored = this.localStorage.getItem(this.DRAFTS_STORAGE_KEY);
    if (stored && stored !== 'undefined' && stored !== '') {
      try {
        const drafts = JSON.parse(stored) as PlaylistDraft[];
        this._drafts.set(drafts);
      } catch (error) {
        console.error('Failed to load drafts from storage:', error);
        this._drafts.set([]);
      }
    }
  }

  private savePlaylistsToStorage(): void {
    this.localStorage.setItem(this.PLAYLISTS_STORAGE_KEY, JSON.stringify(this._playlists()));
  }

  private saveDraftsToStorage(): void {
    this.localStorage.setItem(this.DRAFTS_STORAGE_KEY, JSON.stringify(this._drafts()));
  }

  // Create a new playlist
  createPlaylist(title: string, description?: string, id?: string): PlaylistDraft {
    const draft: PlaylistDraft = {
      id: id || this.generatePlaylistId(),
      title,
      description,
      tracks: [],
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

    // Create the event object
    return {
      kind: 32100,
      created_at: Math.floor(Date.now() / 1000),
      content,
      tags,
      pubkey: playlist.pubkey,
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
    return `playlist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
            currentTrack.duration = this.formatDuration(parseInt(duration, 10));
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

    return hasValidDurations ? this.formatDuration(totalSeconds) : undefined;
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

  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  }
}