import { Component, inject, computed, signal, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { SubscriptionManagerService, SubscriptionInfo, ConnectionInfo, QueryInfo } from '../../services/relays/subscription-manager';
import { CustomDialogRef } from '../../services/custom-dialog.service';

interface RelayStatus {
  url: string;
  fullUrl: string;
  isConnected: boolean;
  subscriptions: number;
  pendingRequests: number;
  lastActivity: string;
  poolInstance: string;
  health: 'good' | 'warning' | 'error';
}

interface SubscriptionGroup {
  source: string;
  count: number;
  subscriptions: SubscriptionInfo[];
  expanded: boolean;
}

interface QueryGroup {
  source: string;
  count: number;
  queries: QueryInfo[];
  expanded: boolean;
}

@Component({
  selector: 'app-debug-panel',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatTooltipModule,
    MatProgressBarModule,
  ],
  templateUrl: './debug-panel.component.html',
  styleUrls: ['./debug-panel.component.scss'],
})
export class DebugPanelComponent implements OnInit, OnDestroy {
  private subscriptionManager = inject(SubscriptionManagerService);
  dialogRef = inject(CustomDialogRef);

  // Public constants for template access
  readonly maxTotalSubscriptions = 50; // Mirror the service constant
  readonly maxSubsPerRelay = 10; // Mirror the service constant

  // Auto-refresh interval
  private refreshInterval?: ReturnType<typeof setInterval>;
  autoRefresh = signal(true);
  refreshRate = signal(2000); // 2 seconds

  // Get metrics signal from subscription manager
  metrics = this.subscriptionManager.metricsSignal;

  // Current time for relative calculations
  currentTime = signal(Date.now());

  // Expanded subscription groups
  expandedGroups = signal<Set<string>>(new Set());

  // Expanded query groups
  expandedQueryGroups = signal<Set<string>>(new Set());

  // Selected relay for filtering subscriptions
  selectedRelay = signal<string | null>(null);

  // Computed relay statuses sorted by subscription count
  relayStatuses = computed<RelayStatus[]>(() => {
    const connections = this.metrics().connectionsByRelay;
    const statuses: RelayStatus[] = [];
    
    connections.forEach((conn, url) => {
      statuses.push({
        url: this.shortenUrl(url),
        fullUrl: url,
        isConnected: conn.isConnected,
        subscriptions: conn.activeSubscriptions,
        pendingRequests: conn.pendingRequests,
        lastActivity: this.formatTimeAgo(conn.lastActivity),
        poolInstance: conn.poolInstance,
        health: this.getRelayHealth(conn),
      });
    });

    // Sort by subscription count (descending) then by connected status
    return statuses.sort((a, b) => {
      if (a.isConnected !== b.isConnected) return a.isConnected ? -1 : 1;
      return b.subscriptions - a.subscriptions;
    });
  });

  // Computed subscription groups (filtered by selected relay if any)
  subscriptionGroups = computed<SubscriptionGroup[]>(() => {
    const bySource = new Map<string, SubscriptionInfo[]>();
    const expanded = this.expandedGroups();
    const selectedRelayUrl = this.selectedRelay();

    for (const sub of this.metrics().subscriptions) {
      if (!sub.active) continue;
      
      // Filter by selected relay if one is selected
      if (selectedRelayUrl && !sub.relayUrls.includes(selectedRelayUrl)) {
        continue;
      }
      
      const subs = bySource.get(sub.source) || [];
      subs.push(sub);
      bySource.set(sub.source, subs);
    }

    const groups: SubscriptionGroup[] = [];
    bySource.forEach((subs, source) => {
      groups.push({
        source,
        count: subs.length,
        subscriptions: subs.sort((a, b) => b.createdAt - a.createdAt),
        expanded: expanded.has(source),
      });
    });

    // Sort by count descending
    return groups.sort((a, b) => b.count - a.count);
  });

  // Computed query groups (filtered by selected relay if any)
  queryGroups = computed<QueryGroup[]>(() => {
    const bySource = new Map<string, QueryInfo[]>();
    const expanded = this.expandedQueryGroups();
    const selectedRelayUrl = this.selectedRelay();

    for (const query of this.metrics().queries) {
      // Filter by selected relay if one is selected
      if (selectedRelayUrl && !query.relayUrls.includes(selectedRelayUrl)) {
        continue;
      }
      
      const queries = bySource.get(query.source) || [];
      queries.push(query);
      bySource.set(query.source, queries);
    }

    const groups: QueryGroup[] = [];
    bySource.forEach((queries, source) => {
      groups.push({
        source,
        count: queries.length,
        queries: queries.sort((a, b) => b.createdAt - a.createdAt),
        expanded: expanded.has(source),
      });
    });

    // Sort by count descending
    return groups.sort((a, b) => b.count - a.count);
  });

  // Flat list of queries filtered by selected relay
  filteredQueries = computed<QueryInfo[]>(() => {
    const selectedRelayUrl = this.selectedRelay();
    let queries = this.metrics().queries;
    
    if (selectedRelayUrl) {
      queries = queries.filter(q => q.relayUrls.includes(selectedRelayUrl));
    }
    
    // Already sorted by createdAt descending (newest first) from the service
    return queries;
  });

  // Summary stats
  totalSubs = computed(() => this.metrics().totalSubscriptions);
  totalPending = computed(() => this.metrics().totalPendingRequests);
  totalQueries = computed(() => this.metrics().queries.length);
  activeQueries = computed(() => this.metrics().queries.filter(q => q.status === 'active').length);
  completedQueries = computed(() => this.metrics().queries.filter(q => q.status === 'completed').length);
  totalConnections = computed(() => this.metrics().connectionsByRelay.size);
  connectedCount = computed(() => {
    let count = 0;
    this.metrics().connectionsByRelay.forEach(conn => {
      if (conn.isConnected) count++;
    });
    return count;
  });
  poolCount = computed(() => this.metrics().poolInstances.size);

  // Query statistics
  queryStats = computed(() => {
    const queries = this.metrics().queries;
    const completedQueries = queries.filter(q => q.status === 'completed' && q.completedAt);
    
    // Calculate durations for completed queries
    const durations = completedQueries
      .map(q => q.completedAt! - q.createdAt)
      .filter(d => d > 0);
    
    // Average duration
    const avgDuration = durations.length > 0 
      ? durations.reduce((a, b) => a + b, 0) / durations.length 
      : 0;
    
    // Min/Max duration
    const minDuration = durations.length > 0 ? Math.min(...durations) : 0;
    const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;
    
    // Queries per second (based on queries in last 10 seconds)
    const now = this.currentTime();
    const recentWindow = 10000; // 10 seconds
    const recentQueries = queries.filter(q => now - q.createdAt < recentWindow);
    const queriesPerSecond = recentQueries.length / (recentWindow / 1000);
    
    // Success rate (completed out of total non-active)
    const totalFinished = completedQueries.length;
    const activeCount = queries.filter(q => q.status === 'active').length;
    const totalAttempted = queries.length - activeCount + totalFinished;
    const successRate = totalAttempted > 0 ? (totalFinished / totalAttempted) * 100 : 100;
    
    // Slow queries (> 2 seconds)
    const slowQueryThreshold = 2000;
    const slowQueries = completedQueries.filter(q => (q.completedAt! - q.createdAt) > slowQueryThreshold).length;
    
    return {
      avgDuration,
      minDuration,
      maxDuration,
      queriesPerSecond,
      successRate,
      slowQueries,
      totalCompleted: totalFinished,
    };
  });

  // Health indicators
  subscriptionHealth = computed(() => {
    const total = this.totalSubs();
    const max = this.maxTotalSubscriptions;
    const ratio = total / max;
    if (ratio >= 0.9) return 'critical';
    if (ratio >= 0.7) return 'warning';
    return 'good';
  });

  subscriptionUsagePercent = computed(() => {
    return (this.totalSubs() / this.maxTotalSubscriptions) * 100;
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

  toggleGroup(source: string) {
    this.expandedGroups.update(set => {
      const newSet = new Set(set);
      if (newSet.has(source)) {
        newSet.delete(source);
      } else {
        newSet.add(source);
      }
      return newSet;
    });
  }

  toggleQueryGroup(source: string) {
    this.expandedQueryGroups.update(set => {
      const newSet = new Set(set);
      if (newSet.has(source)) {
        newSet.delete(source);
      } else {
        newSet.add(source);
      }
      return newSet;
    });
  }

  selectRelay(fullUrl: string) {
    if (this.selectedRelay() === fullUrl) {
      this.selectedRelay.set(null);
    } else {
      this.selectedRelay.set(fullUrl);
    }
  }

  clearRelaySelection() {
    this.selectedRelay.set(null);
  }

  logMetrics() {
    this.subscriptionManager.logMetrics();
    console.log('Metrics logged to console');
  }

  cleanupStale() {
    const cleaned = this.subscriptionManager.cleanupStaleSubscriptions();
    console.log(`Cleaned up ${cleaned} stale subscriptions`);
  }

  copyMetricsReport() {
    const report = this.subscriptionManager.getMetricsReport();
    navigator.clipboard.writeText(report).then(() => {
      console.log('Metrics report copied to clipboard');
    });
  }

  private getRelayHealth(conn: ConnectionInfo): 'good' | 'warning' | 'error' {
    if (!conn.isConnected) return 'error';
    const maxPerRelay = this.maxSubsPerRelay;
    if (conn.activeSubscriptions >= maxPerRelay) return 'error';
    if (conn.activeSubscriptions >= maxPerRelay * 0.7) return 'warning';
    return 'good';
  }

  shortenUrl(url: string): string {
    try {
      const u = new URL(url);
      return u.hostname;
    } catch {
      return url.replace(/^wss?:\/\//, '').split('/')[0];
    }
  }

  private formatTimeAgo(timestamp: number): string {
    const now = this.currentTime();
    const diff = Math.round((now - timestamp) / 1000);
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.round(diff / 60)}m`;
    return `${Math.round(diff / 3600)}h`;
  }

  formatFilter(filter: object): string {
    const f = filter as Record<string, unknown>;
    const parts: string[] = [];
    
    if (f['kinds']) parts.push(`k:${(f['kinds'] as number[]).join(',')}`);
    if (f['authors']) {
      const authors = f['authors'] as string[];
      parts.push(`a:${authors.length > 2 ? `${authors.length} authors` : authors.map(a => a.slice(0, 8)).join(',')}`);
    }
    if (f['#p']) {
      const ps = f['#p'] as string[];
      parts.push(`#p:${ps.length > 2 ? `${ps.length}` : ps.map(p => p.slice(0, 8)).join(',')}`);
    }
    if (f['#e']) {
      const es = f['#e'] as string[];
      parts.push(`#e:${es.length > 2 ? `${es.length}` : es.map(e => e.slice(0, 8)).join(',')}`);
    }
    if (f['#t']) parts.push(`#t:${(f['#t'] as string[]).join(',')}`);
    if (f['since']) parts.push(`since:${new Date((f['since'] as number) * 1000).toLocaleDateString()}`);
    if (f['until']) parts.push(`until:${new Date((f['until'] as number) * 1000).toLocaleDateString()}`);
    if (f['limit']) parts.push(`lim:${f['limit']}`);
    if (f['ids']) parts.push(`ids:${(f['ids'] as string[]).length}`);
    
    return parts.join(' ') || JSON.stringify(filter);
  }

  formatFilterFull(filter: object): string {
    return JSON.stringify(filter, null, 2);
  }

  getSubscriptionAge(createdAt: number): string {
    return this.formatTimeAgo(createdAt);
  }

  getQueryDuration(query: QueryInfo): string {
    if (query.status === 'active') {
      return this.formatTimeAgo(query.createdAt);
    }
    // For completed queries, show how long they took
    if (query.completedAt) {
      const duration = query.completedAt - query.createdAt;
      if (duration < 1000) return `${duration}ms`;
      return `${(duration / 1000).toFixed(1)}s`;
    }
    return this.formatTimeAgo(query.createdAt);
  }

  getQueryTimeAgo(query: QueryInfo): string {
    // Show when the query was created
    return this.formatTimeAgo(query.createdAt);
  }

  getSubscriptionRelays(relayUrls: string[]): string {
    if (relayUrls.length <= 2) {
      return relayUrls.map(u => this.shortenUrl(u)).join(', ');
    }
    return `${relayUrls.length} relays`;
  }

  trackBySource(index: number, group: SubscriptionGroup): string {
    return group.source;
  }

  trackByQuerySource(index: number, group: QueryGroup): string {
    return group.source;
  }

  trackById(index: number, sub: SubscriptionInfo): string {
    return sub.id;
  }

  trackByQueryId(index: number, query: QueryInfo): string {
    return query.id;
  }

  trackByUrl(index: number, relay: RelayStatus): string {
    return relay.url;
  }

  formatDuration(ms: number): string {
    if (ms === 0) return '-';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.round(ms / 1000)}s`;
  }

  formatRate(rate: number): string {
    if (rate < 0.1) return rate.toFixed(2);
    if (rate < 1) return rate.toFixed(1);
    return Math.round(rate).toString();
  }
}
