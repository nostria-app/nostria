import { Injectable } from '@angular/core';
import { DebugLoggerService } from './debug-logger.service';

/**
 * Test service to verify the debug logger functionality
 * This can be used in development to verify that relay instances and subscriptions are being tracked properly
 */
@Injectable({
  providedIn: 'root',
})
export class DebugLoggerTestService {
  constructor(private debugLogger: DebugLoggerService) { }

  /**
   * Test method to manually trigger stats logging
   */
  logCurrentStats(): void {
    this.debugLogger.logStats();
  }

  /**
   * Get current statistics for inspection
   */
  getCurrentStats() {
    return this.debugLogger.getStats();
  }

  /**
   * Clean up old entries for testing
   */
  cleanupOldEntries(): void {
    this.debugLogger.cleanup(5000); // Clean up entries older than 5 seconds
  }

  /**
   * Stop stats logging for testing
   */
  stopStatsLogging(): void {
    this.debugLogger.stopStatsLogging();
  }

  /**
   * Get detailed information about all active relay instances
   */
  getActiveInstances() {
    const stats = this.debugLogger.getStats();
    return {
      totalInstances: stats.instances.total,
      activeInstances: stats.instances.active,
      instancesByClass: stats.instances.byClass,
      relayUrls: stats.relayUrls,
    };
  }

  /**
   * Get subscription statistics
   */
  getSubscriptionStats() {
    const stats = this.debugLogger.getStats();
    return {
      totalSubscriptions: stats.subscriptions.total,
      activeSubscriptions: stats.subscriptions.active,
      closedSubscriptions: stats.subscriptions.closed,
    };
  }
}
