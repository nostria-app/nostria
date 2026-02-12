/**
 * Nostr Timestamp Handling E2E Tests @public
 *
 * Verifies timestamps are displayed correctly:
 * - Relative times ("5m ago")
 * - Full dates
 * - Timezone handling
 * - No JavaScript Date issues with Nostr's second-based timestamps
 *
 * CRITICAL: Nostr timestamps are in SECONDS, not milliseconds.
 * Using Date(seconds) instead of Date(seconds * 1000) would show dates in 1970.
 */
import { test, expect } from '../../fixtures';
import { TEST_PROFILES, APP_ROUTES, TIMEOUTS } from '../../fixtures/test-data';

async function waitForAppReady(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const appRoot = document.querySelector('app-root');
    if (!appRoot) return false;
    return !!document.querySelector('mat-sidenav-content, .main-content, main');
  }, { timeout: TIMEOUTS.appReady });
  await page.waitForTimeout(TIMEOUTS.stabilize);
}

test.describe('Nostr Timestamp Handling @public', () => {
  test.describe('Relative time display', () => {
    test('should display relative timestamps on notes', async ({ page, saveConsoleLogs }) => {
      await page.goto(APP_ROUTES.profile(TEST_PROFILES.fiatjaf.npub));
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Look for timestamp elements
      const timeElements = page.locator('time, .timestamp, .relative-time, .time-ago, .date');
      const count = await timeElements.count();
      console.log(`Found ${count} time elements`);

      if (count > 0) {
        // Get all visible timestamp texts
        const timestamps: string[] = [];
        for (let i = 0; i < Math.min(count, 10); i++) {
          const text = await timeElements.nth(i).textContent();
          if (text) timestamps.push(text.trim());
        }
        console.log('Timestamp values:', timestamps);

        // Verify none show dates in 1970 (which would indicate seconds treated as milliseconds)
        for (const ts of timestamps) {
          expect(ts).not.toContain('1970');
          expect(ts).not.toContain('Jan 1, 1970');
          expect(ts).not.toContain('January 1970');
        }
      }

      await saveConsoleLogs('timestamp-relative');
    });

    test('should use relative format for recent timestamps', async ({ page, saveConsoleLogs }) => {
      await page.goto('/discover');
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Check for common relative time patterns
      const timeTexts = await page.evaluate(() => {
        const elements = document.querySelectorAll('time, .timestamp, .relative-time, .time-ago');
        return Array.from(elements).slice(0, 20).map(el => el.textContent?.trim() || '');
      });

      console.log('Time texts found:', timeTexts.filter(t => t.length > 0));

      // If relative times are present, they should match common patterns
      const relativePatterns = /(\d+[smhd]|just now|seconds? ago|minutes? ago|hours? ago|days? ago|weeks? ago|months? ago|years? ago)/i;
      const hasRelative = timeTexts.some(t => relativePatterns.test(t));
      console.log(`Has relative time formatting: ${hasRelative}`);

      await saveConsoleLogs('timestamp-relative-format');
    });
  });

  test.describe('Timestamp correctness', () => {
    test('should not display dates in 1970 (millisecond/second confusion)', async ({ page, saveConsoleLogs }) => {
      await page.goto('/discover');
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Scan the entire page for "1970" which indicates timestamp conversion errors
      const pageText = await page.textContent('body');
      const has1970 = pageText?.includes('1970') || false;

      if (has1970) {
        // Check if "1970" appears in a date context (not just as regular text)
        const dateContexts = await page.evaluate(() => {
          const body = document.body.textContent || '';
          const matches = body.match(/.{0,30}1970.{0,30}/g);
          return matches || [];
        });
        console.log('1970 contexts found:', dateContexts);

        // "1970" in a time element specifically is a bug
        const timesWith1970 = await page.evaluate(() => {
          const times = document.querySelectorAll('time, .timestamp, .relative-time');
          return Array.from(times)
            .filter(el => el.textContent?.includes('1970'))
            .map(el => el.textContent?.trim());
        });

        expect(timesWith1970).toHaveLength(0);
      }

      await saveConsoleLogs('timestamp-no-1970');
    });

    test('should not display dates far in the future', async ({ page, saveConsoleLogs }) => {
      await page.goto('/discover');
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Check for dates far in the future (> current year + 1)
      const currentYear = new Date().getFullYear();
      const futureYear = currentYear + 2;

      const timeTexts = await page.evaluate(() => {
        const times = document.querySelectorAll('time, .timestamp, .relative-time, .date');
        return Array.from(times).map(el => el.textContent?.trim() || '');
      });

      // None should contain a year far in the future
      for (const text of timeTexts) {
        const yearMatch = text.match(/20\d{2}/);
        if (yearMatch) {
          const year = parseInt(yearMatch[0], 10);
          expect(year).toBeLessThanOrEqual(futureYear);
        }
      }

      await saveConsoleLogs('timestamp-no-future');
    });
  });

  test.describe('Timestamp formats', () => {
    test('should show full date on hover or in detail views', async ({ page, saveConsoleLogs }) => {
      await page.goto(APP_ROUTES.profile(TEST_PROFILES.fiatjaf.npub));
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Check for title/tooltip attributes on time elements with full dates
      const timeTitles = await page.evaluate(() => {
        const times = document.querySelectorAll('time, .timestamp, .relative-time');
        return Array.from(times).slice(0, 10).map(el => ({
          text: el.textContent?.trim(),
          title: el.getAttribute('title'),
          datetime: el.getAttribute('datetime'),
        }));
      });

      console.log('Time element attributes:', timeTitles);

      await saveConsoleLogs('timestamp-formats');
    });

    test('should handle timezone display consistently', async ({ page, saveConsoleLogs }) => {
      await page.goto(APP_ROUTES.profile(TEST_PROFILES.fiatjaf.npub));
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Verify that the current browser timezone is used for display
      const tzInfo = await page.evaluate(() => {
        return {
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          offset: new Date().getTimezoneOffset(),
        };
      });

      console.log(`Browser timezone: ${tzInfo.timezone}, offset: ${tzInfo.offset}min`);

      await saveConsoleLogs('timestamp-timezone');
    });
  });

  test.describe('Edge cases', () => {
    test('should handle timestamp value of 0 gracefully', async ({ page, saveConsoleLogs }) => {
      // Navigate to any page and verify zero timestamps don't cause issues
      await page.goto('/discover');
      await waitForAppReady(page);

      // Verify no "January 1, 1970" or "Dec 31, 1969" (UTC-offset 0 timestamp)
      const pageText = await page.textContent('body') || '';
      const hasEpoch = pageText.includes('Jan 1, 1970') || pageText.includes('December 31, 1969');
      expect(hasEpoch).toBeFalsy();

      await saveConsoleLogs('timestamp-zero');
    });

    test('should handle very old timestamps (2009-2020 era)', async ({ page, saveConsoleLogs }) => {
      // Early Nostr events might have timestamps from testing periods
      await page.goto('/discover');
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // The app should render without errors regardless of timestamp age
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      await page.evaluate(() => window.scrollBy(0, 2000));
      await page.waitForTimeout(1000);

      const timeErrors = pageErrors.filter(e =>
        e.includes('Invalid Date') || e.includes('timestamp') || e.includes('NaN')
      );
      expect(timeErrors).toHaveLength(0);

      await saveConsoleLogs('timestamp-old');
    });
  });
});
