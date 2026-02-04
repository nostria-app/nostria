import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatSnackBar } from '@angular/material/snack-bar';
import * as htmlToImage from 'html-to-image';

@Injectable({
  providedIn: 'root'
})
export class EventImageService {
  private platformId = inject(PLATFORM_ID);
  private snackBar = inject(MatSnackBar);

  private isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  /**
   * Capture a DOM element as a PNG blob
   */
  async captureElementAsImage(element: HTMLElement, options?: {
    backgroundColor?: string;
    pixelRatio?: number;
    quality?: number;
  }): Promise<Blob | null> {
    if (!this.isBrowser()) {
      return null;
    }

    try {
      const blob = await htmlToImage.toBlob(element, {
        backgroundColor: options?.backgroundColor,
        pixelRatio: options?.pixelRatio ?? 2, // Higher resolution for better quality
        quality: options?.quality ?? 1,
        cacheBust: true,
        // Skip fetching external fonts that may have CORS issues
        skipFonts: true,
        // Include inline styles to capture computed styles
        includeQueryParams: true,
        // Filter out any elements we don't want in the screenshot
        filter: (node: HTMLElement) => {
          // Skip elements with data-exclude-from-screenshot attribute
          if (node.dataset?.['excludeFromScreenshot'] === 'true') {
            return false;
          }
          return true;
        },
        // Custom fetch settings to handle CORS
        fetchRequestInit: {
          mode: 'cors',
          credentials: 'omit'
        }
      });

      return blob;
    } catch (error) {
      console.error('Failed to capture element as image:', error);
      return null;
    }
  }

  /**
   * Copy an image blob to the clipboard
   * Returns true on success, false on failure
   */
  async copyImageToClipboard(blob: Blob): Promise<boolean> {
    if (!this.isBrowser()) {
      return false;
    }

    try {
      // Check if the Clipboard API supports writing images
      if (!navigator.clipboard?.write) {
        console.warn('Clipboard API write not supported');
        return await this.fallbackDownload(blob);
      }

      // Create a ClipboardItem with the image blob
      const clipboardItem = new ClipboardItem({
        'image/png': blob
      });

      await navigator.clipboard.write([clipboardItem]);
      return true;
    } catch (error) {
      console.error('Failed to copy image to clipboard:', error);
      // Try fallback for browsers that don't support clipboard image write
      return await this.fallbackDownload(blob);
    }
  }

  /**
   * Fallback: Download the image if clipboard write fails
   */
  private async fallbackDownload(blob: Blob): Promise<boolean> {
    try {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `nostria-screenshot-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      this.snackBar.open('Screenshot downloaded (clipboard not supported)', 'Dismiss', {
        duration: 3000
      });
      return true;
    } catch (error) {
      console.error('Failed to download image:', error);
      return false;
    }
  }

  /**
   * Capture an element and copy to clipboard in one operation
   */
  async captureAndCopy(element: HTMLElement, options?: {
    backgroundColor?: string;
    pixelRatio?: number;
  }): Promise<boolean> {
    const blob = await this.captureElementAsImage(element, options);

    if (!blob) {
      this.snackBar.open('Failed to capture screenshot', 'Dismiss', {
        duration: 3000
      });
      return false;
    }

    const success = await this.copyImageToClipboard(blob);

    if (success) {
      this.snackBar.open('Screenshot copied to clipboard', 'Dismiss', {
        duration: 3000
      });
    } else {
      this.snackBar.open('Failed to copy screenshot', 'Dismiss', {
        duration: 3000
      });
    }

    return success;
  }
}
