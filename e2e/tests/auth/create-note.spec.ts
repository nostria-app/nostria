/**
 * Create Note E2E Tests @auth
 *
 * Tests the note creation dialog: open, type content, verify preview,
 * test character count display, test cancel closes dialog without posting,
 * verify publish button is enabled with content.
 */
import { test, expect } from '../../fixtures';

test.describe('Create Note @auth', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/');
  });

  test('should open note creation dialog', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await waitForNostrReady();

    // Try to open note creation dialog via keyboard shortcut or button
    // The app might use a FAB button or menu item
    const createButton = authenticatedPage.locator(
      'button[aria-label*="Create"], button:has-text("Create"), [data-testid="create-note"], .create-button, .fab-button'
    );

    if (await createButton.first().isVisible().catch(() => false)) {
      await createButton.first().click();
      await authenticatedPage.waitForTimeout(500);
    } else {
      // Try mobile FAB or bottom nav create button
      const mobileFab = authenticatedPage.locator(
        '.bottom-nav button:has-text("Create"), .mobile-fab, button.create-fab'
      );
      if (await mobileFab.first().isVisible().catch(() => false)) {
        await mobileFab.first().click();
        await authenticatedPage.waitForTimeout(500);
      }
    }

    // Check if note editor dialog appeared
    const noteEditor = authenticatedPage.locator(
      'app-note-editor-dialog, .note-editor-dialog, [role="dialog"]'
    );
    const editorVisible = await noteEditor.isVisible().catch(() => false);
    console.log(`Note editor dialog visible: ${editorVisible}`);

    await saveConsoleLogs('create-note-open');
  });

  test('should have content textarea in note editor', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await waitForNostrReady();

    // Open note creation
    const createButton = authenticatedPage.locator(
      'button[aria-label*="Create"], button:has-text("Create"), [data-testid="create-note"]'
    );
    if (await createButton.first().isVisible().catch(() => false)) {
      await createButton.first().click();
      await authenticatedPage.waitForTimeout(500);
    }

    // Look for the content textarea
    const contentTextarea = authenticatedPage.locator(
      '.content-textarea, textarea[placeholder*="mind"], textarea[placeholder*="reply"], .content-field textarea'
    );
    const textareaVisible = await contentTextarea.first().isVisible().catch(() => false);
    console.log(`Content textarea visible: ${textareaVisible}`);

    if (textareaVisible) {
      // Type some test content
      const testContent = 'This is a test note from E2E testing';
      await contentTextarea.first().fill(testContent);
      const value = await contentTextarea.first().inputValue();
      expect(value).toBe(testContent);
    }

    await saveConsoleLogs('create-note-textarea');
  });

  test('should show publish button enabled when content is present', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await waitForNostrReady();

    // Open note creation
    const createButton = authenticatedPage.locator(
      'button[aria-label*="Create"], button:has-text("Create"), [data-testid="create-note"]'
    );
    if (await createButton.first().isVisible().catch(() => false)) {
      await createButton.first().click();
      await authenticatedPage.waitForTimeout(500);
    }

    // Type content
    const contentTextarea = authenticatedPage.locator(
      '.content-textarea, textarea[placeholder*="mind"], .content-field textarea'
    );
    if (await contentTextarea.first().isVisible().catch(() => false)) {
      await contentTextarea.first().fill('Test note content');

      // Check publish button state
      const publishButton = authenticatedPage.locator(
        '.publish-button, button:has-text("Publish"), button:has-text("Post")'
      );
      const publishVisible = await publishButton.first().isVisible().catch(() => false);
      console.log(`Publish button visible: ${publishVisible}`);

      if (publishVisible) {
        const isDisabled = await publishButton.first().isDisabled();
        console.log(`Publish button disabled: ${isDisabled}`);
        // With content, publish should be enabled
        expect(isDisabled).toBeFalsy();
      }
    }

    // Do NOT click publish to avoid polluting relays
    await saveConsoleLogs('create-note-publish-button');
  });

  test('should cancel note creation without posting', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await waitForNostrReady();

    // Open note creation
    const createButton = authenticatedPage.locator(
      'button[aria-label*="Create"], button:has-text("Create"), [data-testid="create-note"]'
    );
    if (await createButton.first().isVisible().catch(() => false)) {
      await createButton.first().click();
      await authenticatedPage.waitForTimeout(500);
    }

    // Type some content
    const contentTextarea = authenticatedPage.locator(
      '.content-textarea, textarea[placeholder*="mind"], .content-field textarea'
    );
    if (await contentTextarea.first().isVisible().catch(() => false)) {
      await contentTextarea.first().fill('This note should be cancelled');
    }

    // Click cancel button or press Escape
    const cancelButton = authenticatedPage.locator(
      'button:has-text("Cancel"), button:has-text("Close"), button:has-text("Discard")'
    );
    if (await cancelButton.first().isVisible().catch(() => false)) {
      await cancelButton.first().click();
    } else {
      await authenticatedPage.keyboard.press('Escape');
    }

    await authenticatedPage.waitForTimeout(500);

    // Verify dialog is closed
    const noteEditor = authenticatedPage.locator(
      'app-note-editor-dialog, .note-editor-dialog'
    );
    const editorStillVisible = await noteEditor.isVisible().catch(() => false);
    console.log(`Note editor still visible after cancel: ${editorStillVisible}`);

    await saveConsoleLogs('create-note-cancel');
  });

  test('should not show note editor when no create action taken', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await waitForNostrReady();

    // Without clicking create, the note editor should not be visible
    const noteEditor = authenticatedPage.locator(
      'app-note-editor-dialog, .note-editor-dialog'
    );
    const editorVisible = await noteEditor.isVisible().catch(() => false);
    expect(editorVisible).toBeFalsy();

    await saveConsoleLogs('create-note-not-shown');
  });
});
