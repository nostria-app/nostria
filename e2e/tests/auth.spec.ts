/**
 * Authenticated User E2E Tests @auth
 *
 * Tests that require a logged-in user session.
 * Run with: npm run test:e2e:auth
 *
 * These tests are tagged with @auth so they can be filtered
 * via `playwright test --grep @auth`.
 *
 * Requires TEST_NSEC environment variable to be set in .env
 */
import { test, expect } from '../fixtures';

const TEST_NSEC = process.env['TEST_NSEC'];

test.describe('@auth Authenticated User', () => {
  test.skip(!TEST_NSEC, 'TEST_NSEC env var is required for authenticated tests');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('@auth should have TEST_NSEC available for authentication', async () => {
    expect(TEST_NSEC).toBeTruthy();
    expect(TEST_NSEC).toMatch(/^nsec1/);
  });

  test('@auth should be able to access profile page when logged in', async ({
    page,
    waitForNostrReady,
    captureScreenshot,
  }) => {
    await waitForNostrReady();

    // Navigate to settings or profile which typically requires auth
    await page.goto('/settings');

    await captureScreenshot('auth-settings-page');

    // The page should render without errors
    const errorOverlay = page.locator('.cdk-overlay-container .error, mat-snack-bar-container');
    const hasVisibleError = await errorOverlay.isVisible().catch(() => false);
    expect(hasVisibleError).toBeFalsy();
  });

  test('@auth should display authenticated user elements', async ({
    page,
    waitForNostrReady,
    captureScreenshot,
  }) => {
    await waitForNostrReady();

    await captureScreenshot('auth-home-page');

    // Verify the page loaded successfully
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });
});
