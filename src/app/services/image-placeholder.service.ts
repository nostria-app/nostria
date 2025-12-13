import { Injectable, inject } from '@angular/core';
import { encode, decode } from 'blurhash';
import { thumbHashToDataURL, rgbaToThumbHash } from 'thumbhash';
import { SettingsService } from './settings.service';
import type { PlaceholderAlgorithm } from './settings.service';
import { LoggerService } from './logger.service';

// Re-export for convenience
export type { PlaceholderAlgorithm };

// Default placeholder for images without one - neutral dark purple/gray gradient
export const DEFAULT_BLURHASH = 'L26RoJ.700~V9FM_4o-:9GM|%MRj';

// Default thumbhash - a similar neutral placeholder (generated from same concept)
// This is a simple gray/purple gradient thumbhash
export const DEFAULT_THUMBHASH = 'mxgOFwJ4iYePiHh6d3eIh3d5OA4G5GAC';

export interface PlaceholderData {
  blurhash?: string;
  thumbhash?: string;
  dimensions?: { width: number; height: number };
  url?: string;
}

export interface GeneratedPlaceholder {
  blurhash?: string;
  thumbhash?: string;
  dimensions: { width: number; height: number };
}

@Injectable({
  providedIn: 'root',
})
export class ImagePlaceholderService {
  private settings = inject(SettingsService);
  private logger = inject(LoggerService);

  // Cache for decoded placeholder data URLs to avoid regenerating
  private placeholderCache = new Map<string, string>();
  private maxCacheSize = 500;

  // Default data URLs (generated once and reused)
  private defaultBlurhashDataUrl: string | null = null;
  private defaultThumbhashDataUrl: string | null = null;

  /**
   * Get the current preferred placeholder algorithm from settings
   */
  getPreferredAlgorithm(): PlaceholderAlgorithm {
    return this.settings.settings().placeholderAlgorithm || 'blurhash';
  }

  /**
   * Extract placeholder data from an imeta tag
   * Returns blurhash, thumbhash, dimensions, and url if available
   */
  extractPlaceholderFromImeta(imetaTag: string[]): PlaceholderData {
    const result: PlaceholderData = {};

    for (let i = 1; i < imetaTag.length; i++) {
      const part = imetaTag[i];
      if (!part) continue;

      const spaceIndex = part.indexOf(' ');
      if (spaceIndex > 0) {
        const key = part.substring(0, spaceIndex);
        const value = part.substring(spaceIndex + 1);

        if (key === 'blurhash') {
          result.blurhash = value;
        } else if (key === 'thumbhash') {
          result.thumbhash = value;
        } else if (key === 'dim') {
          // Parse dimensions in format "WIDTHxHEIGHT"
          const dimParts = value.split('x');
          if (dimParts.length === 2) {
            const width = parseInt(dimParts[0], 10);
            const height = parseInt(dimParts[1], 10);
            if (!isNaN(width) && !isNaN(height)) {
              result.dimensions = { width, height };
            }
          }
        } else if (key === 'url') {
          result.url = value;
        }
      }
    }

    return result;
  }

  /**
   * Extract placeholder data from event tags
   * Supports both 'blurhash' and 'thumbhash' standalone tags
   */
  extractPlaceholderFromTags(tags: string[][]): PlaceholderData {
    const result: PlaceholderData = {};

    for (const tag of tags) {
      if (tag[0] === 'blurhash' && tag[1]) {
        result.blurhash = tag[1];
      } else if (tag[0] === 'thumbhash' && tag[1]) {
        result.thumbhash = tag[1];
      }
    }

    return result;
  }

  /**
   * Get the best placeholder hash based on user preference
   * If user prefers thumbhash but only blurhash is available (or vice versa), use what's available
   * If 'both' is selected, prefer thumbhash if available
   */
  getBestPlaceholder(data: PlaceholderData): string | null {
    const algorithm = this.getPreferredAlgorithm();

    if (algorithm === 'thumbhash') {
      // Prefer thumbhash, fallback to blurhash
      return data.thumbhash || data.blurhash || null;
    } else if (algorithm === 'blurhash') {
      // Prefer blurhash, fallback to thumbhash
      return data.blurhash || data.thumbhash || null;
    } else {
      // 'both' - prefer thumbhash (newer/better quality) when available
      return data.thumbhash || data.blurhash || null;
    }
  }

  /**
   * Check if a placeholder string is a thumbhash (base64) vs blurhash
   * Thumbhash uses standard base64, while blurhash uses a custom encoding
   */
  isThumbhash(placeholder: string): boolean {
    // Thumbhash is base64 encoded and typically 28 characters
    // Blurhash starts with specific characters and uses different encoding
    // Thumbhash base64 typically contains +, /, = or A-Za-z0-9
    // Blurhash uses 0-9, A-Z, a-z, #, $, %, *, +, ,, -, ., :, ;, =, ?, @, [, ], ^, _, {, |, }, ~

    // A simple heuristic: thumbhash is shorter and looks like base64
    // Blurhash typically starts with L, U, V, W or similar
    if (!placeholder || placeholder.length === 0) {
      return false;
    }

    // Thumbhash is typically around 25-30 characters and uses standard base64
    // Blurhash is typically 4+ characters and starts with specific size info
    // The first character of blurhash encodes size (0-9 in base83 -> '0'-'9', 'A'-'H')
    // while thumbhash starts with any base64 character

    // Best heuristic: try to detect base83 special chars that blurhash uses
    const blurhashSpecialChars = /[#$%*,.:;?@[\]^{|}~]/;
    if (blurhashSpecialChars.test(placeholder)) {
      return false; // It's blurhash
    }

    // Check if it looks like valid base64 (used by thumbhash)
    const base64Regex = /^[A-Za-z0-9+/=]+$/;
    if (base64Regex.test(placeholder)) {
      return true; // It's thumbhash
    }

    // Default to blurhash
    return false;
  }

  /**
   * Generate a placeholder data URL from either blurhash or thumbhash
   * Automatically detects which format is being used
   */
  generatePlaceholderDataUrl(
    placeholder: string,
    width = 400,
    height = 400
  ): string {
    if (!placeholder) {
      return this.getDefaultPlaceholderDataUrl(width, height);
    }

    // Check cache first
    const cacheKey = `${placeholder}-${width}-${height}`;
    const cached = this.placeholderCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      let dataUrl: string;

      if (this.isThumbhash(placeholder)) {
        dataUrl = this.decodeThumbhash(placeholder);
      } else {
        dataUrl = this.decodeBlurhash(placeholder, width, height);
      }

      // Cache the result
      this.addToCache(cacheKey, dataUrl);
      return dataUrl;
    } catch (error) {
      this.logger.warn('Failed to decode placeholder:', error);
      return this.getDefaultPlaceholderDataUrl(width, height);
    }
  }

  /**
   * Decode a blurhash string to a data URL (with caching)
   */
  decodeBlurhash(blurhash: string, width = 400, height = 400): string {
    if (!blurhash) return '';

    // Check cache first
    const cacheKey = `blurhash-${blurhash}-${width}-${height}`;
    const cached = this.placeholderCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const pixels = decode(blurhash, width, height);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';

      const imageData = ctx.createImageData(width, height);
      imageData.data.set(pixels);
      ctx.putImageData(imageData, 0, 0);

      const dataUrl = canvas.toDataURL();
      this.addToCache(cacheKey, dataUrl);
      return dataUrl;
    } catch (error) {
      this.logger.warn('Failed to decode blurhash:', error);
      return '';
    }
  }

  /**
   * Decode a thumbhash string to a data URL (with caching)
   * Thumbhash is base64 encoded
   */
  decodeThumbhash(thumbhash: string): string {
    if (!thumbhash) return '';

    // Check cache first
    const cacheKey = `thumbhash-${thumbhash}`;
    const cached = this.placeholderCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Convert base64 to Uint8Array
      const binaryString = atob(thumbhash);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Use thumbhash library to generate data URL
      const dataUrl = thumbHashToDataURL(bytes);
      this.addToCache(cacheKey, dataUrl);
      return dataUrl;
    } catch (error) {
      this.logger.warn('Failed to decode thumbhash:', error);
      return '';
    }
  }

  /**
   * Generate a blurhash from an image
   */
  async generateBlurhash(
    source: string | File,
    componentX = 6,
    componentY = 4
  ): Promise<{ blurhash: string; dimensions: { width: number; height: number } }> {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    let imageUrl: string;
    let shouldRevokeUrl = false;

    if (source instanceof File) {
      imageUrl = URL.createObjectURL(source);
      shouldRevokeUrl = true;
    } else {
      imageUrl = source;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = imageUrl;
      });

      const dimensions = { width: img.width, height: img.height };

      const canvas = document.createElement('canvas');
      const width = 64;
      const height = Math.floor((img.height / img.width) * width);

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }

      ctx.drawImage(img, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);

      const blurhash = encode(imageData.data, width, height, componentX, componentY);

      return { blurhash, dimensions };
    } finally {
      if (shouldRevokeUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    }
  }

  /**
   * Generate a thumbhash from an image
   */
  async generateThumbhash(
    source: string | File
  ): Promise<{ thumbhash: string; dimensions: { width: number; height: number } }> {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    let imageUrl: string;
    let shouldRevokeUrl = false;

    if (source instanceof File) {
      imageUrl = URL.createObjectURL(source);
      shouldRevokeUrl = true;
    } else {
      imageUrl = source;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = imageUrl;
      });

      const dimensions = { width: img.width, height: img.height };

      // Thumbhash works best with images around 100x100 pixels
      const canvas = document.createElement('canvas');
      const maxSize = 100;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxSize) {
          height = Math.floor((height / width) * maxSize);
          width = maxSize;
        }
      } else {
        if (height > maxSize) {
          width = Math.floor((width / height) * maxSize);
          height = maxSize;
        }
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }

      ctx.drawImage(img, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);

      // Convert to thumbhash
      const thumbhashBytes = rgbaToThumbHash(width, height, imageData.data);

      // Convert to base64
      const thumbhash = btoa(String.fromCharCode(...thumbhashBytes));

      return { thumbhash, dimensions };
    } finally {
      if (shouldRevokeUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    }
  }

  /**
   * Generate both blurhash and thumbhash from an image
   */
  async generatePlaceholders(
    source: string | File
  ): Promise<GeneratedPlaceholder> {
    const algorithm = this.getPreferredAlgorithm();

    const result: GeneratedPlaceholder = {
      dimensions: { width: 0, height: 0 },
    };

    try {
      if (algorithm === 'blurhash') {
        const blurhashResult = await this.generateBlurhash(source);
        result.blurhash = blurhashResult.blurhash;
        result.dimensions = blurhashResult.dimensions;
      } else if (algorithm === 'thumbhash') {
        const thumbhashResult = await this.generateThumbhash(source);
        result.thumbhash = thumbhashResult.thumbhash;
        result.dimensions = thumbhashResult.dimensions;
      } else {
        // 'both' - generate both
        const [blurhashResult, thumbhashResult] = await Promise.all([
          this.generateBlurhash(source),
          this.generateThumbhash(source),
        ]);
        result.blurhash = blurhashResult.blurhash;
        result.thumbhash = thumbhashResult.thumbhash;
        result.dimensions = blurhashResult.dimensions;
      }
    } catch (error) {
      this.logger.error('Failed to generate placeholders:', error);
    }

    return result;
  }

  /**
   * Get default placeholder data URL based on preferred algorithm
   */
  getDefaultPlaceholderDataUrl(width = 400, height = 400): string {
    const algorithm = this.getPreferredAlgorithm();

    if (algorithm === 'thumbhash') {
      if (!this.defaultThumbhashDataUrl) {
        try {
          this.defaultThumbhashDataUrl = this.decodeThumbhash(DEFAULT_THUMBHASH);
        } catch {
          // Fallback to blurhash if thumbhash decode fails
          this.defaultThumbhashDataUrl = this.decodeBlurhash(DEFAULT_BLURHASH, width, height);
        }
      }
      return this.defaultThumbhashDataUrl || '';
    }

    // Default to blurhash
    if (!this.defaultBlurhashDataUrl) {
      this.defaultBlurhashDataUrl = this.decodeBlurhash(DEFAULT_BLURHASH, width, height);
    }
    return this.defaultBlurhashDataUrl || '';
  }

  /**
   * Get placeholder from event for a specific image index
   * Checks both imeta tags and standalone tags
   */
  getPlaceholderFromEvent(
    event: { kind?: number; tags: string[][] },
    imageIndex = 0
  ): PlaceholderData {
    // For kind 20 (photos) and kind 21/22/34235/34236 (videos), check imeta tags first
    const imetaTags = event.tags.filter(tag => tag[0] === 'imeta');
    const targetImeta = imetaTags[imageIndex];

    if (targetImeta) {
      return this.extractPlaceholderFromImeta(targetImeta);
    }

    // Fallback to standalone tags
    return this.extractPlaceholderFromTags(event.tags);
  }

  /**
   * Generate placeholder data URL from event
   */
  getPlaceholderDataUrlFromEvent(
    event: { kind?: number; tags: string[][] },
    imageIndex = 0,
    width = 400,
    height = 400
  ): string {
    const data = this.getPlaceholderFromEvent(event, imageIndex);
    const best = this.getBestPlaceholder(data);

    if (best) {
      return this.generatePlaceholderDataUrl(best, width, height);
    }

    return this.getDefaultPlaceholderDataUrl(width, height);
  }

  /**
   * Get all media info from an event for a specific image index
   * Returns placeholder data URL and dimensions for progressive loading
   */
  getMediaInfoFromEvent(
    event: { kind?: number; tags: string[][] },
    imageIndex = 0
  ): { placeholderDataUrl: string; dimensions?: { width: number; height: number }; url?: string } {
    const data = this.getPlaceholderFromEvent(event, imageIndex);
    const best = this.getBestPlaceholder(data);

    // Use dimensions from imeta if available, falling back to a reasonable aspect ratio
    let width = data.dimensions?.width || 400;
    let height = data.dimensions?.height || 400;

    // Limit the placeholder generation size for performance
    // but preserve aspect ratio
    const maxPlaceholderSize = 400;
    if (width > maxPlaceholderSize || height > maxPlaceholderSize) {
      const ratio = Math.min(maxPlaceholderSize / width, maxPlaceholderSize / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    const placeholderDataUrl = best
      ? this.generatePlaceholderDataUrl(best, width, height)
      : this.getDefaultPlaceholderDataUrl(width, height);

    return {
      placeholderDataUrl,
      dimensions: data.dimensions,
      url: data.url,
    };
  }

  /**
   * Get all media items from an event with their placeholder and dimension data
   * Used for photo events with multiple images
   */
  getAllMediaFromEvent(event: { kind?: number; tags: string[][] }): PlaceholderData[] {
    const imetaTags = event.tags.filter(tag => tag[0] === 'imeta');

    if (imetaTags.length > 0) {
      return imetaTags.map(tag => this.extractPlaceholderFromImeta(tag));
    }

    // Fallback to standalone tags (single item)
    const fallback = this.extractPlaceholderFromTags(event.tags);
    return fallback.blurhash || fallback.thumbhash ? [fallback] : [];
  }

  /**
   * Calculate aspect ratio CSS value from dimensions
   * Returns a string like "16 / 9" for use in CSS aspect-ratio property
   */
  getAspectRatioStyle(dimensions?: { width: number; height: number }): string | null {
    if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
      return null;
    }
    return `${dimensions.width} / ${dimensions.height}`;
  }

  /**
   * Build placeholder tags for an imeta tag
   * Returns array of strings like ["blurhash xyz", "thumbhash abc"]
   */
  buildPlaceholderImetaParts(placeholder: GeneratedPlaceholder): string[] {
    const parts: string[] = [];

    if (placeholder.blurhash) {
      parts.push(`blurhash ${placeholder.blurhash}`);
    }
    if (placeholder.thumbhash) {
      parts.push(`thumbhash ${placeholder.thumbhash}`);
    }

    return parts;
  }

  /**
   * Add to cache with LRU eviction
   */
  private addToCache(key: string, value: string): void {
    // Simple LRU: if cache is full, delete oldest entries
    if (this.placeholderCache.size >= this.maxCacheSize) {
      const firstKey = this.placeholderCache.keys().next().value;
      if (firstKey) {
        this.placeholderCache.delete(firstKey);
      }
    }
    this.placeholderCache.set(key, value);
  }

  /**
   * Clear the placeholder cache
   */
  clearCache(): void {
    this.placeholderCache.clear();
    this.defaultBlurhashDataUrl = null;
    this.defaultThumbhashDataUrl = null;
  }
}
