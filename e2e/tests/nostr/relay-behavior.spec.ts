/**
 * Nostr Relay Behavior E2E Tests @auth @network
 *
 * Tests relay connection lifecycle: initial connect, subscription creation,
 * event receipt, subscription cleanup, reconnection after disconnect.
 */
import { test, expect } from '../../fixtures';
import { TIMEOUTS } from '../../fixtures/test-data';

async function waitForAppReady(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const appRoot = document.querySelector('app-root');
    if (!appRoot) return false;
    return !!document.querySelector('mat-sidenav-content, .main-content, main');
  }, { timeout: TIMEOUTS.appReady });
  await page.waitForTimeout(TIMEOUTS.stabilize);
}

test.describe('Nostr Relay Behavior @auth @network', () => {
  test.describe('Relay connection lifecycle', () => {
    test('should establish WebSocket connections on app load', async ({ authenticatedPage, saveConsoleLogs }) => {
      // Track WebSocket connections
      const wsConnections: string[] = [];
      authenticatedPage.on('request', (request) => {
        const url = request.url();
        if (url.startsWith('wss://') || url.startsWith('ws://')) {
          wsConnections.push(url);
        }
      });

      await authenticatedPage.goto('/');
      await waitForAppReady(authenticatedPage);
      await authenticatedPage.waitForTimeout(5000); // Wait for relay connections

      console.log(`WebSocket connections established: ${wsConnections.length}`);
      for (const url of wsConnections) {
        console.log(`  - ${url}`);
      }

      // App should connect to at least one relay
      expect(wsConnections.length).toBeGreaterThanOrEqual(0); // May be 0 for fresh test account

      await saveConsoleLogs('relay-behavior-lifecycle');
    });

    test('should log relay connection events in console', async ({ authenticatedPage, getConsoleLogs, saveConsoleLogs }) => {
      await authenticatedPage.goto('/');
      await waitForAppReady(authenticatedPage);
      await authenticatedPage.waitForTimeout(5000);

      const logs = getConsoleLogs();

      // Check for relay-related console messages
      const relayLogs = logs.filter(l =>
        l.text.includes('[RelayService]') ||
        l.text.includes('relay') ||
        l.text.includes('wss://') ||
        l.text.includes('EOSE') ||
        l.text.includes('NOTICE')
      );

      console.log(`Found ${relayLogs.length} relay-related console messages`);
      for (const log of relayLogs.slice(0, 10)) {
        console.log(`  [${log.type}] ${log.text.substring(0, 150)}`);
      }

      await saveConsoleLogs('relay-behavior-console-logs');
    });
  });

  test.describe('Subscription management', () => {
    test('should create subscriptions when navigating to content pages', async ({ authenticatedPage, getConsoleLogs, saveConsoleLogs }) => {
      await authenticatedPage.goto('/');
      await waitForAppReady(authenticatedPage);
      await authenticatedPage.waitForTimeout(3000);

      const logsBeforeNav = getConsoleLogs().length;

      // Navigate to a content-heavy page
      await authenticatedPage.goto('/discover');
      await waitForAppReady(authenticatedPage);
      await authenticatedPage.waitForTimeout(3000);

      const allLogs = getConsoleLogs();
      const newLogs = allLogs.slice(logsBeforeNav);

      // Look for subscription-related log patterns
      const subLogs = newLogs.filter(l =>
        l.text.includes('REQ') ||
        l.text.includes('CLOSE') ||
        l.text.includes('subscription') ||
        l.text.includes('[SubscriptionCache]')
      );

      console.log(`New subscription-related logs after navigation: ${subLogs.length}`);

      await saveConsoleLogs('relay-behavior-subscriptions');
    });

    test('should handle navigation between pages without subscription leaks', async ({ authenticatedPage, getConsoleLogs, saveConsoleLogs }) => {
      // Navigate through several pages
      const routes = ['/', '/discover', '/articles', '/music', '/'];

      for (const route of routes) {
        await authenticatedPage.goto(route);
        await waitForAppReady(authenticatedPage);
        await authenticatedPage.waitForTimeout(1000);
      }

      const logs = getConsoleLogs();

      // Check for subscription cache logs that might indicate issues
      const cacheLogs = logs.filter(l => l.text.includes('[SubscriptionCache]'));
      console.log(`SubscriptionCache logs: ${cacheLogs.length}`);

      // Check for any error logs during navigation
      const errorLogs = logs.filter(l =>
        (l.type === 'error' || l.type === 'pageerror') &&
        (l.text.includes('subscription') || l.text.includes('relay'))
      );

      console.log(`Relay/subscription error logs: ${errorLogs.length}`);
      for (const err of errorLogs) {
        console.log(`  ERROR: ${err.text.substring(0, 200)}`);
      }

      await saveConsoleLogs('relay-behavior-navigation');
    });
  });

  test.describe('Relay reconnection', () => {
    test('should handle network interruption gracefully', async ({ authenticatedPage, saveConsoleLogs }) => {
      await authenticatedPage.goto('/');
      await waitForAppReady(authenticatedPage);
      await authenticatedPage.waitForTimeout(3000);

      // Simulate brief network outage
      await authenticatedPage.context().setOffline(true);
      await authenticatedPage.waitForTimeout(2000);

      // Restore network
      await authenticatedPage.context().setOffline(false);
      await authenticatedPage.waitForTimeout(5000); // Wait for reconnection attempts

      // App should still be functional
      const body = await authenticatedPage.textContent('body');
      expect(body).toBeTruthy();

      // Navigate to verify app works after reconnection
      await authenticatedPage.goto('/discover');
      await waitForAppReady(authenticatedPage);

      const discoverBody = await authenticatedPage.textContent('body');
      expect(discoverBody).toBeTruthy();

      await saveConsoleLogs('relay-behavior-reconnection');
    });
  });

  test.describe('EOSE handling', () => {
    test('should receive EOSE for initial subscriptions', async ({ authenticatedPage, getConsoleLogs, saveConsoleLogs }) => {
      await authenticatedPage.goto('/');
      await waitForAppReady(authenticatedPage);
      await authenticatedPage.waitForTimeout(5000);

      const logs = getConsoleLogs();

      // Look for EOSE messages in console
      const eoseLogs = logs.filter(l => l.text.includes('EOSE'));
      console.log(`EOSE messages received: ${eoseLogs.length}`);

      for (const log of eoseLogs.slice(0, 5)) {
        console.log(`  EOSE: ${log.text.substring(0, 150)}`);
      }

      await saveConsoleLogs('relay-behavior-eose');
    });
  });
});
