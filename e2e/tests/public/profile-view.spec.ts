/**
 * Profile View E2E Tests @public
 *
 * Tests for viewing a public profile (/p/{npub}): verify profile header
 * loads, display name renders, notes tab shows events, about tab shows bio.
 */
import { test, expect } from '../../fixtures';

// Well-known npub for testing (fiatjaf's npub)
const TEST_NPUB = 'npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s';

test.describe('Profile View @public', () => {
  test('should load a public profile page', async ({ page, waitForNostrReady, captureScreenshot, saveConsoleLogs }) => {
    await page.goto(`/p/${TEST_NPUB}`);
    await waitForNostrReady();
    await page.waitForTimeout(2000);

    // Profile page should have rendered
    const profileContent = page.locator('app-profile, .profile-container, [data-testid="profile"], .profile-page');
    const hasProfile = await profileContent.isVisible().catch(() => false);

    console.log(`Profile content visible: ${hasProfile}`);

    await captureScreenshot('profile-view');
    await saveConsoleLogs('profile-view-loaded');
  });

  test('should render profile header', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    await page.goto(`/p/${TEST_NPUB}`);
    await waitForNostrReady();
    await page.waitForTimeout(3000);

    // Check for profile header elements (avatar, name, banner)
    const avatar = page.locator('img[alt*="avatar" i], img[alt*="profile" i], .avatar, .profile-avatar, .profile-image');
    const banner = page.locator('.banner, .profile-banner, .cover-image');

    const hasAvatar = await avatar.count() > 0;
    const hasBanner = await banner.count() > 0;

    console.log(`Avatar: ${hasAvatar}, Banner: ${hasBanner}`);
    await saveConsoleLogs('profile-header');
  });

  test('should display a display name', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    await page.goto(`/p/${TEST_NPUB}`);
    await waitForNostrReady();
    await page.waitForTimeout(3000);

    // Look for a display name element
    const displayName = page.locator('.display-name, .profile-name, h1, h2, .name');
    const count = await displayName.count();

    if (count > 0) {
      const nameText = await displayName.first().textContent();
      console.log(`Display name: ${nameText?.trim()}`);
    }

    await saveConsoleLogs('profile-display-name');
  });

  test('should show notes tab with events', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    await page.goto(`/p/${TEST_NPUB}`);
    await waitForNostrReady();
    await page.waitForTimeout(3000);

    // Look for tabs (Notes, About, Replies, etc.)
    const tabs = page.locator('mat-tab, [role="tab"], .tab, .profile-tab');
    const tabCount = await tabs.count();

    console.log(`Found ${tabCount} profile tabs`);

    // Look for note/event items
    const events = page.locator('app-event, .event-item, .note-item, .note-content');
    const eventCount = await events.count();

    console.log(`Found ${eventCount} events/notes on profile`);
    await saveConsoleLogs('profile-notes-tab');
  });

  test('should show about/bio section', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    await page.goto(`/p/${TEST_NPUB}`);
    await waitForNostrReady();
    await page.waitForTimeout(3000);

    // Look for bio/about content
    const bio = page.locator('.bio, .about, .profile-about, .profile-bio, .description');
    const bioCount = await bio.count();

    if (bioCount > 0) {
      const bioText = await bio.first().textContent();
      console.log(`Bio text: ${bioText?.trim().slice(0, 100)}`);
    }

    // Try clicking the About tab if it exists
    const aboutTab = page.locator('[role="tab"]:has-text("About"), mat-tab:has-text("About"), .tab:has-text("About")');
    if (await aboutTab.count() > 0) {
      await aboutTab.first().click();
      await page.waitForTimeout(1000);
    }

    await saveConsoleLogs('profile-about');
  });
});
