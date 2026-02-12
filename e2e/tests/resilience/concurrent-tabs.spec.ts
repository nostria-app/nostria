/**
 * Concurrent Tabs E2E Tests @public
 *
 * Opens the app in multiple browser contexts simultaneously.
 * Verifies localStorage synchronization, no race conditions in
 * account state, and proper isolation between tabs.
 */
import { test, expect } from '../../fixtures';
import { APP_ROUTES, TIMEOUTS, STORAGE_KEYS } from '../../fixtures/test-data';
import { TestAuthHelper } from '../../helpers/auth';

async function waitForAppReady(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const appRoot = document.querySelector('app-root');
    if (!appRoot) return false;
    return !!document.querySelector('mat-sidenav-content, .main-content, main');
  }, { timeout: TIMEOUTS.appReady });
  await page.waitForTimeout(TIMEOUTS.stabilize);
}

test.describe('Concurrent Tabs @public', () => {
  test('should open app in two tabs without crashes', async ({ browser, saveConsoleLogs }) => {
    // Create two separate pages in the same browser context
    const context = await browser.newContext();
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    try {
      // Load the app in both tabs simultaneously
      await Promise.all([
        page1.goto(APP_ROUTES.public.home),
        page2.goto(APP_ROUTES.public.home),
      ]);

      await Promise.all([
        waitForAppReady(page1),
        waitForAppReady(page2),
      ]);

      // Both tabs should be functional
      const appRoot1 = page1.locator('app-root');
      const appRoot2 = page2.locator('app-root');

      await expect(appRoot1).toBeVisible();
      await expect(appRoot2).toBeVisible();

      // Both should have content
      const body1 = await page1.textContent('body');
      const body2 = await page2.textContent('body');
      expect(body1).toBeTruthy();
      expect(body2).toBeTruthy();
    } finally {
      await context.close();
    }

    await saveConsoleLogs('concurrent-tabs-basic');
  });

  test('should share localStorage between tabs in the same context', async ({ browser, saveConsoleLogs }) => {
    const context = await browser.newContext();
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    try {
      await page1.goto(APP_ROUTES.public.home);
      await waitForAppReady(page1);

      // Set a value in localStorage from tab 1
      await page1.evaluate((key) => {
        localStorage.setItem(key, 'dark');
      }, STORAGE_KEYS.theme);

      // Navigate tab 2 to the app
      await page2.goto(APP_ROUTES.public.home);
      await waitForAppReady(page2);

      // Tab 2 should see the same localStorage value
      const themeInTab2 = await page2.evaluate((key) => {
        return localStorage.getItem(key);
      }, STORAGE_KEYS.theme);

      expect(themeInTab2).toBe('dark');
    } finally {
      await context.close();
    }

    await saveConsoleLogs('concurrent-tabs-localstorage-sync');
  });

  test('should navigate independently in each tab', async ({ browser, saveConsoleLogs }) => {
    const context = await browser.newContext();
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    try {
      // Navigate to different pages in each tab
      await Promise.all([
        page1.goto(APP_ROUTES.public.home),
        page2.goto(APP_ROUTES.public.discover),
      ]);

      await Promise.all([
        waitForAppReady(page1),
        waitForAppReady(page2),
      ]);

      // Each tab should be on its expected route
      expect(page1.url()).toContain('/');
      expect(page2.url()).toContain('/discover');

      // Navigate tab 1 to a different page
      await page1.goto(APP_ROUTES.public.articles);
      await waitForAppReady(page1);

      // Tab 2 should still be on discover
      expect(page2.url()).toContain('/discover');

      // Both should still be functional
      await expect(page1.locator('app-root')).toBeVisible();
      await expect(page2.locator('app-root')).toBeVisible();
    } finally {
      await context.close();
    }

    await saveConsoleLogs('concurrent-tabs-independent-nav');
  });

  test('should handle auth state across tabs', async ({ browser, saveConsoleLogs }) => {
    const context = await browser.newContext();

    // Inject auth into context-level storage before creating pages
    const { auth } = TestAuthHelper.fromEnvOrGenerate();
    const user = auth.buildNostrUser();

    const page1 = await context.newPage();

    try {
      // Set auth in tab 1
      await page1.goto(APP_ROUTES.public.home);
      await page1.evaluate(({ accountJson, accountsJson }) => {
        localStorage.setItem('nostria-account', accountJson);
        localStorage.setItem('nostria-accounts', accountsJson);
      }, {
        accountJson: JSON.stringify(user),
        accountsJson: JSON.stringify([user]),
      });

      // Open tab 2 — it should see the auth state
      const page2 = await context.newPage();
      await page2.goto(APP_ROUTES.public.home);
      await waitForAppReady(page2);

      const hasAuthInTab2 = await page2.evaluate(() => {
        return localStorage.getItem('nostria-account') !== null;
      });
      expect(hasAuthInTab2).toBeTruthy();

      // Clear auth from tab 1
      await page1.evaluate(() => {
        localStorage.removeItem('nostria-account');
        localStorage.removeItem('nostria-accounts');
      });

      // After clearing, tab 2's localStorage check should reflect the change
      // (Note: the app in tab 2 won't automatically update without a storage event listener)
      const hasAuthAfterClear = await page2.evaluate(() => {
        return localStorage.getItem('nostria-account') !== null;
      });
      expect(hasAuthAfterClear).toBeFalsy();

      await page2.close();
    } finally {
      await context.close();
    }

    await saveConsoleLogs('concurrent-tabs-auth-state');
  });

  test('should not have race conditions with concurrent page loads', async ({ browser, saveConsoleLogs }) => {
    const context = await browser.newContext();
    const pages: import('@playwright/test').Page[] = [];

    try {
      // Open 4 tabs simultaneously
      for (let i = 0; i < 4; i++) {
        pages.push(await context.newPage());
      }

      // Navigate all tabs simultaneously
      const routes = [
        APP_ROUTES.public.home,
        APP_ROUTES.public.discover,
        APP_ROUTES.public.articles,
        APP_ROUTES.public.music,
      ];

      await Promise.all(
        pages.map((page, i) => page.goto(routes[i]))
      );

      // Wait for all to be ready
      await Promise.all(
        pages.map(page => waitForAppReady(page))
      );

      // Track page errors across all tabs
      const errorsByTab: string[][] = pages.map(() => []);
      pages.forEach((page, i) => {
        page.on('pageerror', (error) => {
          errorsByTab[i].push(error.message);
        });
      });

      await Promise.all(pages.map(p => p.waitForTimeout(3000)));

      // All tabs should be functional
      for (const page of pages) {
        const appRoot = page.locator('app-root');
        await expect(appRoot).toBeVisible();
      }

      // No critical race-condition errors should have occurred
      const allErrors = errorsByTab.flat().filter(e =>
        !e.includes('WebSocket') && !e.includes('net::') && !e.includes('relay')
      );

      if (allErrors.length > 0) {
        console.log('Errors across tabs:', allErrors);
      }

      // Allow some non-critical errors but no crashes
      // (Race conditions would manifest as TypeError, ReferenceError, etc.)
      const raceErrors = allErrors.filter(e =>
        e.includes('TypeError') || e.includes('ReferenceError') ||
        e.includes('Cannot read') || e.includes('is not a function')
      );
      expect(raceErrors).toHaveLength(0);
    } finally {
      await context.close();
    }

    await saveConsoleLogs('concurrent-tabs-race-conditions');
  });

  test('should handle rapid tab switching without state corruption', async ({ browser, saveConsoleLogs }) => {
    const context = await browser.newContext();
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    try {
      await page1.goto(APP_ROUTES.public.home);
      await waitForAppReady(page1);

      await page2.goto(APP_ROUTES.public.discover);
      await waitForAppReady(page2);

      // Simulate rapid "tab switching" by interacting with each page alternately
      for (let i = 0; i < 5; i++) {
        // Interact with page 1
        await page1.evaluate(() => window.scrollBy(0, 200));
        await page1.waitForTimeout(100);

        // Interact with page 2
        await page2.evaluate(() => window.scrollBy(0, 200));
        await page2.waitForTimeout(100);
      }

      // Both pages should still be functional
      await expect(page1.locator('app-root')).toBeVisible();
      await expect(page2.locator('app-root')).toBeVisible();

      // localStorage should be consistent across both tabs
      const storage1 = await page1.evaluate(() => {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k) keys.push(k);
        }
        return keys.sort();
      });

      const storage2 = await page2.evaluate(() => {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k) keys.push(k);
        }
        return keys.sort();
      });

      // Same context = same localStorage
      expect(storage1).toEqual(storage2);
    } finally {
      await context.close();
    }

    await saveConsoleLogs('concurrent-tabs-rapid-switch');
  });
});
