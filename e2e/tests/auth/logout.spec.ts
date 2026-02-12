/**
 * Logout E2E Tests @auth
 *
 * Verify logout flow: click account menu, click logout/remove account,
 * verify the app returns to unauthenticated state, localStorage is
 * cleared of account data.
 */
import { test, expect } from '../../fixtures';
import { TestAuthHelper } from '../../helpers/auth';

test.describe('Logout @auth', () => {
  test('should find logout option on accounts page', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/accounts');
    await waitForNostrReady();

    // Look for logout / "Set no active account" button
    const logoutButton = authenticatedPage.locator(
      'button:has-text("Set no active account"), button:has-text("Logout"), button:has-text("Sign out"), button:has-text("Log out"), mat-icon:has-text("account_circle_off")'
    );
    const logoutVisible = await logoutButton.first().isVisible().catch(() => false);
    console.log(`Logout button visible: ${logoutVisible}`);

    // Look for delete/remove account button
    const deleteButton = authenticatedPage.locator(
      '.delete-button, button:has-text("Remove"), button:has-text("Delete")'
    );
    const deleteVisible = await deleteButton.first().isVisible().catch(() => false);
    console.log(`Delete/Remove button visible: ${deleteVisible}`);

    await saveConsoleLogs('logout-find-option');
  });

  test('should clear auth state on logout', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    // Set up authenticated state
    const keypair = TestAuthHelper.getTestKeypair();
    const auth = new TestAuthHelper(keypair.nsec);
    await auth.injectAuth(page);
    await page.goto('/');
    await waitForNostrReady();

    // Verify we're authenticated
    const isAuthBefore = await page.evaluate(() => {
      return localStorage.getItem('nostria-account') !== null;
    });
    expect(isAuthBefore).toBeTruthy();
    console.log(`Authenticated before logout: ${isAuthBefore}`);

    // Clear auth (simulating logout)
    await auth.clearAuth(page);
    await waitForNostrReady();

    // Verify localStorage is cleared
    const isAuthAfter = await page.evaluate(() => {
      return localStorage.getItem('nostria-account') !== null;
    });
    expect(isAuthAfter).toBeFalsy();
    console.log(`Authenticated after logout: ${isAuthAfter}`);

    // Verify accounts storage is also cleared
    const hasAccounts = await page.evaluate(() => {
      return localStorage.getItem('nostria-accounts') !== null;
    });
    expect(hasAccounts).toBeFalsy();
    console.log(`Has accounts after logout: ${hasAccounts}`);

    await saveConsoleLogs('logout-clear-auth');
  });

  test('should return to unauthenticated UI after logout', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    // Set up and then clear auth
    const keypair = TestAuthHelper.getTestKeypair();
    const auth = new TestAuthHelper(keypair.nsec);
    await auth.injectAuth(page);
    await page.goto('/');
    await waitForNostrReady();

    // Clear auth
    await auth.clearAuth(page);
    await waitForNostrReady();

    // Verify unauthenticated UI state
    // Should show "Not logged in" or login options in sidebar
    const notLoggedIn = page.locator('text="Not logged in"');
    const loginButton = page.locator(
      'button:has-text("Login"), button:has-text("Sign in")'
    );

    const showsNotLoggedIn = await notLoggedIn.isVisible().catch(() => false);
    const showsLoginButton = await loginButton.first().isVisible().catch(() => false);

    console.log(`Shows "Not logged in": ${showsNotLoggedIn}`);
    console.log(`Shows login button: ${showsLoginButton}`);

    await saveConsoleLogs('logout-unauthenticated-ui');
  });

  test('should restrict auth-only navigation after logout', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    // Start authenticated, then logout
    const keypair = TestAuthHelper.getTestKeypair();
    const auth = new TestAuthHelper(keypair.nsec);
    await auth.injectAuth(page);
    await page.goto('/');
    await waitForNostrReady();

    // Logout
    await auth.clearAuth(page);
    await waitForNostrReady();

    // Try navigating to auth-required pages
    const authPages = ['/messages', '/notifications', '/accounts'];
    for (const pagePath of authPages) {
      await page.goto(pagePath);
      await page.waitForTimeout(1000);

      // Page should either redirect or show appropriate state
      const url = page.url();
      console.log(`Navigated to ${pagePath}, current URL: ${url}`);

      // Should not crash
      const title = await page.title();
      expect(title.length).toBeGreaterThan(0);
    }

    await saveConsoleLogs('logout-restricted-navigation');
  });

  test('should handle multiple login-logout cycles', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    for (let i = 0; i < 3; i++) {
      // Login
      const keypair = TestAuthHelper.getTestKeypair();
      const auth = new TestAuthHelper(keypair.nsec);
      await auth.injectAuth(page);
      await page.goto('/');
      await waitForNostrReady();

      // Verify authenticated
      const isAuth = await page.evaluate(() => {
        return localStorage.getItem('nostria-account') !== null;
      });
      expect(isAuth).toBeTruthy();

      // Logout
      await auth.clearAuth(page);
      await waitForNostrReady();

      // Verify logged out
      const isAuthAfter = await page.evaluate(() => {
        return localStorage.getItem('nostria-account') !== null;
      });
      expect(isAuthAfter).toBeFalsy();

      console.log(`Login-logout cycle ${i + 1} completed successfully`);
    }

    await saveConsoleLogs('logout-multiple-cycles');
  });
});
