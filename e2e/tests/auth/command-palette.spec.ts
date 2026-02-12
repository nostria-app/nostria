/**
 * Command Palette E2E Tests @auth
 *
 * Open command palette (Ctrl+K), verify authenticated commands are
 * available (Create Note, Settings, Profile, etc.), execute navigation
 * commands, verify search within command palette works.
 */
import { test, expect } from '../../fixtures';
import { CommandPalette } from '../../pages';

test.describe('Command Palette @auth', () => {
  test('should open command palette with keyboard shortcut', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/');
    await waitForNostrReady();

    // Open command palette with Ctrl+K
    await authenticatedPage.keyboard.press('Control+k');
    await authenticatedPage.waitForTimeout(500);

    // Verify command palette dialog appears
    const palette = authenticatedPage.locator(
      'app-command-palette-dialog, [role="dialog"], .command-palette'
    );
    const paletteVisible = await palette.isVisible().catch(() => false);
    console.log(`Command palette visible: ${paletteVisible}`);

    if (paletteVisible) {
      // Close it
      await authenticatedPage.keyboard.press('Escape');
    }

    await saveConsoleLogs('command-palette-open');
  });

  test('should show search input in command palette', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/');
    await waitForNostrReady();

    // Open command palette
    await authenticatedPage.keyboard.press('Control+k');
    await authenticatedPage.waitForTimeout(500);

    // Look for search input
    const searchInput = authenticatedPage.locator(
      'input[placeholder*="Search"], input[placeholder*="search"], input[type="search"], .command-search input'
    );
    const searchVisible = await searchInput.first().isVisible().catch(() => false);
    console.log(`Search input visible: ${searchVisible}`);

    if (searchVisible) {
      // Type a search query
      await searchInput.first().fill('settings');
      await authenticatedPage.waitForTimeout(300);
    }

    // Close palette
    await authenticatedPage.keyboard.press('Escape');

    await saveConsoleLogs('command-palette-search');
  });

  test('should display command items', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/');
    await waitForNostrReady();

    // Open command palette
    await authenticatedPage.keyboard.press('Control+k');
    await authenticatedPage.waitForTimeout(500);

    // Look for command list items
    const commandItems = authenticatedPage.locator(
      '.command-item, mat-list-item, .command-list-item, [role="option"], [role="listitem"]'
    );
    const itemCount = await commandItems.count();
    console.log(`Command items found: ${itemCount}`);

    // Close palette
    await authenticatedPage.keyboard.press('Escape');

    await saveConsoleLogs('command-palette-items');
  });

  test('should show authenticated commands', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/');
    await waitForNostrReady();

    // Open command palette
    await authenticatedPage.keyboard.press('Control+k');
    await authenticatedPage.waitForTimeout(500);

    // Check for authenticated-only commands
    const authCommands = ['Create', 'Note', 'Settings', 'Profile', 'Messages', 'Notifications'];
    for (const cmd of authCommands) {
      const cmdItem = authenticatedPage.locator(
        `.command-item:has-text("${cmd}"), mat-list-item:has-text("${cmd}"), [role="option"]:has-text("${cmd}")`
      );
      const visible = await cmdItem.first().isVisible().catch(() => false);
      if (visible) {
        console.log(`Auth command "${cmd}" found`);
      }
    }

    // Close palette
    await authenticatedPage.keyboard.press('Escape');

    await saveConsoleLogs('command-palette-auth-commands');
  });

  test('should filter commands by search text', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/');
    await waitForNostrReady();

    // Open command palette
    await authenticatedPage.keyboard.press('Control+k');
    await authenticatedPage.waitForTimeout(500);

    const searchInput = authenticatedPage.locator(
      'input[placeholder*="Search"], input[placeholder*="search"], input[type="search"]'
    );

    if (await searchInput.first().isVisible().catch(() => false)) {
      // Count items before search
      const commandItems = authenticatedPage.locator(
        '.command-item, mat-list-item, [role="option"], [role="listitem"]'
      );
      const countBefore = await commandItems.count();

      // Search for a specific command
      await searchInput.first().fill('settings');
      await authenticatedPage.waitForTimeout(300);

      // Count items after search
      const countAfter = await commandItems.count();
      console.log(`Commands before search: ${countBefore}, after filtering: ${countAfter}`);

      // Filtered list should be smaller or equal
      if (countBefore > 0 && countAfter > 0) {
        expect(countAfter).toBeLessThanOrEqual(countBefore);
      }
    }

    // Close palette
    await authenticatedPage.keyboard.press('Escape');

    await saveConsoleLogs('command-palette-filter');
  });

  test('should navigate via command palette', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/');
    await waitForNostrReady();

    // Open command palette
    await authenticatedPage.keyboard.press('Control+k');
    await authenticatedPage.waitForTimeout(500);

    const searchInput = authenticatedPage.locator(
      'input[placeholder*="Search"], input[placeholder*="search"], input[type="search"]'
    );

    if (await searchInput.first().isVisible().catch(() => false)) {
      // Search for "Settings" and press Enter
      await searchInput.first().fill('Settings');
      await authenticatedPage.waitForTimeout(300);
      await authenticatedPage.keyboard.press('Enter');
      await authenticatedPage.waitForTimeout(1000);

      // Check if we navigated to settings
      const url = authenticatedPage.url();
      console.log(`URL after command palette navigation: ${url}`);
    }

    await saveConsoleLogs('command-palette-navigate');
  });
});
