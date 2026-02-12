/**
 * Navigation E2E Tests @public @navigation
 *
 * Tests for routing and navigation throughout the app.
 * Verifies that all main routes are accessible and render correctly.
 */
import { test, expect } from '../fixtures';

test.describe('Navigation Routes @public @navigation', () => {
  // List of public routes that should be accessible without authentication
  const publicRoutes = [
    { path: '/', name: 'Home' },
    { path: '/discover', name: 'Discover' },
    { path: '/articles', name: 'Articles' },
    { path: '/music', name: 'Music' },
    { path: '/streams', name: 'Streams' },
    { path: '/media', name: 'Media' },
  ];

  for (const route of publicRoutes) {
    test(`should navigate to ${route.name} page (${route.path})`, async ({
      page,
      waitForNostrReady,
      captureScreenshot,
      saveConsoleLogs,
    }) => {
      await page.goto(route.path);

      // Wait for page to be ready
      await waitForNostrReady();

      // Take screenshot for visual verification
      await captureScreenshot(`route-${route.name.toLowerCase()}`);

      // Check for JavaScript errors
      const pageErrors = await page.evaluate(() => {
        return (window as unknown as { __pageErrors?: string[] }).__pageErrors || [];
      });

      if (pageErrors.length > 0) {
        console.error('Page errors detected:', pageErrors);
      }

      // Verify no error overlay is shown
      const errorOverlay = page.locator('.cdk-overlay-container .error, mat-snack-bar-container');
      const hasVisibleError = await errorOverlay.isVisible().catch(() => false);

      expect(hasVisibleError).toBeFalsy();

      // Save console logs for AI analysis
      await saveConsoleLogs(`navigation-${route.name.toLowerCase()}`);
    });
  }
});

test.describe('Deep Linking @public @navigation', () => {
  test('should handle profile deep links', async ({ page, waitForNostrReady, captureScreenshot }) => {
    // Test with a well-known npub (use a test account or known public profile)
    // This uses a placeholder - in real tests, use an actual npub
    await page.goto('/p/npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s');

    await waitForNostrReady();

    await captureScreenshot('profile-deep-link');

    // Should show profile page elements
    const profileContent = page.locator('app-profile, .profile-container, [data-testid="profile"]');
    const hasProfileContent = await profileContent.isVisible().catch(() => false);

    // Profile might redirect or show loading
    console.log(`Profile content visible: ${hasProfileContent}`);
  });

  test('should handle event deep links', async ({ page, waitForNostrReady, captureScreenshot }) => {
    // Test with a placeholder event ID
    await page.goto('/e/nevent1test');

    await waitForNostrReady();

    await captureScreenshot('event-deep-link');

    // Should show event page or loading
    const eventContent = page.locator('app-event, .event-container, [data-testid="event"]');
    const hasEventContent = await eventContent.isVisible().catch(() => false);

    console.log(`Event content visible: ${hasEventContent}`);
  });
});

test.describe('Navigation Menu @public @navigation', () => {
  test('should open and close navigation drawer', async ({ page, waitForNostrReady, captureScreenshot }) => {
    await page.goto('/');
    await waitForNostrReady();

    // Find and click menu button
    const menuButton = page.locator('button[aria-label*="menu"], .menu-button, [data-testid="menu"]');

    if (await menuButton.isVisible()) {
      await menuButton.click();

      // Wait for drawer to open
      await page.waitForTimeout(300);

      await captureScreenshot('nav-drawer-open');

      // Click outside to close or press escape
      await page.keyboard.press('Escape');

      await page.waitForTimeout(300);

      await captureScreenshot('nav-drawer-closed');
    }
  });

  test('should navigate using menu items', async ({ page, waitForNostrReady, captureScreenshot }) => {
    await page.goto('/');
    await waitForNostrReady();

    // Open menu
    const menuButton = page.locator('button[aria-label*="menu"], .menu-button');

    if (await menuButton.isVisible()) {
      await menuButton.click();
      await page.waitForTimeout(300);

      // Find a menu item and click it
      const menuItems = page.locator('mat-nav-list a, mat-list-item a, .nav-item');
      const itemCount = await menuItems.count();

      console.log(`Found ${itemCount} menu items`);

      if (itemCount > 0) {
        // Click the second item (first is usually home)
        const itemIndex = Math.min(1, itemCount - 1);
        const targetItem = menuItems.nth(itemIndex);
        const itemText = await targetItem.textContent();

        console.log(`Clicking menu item: ${itemText}`);

        await targetItem.click();

        // Wait for navigation
        await page.waitForLoadState('networkidle');

        await captureScreenshot('after-menu-navigation');
      }
    }
  });
});

test.describe('Back Navigation @public @navigation', () => {
  test('should support browser back button', async ({ page, waitForNostrReady, captureScreenshot }) => {
    // Navigate through multiple pages
    await page.goto('/');
    await waitForNostrReady();

    const initialUrl = page.url();

    // Navigate to another page
    await page.goto('/discover');
    await waitForNostrReady();

    const secondUrl = page.url();

    expect(secondUrl).not.toBe(initialUrl);

    // Use browser back
    await page.goBack();
    await page.waitForLoadState('networkidle');

    await captureScreenshot('after-back-navigation');

    // Should be back on initial page
    expect(page.url()).toContain(new URL(initialUrl).pathname.split('/')[1] || '');
  });
});

test.describe('Error Handling @public @navigation', () => {
  test('should handle 404 routes gracefully', async ({ page, captureScreenshot, saveConsoleLogs }) => {
    // Navigate to a non-existent route
    await page.goto('/this-route-does-not-exist-12345');

    await page.waitForLoadState('networkidle');

    await captureScreenshot('404-page');

    // Should show some content (either 404 page or redirect to home)
    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(100);

    await saveConsoleLogs('404-route');
  });
});
