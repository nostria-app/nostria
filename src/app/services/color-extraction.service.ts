import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LoggerService } from './logger.service';
import { ThemeService } from './theme.service';

export interface ExtractedColors {
  /** A muted, theme-appropriate background color */
  background: string;
  /** A slightly lighter/darker variant for gradient use */
  backgroundEnd: string;
  /** The dominant hue of the image (0-360) */
  hue: number;
  /** The dominant saturation (0-100) */
  saturation: number;
}

@Injectable({
  providedIn: 'root',
})
export class ColorExtractionService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly logger = inject(LoggerService);
  private readonly theme = inject(ThemeService);
  private readonly cache = new Map<string, ExtractedColors>();

  /**
   * Extract a dominant color from an image URL and return theme-appropriate
   * background colors. In light mode, returns a light tint; in dark mode,
   * returns a deep shade.
   *
   * Uses a small canvas sample for performance.
   */
  async extractColors(imageUrl: string): Promise<ExtractedColors | null> {
    if (!this.isBrowser) return null;

    const cacheKey = `${imageUrl}:${this.theme.darkMode() ? 'dark' : 'light'}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    try {
      const img = await this.loadImage(imageUrl);
      const rgb = this.sampleDominantColor(img);
      const hsl = this.rgbToHsl(rgb.r, rgb.g, rgb.b);

      const isDark = this.theme.darkMode();
      const colors = this.buildThemeColors(hsl, isDark);

      this.cache.set(cacheKey, colors);

      // Evict old entries if cache grows too large
      if (this.cache.size > 100) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) this.cache.delete(firstKey);
      }

      return colors;
    } catch (err) {
      this.logger.warn('[ColorExtraction] Failed to extract colors:', err);
      return null;
    }
  }

  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
  }

  /**
   * Sample the image at a low resolution and find the most vibrant/dominant color.
   * We use a 16x16 grid and pick the color with the highest saturation that
   * isn't too dark or too light (i.e. a "meaningful" color from the artwork).
   */
  private sampleDominantColor(img: HTMLImageElement): { r: number; g: number; b: number } {
    const canvas = document.createElement('canvas');
    const size = 16;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { r: 128, g: 128, b: 128 };

    ctx.drawImage(img, 0, 0, size, size);
    const imageData = ctx.getImageData(0, 0, size, size);
    const data = imageData.data;

    // Bucket colors by hue (12 buckets of 30 degrees each)
    const buckets: { totalR: number; totalG: number; totalB: number; count: number; satSum: number }[] = [];
    for (let i = 0; i < 12; i++) {
      buckets.push({ totalR: 0, totalG: 0, totalB: 0, count: 0, satSum: 0 });
    }

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < 128) continue; // Skip transparent pixels

      const hsl = this.rgbToHsl(r, g, b);

      // Skip very dark or very light pixels (not meaningful)
      if (hsl.l < 10 || hsl.l > 90) continue;
      // Skip very desaturated pixels
      if (hsl.s < 8) continue;

      const bucketIndex = Math.min(11, Math.floor(hsl.h / 30));
      buckets[bucketIndex].totalR += r;
      buckets[bucketIndex].totalG += g;
      buckets[bucketIndex].totalB += b;
      buckets[bucketIndex].count++;
      buckets[bucketIndex].satSum += hsl.s;
    }

    // Find the bucket with the best combination of count and saturation
    let bestBucket = -1;
    let bestScore = -1;

    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (b.count === 0) continue;
      // Score: weighted by pixel count and average saturation
      const avgSat = b.satSum / b.count;
      const score = b.count * (avgSat / 100);
      if (score > bestScore) {
        bestScore = score;
        bestBucket = i;
      }
    }

    if (bestBucket === -1) {
      // Fallback: use average of all pixels
      let totalR = 0, totalG = 0, totalB = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        totalR += data[i];
        totalG += data[i + 1];
        totalB += data[i + 2];
        count++;
      }
      if (count === 0) return { r: 128, g: 128, b: 128 };
      return {
        r: Math.round(totalR / count),
        g: Math.round(totalG / count),
        b: Math.round(totalB / count),
      };
    }

    const winner = buckets[bestBucket];
    return {
      r: Math.round(winner.totalR / winner.count),
      g: Math.round(winner.totalG / winner.count),
      b: Math.round(winner.totalB / winner.count),
    };
  }

  private rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }

    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      l: Math.round(l * 100),
    };
  }

  /**
   * Build background colors appropriate for the current theme.
   * Light mode: high lightness (85-92%), moderate saturation
   * Dark mode: low lightness (12-20%), moderate saturation
   */
  private buildThemeColors(hsl: { h: number; s: number; l: number }, isDark: boolean): ExtractedColors {
    const hue = hsl.h;
    // Clamp saturation to a reasonable range for backgrounds
    const sat = Math.min(hsl.s, 50);

    if (isDark) {
      return {
        background: `hsl(${hue}, ${sat}%, 14%)`,
        backgroundEnd: `hsl(${hue}, ${Math.max(sat - 10, 5)}%, 8%)`,
        hue,
        saturation: sat,
      };
    } else {
      return {
        background: `hsl(${hue}, ${sat}%, 90%)`,
        backgroundEnd: `hsl(${hue}, ${Math.max(sat - 10, 5)}%, 96%)`,
        hue,
        saturation: sat,
      };
    }
  }
}
