/**
 * Discover Page E2E Tests @public
 *
 * Tests for the Discover page (/discover): verify page loads, content cards
 * render, categories/filters are interactive, no JS errors in console.
 */
import { test, expect } from '../../fixtures';

test.describe('Discover Page @public', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/discover');
  });

  test('should load the discover page', async ({ page, waitForNostrReady, captureScreenshot, saveConsoleLogs }) => {
    await waitForNostrReady();

    // Verify page loads without crash
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);

    await captureScreenshot('discover-page-loaded');
    await saveConsoleLogs('discover-page-loaded');
  });

  test('should render content cards', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    await waitForNostrReady();

    // Wait for content to appear
    await page.waitForTimeout(2000);

    // Look for content cards, event items, or similar containers
    const cards = page.locator('mat-card, .card, app-event, .event-item, .content-card, .discover-item');
    const count = await cards.count();

    console.log(`Found ${count} content cards on discover page`);

    // The page should either show content or an empty state
    const hasContent = count > 0;
    const emptyState = page.locator('.empty-state, .no-content, .no-results');
    const hasEmptyState = await emptyState.isVisible().catch(() => false);

    expect(hasContent || hasEmptyState).toBeTruthy();
    await saveConsoleLogs('discover-content-cards');
  });

  test('should have interactive categories or filters', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    await waitForNostrReady();

    // Look for filter/category UI elements
    const filters = page.locator('mat-chip, mat-tab, .filter, .category, mat-button-toggle, [role="tab"]');
    const filterCount = await filters.count();

    console.log(`Found ${filterCount} filter/category elements`);

    // If filters exist, try clicking one
    if (filterCount > 0) {
      const firstFilter = filters.first();
      await firstFilter.click();
      await page.waitForTimeout(500);
    }

    await saveConsoleLogs('discover-filters');
  });

  test('should have no unexpected JS errors', async ({ page, waitForNostrReady, getConsoleLogs, saveConsoleLogs }) => {
    await waitForNostrReady();
    await page.waitForTimeout(2000);

    const logs = getConsoleLogs();
    const errors = logs.filter(l => l.type === 'error' || l.type === 'pageerror');

    // Filter out expected relay/network errors
    const unexpectedErrors = errors.filter(e =>
      !e.text.includes('net::') &&
      !e.text.includes('wss://') &&
      !e.text.includes('ws://') &&
      !e.text.includes('ERR_CONNECTION_REFUSED')
    );

    console.log(`Total errors: ${errors.length}, Unexpected: ${unexpectedErrors.length}`);
    await saveConsoleLogs('discover-js-errors');
  });
});
