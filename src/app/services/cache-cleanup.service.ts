import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { DatabaseService } from './database.service';
import { LoggerService } from './logger.service';

/**
 * Service responsible for periodic cleanup of cached feed events
 * 
 * This service runs a background cleanup process every 5 minutes to prevent
 * the events-cache table from growing unbounded. It ensures that each feed
 * column maintains approximately 200 cached events.
 * 
 * The cleanup process:
 * - Starts 5 minutes after app initialization
 * - Runs every 5 minutes thereafter
 * - Removes old events beyond the 200-event limit per column
 * - Operates across all accounts
 */
@Injectable({
  providedIn: 'root',
})
export class CacheCleanupService {
  private readonly database = inject(DatabaseService);
  private readonly logger = inject(LoggerService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  // Cleanup configuration
  private readonly INITIAL_DELAY_MS = 5 * 60 * 1000; // 5 minutes
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  // Signals for monitoring
  readonly isRunning = signal(false);
  readonly lastCleanup = signal<number | null>(null);
  readonly nextCleanup = signal<number | null>(null);
  readonly totalCleanupsPerformed = signal(0);

  private cleanupIntervalId: number | null = null;
  private initialTimeoutId: number | null = null;

  /**
   * Start the cleanup service
   * This should be called once during app initialization
   */
  start(): void {
    // Skip on server - only run in browser
    if (!this.isBrowser) {
      this.logger.debug('CacheCleanupService skipped - not in browser environment');
      return;
    }

    if (this.isRunning()) {
      this.logger.warn('CacheCleanupService is already running');
      return;
    }

    this.logger.info('Starting CacheCleanupService');
    this.isRunning.set(true);

    // Calculate next cleanup time
    const nextCleanupTime = Date.now() + this.INITIAL_DELAY_MS;
    this.nextCleanup.set(nextCleanupTime);

    // Schedule the first cleanup after initial delay
    this.initialTimeoutId = setTimeout(() => {
      this.performCleanup();

      // After the first cleanup, schedule periodic cleanups
      this.cleanupIntervalId = setInterval(() => {
        this.performCleanup();
      }, this.CLEANUP_INTERVAL_MS) as unknown as number;
    }, this.INITIAL_DELAY_MS) as unknown as number;

    this.logger.info(
      `CacheCleanupService scheduled to start in ${this.INITIAL_DELAY_MS / 1000} seconds`
    );
  }

  /**
   * Stop the cleanup service
   * This is useful for testing or during app shutdown
   */
  stop(): void {
    if (!this.isRunning()) {
      return;
    }

    this.logger.info('Stopping CacheCleanupService');

    if (this.initialTimeoutId !== null) {
      clearTimeout(this.initialTimeoutId);
      this.initialTimeoutId = null;
    }

    if (this.cleanupIntervalId !== null) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }

    this.isRunning.set(false);
    this.nextCleanup.set(null);

    this.logger.info('CacheCleanupService stopped');
  }

  /**
   * Perform the cleanup operation
   */
  private async performCleanup(): Promise<void> {
    try {
      this.logger.info('🧹 Running scheduled cache cleanup');

      const startTime = Date.now();

      // Get stats before cleanup
      const statsBefore = await this.database.getCachedEventsStats();
      this.logger.debug('Cache stats before cleanup:', {
        totalEvents: statsBefore.totalEvents,
        accounts: statsBefore.eventsByAccount.size,
        columns: statsBefore.eventsByColumn.size,
      });

      // Perform the cleanup
      await this.database.cleanupCachedEvents();

      // Get stats after cleanup
      const statsAfter = await this.database.getCachedEventsStats();
      const eventsRemoved = statsBefore.totalEvents - statsAfter.totalEvents;

      const duration = Date.now() - startTime;

      this.logger.info('✅ Cache cleanup completed', {
        duration: `${duration}ms`,
        eventsRemoved,
        remainingEvents: statsAfter.totalEvents,
      });

      // Update signals
      this.lastCleanup.set(Date.now());
      this.totalCleanupsPerformed.update(count => count + 1);

      // Calculate next cleanup time
      const nextCleanupTime = Date.now() + this.CLEANUP_INTERVAL_MS;
      this.nextCleanup.set(nextCleanupTime);
    } catch (error) {
      this.logger.error('Error performing cache cleanup:', error);
    }
  }

  /**
   * Manually trigger a cleanup (useful for testing or manual operations)
   */
  async triggerCleanup(): Promise<void> {
    this.logger.info('Manual cache cleanup triggered');
    await this.performCleanup();
  }

  /**
   * Get the status of the cleanup service
   */
  getStatus(): {
    isRunning: boolean;
    lastCleanup: number | null;
    nextCleanup: number | null;
    totalCleanupsPerformed: number;
  } {
    return {
      isRunning: this.isRunning(),
      lastCleanup: this.lastCleanup(),
      nextCleanup: this.nextCleanup(),
      totalCleanupsPerformed: this.totalCleanupsPerformed(),
    };
  }
}
