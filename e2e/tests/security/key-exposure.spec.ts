/**
 * Key Exposure Security E2E Tests @auth @security
 *
 * Verifies that private keys are never exposed in: DOM attributes,
 * console logs, network requests (HTTP bodies/headers), URL parameters,
 * or visible UI elements (except explicitly in settings key export).
 */
import { test, expect } from '../../fixtures';
import { APP_ROUTES, TIMEOUTS } from '../../fixtures/test-data';
import { TestAuthHelper } from '../../helpers/auth';

async function waitForAppReady(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const appRoot = document.querySelector('app-root');
    if (!appRoot) return false;
    return !!document.querySelector('mat-sidenav-content, .main-content, main');
  }, { timeout: TIMEOUTS.appReady });
  await page.waitForTimeout(TIMEOUTS.stabilize);
}

test.describe('Key Exposure Security @auth @security', () => {
  let testPrivkeyHex: string;
  let testNsec: string;

  test.beforeAll(() => {
    const { auth } = TestAuthHelper.fromEnvOrGenerate();
    testPrivkeyHex = auth.privkey;
    testNsec = auth.nsec;
  });

  test('should not expose private key in DOM attributes', async ({ authenticatedPage: page, saveConsoleLogs }) => {
    await page.goto(APP_ROUTES.public.home);
    await waitForAppReady(page);
    await page.waitForTimeout(TIMEOUTS.contentLoad);

    // Search the entire DOM for the private key in any attribute
    const keyInDOM = await page.evaluate((privkey) => {
      const allElements = document.querySelectorAll('*');
      const found: string[] = [];

      for (const el of allElements) {
        // Check all attributes
        for (const attr of el.attributes) {
          if (attr.value.includes(privkey)) {
            found.push(`Element <${el.tagName}> attribute "${attr.name}" contains private key`);
          }
        }

        // Check data attributes specifically
        if (el instanceof HTMLElement) {
          for (const [key, value] of Object.entries(el.dataset)) {
            if (value && value.includes(privkey)) {
              found.push(`Element <${el.tagName}> data-${key} contains private key`);
            }
          }
        }
      }

      return found;
    }, testPrivkeyHex);

    expect(keyInDOM).toHaveLength(0);

    // Also check for nsec in DOM
    const nsecInDOM = await page.evaluate((nsec) => {
      const allElements = document.querySelectorAll('*');
      const found: string[] = [];

      for (const el of allElements) {
        for (const attr of el.attributes) {
          if (attr.value.includes(nsec)) {
            found.push(`Element <${el.tagName}> attribute "${attr.name}" contains nsec`);
          }
        }
      }

      return found;
    }, testNsec);

    expect(nsecInDOM).toHaveLength(0);

    await saveConsoleLogs('security-key-dom-exposure');
  });

  test('should not expose private key in console logs', async ({ authenticatedPage: page, saveConsoleLogs }) => {
    // Collect all console messages
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      consoleLogs.push(msg.text());
    });

    await page.goto(APP_ROUTES.public.home);
    await waitForAppReady(page);
    await page.waitForTimeout(TIMEOUTS.contentLoad);

    // Navigate through several pages to trigger logging
    await page.goto(APP_ROUTES.authenticated.settings);
    await waitForAppReady(page);
    await page.goto(APP_ROUTES.authenticated.relays);
    await waitForAppReady(page);

    // Check that no console log contains the private key
    const logsWithPrivkey = consoleLogs.filter(log =>
      log.includes(testPrivkeyHex) || log.includes(testNsec)
    );

    if (logsWithPrivkey.length > 0) {
      console.log('WARNING: Private key found in console logs:');
      logsWithPrivkey.forEach(log => {
        // Truncate to avoid printing the full key
        console.log(`  ${log.substring(0, 100)}...`);
      });
    }

    expect(logsWithPrivkey).toHaveLength(0);

    await saveConsoleLogs('security-key-console-exposure');
  });

  test('should not expose private key in network requests', async ({ authenticatedPage: page, saveConsoleLogs }) => {
    const requestsWithKey: string[] = [];

    // Monitor all HTTP requests for the private key
    page.on('request', (request) => {
      const url = request.url();
      const postData = request.postData() || '';
      const headers = JSON.stringify(request.headers());

      if (url.includes(testPrivkeyHex) || url.includes(testNsec)) {
        requestsWithKey.push(`URL contains key: ${url}`);
      }
      if (postData.includes(testPrivkeyHex) || postData.includes(testNsec)) {
        requestsWithKey.push(`POST body contains key: ${url}`);
      }
      if (headers.includes(testPrivkeyHex) || headers.includes(testNsec)) {
        requestsWithKey.push(`Headers contain key: ${url}`);
      }
    });

    await page.goto(APP_ROUTES.public.home);
    await waitForAppReady(page);
    await page.waitForTimeout(TIMEOUTS.contentLoad);

    // Navigate to pages that might trigger API calls
    await page.goto(APP_ROUTES.authenticated.settings);
    await waitForAppReady(page);
    await page.goto(APP_ROUTES.authenticated.notifications);
    await waitForAppReady(page);
    await page.goto(APP_ROUTES.authenticated.messages);
    await waitForAppReady(page);

    if (requestsWithKey.length > 0) {
      console.log('WARNING: Private key found in network requests:');
      requestsWithKey.forEach(r => console.log(`  ${r}`));
    }

    expect(requestsWithKey).toHaveLength(0);

    await saveConsoleLogs('security-key-network-exposure');
  });

  test('should not expose private key in URL parameters', async ({ authenticatedPage: page, saveConsoleLogs }) => {
    // Track all URL changes
    const visitedUrls: string[] = [];

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        visitedUrls.push(frame.url());
      }
    });

    await page.goto(APP_ROUTES.public.home);
    await waitForAppReady(page);

    // Navigate through various pages
    const routes = [
      APP_ROUTES.authenticated.settings,
      APP_ROUTES.authenticated.accounts,
      APP_ROUTES.authenticated.relays,
      APP_ROUTES.authenticated.messages,
    ];

    for (const route of routes) {
      await page.goto(route);
      await waitForAppReady(page);
    }

    // Check no URL contained the private key
    const urlsWithKey = visitedUrls.filter(url =>
      url.includes(testPrivkeyHex) || url.includes(testNsec)
    );

    expect(urlsWithKey).toHaveLength(0);

    await saveConsoleLogs('security-key-url-exposure');
  });

  test('should not display private key in visible UI text', async ({ authenticatedPage: page, saveConsoleLogs }) => {
    await page.goto(APP_ROUTES.public.home);
    await waitForAppReady(page);

    // Check visible text on main pages for the private key
    const pagesToCheck = [
      APP_ROUTES.public.home,
      APP_ROUTES.authenticated.settings,
      APP_ROUTES.authenticated.accounts,
    ];

    for (const route of pagesToCheck) {
      await page.goto(route);
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      const bodyText = await page.textContent('body') || '';

      // The private key (hex) should never appear in visible text
      const hasPrivkeyInText = bodyText.includes(testPrivkeyHex);
      if (hasPrivkeyInText) {
        console.log(`WARNING: Private key hex found in visible text on ${route}`);
      }
      expect(hasPrivkeyInText).toBeFalsy();

      // nsec should only appear in explicit key export/display areas
      if (bodyText.includes(testNsec)) {
        // Check if it's in a key-display section (settings key export)
        const isInExportSection = await page.evaluate((nsec) => {
          const exportElements = document.querySelectorAll(
            '.key-export, .nsec-display, [class*="key-display"], [class*="backup"]'
          );
          for (const el of exportElements) {
            if (el.textContent?.includes(nsec)) return true;
          }
          return false;
        }, testNsec);

        if (!isInExportSection) {
          console.log(`WARNING: nsec found in visible text outside export section on ${route}`);
          expect(isInExportSection).toBeTruthy();
        }
      }
    }

    await saveConsoleLogs('security-key-visible-text');
  });

  test('should not store private key in unencrypted cookies', async ({ authenticatedPage: page, saveConsoleLogs }) => {
    await page.goto(APP_ROUTES.public.home);
    await waitForAppReady(page);

    // Check all cookies
    const cookies = await page.context().cookies();
    const cookiesWithKey = cookies.filter(cookie =>
      cookie.value.includes(testPrivkeyHex) || cookie.value.includes(testNsec)
    );

    if (cookiesWithKey.length > 0) {
      console.log('WARNING: Private key found in cookies:');
      cookiesWithKey.forEach(c => console.log(`  Cookie "${c.name}"`));
    }

    expect(cookiesWithKey).toHaveLength(0);

    await saveConsoleLogs('security-key-cookies');
  });
});
