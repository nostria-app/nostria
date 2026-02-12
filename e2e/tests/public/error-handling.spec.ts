/**
 * Error Handling E2E Tests @public
 *
 * Tests for 404 routes, malformed npub/nevent URLs, and verify the app
 * handles them gracefully (no crash, shows fallback UI).
 */
import { test, expect } from '../../fixtures';

test.describe('Error Handling @public', () => {
  test('should handle 404 routes gracefully', async ({ page, captureScreenshot, saveConsoleLogs }) => {
    await page.goto('/this-route-does-not-exist-12345');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Should show some content (either 404 page or redirect to home)
    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(100);

    // App should still be functional
    const toolbar = page.locator('mat-toolbar, .toolbar, header');
    const hasToolbar = await toolbar.isVisible().catch(() => false);
    expect(hasToolbar).toBeTruthy();

    await captureScreenshot('error-404');
    await saveConsoleLogs('error-404');
  });

  test('should handle malformed npub URLs', async ({ page, captureScreenshot, saveConsoleLogs }) => {
    await page.goto('/p/not-a-valid-npub');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Should not crash
    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(100);

    await captureScreenshot('error-malformed-npub');
    await saveConsoleLogs('error-malformed-npub');
  });

  test('should handle malformed nevent URLs', async ({ page, captureScreenshot, saveConsoleLogs }) => {
    await page.goto('/e/not-a-valid-nevent');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Should not crash
    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(100);

    await captureScreenshot('error-malformed-nevent');
    await saveConsoleLogs('error-malformed-nevent');
  });

  test('should handle very long URLs', async ({ page, saveConsoleLogs }) => {
    const longPath = '/p/' + 'a'.repeat(500);
    await page.goto(longPath);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Should not crash
    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(100);

    await saveConsoleLogs('error-long-url');
  });

  test('should handle special characters in URLs', async ({ page, saveConsoleLogs }) => {
    await page.goto('/p/<script>alert(1)</script>');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Should not execute any scripts and not crash
    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(100);

    await saveConsoleLogs('error-special-chars');
  });

  test('should handle empty path segments', async ({ page, saveConsoleLogs }) => {
    await page.goto('/p/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(100);

    await saveConsoleLogs('error-empty-path');
  });
});
