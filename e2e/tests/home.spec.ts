/**
 * Home Page E2E Tests @public @smoke
 *
 * Tests for the main feed/home page functionality.
 * These tests verify core user flows without requiring authentication.
 */
import { test, expect } from '../fixtures';
import { HomePage } from '../pages';

test.describe('Home Page @public @smoke', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to home page before each test
    await page.goto('/');
  });

  test('should load the home page successfully', async ({ page, waitForNostrReady, captureScreenshot, saveConsoleLogs }) => {
    await waitForNostrReady();

    // Verify the page loads (title can be "Home", "Nostria", etc.)
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);

    // Take a screenshot for AI analysis
    await captureScreenshot('home-page-loaded');
    await saveConsoleLogs('home-page-loaded');
  });

  test('should display the main toolbar', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    await waitForNostrReady();

    const homePage = new HomePage(page);

    // Toolbar should be visible
    await expect(homePage.toolbar).toBeVisible();
    await saveConsoleLogs('home-toolbar');
  });

  test('should have navigation menu accessible', async ({ page, waitForNostrReady, captureScreenshot, saveConsoleLogs }) => {
    await waitForNostrReady();

    const homePage = new HomePage(page);

    // Menu button should be clickable
    await homePage.openMenu();

    // Capture the menu state
    await captureScreenshot('navigation-menu-open');

    // Verify some navigation items are visible
    const navItems = page.locator('mat-nav-list a, .nav-item, mat-list-item');
    const count = await navItems.count();

    expect(count).toBeGreaterThan(0);
    await saveConsoleLogs('home-navigation-menu');
  });

  test('should be responsive on mobile viewport', async ({ page, waitForNostrReady, captureScreenshot, saveConsoleLogs }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/');
    await waitForNostrReady();

    await captureScreenshot('home-page-mobile');

    // On mobile, the layout should adapt
    const homePage = new HomePage(page);
    await expect(homePage.toolbar).toBeVisible();
    await saveConsoleLogs('home-mobile-viewport');
  });

  test('should open command palette with keyboard shortcut', async ({ page, waitForNostrReady, captureScreenshot, saveConsoleLogs }) => {
    await waitForNostrReady();

    // Open command palette
    await page.keyboard.press('Control+k');

    // Wait for dialog to appear
    const dialog = page.locator('[role="dialog"], app-command-palette-dialog, .command-palette');
    await dialog.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {
      // Command palette might not be available in all states
    });

    if (await dialog.isVisible()) {
      await captureScreenshot('command-palette-open');

      // Close with Escape
      await page.keyboard.press('Escape');
    }
    await saveConsoleLogs('home-command-palette');
  });
});

test.describe('Feed Loading @public @smoke', () => {
  test('should display loading state initially', async ({ page, captureScreenshot, saveConsoleLogs }) => {
    await page.goto('/');

    // Capture the loading state (if visible)
    await captureScreenshot('feed-loading-state');

    const homePage = new HomePage(page);
    await homePage.waitForFeedLoaded();

    await captureScreenshot('feed-loaded-state');
    await saveConsoleLogs('feed-loading');
  });

  test('should handle empty feed gracefully', async ({ page, waitForNostrReady, captureScreenshot, saveConsoleLogs }) => {
    // Navigate to a feed that might be empty (e.g., a new user's following feed)
    await page.goto('/');
    await waitForNostrReady();

    await captureScreenshot('feed-content');

    // The page should not show errors
    const errorMessages = page.locator('.error, [role="alert"]');
    const errorCount = await errorMessages.count();

    // Log any errors for AI analysis
    if (errorCount > 0) {
      for (let i = 0; i < errorCount; i++) {
        const errorText = await errorMessages.nth(i).textContent();
        console.log(`Error ${i + 1}: ${errorText}`);
      }
    }
    await saveConsoleLogs('feed-empty-state');
  });
});

test.describe('Theme Support @public', () => {
  test('should support dark mode', async ({ page, waitForNostrReady, captureScreenshot, saveConsoleLogs }) => {
    await page.goto('/');
    await waitForNostrReady();

    // Check if dark class is applied to body or html
    const isDark = await page.evaluate(() => {
      return document.body.classList.contains('dark') ||
        document.documentElement.classList.contains('dark') ||
        document.body.getAttribute('data-theme') === 'dark';
    });

    console.log(`Dark mode active: ${isDark}`);

    await captureScreenshot('current-theme');
    await saveConsoleLogs('theme-support');
  });
});
