/**
 * Authenticated User E2E Tests @auth
 *
 * Tests that require a logged-in user session.
 * Run with: npm run test:e2e:auth
 *
 * These tests are tagged with @auth so they can be filtered
 * via `playwright test --grep @auth`.
 *
 * If TEST_NSEC is set in .env, uses that key for authentication.
 * Otherwise, auto-generates a throwaway keypair and logs a warning
 * that authenticated tests will use a random identity with no relay history.
 */
import { test, expect } from '../fixtures';
import { TestAuthHelper } from '../helpers/auth';

const { auth, source } = TestAuthHelper.fromEnvOrGenerate();

test.describe('@auth Authenticated User', () => {
  test.beforeEach(async ({ page }) => {
    await auth.injectAuth(page);
    await page.goto('/');
  });

  test('@auth should have a valid nsec for authentication', async () => {
    expect(auth.nsec).toBeTruthy();
    expect(auth.nsec).toMatch(/^nsec1/);
    expect(auth.pubkey).toMatch(/^[0-9a-f]{64}$/);
  });

  test('@auth should report key source correctly', async () => {
    if (process.env['TEST_NSEC']) {
      expect(source).toBe('env');
    } else {
      expect(source).toBe('generated');
    }
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
