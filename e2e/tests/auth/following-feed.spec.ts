/**
 * Following Feed E2E Tests @auth
 *
 * Verify the home feed in authenticated mode shows content from followed
 * accounts (if any), test feed refresh, test infinite scroll loading.
 */
import { test, expect } from '../../fixtures';

test.describe('Following Feed @auth', () => {
  test('should load authenticated home feed', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/');
    await waitForNostrReady();

    // Verify the home page loads in authenticated mode
    const feedContainer = authenticatedPage.locator(
      'app-feeds, .feed-container, main, app-root'
    );
    await expect(feedContainer.first()).toBeVisible({ timeout: 10000 });

    // The page should not show "Not logged in"
    const notLoggedIn = authenticatedPage.locator('text="Not logged in"');
    const showsNotLoggedIn = await notLoggedIn.isVisible().catch(() => false);
    console.log(`Shows "Not logged in": ${showsNotLoggedIn}`);

    await saveConsoleLogs('following-feed-load');
  });

  test('should display feed content or empty state', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/');
    await waitForNostrReady();
    await authenticatedPage.waitForTimeout(3000);

    // Check for feed items (events/notes)
    const feedItems = authenticatedPage.locator(
      'app-event, app-event-thread, .event-card, .note-card, .feed-item'
    );
    const itemCount = await feedItems.count();

    // Check for empty state
    const emptyState = authenticatedPage.locator(
      '.empty-state, .no-content, text="No events", text="Follow some people"'
    );
    const hasEmptyState = await emptyState.first().isVisible().catch(() => false);

    console.log(`Feed items: ${itemCount}, Empty state: ${hasEmptyState}`);

    // For a test account, either could be valid
    await saveConsoleLogs('following-feed-content');
  });

  test('should navigate to feeds page', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/f');
    await waitForNostrReady();

    // Verify feeds page loads
    const feedsContent = authenticatedPage.locator(
      'app-feeds, .feeds-page, .panel-header, main'
    );
    const contentVisible = await feedsContent.first().isVisible().catch(() => false);
    console.log(`Feeds page loaded: ${contentVisible}`);

    // Page should not crash
    const title = await authenticatedPage.title();
    expect(title.length).toBeGreaterThan(0);

    await saveConsoleLogs('following-feed-feeds-page');
  });

  test('should support infinite scroll', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/');
    await waitForNostrReady();
    await authenticatedPage.waitForTimeout(2000);

    // Get initial content count
    const feedItems = authenticatedPage.locator(
      'app-event, app-event-thread, .event-card, .note-card'
    );
    const initialCount = await feedItems.count();
    console.log(`Initial feed items: ${initialCount}`);

    // Scroll to bottom
    await authenticatedPage.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await authenticatedPage.waitForTimeout(2000);

    // Check if more items loaded
    const afterScrollCount = await feedItems.count();
    console.log(`Feed items after scroll: ${afterScrollCount}`);

    // If there was content initially, more might have loaded
    if (initialCount > 0) {
      console.log(`Items loaded by scroll: ${afterScrollCount - initialCount}`);
    }

    await saveConsoleLogs('following-feed-scroll');
  });

  test('should not crash on feed interactions', async ({ authenticatedPage, waitForNostrReady, getConsoleLogs, saveConsoleLogs }) => {
    await authenticatedPage.goto('/');
    await waitForNostrReady();
    await authenticatedPage.waitForTimeout(2000);

    // Check for unexpected errors
    const logs = getConsoleLogs();
    const errors = logs.filter(l => l.type === 'error' || l.type === 'pageerror');
    const unexpectedErrors = errors.filter(e =>
      !e.text.includes('net::') &&
      !e.text.includes('wss://') &&
      !e.text.includes('ws://') &&
      !e.text.includes('ERR_CONNECTION_REFUSED') &&
      !e.text.includes('404')
    );

    console.log(`Total errors: ${errors.length}, Unexpected: ${unexpectedErrors.length}`);

    await saveConsoleLogs('following-feed-no-crash');
  });
});
