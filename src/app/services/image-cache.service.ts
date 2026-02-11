import { Injectable, inject, computed, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { SettingsService } from './settings.service';
import { SwUpdate } from '@angular/service-worker';
import { ImagePreloaderService } from './image-preloader.service';
import { DiscoveryRelayService } from './discovery-relay.service';
import { stripImageProxy } from '../utils/strip-image-proxy';

@Injectable({
  providedIn: 'root',
})
export class ImageCacheService {
  private readonly settingsService = inject(SettingsService);
  private readonly swUpdate = inject(SwUpdate);
  private readonly imagePreloader = inject(ImagePreloaderService);
  private readonly discoveryRelay = inject(DiscoveryRelayService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  /**
   * Gets the proxy base URL based on the user's selected region.
   * Derives the region code from the selected server (e.g., 'proxy.eu.nostria.app' -> 'eu')
   */
  private readonly proxyBaseUrl = computed(() => {
    const serverName = this.discoveryRelay.selectedServer().name;
    // Extract region code from server name (e.g., 'proxy.eu.nostria.app' -> 'eu')
    const regionMatch = serverName.match(/proxy\.([a-z]+)\.nostria\.app/);
    const regionCode = regionMatch ? regionMatch[1] : 'eu';
    return `https://proxy.${regionCode}.nostria.app/api/ImageOptimizeProxy`;
  });

  /**
   * Check if a URL is a valid full URL (http/https) that can be proxied
   */
  private isValidProxyableUrl(url: string): boolean {
    if (!url) return false;
    return url.startsWith('http://') || url.startsWith('https://');
  }

  /**
   * Gets the optimized image URL with proper cache headers
   * Uses standard size 96x96 for all profile images
   * Dynamically uses the user's selected proxy region
   * Only proxies full URLs (http/https) - relative paths and data URLs are returned as-is
   */
  getOptimizedImageUrl(originalUrl: string): string {
    if (!this.settingsService.settings().imageCacheEnabled) {
      return stripImageProxy(originalUrl);
    }

    // Only proxy full URLs - relative paths, data URLs, etc. cannot be proxied
    if (!this.isValidProxyableUrl(originalUrl)) {
      return originalUrl;
    }

    // Strip any third-party image proxy wrappers to get the actual image URL
    const cleanUrl = stripImageProxy(originalUrl);
    const encodedUrl = encodeURIComponent(cleanUrl);
    return `${this.proxyBaseUrl()}?w=96&h=96&url=${encodedUrl}`;
  }

  /**
   * Gets the optimized image URL with custom dimensions
   * Useful for album art and other images that need different sizes
   * Only proxies full URLs (http/https) - relative paths and data URLs are returned as-is
   * @param originalUrl The original image URL
   * @param width The desired width
   * @param height The desired height
   */
  getOptimizedImageUrlWithSize(originalUrl: string, width: number, height: number): string {
    if (!this.settingsService.settings().imageCacheEnabled) {
      return stripImageProxy(originalUrl);
    }

    // Only proxy full URLs - relative paths, data URLs, etc. cannot be proxied
    if (!this.isValidProxyableUrl(originalUrl)) {
      return originalUrl;
    }

    // Strip any third-party image proxy wrappers to get the actual image URL
    const cleanUrl = stripImageProxy(originalUrl);
    const encodedUrl = encodeURIComponent(cleanUrl);
    return `${this.proxyBaseUrl()}?w=${width}&h=${height}&url=${encodedUrl}`;
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
    // Skip on server - caches API is browser-only
    if (!this.isBrowser) return;

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

          // Filter and delete only image proxy requests from any region
          const imageKeys = keys.filter(request =>
            request.url.includes('nostria.app/api/ImageOptimizeProxy')
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
    // Always return false on server
    if (!this.isBrowser) return false;

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
