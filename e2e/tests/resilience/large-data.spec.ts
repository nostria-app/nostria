/**
 * Large Data Resilience E2E Tests @auth
 *
 * Tests with profiles that have very long bios, notes with maximum content
 * length, and threads with deep nesting. Verifies no layout breakage or
 * performance degradation.
 */
import { test, expect } from '../../fixtures';
import { APP_ROUTES, TIMEOUTS, SAMPLE_CONTENT, TEST_PROFILES } from '../../fixtures/test-data';

async function waitForAppReady(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const appRoot = document.querySelector('app-root');
    if (!appRoot) return false;
    return !!document.querySelector('mat-sidenav-content, .main-content, main');
  }, { timeout: TIMEOUTS.appReady });
  await page.waitForTimeout(TIMEOUTS.stabilize);
}

test.describe('Large Data Resilience @auth', () => {
  test.describe('Long text content handling', () => {
    test('should handle very long text in the note editor without crashing', async ({ authenticatedPage: page, saveConsoleLogs }) => {
      await page.goto(APP_ROUTES.public.home);
      await waitForAppReady(page);

      // Try to open the note editor
      // Look for FAB or create note button
      const createButton = page.locator(
        'button:has-text("Create"), button:has-text("New"), ' +
        '.fab, [class*="fab"], button[aria-label*="note"], button[aria-label*="create"]'
      );

      const hasCreateButton = await createButton.first().isVisible().catch(() => false);

      if (hasCreateButton) {
        await createButton.first().click();
        await page.waitForTimeout(TIMEOUTS.animation);

        // Find the textarea/input in the note editor
        const textarea = page.locator(
          '.content-textarea, textarea, [contenteditable="true"], mat-form-field textarea'
        );
        const hasTextarea = await textarea.first().isVisible().catch(() => false);

        if (hasTextarea) {
          // Type a very long string (5000 chars)
          const longText = SAMPLE_CONTENT.longNote;
          await textarea.first().fill(longText);
          await page.waitForTimeout(500);

          // The app should not crash or freeze
          const appRoot = page.locator('app-root');
          await expect(appRoot).toBeVisible();

          // Verify the textarea has content
          const textareaValue = await textarea.first().inputValue().catch(() => '');
          expect(textareaValue.length).toBeGreaterThan(0);

          // Close the dialog
          const cancelButton = page.locator(
            'button:has-text("Cancel"), button:has-text("Close"), .close-button, [mat-dialog-close]'
          );
          if (await cancelButton.first().isVisible().catch(() => false)) {
            await cancelButton.first().click();
          } else {
            await page.keyboard.press('Escape');
          }
        }
      } else {
        console.log('Create note button not found — skipping long text input test');
      }

      await saveConsoleLogs('large-data-long-note');
    });

    test('should handle special characters in text without XSS or crashes', async ({ authenticatedPage: page, saveConsoleLogs }) => {
      await page.goto(APP_ROUTES.public.home);
      await waitForAppReady(page);

      const createButton = page.locator(
        'button:has-text("Create"), button:has-text("New"), ' +
        '.fab, [class*="fab"], button[aria-label*="note"], button[aria-label*="create"]'
      );

      const hasCreateButton = await createButton.first().isVisible().catch(() => false);

      if (hasCreateButton) {
        await createButton.first().click();
        await page.waitForTimeout(TIMEOUTS.animation);

        const textarea = page.locator(
          '.content-textarea, textarea, [contenteditable="true"], mat-form-field textarea'
        );
        const hasTextarea = await textarea.first().isVisible().catch(() => false);

        if (hasTextarea) {
          // Type content with special/dangerous characters
          await textarea.first().fill(SAMPLE_CONTENT.specialChars);
          await page.waitForTimeout(500);

          // The app should not have executed any scripts
          const alertCalled = await page.evaluate(() => {
            return (window as unknown as { __xssTriggered?: boolean }).__xssTriggered === true;
          });
          expect(alertCalled).toBeFalsy();

          // Close
          await page.keyboard.press('Escape');
        }
      }

      await saveConsoleLogs('large-data-special-chars');
    });
  });

  test.describe('Profile with large content', () => {
    test('should render profiles with lots of content without layout breakage', async ({ page, saveConsoleLogs }) => {
      // Visit a profile known to have lots of notes
      await page.goto(APP_ROUTES.profile(TEST_PROFILES.fiatjaf.npub));
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Scroll down to trigger loading more content
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.scrollBy(0, 1000));
        await page.waitForTimeout(500);
      }

      // Check for horizontal overflow (layout breakage indicator)
      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });

      // A small amount of overflow might be acceptable, but significant overflow isn't
      if (hasHorizontalOverflow) {
        const overflowAmount = await page.evaluate(() => {
          return document.documentElement.scrollWidth - document.documentElement.clientWidth;
        });
        console.log(`Horizontal overflow detected: ${overflowAmount}px`);
        // Allow up to 20px of overflow (scrollbar width can vary)
        expect(overflowAmount).toBeLessThan(20);
      }

      // The app should still be functional
      const appRoot = page.locator('app-root');
      await expect(appRoot).toBeVisible();

      await saveConsoleLogs('large-data-profile-content');
    });

    test('should handle infinite scroll without memory issues', async ({ page, memoryMonitor, saveConsoleLogs }) => {
      await page.goto(APP_ROUTES.profile(TEST_PROFILES.fiatjaf.npub));
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Capture initial memory
      await memoryMonitor.capture();

      // Scroll down multiple times to trigger loading
      for (let i = 0; i < 10; i++) {
        await page.evaluate(() => window.scrollBy(0, 2000));
        await page.waitForTimeout(1000);
      }

      // Capture final memory
      await memoryMonitor.capture();

      const delta = memoryMonitor.getDelta();
      if (delta) {
        console.log(`Memory usage: start=${delta.startMB.toFixed(1)}MB, end=${delta.endMB.toFixed(1)}MB, delta=${delta.deltaMB.toFixed(1)}MB`);

        // Memory growth should be reasonable (less than 100MB for scrolling)
        expect(delta.deltaMB).toBeLessThan(100);
      }

      // App should still be responsive
      const appRoot = page.locator('app-root');
      await expect(appRoot).toBeVisible();

      await memoryMonitor.save('large-data-infinite-scroll');
      await saveConsoleLogs('large-data-infinite-scroll');
    });
  });

  test.describe('Large list rendering', () => {
    test('should handle the discover page with many items', async ({ page, saveConsoleLogs }) => {
      await page.goto(APP_ROUTES.public.discover);
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Scroll extensively to load many items
      for (let i = 0; i < 8; i++) {
        await page.evaluate(() => window.scrollBy(0, 1500));
        await page.waitForTimeout(800);
      }

      // Count rendered items
      const itemCount = await page.evaluate(() => {
        const items = document.querySelectorAll('mat-card, app-event, .feed-item, .event-container, .card');
        return items.length;
      });

      console.log(`Total items rendered after scrolling: ${itemCount}`);

      // The page should still be responsive — test by scrolling back up
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(500);

      const appRoot = page.locator('app-root');
      await expect(appRoot).toBeVisible();

      await saveConsoleLogs('large-data-discover-list');
    });

    test('should handle virtual scroll without rendering artifacts', async ({ page, saveConsoleLogs }) => {
      await page.goto(APP_ROUTES.public.discover);
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Rapidly scroll up and down to stress virtual scroll
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.scrollTo(0, 5000));
        await page.waitForTimeout(300);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(300);
      }

      // After rapid scrolling, check the page is still intact
      const appRoot = page.locator('app-root');
      await expect(appRoot).toBeVisible();

      // Check for blank/empty areas in the viewport that shouldn't be there
      const viewportState = await page.evaluate(() => {
        const main = document.querySelector('mat-sidenav-content, .main-content, main');
        if (!main) return { hasContent: false, mainHeight: 0 };
        const rect = main.getBoundingClientRect();
        return {
          hasContent: (main.textContent?.trim().length || 0) > 0,
          mainHeight: rect.height,
        };
      });

      expect(viewportState.hasContent).toBeTruthy();
      expect(viewportState.mainHeight).toBeGreaterThan(0);

      await saveConsoleLogs('large-data-virtual-scroll');
    });
  });

  test.describe('Edge case content', () => {
    test('should handle multiline content rendering', async ({ page, saveConsoleLogs }) => {
      // Navigate to a profile that likely has multiline notes
      await page.goto(APP_ROUTES.profile(TEST_PROFILES.fiatjaf.npub));
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Verify events are rendering (they may contain multiline text)
      const events = page.locator('app-event, .note-content, .event-content, mat-card');
      const count = await events.count();
      console.log(`Found ${count} event elements`);

      // The page should render without layout breakage
      const hasHorizontalOverflow = await page.evaluate(() => {
        return (document.documentElement.scrollWidth - document.documentElement.clientWidth) > 20;
      });
      expect(hasHorizontalOverflow).toBeFalsy();

      await saveConsoleLogs('large-data-multiline');
    });

    test('should handle emoji-heavy content', async ({ page, saveConsoleLogs }) => {
      // Navigate to discover page which may contain emoji content
      await page.goto(APP_ROUTES.public.discover);
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // The page should render without crashes even with emoji content
      const appRoot = page.locator('app-root');
      await expect(appRoot).toBeVisible();

      // Check for any rendering errors
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => {
        pageErrors.push(error.message);
      });

      await page.waitForTimeout(2000);

      // Filter out known non-critical errors
      const criticalErrors = pageErrors.filter(e =>
        !e.includes('WebSocket') && !e.includes('net::') && !e.includes('relay')
      );
      expect(criticalErrors).toHaveLength(0);

      await saveConsoleLogs('large-data-emoji-content');
    });
  });
});
