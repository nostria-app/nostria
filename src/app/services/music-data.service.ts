import { Injectable, signal } from '@angular/core';
import { Event } from 'nostr-tools';

export interface ArtistData {
  name: string;
  pubkey: string;
  trackCount: number;
}

/**
 * Service to share pre-loaded music data between the main music page
 * and the detail pages (tracks, playlists, artists).
 * This enables instant rendering when navigating with "Show all".
 */
@Injectable({
  providedIn: 'root',
})
export class MusicDataService {
  private _preloadedTracks = signal<Event[] | null>(null);
  private _preloadedPlaylists = signal<Event[] | null>(null);
  private _preloadedArtists = signal<ArtistData[] | null>(null);

  /** Get preloaded tracks and clear after consumption */
  consumePreloadedTracks(): Event[] | null {
    const tracks = this._preloadedTracks();
    this._preloadedTracks.set(null);
    return tracks;
  }

  /** Get preloaded playlists and clear after consumption */
  consumePreloadedPlaylists(): Event[] | null {
    const playlists = this._preloadedPlaylists();
    this._preloadedPlaylists.set(null);
    return playlists;
  }

  /** Get preloaded artists and clear after consumption */
  consumePreloadedArtists(): ArtistData[] | null {
    const artists = this._preloadedArtists();
    this._preloadedArtists.set(null);
    return artists;
  }

  /** Set tracks to be consumed by the tracks page */
  setPreloadedTracks(tracks: Event[]): void {
    this._preloadedTracks.set(tracks);
  }

  /** Set playlists to be consumed by the playlists page */
  setPreloadedPlaylists(playlists: Event[]): void {
    this._preloadedPlaylists.set(playlists);
  }

  /** Set artists to be consumed by the artists page */
  setPreloadedArtists(artists: ArtistData[]): void {
    this._preloadedArtists.set(artists);
  }

  /** Check if preloaded tracks are available (without consuming) */
  hasPreloadedTracks(): boolean {
    return this._preloadedTracks() !== null;
  }

  /** Check if preloaded playlists are available (without consuming) */
  hasPreloadedPlaylists(): boolean {
    return this._preloadedPlaylists() !== null;
  }

  /** Check if preloaded artists are available (without consuming) */
  hasPreloadedArtists(): boolean {
    return this._preloadedArtists() !== null;
  }
}
