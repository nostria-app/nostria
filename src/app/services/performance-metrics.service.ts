import { Injectable, PLATFORM_ID, inject, signal, computed } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * A single timing entry for a named operation
 */
export interface TimingEntry {
  /** Duration in milliseconds */
  duration: number;
  /** When this timing was recorded */
  timestamp: number;
}

/**
 * Aggregated statistics for a named operation
 */
export interface TimingStats {
  /** Name/category of the operation */
  name: string;
  /** Total number of recorded timings */
  count: number;
  /** Total time spent (ms) */
  totalTime: number;
  /** Average duration (ms) */
  avgTime: number;
  /** Minimum duration (ms) */
  minTime: number;
  /** Maximum duration (ms) */
  maxTime: number;
  /** Median duration (ms) */
  medianTime: number;
  /** 95th percentile duration (ms) */
  p95Time: number;
  /** Operations per second (based on last 10s window) */
  opsPerSecond: number;
  /** Most recent duration (ms) */
  lastTime: number;
  /** Timestamp of last measurement */
  lastTimestamp: number;
}

/**
 * Counter for tracking occurrences of events
 */
export interface CounterStats {
  name: string;
  count: number;
  lastTimestamp: number;
  /** Rate per second (based on last 10s window) */
  ratePerSecond: number;
}

/**
 * Snapshot of all performance metrics
 */
export interface PerformanceSnapshot {
  timings: TimingStats[];
  counters: CounterStats[];
  uptime: number;
  memoryUsage: MemoryInfo | null;
  collectedAt: number;
}

/**
 * Browser memory info (from performance.memory)
 */
export interface MemoryInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

/** Max number of timing entries to keep per operation */
const MAX_TIMING_ENTRIES = 500;

/** Max number of counter timestamps to keep per counter */
const MAX_COUNTER_TIMESTAMPS = 200;

/**
 * Service for collecting and querying application performance metrics.
 *
 * Tracks timing of operations (relay queries, event processing, rendering, etc.)
 * and event counters (events received, filtered, published, etc.).
 *
 * All data is held in memory only - nothing is persisted.
 */
@Injectable({
  providedIn: 'root',
})
export class PerformanceMetricsService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  /** Timing entries keyed by operation name */
  private timings = new Map<string, TimingEntry[]>();

  /** Active timers for start/stop pattern */
  private activeTimers = new Map<string, number>();

  /** Counter values keyed by counter name */
  private counterValues = new Map<string, number>();

  /** Counter timestamps for rate calculation */
  private counterTimestamps = new Map<string, number[]>();

  /** Startup time */
  private readonly startTime = Date.now();

  /** Version counter that bumps whenever metrics change */
  private readonly _version = signal(0);
  private versionBumpScheduled = false;

  /** Reactive snapshot - recomputed when version changes */
  readonly snapshot = computed<PerformanceSnapshot>(() => {
    this._version();
    return this.getSnapshot();
  });

  // ─── Timing API ────────────────────────────────────────────────

  /**
   * Start a timer for a named operation.
   * Call `endTimer` with the same key to record the duration.
   */
  startTimer(key: string): void {
    if (!this.isBrowser) return;
    this.activeTimers.set(key, performance.now());
  }

  /**
   * End a previously started timer and record the duration.
   * Returns the duration in ms, or -1 if no timer was started.
   */
  endTimer(key: string): number {
    if (!this.isBrowser) return -1;

    const start = this.activeTimers.get(key);
    if (start === undefined) return -1;

    this.activeTimers.delete(key);
    const duration = performance.now() - start;
    this.recordTiming(key, duration);
    return duration;
  }

  /**
   * Record a timing value directly (when you already have the duration).
   */
  recordTiming(name: string, durationMs: number): void {
    let entries = this.timings.get(name);
    if (!entries) {
      entries = [];
      this.timings.set(name, entries);
    }

    entries.push({ duration: durationMs, timestamp: Date.now() });

    // Evict oldest entries if over limit
    if (entries.length > MAX_TIMING_ENTRIES) {
      entries.splice(0, entries.length - MAX_TIMING_ENTRIES);
    }

    this.bump();
  }

  /**
   * Measure an async operation and record its timing.
   */
  async measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.recordTiming(name, performance.now() - start);
    }
  }

  /**
   * Measure a synchronous operation and record its timing.
   */
  measure<T>(name: string, fn: () => T): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      this.recordTiming(name, performance.now() - start);
    }
  }

  // ─── Counter API ───────────────────────────────────────────────

  /**
   * Increment a named counter.
   */
  incrementCounter(name: string, amount = 1): void {
    const current = this.counterValues.get(name) ?? 0;
    this.counterValues.set(name, current + amount);

    // Track timestamps for rate calculation
    let timestamps = this.counterTimestamps.get(name);
    if (!timestamps) {
      timestamps = [];
      this.counterTimestamps.set(name, timestamps);
    }
    const now = Date.now();
    timestamps.push(now);
    if (timestamps.length > MAX_COUNTER_TIMESTAMPS) {
      timestamps.splice(0, timestamps.length - MAX_COUNTER_TIMESTAMPS);
    }

    this.bump();
  }

  /**
   * Get the current value of a counter.
   */
  getCounter(name: string): number {
    return this.counterValues.get(name) ?? 0;
  }

  // ─── Query API ─────────────────────────────────────────────────

  /**
   * Get aggregated stats for a specific timing operation.
   */
  getTimingStats(name: string): TimingStats | null {
    const entries = this.timings.get(name);
    if (!entries || entries.length === 0) return null;
    return this.computeTimingStats(name, entries);
  }

  /**
   * Get a full snapshot of all metrics.
   */
  getSnapshot(): PerformanceSnapshot {
    const timings: TimingStats[] = [];
    this.timings.forEach((entries, name) => {
      if (entries.length > 0) {
        timings.push(this.computeTimingStats(name, entries));
      }
    });

    // Sort by total time descending
    timings.sort((a, b) => b.totalTime - a.totalTime);

    const counters: CounterStats[] = [];
    this.counterValues.forEach((count, name) => {
      counters.push(this.computeCounterStats(name, count));
    });
    counters.sort((a, b) => b.count - a.count);

    return {
      timings,
      counters,
      uptime: Date.now() - this.startTime,
      memoryUsage: this.getMemoryInfo(),
      collectedAt: Date.now(),
    };
  }

  /**
   * Generate a human-readable report of all metrics.
   */
  getReport(): string {
    const snap = this.getSnapshot();
    const lines: string[] = [];

    lines.push('=== Performance Metrics Report ===');
    lines.push(`Uptime: ${this.formatDuration(snap.uptime)}`);

    if (snap.memoryUsage) {
      lines.push(`Memory: ${this.formatBytes(snap.memoryUsage.usedJSHeapSize)} / ${this.formatBytes(snap.memoryUsage.totalJSHeapSize)} (limit: ${this.formatBytes(snap.memoryUsage.jsHeapSizeLimit)})`);
    }

    lines.push('');
    lines.push('--- Timings ---');
    for (const t of snap.timings) {
      lines.push(`${t.name}: count=${t.count}, avg=${t.avgTime.toFixed(2)}ms, min=${t.minTime.toFixed(2)}ms, max=${t.maxTime.toFixed(2)}ms, p95=${t.p95Time.toFixed(2)}ms, total=${t.totalTime.toFixed(1)}ms`);
    }

    lines.push('');
    lines.push('--- Counters ---');
    for (const c of snap.counters) {
      lines.push(`${c.name}: ${c.count} (${c.ratePerSecond.toFixed(2)}/s)`);
    }

    return lines.join('\n');
  }

  /**
   * Reset all metrics.
   */
  reset(): void {
    this.timings.clear();
    this.activeTimers.clear();
    this.counterValues.clear();
    this.counterTimestamps.clear();
    this.bump();
  }

  // ─── Private helpers ───────────────────────────────────────────

  private bump(): void {
    if (this.versionBumpScheduled) {
      return;
    }

    this.versionBumpScheduled = true;
    queueMicrotask(() => {
      this.versionBumpScheduled = false;
      this._version.update(v => v + 1);
    });
  }

  private computeTimingStats(name: string, entries: TimingEntry[]): TimingStats {
    const durations = entries.map(e => e.duration).sort((a, b) => a - b);
    const count = durations.length;
    const totalTime = durations.reduce((sum, d) => sum + d, 0);

    const now = Date.now();
    const recentWindow = 10_000;
    const recentCount = entries.filter(e => now - e.timestamp < recentWindow).length;

    return {
      name,
      count,
      totalTime,
      avgTime: totalTime / count,
      minTime: durations[0],
      maxTime: durations[count - 1],
      medianTime: this.percentile(durations, 50),
      p95Time: this.percentile(durations, 95),
      opsPerSecond: recentCount / (recentWindow / 1000),
      lastTime: entries[entries.length - 1].duration,
      lastTimestamp: entries[entries.length - 1].timestamp,
    };
  }

  private computeCounterStats(name: string, count: number): CounterStats {
    const timestamps = this.counterTimestamps.get(name) ?? [];
    const now = Date.now();
    const recentWindow = 10_000;
    const recentCount = timestamps.filter(t => now - t < recentWindow).length;

    return {
      name,
      count,
      lastTimestamp: timestamps.length > 0 ? timestamps[timestamps.length - 1] : 0,
      ratePerSecond: recentCount / (recentWindow / 1000),
    };
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private getMemoryInfo(): MemoryInfo | null {
    if (!this.isBrowser) return null;
    const perf = performance as unknown as { memory?: MemoryInfo };
    if (perf.memory) {
      return {
        usedJSHeapSize: perf.memory.usedJSHeapSize,
        totalJSHeapSize: perf.memory.totalJSHeapSize,
        jsHeapSizeLimit: perf.memory.jsHeapSizeLimit,
      };
    }
    return null;
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
}
