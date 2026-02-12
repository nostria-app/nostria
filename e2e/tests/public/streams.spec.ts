/**
 * Streams Page E2E Tests @public
 *
 * Tests for the Streams page (/streams): verify stream cards render,
 * live indicator works if streams are active.
 */
import { test, expect } from '../../fixtures';

test.describe('Streams Page @public', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/streams');
  });

  test('should load the streams page', async ({ page, waitForNostrReady, captureScreenshot, saveConsoleLogs }) => {
    await waitForNostrReady();

    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);

    await captureScreenshot('streams-page-loaded');
    await saveConsoleLogs('streams-page-loaded');
  });

  test('should render stream cards', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    await waitForNostrReady();
    await page.waitForTimeout(2000);

    // Look for stream cards/items
    const streams = page.locator('mat-card, .stream-card, .stream-item, app-event, .live-stream');
    const count = await streams.count();

    console.log(`Found ${count} stream items`);

    const emptyState = page.locator('.empty-state, .no-content, .no-streams');
    const hasEmptyState = await emptyState.isVisible().catch(() => false);

    expect(count > 0 || hasEmptyState).toBeTruthy();
    await saveConsoleLogs('streams-cards');
  });

  test('should show live indicator for active streams', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    await waitForNostrReady();
    await page.waitForTimeout(2000);

    // Look for live indicators
    const liveIndicators = page.locator('.live, .live-badge, .live-indicator, [data-live="true"], .status-live');
    const liveCount = await liveIndicators.count();

    console.log(`Found ${liveCount} live indicators`);

    // If there are live streams, verify the indicator is visible
    if (liveCount > 0) {
      await expect(liveIndicators.first()).toBeVisible();
    }

    await saveConsoleLogs('streams-live-indicator');
  });
});
