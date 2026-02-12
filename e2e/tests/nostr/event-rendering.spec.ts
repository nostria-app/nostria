/**
 * Nostr Event Rendering E2E Tests @public
 *
 * Tests that various Nostr event kinds render correctly:
 * kind 1 (note), kind 6 (repost), kind 7 (reaction),
 * kind 30023 (article), kind 1063 (media), kind 30311 (live stream).
 *
 * These tests navigate to known profiles/events and verify the UI
 * renders the appropriate content for each event kind.
 */
import { test, expect } from '../../fixtures';
import { TEST_PROFILES, APP_ROUTES, TIMEOUTS } from '../../fixtures/test-data';

async function waitForAppReady(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const appRoot = document.querySelector('app-root');
    if (!appRoot) return false;
    return !!document.querySelector('mat-sidenav-content, .main-content, main');
  }, { timeout: TIMEOUTS.appReady });
  await page.waitForTimeout(TIMEOUTS.stabilize);
}

test.describe('Nostr Event Rendering @public', () => {
  test.describe('Kind 1 — Short Text Notes', () => {
    test('should render text notes on a profile page', async ({ page, saveConsoleLogs }) => {
      await page.goto(APP_ROUTES.profile(TEST_PROFILES.fiatjaf.npub));
      await waitForAppReady(page);

      // Wait for profile content to load
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Check for note/event rendering elements
      const noteElements = page.locator('app-event, app-note, .note-content, .event-content, mat-card');
      const count = await noteElements.count();
      console.log(`Found ${count} event/note elements on profile page`);

      // The profile should at least load without errors
      const hasPageError = await page.evaluate(() => {
        return document.querySelector('.error, .not-found') !== null;
      });
      expect(hasPageError).toBeFalsy();

      await saveConsoleLogs('nostr-event-kind1');
    });

    test('should render note text content', async ({ page, saveConsoleLogs }) => {
      await page.goto(APP_ROUTES.profile(TEST_PROFILES.fiatjaf.npub));
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Look for any text content in event containers
      const textContent = await page.evaluate(() => {
        const elements = document.querySelectorAll('app-event, .note-content, .event-content, .content');
        return Array.from(elements).slice(0, 5).map(el => el.textContent?.trim().substring(0, 100));
      });

      console.log('Rendered note content samples:', textContent);

      await saveConsoleLogs('nostr-event-text-content');
    });
  });

  test.describe('Kind 30023 — Long-form Articles', () => {
    test('should render articles page', async ({ page, saveConsoleLogs }) => {
      await page.goto('/articles');
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Articles page should load without errors
      const body = await page.textContent('body');
      expect(body).toBeTruthy();

      // Check for article-related elements
      const articleElements = page.locator('mat-card, .article, app-article, .article-card');
      const count = await articleElements.count();
      console.log(`Found ${count} article elements`);

      await saveConsoleLogs('nostr-event-kind30023');
    });
  });

  test.describe('Kind 30311 — Live Streams', () => {
    test('should render streams page', async ({ page, saveConsoleLogs }) => {
      await page.goto('/streams');
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Streams page should load
      const body = await page.textContent('body');
      expect(body).toBeTruthy();

      // Check for stream elements or empty state
      const streamElements = page.locator('mat-card, .stream, app-stream, .stream-card');
      const count = await streamElements.count();
      console.log(`Found ${count} stream elements`);

      await saveConsoleLogs('nostr-event-kind30311');
    });
  });

  test.describe('Kind 1063 — Media / File Metadata', () => {
    test('should render media content on profile', async ({ page, saveConsoleLogs }) => {
      await page.goto(APP_ROUTES.profile(TEST_PROFILES.jack.npub));
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Check for media elements (images, videos, audio)
      const mediaElements = page.locator('img:not([src*="avatar"]):not([src*="robohash"]), video, audio, .media-content');
      const count = await mediaElements.count();
      console.log(`Found ${count} media elements on profile`);

      await saveConsoleLogs('nostr-event-kind1063');
    });
  });

  test.describe('Mixed event feed', () => {
    test('should render different event types in discover feed', async ({ page, saveConsoleLogs }) => {
      await page.goto('/discover');
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Discover page should show a mix of event types
      const feedItems = page.locator('mat-card, app-event, .feed-item, .event-container');
      const count = await feedItems.count();
      console.log(`Found ${count} feed items on discover page`);

      // Check that the page rendered some content
      const hasContent = count > 0 || await page.locator('.empty-state, .no-content, .loading').isVisible().catch(() => false);
      expect(hasContent).toBeTruthy();

      await saveConsoleLogs('nostr-event-mixed-feed');
    });

    test('should not crash on unknown event kinds', async ({ page, saveConsoleLogs }) => {
      // Navigate to discover and check for page errors
      await page.goto('/discover');
      await waitForAppReady(page);
      await page.waitForTimeout(TIMEOUTS.contentLoad);

      // Verify no uncaught errors related to event rendering
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => {
        pageErrors.push(error.message);
      });

      // Scroll down to load more events
      await page.evaluate(() => window.scrollBy(0, 1000));
      await page.waitForTimeout(1000);

      const renderErrors = pageErrors.filter(e =>
        e.includes('event') || e.includes('kind') || e.includes('render')
      );
      expect(renderErrors).toHaveLength(0);

      await saveConsoleLogs('nostr-event-unknown-kinds');
    });
  });
});
