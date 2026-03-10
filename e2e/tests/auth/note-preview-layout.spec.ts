/**
 * Note preview layout regression test @auth @smoke
 *
 * Verifies long content in Create Note preview does not hide controls,
 * and preview can always be toggled off.
 */
import { test, expect } from '../../fixtures';

test.describe('Note Preview Layout @auth @smoke', () => {
  test('should keep controls visible in preview mode for long content', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs, captureScreenshot }) => {
    await authenticatedPage.setViewportSize({ width: 896, height: 768 });
    await authenticatedPage.goto('/');
    await waitForNostrReady();

    const createButton = authenticatedPage.locator(
      'button[aria-label*="Create" i]:visible, button:has-text("Create"):visible, [data-testid="create-note"]:visible, .create-button:visible, .fab-button:visible, button:has-text("Post"):visible'
    );

    await expect(createButton.first()).toBeVisible({ timeout: 15000 });
    await createButton.first().click();

    const noteMenuOption = authenticatedPage.locator('.create-menu-container .menu-item:has-text("Note")').first();
    await expect(noteMenuOption).toBeVisible({ timeout: 10000 });
    await noteMenuOption.click();

    const editor = authenticatedPage.locator('.dialog-container.note-editor-dialog-panel .note-editor-dialog').first();
    await expect(editor).toBeVisible({ timeout: 15000 });

    const textarea = editor.locator('.content-textarea').first();
    await expect(textarea).toBeVisible({ timeout: 15000 });

    // Build intentionally long content to stress preview layout.
    const longLines = Array.from({ length: 180 }, (_, i) => `Line ${i + 1} preview overflow check`).join('\n');
    await textarea.fill(`#TEST\n${longLines}`);

    const previewToggle = authenticatedPage.locator('button[mat-icon-button]:has(mat-icon:text("visibility")), button[mat-icon-button]:has(mat-icon:text("visibility_off"))').first();
    await expect(previewToggle).toBeVisible({ timeout: 10000 });
    await previewToggle.click();

    const previewSection = editor.locator('.preview-section').first();
    await expect(previewSection).toBeVisible({ timeout: 10000 });

    const previewExitButton = editor.locator('.preview-exit-button').first();
    await expect(previewExitButton).toBeVisible({ timeout: 10000 });

    // Footer should still be reachable/visible in preview mode.
    const actionContainer = authenticatedPage.locator('[dialog-actions].action-container').first();
    await expect(actionContainer).toBeVisible({ timeout: 10000 });

    const publishButton = actionContainer.locator('.publish-button').first();
    await expect(publishButton).toBeVisible({ timeout: 10000 });

    await captureScreenshot('note-preview-layout-preview-on');

    await previewExitButton.click();
    await expect(previewSection).toBeHidden({ timeout: 10000 });

    await captureScreenshot('note-preview-layout-preview-off');
    await saveConsoleLogs('note-preview-layout-regression');
  });
});
