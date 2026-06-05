import { inject, PLATFORM_ID, Service } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { convertFileSrc, isTauri } from '@tauri-apps/api/core';

/**
 * Rewrites inline feed image URLs to a native thumbnailing URI scheme when running inside
 * the Tauri desktop/mobile app.
 *
 * WebKit (webkit2gtk on Linux) keeps the decoded bitmap of every on-screen image in memory.
 * Full-resolution feed photos therefore dominate the native app's memory footprint. Inside
 * Tauri we route inline images through the `thumbimg://` protocol (handled in Rust), which
 * downloads, EXIF-orients, downscales, caches, and re-encodes them so WebKit only retains a
 * small bitmap. The full-resolution original is still used by the image viewer dialog.
 *
 * On the web (and SSR) this is a no-op: the original URL is returned unchanged, so the hosted
 * image proxy is never involved for feed thumbnails.
 */
@Service()
export class TauriImageService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  /** Whether native thumbnailing is available (browser context running inside Tauri). */
  private readonly enabled = this.isBrowser && isTauri();

  /**
   * Returns a URL suitable for inline (in-feed) display of an image.
   *
   * In Tauri this is a `thumbimg://` URL bounded to `maxWidth`. Everywhere else (and for URLs
   * that should not be thumbnailed, such as data/blob URLs, GIFs and SVGs) the original URL is
   * returned unchanged.
   */
  getInlineImageUrl(originalUrl: string, maxWidth = 1080): string {
    if (!this.enabled || !originalUrl) {
      return originalUrl;
    }

    // Only http(s) sources can be fetched and thumbnailed by the native handler.
    if (!(originalUrl.startsWith('http://') || originalUrl.startsWith('https://'))) {
      return originalUrl;
    }

    // Preserve animation / vector formats by serving them untouched.
    if (/\.(gif|svg)(\?|#|$)/i.test(originalUrl)) {
      return originalUrl;
    }

    try {
      const encoded = this.base64UrlEncode(originalUrl);
      const base = convertFileSrc(encoded, 'thumbimg');
      return `${base}?w=${Math.round(maxWidth)}`;
    } catch {
      return originalUrl;
    }
  }

  /** UTF-8-safe base64url encoding (no padding), matching the Rust handler's decoder. */
  private base64UrlEncode(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
}
