import { test } from '../../fixtures';

test.describe('Showcase Warmup @demo @demo-showcase-warmup', () => {
  test('Authenticate, preload profile, wait, reload @demo @demo-showcase-warmup @auth', async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    await page.goto('/summary', { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForTimeout(2_000);
    await page.waitForLoadState('networkidle').catch(() => undefined);

    await page.waitForTimeout(5_000);

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForTimeout(1_500);
  });
});
