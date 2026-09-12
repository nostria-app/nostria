import { finalizeEvent, generateSecretKey, getPublicKey, matchFilter, type Filter, type NostrEvent } from 'nostr-tools';
import { createRumor, createSeal } from 'nostr-tools/nip59';
import { v2 } from 'nostr-tools/nip44';
import { hexToBytes } from '@noble/hashes/utils.js';
import { test as base, expect } from '../../fixtures';
import { TestAuthHelper } from '../../helpers/auth';

const test = base.extend<{ dmAccount: TestAuthHelper }>({
  dmAccount: async ({}, use) => {
    await use(new TestAuthHelper(TestAuthHelper.getTestKeypair().nsec));
  },
  authenticatedPage: async ({ page, dmAccount }, use) => {
    await dmAccount.injectAuth(page);
    await use(page);
  },
});

test.describe('Message history @auth @network', () => {
  test('loads across long gaps and preserves manual retry in light and dark themes', async ({
    authenticatedPage: page, dmAccount, waitForNostrReady: waitForAppReady, saveConsoleLogs,
  }) => {
    const senderKey = generateSecretKey();
    const sender = getPublicKey(senderKey);
    const now = Math.floor(Date.now() / 1000);
    const metadata = [
      { kind: 10002, tags: [['r', 'wss://dm.test']] },
      { kind: 10050, tags: [['relay', 'wss://dm.test']] },
      { kind: 3, tags: [['p', sender]] },
    ].map(event => finalizeEvent({ ...event, created_at: now, content: '' }, hexToBytes(dmAccount.privkey)));
    let messages: NostrEvent[] = [];
    let allowHistory = false;
    let historyRequests = 0;

    await page.routeWebSocket(/wss?:\/\//, socket => {
      socket.onMessage(data => {
        const frame = JSON.parse(data.toString());
        if (frame[0] === 'EVENT') {
          socket.send(JSON.stringify(['OK', frame[1].id, true, '']));
          return;
        }
        if (frame[0] !== 'REQ') return;
        const filters = frame.slice(2) as Filter[];
        const inbox = filters.find(filter => filter.kinds?.includes(1059) && filter['#p']?.length);
        if (inbox && messages.length === 0) {
          const recipient = inbox['#p']![0];
          messages = Array.from({ length: 125 }, (_, index) => {
            const timestamp = now - (index < 25 ? index * 60 : index * 86400);
            const rumor = createRumor({ kind: 14, created_at: timestamp,
              tags: [['p', recipient]], content: `History fixture ${index}` }, senderKey);
            const seal = createSeal(rumor, senderKey, recipient);
            const wrapperKey = generateSecretKey();
            return finalizeEvent({ kind: 1059, created_at: timestamp - 1000,
              tags: [['p', recipient]],
              content: v2.encrypt(JSON.stringify(seal), v2.utils.getConversationKey(wrapperKey, recipient)),
            }, wrapperKey);
          });
        }
        const history = inbox?.until !== undefined;
        if (history) historyRequests++;
        const candidates = [...metadata, ...(history ? (allowHistory ? messages : []) : messages.slice(0, 25))];
        const sent = new Set<string>();
        for (const filter of filters) {
          for (const event of candidates.filter(event => matchFilter(filter, event)).slice(0, filter.limit)) {
            if (sent.has(event.id)) continue;
            sent.add(event.id);
            socket.send(JSON.stringify(['EVENT', frame[1], event]));
          }
        }
        socket.send(JSON.stringify(['EOSE', frame[1]]));
      });
    });

    await page.goto('/messages');
    await waitForAppReady();
    await page.locator(`[data-chat-id="${sender}-nip44"]`).click();
    const thread = page.locator('.message-list');
    await expect(thread.getByText('History fixture 0', { exact: true })).toBeVisible();
    const loadMore = thread.getByRole('button', { name: 'Load older messages', exact: true });

    // Expand cached history, then simulate an unavailable history query.
    for (let attempt = 0; attempt < 4 && historyRequests === 0; attempt++) {
      await loadMore.click();
      await expect(thread.locator('.loading-more-indicator')).toHaveCount(0);
    }
    await expect.poll(() => historyRequests).toBeGreaterThan(0);
    await expect(loadMore).toBeVisible();
    allowHistory = true;

    const anchor = thread.locator('[data-message-id]').first();
    const anchorId = await anchor.getAttribute('data-message-id');
    const anchorTop = await anchor.evaluate(element => element.getBoundingClientRect().top);
    await loadMore.click();
    await expect(thread.getByText('History fixture 99', { exact: true })).toHaveCount(1);
    await expect.poll(async () => {
      const top = await thread.locator(`[data-message-id="${anchorId}"]`)
        .evaluate(element => element.getBoundingClientRect().top);
      return Math.abs(top - anchorTop);
    }).toBeLessThan(3);

    for (let attempt = 0; attempt < 8; attempt++) {
      if (await thread.getByText('History fixture 124', { exact: true }).count()) break;
      await loadMore.click();
      await expect(thread.locator('.loading-more-indicator')).toHaveCount(0);
    }
    await expect(thread.getByText('History fixture 124', { exact: true })).toHaveCount(1);
    await expect(thread.getByText('History fixture 0', { exact: true })).toHaveCount(1);
    await expect(thread.locator('[data-message-id]')).toHaveCount(125);

    for (const dark of [false, true]) {
      await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
      await expect(page.locator('html')).toHaveCSS('color-scheme', dark ? 'dark' : 'light');
      await thread.evaluate(element => { element.scrollTop = 0; });
      await expect(loadMore).toBeVisible();
      await expect.poll(() => thread.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: `test-results/screenshots/messages-history-${dark ? 'dark' : 'light'}.png`,
        animations: 'disabled' });
    }
    await saveConsoleLogs('messages-history');
  });
});
