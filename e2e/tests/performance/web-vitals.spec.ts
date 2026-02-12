/**
 * Web Vitals Performance E2E Tests @metrics
 *
 * Collect Core Web Vitals (LCP, FID/INP, CLS) for the home page using
 * PerformanceObserver, compare against "good" thresholds (LCP < 2.5s,
 * CLS < 0.1), report pass/fail with actual values.
 */
import { test, expect } from '../../fixtures';
import * as fs from 'fs';
import * as path from 'path';

// Web Vitals "good" thresholds per Google
const THRESHOLDS = {
  lcp: 2500,   // Largest Contentful Paint < 2.5s
  fid: 100,    // First Input Delay < 100ms
  cls: 0.1,    // Cumulative Layout Shift < 0.1
  fcp: 1800,   // First Contentful Paint < 1.8s
  ttfb: 800,   // Time to First Byte < 800ms
};

test.describe('Web Vitals @metrics', () => {
  test('should collect Core Web Vitals for home page', async ({ page, performanceMetrics, saveConsoleLogs }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for LCP to settle
    await page.waitForTimeout(3000);

    // Trigger an interaction for FID measurement
    await page.click('body');
    await page.waitForTimeout(500);

    // Save metrics
    await performanceMetrics.save('web-vitals-home');

    // Report values
    const vitals = performanceMetrics.webVitals;
    console.log('=== Core Web Vitals ===');
    console.log(`LCP: ${vitals.lcp?.toFixed(1) ?? 'N/A'}ms (threshold: <${THRESHOLDS.lcp}ms)`);
    console.log(`FID: ${vitals.fid?.toFixed(1) ?? 'N/A'}ms (threshold: <${THRESHOLDS.fid}ms)`);
    console.log(`CLS: ${vitals.cls?.toFixed(4) ?? 'N/A'} (threshold: <${THRESHOLDS.cls})`);
    console.log(`FCP: ${vitals.fcp?.toFixed(1) ?? 'N/A'}ms (threshold: <${THRESHOLDS.fcp}ms)`);
    console.log(`TTFB: ${vitals.ttfb?.toFixed(1) ?? 'N/A'}ms (threshold: <${THRESHOLDS.ttfb}ms)`);

    // Evaluate against thresholds
    if (vitals.lcp !== undefined) {
      const lcpPass = vitals.lcp < THRESHOLDS.lcp;
      console.log(`LCP: ${lcpPass ? 'PASS' : 'FAIL'}`);
    }

    if (vitals.cls !== undefined) {
      const clsPass = vitals.cls < THRESHOLDS.cls;
      console.log(`CLS: ${clsPass ? 'PASS' : 'FAIL'}`);
    }

    if (vitals.fcp !== undefined) {
      const fcpPass = vitals.fcp < THRESHOLDS.fcp;
      console.log(`FCP: ${fcpPass ? 'PASS' : 'FAIL'}`);
    }

    await saveConsoleLogs('web-vitals-home');
  });

  test('should collect Web Vitals for discover page', async ({ page, performanceMetrics, saveConsoleLogs }) => {
    await page.goto('/discover');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    await performanceMetrics.save('web-vitals-discover');

    const vitals = performanceMetrics.webVitals;
    console.log('=== Discover Page Web Vitals ===');
    console.log(`LCP: ${vitals.lcp?.toFixed(1) ?? 'N/A'}ms`);
    console.log(`CLS: ${vitals.cls?.toFixed(4) ?? 'N/A'}`);
    console.log(`FCP: ${vitals.fcp?.toFixed(1) ?? 'N/A'}ms`);
    console.log(`TTFB: ${vitals.ttfb?.toFixed(1) ?? 'N/A'}ms`);

    await saveConsoleLogs('web-vitals-discover');
  });

  test('should collect Web Vitals for articles page', async ({ page, performanceMetrics, saveConsoleLogs }) => {
    await page.goto('/articles');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    await performanceMetrics.save('web-vitals-articles');

    const vitals = performanceMetrics.webVitals;
    console.log('=== Articles Page Web Vitals ===');
    console.log(`LCP: ${vitals.lcp?.toFixed(1) ?? 'N/A'}ms`);
    console.log(`CLS: ${vitals.cls?.toFixed(4) ?? 'N/A'}`);
    console.log(`FCP: ${vitals.fcp?.toFixed(1) ?? 'N/A'}ms`);
    console.log(`TTFB: ${vitals.ttfb?.toFixed(1) ?? 'N/A'}ms`);

    await saveConsoleLogs('web-vitals-articles');
  });

  test('should generate Web Vitals summary report', async ({ page, performanceMetrics, saveConsoleLogs }) => {
    // Collect for home page as the primary benchmark
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const vitals = performanceMetrics.webVitals;
    const nav = performanceMetrics.navigationTiming;

    // Build summary
    const summary = {
      webVitals: vitals,
      navigationTiming: nav,
      thresholds: THRESHOLDS,
      results: {
        lcp: vitals.lcp !== undefined ? { value: vitals.lcp, threshold: THRESHOLDS.lcp, pass: vitals.lcp < THRESHOLDS.lcp } : null,
        fid: vitals.fid !== undefined ? { value: vitals.fid, threshold: THRESHOLDS.fid, pass: vitals.fid < THRESHOLDS.fid } : null,
        cls: vitals.cls !== undefined ? { value: vitals.cls, threshold: THRESHOLDS.cls, pass: vitals.cls < THRESHOLDS.cls } : null,
        fcp: vitals.fcp !== undefined ? { value: vitals.fcp, threshold: THRESHOLDS.fcp, pass: vitals.fcp < THRESHOLDS.fcp } : null,
        ttfb: vitals.ttfb !== undefined ? { value: vitals.ttfb, threshold: THRESHOLDS.ttfb, pass: vitals.ttfb < THRESHOLDS.ttfb } : null,
      },
      collectedAt: new Date().toISOString(),
    };

    // Save summary
    const metricsDir = path.join(process.cwd(), 'test-results', 'metrics');
    if (!fs.existsSync(metricsDir)) {
      fs.mkdirSync(metricsDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(
      path.join(metricsDir, `web-vitals-summary-${timestamp}.json`),
      JSON.stringify(summary, null, 2)
    );

    console.log('Web Vitals summary report saved');
    await saveConsoleLogs('web-vitals-summary');
  });
});
