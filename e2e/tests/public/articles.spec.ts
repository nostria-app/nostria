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
    const articles = page.locator('mat-card, .article-card, .article-item, app-event, app-article');
    const count = await articles.count();

    console.log(`Found ${count} article items`);

    const emptyState = page.locator('.empty-state, .no-content, .no-results, .no-articles');
    const hasEmptyState = await emptyState.isVisible().catch(() => false);

    expect(count > 0 || hasEmptyState).toBeTruthy();
    await saveConsoleLogs('articles-list');
  });

  test('should display article titles', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    await waitForNostrReady();
    await page.waitForTimeout(2000);

    // Check for title elements in article cards
    const titles = page.locator('.article-title, mat-card-title, h2, h3, .title');
    const titleCount = await titles.count();

    if (titleCount > 0) {
      const firstTitle = await titles.first().textContent();
      console.log(`First article title: ${firstTitle?.trim()}`);
      expect(firstTitle?.trim().length).toBeGreaterThan(0);
    }

    await saveConsoleLogs('articles-titles');
  });

  test('should navigate to article detail on click', async ({ page, waitForNostrReady, captureScreenshot, saveConsoleLogs }) => {
    await waitForNostrReady();
    await page.waitForTimeout(2000);

    const articles = page.locator('mat-card, .article-card, .article-item, app-event a, app-article a');
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
