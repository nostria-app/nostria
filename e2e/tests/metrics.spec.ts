/**
 * Performance & Metrics E2E Tests @metrics
 *
 * These tests collect performance metrics from the application
 * and generate structured reports for analysis.
 *
 * Run with: npm run test:e2e:metrics
 */
import { test, expect } from '../fixtures';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Navigation timing metrics extracted from the browser
 */
interface NavigationMetrics {
  dnsLookup: number;
  tcpConnect: number;
  ttfb: number;
  domContentLoaded: number;
  loadComplete: number;
  domInteractive: number;
}

/**
 * Resource loading summary
 */
interface ResourceSummary {
  totalResources: number;
  totalTransferSize: number;
  byType: Record<string, { count: number; transferSize: number }>;
}

/**
 * Combined metrics report for a single page
 */
interface PageMetricsReport {
  url: string;
  timestamp: string;
  navigation: NavigationMetrics;
  resources: ResourceSummary;
  jsHeapSize: number | null;
  consoleErrorCount: number;
}

function getReportsDir(): string {
  const dir = path.join(process.cwd(), 'test-results', 'metrics');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function saveReport(name: string, data: unknown): void {
  const filepath = path.join(getReportsDir(), `${name}.json`);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

test.describe('Performance Metrics @metrics', () => {
  test('should collect page load metrics for the home page @metrics', async ({
    page,
    getConsoleLogs,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const navigation = await page.evaluate((): NavigationMetrics => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      return {
        dnsLookup: nav.domainLookupEnd - nav.domainLookupStart,
        tcpConnect: nav.connectEnd - nav.connectStart,
        ttfb: nav.responseStart - nav.requestStart,
        domContentLoaded: nav.domContentLoadedEventEnd - nav.startTime,
        loadComplete: nav.loadEventEnd - nav.startTime,
        domInteractive: nav.domInteractive - nav.startTime,
      };
    });

    const resources = await page.evaluate((): ResourceSummary => {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      const byType: Record<string, { count: number; transferSize: number }> = {};
      let totalTransferSize = 0;

      for (const entry of entries) {
        const ext = entry.name.split('?')[0].split('.').pop() || 'unknown';
        const type = ext.match(/^(js|css|woff2?|ttf|png|jpg|jpeg|svg|webp|json|ico)$/)
          ? ext
          : 'other';
        if (!byType[type]) {
          byType[type] = { count: 0, transferSize: 0 };
        }
        byType[type].count++;
        byType[type].transferSize += entry.transferSize;
        totalTransferSize += entry.transferSize;
      }

      return { totalResources: entries.length, totalTransferSize, byType };
    });

    const jsHeapSize = await page.evaluate((): number | null => {
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return mem ? mem.usedJSHeapSize : null;
    });

    const logs = getConsoleLogs();
    const consoleErrorCount = logs.filter((l) => l.type === 'error' || l.type === 'pageerror').length;

    const report: PageMetricsReport = {
      url: '/',
      timestamp: new Date().toISOString(),
      navigation,
      resources,
      jsHeapSize,
      consoleErrorCount,
    };

    saveReport('home-page-metrics', report);

    // Assert reasonable load times
    expect(navigation.domContentLoaded).toBeGreaterThan(0);
    expect(navigation.loadComplete).toBeGreaterThan(0);
    expect(resources.totalResources).toBeGreaterThan(0);
  });

  test('should collect navigation timing across routes @metrics', async ({
    page,
    getConsoleLogs,
  }) => {
    const routes = ['/', '/discover', '/articles', '/music'];
    const timings: { route: string; loadTime: number; resourceCount: number }[] = [];

    for (const route of routes) {
      await page.evaluate(() => performance.clearResourceTimings());
      const start = Date.now();
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const loadTime = Date.now() - start;

      const resourceCount = await page.evaluate(
        () => performance.getEntriesByType('resource').length
      );

      timings.push({ route, loadTime, resourceCount });
    }

    const logs = getConsoleLogs();
    const consoleErrorCount = logs.filter((l) => l.type === 'error' || l.type === 'pageerror').length;

    saveReport('route-navigation-metrics', {
      timestamp: new Date().toISOString(),
      timings,
      consoleErrorCount,
    });

    // Each route should complete navigation
    for (const timing of timings) {
      expect(timing.loadTime).toBeGreaterThan(0);
    }
  });

  test('should measure Angular bootstrap time @metrics', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for Angular to bootstrap by checking for rendered content inside app-root
    await page.waitForFunction(() => {
      const appRoot = document.querySelector('app-root');
      if (!appRoot) return false;
      const mainContent = document.querySelector('mat-sidenav-content, .main-content, main');
      return !!mainContent;
    }, { timeout: 30_000 });

    const bootstrapMetrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      const appRoot = document.querySelector('app-root');
      const hasContent = appRoot && appRoot.children.length > 0;

      return {
        domInteractive: nav.domInteractive - nav.startTime,
        domContentLoaded: nav.domContentLoadedEventEnd - nav.startTime,
        appRootRendered: hasContent,
        resourceCount: performance.getEntriesByType('resource').length,
      };
    });

    saveReport('angular-bootstrap-metrics', {
      timestamp: new Date().toISOString(),
      ...bootstrapMetrics,
    });

    expect(bootstrapMetrics.appRootRendered).toBe(true);
    expect(bootstrapMetrics.domInteractive).toBeGreaterThan(0);
  });

  test('should measure resource transfer sizes @metrics', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const resources = await page.evaluate(() => {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      return entries
        .map((e) => ({
          name: e.name.split('/').pop()?.split('?')[0] || e.name,
          type: e.initiatorType,
          transferSize: e.transferSize,
          duration: e.duration,
        }))
        .sort((a, b) => b.transferSize - a.transferSize)
        .slice(0, 20);
    });

    const totalSize = resources.reduce((sum, r) => sum + r.transferSize, 0);

    saveReport('resource-transfer-metrics', {
      timestamp: new Date().toISOString(),
      topResources: resources,
      totalTransferSizeBytes: totalSize,
      totalTransferSizeKB: Math.round(totalSize / 1024),
      resourceCount: resources.length,
    });

    // App should load some resources
    expect(resources.length).toBeGreaterThan(0);
  });
});
