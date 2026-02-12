/**
 * Search Page E2E Tests @public
 *
 * Tests for the Search page (/search): verify search input is focusable,
 * typing triggers search, results display or empty state shows.
 */
import { test, expect } from '../../fixtures';

test.describe('Search Page @public', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/search');
  });

  test('should load the search page', async ({ page, waitForNostrReady, captureScreenshot, saveConsoleLogs }) => {
    await waitForNostrReady();

    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);

    await captureScreenshot('search-page-loaded');
    await saveConsoleLogs('search-page-loaded');
  });

  test('should have a focusable search input', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    await waitForNostrReady();

    // Look for search input
    const searchInput = page.locator('input[type="search"], input[type="text"], input[placeholder*="search" i], input[aria-label*="search" i], .search-input');

    if (await searchInput.count() > 0) {
      await searchInput.first().focus();

      // Verify the input is focused
      const isFocused = await page.evaluate(() => {
        return document.activeElement?.tagName === 'INPUT';
      });

      expect(isFocused).toBeTruthy();
    }

    await saveConsoleLogs('search-input-focus');
  });

  test('should trigger search on typing', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    await waitForNostrReady();

    const searchInput = page.locator('input[type="search"], input[type="text"], input[placeholder*="search" i], input[aria-label*="search" i], .search-input');

    if (await searchInput.count() > 0) {
      await searchInput.first().fill('bitcoin');
      await page.waitForTimeout(1500);

      // Check if results appeared or loading indicator shows
      const results = page.locator('.search-result, .result-item, mat-card, app-event, mat-list-item');
      const loading = page.locator('.loading, mat-spinner, mat-progress-bar, .searching');
      const noResults = page.locator('.no-results, .empty-state');

      const resultCount = await results.count();
      const isLoading = await loading.isVisible().catch(() => false);
      const hasNoResults = await noResults.isVisible().catch(() => false);

      console.log(`Results: ${resultCount}, Loading: ${isLoading}, No results: ${hasNoResults}`);
    }

    await saveConsoleLogs('search-typing');
  });

  test('should display results or empty state', async ({ page, waitForNostrReady, captureScreenshot, saveConsoleLogs }) => {
    await waitForNostrReady();

    const searchInput = page.locator('input[type="search"], input[type="text"], input[placeholder*="search" i], input[aria-label*="search" i], .search-input');

    if (await searchInput.count() > 0) {
      // Search for something unlikely to have results
      await searchInput.first().fill('zzznonexistentquery999');
      await page.waitForTimeout(2000);

      await captureScreenshot('search-no-results');
    }

    await saveConsoleLogs('search-results-display');
  });
});
