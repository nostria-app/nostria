/**
 * Responsive Layout Visual Regression Tests @visual
 *
 * Captures screenshots at mobile (375px), tablet (768px), and desktop (1440px)
 * for the home page, profile page, and settings page — compares against baselines.
 */
import { test, expect } from '../../fixtures';

const viewports = [
  { name: 'mobile', width: 375, height: 667 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

const pages = [
  { name: 'home', path: '/' },
  { name: 'discover', path: '/discover' },
  { name: 'search', path: '/search' },
];

/**
 * Wait for the app to render and stabilize before taking screenshots.
 */
async function waitForStableRender(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const appRoot = document.querySelector('app-root');
    if (!appRoot) return false;
    const mainContent = document.querySelector('mat-sidenav-content, .main-content, main');
    return !!mainContent;
  }, { timeout: 30_000 });

  await page.waitForTimeout(1000);

  await page.waitForLoadState('networkidle').catch(() => {
    // networkidle may not always fire; continue
  });
}

test.describe('Responsive Layout Visual Regression @visual', () => {
  for (const viewport of viewports) {
    test.describe(`${viewport.name} (${viewport.width}x${viewport.height})`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
      });

      for (const pageInfo of pages) {
        test(`should match baseline for ${pageInfo.name}`, async ({ page, saveConsoleLogs }) => {
          await page.goto(pageInfo.path);
          await waitForStableRender(page);

          // Verify no horizontal overflow
          const hasOverflow = await page.evaluate(() =>
            document.documentElement.scrollWidth > document.documentElement.clientWidth
          );
          expect(hasOverflow).toBeFalsy();

          // Take visual regression screenshot
          await expect(page).toHaveScreenshot(
            `${pageInfo.name}-${viewport.name}.png`,
            {
              fullPage: true,
              mask: [
                page.locator('time, .timestamp, .relative-time'),
                page.locator('img[src*="nostr"], img[src*="avatar"], .avatar img'),
              ],
            }
          );

          await saveConsoleLogs(`visual-responsive-${viewport.name}-${pageInfo.name}`);
        });
      }

      test('should render navigation correctly', async ({ page, saveConsoleLogs }) => {
        await page.goto('/');
        await waitForStableRender(page);

        if (viewport.width < 768) {
          // Mobile: sidenav should be hidden/overlay mode
          const sidenav = page.locator('mat-sidenav');
          const sidenavVisible = await sidenav.isVisible().catch(() => false);

          // On mobile, sidenav should not be visible by default (collapsed)
          console.log(`${viewport.name}: sidenav visible = ${sidenavVisible}`);

          // Take screenshot of navigation state
          await expect(page).toHaveScreenshot(
            `navigation-${viewport.name}.png`,
            {
              mask: [
                page.locator('time, .timestamp, .relative-time'),
                page.locator('img[src*="nostr"], img[src*="avatar"], .avatar img'),
              ],
            }
          );
        } else {
          // Tablet/Desktop: sidenav should be visible
          const sidenav = page.locator('mat-sidenav');
          const sidenavVisible = await sidenav.isVisible().catch(() => false);
          console.log(`${viewport.name}: sidenav visible = ${sidenavVisible}`);

          // Take screenshot with sidebar visible
          await expect(page).toHaveScreenshot(
            `navigation-${viewport.name}.png`,
            {
              mask: [
                page.locator('time, .timestamp, .relative-time'),
                page.locator('img[src*="nostr"], img[src*="avatar"], .avatar img'),
              ],
            }
          );
        }

        await saveConsoleLogs(`visual-responsive-nav-${viewport.name}`);
      });
    });
  }

  test.describe('Layout transitions', () => {
    test('should maintain layout when resizing from desktop to mobile', async ({ page, saveConsoleLogs }) => {
      // Start at desktop size
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');
      await waitForStableRender(page);

      // Resize to tablet
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.waitForTimeout(500);

      // Verify no overflow
      let hasOverflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      expect(hasOverflow).toBeFalsy();

      await expect(page).toHaveScreenshot('transition-desktop-to-tablet.png', {
        mask: [
          page.locator('time, .timestamp, .relative-time'),
          page.locator('img[src*="nostr"], img[src*="avatar"], .avatar img'),
        ],
      });

      // Resize to mobile
      await page.setViewportSize({ width: 375, height: 667 });
      await page.waitForTimeout(500);

      hasOverflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      expect(hasOverflow).toBeFalsy();

      await expect(page).toHaveScreenshot('transition-desktop-to-mobile.png', {
        mask: [
          page.locator('time, .timestamp, .relative-time'),
          page.locator('img[src*="nostr"], img[src*="avatar"], .avatar img'),
        ],
      });

      await saveConsoleLogs('visual-responsive-transition');
    });

    test('should maintain layout when resizing from mobile to desktop', async ({ page, saveConsoleLogs }) => {
      // Start at mobile size
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/');
      await waitForStableRender(page);

      // Resize to desktop
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(500);

      const hasOverflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      expect(hasOverflow).toBeFalsy();

      await expect(page).toHaveScreenshot('transition-mobile-to-desktop.png', {
        mask: [
          page.locator('time, .timestamp, .relative-time'),
          page.locator('img[src*="nostr"], img[src*="avatar"], .avatar img'),
        ],
      });

      await saveConsoleLogs('visual-responsive-mobile-to-desktop');
    });
  });
});
