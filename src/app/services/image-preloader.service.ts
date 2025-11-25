import { Injectable, inject } from '@angular/core';
import { LoggerService } from './logger.service';
import { SettingsService } from './settings.service';

/**
 * Service for preloading and caching images using the Cache API
 * This provides faster image loading by prefetching images before they're needed
 */
@Injectable({
  providedIn: 'root',
})
export class ImagePreloaderService {
  private readonly logger = inject(LoggerService);
  private readonly settingsService = inject(SettingsService);
  private readonly CACHE_NAME = 'nostria-image-preload-cache';
  private readonly MAX_CACHE_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
  
  // Track images currently being preloaded to avoid duplicate requests
  private preloadingImages = new Set<string>();
  
  /**
   * Preload an image and store it in the Cache API
   * @param imageUrl The URL of the image to preload
   * @returns Promise that resolves when image is cached
   */
  async preloadImage(imageUrl: string): Promise<void> {
    if (!imageUrl || !this.isCacheAvailable()) {
      return;
    }

    // Skip if already preloading this image
    if (this.preloadingImages.has(imageUrl)) {
      return;
    }

    try {
      this.preloadingImages.add(imageUrl);
      
      // Check if already cached
      const cache = await caches.open(this.CACHE_NAME);
      const cachedResponse = await cache.match(imageUrl);
      
      if (cachedResponse) {
        // Already cached, check if it's still fresh
        const cacheDate = cachedResponse.headers.get('x-cache-date');
        if (cacheDate) {
          const age = Date.now() - parseInt(cacheDate, 10);
          if (age < this.MAX_CACHE_AGE) {
            // Cache is fresh, no need to refetch
            return;
          }
        }
      }

      // Fetch and cache the image
      const response = await fetch(imageUrl, {
        mode: 'cors',
        cache: 'default',
      });

      if (response.ok) {
        // Clone the response and add cache timestamp header
        const responseToCache = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: new Headers({
            ...Object.fromEntries(response.headers.entries()),
            'x-cache-date': Date.now().toString(),
          }),
        });

        await cache.put(imageUrl, responseToCache);
        this.logger.debug(`Preloaded and cached image: ${imageUrl}`);
      }
    } catch (error) {
      this.logger.warn(`Failed to preload image ${imageUrl}:`, error);
    } finally {
      this.preloadingImages.delete(imageUrl);
    }
  }

  /**
   * Preload multiple images in parallel
   * @param imageUrls Array of image URLs to preload
   * @param maxConcurrent Maximum number of concurrent preloads (default: 5)
   */
  async preloadImages(imageUrls: string[], maxConcurrent = 5): Promise<void> {
    if (!imageUrls.length || !this.isCacheAvailable()) {
      return;
    }

    // Filter out URLs that are already being preloaded
    const urlsToPreload = imageUrls.filter(url => !this.preloadingImages.has(url));
    
    // Process images in batches to avoid overwhelming the network
    for (let i = 0; i < urlsToPreload.length; i += maxConcurrent) {
      const batch = urlsToPreload.slice(i, i + maxConcurrent);
      await Promise.all(batch.map(url => this.preloadImage(url)));
    }
  }

  /**
   * Get a cached image or return null if not cached
   * @param imageUrl The URL of the image to get from cache
   */
  async getCachedImage(imageUrl: string): Promise<Response | null> {
    if (!imageUrl || !this.isCacheAvailable()) {
      return null;
    }

    try {
      const cache = await caches.open(this.CACHE_NAME);
      const cachedResponse = await cache.match(imageUrl);
      
      if (cachedResponse) {
        // Check if cache is still fresh
        const cacheDate = cachedResponse.headers.get('x-cache-date');
        if (cacheDate) {
          const age = Date.now() - parseInt(cacheDate, 10);
          if (age < this.MAX_CACHE_AGE) {
            return cachedResponse;
          }
        }
      }
      
      return null;
    } catch (error) {
      this.logger.warn(`Failed to get cached image ${imageUrl}:`, error);
      return null;
    }
  }

  /**
   * Check if an image is already cached
   * @param imageUrl The URL to check
   */
  async isImageCached(imageUrl: string): Promise<boolean> {
    if (!imageUrl || !this.isCacheAvailable()) {
      return false;
    }

    try {
      const cache = await caches.open(this.CACHE_NAME);
      const cachedResponse = await cache.match(imageUrl);
      
      if (!cachedResponse) {
        return false;
      }

      // Check if cache is still fresh
      const cacheDate = cachedResponse.headers.get('x-cache-date');
      if (cacheDate) {
        const age = Date.now() - parseInt(cacheDate, 10);
        return age < this.MAX_CACHE_AGE;
      }
      
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Clear all cached images
   */
  async clearCache(): Promise<void> {
    if (!this.isCacheAvailable()) {
      return;
    }

    try {
      await caches.delete(this.CACHE_NAME);
      this.logger.info('Image preload cache cleared');
    } catch (error) {
      this.logger.error('Failed to clear image preload cache:', error);
    }
  }

  /**
   * Clean up expired cache entries
   */
  async cleanupExpiredCache(): Promise<number> {
    if (!this.isCacheAvailable()) {
      return 0;
    }

    try {
      const cache = await caches.open(this.CACHE_NAME);
      const keys = await cache.keys();
      let removedCount = 0;

      for (const request of keys) {
        const response = await cache.match(request);
        if (response) {
          const cacheDate = response.headers.get('x-cache-date');
          if (cacheDate) {
            const age = Date.now() - parseInt(cacheDate, 10);
            if (age >= this.MAX_CACHE_AGE) {
              await cache.delete(request);
              removedCount++;
            }
          }
        }
      }

      if (removedCount > 0) {
        this.logger.info(`Cleaned up ${removedCount} expired image cache entries`);
      }

      return removedCount;
    } catch (error) {
      this.logger.error('Failed to cleanup expired cache:', error);
      return 0;
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{ count: number; size: number }> {
    if (!this.isCacheAvailable()) {
      return { count: 0, size: 0 };
    }

    try {
      const cache = await caches.open(this.CACHE_NAME);
      const keys = await cache.keys();
      let totalSize = 0;

      for (const request of keys) {
        const response = await cache.match(request);
        if (response && response.body) {
          const blob = await response.blob();
          totalSize += blob.size;
        }
      }

      return { count: keys.length, size: totalSize };
    } catch (error) {
      this.logger.error('Failed to get cache stats:', error);
      return { count: 0, size: 0 };
    }
  }

  /**
   * Check if Cache API is available
   */
  private isCacheAvailable(): boolean {
    return (
      typeof caches !== 'undefined' && (this.settingsService.settings().imageCacheEnabled ?? false)
    );
  }
}
