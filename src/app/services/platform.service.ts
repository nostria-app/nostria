import { Injectable, inject, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Service for detecting platform (OS) and providing platform-specific utilities
 */
@Injectable({
  providedIn: 'root',
})
export class PlatformService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  // Platform detection signals
  readonly isMac = signal(false);
  readonly isWindows = signal(false);
  readonly isLinux = signal(false);
  readonly isIOS = signal(false);
  readonly isAndroid = signal(false);

  constructor() {
    if (this.isBrowser) {
      this.detectPlatform();
    }
  }

  /**
   * Detect the current platform based on user agent
   */
  private detectPlatform(): void {
    const userAgent = navigator.userAgent.toLowerCase();

    this.isMac.set(/macintosh|mac os x/.test(userAgent) && !/iphone|ipad|ipod/.test(userAgent));
    this.isWindows.set(/windows/.test(userAgent));
    this.isLinux.set(/linux/.test(userAgent) && !/android/.test(userAgent));
    this.isIOS.set(/iphone|ipad|ipod/.test(userAgent));
    this.isAndroid.set(/android/.test(userAgent));
  }

  /**
   * Check if a keyboard event uses the correct modifier key for the platform
   * - On Mac: Cmd (Meta) key
   * - On Windows/Linux: Alt key
   * 
   * @param event - The keyboard event
   * @returns true if the correct platform modifier key is pressed
   */
  hasModifierKey(event: KeyboardEvent): boolean {
    if (this.isMac()) {
      // On Mac, use Cmd (metaKey)
      return event.metaKey && !event.ctrlKey;
    } else {
      // On Windows/Linux, use Alt
      return event.altKey && !event.metaKey;
    }
  }

  /**
   * Get the display name for the modifier key used on this platform
   * @returns The modifier key display name (e.g., "Cmd", "Alt", "⌘")
   */
  getModifierKeyDisplay(useSymbol = false): string {
    if (this.isMac()) {
      return useSymbol ? '⌘' : 'Cmd';
    } else {
      return 'Alt';
    }
  }

  /**
   * Format a keyboard shortcut for display based on platform
   * @param key - The key (e.g., "C", "S", "N")
   * @param useSymbol - Whether to use symbol (⌘) or text (Cmd) for Mac
   * @returns Formatted shortcut string (e.g., "⌘+C" or "Alt+C")
   */
  formatShortcut(key: string, useSymbol = false): string {
    const modifier = this.getModifierKeyDisplay(useSymbol);
    return `${modifier}+${key}`;
  }
}
