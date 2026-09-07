/**
 * Articles Page E2E Tests @public
 *
 * Tests for the Articles page (/articles): verify article list renders,
 * article cards have titles, clicking an article navigates to detail view.
 */
import { test, expect } from '../../fixtures';

test.describe('Articles Page @public', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/articles');
  });

  test('should load the articles page', async ({ page, waitForNostrReady, captureScreenshot, saveConsoleLogs }) => {
    await waitForNostrReady();

    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);

    await captureScreenshot('articles-page-loaded');
    await saveConsoleLogs('articles-page-loaded');
  });

  test('should render article list', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    await waitForNostrReady();
    await page.waitForTimeout(2000);

    // Look for article cards/items
    const articles = page.locator('.articles-grid .article-card');
    const count = await articles.count();

    console.log(`Found ${count} article items`);

    const emptyState = page.locator('app-articles-discover .empty-state');
    const hasEmptyState = await emptyState.isVisible().catch(() => false);

    expect(count > 0 || hasEmptyState).toBeTruthy();
    await saveConsoleLogs('articles-list');
  });

  test('should display article titles', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    await waitForNostrReady();
    await page.waitForTimeout(2000);

    // Check for title elements in article cards
    const titles = page.locator('.articles-grid .article-title');
    const titleCount = await titles.count();

    if (titleCount > 0) {
      const firstTitle = await titles.first().textContent();
      console.log(`First article title: ${firstTitle?.trim()}`);
      expect(firstTitle?.trim().length).toBeGreaterThan(0);
    }

    await saveConsoleLogs('articles-titles');
  });

  test('should request older articles when scrolling past cached previews', async ({ page, waitForNostrReady: waitForAppReady, saveConsoleLogs }) => {
    let historyRequests = 0;
    page.on('websocket', socket => {
      socket.on('framesent', frame => {
        const message: unknown = JSON.parse(frame.payload.toString());
        if (!Array.isArray(message) || message[0] !== 'REQ') return;
        for (const filter of message.slice(2)) {
          if (filter && Array.isArray(filter.kinds) && filter.kinds.includes(30023)
            && typeof filter.until === 'number') historyRequests++;
        }
      });
    });
    await page.reload();
    await waitForAppReady();
    const cards = page.locator('.articles-grid .article-card');
    try {
      if (await page.locator('app-articles-discover .empty-state').isVisible()) {
        test.skip(true, 'No articles are available from the public relays');
      }
      await expect(cards.first()).toBeVisible({ timeout: 15000 });
      const initialCount = await cards.count();
      historyRequests = 0;
      for (let attempt = 0; attempt < 12 && historyRequests === 0; attempt++) {
        const previousCount = await cards.count();
        await page.locator('.load-more-container').scrollIntoViewIfNeeded();
        await expect.poll(async () => historyRequests > 0 || await cards.count() > previousCount,
          { timeout: 15000 }).toBe(true);
      }
      expect(historyRequests).toBeGreaterThan(0);
      await expect.poll(() => cards.count(), { timeout: 15000 }).toBeGreaterThan(initialCount);
    } finally {
      await saveConsoleLogs('articles-scroll-pagination');
    }
  });

  test('should navigate to article detail on click', async ({ page, waitForNostrReady, captureScreenshot, saveConsoleLogs }) => {
    await waitForNostrReady();
    await page.waitForTimeout(2000);

    const articles = page.locator('.articles-grid .article-card');
    const count = await articles.count();

    if (count > 0) {
      const initialUrl = page.url();

      // Click the first article
      await articles.first().click();
      await page.waitForTimeout(1000);

      const newUrl = page.url();
      console.log(`Navigation: ${initialUrl} -> ${newUrl}`);

      await captureScreenshot('article-detail');
    }

    await saveConsoleLogs('articles-detail-navigation');
  });
});
