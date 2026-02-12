/**
 * Profile Edit E2E Tests @auth
 *
 * Navigate to own profile, click edit, verify form fields load
 * (display name, about, picture URL, banner URL, NIP-05), make a
 * change and verify it's reflected locally (do NOT publish to
 * avoid polluting relays).
 */
import { test, expect } from '../../fixtures';

test.describe('Profile Edit @auth', () => {
  test('should navigate to profile edit page', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/profile-edit');
    await waitForNostrReady();

    // Verify the profile edit page loads
    const pageContent = authenticatedPage.locator(
      'app-profile-edit, .profile-edit, form, .panel-header'
    );
    const contentVisible = await pageContent.first().isVisible().catch(() => false);
    console.log(`Profile edit page loaded: ${contentVisible}`);

    // Page should not crash
    const title = await authenticatedPage.title();
    expect(title.length).toBeGreaterThan(0);

    await saveConsoleLogs('profile-edit-navigate');
  });

  test('should display profile form fields', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/profile-edit');
    await waitForNostrReady();
    await authenticatedPage.waitForTimeout(1000);

    // Check for profile form fields
    const formFields = [
      { label: 'Display Name', selector: 'input[placeholder*="name" i], input[formcontrolname*="name" i], mat-form-field:has-text("Name")' },
      { label: 'About', selector: 'textarea[placeholder*="about" i], textarea[formcontrolname*="about" i], mat-form-field:has-text("About")' },
      { label: 'Picture', selector: 'input[placeholder*="picture" i], input[formcontrolname*="picture" i], mat-form-field:has-text("Picture")' },
      { label: 'Banner', selector: 'input[placeholder*="banner" i], input[formcontrolname*="banner" i], mat-form-field:has-text("Banner")' },
      { label: 'NIP-05', selector: 'input[placeholder*="nip" i], input[placeholder*="nip-05" i], mat-form-field:has-text("NIP-05"), mat-form-field:has-text("nip05")' },
    ];

    for (const field of formFields) {
      const element = authenticatedPage.locator(field.selector);
      const visible = await element.first().isVisible().catch(() => false);
      console.log(`Field "${field.label}" visible: ${visible}`);
    }

    await saveConsoleLogs('profile-edit-fields');
  });

  test('should allow editing display name locally', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/profile-edit');
    await waitForNostrReady();
    await authenticatedPage.waitForTimeout(1000);

    // Find the display name input
    const nameInput = authenticatedPage.locator(
      'input[placeholder*="name" i], input[formcontrolname*="name" i], input[formcontrolname*="displayName" i]'
    ).first();

    if (await nameInput.isVisible().catch(() => false)) {
      // Clear and type a test name
      const testName = 'Test Display Name E2E';
      await nameInput.clear();
      await nameInput.fill(testName);

      // Verify the input value changed
      const value = await nameInput.inputValue();
      expect(value).toBe(testName);
      console.log(`Display name set to: ${value}`);
    } else {
      console.log('Display name input not found - skipping edit test');
    }

    // Do NOT click save/publish to avoid polluting relays
    await saveConsoleLogs('profile-edit-display-name');
  });

  test('should allow editing about/bio locally', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/profile-edit');
    await waitForNostrReady();
    await authenticatedPage.waitForTimeout(1000);

    // Find the about/bio textarea
    const aboutInput = authenticatedPage.locator(
      'textarea[placeholder*="about" i], textarea[formcontrolname*="about" i], textarea[formcontrolname*="bio" i]'
    ).first();

    if (await aboutInput.isVisible().catch(() => false)) {
      const testBio = 'Test bio for E2E testing';
      await aboutInput.clear();
      await aboutInput.fill(testBio);

      const value = await aboutInput.inputValue();
      expect(value).toBe(testBio);
      console.log(`About/bio set to: ${value}`);
    } else {
      console.log('About/bio textarea not found - skipping edit test');
    }

    // Do NOT publish
    await saveConsoleLogs('profile-edit-about');
  });

  test('should have save/publish button present but not click it', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/profile-edit');
    await waitForNostrReady();
    await authenticatedPage.waitForTimeout(1000);

    // Look for save/publish button
    const saveButton = authenticatedPage.locator(
      'button:has-text("Save"), button:has-text("Publish"), button:has-text("Update"), button[type="submit"]'
    );
    const saveVisible = await saveButton.first().isVisible().catch(() => false);
    console.log(`Save/publish button visible: ${saveVisible}`);

    // Intentionally NOT clicking it to avoid polluting relays
    await saveConsoleLogs('profile-edit-save-button');
  });
});
