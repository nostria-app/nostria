/**
 * API Calls E2E Tests @network
 *
 * Monitor HTTP requests to the Nostria API (api.nostria.app or localhost:3000),
 * verify expected endpoints are called, check for failed requests, log
 * response times.
 */
import { test, expect } from '../../fixtures';
import * as fs from 'fs';
import * as path from 'path';

test.describe('API Calls @network', () => {
  test('should monitor HTTP requests during page load', async ({ page, networkMonitor, waitForNostrReady, saveConsoleLogs }) => {
    await page.goto('/');
    await waitForNostrReady();
    await page.waitForTimeout(3000);

    const requests = networkMonitor.requests;
    console.log(`=== HTTP Request Summary ===`);
    console.log(`Total requests: ${requests.length}`);

    // Group by resource type
    const byType: Record<string, number> = {};
    for (const req of requests) {
      byType[req.resourceType] = (byType[req.resourceType] || 0) + 1;
    }
    for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }

    await networkMonitor.save('api-calls-page-load');
    await saveConsoleLogs('api-calls-page-load');
  });

  test('should track API requests to Nostria backend', async ({ page, networkMonitor, waitForNostrReady, saveConsoleLogs }) => {
    await page.goto('/');
    await waitForNostrReady();
    await page.waitForTimeout(5000);

    // Filter for API requests
    const apiRequests = networkMonitor.requests.filter(r =>
      r.url.includes('api.nostria.app') ||
      r.url.includes('localhost:3000') ||
      r.url.includes('nostria')
    );

    console.log(`=== Nostria API Requests ===`);
    console.log(`API requests: ${apiRequests.length}`);

    for (const req of apiRequests) {
      const shortUrl = req.url.length > 100 ? req.url.substring(0, 100) + '...' : req.url;
      console.log(`  ${req.method} ${shortUrl} → ${req.status || 'pending'} (${req.duration || 0}ms)`);
    }

    await networkMonitor.save('api-calls-nostria');
    await saveConsoleLogs('api-calls-nostria');
  });

  test('should report failed HTTP requests', async ({ page, networkMonitor, waitForNostrReady, saveConsoleLogs }) => {
    await page.goto('/');
    await waitForNostrReady();
    await page.waitForTimeout(3000);

    const failed = networkMonitor.failedRequests;
    console.log(`=== Failed Requests ===`);
    console.log(`Total failed: ${failed.length}`);

    // Categorize failures
    const byError: Record<string, number> = {};
    for (const req of failed) {
      const error = req.failureText || 'unknown';
      byError[error] = (byError[error] || 0) + 1;
    }

    for (const [error, count] of Object.entries(byError).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${error}: ${count}`);
    }

    // List first 10 failed requests
    if (failed.length > 0) {
      console.log(`\nFirst ${Math.min(10, failed.length)} failed requests:`);
      for (const req of failed.slice(0, 10)) {
        const shortUrl = req.url.length > 80 ? req.url.substring(0, 80) + '...' : req.url;
        console.log(`  ${req.method} ${shortUrl}: ${req.failureText}`);
      }
    }

    await networkMonitor.save('api-calls-failed');
    await saveConsoleLogs('api-calls-failed');
  });

  test('should measure API response times', async ({ page, networkMonitor, waitForNostrReady, saveConsoleLogs }) => {
    await page.goto('/');
    await waitForNostrReady();
    await page.waitForTimeout(3000);

    // Get requests with response times
    const withDuration = networkMonitor.requests.filter(r => r.duration && r.duration > 0);

    console.log(`=== Response Times ===`);
    console.log(`Requests with timing: ${withDuration.length}`);

    if (withDuration.length > 0) {
      const durations = withDuration.map(r => r.duration!);
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      const max = Math.max(...durations);
      const min = Math.min(...durations);
      const p95 = durations.sort((a, b) => a - b)[Math.floor(durations.length * 0.95)];

      console.log(`  Average: ${avg.toFixed(0)}ms`);
      console.log(`  Min: ${min}ms`);
      console.log(`  Max: ${max}ms`);
      console.log(`  P95: ${p95}ms`);

      // Find slowest requests
      const slowest = withDuration
        .sort((a, b) => (b.duration || 0) - (a.duration || 0))
        .slice(0, 5);

      console.log(`\n  Slowest requests:`);
      for (const req of slowest) {
        const shortUrl = req.url.split('/').slice(-2).join('/');
        console.log(`    ${req.duration}ms - ${req.method} ${shortUrl}`);
      }
    }

    // Save response times report
    const networkDir = path.join(process.cwd(), 'test-results', 'network');
    if (!fs.existsSync(networkDir)) {
      fs.mkdirSync(networkDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(
      path.join(networkDir, `response-times-${timestamp}.json`),
      JSON.stringify({
        requestCount: withDuration.length,
        stats: withDuration.length > 0 ? {
          avgMs: withDuration.map(r => r.duration!).reduce((a, b) => a + b, 0) / withDuration.length,
          maxMs: Math.max(...withDuration.map(r => r.duration!)),
          minMs: Math.min(...withDuration.map(r => r.duration!)),
        } : null,
        slowestRequests: withDuration
          .sort((a, b) => (b.duration || 0) - (a.duration || 0))
          .slice(0, 20)
          .map(r => ({ url: r.url, method: r.method, durationMs: r.duration, status: r.status })),
        collectedAt: new Date().toISOString(),
      }, null, 2)
    );

    await saveConsoleLogs('api-calls-response-times');
  });

  test('should verify no excessive 4xx/5xx responses', async ({ page, networkMonitor, waitForNostrReady, saveConsoleLogs }) => {
    await page.goto('/');
    await waitForNostrReady();
    await page.waitForTimeout(3000);

    // Check for 4xx and 5xx responses
    const clientErrors = networkMonitor.requests.filter(r => r.status && r.status >= 400 && r.status < 500);
    const serverErrors = networkMonitor.requests.filter(r => r.status && r.status >= 500);

    console.log(`=== HTTP Error Summary ===`);
    console.log(`4xx Client Errors: ${clientErrors.length}`);
    console.log(`5xx Server Errors: ${serverErrors.length}`);

    for (const req of clientErrors.slice(0, 10)) {
      const shortUrl = req.url.length > 80 ? req.url.substring(0, 80) + '...' : req.url;
      console.log(`  ${req.status} ${req.method} ${shortUrl}`);
    }

    for (const req of serverErrors.slice(0, 10)) {
      const shortUrl = req.url.length > 80 ? req.url.substring(0, 80) + '...' : req.url;
      console.log(`  ${req.status} ${req.method} ${shortUrl}`);
    }

    // Server errors are concerning
    if (serverErrors.length > 0) {
      console.log(`⚠ ${serverErrors.length} server errors detected`);
    }

    await saveConsoleLogs('api-calls-errors');
  });
});
