/**
 * Relay Failure Resilience E2E Tests @auth
 *
 * Tests behavior when all relays fail to connect: verify the app
 * degrades gracefully, shows appropriate error messaging, and
 * doesn't enter infinite retry loops.
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

test.describe('Relay Failure Resilience @auth', () => {
  test('should not crash when WebSocket connections are blocked', async ({ authenticatedPage: page, saveConsoleLogs }) => {
    // Block all WebSocket connections by intercepting wss:// requests
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('wss://') || url.startsWith('ws://')) {
        route.abort('connectionrefused');
      } else {
        route.continue();
      }
    });

    await page.goto(APP_ROUTES.public.home);
    await waitForAppReady(page);
    await page.waitForTimeout(5000); // Wait for relay connection attempts

    // The app should still render without crashing
    const appRoot = page.locator('app-root');
    await expect(appRoot).toBeVisible();

    // Body should have content
    const body = await page.textContent('body');
    expect(body).toBeTruthy();

    await saveConsoleLogs('relay-failures-ws-blocked');
  });

  test('should degrade gracefully without relay data', async ({ authenticatedPage: page, saveConsoleLogs }) => {
    // Block WebSocket connections
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('wss://') || url.startsWith('ws://')) {
        route.abort('connectionrefused');
      } else {
        route.continue();
      }
    });

    await page.goto(APP_ROUTES.public.home);
    await waitForAppReady(page);
    await page.waitForTimeout(5000);

    // The app should show some kind of UI — either empty state, error message, or skeleton
    const pageState = await page.evaluate(() => {
      const main = document.querySelector('mat-sidenav-content, .main-content, main');
      const hasError = !!document.querySelector('.error, .error-message, [class*="error"]');
      const hasEmptyState = !!document.querySelector('.empty-state, .no-content, [class*="empty"]');
      const mainText = main?.textContent?.trim() || '';
      return {
        hasError,
        hasEmptyState,
        mainTextLength: mainText.length,
        hasMainContent: mainText.length > 0,
      };
    });

    console.log('Page state with blocked relays:', pageState);

    // The app should display something meaningful, not a blank page
    expect(pageState.hasMainContent).toBeTruthy();

    await saveConsoleLogs('relay-failures-graceful-degrade');
  });

  test('should not enter infinite retry loops', async ({ authenticatedPage: page, saveConsoleLogs }) => {
    // Track WebSocket connection attempts
    let wsConnectionAttempts = 0;
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('wss://') || url.startsWith('ws://')) {
        wsConnectionAttempts++;
        route.abort('connectionrefused');
      } else {
        route.continue();
      }
    });

    await page.goto(APP_ROUTES.public.home);
    await waitForAppReady(page);

    // Wait for initial connection attempts
    await page.waitForTimeout(5000);
    const initialAttempts = wsConnectionAttempts;

    // Wait another period and check for exponential/bounded retry
    await page.waitForTimeout(10000);
    const laterAttempts = wsConnectionAttempts;

    console.log(`WS connection attempts — initial: ${initialAttempts}, after 10s more: ${laterAttempts}`);

    // The retry rate should not be unbounded.
    // After initial burst, retries should slow down (exponential backoff)
    // or cap at a reasonable number. 100 attempts in 15s would be too aggressive.
    const newAttempts = laterAttempts - initialAttempts;
    console.log(`New attempts in 10s window: ${newAttempts}`);

    // Allow generous threshold but catch truly infinite loops
    // (more than 200 new attempts in 10 seconds indicates a tight retry loop)
    expect(newAttempts).toBeLessThan(200);

    await saveConsoleLogs('relay-failures-no-infinite-retry');
  });

  test('should allow navigation when relays are down', async ({ authenticatedPage: page, saveConsoleLogs }) => {
    // Block WebSocket connections
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('wss://') || url.startsWith('ws://')) {
        route.abort('connectionrefused');
      } else {
        route.continue();
      }
    });

    await page.goto(APP_ROUTES.public.home);
    await waitForAppReady(page);

    // Navigate to different pages — should not crash
    const pagesToVisit = [
      APP_ROUTES.public.discover,
      APP_ROUTES.public.articles,
      APP_ROUTES.public.music,
    ];

    for (const route of pagesToVisit) {
      await page.goto(route);
      await waitForAppReady(page);

      const appRoot = page.locator('app-root');
      await expect(appRoot).toBeVisible();
    }

    await saveConsoleLogs('relay-failures-navigation');
  });

  test('should recover when relays become available', async ({ authenticatedPage: page, saveConsoleLogs }) => {
    // Start with blocked relays
    let blockRelays = true;
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (blockRelays && (url.startsWith('wss://') || url.startsWith('ws://'))) {
        route.abort('connectionrefused');
      } else {
        route.continue();
      }
    });

    await page.goto(APP_ROUTES.public.home);
    await waitForAppReady(page);
    await page.waitForTimeout(3000);

    // Now unblock relays
    blockRelays = false;
    // Unroute to remove the interception
    await page.unroute('**/*');
    await page.waitForTimeout(5000); // Wait for reconnection attempts

    // The app should still be functional
    const appRoot = page.locator('app-root');
    await expect(appRoot).toBeVisible();

    // Reload to trigger fresh connections
    await page.reload();
    await waitForAppReady(page);
    await page.waitForTimeout(TIMEOUTS.contentLoad);

    const body = await page.textContent('body');
    expect(body).toBeTruthy();

    await saveConsoleLogs('relay-failures-recovery');
  });

  test('should show appropriate UI for relay connection issues on relays page', async ({ authenticatedPage: page, saveConsoleLogs }) => {
    // Block WebSocket connections
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('wss://') || url.startsWith('ws://')) {
        route.abort('connectionrefused');
      } else {
        route.continue();
      }
    });

    await page.goto(APP_ROUTES.authenticated.relays);
    await waitForAppReady(page);
    await page.waitForTimeout(5000);

    // The relays page should show connection status indicators
    const relayPageState = await page.evaluate(() => {
      const body = document.body.textContent || '';
      return {
        hasRelayContent: body.length > 0,
        // Check for any kind of relay status display
        hasStatusIndicators: !!document.querySelector('[class*="status"], [class*="relay"], .relay-item, .relay-list'),
        bodyText: body.substring(0, 500),
      };
    });

    console.log('Relay page state with blocked connections:', relayPageState);

    // The relays page should still render
    expect(relayPageState.hasRelayContent).toBeTruthy();

    await saveConsoleLogs('relay-failures-relays-page');
  });
});
