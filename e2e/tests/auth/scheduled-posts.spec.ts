import { finalizeEvent, nip19, verifyEvent, type Event } from 'nostr-tools';
import { test, expect } from '../../fixtures';
import { TestAuthHelper } from '../../helpers/auth';

test.describe('Scheduled posts @auth @smoke', () => {
  test.afterEach(async ({ saveConsoleLogs }) => { await saveConsoleLogs('scheduled-posts'); });
  test('signs locally, persists, cancels, and delivers overdue posts on restart', async ({
    authenticatedPage: page, waitForNostrReady: waitForAppReady,
  }) => {
    const published: Event[] = [];
    const { auth } = TestAuthHelper.fromEnvOrGenerate();
    await auth.injectAuth(page);
    await page.addInitScript(() => {
      const settings = JSON.parse(localStorage.getItem('nostria-settings') ?? '{}');
      localStorage.setItem('nostria-settings', JSON.stringify({
        ...settings, noteEditorNewExperience: false,
      }));
    });
    const decoded = nip19.decode(auth.nsec);
    if (decoded.type !== 'nsec') throw new Error('Invalid test key');
    const relayList = finalizeEvent({ kind: 10002, content: '',
      created_at: Math.floor(Date.now() / 1000), tags: [['r', 'wss://relay.test']] }, decoded.data);
    await page.routeWebSocket(/wss?:\/\//, socket => {
      socket.onMessage(message => {
        const frame = JSON.parse(message.toString());
        if (frame[0] === 'REQ') {
          if (frame.slice(2).some((filter: { kinds?: number[]; authors?: string[] }) =>
            filter.kinds?.includes(10002) && filter.authors?.includes(auth.pubkey))) {
            socket.send(JSON.stringify(['EVENT', frame[1], relayList]));
          }
          socket.send(JSON.stringify(['EOSE', frame[1]]));
        }
        if (frame[0] === 'EVENT') {
          published.push(frame[1]);
          socket.send(JSON.stringify(['OK', frame[1].id, true, '']));
        }
      });
    });
    await page.goto('/');
    await waitForAppReady();
    await page.locator('button.command-palette-button').click();
    const palette = page.locator('.command-palette-container');
    await palette.locator('input').fill('Create Note');
    await palette.locator('mat-list-item').filter({ hasText: 'Create Note' }).click();
    const editor = page.locator('app-note-editor-dialog');
    await expect(editor).toBeVisible();
    await expect(editor.locator('textarea.content-textarea')).toHaveCount(0);
    await expect(editor.getByRole('textbox', { name: 'Note content' }))
      .toHaveAttribute('contenteditable', 'plaintext-only');
    await expect(editor.locator('.schedule-options')).toHaveCount(0);
    const content = 'Device-local scheduled post regression\nSecond line';
    await editor.locator('.content-textarea').fill('Device-local scheduled post regression');
    await editor.locator('.content-textarea').press('End');
    await editor.locator('.content-textarea').press('Enter');
    await page.keyboard.insertText('Second line');
    const scheduleButton = editor.getByRole('button', { name: 'Schedule post', exact: true });
    await expect(scheduleButton).toHaveAttribute('aria-pressed', 'false');
    await expect(editor.locator('.schedule-button + button mat-icon')).toHaveText('settings');
    await scheduleButton.click();
    await expect(scheduleButton).toHaveAttribute('aria-pressed', 'true');
    const dateInput = editor.getByRole('textbox', { name: 'Date', exact: true });
    const timeInput = editor.getByRole('combobox', { name: 'Time', exact: true });
    const initialDate = await dateInput.inputValue();
    const initialTime = await timeInput.inputValue();
    const initialAge = await page.evaluate(({ date, time }) =>
      Date.now() - new Date(`${date} ${time}`).getTime(), { date: initialDate, time: initialTime });
    expect(initialAge).toBeGreaterThanOrEqual(0);
    expect(initialAge).toBeLessThan(60_000);
    await expect.poll(async () => {
      const input = await editor.locator('.content-textarea').boundingBox();
      const panel = await editor.locator('.schedule-options').boundingBox();
      return !!input && !!panel && panel.y >= input.y + input.height;
    }).toBe(true);
    await scheduleButton.click();
    await expect(editor.locator('.schedule-options')).toHaveCount(0);
    await editor.locator('.schedule-button + button').click();
    await expect(editor.getByText('New Editor Experience', { exact: true })).toHaveCount(0);
    await editor.locator('.close-advanced-options').click();
    await expect(editor.locator('.content-textarea')).toHaveText(content);
    await scheduleButton.click();
    await expect(dateInput).toHaveValue(initialDate);
    await expect(timeInput).toHaveValue(initialTime);
    const date = new Date(Date.now() + 86_400_000);
    date.setHours(23, 45, 0, 0);
    await timeInput.fill('11:45 PM');
    await timeInput.press('Tab');
    await dateInput.fill(date.toLocaleDateString('en-US'));
    await dateInput.press('Tab');
    await expect(timeInput).toHaveValue('11:45 PM');
    await editor.locator('.schedule-options mat-datepicker-toggle button').click();
    await expect(page.locator('mat-calendar')).toBeVisible();
    await page.locator('mat-calendar .mat-calendar-body-active').click();
    await expect(page.locator('mat-calendar')).toBeHidden();
    await expect(timeInput).toHaveValue('11:45 PM');
    await editor.locator('.schedule-options mat-timepicker-toggle button').click();
    await expect(page.locator('.mat-timepicker-panel')).toBeVisible();
    await page.getByRole('option', { name: '11:45 PM', exact: true }).click();
    await expect(page.locator('.mat-timepicker-panel')).toBeHidden();
    await scheduleButton.click();
    await scheduleButton.click();
    await expect(dateInput).toHaveValue(date.toLocaleDateString('en-US'));
    await expect(timeInput).toHaveValue('11:45 PM');
    await editor.locator('.mobile-actions-trigger').click();
    await page.getByRole('menuitem', { name: 'Scheduled posts', exact: true }).click();
    const manager = editor.locator('app-scheduled-posts-panel');
    await expect(manager).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(editor.locator('.content-textarea')).toHaveCount(0);
    await expect(editor.getByRole('button', { name: 'Schedule', exact: true })).toHaveCount(0);
    await page.keyboard.press('Alt+Enter');
    await expect(manager).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(manager).toHaveCount(0);
    await expect(editor.locator('.content-textarea')).toHaveText(content);
    await expect(dateInput).toHaveValue(date.toLocaleDateString('en-US'));
    await expect(timeInput).toHaveValue('11:45 PM');
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.screenshot({ path: 'test-results/screenshots/scheduled-composer-light.png', animations: 'disabled' });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: 'test-results/screenshots/scheduled-composer-dark.png', animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(scheduleButton).toBeInViewport();
    await expect(editor.locator('.schedule-button + button')).toBeInViewport();
    await expect(editor.getByRole('button', { name: 'Schedule', exact: true })).toBeInViewport();
    await page.screenshot({ path: 'test-results/screenshots/scheduled-composer-mobile-dark.png', animations: 'disabled' });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.screenshot({ path: 'test-results/screenshots/scheduled-composer-mobile-light.png', animations: 'disabled' });
    await page.setViewportSize({ width: 1280, height: 720 });
    await editor.getByRole('button', { name: 'Schedule', exact: true }).click();
    await expect(editor).toBeHidden({ timeout: 20000 });

    const stored = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('nostria-scheduled-posts', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<{ events: Event[] }[]>((resolve, reject) => {
          const request = db.transaction('posts').objectStore('posts').getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } finally { db.close(); }
    });
    expect(stored).toHaveLength(1);
    const signed = stored[0].events[0];
    expect(signed.content).toBe(content);
    expect(signed.created_at).toBe(date.getTime() / 1000);
    expect(verifyEvent(signed)).toBe(true);
    expect(published.some(event => event.id === signed.id)).toBe(false);

    await page.reload();
    await waitForAppReady();
    await page.locator('button.command-palette-button').click();
    await palette.locator('input').fill('Scheduled posts');
    await palette.locator('mat-list-item').filter({ hasText: 'Scheduled posts' }).click();
    await expect(editor).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(manager.getByText(content, { exact: true })).toBeVisible();
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.screenshot({ path: 'test-results/screenshots/scheduled-manager-light.png', animations: 'disabled' });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: 'test-results/screenshots/scheduled-manager-dark.png', animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(editor.locator('.back-from-overlay')).toBeInViewport();
    await expect(manager.getByRole('button', { name: 'Cancel post', exact: true })).toBeInViewport();
    await page.screenshot({ path: 'test-results/screenshots/scheduled-manager-mobile-dark.png', animations: 'disabled' });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.screenshot({ path: 'test-results/screenshots/scheduled-manager-mobile-light.png', animations: 'disabled' });
    await editor.locator('.back-from-overlay').click();
    await expect(editor.locator('.content-textarea')).toBeVisible();
    await editor.locator('.mobile-actions-trigger').click();
    await page.getByRole('menuitem', { name: 'Scheduled posts', exact: true }).click();
    await expect(manager.getByText(content, { exact: true })).toBeVisible();
    await manager.getByRole('button', { name: 'Cancel post', exact: true }).click();
    await manager.getByRole('button', { name: 'Confirm cancellation' }).click();
    await expect(manager.getByText('No scheduled posts on this device.')).toBeVisible();
    expect(published.some(event => event.id === signed.id)).toBe(false);

    await page.setViewportSize({ width: 1280, height: 720 });

    // Restore the signed record to model an app closed before its scheduled delivery.
    await page.evaluate(async post => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('nostria-scheduled-posts', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const tx = db.transaction('posts', 'readwrite');
        tx.objectStore('posts').put(post);
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally { db.close(); }
    }, stored[0]);
    await page.clock.install({ time: date.getTime() + 60_000 });
    await page.reload();
    await waitForAppReady();
    await expect.poll(() => published.filter(event => event.id === signed.id).length).toBe(1);
    expect(published.find(event => event.id === signed.id)).toEqual(
      JSON.parse(JSON.stringify(signed)));
    await page.locator('button.command-palette-button').click();
    await palette.locator('input').fill('Scheduled posts');
    await palette.locator('mat-list-item').filter({ hasText: 'Scheduled posts' }).click();
    await expect(manager.getByText('No scheduled posts on this device.')).toBeVisible();
  });
});
