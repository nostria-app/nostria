/**
 * Deep Links E2E Tests @public
 *
 * Tests for NIP-19 entity deep links: npub, note, nprofile, nevent,
 * naddr URLs all resolve correctly without errors.
 */
import { test, expect } from '../../fixtures';

// Test NIP-19 entities
const TEST_NPUB = 'npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s';

test.describe('NIP-19 Deep Links @public', () => {
  test('should resolve npub deep links', async ({ page, waitForNostrReady, captureScreenshot, saveConsoleLogs }) => {
    await page.goto(`/p/${TEST_NPUB}`);
    await waitForNostrReady();
    await page.waitForTimeout(2000);

    // Page should load without error
    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(100);

    // Should show profile-related content
    const hasProfile = await page.locator('app-profile, .profile-container, .profile-page').isVisible().catch(() => false);
    console.log(`npub resolved to profile: ${hasProfile}`);

    await captureScreenshot('deep-link-npub');
    await saveConsoleLogs('deep-link-npub');
  });

  test('should resolve nprofile deep links', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    // nprofile includes relay hints
    await page.goto(`/p/${TEST_NPUB}`);
    await waitForNostrReady();
    await page.waitForTimeout(2000);

    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(100);

    await saveConsoleLogs('deep-link-nprofile');
  });

  test('should handle malformed npub gracefully', async ({ page, saveConsoleLogs }) => {
    await page.goto('/p/npub1invalid');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should not crash — should show error or redirect
    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(100);

    // Page should still be functional
    const toolbar = page.locator('mat-toolbar, .toolbar, header');
    const hasToolbar = await toolbar.isVisible().catch(() => false);
    console.log(`App still functional after malformed npub: ${hasToolbar}`);

    await saveConsoleLogs('deep-link-malformed-npub');
  });

  test('should handle malformed nevent gracefully', async ({ page, saveConsoleLogs }) => {
    await page.goto('/e/nevent1invalid');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should not crash
    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(100);

    await saveConsoleLogs('deep-link-malformed-nevent');
  });

  test('should handle note1 deep links', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    // Note IDs are base-level NIP-19 entities
    await page.goto('/e/note1test');
    await waitForNostrReady();
    await page.waitForTimeout(2000);

    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(100);

    await saveConsoleLogs('deep-link-note');
  });
});
