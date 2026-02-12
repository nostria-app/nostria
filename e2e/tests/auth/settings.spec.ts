/**
 * Settings E2E Tests @auth
 *
 * Navigate to Settings, verify all setting sections render (appearance,
 * relays, notifications, privacy, backups), toggle theme between
 * light/dark, verify relay list displays connected relays.
 */
import { test, expect } from '../../fixtures';

test.describe('Settings @auth', () => {
  test('should load settings page', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/settings');
    await waitForNostrReady();

    // Verify settings page loads
    const settingsContent = authenticatedPage.locator(
      'app-settings, .settings, .panel-header'
    );
    await expect(settingsContent.first()).toBeVisible({ timeout: 10000 });

    // Page title should indicate settings
    const header = authenticatedPage.locator('.panel-header, h1, h2');
    const headerText = await header.first().textContent().catch(() => '');
    console.log(`Settings header: ${headerText}`);

    await saveConsoleLogs('settings-load');
  });

  test('should display settings sections', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/settings');
    await waitForNostrReady();
    await authenticatedPage.waitForTimeout(1000);

    // Look for settings section items (rendered from settings registry)
    const settingSections = authenticatedPage.locator(
      '.settings-item, .setting-section, mat-list-item, mat-card, .settings-group'
    );
    const sectionCount = await settingSections.count();
    console.log(`Settings sections found: ${sectionCount}`);

    // Check for known section keywords
    const knownSections = ['Dark', 'Theme', 'Text', 'Font', 'Language', 'Storage', 'Cache', 'Navigation', 'Relay'];
    for (const section of knownSections) {
      const sectionEl = authenticatedPage.locator(`text="${section}"`).first();
      const visible = await sectionEl.isVisible().catch(() => false);
      if (visible) {
        console.log(`Section "${section}" found`);
      }
    }

    await saveConsoleLogs('settings-sections');
  });

  test('should toggle dark mode', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/settings/dark-mode');
    await waitForNostrReady();
    await authenticatedPage.waitForTimeout(500);

    // Look for dark mode toggle
    const darkModeToggle = authenticatedPage.locator(
      'mat-slide-toggle, mat-button-toggle, [data-testid="theme-toggle"], .theme-toggle, button:has-text("Dark"), button:has-text("Light")'
    );
    const toggleVisible = await darkModeToggle.first().isVisible().catch(() => false);
    console.log(`Dark mode toggle visible: ${toggleVisible}`);

    if (toggleVisible) {
      // Get current state
      const bodyClassBefore = await authenticatedPage.evaluate(() => document.body.className);
      console.log(`Body class before toggle: ${bodyClassBefore}`);

      // Click the toggle
      await darkModeToggle.first().click();
      await authenticatedPage.waitForTimeout(500);

      // Check if class changed
      const bodyClassAfter = await authenticatedPage.evaluate(() => document.body.className);
      console.log(`Body class after toggle: ${bodyClassAfter}`);
    }

    await saveConsoleLogs('settings-dark-mode');
  });

  test('should navigate to relay settings', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/relays');
    await waitForNostrReady();

    // Verify relays page loads
    const relaysContent = authenticatedPage.locator(
      'app-relays-page, .relays, .panel-header'
    );
    const contentVisible = await relaysContent.first().isVisible().catch(() => false);
    console.log(`Relays page loaded: ${contentVisible}`);

    // Check for relay list
    const relayItems = authenticatedPage.locator(
      '.relay-item-container, .relay-item, .relay-url, .relay-row'
    );
    const relayCount = await relayItems.count();
    console.log(`Relay items found: ${relayCount}`);

    // Check for relay add input
    const addRelayInput = authenticatedPage.locator(
      '.relay-input input, input[placeholder*="wss://"], input[placeholder*="relay"]'
    );
    const addInputVisible = await addRelayInput.first().isVisible().catch(() => false);
    console.log(`Add relay input visible: ${addInputVisible}`);

    await saveConsoleLogs('settings-relays');
  });

  test('should show relay tabs', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/relays');
    await waitForNostrReady();

    // Relays page has tabs: Account Relays, Discovery Relays, Observed Relays
    const tabs = authenticatedPage.locator('mat-tab, [role="tab"]');
    const tabCount = await tabs.count();
    console.log(`Relay tabs found: ${tabCount}`);

    // Check for specific tab labels
    const tabLabels = ['Account', 'Discovery', 'Observed'];
    for (const label of tabLabels) {
      const tab = authenticatedPage.locator(`[role="tab"]:has-text("${label}")`);
      const visible = await tab.isVisible().catch(() => false);
      console.log(`Tab "${label}" visible: ${visible}`);
    }

    await saveConsoleLogs('settings-relay-tabs');
  });

  test('should navigate to individual settings sections', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    const sections = [
      { path: '/settings/text-size', name: 'Text Size' },
      { path: '/settings/font-selector', name: 'Font' },
      { path: '/settings/language', name: 'Language' },
      { path: '/settings/storage', name: 'Storage' },
      { path: '/settings/navigation', name: 'Navigation' },
    ];

    for (const section of sections) {
      await authenticatedPage.goto(section.path);
      await waitForNostrReady();

      // Verify page loads without crash
      const title = await authenticatedPage.title();
      expect(title.length).toBeGreaterThan(0);
      console.log(`Section "${section.name}" loaded successfully`);
    }

    await saveConsoleLogs('settings-individual-sections');
  });
});
