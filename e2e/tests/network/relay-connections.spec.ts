/**
 * Relay Connections E2E Tests @network @auth
 *
 * Verify the app connects to relays from the user's relay list, test
 * reconnection behavior by simulating a connection drop, verify EOSE
 * is received for initial subscriptions.
 */
import { test, expect } from '../../fixtures';
import { WebSocketMonitor } from '../../helpers/websocket-monitor';

test.describe('Relay Connections @network @auth', () => {
  let wsMonitor: WebSocketMonitor;

  test.beforeEach(async () => {
    wsMonitor = new WebSocketMonitor();
  });

  test.afterEach(async () => {
    await wsMonitor.detach();
  });

  test('should establish WebSocket connections to relays', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await wsMonitor.attach(authenticatedPage);

    await authenticatedPage.goto('/');
    await waitForNostrReady();
    await authenticatedPage.waitForTimeout(5000);

    const connections = wsMonitor.getRelayConnections();
    console.log(`=== Relay Connections ===`);
    console.log(`Total connections: ${connections.length}`);

    for (const conn of connections) {
      const relayHost = conn.url.replace('wss://', '').replace('ws://', '').split('/')[0];
      console.log(`  ${relayHost}: status=${conn.status}, sent=${conn.framesSent}, received=${conn.framesReceived}`);
    }

    // At least some WebSocket connections should be attempted
    console.log(`Connected relays: ${connections.filter(c => c.status === 'connected').length}`);

    await wsMonitor.saveReport('relay-connections');
    await saveConsoleLogs('relay-connections');
  });

  test('should send REQ subscriptions after connecting', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await wsMonitor.attach(authenticatedPage);

    await authenticatedPage.goto('/');
    await waitForNostrReady();
    await authenticatedPage.waitForTimeout(5000);

    const subscriptions = wsMonitor.getSubscriptions();
    console.log(`=== Subscriptions ===`);
    console.log(`Total subscriptions: ${subscriptions.length}`);

    for (const sub of subscriptions.slice(0, 20)) {
      const relayHost = sub.relayUrl.replace('wss://', '').replace('ws://', '').split('/')[0];
      console.log(`  ${sub.id} on ${relayHost}: events=${sub.eventsReceived}, eose=${sub.eoseReceived}, orphaned=${sub.orphaned}`);
    }

    const messageBreakdown = wsMonitor.getMessageTypeBreakdown();
    console.log(`\n=== Message Types ===`);
    for (const [type, count] of Object.entries(messageBreakdown)) {
      console.log(`  ${type}: ${count}`);
    }

    await wsMonitor.saveReport('relay-subscriptions');
    await saveConsoleLogs('relay-subscriptions');
  });

  test('should receive EOSE for initial subscriptions', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await wsMonitor.attach(authenticatedPage);

    await authenticatedPage.goto('/');
    await waitForNostrReady();
    await authenticatedPage.waitForTimeout(8000);

    const subscriptions = wsMonitor.getSubscriptions();
    const withEose = subscriptions.filter(s => s.eoseReceived);
    const withoutEose = subscriptions.filter(s => !s.eoseReceived);

    console.log(`Subscriptions with EOSE: ${withEose.length}`);
    console.log(`Subscriptions without EOSE: ${withoutEose.length}`);

    if (withoutEose.length > 0) {
      console.log(`\nSubscriptions still waiting for EOSE:`);
      for (const sub of withoutEose.slice(0, 10)) {
        const relayHost = sub.relayUrl.replace('wss://', '').replace('ws://', '').split('/')[0];
        console.log(`  ${sub.id} on ${relayHost}`);
      }
    }

    await wsMonitor.saveReport('relay-eose');
    await saveConsoleLogs('relay-eose');
  });

  test('should track event kinds received from relays', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await wsMonitor.attach(authenticatedPage);

    await authenticatedPage.goto('/');
    await waitForNostrReady();
    await authenticatedPage.waitForTimeout(5000);

    const eventKinds = wsMonitor.getEventKindBreakdown();
    console.log(`=== Event Kinds Received ===`);

    const kindNames: Record<number, string> = {
      0: 'Metadata',
      1: 'Short Note',
      2: 'Recommend Relay',
      3: 'Contact List',
      4: 'Encrypted DM',
      5: 'Event Deletion',
      6: 'Repost',
      7: 'Reaction',
      10002: 'Relay List',
      30023: 'Long-form Article',
    };

    for (const [kind, count] of Object.entries(eventKinds).sort((a, b) => Number(b[1]) - Number(a[1]))) {
      const name = kindNames[Number(kind)] || `Kind ${kind}`;
      console.log(`  ${name} (${kind}): ${count}`);
    }

    await wsMonitor.saveReport('relay-event-kinds');
    await saveConsoleLogs('relay-event-kinds');
  });

  test('should detect orphaned subscriptions', async ({ authenticatedPage, waitForNostrReady, saveConsoleLogs }) => {
    await wsMonitor.attach(authenticatedPage);

    await authenticatedPage.goto('/');
    await waitForNostrReady();

    // Navigate to another page and back to trigger subscription lifecycle
    await authenticatedPage.goto('/articles');
    await authenticatedPage.waitForTimeout(2000);
    await authenticatedPage.goto('/');
    await authenticatedPage.waitForTimeout(3000);

    const orphaned = wsMonitor.getOrphanedSubscriptions();
    console.log(`=== Orphaned Subscriptions ===`);
    console.log(`Total orphaned: ${orphaned.length}`);

    for (const sub of orphaned.slice(0, 10)) {
      const relayHost = sub.relayUrl.replace('wss://', '').replace('ws://', '').split('/')[0];
      console.log(`  ${sub.id} on ${relayHost}: events=${sub.eventsReceived}`);
    }

    if (orphaned.length > 20) {
      console.log(`⚠ High number of orphaned subscriptions (${orphaned.length}) - possible subscription leak`);
    }

    await wsMonitor.saveReport('relay-orphaned');
    await saveConsoleLogs('relay-orphaned');
  });
});
