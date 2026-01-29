import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { isPlatformBrowser } from '@angular/common';
import { LoggerService } from './logger.service';

/**
 * Centralized service for clipboard operations.
 * Provides consistent success/error handling with snackbar notifications.
 */
@Injectable({
  providedIn: 'root',
})
export class ClipboardService {
  private snackBar = inject(MatSnackBar);
  private logger = inject(LoggerService);
  private platformId = inject(PLATFORM_ID);

  private get isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  /**
   * Copy text to clipboard with optional success/error notifications.
   * @param text The text to copy
   * @param successMessage Message to show on success (default: 'Copied to clipboard')
   * @param showNotification Whether to show snackbar notification (default: true)
   * @returns Promise<boolean> - true if successful, false otherwise
   */
  async copyText(
    text: string,
    successMessage = 'Copied to clipboard',
    showNotification = true
  ): Promise<boolean> {
    if (!this.isBrowser) {
      this.logger.warn('Clipboard API not available in SSR context');
      return false;
    }

    try {
      await navigator.clipboard.writeText(text);
      if (showNotification) {
        this.snackBar.open(successMessage, 'Dismiss', { duration: 3000 });
      }
      return true;
    } catch (error) {
      this.logger.error('Failed to copy to clipboard:', error);
      if (showNotification) {
        this.snackBar.open('Failed to copy to clipboard', 'Dismiss', { duration: 3000 });
      }
      return false;
    }
  }

  /**
   * Copy an object as formatted JSON to clipboard.
   * @param obj The object to copy
   * @param successMessage Message to show on success
   * @param showNotification Whether to show snackbar notification
   * @returns Promise<boolean> - true if successful, false otherwise
   */
  async copyJson(
    obj: unknown,
    successMessage = 'Copied JSON to clipboard',
    showNotification = true
  ): Promise<boolean> {
    const json = JSON.stringify(obj, null, 2);
    return this.copyText(json, successMessage, showNotification);
  }

  /**
   * Copy text to clipboard using the legacy execCommand method.
   * Use this as a fallback for older browsers or specific scenarios.
   * @param text The text to copy
   * @param successMessage Message to show on success
   * @param showNotification Whether to show snackbar notification
   * @returns boolean - true if successful, false otherwise
   */
  copyTextLegacy(
    text: string,
    successMessage = 'Copied to clipboard',
    showNotification = true
  ): boolean {
    if (!this.isBrowser) {
      return false;
    }

    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      textArea.style.top = '-9999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);

      if (successful && showNotification) {
        this.snackBar.open(successMessage, 'Dismiss', { duration: 3000 });
      } else if (!successful && showNotification) {
        this.snackBar.open('Failed to copy to clipboard', 'Dismiss', { duration: 3000 });
      }

      return successful;
    } catch (error) {
      this.logger.error('Failed to copy using legacy method:', error);
      if (showNotification) {
        this.snackBar.open('Failed to copy to clipboard', 'Dismiss', { duration: 3000 });
      }
      return false;
    }
  }

  /**
   * Copy a URL to clipboard with appropriate success message.
   * @param url The URL to copy
   * @param showNotification Whether to show snackbar notification
   * @returns Promise<boolean> - true if successful, false otherwise
   */
  async copyUrl(url: string, showNotification = true): Promise<boolean> {
    return this.copyText(url, 'URL copied to clipboard', showNotification);
  }

  /**
   * Copy a Nostr identifier (npub, nevent, naddr, etc.) to clipboard.
   * @param identifier The Nostr identifier to copy
   * @param type Optional type description for the success message
   * @param showNotification Whether to show snackbar notification
   * @returns Promise<boolean> - true if successful, false otherwise
   */
  async copyNostrId(
    identifier: string,
    type?: string,
    showNotification = true
  ): Promise<boolean> {
    const message = type ? `${type} copied to clipboard` : 'Copied to clipboard';
    return this.copyText(identifier, message, showNotification);
  }
}
