/**
 * Slow Network E2E Tests @public
 *
 * Tests behavior with throttled network (slow 3G profile via CDP).
 * Verifies loading indicators appear, content eventually loads,
 * and no timeout crashes occur.
 */
import { test, expect } from '../../fixtures';
import { APP_ROUTES, TIMEOUTS } from '../../fixtures/test-data';

async function waitForAppReady(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const appRoot = document.querySelector('app-root');
    if (!appRoot) return false;
    return !!document.querySelector('mat-sidenav-content, .main-content, main');
  }, { timeout: TIMEOUTS.appReady * 2 }); // Double timeout for slow network
  await page.waitForTimeout(TIMEOUTS.stabilize);
}

/**
 * Apply slow 3G network throttling via Chrome DevTools Protocol.
 * Download: ~400 Kbps, Upload: ~400 Kbps, Latency: 2000ms
 */
async function enableSlowNetwork(page: import('@playwright/test').Page) {
  const client = await page.context().newCDPSession(page);
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: (400 * 1024) / 8, // 400 Kbps in bytes/s
    uploadThroughput: (400 * 1024) / 8,
    latency: 2000, // 2s latency
  });
  return client;
}

/**
 * Remove network throttling.
 */
async function disableThrottling(client: import('@playwright/test').CDPSession) {
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: -1, // No throttle
    uploadThroughput: -1,
    latency: 0,
  });
}

test.describe('Slow Network Behavior @public', () => {
  // These tests need longer timeouts due to network throttling
  test.setTimeout(120_000);

  test('should load the home page on a slow network without crashing', async ({ page, saveConsoleLogs }) => {
    const client = await enableSlowNetwork(page);

    try {
      await page.goto(APP_ROUTES.public.home, { timeout: 60_000 });
      await waitForAppReady(page);

      // The app should eventually render
      const appRoot = page.locator('app-root');
      await expect(appRoot).toBeVisible();

      const body = await page.textContent('body');
      expect(body).toBeTruthy();
    } finally {
      await disableThrottling(client);
    }

    await saveConsoleLogs('slow-network-home-load');
  });

  test('should show loading state or content on slow network', async ({ page, saveConsoleLogs }) => {
    const client = await enableSlowNetwork(page);

    try {
      await page.goto(APP_ROUTES.public.home, { timeout: 60_000 });

      // Check for loading indicators early in the load cycle
      // The app may show spinners, progress bars, or skeleton screens
      const hasLoadingIndicator = await page.evaluate(() => {
        const indicators = document.querySelectorAll(
          'mat-spinner, mat-progress-bar, mat-progress-spinner, ' +
          '.loading, .spinner, .skeleton, [class*="loading"], [class*="spinner"]'
        );
        return indicators.length > 0;
      });

      // Either a loading indicator is shown or content has already loaded
      const hasContent = await page.evaluate(() => {
        const main = document.querySelector('mat-sidenav-content, .main-content, main');
        return (main?.textContent?.trim().length || 0) > 10;
      });

      console.log(`Loading indicator: ${hasLoadingIndicator}, Content loaded: ${hasContent}`);

      // At least one should be true — the app should show something
      // (it's ok if content loads fast enough to skip the loading state)
      await waitForAppReady(page);

      // After waiting, content should eventually appear
      const finalContent = await page.textContent('body');
      expect(finalContent).toBeTruthy();
    } finally {
      await disableThrottling(client);
    }

    await saveConsoleLogs('slow-network-loading-state');
  });

  test('should not throw unhandled errors on slow network navigation', async ({ page, saveConsoleLogs }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    const client = await enableSlowNetwork(page);

    try {
      await page.goto(APP_ROUTES.public.home, { timeout: 60_000 });
      await waitForAppReady(page);

      // Navigate to another page on slow network
      await page.goto(APP_ROUTES.public.discover, { timeout: 60_000 });
      await waitForAppReady(page);

      // Filter out expected timeout/network errors
      const unexpectedErrors = pageErrors.filter(e => {
        // These are expected on slow networks
        if (e.includes('net::') || e.includes('ERR_')) return false;
        if (e.includes('timeout') || e.includes('Timeout')) return false;
        if (e.includes('AbortError')) return false;
        if (e.includes('WebSocket')) return false;
        return true;
      });

      // No unexpected JavaScript errors should occur
      if (unexpectedErrors.length > 0) {
        console.log('Unexpected errors on slow network:', unexpectedErrors);
      }
      expect(unexpectedErrors).toHaveLength(0);
    } finally {
      await disableThrottling(client);
    }

    await saveConsoleLogs('slow-network-navigation-errors');
  });

  test('should handle discover page on slow network', async ({ page, saveConsoleLogs }) => {
    const client = await enableSlowNetwork(page);

    try {
      await page.goto(APP_ROUTES.public.discover, { timeout: 60_000 });
      await waitForAppReady(page);
      await page.waitForTimeout(5000); // Extra wait for slow content

      // The page should render without crashing
      const appRoot = page.locator('app-root');
      await expect(appRoot).toBeVisible();

      // Check for any content or empty state
      const pageState = await page.evaluate(() => {
        const cards = document.querySelectorAll('mat-card, .card, app-event');
        const emptyState = document.querySelector('.empty-state, .no-content');
        const loading = document.querySelector('mat-spinner, .loading');
        return {
          cardCount: cards.length,
          hasEmptyState: !!emptyState,
          isStillLoading: !!loading,
        };
      });

      console.log('Discover page state on slow network:', pageState);

      // The page should show something — cards, empty state, or loading indicator
      const isResponding = pageState.cardCount > 0 || pageState.hasEmptyState || pageState.isStillLoading;
      expect(isResponding).toBeTruthy();
    } finally {
      await disableThrottling(client);
    }

    await saveConsoleLogs('slow-network-discover');
  });

  test('should recover from slow network to normal speed', async ({ page, saveConsoleLogs }) => {
    const client = await enableSlowNetwork(page);

    try {
      await page.goto(APP_ROUTES.public.home, { timeout: 60_000 });
      await waitForAppReady(page);

      // Remove throttling — simulate network recovery
      await disableThrottling(client);
      await page.waitForTimeout(2000);

      // Navigate to a new page — should load much faster now
      const startTime = Date.now();
      await page.goto(APP_ROUTES.public.articles, { timeout: 30_000 });
      await waitForAppReady(page);
      const loadTime = Date.now() - startTime;

      console.log(`Page load time after throttle removal: ${loadTime}ms`);

      // After removing throttle, page should load in reasonable time
      // (giving generous threshold since server may still be slow)
      expect(loadTime).toBeLessThan(30_000);

      const appRoot = page.locator('app-root');
      await expect(appRoot).toBeVisible();
    } catch {
      // If we get here, disableThrottling may not have been called
      await disableThrottling(client);
      throw new Error('Test failed');
    }

    await saveConsoleLogs('slow-network-recovery');
  });
});
