/**
 * Offline Behavior E2E Tests @public
 *
 * Tests offline resilience: disconnect network via page.context().setOffline(true),
 * verify the app shows an offline indicator or degrades gracefully,
 * cached content remains visible, and reconnection restores functionality.
 */
import { test, expect } from '../../fixtures';
import { APP_ROUTES, TIMEOUTS } from '../../fixtures/test-data';

async function waitForAppReady(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const appRoot = document.querySelector('app-root');
    if (!appRoot) return false;
    return !!document.querySelector('mat-sidenav-content, .main-content, main');
  }, { timeout: TIMEOUTS.appReady });
  await page.waitForTimeout(TIMEOUTS.stabilize);
}

test.describe('Offline Behavior @public', () => {
  test('should load the app initially while online', async ({ page, saveConsoleLogs }) => {
    await page.goto(APP_ROUTES.public.home);
    await waitForAppReady(page);

    // Verify the app loaded successfully while online
    const body = await page.textContent('body');
    expect(body).toBeTruthy();

    // App root should be present
    const appRoot = page.locator('app-root');
    await expect(appRoot).toBeVisible();

    await saveConsoleLogs('offline-initial-load');
  });

  test('should not crash when network goes offline', async ({ page, saveConsoleLogs }) => {
    await page.goto(APP_ROUTES.public.home);
    await waitForAppReady(page);

    // Go offline
    await page.context().setOffline(true);

    // Wait a moment for the app to detect offline state
    await page.waitForTimeout(2000);

    // The app should still be visible and not crash
    const appRoot = page.locator('app-root');
    await expect(appRoot).toBeVisible();

    // Body should still have content (cached/rendered)
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
    expect(body!.length).toBeGreaterThan(0);

    // Restore online state
    await page.context().setOffline(false);

    await saveConsoleLogs('offline-network-disconnect');
  });

  test('should preserve rendered content when going offline', async ({ page, saveConsoleLogs }) => {
    await page.goto(APP_ROUTES.public.home);
    await waitForAppReady(page);
    await page.waitForTimeout(TIMEOUTS.contentLoad);

    // Capture content while online
    const onlineContent = await page.evaluate(() => {
      const main = document.querySelector('mat-sidenav-content, .main-content, main');
      return main?.textContent?.trim() || '';
    });

    // Go offline
    await page.context().setOffline(true);
    await page.waitForTimeout(1000);

    // Capture content while offline — rendered DOM should persist
    const offlineContent = await page.evaluate(() => {
      const main = document.querySelector('mat-sidenav-content, .main-content, main');
      return main?.textContent?.trim() || '';
    });

    // The main content area should still have content
    expect(offlineContent.length).toBeGreaterThan(0);

    // Restore online state
    await page.context().setOffline(false);

    await saveConsoleLogs('offline-preserve-content');
  });

  test('should recover when going back online', async ({ page, saveConsoleLogs }) => {
    await page.goto(APP_ROUTES.public.home);
    await waitForAppReady(page);

    // Go offline
    await page.context().setOffline(true);
    await page.waitForTimeout(2000);

    // Go back online
    await page.context().setOffline(false);
    await page.waitForTimeout(3000);

    // The app should still be functional
    const appRoot = page.locator('app-root');
    await expect(appRoot).toBeVisible();

    // Try navigating to another page to confirm recovery
    await page.goto(APP_ROUTES.public.discover);
    await waitForAppReady(page);

    const body = await page.textContent('body');
    expect(body).toBeTruthy();

    await saveConsoleLogs('offline-recovery');
  });

  test('should handle navigation attempts while offline', async ({ page, saveConsoleLogs }) => {
    await page.goto(APP_ROUTES.public.home);
    await waitForAppReady(page);

    // Go offline
    await page.context().setOffline(true);
    await page.waitForTimeout(1000);

    // Track page errors during offline navigation
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    // Attempt in-app navigation (SPA routing should still work since it's client-side)
    // Click a navigation link if available
    const navLinks = page.locator('mat-sidenav a, .sidenav a, nav a');
    const linkCount = await navLinks.count();

    if (linkCount > 0) {
      // Click the first available navigation link
      await navLinks.first().click().catch(() => {
        // Navigation might fail offline — that's acceptable
      });
      await page.waitForTimeout(1000);
    }

    // The app should not have crashed
    const appRoot = page.locator('app-root');
    await expect(appRoot).toBeVisible();

    // Restore online state
    await page.context().setOffline(false);

    await saveConsoleLogs('offline-navigation-attempt');
  });

  test('should show no unrecoverable errors after offline/online cycle', async ({ page, saveConsoleLogs }) => {
    await page.goto(APP_ROUTES.public.home);
    await waitForAppReady(page);

    // Cycle offline and online multiple times
    for (let i = 0; i < 3; i++) {
      await page.context().setOffline(true);
      await page.waitForTimeout(500);
      await page.context().setOffline(false);
      await page.waitForTimeout(1000);
    }

    // After cycling, the app should still be functional
    const appRoot = page.locator('app-root');
    await expect(appRoot).toBeVisible();

    // Check for Angular-specific crashes
    const hasCrashed = await page.evaluate(() => {
      // Angular would replace content with error overlay on unrecoverable error
      return document.querySelector('.cdk-overlay-container')?.textContent?.includes('Error') || false;
    });
    expect(hasCrashed).toBeFalsy();

    await saveConsoleLogs('offline-cycle-recovery');
  });
});
