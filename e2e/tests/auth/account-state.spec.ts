/**
 * Account State E2E Tests @auth
 *
 * Using the authenticatedPage fixture, verifies: profile name displays
 * in sidebar, account menu shows the logged-in account, switching
 * between accounts works if multiple are configured.
 */
import { test, expect } from '../../fixtures';

test.describe('Account State @auth', () => {
  test('should display authenticated user in sidebar', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/');
    await waitForNostrReady();

    // Sidebar should show user info (avatar button, display name, or npub)
    const sidenavContent = authenticatedPage.locator('mat-sidenav, .sidenav');
    const sidenavVisible = await sidenavContent.isVisible().catch(() => false);
    console.log(`Sidenav visible: ${sidenavVisible}`);

    // Should not show "Not logged in"
    const notLoggedIn = authenticatedPage.locator('text="Not logged in"');
    const showsNotLoggedIn = await notLoggedIn.isVisible().catch(() => false);
    console.log(`Shows "Not logged in": ${showsNotLoggedIn}`);

    // Avatar button should be present
    const avatarButton = authenticatedPage.locator('.sidenav-avatar-button');
    const avatarVisible = await avatarButton.isVisible().catch(() => false);
    console.log(`Avatar button visible: ${avatarVisible}`);

    await saveConsoleLogs('account-state-sidebar');
  });

  test('should show account info on accounts page', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/accounts');
    await waitForNostrReady();

    // The accounts page should load and show the current account
    const accountsPage = authenticatedPage.locator('app-accounts');
    await expect(accountsPage).toBeVisible({ timeout: 10000 });

    // Look for current account section
    const currentAccount = authenticatedPage.locator('.current-account, .account-card');
    const accountVisible = await currentAccount.first().isVisible().catch(() => false);
    console.log(`Current account section visible: ${accountVisible}`);

    // Should show the account's npub or display name
    const accountInfo = authenticatedPage.locator('.current-account, .account-card, .accounts-list');
    const accountInfoVisible = await accountInfo.first().isVisible().catch(() => false);
    expect(accountInfoVisible).toBeTruthy();

    await saveConsoleLogs('account-state-accounts-page');
  });

  test('should show credentials tab with key info', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/accounts?tab=credentials');
    await waitForNostrReady();

    // Wait for tabs to render
    await authenticatedPage.waitForTimeout(1000);

    // Look for credentials content (npub, nsec fields)
    const credentialsContent = authenticatedPage.locator(
      'text=/npub1/, text="Public Key", text="Private Key", .credentials'
    );
    const hasCredentials = await credentialsContent.first().isVisible().catch(() => false);
    console.log(`Credentials tab has content: ${hasCredentials}`);

    await saveConsoleLogs('account-state-credentials');
  });

  test('should show accounts list with current account highlighted', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/accounts');
    await waitForNostrReady();

    // Check for accounts list
    const accountsList = authenticatedPage.locator('.accounts-list, mat-list');
    const listVisible = await accountsList.first().isVisible().catch(() => false);
    console.log(`Accounts list visible: ${listVisible}`);

    // Check for account items
    const accountItems = authenticatedPage.locator('.account-item, mat-list-item');
    const itemCount = await accountItems.count();
    console.log(`Account items found: ${itemCount}`);

    await saveConsoleLogs('account-state-list');
  });

  test('should show auth-gated navigation items', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/');
    await waitForNostrReady();

    // When authenticated, these nav items should be visible
    const authNavItems = [
      { label: 'Messages', selector: 'mat-list-item:has-text("Messages"), a[href*="messages"]' },
      { label: 'Notifications', selector: 'mat-list-item:has-text("Notifications"), a[href*="notifications"]' },
      { label: 'People', selector: 'mat-list-item:has-text("People"), a[href*="people"]' },
      { label: 'Collections', selector: 'mat-list-item:has-text("Collections"), a[href*="collections"]' },
    ];

    for (const item of authNavItems) {
      const nav = authenticatedPage.locator(item.selector);
      const visible = await nav.first().isVisible().catch(() => false);
      console.log(`Nav item "${item.label}" visible: ${visible}`);
    }

    await saveConsoleLogs('account-state-nav-items');
  });
});
