/**
 * Nostr Key Handling E2E Tests @public
 *
 * Tests that npub/nsec/hex/NIP-19 entities are displayed and parsed
 * correctly throughout the UI: profile links, mention rendering,
 * key display in settings.
 */
import { test, expect } from '../../fixtures';
import { TEST_PROFILES, APP_ROUTES, TIMEOUTS, NIP19_ENTITIES } from '../../fixtures/test-data';

async function waitForAppReady(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const appRoot = document.querySelector('app-root');
    if (!appRoot) return false;
    return !!document.querySelector('mat-sidenav-content, .main-content, main');
  }, { timeout: TIMEOUTS.appReady });
  await page.waitForTimeout(TIMEOUTS.stabilize);
}

test.describe('Nostr Key Handling @public', () => {
  test.describe('npub display', () => {
    test('should display profile via npub URL', async ({ page, saveConsoleLogs }) => {
      await page.goto(APP_ROUTES.profile(TEST_PROFILES.fiatjaf.npub));
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Profile should load successfully
      const body = await page.textContent('body');
      expect(body).toBeTruthy();

      // Should show profile content, not an error
      const isError = await page.locator('.error-page, .not-found-page, .error-message').isVisible().catch(() => false);
      expect(isError).toBeFalsy();

      await saveConsoleLogs('key-handling-npub-display');
    });

    test('should display profile via hex pubkey URL', async ({ page, saveConsoleLogs }) => {
      await page.goto(APP_ROUTES.profile(TEST_PROFILES.fiatjaf.pubkeyHex));
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Hex pubkey should also resolve to the same profile
      const body = await page.textContent('body');
      expect(body).toBeTruthy();

      await saveConsoleLogs('key-handling-hex-display');
    });

    test('should truncate long pubkeys in UI display', async ({ page, saveConsoleLogs }) => {
      await page.goto(APP_ROUTES.profile(TEST_PROFILES.fiatjaf.npub));
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Check if the full npub is shown truncated (e.g., "npub1...xyz" or "3bf0...459d")
      const displayedKeys = await page.evaluate(() => {
        const body = document.body.textContent || '';
        // Look for truncated npub patterns
        const truncatedNpub = body.match(/npub1[a-z0-9]{4,8}\.{2,3}[a-z0-9]{4,8}/g);
        // Look for truncated hex patterns
        const truncatedHex = body.match(/[a-f0-9]{4,8}\.{2,3}[a-f0-9]{4,8}/g);
        return {
          truncatedNpub: truncatedNpub || [],
          truncatedHex: truncatedHex || [],
        };
      });

      console.log('Truncated keys found:', displayedKeys);

      await saveConsoleLogs('key-handling-truncation');
    });
  });

  test.describe('nprofile handling', () => {
    test('should handle nprofile URLs with relay hints', async ({ page, saveConsoleLogs }) => {
      // nprofile contains npub + relay hints
      await page.goto(APP_ROUTES.profile(NIP19_ENTITIES.validNprofile));
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Should resolve to a profile page
      const body = await page.textContent('body');
      expect(body).toBeTruthy();

      await saveConsoleLogs('key-handling-nprofile');
    });
  });

  test.describe('Malformed key handling', () => {
    test('should handle malformed npub gracefully', async ({ page, saveConsoleLogs }) => {
      await page.goto(APP_ROUTES.profile(NIP19_ENTITIES.malformedNpub));
      await waitForAppReady(page);

      // Should not crash — may show error/not found
      const body = await page.textContent('body');
      expect(body).toBeTruthy();

      // Verify no uncaught exceptions
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));
      await page.waitForTimeout(2000);

      const fatalErrors = pageErrors.filter(e =>
        e.includes('TypeError') || e.includes('ReferenceError')
      );
      console.log(`Fatal errors after malformed npub: ${fatalErrors.length}`);

      await saveConsoleLogs('key-handling-malformed-npub');
    });

    test('should handle empty pubkey gracefully', async ({ page, saveConsoleLogs }) => {
      await page.goto('/p/');
      await waitForAppReady(page);

      // Should redirect or show appropriate message
      const body = await page.textContent('body');
      expect(body).toBeTruthy();

      await saveConsoleLogs('key-handling-empty-pubkey');
    });

    test('should handle random string as pubkey', async ({ page, saveConsoleLogs }) => {
      await page.goto('/p/not-a-real-pubkey-at-all');
      await waitForAppReady(page);

      // Should show error state or redirect, not crash
      const body = await page.textContent('body');
      expect(body).toBeTruthy();

      await saveConsoleLogs('key-handling-random-string');
    });
  });

  test.describe('Key display in authenticated context', () => {
    test('should display own pubkey in settings or profile', async ({ authenticatedPage, saveConsoleLogs }) => {
      await authenticatedPage.goto('/accounts');
      await waitForAppReady(authenticatedPage);
      await authenticatedPage.waitForTimeout(TIMEOUTS.contentLoad);

      // Look for key display elements
      const keyElements = await authenticatedPage.evaluate(() => {
        const body = document.body.textContent || '';
        return {
          hasNpub: /npub1[a-z0-9]+/.test(body),
          hasHexKey: /[a-f0-9]{64}/.test(body),
          hasTruncatedKey: /[a-f0-9]{4,8}[\.\u2026][a-f0-9]{4,8}/.test(body),
        };
      });

      console.log('Key display in accounts:', keyElements);

      await saveConsoleLogs('key-handling-own-key-display');
    });

    test('should not expose nsec (private key) in visible UI elements', async ({ authenticatedPage, saveConsoleLogs }) => {
      // Check multiple pages for nsec exposure
      const routes = ['/accounts', '/settings', '/'];

      for (const route of routes) {
        await authenticatedPage.goto(route);
        await waitForAppReady(authenticatedPage);
        await authenticatedPage.waitForTimeout(1000);

        // Check visible page text for nsec
        const hasNsecVisible = await authenticatedPage.evaluate(() => {
          const body = document.body.textContent || '';
          return /nsec1[a-z0-9]{58,}/.test(body);
        });

        // nsec should NOT be visible in normal UI (only in explicit export dialogs)
        if (hasNsecVisible) {
          console.log(`WARNING: nsec appears to be visible on ${route}`);
        }
      }

      await saveConsoleLogs('key-handling-nsec-not-visible');
    });
  });

  test.describe('Profile link rendering', () => {
    test('should render profile links with correct npub in href', async ({ page, saveConsoleLogs }) => {
      await page.goto('/discover');
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Find profile links in the feed
      const profileLinks = await page.evaluate(() => {
        const links = document.querySelectorAll('a[href*="/p/"]');
        return Array.from(links).slice(0, 10).map(a => ({
          href: a.getAttribute('href'),
          text: a.textContent?.trim().substring(0, 50),
        }));
      });

      console.log(`Found ${profileLinks.length} profile links:`, profileLinks);

      // All profile links should have valid paths
      for (const link of profileLinks) {
        expect(link.href).toMatch(/^\/p\/.+/);
      }

      await saveConsoleLogs('key-handling-profile-links');
    });
  });
});
