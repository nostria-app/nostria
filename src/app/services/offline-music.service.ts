import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { Event } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { DatabaseService } from './database.service';
import { ApplicationService } from './application.service';

/**
 * Interface for offline music track stored in IndexedDB
 */
export interface OfflineMusicTrack {
  id: string; // Unique ID: pubkey::dTag
  pubkey: string;
  dTag: string;
  event: Event; // Full Nostr event
  title: string;
  artist: string;
  audioUrl: string;
  imageUrl?: string;
  cachedAt: number; // Timestamp when cached
  audioSize?: number; // Size of audio file in bytes
  imageSize?: number; // Size of image in bytes
}

const OFFLINE_MUSIC_CACHE = 'nostria-music';
const OFFLINE_IMAGES_CACHE = 'nostria-music-images';

@Injectable({
  providedIn: 'root',
})
export class OfflineMusicService {
  private readonly logger = inject(LoggerService);
  private readonly database = inject(DatabaseService);
  private readonly app = inject(ApplicationService);

  // Track IDs that are available offline (pubkey::dTag format)
  private _offlineTrackIds = signal<Set<string>>(new Set());

  // All offline tracks with metadata
  private _offlineTracks = signal<OfflineMusicTrack[]>([]);
  offlineTracks = this._offlineTracks.asReadonly();

  // Loading state
  private _loading = signal(false);
  loading = this._loading.asReadonly();

  // Download progress for current download
  private _downloadProgress = signal<number | null>(null);
  downloadProgress = this._downloadProgress.asReadonly();

  // Total storage used (approximate)
  totalStorageUsed = computed(() => {
    const tracks = this._offlineTracks();
    return tracks.reduce((total, track) => {
      return total + (track.audioSize || 0) + (track.imageSize || 0);
    }, 0);
  });

  private initPromise: Promise<void> | null = null;
  private hasLoadedFromStorage = false;

  constructor() {
    if (!this.app.isBrowser()) {
      return;
    }

    // Initialize once the app/database is ready.
    effect(() => {
      const appReady = this.app.initialized();
      if (!appReady || this.hasLoadedFromStorage) {
        return;
      }

      void this.initialize();
    });
  }

  /**
   * Initialize the offline music service
   */
  async initialize(): Promise<void> {
    if (!this.app.isBrowser()) return;

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.initializeInternal();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async initializeInternal(): Promise<void> {
    if (this.hasLoadedFromStorage) {
      return;
    }

    try {
      await this.loadOfflineTracks();
      this.hasLoadedFromStorage = true;
      this.logger.info(`Offline music service initialized with ${this._offlineTracks().length} tracks`);
    } catch (err) {
      this.logger.error('Failed to initialize offline music service:', err);
    }
  }

  /**
   * Check if a track is available offline
   */
  isTrackOffline(pubkey: string, dTag: string): boolean {
    const id = this.getTrackId(pubkey, dTag);
    return this._offlineTrackIds().has(id);
  }

  /**
   * Get offline track metadata if available.
   */
  getOfflineTrack(pubkey: string, dTag: string): OfflineMusicTrack | null {
    const id = this.getTrackId(pubkey, dTag);
    return this._offlineTracks().find(track => track.id === id) || null;
  }

  /**
   * Get a track ID from pubkey and dTag
   */
  private getTrackId(pubkey: string, dTag: string): string {
    return `${pubkey}::${dTag}`;
  }

  /**
   * Save a track for offline use
   */
  async saveTrackOffline(
    event: Event,
    title: string,
    artist: string,
    audioUrl: string,
    imageUrl?: string
  ): Promise<boolean> {
    if (!this.app.isBrowser()) return false;

    const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
    const trackId = this.getTrackId(event.pubkey, dTag);

    // Check if already offline
    if (this.isTrackOffline(event.pubkey, dTag)) {
      this.logger.info('Track already available offline:', trackId);
      return true;
    }

    this._loading.set(true);
    this._downloadProgress.set(0);

    try {
      // 1. Cache the audio file
      const audioCache = await caches.open(OFFLINE_MUSIC_CACHE);

      // Fetch with progress tracking
      const audioResponse = await this.fetchWithProgress(audioUrl);
      if (!audioResponse) {
        throw new Error('Failed to download audio file');
      }

      // Clone response for size calculation
      const audioBlob = await audioResponse.clone().blob();
      const audioSize = audioBlob.size;

      // Store in cache
      await audioCache.put(audioUrl, audioResponse);
      this.logger.debug(`Cached audio file: ${audioUrl} (${this.formatBytes(audioSize)})`);

      // 2. Cache the image if available
      let imageSize = 0;
      if (imageUrl) {
        try {
          const imageCache = await caches.open(OFFLINE_IMAGES_CACHE);
          const imageResponse = await fetch(imageUrl);
          if (imageResponse.ok) {
            const imageBlob = await imageResponse.clone().blob();
            imageSize = imageBlob.size;
            await imageCache.put(imageUrl, imageResponse);
            this.logger.debug(`Cached image: ${imageUrl} (${this.formatBytes(imageSize)})`);
          }
        } catch (imgErr) {
          this.logger.warn('Failed to cache image:', imgErr);
          // Continue without image - audio is more important
        }
      }

      // 3. Store metadata in IndexedDB
      const offlineTrack: OfflineMusicTrack = {
        id: trackId,
        pubkey: event.pubkey,
        dTag,
        event,
        title,
        artist,
        audioUrl,
        imageUrl,
        cachedAt: Math.floor(Date.now() / 1000),
        audioSize,
        imageSize,
      };

      await this.saveTrackMetadata(offlineTrack);

      // 4. Update local state
      this._offlineTrackIds.update(set => {
        const newSet = new Set(set);
        newSet.add(trackId);
        return newSet;
      });

      this._offlineTracks.update(tracks => [...tracks, offlineTrack]);

      this.logger.info(`Track saved offline: ${title} by ${artist}`);
      return true;
    } catch (err) {
      this.logger.error('Failed to save track offline:', err);
      return false;
    } finally {
      this._loading.set(false);
      this._downloadProgress.set(null);
    }
  }

  /**
   * Remove a track from offline storage
   */
  async removeTrackOffline(pubkey: string, dTag: string): Promise<boolean> {
    if (!this.app.isBrowser()) return false;

    const trackId = this.getTrackId(pubkey, dTag);

    try {
      // Find the track to get URLs
      const track = this._offlineTracks().find(t => t.id === trackId);
      if (!track) {
        this.logger.warn('Track not found in offline storage:', trackId);
        return false;
      }

      // 1. Remove audio from cache
      const audioCache = await caches.open(OFFLINE_MUSIC_CACHE);
      await audioCache.delete(track.audioUrl);

      // 2. Remove image from cache if exists
      if (track.imageUrl) {
        const imageCache = await caches.open(OFFLINE_IMAGES_CACHE);
        await imageCache.delete(track.imageUrl);
      }

      // 3. Remove metadata from IndexedDB
      await this.deleteTrackMetadata(trackId);

      // 4. Update local state
      this._offlineTrackIds.update(set => {
        const newSet = new Set(set);
        newSet.delete(trackId);
        return newSet;
      });

      this._offlineTracks.update(tracks => tracks.filter(t => t.id !== trackId));

      this.logger.info(`Track removed from offline storage: ${track.title}`);
      return true;
    } catch (err) {
      this.logger.error('Failed to remove track from offline storage:', err);
      return false;
    }
  }

  /**
   * Get the cached audio URL for a track (returns blob URL if offline, original URL if online)
   */
  async getCachedAudioUrl(audioUrl: string): Promise<string> {
    if (!this.app.isBrowser()) return audioUrl;

    try {
      const cache = await caches.open(OFFLINE_MUSIC_CACHE);
      const cachedResponse = await cache.match(audioUrl);

      if (cachedResponse) {
        const blob = await cachedResponse.blob();
        return URL.createObjectURL(blob);
      }
    } catch (err) {
      this.logger.warn('Failed to get cached audio:', err);
    }

    return audioUrl;
  }

  /**
   * Get the cached image URL for a track
   */
  async getCachedImageUrl(imageUrl: string): Promise<string> {
    if (!this.app.isBrowser()) return imageUrl;

    try {
      const cache = await caches.open(OFFLINE_IMAGES_CACHE);
      const cachedResponse = await cache.match(imageUrl);

      if (cachedResponse) {
        const blob = await cachedResponse.blob();
        return URL.createObjectURL(blob);
      }
    } catch (err) {
      this.logger.warn('Failed to get cached image:', err);
    }

    return imageUrl;
  }

  /**
   * Check if the app is currently online
   */
  isOnline(): boolean {
    return this.app.isBrowser() ? navigator.onLine : true;
  }

  /**
   * Load all offline tracks from IndexedDB
   */
  private async loadOfflineTracks(): Promise<void> {
    try {
      const tracks = await this.getAllTrackMetadata();
      this._offlineTracks.set(tracks);

      const ids = new Set<string>();
      for (const track of tracks) {
        ids.add(track.id);
      }
      this._offlineTrackIds.set(ids);
    } catch (err) {
      this.logger.error('Failed to load offline tracks:', err);
    }
  }

  /**
   * Fetch with progress tracking for large files
   */
  private async fetchWithProgress(url: string): Promise<Response | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;

      const contentLength = response.headers.get('content-length');

      if (!contentLength || !response.body) {
        // No content length header or no body - just return the response
        this._downloadProgress.set(100);
        return response;
      }

      const total = parseInt(contentLength, 10);
      let loaded = 0;

      const reader = response.body.getReader();
      const chunks: BlobPart[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        loaded += value.length;

        const progress = Math.round((loaded / total) * 100);
        this._downloadProgress.set(progress);
      }

      // Reconstruct the response from chunks
      const blob = new Blob(chunks, { type: response.headers.get('content-type') || 'audio/mpeg' });
      return new Response(blob, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      });
    } catch (err) {
      this.logger.error('Failed to fetch with progress:', err);
      return null;
    }
  }

  /**
   * Format bytes to human readable string
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Clear all offline music data
   */
  async clearAllOfflineData(): Promise<void> {
    if (!this.app.isBrowser()) return;

    try {
      // Delete caches
      await caches.delete(OFFLINE_MUSIC_CACHE);
      await caches.delete(OFFLINE_IMAGES_CACHE);

      // Clear IndexedDB store
      await this.clearAllTrackMetadata();

      // Reset state
      this._offlineTracks.set([]);
      this._offlineTrackIds.set(new Set());

      this.logger.info('All offline music data cleared');
    } catch (err) {
      this.logger.error('Failed to clear offline music data:', err);
    }
  }

  // ============ IndexedDB Operations ============

  private readonly STORE_NAME = 'offlineMusic';

  /**
   * Save track metadata to IndexedDB
   */
  private async saveTrackMetadata(track: OfflineMusicTrack): Promise<void> {
    await this.database.saveInfo(track.id, this.STORE_NAME, { ...track });
  }

  /**
   * Delete track metadata from IndexedDB
   */
  private async deleteTrackMetadata(trackId: string): Promise<void> {
    await this.database.deleteInfoByKeyAndType(trackId, this.STORE_NAME);
  }

  /**
   * Get all track metadata from IndexedDB
   */
  private async getAllTrackMetadata(): Promise<OfflineMusicTrack[]> {
    const records = await this.database.getInfoByType(this.STORE_NAME);

    return records
      .filter(record =>
        typeof record['id'] === 'string' &&
        typeof record['pubkey'] === 'string' &&
        typeof record['dTag'] === 'string' &&
        typeof record['title'] === 'string' &&
        typeof record['artist'] === 'string' &&
        typeof record['audioUrl'] === 'string'
      )
      .map(record => ({
        id: record['id'] as string,
        pubkey: record['pubkey'] as string,
        dTag: record['dTag'] as string,
        event: record['event'] as Event,
        title: record['title'] as string,
        artist: record['artist'] as string,
        audioUrl: record['audioUrl'] as string,
        imageUrl: typeof record['imageUrl'] === 'string' ? record['imageUrl'] : undefined,
        cachedAt: typeof record['cachedAt'] === 'number' ? record['cachedAt'] : Math.floor(Date.now() / 1000),
        audioSize: typeof record['audioSize'] === 'number' ? record['audioSize'] : undefined,
        imageSize: typeof record['imageSize'] === 'number' ? record['imageSize'] : undefined,
      }));
  }

  /**
   * Clear all track metadata from IndexedDB
   */
  private async clearAllTrackMetadata(): Promise<void> {
    const records = await this.database.getInfoByType(this.STORE_NAME);
    await Promise.all(
      records
        .map(record => record['key'])
        .filter((key): key is string => typeof key === 'string')
        .map(key => this.database.deleteInfoByKeyAndType(key, this.STORE_NAME))
    );
  }
}
