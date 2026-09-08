import { test, expect } from '../../fixtures';

test.describe('Note paste selection @auth', () => {
  test('replaces selected text and preserves the paste range during HTML processing', async ({
    authenticatedPage: page, waitForNostrReady: waitForAppReady, saveConsoleLogs,
  }) => {
    await page.routeWebSocket(/wss?:\/\//, socket => {
      socket.onMessage(message => {
        const frame = JSON.parse(message.toString());
        if (frame[0] === 'REQ') socket.send(JSON.stringify(['EOSE', frame[1]]));
      });
    });
    await page.goto('/');
    await waitForAppReady();
    await page.locator('button.command-palette-button').click();
    const palette = page.locator('.command-palette-container');
    await palette.locator('input').fill('Create Note');
    await palette.locator('mat-list-item').filter({ hasText: 'Create Note' }).click();

    const editor = page.locator('.note-editor-dialog .content-textarea:visible').first();
    await expect(editor).toBeVisible();

    for (const scenario of [
      { text: 'new', html: '', start: 7, end: 10, expected: 'Before new after' },
      { text: 'new', html: '', start: 10, end: 7, expected: 'Before new after' },
      { text: 'new', html: '<b>new</b>', start: 7, end: 10, expected: 'Before new after' },
      { text: 'new', html: '', start: 0, end: 16, expected: 'new' },
      { text: 'new', html: '', start: 7, end: 7, expected: 'Before newold after' },
    ]) {
      await editor.fill('Before old after');
      const prevented = await editor.evaluate((element, value) => {
        const node = element.firstChild!;
        window.getSelection()!.setBaseAndExtent(node, value.start, node, value.end);
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', value.text);
        if (value.html) clipboardData.setData('text/html', value.html);
        return !element.dispatchEvent(new ClipboardEvent('paste', {
          clipboardData, bubbles: true, cancelable: true,
        }));
      }, scenario);
      expect(prevented).toBe(true);
      await expect(editor).toHaveText(scenario.expected);
      await expect.poll(() => editor.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
      await expect.poll(() => editor.evaluate(() => window.getSelection()?.anchorOffset))
        .toBe(Math.min(scenario.start, scenario.end) + scenario.text.length);
    }

    // Hold image parsing open and move the live selection before the paste completes.
    let releaseImage!: () => void;
    const imageReady = new Promise<void>(resolve => { releaseImage = resolve; });
    await page.route('**/paste-selection-test.png', async route => {
      await imageReady;
      await route.fulfill({ status: 404, body: '' });
    });
    await editor.fill('Before old after');
    const imageRequest = page.waitForRequest('**/paste-selection-test.png');
    const prevented = await editor.evaluate(element => {
      const node = element.firstChild!;
      const selection = window.getSelection()!;
      selection.setBaseAndExtent(node, 7, node, 10);
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/html',
        `<b>new</b><img src="${location.origin}/paste-selection-test.png">`);
      const prevented = !element.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData, bubbles: true, cancelable: true,
      }));
      selection.collapse(node, 16);
      return prevented;
    });
    await imageRequest;
    releaseImage();
    expect(prevented).toBe(true);
    await expect(editor).toHaveText('Before new after');
    await saveConsoleLogs('note-paste-selection');
  });
});
