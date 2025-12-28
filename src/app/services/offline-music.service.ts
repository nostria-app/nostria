import { Injectable, inject, signal, computed } from '@angular/core';
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

  constructor() {
    // Initialize when app is ready
    if (this.app.isBrowser()) {
      this.initialize();
    }
  }

  /**
   * Initialize the offline music service
   */
  async initialize(): Promise<void> {
    if (!this.app.isBrowser()) return;

    try {
      await this.loadOfflineTracks();
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
    await this.database.init();

    return new Promise((resolve, reject) => {
      const db = (this.database as unknown as { db: IDBDatabase }).db;
      if (!db) {
        reject(new Error('Database not initialized'));
        return;
      }

      // Check if store exists, if not we need to handle this differently
      if (!db.objectStoreNames.contains(this.STORE_NAME)) {
        // Store in info store with a special type
        const transaction = db.transaction(['info'], 'readwrite');
        const store = transaction.objectStore('info');

        const record = {
          compositeKey: `offlineMusic::${track.id}`,
          key: track.id,
          type: 'offlineMusic',
          updated: track.cachedAt,
          ...track,
        };

        const request = store.put(record);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        return;
      }

      const transaction = db.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);

      const request = store.put(track);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete track metadata from IndexedDB
   */
  private async deleteTrackMetadata(trackId: string): Promise<void> {
    await this.database.init();

    return new Promise((resolve, reject) => {
      const db = (this.database as unknown as { db: IDBDatabase }).db;
      if (!db) {
        reject(new Error('Database not initialized'));
        return;
      }

      // Check if dedicated store exists
      if (!db.objectStoreNames.contains(this.STORE_NAME)) {
        // Delete from info store
        const transaction = db.transaction(['info'], 'readwrite');
        const store = transaction.objectStore('info');
        const request = store.delete(`offlineMusic::${trackId}`);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        return;
      }

      const transaction = db.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);

      const request = store.delete(trackId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all track metadata from IndexedDB
   */
  private async getAllTrackMetadata(): Promise<OfflineMusicTrack[]> {
    await this.database.init();

    return new Promise((resolve, reject) => {
      const db = (this.database as unknown as { db: IDBDatabase }).db;
      if (!db) {
        resolve([]);
        return;
      }

      // Check if dedicated store exists
      if (!db.objectStoreNames.contains(this.STORE_NAME)) {
        // Query from info store by type
        const transaction = db.transaction(['info'], 'readonly');
        const store = transaction.objectStore('info');
        const index = store.index('by-type');
        const request = index.getAll('offlineMusic');

        request.onsuccess = () => {
          const records = request.result || [];
          // Convert info records back to OfflineMusicTrack format
          const tracks: OfflineMusicTrack[] = records.map(r => ({
            id: r.id || r.key,
            pubkey: r.pubkey,
            dTag: r.dTag,
            event: r.event,
            title: r.title,
            artist: r.artist,
            audioUrl: r.audioUrl,
            imageUrl: r.imageUrl,
            cachedAt: r.cachedAt || r.updated,
            audioSize: r.audioSize,
            imageSize: r.imageSize,
          }));
          resolve(tracks);
        };
        request.onerror = () => reject(request.error);
        return;
      }

      const transaction = db.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);

      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all track metadata from IndexedDB
   */
  private async clearAllTrackMetadata(): Promise<void> {
    await this.database.init();

    return new Promise((resolve, reject) => {
      const db = (this.database as unknown as { db: IDBDatabase }).db;
      if (!db) {
        resolve();
        return;
      }

      // Check if dedicated store exists
      if (!db.objectStoreNames.contains(this.STORE_NAME)) {
        // Clear from info store by type
        const transaction = db.transaction(['info'], 'readwrite');
        const store = transaction.objectStore('info');
        const index = store.index('by-type');
        const request = index.openCursor(IDBKeyRange.only('offlineMusic'));

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
        return;
      }

      const transaction = db.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);

      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}
