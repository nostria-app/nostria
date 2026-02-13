/**
 * Metrics Collector Utility
 *
 * Aggregates all performance data from individual tests into a unified
 * test-results/reports/performance-report.json with: page load times,
 * web vitals, bundle sizes, memory usage, relay performance, and
 * historical comparison (if previous report exists).
 */
import * as fs from 'fs';
import * as path from 'path';

interface PageLoadResult {
  route: string;
  totalLoadTimeMs: number;
  ttfbMs?: number;
  domContentLoadedMs?: number;
  loadCompleteMs?: number;
}

interface WebVitalsResult {
  lcp?: number;
  fid?: number;
  cls?: number;
  fcp?: number;
  ttfb?: number;
}

interface BundleSizeResult {
  totalSizeKB: number;
  jsSizeKB: number;
  cssSizeKB: number;
  largeResources: { name: string; sizeKB: number }[];
}

interface MemoryResult {
  startMB: number;
  endMB: number;
  deltaMB: number;
  potentialLeak: boolean;
}

interface RelayPerformanceResult {
  totalConnections: number;
  eoseMessages: number;
  connectionLogs: number;
  timeToDataMs?: number;
}

interface PerformanceReport {
  collectedAt: string;
  pageLoads: PageLoadResult[];
  webVitals: WebVitalsResult;
  bundleSize: BundleSizeResult | null;
  memory: MemoryResult | null;
  relayPerformance: RelayPerformanceResult | null;
  comparison?: {
    previousCollectedAt: string;
    regressions: string[];
    improvements: string[];
  };
}

/**
 * MetricsCollector aggregates performance data from individual test runs
 * and produces a unified performance report.
 */
export class MetricsCollector {
  private readonly metricsDir: string;
  private readonly reportsDir: string;

  constructor(basePath?: string) {
    const base = basePath || process.cwd();
    this.metricsDir = path.join(base, 'test-results', 'metrics');
    this.reportsDir = path.join(base, 'test-results', 'reports');
  }

  /**
   * Read and parse all JSON files matching a pattern from the metrics directory.
   */
  private readMetricsFiles(prefix: string): unknown[] {
    if (!fs.existsSync(this.metricsDir)) {
      return [];
    }

    const files = fs.readdirSync(this.metricsDir)
      .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
      .sort()
      .reverse(); // Most recent first

    return files.map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(this.metricsDir, f), 'utf-8'));
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  /**
   * Collect page load metrics from saved JSON files.
   */
  collectPageLoads(): PageLoadResult[] {
    const files = this.readMetricsFiles('page-load-');
    if (files.length === 0) return [];

    // Take the most recent file
    const data = files[0] as Record<string, unknown>;
    const results = (data.results || {}) as Record<string, Record<string, number>>;

    return Object.entries(results).map(([route, metrics]) => ({
      route,
      totalLoadTimeMs: metrics.totalLoadTime || 0,
      ttfbMs: metrics.ttfb,
      domContentLoadedMs: metrics.domContentLoadedEventEnd,
      loadCompleteMs: metrics.loadEventEnd,
    }));
  }

  /**
   * Collect Web Vitals from saved JSON files.
   */
  collectWebVitals(): WebVitalsResult {
    const files = this.readMetricsFiles('web-vitals-summary-');
    if (files.length === 0) {
      // Try individual web vitals files
      const individualFiles = this.readMetricsFiles('web-vitals-');
      if (individualFiles.length === 0) return {};
      const data = individualFiles[0] as Record<string, unknown>;
      return (data.webVitals || {}) as WebVitalsResult;
    }

    const data = files[0] as Record<string, unknown>;
    return (data.webVitals || {}) as WebVitalsResult;
  }

  /**
   * Collect bundle size data from saved JSON files.
   */
  collectBundleSize(): BundleSizeResult | null {
    const files = this.readMetricsFiles('bundle-size-');
    if (files.length === 0) return null;

    const data = files[0] as Record<string, unknown>;
    const summary = data.summary as Record<string, number> | undefined;
    const largeResources = (data.largeResources || []) as { name: string; sizeKB: number }[];

    if (!summary) return null;

    return {
      totalSizeKB: summary.totalSizeKB || 0,
      jsSizeKB: summary.jsSizeKB || 0,
      cssSizeKB: summary.cssSizeKB || 0,
      largeResources,
    };
  }

  /**
   * Collect memory usage data from saved JSON files.
   */
  collectMemory(): MemoryResult | null {
    const files = this.readMetricsFiles('memory-');
    if (files.length === 0) return null;

    const data = files[0] as Record<string, unknown>;
    const delta = data.delta as Record<string, number | boolean> | undefined;

    if (!delta) return null;

    return {
      startMB: delta.startMB as number,
      endMB: delta.endMB as number,
      deltaMB: delta.deltaMB as number,
      potentialLeak: delta.potentialLeak as boolean,
    };
  }

  /**
   * Collect relay performance data from saved JSON files.
   */
  collectRelayPerformance(): RelayPerformanceResult | null {
    const files = this.readMetricsFiles('relay-performance-');
    if (files.length === 0) return null;

    const data = files[0] as Record<string, unknown>;
    return {
      totalConnections: (data as Record<string, number>).totalConnections || 0,
      eoseMessages: (data as Record<string, number>).eoseMessages || 0,
      connectionLogs: (data as Record<string, number>).connectionLogs || 0,
    };
  }

  /**
   * Load a previous performance report for comparison.
   */
  loadPreviousReport(): PerformanceReport | null {
    const reportFile = path.join(this.reportsDir, 'performance-report.json');
    if (!fs.existsSync(reportFile)) return null;

    try {
      return JSON.parse(fs.readFileSync(reportFile, 'utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * Compare current metrics against a previous report and identify regressions.
   */
  compareReports(current: PerformanceReport, previous: PerformanceReport): { regressions: string[]; improvements: string[] } {
    const regressions: string[] = [];
    const improvements: string[] = [];

    // Compare page load times (>20% regression threshold)
    for (const currentPage of current.pageLoads) {
      const previousPage = previous.pageLoads.find(p => p.route === currentPage.route);
      if (previousPage) {
        const ratio = currentPage.totalLoadTimeMs / previousPage.totalLoadTimeMs;
        if (ratio > 1.2) {
          regressions.push(
            `Page load regression for ${currentPage.route}: ${previousPage.totalLoadTimeMs}ms → ${currentPage.totalLoadTimeMs}ms (+${((ratio - 1) * 100).toFixed(0)}%)`
          );
        } else if (ratio < 0.8) {
          improvements.push(
            `Page load improvement for ${currentPage.route}: ${previousPage.totalLoadTimeMs}ms → ${currentPage.totalLoadTimeMs}ms (-${((1 - ratio) * 100).toFixed(0)}%)`
          );
        }
      }
    }

    // Compare bundle size (>10% regression threshold)
    if (current.bundleSize && previous.bundleSize) {
      const ratio = current.bundleSize.totalSizeKB / previous.bundleSize.totalSizeKB;
      if (ratio > 1.1) {
        regressions.push(
          `Bundle size regression: ${previous.bundleSize.totalSizeKB.toFixed(0)}KB → ${current.bundleSize.totalSizeKB.toFixed(0)}KB (+${((ratio - 1) * 100).toFixed(0)}%)`
        );
      } else if (ratio < 0.9) {
        improvements.push(
          `Bundle size improvement: ${previous.bundleSize.totalSizeKB.toFixed(0)}KB → ${current.bundleSize.totalSizeKB.toFixed(0)}KB (-${((1 - ratio) * 100).toFixed(0)}%)`
        );
      }
    }

    // Compare memory usage
    if (current.memory && previous.memory) {
      if (!previous.memory.potentialLeak && current.memory.potentialLeak) {
        regressions.push('New potential memory leak detected');
      } else if (previous.memory.potentialLeak && !current.memory.potentialLeak) {
        improvements.push('Potential memory leak resolved');
      }
    }

    // Compare Web Vitals
    const vitalsComparison: { name: string; key: keyof WebVitalsResult; threshold: number }[] = [
      { name: 'LCP', key: 'lcp', threshold: 0.2 },
      { name: 'CLS', key: 'cls', threshold: 0.5 },
      { name: 'FCP', key: 'fcp', threshold: 0.2 },
    ];

    for (const vc of vitalsComparison) {
      const currentVal = current.webVitals[vc.key];
      const previousVal = previous.webVitals[vc.key];
      if (currentVal !== undefined && previousVal !== undefined && previousVal > 0) {
        const ratio = currentVal / previousVal;
        if (ratio > 1 + vc.threshold) {
          regressions.push(
            `${vc.name} regression: ${previousVal.toFixed(1)} → ${currentVal.toFixed(1)} (+${((ratio - 1) * 100).toFixed(0)}%)`
          );
        } else if (ratio < 1 - vc.threshold) {
          improvements.push(
            `${vc.name} improvement: ${previousVal.toFixed(1)} → ${currentVal.toFixed(1)} (-${((1 - ratio) * 100).toFixed(0)}%)`
          );
        }
      }
    }

    return { regressions, improvements };
  }

  /**
   * Generate the unified performance report.
   */
  generateReport(): PerformanceReport {
    const report: PerformanceReport = {
      collectedAt: new Date().toISOString(),
      pageLoads: this.collectPageLoads(),
      webVitals: this.collectWebVitals(),
      bundleSize: this.collectBundleSize(),
      memory: this.collectMemory(),
      relayPerformance: this.collectRelayPerformance(),
    };

    // Compare with previous report if available
    const previous = this.loadPreviousReport();
    if (previous) {
      const comparison = this.compareReports(report, previous);
      report.comparison = {
        previousCollectedAt: previous.collectedAt,
        ...comparison,
      };
    }

    return report;
  }

  /**
   * Save the unified performance report to disk.
   */
  saveReport(report?: PerformanceReport): string {
    const finalReport = report || this.generateReport();

    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }

    const reportPath = path.join(this.reportsDir, 'performance-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(finalReport, null, 2));

    // Also save a timestamped copy for history
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const historyPath = path.join(this.reportsDir, `performance-report-${timestamp}.json`);
    fs.writeFileSync(historyPath, JSON.stringify(finalReport, null, 2));

    return reportPath;
  }
}
