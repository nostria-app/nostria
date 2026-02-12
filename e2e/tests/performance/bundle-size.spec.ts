/**
 * Bundle Size Performance E2E Tests @metrics
 *
 * After page load, collect all JS/CSS resource sizes via
 * performance.getEntriesByType('resource'), report total bundle size,
 * flag resources over 500KB, save resource breakdown to JSON.
 */
import { test, expect } from '../../fixtures';
import * as fs from 'fs';
import * as path from 'path';

const SIZE_THRESHOLD_KB = 500; // Flag resources over 500KB

test.describe('Bundle Size @metrics', () => {
  test('should collect resource sizes for home page', async ({ page, saveConsoleLogs }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Collect all resource entries
    const resources = await page.evaluate(() => {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      return entries.map(entry => ({
        name: entry.name,
        type: entry.initiatorType,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize,
        duration: entry.duration,
      }));
    });

    // Categorize resources
    const jsResources = resources.filter(r => r.name.endsWith('.js') || r.type === 'script');
    const cssResources = resources.filter(r => r.name.endsWith('.css') || r.type === 'css');
    const imageResources = resources.filter(r => r.type === 'img' || /\.(png|jpg|jpeg|gif|svg|webp|avif)/.test(r.name));
    const fontResources = resources.filter(r => r.type === 'font' || /\.(woff|woff2|ttf|otf|eot)/.test(r.name));

    // Calculate totals
    const totalJS = jsResources.reduce((sum, r) => sum + (r.transferSize || 0), 0);
    const totalCSS = cssResources.reduce((sum, r) => sum + (r.transferSize || 0), 0);
    const totalImages = imageResources.reduce((sum, r) => sum + (r.transferSize || 0), 0);
    const totalFonts = fontResources.reduce((sum, r) => sum + (r.transferSize || 0), 0);
    const totalAll = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0);

    console.log('=== Bundle Size Report ===');
    console.log(`Total resources: ${resources.length}`);
    console.log(`Total JS: ${(totalJS / 1024).toFixed(1)}KB (${jsResources.length} files)`);
    console.log(`Total CSS: ${(totalCSS / 1024).toFixed(1)}KB (${cssResources.length} files)`);
    console.log(`Total Images: ${(totalImages / 1024).toFixed(1)}KB (${imageResources.length} files)`);
    console.log(`Total Fonts: ${(totalFonts / 1024).toFixed(1)}KB (${fontResources.length} files)`);
    console.log(`Total All: ${(totalAll / 1024).toFixed(1)}KB`);

    // Flag large resources
    const largeResources = resources.filter(r => (r.transferSize || 0) > SIZE_THRESHOLD_KB * 1024);
    if (largeResources.length > 0) {
      console.log(`\n⚠ Resources over ${SIZE_THRESHOLD_KB}KB:`);
      for (const r of largeResources) {
        const filename = r.name.split('/').pop() || r.name;
        console.log(`  ${filename}: ${((r.transferSize || 0) / 1024).toFixed(1)}KB`);
      }
    }

    // Save detailed breakdown
    const metricsDir = path.join(process.cwd(), 'test-results', 'metrics');
    if (!fs.existsSync(metricsDir)) {
      fs.mkdirSync(metricsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(
      path.join(metricsDir, `bundle-size-${timestamp}.json`),
      JSON.stringify({
        summary: {
          totalResources: resources.length,
          totalSizeKB: totalAll / 1024,
          jsSizeKB: totalJS / 1024,
          cssSizeKB: totalCSS / 1024,
          imageSizeKB: totalImages / 1024,
          fontSizeKB: totalFonts / 1024,
          jsFileCount: jsResources.length,
          cssFileCount: cssResources.length,
          largeResourceCount: largeResources.length,
        },
        largeResources: largeResources.map(r => ({
          name: r.name.split('/').pop(),
          fullUrl: r.name,
          sizeKB: (r.transferSize || 0) / 1024,
          type: r.type,
        })),
        jsResources: jsResources.map(r => ({
          name: r.name.split('/').pop(),
          sizeKB: (r.transferSize || 0) / 1024,
          decodedSizeKB: (r.decodedBodySize || 0) / 1024,
        })),
        cssResources: cssResources.map(r => ({
          name: r.name.split('/').pop(),
          sizeKB: (r.transferSize || 0) / 1024,
        })),
        collectedAt: new Date().toISOString(),
      }, null, 2)
    );

    await saveConsoleLogs('bundle-size');
  });

  test('should check for excessive main bundle size', async ({ page, saveConsoleLogs }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const resources = await page.evaluate(() => {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      return entries
        .filter(e => e.name.endsWith('.js') || e.initiatorType === 'script')
        .map(e => ({
          name: e.name,
          transferSize: e.transferSize,
          decodedBodySize: e.decodedBodySize,
        }));
    });

    // Find the main/vendor bundles
    const mainBundle = resources.find(r => r.name.includes('main') || r.name.includes('polyfills'));
    if (mainBundle) {
      const sizeKB = (mainBundle.transferSize || 0) / 1024;
      console.log(`Main bundle: ${(mainBundle.name.split('/').pop())}: ${sizeKB.toFixed(1)}KB (transfer)`);

      // Warn if main bundle is very large
      if (sizeKB > 1000) {
        console.log('⚠ Main bundle exceeds 1MB - consider code splitting');
      }
    }

    await saveConsoleLogs('bundle-size-main');
  });
});
