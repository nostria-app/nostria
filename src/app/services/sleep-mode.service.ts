import { Injectable, inject, signal, PLATFORM_ID, OnDestroy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LoggerService } from './logger.service';
import { PoolService } from './relays/pool.service';
import { RelaysService } from './relays/relays';

export interface SleepModeState {
  isActive: boolean;
  reason: 'visibility' | 'manual' | null;
  activatedAt: number;
  showWakeupOverlay: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class SleepModeService implements OnDestroy {
  private readonly logger = inject(LoggerService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly poolService = inject(PoolService);
  private readonly relaysService = inject(RelaysService);

  // Sleep mode configuration
  private readonly SLEEP_DETECTION_ENABLED = false; // Hard-coded flag to enable/disable sleep detection
  private readonly SLEEP_DELAY_MS = 1 * 30 * 1000; // 2 minutes
  // private readonly SLEEP_DELAY_MS = 1 * 60 * 1000; // 2 minutes
  private readonly STORAGE_KEY = 'nostria-sleep-mode';

  // State signals
  readonly state = signal<SleepModeState>({
    isActive: false,
    reason: null,
    activatedAt: 0,
    showWakeupOverlay: false,
  });

  readonly isActive = signal(false);
  readonly showWakeupOverlay = signal(false);

  // Signal for formatted duration that updates every second when active
  readonly formattedDuration = signal('0s');

  // Private state
  private isHidden = false;
  private hiddenAt = 0;
  private sleepTimer: number | null = null;
  private durationUpdateTimer: number | null = null;
  private visibilityEventListener: (() => void) | null = null;

  constructor() {
    if (isPlatformBrowser(this.platformId) && this.SLEEP_DETECTION_ENABLED) {
      this.initializeVisibilityListener();
      this.loadSleepModeState();
    }
  }

  /**
   * Initialize the visibility change listener
   */
  private initializeVisibilityListener(): void {
    this.visibilityEventListener = () => {
      this.handleVisibilityChange();
    };

    document.addEventListener('visibilitychange', this.visibilityEventListener);
    this.logger.debug('[SleepMode] Visibility change listener initialized');
  }

  /**
   * Handle document visibility changes
   */
  private handleVisibilityChange(): void {
    if (document.hidden) {
      this.onHidden();
    } else {
      this.onVisible();
    }
  }

  /**
   * Called when the document becomes hidden
   */
  private onHidden(): void {
    this.isHidden = true;
    this.hiddenAt = Date.now();

    this.logger.debug('[SleepMode] App hidden, starting sleep timer');

    // Clear any existing timer
    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer);
    }

    // Set timer to activate sleep mode after delay
    this.sleepTimer = window.setTimeout(() => {
      this.activateSleepMode('visibility');
    }, this.SLEEP_DELAY_MS);
  }

  /**
   * Called when the document becomes visible
   */
  private onVisible(): void {
    this.isHidden = false;

    // Clear the sleep timer if app becomes visible before timer expires
    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
      this.logger.debug('[SleepMode] App visible, cancelled sleep timer');
    }

    // If sleep mode was active, show wakeup overlay
    if (this.isActive()) {
      this.showWakeupOverlay.set(true);
      this.logger.debug('[SleepMode] App visible while in sleep mode, showing wakeup overlay');
    }
  }

  /**
   * Activate sleep mode and disconnect WebSocket connections
   */
  private activateSleepMode(reason: 'visibility' | 'manual'): void {
    if (this.isActive()) {
      this.logger.debug('[SleepMode] Sleep mode already active');
      return;
    }

    const activatedAt = Date.now();

    this.logger.info('[SleepMode] Activating sleep mode due to:', reason);

    try {
      // Disconnect all relay pools
      this.disconnectRelayPools();

      // Update state
      this.state.set({
        isActive: true,
        reason,
        activatedAt,
        showWakeupOverlay: false,
      });

      this.isActive.set(true);
      this.saveSleepModeState();

      // Start updating the formatted duration every second
      this.startDurationUpdates();

      this.logger.info('[SleepMode] Sleep mode activated successfully');
    } catch (error) {
      this.logger.error('[SleepMode] Error activating sleep mode:', error);
    }
  }

  /**
   * Disconnect all WebSocket connections from relay pools
   */
  private disconnectRelayPools(): void {
    try {
      this.logger.debug('[SleepMode] Disconnecting relay pools...');

      // Close all known relay connections through the single shared pool.
      // With enableReconnect:true they will re-open automatically on the next request.
      const allRelayUrls = Array.from(this.relaysService.getAllRelayStats().keys());
      this.poolService.closeAll(allRelayUrls);

      this.logger.info('[SleepMode] All relay connections closed');
    } catch (error) {
      this.logger.error('[SleepMode] Error disconnecting relay pools:', error);
    }
  }

  /**
   * Wake up from sleep mode and reconnect
   */
  wakeUp(): void {
    if (!this.isActive()) {
      this.logger.debug('[SleepMode] Not in sleep mode, nothing to wake up from');
      return;
    }

    this.logger.info('[SleepMode] Waking up from sleep mode');

    try {
      // Reconnect relay pools by reinitializing them
      this.reconnectRelayPools();

      // Update state
      this.state.set({
        isActive: false,
        reason: null,
        activatedAt: 0,
        showWakeupOverlay: false,
      });

      this.isActive.set(false);
      this.showWakeupOverlay.set(false);
      this.saveSleepModeState();

      // Stop updating the formatted duration
      this.stopDurationUpdates();

      this.logger.info('[SleepMode] Successfully woken up from sleep mode');
    } catch (error) {
      this.logger.error('[SleepMode] Error waking up from sleep mode:', error);
    }
  }

  /**
   * Reconnect relay pools by reinitializing them
   */
  private reconnectRelayPools(): void {
    // No explicit action needed: the shared pool has enableReconnect:true, so
    // connections are re-established automatically when the next query or
    // subscription is made.
    this.logger.debug('[SleepMode] Relay pools will reconnect on next request (enableReconnect:true)');
  }

  /**
   * Manually activate sleep mode
   */
  activateManually(): void {
    if (!this.SLEEP_DETECTION_ENABLED) {
      this.logger.debug('[SleepMode] Sleep detection is disabled, ignoring manual activation');
      return;
    }
    this.activateSleepMode('manual');
  }

  /**
   * Hide the wakeup overlay
   */
  hideWakeupOverlay(): void {
    this.showWakeupOverlay.set(false);
    this.state.update(state => ({ ...state, showWakeupOverlay: false }));
  }

  /**
   * Check if sleep detection is enabled
   */
  isSleepDetectionEnabled(): boolean {
    return this.SLEEP_DETECTION_ENABLED;
  }

  /**
   * Start updating the formatted duration every second
   */
  private startDurationUpdates(): void {
    // Update immediately
    this.updateFormattedDuration();

    // Then update every second
    this.durationUpdateTimer = window.setInterval(() => {
      this.updateFormattedDuration();
    }, 1000);
  }

  /**
   * Stop updating the formatted duration
   */
  private stopDurationUpdates(): void {
    if (this.durationUpdateTimer) {
      clearInterval(this.durationUpdateTimer);
      this.durationUpdateTimer = null;
    }
    // Reset to initial value
    this.formattedDuration.set('0s');
  }

  /**
   * Update the formatted duration signal
   */
  private updateFormattedDuration(): void {
    const duration = this.getSleepDuration();
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);

    const formatted = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    this.formattedDuration.set(formatted);
  }

  /**
   * Get the duration the app has been in sleep mode (in milliseconds)
   */
  getSleepDuration(): number {
    const currentState = this.state();
    if (!currentState.isActive) {
      return 0;
    }
    return Date.now() - currentState.activatedAt;
  }

  /**
   * Get formatted sleep duration string
   */
  getFormattedSleepDuration(): string {
    const duration = this.getSleepDuration();
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  }

  /**
   * Save sleep mode state to localStorage
   */
  private saveSleepModeState(): void {
    try {
      const state = this.state();
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      this.logger.error('[SleepMode] Error saving sleep mode state:', error);
    }
  }

  /**
   * Load sleep mode state from localStorage
   */
  private loadSleepModeState(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const state: SleepModeState = JSON.parse(stored);

        // If we were in sleep mode when the app was closed, restore that state
        if (state.isActive) {
          this.state.set(state);
          this.isActive.set(true);
          this.startDurationUpdates(); // Start duration updates for restored sleep mode
          this.logger.debug('[SleepMode] Restored sleep mode state from storage');
        }
      }
    } catch (error) {
      this.logger.error('[SleepMode] Error loading sleep mode state:', error);
    }
  }

  /**
   * Cleanup when the service is destroyed
   */
  ngOnDestroy(): void {
    if (this.visibilityEventListener) {
      document.removeEventListener('visibilitychange', this.visibilityEventListener);
    }

    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer);
    }

    if (this.durationUpdateTimer) {
      clearInterval(this.durationUpdateTimer);
    }
  }
}
