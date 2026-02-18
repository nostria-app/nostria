import { test } from '../../fixtures';
import { clickFirstVisible, humanPause, smoothScroll } from '../../helpers/demo-pacing';

async function showcaseTransition(page: import('@playwright/test').Page, delayMs = 900): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForTimeout(delayMs);
}

async function spaNavigate(page: import('@playwright/test').Page, path: string): Promise<void> {
  await page.evaluate((targetPath) => {
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, path);

  await showcaseTransition(page, 1400);
}

async function safeClick(page: import('@playwright/test').Page, selectors: string[]): Promise<boolean> {
  try {
    return await clickFirstVisible(page, selectors);
  } catch {
    return false;
  }
}

async function gotoWithRetry(page: import('@playwright/test').Page, url: string): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(2_000);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined);
    }
  }

  throw lastError;
}

async function runMusicFlow(page: import('@playwright/test').Page): Promise<void> {
  await spaNavigate(page, '/music');
  await humanPause(page, 1600);

  await page
    .locator('.track, .music-item, mat-list-item, mat-card, app-event')
    .first()
    .waitFor({ timeout: 12_000 })
    .catch(() => undefined);

  await safeClick(page, [
    'button:has-text("Show all")',
    'a:has-text("Show all")',
    'button:has-text("All songs")',
  ]);

  await smoothScroll(page, 0.45);

  await safeClick(page, [
    'a[href*="/music/song/"]',
    '.track a',
    '.music-item a',
    'mat-list-item a',
    'app-event a',
  ]);

  await showcaseTransition(page, 1400);

  await safeClick(page, [
    'button[aria-label*="play" i]',
    'button:has-text("Play")',
    '.play-button',
  ]);

  await humanPause(page, 2200);

  await safeClick(page, [
    'button[aria-label*="fullscreen" i]',
    'button[aria-label*="maximize" i]',
    'button[aria-label*="expand" i]',
    '.mini-player button[aria-label*="expand" i]',
  ]);

  await humanPause(page, 3500);

  await safeClick(page, [
    'button[aria-label*="close" i]',
    'button[aria-label*="minimize" i]',
    'button[aria-label*="collapse" i]',
    'button:has-text("Close")',
  ]);

  await humanPause(page, 1000);
}

test.describe('Single Session Showcase @demo @demo-showcase', () => {
  test('Full product walkthrough in one recording @demo @demo-showcase @auth', async ({
    authenticatedPage,
    saveConsoleLogs,
  }) => {
    test.setTimeout(8 * 60_000);

    const page = authenticatedPage;

    await gotoWithRetry(page, '/');
    await showcaseTransition(page, 1600);
    await humanPause(page, 900);

    await spaNavigate(page, '/summary');
    await smoothScroll(page, 0.72);
    await safeClick(page, ['a[href*="/e/"]', 'app-event a', 'mat-card a']);
    await showcaseTransition(page, 1200);
    await page.goBack().catch(() => undefined);
    await showcaseTransition(page, 1000);

    await runMusicFlow(page);

    await spaNavigate(page, '/articles');
    await smoothScroll(page, 0.7);
    await safeClick(page, ['app-event a', 'app-article a', 'a[href*="/a/"]', 'mat-card a']);
    await showcaseTransition(page, 1200);
    await page.goBack().catch(() => undefined);
    await showcaseTransition(page, 1000);

    await spaNavigate(page, '/discover');
    await smoothScroll(page, 0.72);
    await safeClick(page, [
      'a[href*="/discover/content/"]',
      'a[href*="/discover/media/"]',
      'button:has-text("Media")',
    ]);
    await showcaseTransition(page, 1000);

    await spaNavigate(page, '/search');
    const searchInput = page
      .locator('input[type="search"], input[placeholder*="Search" i], input[type="text"]')
      .first();
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.click();
      await searchInput.fill('nostr music');
      await humanPause(page, 700);
      await page.keyboard.press('Enter');
      await showcaseTransition(page, 1200);
    }

    await spaNavigate(page, '/streams');
    await smoothScroll(page, 0.6);
    await safeClick(page, ['a[href*="/stream/"]', 'app-event a', 'mat-card a']);
    await showcaseTransition(page, 1200);
    await page.goBack().catch(() => undefined);
    await showcaseTransition(page, 1000);

    await spaNavigate(page, '/p/npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6');
    await smoothScroll(page, 0.58);
    await showcaseTransition(page, 1000);

    await spaNavigate(page, '/collections');
    await safeClick(page, ['a[href="/collections/bookmarks"]', 'button:has-text("Bookmarks")']);
    await showcaseTransition(page, 1000);

    await spaNavigate(page, '/notifications');
    await safeClick(page, [
      'a[href="/notifications/settings"]',
      'button:has-text("Settings")',
      'button[aria-label*="settings" i]',
    ]);
    await showcaseTransition(page, 900);

    await spaNavigate(page, '/messages');
    await safeClick(page, ['a[href*="/messages/"]', '.conversation-item', 'mat-list-item']);
    await showcaseTransition(page, 900);

    await spaNavigate(page, '/article/create');
    await humanPause(page, 1200);
    await smoothScroll(page, 0.55);

    await saveConsoleLogs('demo-showcase-single-session');
  });
});
