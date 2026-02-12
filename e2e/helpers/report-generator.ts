/**
 * E2E Test Report Generator
 *
 * Reads all JSON outputs from `test-results/` (test summary, console analysis,
 * performance metrics, network monitoring, memory usage) and generates:
 *
 * 1. A unified `test-results/reports/full-report.json`
 * 2. A human-readable `test-results/reports/test-report.md`
 * 3. Historical comparison against previous reports
 * 4. Improvement suggestions based on collected data
 *
 * Usage:
 *   npx ts-node e2e/helpers/report-generator.ts
 *   // or via npm script:
 *   npm run test:e2e:report:full
 */
import * as fs from 'fs';
import * as path from 'path';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TestResult {
  title: string;
  status: string;
  duration?: number;
  error?: string;
}

interface TestSuiteSummary {
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  failedTests: TestResult[];
  suites: string[];
}

interface PerformanceMetricsSummary {
  pageLoadTimes: Record<string, number>;
  webVitals: {
    lcp?: number;
    fid?: number;
    cls?: number;
    ttfb?: number;
    fcp?: number;
  };
  bundleSizes: {
    totalKB: number;
    largeResources: { url: string; sizeKB: number }[];
  };
  memoryUsage: {
    startMB: number;
    endMB: number;
    deltaMB: number;
    potentialLeak: boolean;
  } | null;
}

interface NetworkSummary {
  totalRequests: number;
  failedRequests: number;
  webSocketConnections: number;
  relayConnections: {
    successful: number;
    failed: number;
    urls: string[];
  };
  avgResponseTime: number;
}

interface ConsoleSummary {
  totalLogs: number;
  errors: number;
  warnings: number;
  nostrLogs: number;
  angularErrors: number;
  uniqueErrors: string[];
  topMessages: { message: string; count: number }[];
}

interface ImprovementSuggestion {
  category: 'performance' | 'errors' | 'network' | 'memory' | 'bundle' | 'general';
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  metric?: string;
}

interface HistoricalComparison {
  previousDate: string;
  regressions: string[];
  improvements: string[];
  unchanged: string[];
}

interface FullReport {
  generatedAt: string;
  testSummary: TestSuiteSummary;
  performance: PerformanceMetricsSummary;
  network: NetworkSummary;
  console: ConsoleSummary;
  suggestions: ImprovementSuggestion[];
  historicalComparison: HistoricalComparison | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RESULTS_DIR = path.join(process.cwd(), 'test-results');
const REPORTS_DIR = path.join(RESULTS_DIR, 'reports');
const METRICS_DIR = path.join(RESULTS_DIR, 'metrics');
const NETWORK_DIR = path.join(RESULTS_DIR, 'network');
const LOGS_DIR = path.join(RESULTS_DIR, 'logs');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJsonFiles(dir: string, pattern?: RegExp): unknown[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const filtered = pattern ? files.filter(f => pattern.test(f)) : files;
  return filtered.map(f => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function readJsonFile(filepath: string): unknown | null {
  try {
    if (!fs.existsSync(filepath)) return null;
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch {
    return null;
  }
}

// ─── Data Collection ─────────────────────────────────────────────────────────

function collectTestSummary(): TestSuiteSummary {
  const resultsFile = path.join(RESULTS_DIR, 'results.json');
  const raw = readJsonFile(resultsFile) as {
    suites?: unknown[];
    stats?: { duration?: number };
  } | null;

  const summary: TestSuiteSummary = {
    totalTests: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    duration: 0,
    failedTests: [],
    suites: [],
  };

  if (!raw) return summary;

  if (raw.stats && typeof raw.stats.duration === 'number') {
    summary.duration = raw.stats.duration;
  }

  function processSuite(suite: {
    title?: string;
    specs?: { title?: string; tests?: { status?: string; expectedStatus?: string; duration?: number; error?: { message?: string } }[] }[];
    suites?: unknown[];
  }): void {
    if (suite.title) {
      summary.suites.push(suite.title);
    }
    for (const spec of (suite.specs || [])) {
      for (const test of (spec.tests || [])) {
        summary.totalTests++;
        const status = test.status || test.expectedStatus || 'unknown';
        if (status === 'passed' || status === 'expected') {
          summary.passed++;
        } else if (status === 'failed' || status === 'unexpected') {
          summary.failed++;
          summary.failedTests.push({
            title: spec.title || 'unknown',
            status,
            duration: test.duration,
            error: test.error?.message,
          });
        } else if (status === 'skipped') {
          summary.skipped++;
        }
      }
    }
    for (const child of (suite.suites || [])) {
      processSuite(child as typeof suite);
    }
  }

  for (const suite of (raw.suites || [])) {
    processSuite(suite as Parameters<typeof processSuite>[0]);
  }

  return summary;
}

function collectPerformanceMetrics(): PerformanceMetricsSummary {
  const metrics: PerformanceMetricsSummary = {
    pageLoadTimes: {},
    webVitals: {},
    bundleSizes: { totalKB: 0, largeResources: [] },
    memoryUsage: null,
  };

  const metricFiles = readJsonFiles(METRICS_DIR) as {
    webVitals?: Record<string, number>;
    navigationTiming?: { loadComplete?: number };
    snapshots?: { usedJSHeapSize: number }[];
    delta?: { startMB: number; endMB: number; deltaMB: number; potentialLeak: boolean };
    resources?: { url: string; transferSize: number }[];
    totalTransferSize?: number;
  }[];

  for (const data of metricFiles) {
    // Web Vitals
    if (data.webVitals) {
      for (const [key, value] of Object.entries(data.webVitals)) {
        if (typeof value === 'number' && !metrics.webVitals[key as keyof typeof metrics.webVitals]) {
          (metrics.webVitals as Record<string, number>)[key] = value;
        }
      }
    }

    // Page load times
    if (data.navigationTiming?.loadComplete) {
      const name = 'page-load';
      metrics.pageLoadTimes[name] = data.navigationTiming.loadComplete;
    }

    // Memory
    if (data.delta) {
      metrics.memoryUsage = data.delta;
    }

    // Bundle sizes
    if (data.resources) {
      let total = 0;
      for (const resource of data.resources) {
        const sizeKB = (resource.transferSize || 0) / 1024;
        total += sizeKB;
        if (sizeKB > 500) {
          metrics.bundleSizes.largeResources.push({
            url: resource.url,
            sizeKB: Math.round(sizeKB),
          });
        }
      }
      metrics.bundleSizes.totalKB = Math.round(total);
    }
    if (data.totalTransferSize) {
      metrics.bundleSizes.totalKB = Math.round(data.totalTransferSize / 1024);
    }
  }

  return metrics;
}

function collectNetworkSummary(): NetworkSummary {
  const summary: NetworkSummary = {
    totalRequests: 0,
    failedRequests: 0,
    webSocketConnections: 0,
    relayConnections: { successful: 0, failed: 0, urls: [] },
    avgResponseTime: 0,
  };

  const networkFiles = readJsonFiles(NETWORK_DIR) as {
    summary?: { totalRequests?: number; failedRequests?: number; webSocketConnections?: number };
    requests?: { duration?: number }[];
    webSockets?: { url?: string }[];
    failedRequests?: unknown[];
  }[];

  let totalDuration = 0;
  let requestCount = 0;

  for (const data of networkFiles) {
    if (data.summary) {
      summary.totalRequests += data.summary.totalRequests || 0;
      summary.failedRequests += data.summary.failedRequests || 0;
      summary.webSocketConnections += data.summary.webSocketConnections || 0;
    }

    if (data.requests) {
      for (const req of data.requests) {
        if (req.duration) {
          totalDuration += req.duration;
          requestCount++;
        }
      }
    }

    if (data.webSockets) {
      for (const ws of data.webSockets) {
        if (ws.url && ws.url.includes('wss://')) {
          summary.relayConnections.successful++;
          if (!summary.relayConnections.urls.includes(ws.url)) {
            summary.relayConnections.urls.push(ws.url);
          }
        }
      }
    }
  }

  summary.avgResponseTime = requestCount > 0 ? Math.round(totalDuration / requestCount) : 0;

  return summary;
}

function collectConsoleSummary(): ConsoleSummary {
  const summary: ConsoleSummary = {
    totalLogs: 0,
    errors: 0,
    warnings: 0,
    nostrLogs: 0,
    angularErrors: 0,
    uniqueErrors: [],
    topMessages: [],
  };

  // Read console analysis reports
  const analysisFiles = readJsonFiles(REPORTS_DIR, /console-analysis/) as {
    totalLogs?: number;
    categorySummary?: Record<string, number>;
    errors?: { text: string }[];
  }[];

  const messageCounts = new Map<string, number>();
  const errorSet = new Set<string>();

  for (const data of analysisFiles) {
    summary.totalLogs += data.totalLogs || 0;
    if (data.categorySummary) {
      summary.errors += data.categorySummary['errors'] || 0;
      summary.warnings += data.categorySummary['warnings'] || 0;
      summary.nostrLogs += data.categorySummary['nostr'] || 0;
      summary.angularErrors += data.categorySummary['angular'] || 0;
    }
    if (data.errors) {
      for (const err of data.errors) {
        const msg = err.text?.substring(0, 200) || 'unknown';
        errorSet.add(msg);
        messageCounts.set(msg, (messageCounts.get(msg) || 0) + 1);
      }
    }
  }

  // Also read raw console log files
  const logFiles = readJsonFiles(LOGS_DIR) as { type?: string; text?: string }[][];
  for (const logs of logFiles) {
    if (Array.isArray(logs)) {
      for (const log of logs) {
        if (log.text) {
          const short = log.text.substring(0, 100);
          messageCounts.set(short, (messageCounts.get(short) || 0) + 1);
        }
      }
    }
  }

  summary.uniqueErrors = Array.from(errorSet).slice(0, 20);
  summary.topMessages = Array.from(messageCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([message, count]) => ({ message, count }));

  return summary;
}

// ─── Improvement Suggestions Engine ──────────────────────────────────────────

function generateSuggestions(
  performance: PerformanceMetricsSummary,
  network: NetworkSummary,
  consoleSummary: ConsoleSummary,
  testSummary: TestSuiteSummary
): ImprovementSuggestion[] {
  const suggestions: ImprovementSuggestion[] = [];

  // Performance suggestions
  if (performance.webVitals.lcp && performance.webVitals.lcp > 2500) {
    suggestions.push({
      category: 'performance',
      severity: performance.webVitals.lcp > 4000 ? 'high' : 'medium',
      title: 'Optimize Largest Contentful Paint (LCP)',
      description: `LCP is ${Math.round(performance.webVitals.lcp)}ms, exceeding the "good" threshold of 2500ms. Consider preloading hero content, optimizing images, or reducing render-blocking resources.`,
      metric: `LCP: ${Math.round(performance.webVitals.lcp)}ms`,
    });
  }

  if (performance.webVitals.cls && performance.webVitals.cls > 0.1) {
    suggestions.push({
      category: 'performance',
      severity: performance.webVitals.cls > 0.25 ? 'high' : 'medium',
      title: 'Reduce Cumulative Layout Shift (CLS)',
      description: `CLS is ${performance.webVitals.cls.toFixed(3)}, exceeding the "good" threshold of 0.1. Set explicit dimensions on images/embeds and avoid inserting content above existing content.`,
      metric: `CLS: ${performance.webVitals.cls.toFixed(3)}`,
    });
  }

  if (performance.webVitals.fcp && performance.webVitals.fcp > 1800) {
    suggestions.push({
      category: 'performance',
      severity: 'medium',
      title: 'Improve First Contentful Paint (FCP)',
      description: `FCP is ${Math.round(performance.webVitals.fcp)}ms. Consider reducing JavaScript bundle size, deferring non-critical resources, or implementing server-side rendering for initial content.`,
      metric: `FCP: ${Math.round(performance.webVitals.fcp)}ms`,
    });
  }

  // Bundle size suggestions
  if (performance.bundleSizes.totalKB > 2000) {
    suggestions.push({
      category: 'bundle',
      severity: performance.bundleSizes.totalKB > 5000 ? 'high' : 'medium',
      title: 'Reduce total bundle size',
      description: `Total bundle size is ${performance.bundleSizes.totalKB}KB. Consider code-splitting, lazy loading routes, and tree-shaking unused dependencies.`,
      metric: `Bundle: ${performance.bundleSizes.totalKB}KB`,
    });
  }

  for (const resource of performance.bundleSizes.largeResources) {
    const urlShort = resource.url.split('/').pop() || resource.url;
    suggestions.push({
      category: 'bundle',
      severity: resource.sizeKB > 1000 ? 'high' : 'medium',
      title: `Large resource: ${urlShort}`,
      description: `Resource "${urlShort}" is ${resource.sizeKB}KB (>500KB). Consider code-splitting this module or lazy-loading it.`,
      metric: `${resource.sizeKB}KB`,
    });
  }

  // Memory suggestions
  if (performance.memoryUsage?.potentialLeak) {
    suggestions.push({
      category: 'memory',
      severity: 'high',
      title: 'Potential memory leak detected',
      description: `Memory grew by ${performance.memoryUsage.deltaMB.toFixed(1)}MB during navigation testing (${performance.memoryUsage.startMB.toFixed(1)}MB → ${performance.memoryUsage.endMB.toFixed(1)}MB). Check for unsubscribed observables, event listeners, or detached DOM nodes.`,
      metric: `+${performance.memoryUsage.deltaMB.toFixed(1)}MB`,
    });
  }

  // Console error suggestions
  if (consoleSummary.errors > 0) {
    suggestions.push({
      category: 'errors',
      severity: consoleSummary.errors > 10 ? 'high' : 'medium',
      title: `${consoleSummary.errors} console errors detected`,
      description: `Found ${consoleSummary.errors} console errors across test runs. ${consoleSummary.uniqueErrors.length} unique errors. Review and fix unhandled exceptions.`,
    });
  }

  if (consoleSummary.angularErrors > 0) {
    suggestions.push({
      category: 'errors',
      severity: 'high',
      title: `${consoleSummary.angularErrors} Angular framework errors`,
      description: 'Angular-specific errors (NG0xxx) detected. These indicate framework-level issues that should be addressed immediately.',
    });
  }

  // Network suggestions
  if (network.failedRequests > 0) {
    suggestions.push({
      category: 'network',
      severity: network.failedRequests > 5 ? 'high' : 'low',
      title: `${network.failedRequests} failed network requests`,
      description: 'Some network requests are failing. Add error handling or retry logic for intermittent failures.',
    });
  }

  if (network.avgResponseTime > 1000) {
    suggestions.push({
      category: 'network',
      severity: 'medium',
      title: 'Slow average response time',
      description: `Average network response time is ${network.avgResponseTime}ms. Consider caching, CDN usage, or API optimization.`,
      metric: `Avg: ${network.avgResponseTime}ms`,
    });
  }

  // Test failures
  if (testSummary.failed > 0) {
    suggestions.push({
      category: 'general',
      severity: 'high',
      title: `${testSummary.failed} test(s) failing`,
      description: `Failed tests: ${testSummary.failedTests.map(t => t.title).join(', ')}. Fix these before merging.`,
    });
  }

  return suggestions.sort((a, b) => {
    const severityOrder = { high: 0, medium: 1, low: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}

// ─── Historical Comparison ───────────────────────────────────────────────────

function compareWithPrevious(current: FullReport): HistoricalComparison | null {
  const previousPath = path.join(REPORTS_DIR, 'full-report-previous.json');
  const previous = readJsonFile(previousPath) as FullReport | null;

  if (!previous) return null;

  const comparison: HistoricalComparison = {
    previousDate: previous.generatedAt,
    regressions: [],
    improvements: [],
    unchanged: [],
  };

  // Compare test pass rate
  const currentPassRate = current.testSummary.totalTests > 0
    ? current.testSummary.passed / current.testSummary.totalTests
    : 0;
  const previousPassRate = previous.testSummary.totalTests > 0
    ? previous.testSummary.passed / previous.testSummary.totalTests
    : 0;

  if (currentPassRate < previousPassRate - 0.01) {
    comparison.regressions.push(
      `Test pass rate decreased: ${(previousPassRate * 100).toFixed(1)}% → ${(currentPassRate * 100).toFixed(1)}%`
    );
  } else if (currentPassRate > previousPassRate + 0.01) {
    comparison.improvements.push(
      `Test pass rate improved: ${(previousPassRate * 100).toFixed(1)}% → ${(currentPassRate * 100).toFixed(1)}%`
    );
  } else {
    comparison.unchanged.push(`Test pass rate: ${(currentPassRate * 100).toFixed(1)}%`);
  }

  // Compare LCP
  if (current.performance.webVitals.lcp && previous.performance.webVitals.lcp) {
    const diff = current.performance.webVitals.lcp - previous.performance.webVitals.lcp;
    if (diff > 200) {
      comparison.regressions.push(
        `LCP increased: ${Math.round(previous.performance.webVitals.lcp)}ms → ${Math.round(current.performance.webVitals.lcp)}ms (+${Math.round(diff)}ms)`
      );
    } else if (diff < -200) {
      comparison.improvements.push(
        `LCP decreased: ${Math.round(previous.performance.webVitals.lcp)}ms → ${Math.round(current.performance.webVitals.lcp)}ms (${Math.round(diff)}ms)`
      );
    }
  }

  // Compare console errors
  const errorDiff = current.console.errors - previous.console.errors;
  if (errorDiff > 0) {
    comparison.regressions.push(`Console errors increased: ${previous.console.errors} → ${current.console.errors} (+${errorDiff})`);
  } else if (errorDiff < 0) {
    comparison.improvements.push(`Console errors decreased: ${previous.console.errors} → ${current.console.errors} (${errorDiff})`);
  }

  // Compare bundle size
  if (current.performance.bundleSizes.totalKB > 0 && previous.performance.bundleSizes.totalKB > 0) {
    const sizeDiff = current.performance.bundleSizes.totalKB - previous.performance.bundleSizes.totalKB;
    if (sizeDiff > 50) {
      comparison.regressions.push(
        `Bundle size increased: ${previous.performance.bundleSizes.totalKB}KB → ${current.performance.bundleSizes.totalKB}KB (+${sizeDiff}KB)`
      );
    } else if (sizeDiff < -50) {
      comparison.improvements.push(
        `Bundle size decreased: ${previous.performance.bundleSizes.totalKB}KB → ${current.performance.bundleSizes.totalKB}KB (${sizeDiff}KB)`
      );
    }
  }

  // Compare failed requests
  if (current.network.failedRequests !== previous.network.failedRequests) {
    const diff = current.network.failedRequests - previous.network.failedRequests;
    if (diff > 0) {
      comparison.regressions.push(`Failed requests increased: ${previous.network.failedRequests} → ${current.network.failedRequests}`);
    } else {
      comparison.improvements.push(`Failed requests decreased: ${previous.network.failedRequests} → ${current.network.failedRequests}`);
    }
  }

  return comparison;
}

// ─── Markdown Report Generator ───────────────────────────────────────────────

function generateMarkdownReport(report: FullReport): string {
  const lines: string[] = [];

  lines.push('# Nostria E2E Test Report');
  lines.push('');
  lines.push(`**Generated:** ${report.generatedAt}`);
  lines.push('');

  // Executive Summary
  lines.push('## Executive Summary');
  lines.push('');
  const passRate = report.testSummary.totalTests > 0
    ? ((report.testSummary.passed / report.testSummary.totalTests) * 100).toFixed(1)
    : '0';
  const statusIcon = report.testSummary.failed === 0 ? 'PASS' : 'FAIL';
  lines.push(`**Status:** ${statusIcon} | **Pass Rate:** ${passRate}% | **Duration:** ${Math.round(report.testSummary.duration / 1000)}s`);
  lines.push('');

  if (report.suggestions.filter(s => s.severity === 'high').length > 0) {
    lines.push(`**High-priority issues:** ${report.suggestions.filter(s => s.severity === 'high').length}`);
    lines.push('');
  }

  // Test Results
  lines.push('## Test Results');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Tests | ${report.testSummary.totalTests} |`);
  lines.push(`| Passed | ${report.testSummary.passed} |`);
  lines.push(`| Failed | ${report.testSummary.failed} |`);
  lines.push(`| Skipped | ${report.testSummary.skipped} |`);
  lines.push(`| Duration | ${Math.round(report.testSummary.duration / 1000)}s |`);
  lines.push('');

  if (report.testSummary.failedTests.length > 0) {
    lines.push('### Failed Tests');
    lines.push('');
    for (const test of report.testSummary.failedTests) {
      lines.push(`- **${test.title}**`);
      if (test.error) {
        lines.push(`  - Error: \`${test.error.substring(0, 200)}\``);
      }
    }
    lines.push('');
  }

  // Performance Metrics
  lines.push('## Performance Metrics');
  lines.push('');

  if (Object.keys(report.performance.webVitals).length > 0) {
    lines.push('### Web Vitals');
    lines.push('');
    lines.push('| Metric | Value | Threshold | Status |');
    lines.push('|--------|-------|-----------|--------|');

    const vitals = report.performance.webVitals;
    if (vitals.lcp !== undefined) {
      const status = vitals.lcp <= 2500 ? 'GOOD' : vitals.lcp <= 4000 ? 'NEEDS IMPROVEMENT' : 'POOR';
      lines.push(`| LCP | ${Math.round(vitals.lcp)}ms | <2500ms | ${status} |`);
    }
    if (vitals.fcp !== undefined) {
      const status = vitals.fcp <= 1800 ? 'GOOD' : vitals.fcp <= 3000 ? 'NEEDS IMPROVEMENT' : 'POOR';
      lines.push(`| FCP | ${Math.round(vitals.fcp)}ms | <1800ms | ${status} |`);
    }
    if (vitals.cls !== undefined) {
      const status = vitals.cls <= 0.1 ? 'GOOD' : vitals.cls <= 0.25 ? 'NEEDS IMPROVEMENT' : 'POOR';
      lines.push(`| CLS | ${vitals.cls.toFixed(3)} | <0.1 | ${status} |`);
    }
    if (vitals.ttfb !== undefined) {
      const status = vitals.ttfb <= 800 ? 'GOOD' : 'NEEDS IMPROVEMENT';
      lines.push(`| TTFB | ${Math.round(vitals.ttfb)}ms | <800ms | ${status} |`);
    }
    if (vitals.fid !== undefined) {
      const status = vitals.fid <= 100 ? 'GOOD' : vitals.fid <= 300 ? 'NEEDS IMPROVEMENT' : 'POOR';
      lines.push(`| FID | ${Math.round(vitals.fid)}ms | <100ms | ${status} |`);
    }
    lines.push('');
  }

  if (report.performance.bundleSizes.totalKB > 0) {
    lines.push('### Bundle Size');
    lines.push('');
    lines.push(`**Total:** ${report.performance.bundleSizes.totalKB}KB`);
    lines.push('');
    if (report.performance.bundleSizes.largeResources.length > 0) {
      lines.push('**Large resources (>500KB):**');
      for (const resource of report.performance.bundleSizes.largeResources) {
        lines.push(`- \`${resource.url.split('/').pop()}\` — ${resource.sizeKB}KB`);
      }
      lines.push('');
    }
  }

  if (report.performance.memoryUsage) {
    lines.push('### Memory Usage');
    lines.push('');
    const mem = report.performance.memoryUsage;
    lines.push(`- Start: ${mem.startMB.toFixed(1)}MB`);
    lines.push(`- End: ${mem.endMB.toFixed(1)}MB`);
    lines.push(`- Delta: ${mem.deltaMB > 0 ? '+' : ''}${mem.deltaMB.toFixed(1)}MB`);
    if (mem.potentialLeak) {
      lines.push('- **WARNING: Potential memory leak detected**');
    }
    lines.push('');
  }

  // Console Error Summary
  lines.push('## Console Log Summary');
  lines.push('');
  lines.push('| Category | Count |');
  lines.push('|----------|-------|');
  lines.push(`| Total Logs | ${report.console.totalLogs} |`);
  lines.push(`| Errors | ${report.console.errors} |`);
  lines.push(`| Warnings | ${report.console.warnings} |`);
  lines.push(`| Nostr Logs | ${report.console.nostrLogs} |`);
  lines.push(`| Angular Errors | ${report.console.angularErrors} |`);
  lines.push('');

  if (report.console.uniqueErrors.length > 0) {
    lines.push('### Unique Errors');
    lines.push('');
    for (const error of report.console.uniqueErrors.slice(0, 10)) {
      lines.push(`- \`${error}\``);
    }
    lines.push('');
  }

  // Network Health
  lines.push('## Network Health');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Requests | ${report.network.totalRequests} |`);
  lines.push(`| Failed Requests | ${report.network.failedRequests} |`);
  lines.push(`| WebSocket Connections | ${report.network.webSocketConnections} |`);
  lines.push(`| Relay Connections | ${report.network.relayConnections.successful} |`);
  lines.push(`| Avg Response Time | ${report.network.avgResponseTime}ms |`);
  lines.push('');

  // Historical Comparison
  if (report.historicalComparison) {
    lines.push('## Historical Comparison');
    lines.push('');
    lines.push(`Compared against report from: ${report.historicalComparison.previousDate}`);
    lines.push('');

    if (report.historicalComparison.regressions.length > 0) {
      lines.push('### Regressions');
      for (const r of report.historicalComparison.regressions) {
        lines.push(`- ${r}`);
      }
      lines.push('');
    }

    if (report.historicalComparison.improvements.length > 0) {
      lines.push('### Improvements');
      for (const i of report.historicalComparison.improvements) {
        lines.push(`- ${i}`);
      }
      lines.push('');
    }
  }

  // Improvement Suggestions
  if (report.suggestions.length > 0) {
    lines.push('## Improvement Suggestions');
    lines.push('');

    const highSuggestions = report.suggestions.filter(s => s.severity === 'high');
    const medSuggestions = report.suggestions.filter(s => s.severity === 'medium');
    const lowSuggestions = report.suggestions.filter(s => s.severity === 'low');

    if (highSuggestions.length > 0) {
      lines.push('### High Priority');
      lines.push('');
      for (const s of highSuggestions) {
        lines.push(`- **${s.title}**${s.metric ? ` (${s.metric})` : ''}`);
        lines.push(`  - ${s.description}`);
      }
      lines.push('');
    }

    if (medSuggestions.length > 0) {
      lines.push('### Medium Priority');
      lines.push('');
      for (const s of medSuggestions) {
        lines.push(`- **${s.title}**${s.metric ? ` (${s.metric})` : ''}`);
        lines.push(`  - ${s.description}`);
      }
      lines.push('');
    }

    if (lowSuggestions.length > 0) {
      lines.push('### Low Priority');
      lines.push('');
      for (const s of lowSuggestions) {
        lines.push(`- **${s.title}**${s.metric ? ` (${s.metric})` : ''}`);
        lines.push(`  - ${s.description}`);
      }
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push('*Generated by Nostria E2E Report Generator*');

  return lines.join('\n');
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

export function generateFullReport(): FullReport {
  ensureDir(REPORTS_DIR);

  const testSummary = collectTestSummary();
  const performance = collectPerformanceMetrics();
  const network = collectNetworkSummary();
  const consoleSummary = collectConsoleSummary();
  const suggestions = generateSuggestions(performance, network, consoleSummary, testSummary);

  const report: FullReport = {
    generatedAt: new Date().toISOString(),
    testSummary,
    performance,
    network,
    console: consoleSummary,
    suggestions,
    historicalComparison: null,
  };

  // Compare with previous report
  report.historicalComparison = compareWithPrevious(report);

  // Save previous report for next comparison
  const currentReportPath = path.join(REPORTS_DIR, 'full-report.json');
  if (fs.existsSync(currentReportPath)) {
    fs.copyFileSync(currentReportPath, path.join(REPORTS_DIR, 'full-report-previous.json'));
  }

  // Save JSON report
  fs.writeFileSync(currentReportPath, JSON.stringify(report, null, 2));
  console.log(`JSON report saved: ${currentReportPath}`);

  // Generate and save Markdown report
  const markdown = generateMarkdownReport(report);
  const mdPath = path.join(REPORTS_DIR, 'test-report.md');
  fs.writeFileSync(mdPath, markdown);
  console.log(`Markdown report saved: ${mdPath}`);

  return report;
}

// Run if executed directly
if (require.main === module) {
  console.log('Generating E2E test report...\n');
  const report = generateFullReport();

  console.log('\n--- Report Summary ---');
  console.log(`Tests: ${report.testSummary.passed}/${report.testSummary.totalTests} passed`);
  console.log(`Errors: ${report.console.errors} console errors`);
  console.log(`Suggestions: ${report.suggestions.length} improvement suggestions`);

  if (report.historicalComparison) {
    const { regressions, improvements } = report.historicalComparison;
    if (regressions.length > 0) {
      console.log(`\nRegressions: ${regressions.length}`);
      for (const r of regressions) console.log(`  - ${r}`);
    }
    if (improvements.length > 0) {
      console.log(`\nImprovements: ${improvements.length}`);
      for (const i of improvements) console.log(`  - ${i}`);
    }
  }
}
