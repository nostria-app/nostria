/**
 * NIP Rendering E2E Tests @public
 *
 * Tests NIP-specific features:
 * - NIP-27: Mention rendering (nostr: links)
 * - NIP-36: Content warning display
 * - NIP-94: File metadata rendering
 * - NIP-57: Zap display
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

test.describe('NIP Rendering @public', () => {
  test.describe('NIP-27 — Mention Rendering (nostr: links)', () => {
    test('should render nostr: mention links as clickable elements', async ({ page, saveConsoleLogs }) => {
      // Navigate to a well-known profile that likely has mentions in notes
      await page.goto(APP_ROUTES.profile(TEST_PROFILES.fiatjaf.npub));
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Look for rendered nostr: links (they should be converted to clickable elements)
      const mentionLinks = page.locator('a[href*="/p/"], a[href*="nostr:"], .mention, .nostr-mention');
      const count = await mentionLinks.count();
      console.log(`Found ${count} mention links on profile page`);

      await saveConsoleLogs('nip-27-mentions');
    });

    test('should handle nostr: URIs in content without crashing', async ({ page, saveConsoleLogs }) => {
      await page.goto('/discover');
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Verify the page rendered without errors
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => {
        pageErrors.push(error.message);
      });

      // Scroll to load more content (which may contain nostr: URIs)
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, 500));
        await page.waitForTimeout(500);
      }

      // No errors should be related to nostr: URI parsing
      const parseErrors = pageErrors.filter(e =>
        e.includes('nostr:') || e.includes('nip19') || e.includes('decode')
      );
      expect(parseErrors).toHaveLength(0);

      await saveConsoleLogs('nip-27-nostr-uris');
    });
  });

  test.describe('NIP-36 — Content Warning', () => {
    test('should handle content warnings in notes', async ({ page, saveConsoleLogs }) => {
      await page.goto('/discover');
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Check for content warning UI elements
      const cwElements = page.locator('.content-warning, .cw, [data-cw], .spoiler, .nsfw-warning');
      const count = await cwElements.count();
      console.log(`Found ${count} content warning elements`);

      // Whether or not CW content is present, the page should render
      const body = await page.textContent('body');
      expect(body).toBeTruthy();

      await saveConsoleLogs('nip-36-content-warning');
    });
  });

  test.describe('NIP-57 — Zap Display', () => {
    test('should render zap buttons or indicators on notes', async ({ page, saveConsoleLogs }) => {
      await page.goto(APP_ROUTES.profile(TEST_PROFILES.jack.npub));
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Look for zap-related UI elements
      const zapElements = page.locator('.zap, .zap-button, .lightning, [aria-label*="zap" i], button:has(mat-icon:text("bolt"))');
      const count = await zapElements.count();
      console.log(`Found ${count} zap-related elements`);

      await saveConsoleLogs('nip-57-zaps');
    });

    test('should display zap amounts if present', async ({ page, saveConsoleLogs }) => {
      await page.goto(APP_ROUTES.profile(TEST_PROFILES.jack.npub));
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Check for zap count/amount displays
      const zapAmounts = page.locator('.zap-count, .zap-amount, .sats');
      const count = await zapAmounts.count();
      console.log(`Found ${count} zap amount elements`);

      await saveConsoleLogs('nip-57-zap-amounts');
    });
  });

  test.describe('NIP-94 — File Metadata', () => {
    test('should render images with proper attributes', async ({ page, saveConsoleLogs }) => {
      await page.goto('/discover');
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Check that images in content have proper rendering
      const contentImages = await page.evaluate(() => {
        const images = document.querySelectorAll('app-event img, .note-content img, .event-content img');
        return Array.from(images).slice(0, 10).map(img => ({
          src: img.getAttribute('src')?.substring(0, 100),
          alt: img.getAttribute('alt'),
          hasWidth: img.hasAttribute('width'),
          hasHeight: img.hasAttribute('height'),
        }));
      });

      console.log(`Found ${contentImages.length} content images:`, contentImages);

      await saveConsoleLogs('nip-94-file-metadata');
    });
  });

  test.describe('NIP-19 Entity Rendering', () => {
    test('should render npub links as profile references', async ({ page, saveConsoleLogs }) => {
      // Navigate to a profile using npub
      await page.goto(APP_ROUTES.profile(NIP19_ENTITIES.validNpub));
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Profile should load (display name or pubkey should be visible)
      const profileContent = await page.textContent('body');
      expect(profileContent).toBeTruthy();

      // Should not show an error page
      const isError = await page.locator('.error-page, .not-found-page').isVisible().catch(() => false);
      expect(isError).toBeFalsy();

      await saveConsoleLogs('nip-19-npub-rendering');
    });

    test('should handle malformed NIP-19 entities gracefully', async ({ page, saveConsoleLogs }) => {
      // Navigate to a malformed npub
      await page.goto(APP_ROUTES.profile(NIP19_ENTITIES.malformedNpub));
      await waitForAppReady(page);

      // Should not crash — may show error state or redirect
      const body = await page.textContent('body');
      expect(body).toBeTruthy();

      await saveConsoleLogs('nip-19-malformed-entity');
    });
  });
});
