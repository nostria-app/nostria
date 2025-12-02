import { Injectable, inject, signal, effect } from '@angular/core';
import { UtilitiesService } from '../utilities.service';
import { ObservedRelayStats, Nip11Info } from '../database.service';
import { DatabaseService } from '../database.service';
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

// NIP-11 Relay Information Document interface
export interface Nip11RelayInfo {
  name?: string;
  description?: string;
  banner?: string;
  icon?: string;
  pubkey?: string;
  contact?: string;
  supported_nips?: number[];
  software?: string;
  version?: string;
  privacy_policy?: string;
  terms_of_service?: string;
  limitation?: {
    max_message_length?: number;
    max_subscriptions?: number;
    max_limit?: number;
    max_subid_length?: number;
    max_event_tags?: number;
    max_content_length?: number;
    min_pow_difficulty?: number;
    auth_required?: boolean;
    payment_required?: boolean;
    restricted_writes?: boolean;
    created_at_lower_limit?: number;
    created_at_upper_limit?: number;
    default_limit?: number;
  };
  retention?: {
    kinds?: (number | [number, number])[];
    time?: number | null;
    count?: number;
  }[];
  relay_countries?: string[];
  language_tags?: string[];
  tags?: string[];
  posting_policy?: string;
  payments_url?: string;
  fees?: {
    admission?: { amount: number; unit: string }[];
    subscription?: { amount: number; unit: string; period?: number }[];
    publication?: { kinds?: number[]; amount: number; unit: string }[];
  };
}

@Injectable({
  providedIn: 'root',
})
export class RelaysService {
  private utilities = inject(UtilitiesService);

  private readonly database = inject(DatabaseService);

  // Map of relay URL to relay statistics
  private relayStats = new Map<string, RelayStats>();

  private readonly settings = inject(LocalSettingsService);

  // Map of user public keys to their relay URLs
  private userRelays = new Map<string, string[]>();

  // Signals for reactive updates
  readonly relayStatsSignal = signal<Map<string, RelayStats>>(new Map());
  readonly userRelaysSignal = signal<Map<string, string[]>>(new Map());
  readonly observedRelaysSignal = signal<ObservedRelayStats[]>([]);

  // Throttling for storage saves
  private readonly SAVE_THROTTLE_MS = 5000; // Save at most once every 5 seconds per relay
  private pendingSaves = new Map<string, NodeJS.Timeout>();
  private lastSaveTime = new Map<string, number>();

  constructor() {
    // Initialize with preferred relays
    this.initializePreferredRelays();

    // Load observed relays and save initial stats when the storage is initialized
    effect(() => {
      if (this.database.initialized()) {
        this.loadObservedRelays();
        // Save any relay stats that were added before database was ready
        this.relayStats.forEach(stats => {
          this.saveRelayStatsToStorage(stats);
        });
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
      const observedRelays = await this.database.getAllObservedRelays() as unknown as ObservedRelayStats[];
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
   * Save relay statistics to IndexedDB with throttling
   * This method batches saves to avoid excessive storage writes
   */
  private async saveRelayStatsToStorage(stats: RelayStats): Promise<void> {
    // Don't try to save if database is not initialized yet
    if (!this.database.initialized()) {
      return;
    }

    const url = stats.url;
    const now = Date.now();
    const lastSave = this.lastSaveTime.get(url) || 0;
    const timeSinceLastSave = now - lastSave;

    // Clear any existing pending save for this relay
    const existingTimeout = this.pendingSaves.get(url);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // If we saved recently, schedule a delayed save
    if (timeSinceLastSave < this.SAVE_THROTTLE_MS) {
      const timeout = setTimeout(() => {
        this.performSave(stats);
        this.pendingSaves.delete(url);
      }, this.SAVE_THROTTLE_MS - timeSinceLastSave);

      this.pendingSaves.set(url, timeout);
    } else {
      // Enough time has passed, save immediately
      await this.performSave(stats);
    }
  }

  /**
   * Perform the actual save operation
   */
  private async performSave(stats: RelayStats): Promise<void> {
    try {
      const existing = await this.database.getObservedRelay(stats.url) as unknown as ObservedRelayStats | null;
      const observedStats = this.toObservedRelayStats(stats);

      if (existing) {
        // Preserve the first observed time and merge with existing NIP-11 info
        observedStats.firstObserved = existing['firstObserved'] as number;
        observedStats.nip11 = existing['nip11'] as Nip11Info | undefined;
      }

      await this.database.saveObservedRelay(observedStats as unknown as Record<string, unknown>);
      this.lastSaveTime.set(stats.url, Date.now());

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
    return await this.database.getAllObservedRelays() as unknown as ObservedRelayStats[];
  }

  /**
   * Get observed relays sorted by criteria
   */
  async getObservedRelaysSorted(
    sortBy: 'eventsReceived' | 'lastUpdated' | 'firstObserved' = 'lastUpdated'
  ): Promise<ObservedRelayStats[]> {
    return await this.database.getObservedRelaysSorted(sortBy) as unknown as ObservedRelayStats[];
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
      await this.database.updatePubkeyRelayMappingFromHint(pubkey, normalizedUrl);
    }
  }

  /**
   * Get relay URLs discovered for a specific pubkey (fallback method)
   */
  async getFallbackRelaysForPubkey(pubkey: string): Promise<string[]> {
    return await this.database.getRelayUrlsForPubkey(pubkey);
  }

  /**
   * Clean up old relay data
   */
  async cleanupOldRelayData(olderThanDays = 30): Promise<void> {
    await this.database.cleanupOldPubkeyRelayMappings(olderThanDays);
  }

  /**
   * Re-save relay statistics to storage once database is initialized
   * This ensures that relays added during initialization are properly persisted
   */
  async persistInitialRelayStats(): Promise<void> {
    if (!this.database.initialized()) {
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

  /**
   * Fetch NIP-11 relay information document from a relay
   * @param relayUrl The WebSocket URL of the relay (wss://...)
   * @returns Promise resolving to relay information or null if fetch fails
   */
  async fetchNip11Info(relayUrl: string): Promise<Nip11RelayInfo | null> {
    try {
      // Convert wss:// to https:// for HTTP request
      const httpUrl = relayUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');

      const response = await fetch(httpUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/nostr+json',
        },
        // Add timeout to avoid hanging
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (!response.ok) {
        console.warn(`NIP-11 fetch failed for ${relayUrl}: ${response.status}`);
        return null;
      }

      const data = (await response.json()) as Nip11RelayInfo;
      return data;
    } catch (error) {
      console.warn(`Failed to fetch NIP-11 info for ${relayUrl}:`, error);
      return null;
    }
  }
}
