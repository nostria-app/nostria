/**
 * Component Gallery Visual Regression Tests @visual
 *
 * Navigates to pages that showcase key UI components (buttons, cards,
 * dialogs, forms) and captures component-level screenshots for
 * regression detection.
 *
 * Components are captured by locating their Angular Material selectors
 * or app-specific CSS classes on real pages.
 */
import { test, expect } from '../../fixtures';
import { TestAuthHelper } from '../../helpers/auth';

const THEME_KEY = 'nostria-theme';

/**
 * Wait for the app to render and stabilize.
 */
async function waitForStableRender(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const appRoot = document.querySelector('app-root');
    if (!appRoot) return false;
    const mainContent = document.querySelector('mat-sidenav-content, .main-content, main');
    return !!mainContent;
  }, { timeout: 30_000 });

  await page.waitForTimeout(1000);

  await page.waitForLoadState('networkidle').catch(() => {
    // networkidle may not always fire
  });
}

test.describe('Component Gallery @visual', () => {
  test.describe('Sidebar / Navigation components', () => {
    test('should capture sidenav component', async ({ page, saveConsoleLogs }) => {
      await page.goto('/');
      await waitForStableRender(page);

      const sidenav = page.locator('mat-sidenav').first();
      if (await sidenav.isVisible()) {
        await expect(sidenav).toHaveScreenshot('component-sidenav.png');
      }

      await saveConsoleLogs('visual-component-sidenav');
    });

    test('should capture toolbar / app header', async ({ page, saveConsoleLogs }) => {
      await page.goto('/');
      await waitForStableRender(page);

      // Capture the toolbar area
      const toolbar = page.locator('mat-toolbar, .mat-toolbar, header').first();
      if (await toolbar.isVisible()) {
        await expect(toolbar).toHaveScreenshot('component-toolbar.png');
      }

      await saveConsoleLogs('visual-component-toolbar');
    });
  });

  test.describe('Card components', () => {
    test('should capture cards on discover page', async ({ page, saveConsoleLogs }) => {
      await page.goto('/discover');
      await waitForStableRender(page);

      // Capture first visible mat-card
      const card = page.locator('mat-card').first();
      if (await card.isVisible()) {
        await expect(card).toHaveScreenshot('component-card-discover.png', {
          mask: [
            page.locator('time, .timestamp, .relative-time'),
            page.locator('img[src*="nostr"], img[src*="avatar"], .avatar img'),
          ],
        });
      }

      await saveConsoleLogs('visual-component-card-discover');
    });

    test('should capture cards on articles page', async ({ page, saveConsoleLogs }) => {
      await page.goto('/articles');
      await waitForStableRender(page);

      const card = page.locator('mat-card').first();
      if (await card.isVisible()) {
        await expect(card).toHaveScreenshot('component-card-article.png', {
          mask: [
            page.locator('time, .timestamp, .relative-time'),
            page.locator('img[src*="nostr"], img[src*="avatar"], .avatar img'),
          ],
        });
      }

      await saveConsoleLogs('visual-component-card-article');
    });
  });

  test.describe('Form components', () => {
    test('should capture search input form', async ({ page, saveConsoleLogs }) => {
      await page.goto('/search');
      await waitForStableRender(page);

      // Capture search form area
      const searchInput = page.locator('mat-form-field, input[type="search"], .search-input, input[placeholder*="earch"]').first();
      if (await searchInput.isVisible()) {
        await expect(searchInput).toHaveScreenshot('component-search-input.png');
      }

      await saveConsoleLogs('visual-component-search-input');
    });
  });

  test.describe('Button components', () => {
    test('should capture button styles on home page', async ({ page, saveConsoleLogs }) => {
      await page.goto('/');
      await waitForStableRender(page);

      // Capture icon buttons in the sidenav (theme toggle, etc.)
      const iconButtons = page.locator('mat-sidenav button[mat-icon-button], mat-sidenav button.mat-mdc-icon-button');
      const count = await iconButtons.count();

      if (count > 0) {
        // Capture the first icon button as a component reference
        await expect(iconButtons.first()).toHaveScreenshot('component-icon-button.png');
      }

      await saveConsoleLogs('visual-component-buttons');
    });
  });

  test.describe('Dialog components', () => {
    test('should capture login dialog', async ({ page, saveConsoleLogs }) => {
      await page.goto('/');
      await waitForStableRender(page);

      // Look for avatar/login button in sidenav to trigger login dialog
      const loginTrigger = page.locator('.sidenav-avatar-button, button:has-text("Log in"), button:has-text("Sign in")').first();

      if (await loginTrigger.isVisible()) {
        await loginTrigger.click();
        await page.waitForTimeout(500);

        // Wait for dialog to appear
        const dialog = page.locator('.unified-login-dialog, .login-dialog, mat-dialog-container, .cdk-overlay-pane').first();
        if (await dialog.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(dialog).toHaveScreenshot('component-login-dialog.png');

          // Close dialog by pressing Escape
          await page.keyboard.press('Escape');
        }
      }

      await saveConsoleLogs('visual-component-login-dialog');
    });
  });

  test.describe('Dark mode component variants', () => {
    test('should capture sidenav in dark mode', async ({ page, saveConsoleLogs }) => {
      await page.addInitScript(({ key, value }: { key: string; value: string }) => {
        localStorage.setItem(key, value);
      }, { key: THEME_KEY, value: 'dark' });

      await page.goto('/');
      await waitForStableRender(page);

      const sidenav = page.locator('mat-sidenav').first();
      if (await sidenav.isVisible()) {
        await expect(sidenav).toHaveScreenshot('component-sidenav-dark.png');
      }

      await saveConsoleLogs('visual-component-sidenav-dark');
    });

    test('should capture cards in dark mode', async ({ page, saveConsoleLogs }) => {
      await page.addInitScript(({ key, value }: { key: string; value: string }) => {
        localStorage.setItem(key, value);
      }, { key: THEME_KEY, value: 'dark' });

      await page.goto('/discover');
      await waitForStableRender(page);

      const card = page.locator('mat-card').first();
      if (await card.isVisible()) {
        await expect(card).toHaveScreenshot('component-card-discover-dark.png', {
          mask: [
            page.locator('time, .timestamp, .relative-time'),
            page.locator('img[src*="nostr"], img[src*="avatar"], .avatar img'),
          ],
        });
      }

      await saveConsoleLogs('visual-component-card-dark');
    });
  });

  test.describe('Authenticated component variants', () => {
    test('should capture authenticated sidenav with profile', async ({ authenticatedPage, saveConsoleLogs }) => {
      await authenticatedPage.goto('/');
      await waitForStableRender(authenticatedPage);

      const sidenav = authenticatedPage.locator('mat-sidenav').first();
      if (await sidenav.isVisible()) {
        await expect(sidenav).toHaveScreenshot('component-sidenav-authenticated.png', {
          mask: [
            // Mask profile images and names that vary per test account
            authenticatedPage.locator('.sidenav-avatar-button img, .avatar img'),
            authenticatedPage.locator('.display-name, .profile-name'),
          ],
        });
      }

      await saveConsoleLogs('visual-component-sidenav-auth');
    });

    test('should capture notifications page layout', async ({ authenticatedPage, saveConsoleLogs }) => {
      await authenticatedPage.goto('/notifications');
      await waitForStableRender(authenticatedPage);

      // Capture the notifications page container
      const notifPage = authenticatedPage.locator('.notifications-page, app-notifications, mat-sidenav-content').first();
      if (await notifPage.isVisible()) {
        await expect(notifPage).toHaveScreenshot('component-notifications-page.png', {
          mask: [
            authenticatedPage.locator('time, .timestamp, .relative-time'),
            authenticatedPage.locator('img[src*="nostr"], img[src*="avatar"], .avatar img'),
            authenticatedPage.locator('.display-name, .profile-name'),
          ],
        });
      }

      await saveConsoleLogs('visual-component-notifications');
    });

    test('should capture relay management page', async ({ authenticatedPage, saveConsoleLogs }) => {
      await authenticatedPage.goto('/relays');
      await waitForStableRender(authenticatedPage);

      // Capture relay management content
      const content = authenticatedPage.locator('mat-sidenav-content').first();
      if (await content.isVisible()) {
        await expect(content).toHaveScreenshot('component-relay-management.png', {
          mask: [
            authenticatedPage.locator('time, .timestamp, .relative-time'),
          ],
        });
      }

      await saveConsoleLogs('visual-component-relays');
    });
  });
});
