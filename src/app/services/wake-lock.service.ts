import { Injectable, inject, signal } from '@angular/core';
import { UtilitiesService } from './utilities.service';
import { LoggerService } from './logger.service';

/**
 * Service to manage screen wake lock to prevent the screen from dimming/locking
 * while videos are playing.
 * 
 * Uses the Screen Wake Lock API when available.
 */
@Injectable({
  providedIn: 'root',
})
export class WakeLockService {
  private utilities = inject(UtilitiesService);
  private logger = inject(LoggerService);

  private wakeLock: WakeLockSentinel | null = null;
  private isEnabled = signal(false);
  private isSupported = signal(false);

  constructor() {
    if (!this.utilities.isBrowser()) {
      return;
    }

    // Check if Wake Lock API is supported
    this.isSupported.set('wakeLock' in navigator);
    
    if (!this.isSupported()) {
      this.logger.debug('[WakeLock] Screen Wake Lock API not supported');
      return;
    }

    // Re-acquire wake lock when page becomes visible again
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.isEnabled()) {
        this.logger.debug('[WakeLock] Page became visible, re-acquiring wake lock');
        this.acquire();
      }
    });
  }

  /**
   * Enable wake lock - acquires lock to keep screen awake
   */
  async enable(): Promise<void> {
    if (!this.utilities.isBrowser() || !this.isSupported()) {
      return;
    }

    this.isEnabled.set(true);
    await this.acquire();
  }

  /**
   * Disable wake lock - releases lock and allows screen to sleep
   */
  async disable(): Promise<void> {
    if (!this.utilities.isBrowser()) {
      return;
    }

    this.isEnabled.set(false);
    await this.release();
  }

  /**
   * Internal method to acquire wake lock
   */
  private async acquire(): Promise<void> {
    if (!this.isSupported() || this.wakeLock !== null) {
      return;
    }

    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.logger.debug('[WakeLock] Wake lock acquired');

      // Listen for wake lock release
      this.wakeLock.addEventListener('release', () => {
        this.logger.debug('[WakeLock] Wake lock released');
        this.wakeLock = null;
      });
    } catch (err) {
      this.logger.error('[WakeLock] Failed to acquire wake lock:', err);
      this.wakeLock = null;
    }
  }

  /**
   * Internal method to release wake lock
   */
  private async release(): Promise<void> {
    if (this.wakeLock !== null) {
      try {
        await this.wakeLock.release();
        this.wakeLock = null;
        this.logger.debug('[WakeLock] Wake lock released manually');
      } catch (err) {
        this.logger.error('[WakeLock] Failed to release wake lock:', err);
      }
    }
  }

  /**
   * Check if wake lock is currently active
   */
  isActive(): boolean {
    return this.wakeLock !== null && !this.wakeLock.released;
  }
}
