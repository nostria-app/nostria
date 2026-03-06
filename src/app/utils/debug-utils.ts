/**
 * Global diagnostic utilities for debugging relay subscriptions and connections.
 * Available in browser console via window.nostriaDebug
 */

import { ApplicationRef } from '@angular/core';
import { SubscriptionManagerService } from '../services/relays/subscription-manager';
import { RelaysService } from '../services/relays/relays';
import { DataService } from '../services/data.service';

export interface NostriaDebugUtils {
  /**
   * Display detailed metrics about all relay subscriptions and connections
   */
  showRelayMetrics: () => void;

  /**
   * Get the metrics object for programmatic access
   */
  getMetrics: () => ReturnType<SubscriptionManagerService['metricsSignal']>;

  /**
   * Clean up stale subscriptions older than the specified age
   * @param maxAgeMs Maximum age in milliseconds (default: 5 minutes)
   */
  cleanupStale: (maxAgeMs?: number) => number;

  /**
   * Reset all subscription tracking (use with caution)
   */
  resetTracking: () => void;

  /**
   * Get relay statistics
   */
  getRelayStats: () => Map<string, unknown>;

  /**
   * Display help information
   */
  help: () => void;

  /**
   * Show malformed event summary and recent samples in console
   */
  showMalformedEvents: (limit?: number) => void;

  /**
   * Get malformed event inspector data
   */
  getMalformedEvents: () => ReturnType<DataService['getMalformedEventsInspector']>;

  /**
   * Reset malformed event inspector data
   */
  resetMalformedEvents: () => void;
}

/**
 * Initialize global debug utilities
 * Should be called during app initialization
 */
export function initializeDebugUtils(appRef: ApplicationRef): void {
  const subscriptionManager = appRef.injector.get(SubscriptionManagerService);
  const relaysService = appRef.injector.get(RelaysService);
  const dataService = appRef.injector.get(DataService);

  const debug: NostriaDebugUtils = {
    showRelayMetrics: () => {
      subscriptionManager.logMetrics();
    },

    getMetrics: () => {
      return subscriptionManager.metricsSignal();
    },

    cleanupStale: (maxAgeMs = 300000) => {
      const cleaned = subscriptionManager.cleanupStaleSubscriptions(maxAgeMs);
      console.log(`🧹 Cleaned up ${cleaned} stale subscriptions`);
      return cleaned;
    },

    resetTracking: () => {
      console.warn('⚠️ Resetting all subscription tracking...');
      subscriptionManager.reset();
      console.log('✅ Reset complete');
    },

    getRelayStats: () => {
      return relaysService.getAllRelayStats();
    },

    showMalformedEvents: (limit = 20) => {
      dataService.logMalformedEventsInspector(limit);
    },

    getMalformedEvents: () => {
      return dataService.getMalformedEventsInspector();
    },

    resetMalformedEvents: () => {
      dataService.resetMalformedEventsInspector();
    },

    help: () => {
      console.log(`
🔧 Nostria Debug Utilities

Available commands:

  nostriaDebug.showRelayMetrics()
    Display detailed metrics about relay subscriptions and connections

  nostriaDebug.getMetrics()
    Get metrics object for programmatic access

  nostriaDebug.cleanupStale(maxAgeMs?)
    Clean up stale subscriptions (default: 5 minutes)

  nostriaDebug.resetTracking()
    Reset all subscription tracking (use with caution!)

  nostriaDebug.getRelayStats()
    Get detailed relay statistics

  nostriaDebug.showMalformedEvents(limit?)
    Show malformed event summary and recent samples (default: 20)

  nostriaDebug.getMalformedEvents()
    Get malformed event inspector snapshot for programmatic inspection

  nostriaDebug.resetMalformedEvents()
    Reset malformed event inspector counters and samples

  nostriaDebug.help()
    Show this help message

Example:
  nostriaDebug.showRelayMetrics()
      `);
    },
  };

  // Attach to window for global access
  (window as typeof window & { nostriaDebug?: NostriaDebugUtils }).nostriaDebug = debug;

  console.log('🔧 Nostria debug utilities initialized. Type "nostriaDebug.help()" for help.');
}
