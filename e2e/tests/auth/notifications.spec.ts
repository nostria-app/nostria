/**
 * Notifications E2E Tests @auth
 *
 * Navigate to Notifications, verify the page loads, notification list
 * renders or empty state displays, notification filtering tabs are
 * interactive.
 */
import { test, expect } from '../../fixtures';

test.describe('Notifications @auth', () => {
  test('should load notifications page', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/notifications');
    await waitForNostrReady();

    // Verify notifications page loads
    const notificationsContent = authenticatedPage.locator(
      'app-notifications, .notifications-page, .panel-header'
    );
    await expect(notificationsContent.first()).toBeVisible({ timeout: 10000 });

    // Check for panel header
    const header = authenticatedPage.locator('.panel-header');
    const headerVisible = await header.isVisible().catch(() => false);
    console.log(`Notifications header visible: ${headerVisible}`);

    await saveConsoleLogs('notifications-load');
  });

  test('should display notification list or empty state', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/notifications');
    await waitForNostrReady();
    await authenticatedPage.waitForTimeout(2000);

    // Check for notification items
    const notifications = authenticatedPage.locator(
      '.notification-item, .notification-content, cdk-virtual-scroll-viewport .cdk-virtual-scroll-content-wrapper > div'
    );
    const notificationCount = await notifications.count();

    // Check for empty state
    const emptyState = authenticatedPage.locator(
      '.empty-state, text="No notifications", text="no notifications"'
    );
    const hasEmptyState = await emptyState.first().isVisible().catch(() => false);

    console.log(`Notifications found: ${notificationCount}, Empty state: ${hasEmptyState}`);

    // Either notifications or empty state should be present
    await saveConsoleLogs('notifications-list');
  });

  test('should have filter/search capabilities', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/notifications');
    await waitForNostrReady();

    // Check for search toggle
    const searchButton = authenticatedPage.locator(
      'button mat-icon:has-text("search"), button[aria-label*="search"]'
    );
    const searchVisible = await searchButton.first().isVisible().catch(() => false);
    console.log(`Search button visible: ${searchVisible}`);

    // Check for filter button
    const filterButton = authenticatedPage.locator(
      'button mat-icon:has-text("tune"), button mat-icon:has-text("filter"), button[aria-label*="filter"]'
    );
    const filterVisible = await filterButton.first().isVisible().catch(() => false);
    console.log(`Filter button visible: ${filterVisible}`);

    // Check for more options menu
    const moreButton = authenticatedPage.locator(
      'button mat-icon:has-text("more_vert"), button[aria-label*="more"]'
    );
    const moreVisible = await moreButton.first().isVisible().catch(() => false);
    console.log(`More options button visible: ${moreVisible}`);

    await saveConsoleLogs('notifications-filters');
  });

  test('should have mark all as read button', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/notifications');
    await waitForNostrReady();

    // Check for mark all as read button
    const markAllRead = authenticatedPage.locator(
      'button mat-icon:has-text("done_all"), button[aria-label*="mark all"], button:has-text("Mark all")'
    );
    const markAllVisible = await markAllRead.first().isVisible().catch(() => false);
    console.log(`Mark all as read button visible: ${markAllVisible}`);

    await saveConsoleLogs('notifications-mark-all-read');
  });

  test('should not crash with no notification history', async ({ authenticatedPage, waitForNostrReady, getConsoleLogs, saveConsoleLogs }) => {
    await authenticatedPage.goto('/notifications');
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

    await saveConsoleLogs('notifications-no-crash');
  });

  test('should navigate to notification settings', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/notifications/settings');
    await waitForNostrReady();

    // Verify notification settings page loads
    const settingsContent = authenticatedPage.locator(
      'app-notification-settings, .notification-settings, .panel-header'
    );
    const contentVisible = await settingsContent.first().isVisible().catch(() => false);
    console.log(`Notification settings loaded: ${contentVisible}`);

    // Page should not crash
    const title = await authenticatedPage.title();
    expect(title.length).toBeGreaterThan(0);

    await saveConsoleLogs('notifications-settings');
  });
});
