import { Injectable, inject, OnDestroy } from '@angular/core';
import { UserDataService } from './user-data.service';
import { LoggerService } from './logger.service';
import { DebugLoggerService } from './debug-logger.service';

export interface InstancePoolConfig {
  /** Maximum number of instances to keep in the pool */
  maxPoolSize: number;
  /** Time in milliseconds before an idle instance can be recycled */
  idleTimeoutMs: number;
  /** Time in milliseconds between cleanup runs */
  cleanupIntervalMs: number;
  /** Minimum idle time before an instance can be reused */
  reuseIdleTimeMs: number;
  /** Whether to enable aggressive cleanup during memory pressure */
  aggressiveCleanup: boolean;
  /** Grace period after last release before actual destruction */
  destructionGracePeriodMs: number;
}

export interface InstancePoolEntry {
  instance: UserDataService;
  pubkey: string;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  isIdle: boolean;
  /** Number of active holders of this instance. When it reaches 0 we can recycle immediately. */
  refCount: number;
  debugInstanceId?: string;
  destroyTimer?: ReturnType<typeof setTimeout>;
  destroyed?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class InstancePoolManagerService implements OnDestroy {
  private readonly logger = inject(LoggerService);
  private readonly debugLogger = inject(DebugLoggerService);

  // Default configuration - can be overridden
  private config: InstancePoolConfig = {
    maxPoolSize: 10, // Keep max 10 instances active
    idleTimeoutMs: 5 * 60 * 1000, // 5 minutes idle timeout
    cleanupIntervalMs: 30 * 1000, // Cleanup every 30 seconds
    reuseIdleTimeMs: 60 * 1000, // 1 minute before instance can be reused
    aggressiveCleanup: true,
    destructionGracePeriodMs: 1500,
  };

  // Leak detection threshold (ms). If an instance has refCount>0 but no access for this long we log a warning.
  private readonly leakIdleThresholdMs = 2 * 60 * 1000; // 2 minutes

  // Active instances pool
  private instancePool = new Map<string, InstancePoolEntry>();

  // Cleanup timer
  private cleanupTimer?: NodeJS.Timeout;

  // Statistics
  private stats = {
    totalCreated: 0,
    totalDestroyed: 0,
    totalReused: 0,
    cleanupRuns: 0,
    lastCleanupAt: 0,
    lastDiagnosticLogAt: 0,
  };

  constructor() {
    this.startCleanupTimer();
    this.logger.info('[InstancePool] Instance Pool Manager initialized', this.config);

    // Register with debug logger for statistics
    setTimeout(() => {
      // Use setTimeout to avoid circular dependency during construction
      this.debugLogger.setPoolManager(this);
    }, 0);
  }

  /**
   * Update the pool configuration
   */
  updateConfig(config: Partial<InstancePoolConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('[InstancePool] Configuration updated', this.config);

    // Restart cleanup timer with new interval
    this.stopCleanupTimer();
    this.startCleanupTimer();
  }

  /**
   * Get or create a UserDataService instance for the given pubkey
   */
  async getOrCreateInstance(pubkey: string, createFn: () => Promise<UserDataService>): Promise<UserDataService> {
    // First, try to reuse an existing instance
    const existingEntry = this.instancePool.get(pubkey);

    if (existingEntry) {
      // Always reuse existing instance – reference counting will manage lifecycle.
      existingEntry.refCount++;
      this.logger.debug(`[InstancePool] Reusing existing instance (refCount=${existingEntry.refCount}) for pubkey: ${pubkey.slice(0, 16)}...`);
      this.updateInstanceAccess(existingEntry);
      this.stats.totalReused++;
      return existingEntry.instance;
    }

    // Check if we need to make room in the pool
    if (this.instancePool.size >= this.config.maxPoolSize) {
      await this.evictLeastRecentlyUsed();
    }

    // Create a new instance
    this.logger.debug(`[InstancePool] Creating new instance for pubkey: ${pubkey.slice(0, 16)}...`);
    const instance = await createFn();

    // Register with pool
    const entry: InstancePoolEntry = {
      instance,
      pubkey,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 1,
      isIdle: false,
      refCount: 1,
    };

    this.instancePool.set(pubkey, entry);
    this.stats.totalCreated++;

    this.logger.debug(`[InstancePool] Instance created and registered for pubkey: ${pubkey.slice(0, 16)}... (Pool size: ${this.instancePool.size})`);

    return instance;
  }

  /**
   * Update access time for an instance
   */
  updateInstanceAccess(pubkeyOrEntry: string | InstancePoolEntry): void {
    let entry: InstancePoolEntry | undefined;

    if (typeof pubkeyOrEntry === 'string') {
      entry = this.instancePool.get(pubkeyOrEntry);
    } else {
      entry = pubkeyOrEntry;
    }

    if (entry) {
      entry.lastAccessedAt = Date.now();
      entry.accessCount++;
      entry.isIdle = false;
    }
  }

  /**
   * Release a previously acquired instance. When refCount reaches 0 the instance
   * is immediately destroyed to free relay sockets and memory.
   */
  async releaseInstance(pubkey: string): Promise<void> {
    const entry = this.instancePool.get(pubkey);
    if (!entry) {
      return;
    }
    entry.refCount = Math.max(0, entry.refCount - 1);
    this.logger.debug(`[InstancePool] Released instance for pubkey: ${pubkey.slice(0, 16)}... (refCount=${entry.refCount})`);
    if (entry.refCount === 0) {
      // Mark idle and schedule deferred destruction.
      entry.isIdle = true;
      if (entry.destroyTimer) {
        clearTimeout(entry.destroyTimer);
      }
      entry.destroyTimer = setTimeout(() => {
        const latest = this.instancePool.get(pubkey);
        if (latest && latest.refCount === 0 && !latest.destroyed) {
          this.destroyInstance(pubkey).catch(err => this.logger.error('[InstancePool] Deferred destroy error', err));
        }
      }, this.config.destructionGracePeriodMs);
    }
  }

  /**
   * Mark an instance as idle
   */
  markInstanceIdle(pubkey: string): void {
    const entry = this.instancePool.get(pubkey);
    if (entry) {
      entry.isIdle = entry.instance.isIdle();
      this.logger.debug(`[InstancePool] Marked instance as ${entry.isIdle ? 'idle' : 'active'} for pubkey: ${pubkey.slice(0, 16)}...`);
    }
  }

  /**
   * Manually destroy an instance
   */
  async destroyInstance(pubkey: string): Promise<void> {
    const entry = this.instancePool.get(pubkey);
    if (entry) {
      if (entry.destroyed) {
        return; // prevent double destroy
      }
      this.logger.debug(`[InstancePool] Destroying instance for pubkey: ${pubkey.slice(0, 16)}...`);

      try {
        entry.instance.destroy();
        entry.destroyed = true;
        this.instancePool.delete(pubkey);
        this.stats.totalDestroyed++;
        this.logger.debug(`[InstancePool] Instance destroyed for pubkey: ${pubkey.slice(0, 16)}... (Pool size: ${this.instancePool.size})`);
      } catch (error) {
        this.logger.error(`[InstancePool] Error destroying instance for pubkey: ${pubkey.slice(0, 16)}...`, error);
      }
    }
  }

  /**
   * Get pool statistics
   */
  getPoolStats() {
    const now = Date.now();
    const activeInstances = Array.from(this.instancePool.values()).filter(entry => !entry.isIdle);
    const idleInstances = Array.from(this.instancePool.values()).filter(entry => entry.isIdle);

    return {
      ...this.stats,
      currentPoolSize: this.instancePool.size,
      activeInstances: activeInstances.length,
      idleInstances: idleInstances.length,
      config: this.config,
      instanceDetails: Array.from(this.instancePool.entries()).map(([pubkey, entry]) => ({
        pubkey: pubkey.slice(0, 16) + '...',
        createdAt: new Date(entry.createdAt).toLocaleTimeString(),
        lastAccessedAt: new Date(entry.lastAccessedAt).toLocaleTimeString(),
        accessCount: entry.accessCount,
        isIdle: entry.isIdle,
        refCount: entry.refCount,
        ageMinutes: Math.round((now - entry.createdAt) / 1000 / 60),
        idleMinutes: Math.round((now - entry.lastAccessedAt) / 1000 / 60),
      })),
    };
  }

  /**
   * Perform cleanup of idle instances
   */
  async runCleanup(): Promise<void> {
    const now = Date.now();
    this.stats.cleanupRuns++;
    this.stats.lastCleanupAt = now;

    const instancesToDestroy: string[] = [];

    // Update idle status for all instances
    for (const [pubkey, entry] of this.instancePool.entries()) {
      // Recompute idle state from underlying instance
      entry.isIdle = entry.instance.isIdle();

      // If refCount already zero ensure grace timer will clean up; if grace already passed, destroy immediately
      if (entry.refCount === 0) {
        const elapsedSinceLastAccess = now - entry.lastAccessedAt;
        if (elapsedSinceLastAccess >= this.config.destructionGracePeriodMs && !entry.destroyed) {
          instancesToDestroy.push(pubkey);
          continue;
        }
      }

      // Standard idle expiration path
      const timeSinceLastAccess = now - entry.lastAccessedAt;
      const isExpired = timeSinceLastAccess > this.config.idleTimeoutMs;
      if (entry.isIdle && isExpired) {
        instancesToDestroy.push(pubkey);
      }

      // Leak detection: refCount > 0 but no access for prolonged time suggests unreleased holder.
      if (entry.refCount > 0 && timeSinceLastAccess > this.leakIdleThresholdMs) {
        this.logger.warn(`[InstancePool] Potential leak: pubkey=${pubkey.slice(0, 16)}... refCount=${entry.refCount} idleFor=${Math.round(timeSinceLastAccess / 1000)}s`);
      }
    }

    // Destroy expired instances
    for (const pubkey of instancesToDestroy) {
      await this.destroyInstance(pubkey);
    }

    if (instancesToDestroy.length > 0) {
      this.logger.info(`[InstancePool] Cleanup destroyed ${instancesToDestroy.length} idle/expired instances (Pool size: ${this.instancePool.size})`);
    }

    // Periodic diagnostic logging (every 60s)
    if (now - this.stats.lastDiagnosticLogAt > 60_000) {
      this.stats.lastDiagnosticLogAt = now;
      const detail = this.getPoolStats();
      this.logger.debug('[InstancePool] Diagnostic', detail);
    }

    // Log cleanup stats periodically
    if (this.stats.cleanupRuns % 10 === 0) {
      this.logger.debug('[InstancePool] Cleanup stats:', this.getPoolStats());
    }
  }

  /**
   * Check if an instance can be reused
   */
  private canReuseInstance(): boolean {
    // With reference counting we always reuse the existing instance.
    return true;
  }

  /**
   * Evict the least recently used instance to make room
   */
  private async evictLeastRecentlyUsed(): Promise<void> {
    let oldestEntry: { pubkey: string; entry: InstancePoolEntry } | null = null;

    for (const [pubkey, entry] of this.instancePool.entries()) {
      if (!oldestEntry || entry.lastAccessedAt < oldestEntry.entry.lastAccessedAt) {
        oldestEntry = { pubkey, entry };
      }
    }

    if (oldestEntry) {
      this.logger.debug(`[InstancePool] Evicting LRU instance for pubkey: ${oldestEntry.pubkey.slice(0, 16)}...`);
      await this.destroyInstance(oldestEntry.pubkey);
    }
  }

  /**
   * Start the cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.runCleanup().catch(error => {
        this.logger.error('[InstancePool] Error during cleanup:', error);
      });
    }, this.config.cleanupIntervalMs);

    this.logger.debug(`[InstancePool] Cleanup timer started (interval: ${this.config.cleanupIntervalMs}ms)`);
  }

  /**
   * Stop the cleanup timer
   */
  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
      this.logger.debug('[InstancePool] Cleanup timer stopped');
    }
  }

  /**
   * Cleanup when service is destroyed
   */
  ngOnDestroy(): void {
    this.stopCleanupTimer();

    // Destroy all remaining instances
    const instanceKeys = Array.from(this.instancePool.keys());
    for (const pubkey of instanceKeys) {
      this.destroyInstance(pubkey).catch(error => {
        this.logger.error(`[InstancePool] Error destroying instance during cleanup: ${pubkey}`, error);
      });
    }

    this.logger.info('[InstancePool] Instance Pool Manager destroyed');
  }
}