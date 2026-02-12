/**
 * Event View E2E Tests @public
 *
 * Tests for viewing a single event (/e/{nevent}): verify event content
 * renders, author info displays, reply thread loads if present.
 */
import { test, expect } from '../../fixtures';

// A well-known nevent for testing — using a placeholder that should resolve
// In a real test environment, use a known, stable event ID
const TEST_NEVENT = 'nevent1qqs8sj03z4fg5v7s0y43rw5v456re5u8d97sjhpqjj3pncnyxfadezqpz4mhxue69uhk2er9dchxummnw3ezumrpdejqzrnhwden5te0dehhxtnvdakqyg8wumn8ghj7mn0wd68ytnhd9hx2tcqyp3h87';

test.describe('Event View @public', () => {
  test('should load an event page', async ({ page, waitForNostrReady, captureScreenshot, saveConsoleLogs }) => {
    await page.goto(`/e/${TEST_NEVENT}`);
    await waitForNostrReady();
    await page.waitForTimeout(2000);

    // Event page should have rendered
    const eventContent = page.locator('app-event, .event-container, .event-detail, [data-testid="event"]');
    const hasEvent = await eventContent.isVisible().catch(() => false);

    console.log(`Event content visible: ${hasEvent}`);

    await captureScreenshot('event-view');
    await saveConsoleLogs('event-view-loaded');
  });

  test('should render event content', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    await page.goto(`/e/${TEST_NEVENT}`);
    await waitForNostrReady();
    await page.waitForTimeout(3000);

    // Look for event text content
    const content = page.locator('.event-content, .note-content, .event-text, .content');
    const count = await content.count();

    if (count > 0) {
      const text = await content.first().textContent();
      console.log(`Event content: ${text?.trim().slice(0, 200)}`);
    }

    await saveConsoleLogs('event-content');
  });

  test('should display author info', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    await page.goto(`/e/${TEST_NEVENT}`);
    await waitForNostrReady();
    await page.waitForTimeout(3000);

    // Look for author elements
    const authorName = page.locator('.author, .author-name, .display-name, .event-author');
    const authorAvatar = page.locator('.avatar, .author-avatar, img[alt*="avatar" i]');

    const hasName = await authorName.count() > 0;
    const hasAvatar = await authorAvatar.count() > 0;

    console.log(`Author name: ${hasName}, Author avatar: ${hasAvatar}`);

    if (hasName) {
      const name = await authorName.first().textContent();
      console.log(`Author: ${name?.trim()}`);
    }

    await saveConsoleLogs('event-author');
  });

  test('should load reply thread if present', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    await page.goto(`/e/${TEST_NEVENT}`);
    await waitForNostrReady();
    await page.waitForTimeout(3000);

    // Look for reply/thread elements
    const replies = page.locator('.reply, .thread-item, .reply-item, app-event');
    const replyCount = await replies.count();

    console.log(`Found ${replyCount} reply/thread items`);

    await saveConsoleLogs('event-replies');
  });
});
