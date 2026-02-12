/**
 * Page Load Performance E2E Tests @metrics
 *
 * Measure initial page load time for 5 key routes (/, /discover,
 * /articles, /music, /settings), record Navigation Timing API metrics,
 * save to test-results/metrics/page-load.json.
 */
import { test, expect } from '../../fixtures';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Page Load Performance @metrics', () => {
  const routes = [
    { path: '/', name: 'home' },
    { path: '/discover', name: 'discover' },
    { path: '/articles', name: 'articles' },
    { path: '/music', name: 'music' },
    { path: '/settings', name: 'settings' },
  ];

  const results: Record<string, Record<string, number>> = {};

  for (const route of routes) {
    test(`should measure page load for ${route.name} (${route.path})`, async ({ page, saveConsoleLogs }) => {
      const startTime = Date.now();

      await page.goto(route.path);
      await page.waitForLoadState('networkidle');

      const loadTime = Date.now() - startTime;

      // Collect Navigation Timing API metrics
      const timing = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
        if (!nav) return null;
        return {
          domContentLoadedEventEnd: nav.domContentLoadedEventEnd,
          loadEventEnd: nav.loadEventEnd,
          responseStart: nav.responseStart,
          requestStart: nav.requestStart,
          domInteractive: nav.domInteractive,
          domComplete: nav.domComplete,
          ttfb: nav.responseStart - nav.requestStart,
          dnsLookup: nav.domainLookupEnd - nav.domainLookupStart,
          tcpConnect: nav.connectEnd - nav.connectStart,
          transferSize: nav.transferSize,
          encodedBodySize: nav.encodedBodySize,
          decodedBodySize: nav.decodedBodySize,
        };
      });

      console.log(`Page load for ${route.name}: ${loadTime}ms`);
      if (timing) {
        console.log(`  TTFB: ${timing.ttfb.toFixed(1)}ms`);
        console.log(`  DOM Content Loaded: ${timing.domContentLoadedEventEnd.toFixed(1)}ms`);
        console.log(`  Load Complete: ${timing.loadEventEnd.toFixed(1)}ms`);
        console.log(`  DOM Interactive: ${timing.domInteractive.toFixed(1)}ms`);
      }

      results[route.name] = {
        totalLoadTime: loadTime,
        ...(timing || {}),
      };

      await saveConsoleLogs(`page-load-${route.name}`);
    });
  }

  test.afterAll(async () => {
    // Save all results to JSON
    const metricsDir = path.join(process.cwd(), 'test-results', 'metrics');
    if (!fs.existsSync(metricsDir)) {
      fs.mkdirSync(metricsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filepath = path.join(metricsDir, `page-load-${timestamp}.json`);
    fs.writeFileSync(filepath, JSON.stringify({
      results,
      routes: routes.map(r => r.path),
      collectedAt: new Date().toISOString(),
    }, null, 2));

    console.log(`Page load metrics saved to: ${filepath}`);
  });
});
