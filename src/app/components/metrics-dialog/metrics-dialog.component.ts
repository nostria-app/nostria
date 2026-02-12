import { Component, inject, computed, signal, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { PerformanceMetricsService, TimingStats, CounterStats, PerformanceSnapshot } from '../../services/performance-metrics.service';
import { CustomDialogRef } from '../../services/custom-dialog.service';

type TabId = 'overview' | 'timings' | 'counters';

@Component({
  selector: 'app-metrics-dialog',
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatProgressBarModule,
  ],
  templateUrl: './metrics-dialog.component.html',
  styleUrls: ['./metrics-dialog.component.scss'],
})
export class MetricsDialogComponent implements OnInit, OnDestroy {
  private readonly perfMetrics = inject(PerformanceMetricsService);
  dialogRef = inject(CustomDialogRef);

  private refreshInterval?: ReturnType<typeof setInterval>;
  autoRefresh = signal(true);
  refreshRate = signal(2000);
  currentTime = signal(Date.now());

  activeTab = signal<TabId>('overview');

  /** Expanded timing detail rows */
  expandedTimings = signal<Set<string>>(new Set());

  snapshot = computed<PerformanceSnapshot>(() => {
    this.currentTime();
    return this.perfMetrics.getSnapshot();
  });

  // Overview computeds
  totalTimingOps = computed(() =>
    this.snapshot().timings.reduce((sum, t) => sum + t.count, 0)
  );

  totalCounterEvents = computed(() =>
    this.snapshot().counters.reduce((sum, c) => sum + c.count, 0)
  );

  topTimings = computed(() =>
    this.snapshot().timings.slice(0, 10)
  );

  topCounters = computed(() =>
    this.snapshot().counters.slice(0, 10)
  );

  uptimeFormatted = computed(() =>
    this.formatDuration(this.snapshot().uptime)
  );

  memoryFormatted = computed(() => {
    const mem = this.snapshot().memoryUsage;
    if (!mem) return null;
    return {
      used: this.formatBytes(mem.usedJSHeapSize),
      total: this.formatBytes(mem.totalJSHeapSize),
      limit: this.formatBytes(mem.jsHeapSizeLimit),
      percent: Math.round((mem.usedJSHeapSize / mem.totalJSHeapSize) * 100),
    };
  });

  // Timing tab sorted by different criteria
  timingsSortedByTotal = computed(() =>
    [...this.snapshot().timings].sort((a, b) => b.totalTime - a.totalTime)
  );

  timingsSortedByAvg = computed(() =>
    [...this.snapshot().timings].sort((a, b) => b.avgTime - a.avgTime)
  );

  timingsSortedByCount = computed(() =>
    [...this.snapshot().timings].sort((a, b) => b.count - a.count)
  );

  timingSortMode = signal<'total' | 'avg' | 'count'>('total');

  sortedTimings = computed(() => {
    switch (this.timingSortMode()) {
      case 'avg': return this.timingsSortedByAvg();
      case 'count': return this.timingsSortedByCount();
      default: return this.timingsSortedByTotal();
    }
  });

  ngOnInit() {
    this.startAutoRefresh();
  }

  ngOnDestroy() {
    this.stopAutoRefresh();
  }

  private startAutoRefresh() {
    if (this.refreshInterval) return;
    this.refreshInterval = setInterval(() => {
      if (this.autoRefresh()) {
        this.currentTime.set(Date.now());
      }
    }, this.refreshRate());
  }

  private stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }
  }

  toggleAutoRefresh() {
    this.autoRefresh.update(v => !v);
  }

  refresh() {
    this.currentTime.set(Date.now());
  }

  setTab(tab: TabId) {
    this.activeTab.set(tab);
  }

  setTimingSort(mode: 'total' | 'avg' | 'count') {
    this.timingSortMode.set(mode);
  }

  toggleTimingExpanded(name: string) {
    this.expandedTimings.update(set => {
      const newSet = new Set(set);
      if (newSet.has(name)) {
        newSet.delete(name);
      } else {
        newSet.add(name);
      }
      return newSet;
    });
  }

  isTimingExpanded(name: string): boolean {
    return this.expandedTimings().has(name);
  }

  resetMetrics() {
    this.perfMetrics.reset();
    this.currentTime.set(Date.now());
  }

  copyReport() {
    const report = this.perfMetrics.getReport();
    navigator.clipboard.writeText(report).then(() => {
      console.log('Performance report copied to clipboard');
    });
  }

  logReport() {
    console.log(this.perfMetrics.getReport());
  }

  // Formatting helpers
  formatMs(ms: number): string {
    if (ms === 0) return '0ms';
    if (ms < 0.01) return '<0.01ms';
    if (ms < 1) return `${ms.toFixed(2)}ms`;
    if (ms < 100) return `${ms.toFixed(1)}ms`;
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  formatRate(rate: number): string {
    if (rate === 0) return '0';
    if (rate < 0.1) return rate.toFixed(2);
    if (rate < 1) return rate.toFixed(1);
    return Math.round(rate).toString();
  }

  formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  getBarWidth(value: number, max: number): number {
    if (max === 0) return 0;
    return Math.min(100, (value / max) * 100);
  }

  trackByName(_index: number, item: TimingStats | CounterStats): string {
    return item.name;
  }
}
