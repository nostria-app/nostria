import { Injectable, inject } from '@angular/core';
import { SettingsService } from './settings.service';
import { SwUpdate } from '@angular/service-worker';
import { ImagePreloaderService } from './image-preloader.service';

@Injectable({
  providedIn: 'root',
})
export class ImageCacheService {
  private readonly settingsService = inject(SettingsService);
  private readonly swUpdate = inject(SwUpdate);
  private readonly imagePreloader = inject(ImagePreloaderService);
  private readonly PROXY_BASE_URL = 'https://proxy.eu.nostria.app/api/ImageOptimizeProxy';

  /**
   * Gets the optimized image URL with proper cache headers
   * Uses standard size 96x96 for all profile images
   */
  getOptimizedImageUrl(originalUrl: string): string {
    if (!this.settingsService.settings().imageCacheEnabled) {
      return originalUrl;
    }

    const encodedUrl = encodeURIComponent(originalUrl);
    return `${this.PROXY_BASE_URL}?w=96&h=96&url=${encodedUrl}`;
  }

  /**
   * Preload an image for faster display
   * @param originalUrl The original image URL
   */
  async preloadImage(originalUrl: string): Promise<void> {
    if (!originalUrl || !this.settingsService.settings().imageCacheEnabled) {
      return;
    }

    const optimizedUrl = this.getOptimizedImageUrl(originalUrl);
    await this.imagePreloader.preloadImage(optimizedUrl);
  }

  /**
   * Preload multiple images in parallel
   * @param imageUrls Array of image URLs
   */
  async preloadImages(imageUrls: string[]): Promise<void> {
    if (!this.settingsService.settings().imageCacheEnabled) {
      return;
    }

    const optimizedUrls = imageUrls.map(url => this.getOptimizedImageUrl(url));

    await this.imagePreloader.preloadImages(optimizedUrls);
  }

  /**
   * Clears all cached images by clearing Angular SW cache
   */
  async clearAllCache(): Promise<void> {
    try {
      if (!('caches' in window)) return;

      const cacheNames = await caches.keys();
      const imageCaches = cacheNames.filter(
        name => name.includes('ngsw') && (name.includes('data') || name.includes('image-cache'))
      );

      // Instead of deleting entire caches, let's remove only image entries
      for (const cacheName of imageCaches) {
        try {
          const cache = await caches.open(cacheName);
          const keys = await cache.keys();

          // Filter and delete only image proxy requests
          const imageKeys = keys.filter(request =>
            request.url.includes('proxy.eu.nostria.app/api/ImageOptimizeProxy')
          );

          for (const request of imageKeys) {
            await cache.delete(request);
          }

          console.log(`Cleared ${imageKeys.length} image entries from cache ${cacheName}`);
        } catch (error) {
          console.warn('Could not clear cache:', cacheName, error);
        }
      }

      // Also clear the image preloader cache
      await this.imagePreloader.clearCache();

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

    // Also cleanup image preloader cache
    const removedCount = await this.imagePreloader.cleanupExpiredCache();
    console.log(
      `Cache expiration is handled automatically by Angular Service Worker. Cleaned up ${removedCount} expired preload cache entries.`
    );
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
