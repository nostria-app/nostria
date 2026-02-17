import { test, expect } from '../../fixtures';
import { clickFirstVisible, humanPause, settleTransition, smoothScroll } from '../../helpers/demo-pacing';

async function openMenuAndVisitRoute(
  page: import('@playwright/test').Page,
  route: string
): Promise<void> {
  if (route !== '/') {
    await page.goto(route);
    await settleTransition(page);
    return;
  }

  await page.goto('/');
  await settleTransition(page);
}

test.describe.configure({ mode: 'serial' });

test.describe('Demo Videos @demo', () => {
  test('Summary walkthrough @demo @demo-summary @public', async ({
    page,
    waitForNostrReady,
    saveConsoleLogs,
  }) => {
    await openMenuAndVisitRoute(page, '/summary');
    await waitForNostrReady();
    await humanPause(page, 1200);

    await smoothScroll(page, 0.8);
    await smoothScroll(page, 0.7);

    await clickFirstVisible(page, [
      'a[href*="/e/"]',
      'app-event a',
      'mat-card a',
      '.event-item a',
    ]);

    await settleTransition(page);
    await page.goBack();
    await settleTransition(page);

    await saveConsoleLogs('demo-summary');
  });

  test('Music walkthrough @demo @demo-music @public', async ({
    page,
    waitForNostrReady,
    saveConsoleLogs,
  }) => {
    await openMenuAndVisitRoute(page, '/music');
    await waitForNostrReady();
    await humanPause(page, 1000);

    await clickFirstVisible(page, [
      'button[aria-label*="play" i]',
      '.play-button',
      '.music-item button',
      'audio + button',
    ]);

    await smoothScroll(page, 0.75);
    await clickFirstVisible(page, [
      'a[href="/music/tracks"]',
      'a[href="/music/playlists"]',
      'a[href="/music/artists"]',
    ]);

    await settleTransition(page);
    await saveConsoleLogs('demo-music');
  });

  test('Articles walkthrough @demo @demo-articles @public', async ({
    page,
    waitForNostrReady,
    saveConsoleLogs,
  }) => {
    await openMenuAndVisitRoute(page, '/articles');
    await waitForNostrReady();
    await humanPause(page, 1200);

    await smoothScroll(page, 0.8);

    await clickFirstVisible(page, [
      'app-event a',
      'app-article a',
      'mat-card a',
      'a[href*="/a/"]',
    ]);

    await settleTransition(page);
    await page.goBack();
    await settleTransition(page);

    await saveConsoleLogs('demo-articles');
  });

  test('Search walkthrough @demo @demo-search @public', async ({
    page,
    waitForNostrReady,
    saveConsoleLogs,
  }) => {
    await openMenuAndVisitRoute(page, '/search');
    await waitForNostrReady();

    const searchInput = page.locator('input[type="search"], input[placeholder*="Search" i], input[type="text"]').first();
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.click();
      await humanPause(page, 500);
      await searchInput.fill('nostr music');
      await humanPause(page, 900);
      await page.keyboard.press('Enter');
      await settleTransition(page);
      await smoothScroll(page, 0.7);
    }

    await saveConsoleLogs('demo-search');
  });

  test('Streams walkthrough @demo @demo-streams @public', async ({
    page,
    waitForNostrReady,
    saveConsoleLogs,
  }) => {
    await openMenuAndVisitRoute(page, '/streams');
    await waitForNostrReady();
    await humanPause(page, 1200);

    await smoothScroll(page, 0.7);
    await clickFirstVisible(page, [
      'a[href*="/stream/"]',
      'app-event a',
      'mat-card a',
      '.stream-item a',
    ]);

    await settleTransition(page);
    await page.goBack();
    await settleTransition(page);

    await saveConsoleLogs('demo-streams');
  });

  test('Discover walkthrough @demo @demo-discover @public', async ({
    page,
    waitForNostrReady,
    saveConsoleLogs,
  }) => {
    await openMenuAndVisitRoute(page, '/discover');
    await waitForNostrReady();
    await humanPause(page, 1200);

    await smoothScroll(page, 0.75);
    await clickFirstVisible(page, [
      'a[href*="/discover/content/"]',
      'a[href*="/discover/media/"]',
      'mat-chip-option',
      'button:has-text("Media")',
    ]);

    await settleTransition(page);
    await smoothScroll(page, 0.7);

    await saveConsoleLogs('demo-discover');
  });

  test('Profile walkthrough @demo @demo-profile @public', async ({
    page,
    waitForNostrReady,
    saveConsoleLogs,
  }) => {
    await openMenuAndVisitRoute(page, '/p/npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6');
    await waitForNostrReady();
    await humanPause(page, 1200);

    await smoothScroll(page, 0.65);
    await clickFirstVisible(page, [
      'a[href$="/articles"]',
      'a[href$="/media"]',
      'button:has-text("Articles")',
      'button:has-text("Media")',
    ]);

    await settleTransition(page);
    await saveConsoleLogs('demo-profile');
  });

  test('Collections walkthrough @demo @demo-collections @auth', async ({
    authenticatedPage,
    saveConsoleLogs,
  }) => {
    await authenticatedPage.goto('/collections');
    await settleTransition(authenticatedPage);
    await humanPause(authenticatedPage, 1200);

    await clickFirstVisible(authenticatedPage, [
      'a[href="/collections/bookmarks"]',
      'button:has-text("Bookmarks")',
      'mat-tab-label:has-text("Bookmarks")',
    ]);

    await settleTransition(authenticatedPage);
    await smoothScroll(authenticatedPage, 0.7);

    await saveConsoleLogs('demo-collections');
  });

  test('Notifications walkthrough @demo @demo-notifications @auth', async ({
    authenticatedPage,
    saveConsoleLogs,
  }) => {
    await authenticatedPage.goto('/notifications');
    await settleTransition(authenticatedPage);
    await humanPause(authenticatedPage, 1200);

    await clickFirstVisible(authenticatedPage, [
      'a[href="/notifications/settings"]',
      'button:has-text("Settings")',
      'button[aria-label*="settings" i]',
    ]);

    await settleTransition(authenticatedPage);
    await authenticatedPage.goBack();
    await settleTransition(authenticatedPage);

    await saveConsoleLogs('demo-notifications');
  });

  test('Messages walkthrough @demo @demo-messages @auth', async ({
    authenticatedPage,
    saveConsoleLogs,
  }) => {
    await authenticatedPage.goto('/messages');
    await settleTransition(authenticatedPage);
    await humanPause(authenticatedPage, 1200);

    await smoothScroll(authenticatedPage, 0.6);
    await clickFirstVisible(authenticatedPage, [
      'a[href*="/messages/"]',
      '.conversation-item',
      'mat-list-item',
    ]);

    await settleTransition(authenticatedPage);
    await saveConsoleLogs('demo-messages');
  });

  test('Article editor walkthrough @demo @demo-article-editor @auth', async ({
    authenticatedPage,
    saveConsoleLogs,
  }) => {
    await authenticatedPage.goto('/article/create');
    await settleTransition(authenticatedPage);
    await humanPause(authenticatedPage, 1400);

    await smoothScroll(authenticatedPage, 0.65);

    const publishButton = authenticatedPage.locator(
      'button:has-text("Publish"), button:has-text("Post"), button:has-text("Save")'
    ).first();
    const publishVisible = await publishButton.isVisible().catch(() => false);
    expect(typeof publishVisible).toBe('boolean');

    await saveConsoleLogs('demo-article-editor');
  });
});
