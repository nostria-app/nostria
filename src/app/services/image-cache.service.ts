import { Injectable, inject } from '@angular/core';
import { SettingsService } from './settings.service';
import { SwUpdate } from '@angular/service-worker';

@Injectable({
  providedIn: 'root',
})
export class ImageCacheService {
  private readonly settingsService = inject(SettingsService);
  private readonly swUpdate = inject(SwUpdate);
  private readonly PROXY_BASE_URL = 'https://proxy.eu.nostria.app/api/ImageOptimizeProxy';

  /**
   * Gets the optimized image URL with proper cache headers
   */
  getOptimizedImageUrl(originalUrl: string, width = 250, height = 250): string {
    if (!this.settingsService.settings().imageCacheEnabled) {
      return originalUrl;
    }

    const encodedUrl = encodeURIComponent(originalUrl);
    return `${this.PROXY_BASE_URL}?w=${width}&h=${height}&url=${encodedUrl}`;
  }

  /**
   * Clears all cached images by clearing Angular SW cache
   */
  async clearAllCache(): Promise<void> {
    try {
      debugger;
      if (!('caches' in window)) return;

      const cacheNames = await caches.keys();
      const imageCaches = cacheNames.filter(
        (name) => name.includes('ngsw') && (name.includes('data') || name.includes('image-cache')),
      );

      // Instead of deleting entire caches, let's remove only image entries
      for (const cacheName of imageCaches) {
        try {
          const cache = await caches.open(cacheName);
          const keys = await cache.keys();

          // Filter and delete only image proxy requests
          const imageKeys = keys.filter((request) =>
            request.url.includes('proxy.eu.nostria.app/api/ImageOptimizeProxy'),
          );

          for (const request of imageKeys) {
            await cache.delete(request);
          }

          console.log(`Cleared ${imageKeys.length} image entries from cache ${cacheName}`);
        } catch (error) {
          console.warn('Could not clear cache:', cacheName, error);
        }
      }

      console.log('Image cache cleared successfully');
    } catch (error) {
      console.error('Error clearing cache:', error);
      throw error;
    }
  }

  /**
   * Clears expired cache entries (handled automatically by Angular SW)
   */
  async clearExpiredCache(): Promise<void> {
    // Angular Service Worker handles cache expiration automatically
    // based on the maxAge setting in ngsw-config.json
    console.log('Cache expiration is handled automatically by Angular Service Worker');
  }

  /**
   * Manages cache size (handled automatically by Angular SW)
   */
  async manageCacheSize(): Promise<void> {
    // Angular Service Worker handles cache size management automatically
    // based on the maxSize setting in ngsw-config.json
    console.log('Cache size management is handled automatically by Angular Service Worker');
  }

  /**
   * Checks if caching is available and enabled
   */
  isCacheAvailable(): boolean {
    return (
      'caches' in window &&
      (this.settingsService.settings().imageCacheEnabled ?? false) &&
      (this.swUpdate.isEnabled ?? false)
    );
  }

  /**
   * Gets service worker registration status
   */
  isServiceWorkerAvailable(): boolean {
    return this.swUpdate.isEnabled ?? false;
  }
}
