import { Injectable, inject, signal, effect } from '@angular/core';
import { UtilitiesService } from '../utilities.service';
import { StorageService, ObservedRelayStats } from '../storage.service';
import { LocalSettingsService } from '../local-settings.service';

export interface RelayStats {
  url: string;
  isConnected: boolean;
  isOffline: boolean;
  eventsReceived: number;
  lastConnectionRetry: number; // timestamp in seconds
  lastSuccessfulConnection: number; // timestamp in seconds
  connectionAttempts: number;
}

@Injectable({
  providedIn: 'root',
})
export class RelaysService {
  private utilities = inject(UtilitiesService);

  private readonly storage = inject(StorageService);

  // Map of relay URL to relay statistics
  private relayStats = new Map<string, RelayStats>();

  private readonly settings = inject(LocalSettingsService);

  // Map of user public keys to their relay URLs
  private userRelays = new Map<string, string[]>();

  // Signals for reactive updates
  readonly relayStatsSignal = signal<Map<string, RelayStats>>(new Map());
  readonly userRelaysSignal = signal<Map<string, string[]>>(new Map());
  readonly observedRelaysSignal = signal<ObservedRelayStats[]>([]);

  constructor() {
    // Initialize with preferred relays
    this.initializePreferredRelays();

    // Load observed relays only when the storage is initialized
    effect(() => {
      if (this.storage.initialized()) {
        this.loadObservedRelays();
      }
    });
  }

  private initializePreferredRelays(): void {
    this.utilities.preferredRelays.forEach(url => {
      this.addRelay(url);
    });
  }

  /**
   * Add a relay to the stats map
   */
  addRelay(url: string): void {
    const normalizedUrl = this.utilities.normalizeRelayUrl(url);
    if (!normalizedUrl) return;

    if (!this.relayStats.has(normalizedUrl)) {
      const stats: RelayStats = {
        url: normalizedUrl,
        isConnected: false,
        isOffline: false,
        eventsReceived: 0,
        lastConnectionRetry: 0,
        lastSuccessfulConnection: 0,
        connectionAttempts: 0,
      };

      this.relayStats.set(normalizedUrl, stats);
      this.updateSignals();

      // Save to storage
      this.saveRelayStatsToStorage(stats);
    }
  }

  /**
   * Update relay connection status
   */
  updateRelayConnection(url: string, isConnected: boolean): void {
    const normalizedUrl = this.utilities.normalizeRelayUrl(url);
    if (!normalizedUrl) return;

    const stats = this.relayStats.get(normalizedUrl);
    if (stats) {
      stats.isConnected = isConnected;
      stats.isOffline = !isConnected;

      if (isConnected) {
        stats.lastSuccessfulConnection = this.utilities.currentDate();
      }

      this.updateSignals();

      // Save to storage
      this.saveRelayStatsToStorage(stats);
    }
  }

  /**
   * Record a connection retry attempt
   */
  recordConnectionRetry(url: string): void {
    const normalizedUrl = this.utilities.normalizeRelayUrl(url);
    if (!normalizedUrl) return;

    const stats = this.relayStats.get(normalizedUrl);
    if (stats) {
      stats.lastConnectionRetry = this.utilities.currentDate();
      stats.connectionAttempts++;
      this.updateSignals();

      // Save to storage
      this.saveRelayStatsToStorage(stats);
    }
  }

  /**
   * Increment event count for a relay
   */
  incrementEventCount(url: string): void {
    const normalizedUrl = this.utilities.normalizeRelayUrl(url);
    if (!normalizedUrl) return;

    const stats = this.relayStats.get(normalizedUrl);
    if (stats) {
      stats.eventsReceived++;
      this.updateSignals();

      // Save to storage
      this.saveRelayStatsToStorage(stats);
    }
  }

  /**
   * Get relay statistics
   */
  getRelayStats(url: string): RelayStats | undefined {
    const normalizedUrl = this.utilities.normalizeRelayUrl(url);
    return this.relayStats.get(normalizedUrl);
  }

  /**
   * Get all relay statistics
   */
  getAllRelayStats(): Map<string, RelayStats> {
    return new Map(this.relayStats);
  }

  /**
   * Set relays for a user
   */
  setUserRelays(pubkey: string, relays: string[]): void {
    const normalizedRelays = this.utilities.normalizeRelayUrls(relays);
    this.userRelays.set(pubkey, normalizedRelays);

    // Add these relays to our stats if they don't exist
    normalizedRelays.forEach(url => this.addRelay(url));

    this.updateSignals();
  }

  /**
   * Get relays for a user
   */
  getUserRelays(pubkey: string): string[] {
    return this.userRelays.get(pubkey) || [];
  }

  /**
   * Get optimal relays for a user with connection preference
   */
  getOptimalRelays(relayUrls: string[], limit = this.settings.maxRelaysPerUser()): string[] {
    // We have not discovered any relays for this user, what should we do?
    if (relayUrls.length === 0) {
      relayUrls = this.utilities.preferredRelays.slice(0, limit);
    }

    // Use utilities to filter out bad relays first
    const validRelays = this.utilities.pickOptimalRelays(relayUrls, relayUrls.length);

    // Sort by connection status and performance
    const sortedRelays = validRelays.sort((a, b) => {
      const statsA = this.getRelayStats(a);
      const statsB = this.getRelayStats(b);

      if (!statsA && !statsB) return 0;
      if (!statsA) return 1;
      if (!statsB) return -1;

      // Prefer connected relays
      if (statsA.isConnected && !statsB.isConnected) return -1;
      if (!statsA.isConnected && statsB.isConnected) return 1;

      // Prefer relays with more events received
      if (statsA.eventsReceived !== statsB.eventsReceived) {
        return statsB.eventsReceived - statsA.eventsReceived;
      }

      // Prefer relays with more recent successful connections
      return statsB.lastSuccessfulConnection - statsA.lastSuccessfulConnection;
    });

    return sortedRelays.slice(0, limit);
  }

  /**
   * Get connected relays
   */
  getConnectedRelays(): string[] {
    return Array.from(this.relayStats.entries())
      .filter(([_, stats]) => stats.isConnected)
      .map(([url, _]) => url);
  }

  /**
   * Get offline relays
   */
  getOfflineRelays(): string[] {
    return Array.from(this.relayStats.entries())
      .filter(([_, stats]) => stats.isOffline)
      .map(([url, _]) => url);
  }

  /**
   * Clear all relay statistics
   */
  clearAllStats(): void {
    this.relayStats.clear();
    this.userRelays.clear();
    this.initializePreferredRelays();
    this.updateSignals();
  }

  /**
   * Remove a relay from statistics
   */
  removeRelay(url: string): void {
    const normalizedUrl = this.utilities.normalizeRelayUrl(url);
    if (normalizedUrl) {
      this.relayStats.delete(normalizedUrl);
      this.updateSignals();
    }
  }

  /**
   * Get relay performance score (0-100)
   */
  getRelayPerformanceScore(url: string): number {
    const stats = this.getRelayStats(url);
    if (!stats) return 0;

    let score = 0;

    // Connection status (50% weight)
    if (stats.isConnected) {
      score += 50;
    } else if (!stats.isOffline) {
      score += 25; // Unknown state
    }

    // Events received (30% weight)
    if (stats.eventsReceived > 0) {
      // Logarithmic scale for events
      score += Math.min(30, Math.log10(stats.eventsReceived + 1) * 10);
    }

    // Recent successful connection (20% weight)
    if (stats.lastSuccessfulConnection > 0) {
      const now = this.utilities.currentDate();
      const hoursSinceLastConnection = (now - stats.lastSuccessfulConnection) / 3600;

      if (hoursSinceLastConnection < 1) {
        score += 20;
      } else if (hoursSinceLastConnection < 24) {
        score += 15;
      } else if (hoursSinceLastConnection < 168) {
        // 1 week
        score += 10;
      } else {
        score += 5;
      }
    }

    return Math.min(100, Math.max(0, score));
  }

  private updateSignals(): void {
    this.relayStatsSignal.set(new Map(this.relayStats));
    this.userRelaysSignal.set(new Map(this.userRelays));
  }

  /**
   * Load observed relays from IndexedDB (public method)
   */
  async loadObservedRelays(): Promise<void> {
    try {
      const observedRelays = await this.storage.getAllObservedRelays();
      this.observedRelaysSignal.set(observedRelays);
    } catch (error) {
      console.error('Failed to load observed relays from storage:', error);
    }
  }

  /**
   * Convert RelayStats to ObservedRelayStats for storage
   */
  private toObservedRelayStats(stats: RelayStats): ObservedRelayStats {
    const now = this.utilities.currentDate();
    return {
      url: stats.url,
      isConnected: stats.isConnected,
      isOffline: stats.isOffline,
      eventsReceived: stats.eventsReceived,
      lastConnectionRetry: stats.lastConnectionRetry,
      lastSuccessfulConnection: stats.lastSuccessfulConnection,
      connectionAttempts: stats.connectionAttempts,
      firstObserved: now, // Will be overridden if it already exists
      lastUpdated: now,
    };
  }

  /**
   * Save relay statistics to IndexedDB
   */
  private async saveRelayStatsToStorage(stats: RelayStats): Promise<void> {
    try {
      const existing = await this.storage.getObservedRelay(stats.url);
      const observedStats = this.toObservedRelayStats(stats);

      if (existing) {
        // Preserve the first observed time and merge with existing NIP-11 info
        observedStats.firstObserved = existing.firstObserved;
        observedStats.nip11 = existing.nip11;
      }

      await this.storage.saveObservedRelay(observedStats);

      // Update the signal with fresh data
      this.loadObservedRelays();
    } catch (error) {
      console.error('Failed to save relay stats to storage:', error);
    }
  }

  /**
   * Get all observed relays from storage
   */
  async getAllObservedRelays(): Promise<ObservedRelayStats[]> {
    return await this.storage.getAllObservedRelays();
  }

  /**
   * Get observed relays sorted by criteria
   */
  async getObservedRelaysSorted(
    sortBy: 'eventsReceived' | 'lastUpdated' | 'firstObserved' = 'lastUpdated'
  ): Promise<ObservedRelayStats[]> {
    return await this.storage.getObservedRelaysSorted(sortBy);
  }

  /**
   * Add relay hints from event parsing
   */
  async addRelayHintsFromEvent(pubkey: string, relayUrls: string[]): Promise<void> {
    for (const url of relayUrls) {
      const normalizedUrl = this.utilities.normalizeRelayUrl(url);
      if (!normalizedUrl) continue;

      // Add to our relay stats if not already present
      this.addRelay(normalizedUrl);

      // Update pubkey-relay mapping in storage
      await this.storage.updatePubkeyRelayMappingFromHint(pubkey, normalizedUrl);
    }
  }

  /**
   * Get relay URLs discovered for a specific pubkey (fallback method)
   */
  async getFallbackRelaysForPubkey(pubkey: string): Promise<string[]> {
    return await this.storage.getRelayUrlsForPubkey(pubkey);
  }

  /**
   * Clean up old relay data
   */
  async cleanupOldRelayData(olderThanDays = 30): Promise<void> {
    await this.storage.cleanupOldPubkeyRelayMappings(olderThanDays);
  }

  /**
   * Re-save relay statistics to storage once database is initialized
   * This ensures that relays added during initialization are properly persisted
   */
  async persistInitialRelayStats(): Promise<void> {
    if (!this.storage.initialized()) {
      return; // Database not ready yet
    }

    for (const [url, stats] of this.relayStats) {
      try {
        await this.saveRelayStatsToStorage(stats);
      } catch (error) {
        console.error(`Failed to persist initial relay stats for ${url}:`, error);
      }
    }
  }
}
