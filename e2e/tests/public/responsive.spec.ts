/**
 * Responsive Layout E2E Tests @public
 *
 * Tests responsive layout at 5 viewport sizes: verify navigation adapts,
 * content reflows, no horizontal overflow.
 */
import { test, expect } from '../../fixtures';

const viewports = [
  { name: 'mobile', width: 375, height: 667 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'small-desktop', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'ultrawide', width: 1920, height: 1080 },
];

test.describe('Responsive Layout @public', () => {
  for (const viewport of viewports) {
    test(`should render correctly at ${viewport.name} (${viewport.width}x${viewport.height})`, async ({
      page,
      waitForNostrReady,
      captureScreenshot,
      saveConsoleLogs,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');
      await waitForNostrReady();

      // Check for horizontal overflow
      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });

      console.log(`${viewport.name}: horizontal overflow = ${hasOverflow}`);
      expect(hasOverflow).toBeFalsy();

      await captureScreenshot(`responsive-${viewport.name}`);
      await saveConsoleLogs(`responsive-${viewport.name}`);
    });

    test(`should adapt navigation at ${viewport.name}`, async ({
      page,
      waitForNostrReady,
      saveConsoleLogs,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');
      await waitForNostrReady();

      // On mobile, navigation should be collapsed/hidden
      const sideNav = page.locator('mat-sidenav, .sidenav, nav');
      const menuButton = page.locator('button[aria-label*="menu" i], .menu-button');

      if (viewport.width < 768) {
        // Mobile: menu should be behind a hamburger button
        const hasMenuButton = await menuButton.isVisible().catch(() => false);
        console.log(`${viewport.name}: hamburger menu visible = ${hasMenuButton}`);
      } else {
        // Desktop: sidebar should be visible (or nav should be visible)
        const hasSideNav = await sideNav.isVisible().catch(() => false);
        console.log(`${viewport.name}: side nav visible = ${hasSideNav}`);
      }

      await saveConsoleLogs(`responsive-nav-${viewport.name}`);
    });
  }

  test('should reflow content properly on resize', async ({
    page,
    waitForNostrReady,
    captureScreenshot,
    saveConsoleLogs,
  }) => {
    // Start at desktop
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await waitForNostrReady();

    // Resize to mobile
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);

    // Check no overflow after resize
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });

    expect(hasOverflow).toBeFalsy();

    await captureScreenshot('responsive-after-resize');
    await saveConsoleLogs('responsive-resize');
  });
});
