/**
 * Relay Performance E2E Tests @metrics @auth
 *
 * In authenticated mode, measure WebSocket connection times to each relay,
 * track message latency (REQ to EOSE), count total events received,
 * report relay responsiveness.
 */
import { test, expect } from '../../fixtures';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Relay Performance @metrics @auth', () => {
  test('should measure WebSocket connection establishment', async ({ authenticatedPage, networkMonitor, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/');
    await waitForNostrReady();

    // Wait for relay connections to establish
    await authenticatedPage.waitForTimeout(5000);

    // Check WebSocket connections from the network monitor
    const wsConnections = networkMonitor.webSockets;
    console.log(`=== WebSocket Connections ===`);
    console.log(`Total WS connections: ${wsConnections.length}`);

    for (const ws of wsConnections) {
      const relayUrl = ws.url.replace('wss://', '').replace('ws://', '').split('/')[0];
      console.log(`  ${relayUrl}: msgs sent=${ws.messagesSent}, received=${ws.messagesReceived}`);
    }

    await networkMonitor.save('relay-performance-connections');
    await saveConsoleLogs('relay-performance-connections');
  });

  test('should track relay-related network requests', async ({ authenticatedPage, networkMonitor, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/');
    await waitForNostrReady();
    await authenticatedPage.waitForTimeout(5000);

    // Analyze all requests
    const totalRequests = networkMonitor.requests.length;
    const failedRequests = networkMonitor.failedRequests.length;
    const wsRequests = networkMonitor.requests.filter(r =>
      r.url.startsWith('ws://') || r.url.startsWith('wss://')
    );

    console.log('=== Network Summary ===');
    console.log(`Total requests: ${totalRequests}`);
    console.log(`Failed requests: ${failedRequests}`);
    console.log(`WebSocket requests: ${wsRequests.length}`);

    // Report failed requests
    if (failedRequests > 0) {
      console.log(`\nFailed requests:`);
      for (const req of networkMonitor.failedRequests.slice(0, 10)) {
        const shortUrl = req.url.length > 80 ? req.url.substring(0, 80) + '...' : req.url;
        console.log(`  ${req.method} ${shortUrl}: ${req.failureText}`);
      }
    }

    await networkMonitor.save('relay-performance-network');
    await saveConsoleLogs('relay-performance-network');
  });

  test('should monitor relay connection through console logs', async ({ authenticatedPage, waitForNostrReady, getConsoleLogs, saveConsoleLogs }) => {
    await authenticatedPage.goto('/');
    await waitForNostrReady();
    await authenticatedPage.waitForTimeout(5000);

    // Analyze console logs for relay-specific messages
    const logs = getConsoleLogs();
    const relayLogs = logs.filter(l =>
      l.text.includes('[RelayService]') ||
      l.text.includes('wss://') ||
      l.text.includes('EOSE') ||
      l.text.includes('relay') ||
      l.text.includes('subscription')
    );

    console.log(`=== Relay Console Activity ===`);
    console.log(`Total logs: ${logs.length}`);
    console.log(`Relay-related logs: ${relayLogs.length}`);

    // Count EOSE messages (subscription completion indicators)
    const eoseCount = logs.filter(l => l.text.includes('EOSE')).length;
    console.log(`EOSE messages: ${eoseCount}`);

    // Count relay connections
    const connectLogs = logs.filter(l =>
      l.text.includes('connected') && (l.text.includes('relay') || l.text.includes('wss://'))
    );
    console.log(`Relay connection logs: ${connectLogs.length}`);

    // Save relay performance report
    const metricsDir = path.join(process.cwd(), 'test-results', 'metrics');
    if (!fs.existsSync(metricsDir)) {
      fs.mkdirSync(metricsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(
      path.join(metricsDir, `relay-performance-${timestamp}.json`),
      JSON.stringify({
        totalLogs: logs.length,
        relayLogs: relayLogs.length,
        eoseMessages: eoseCount,
        connectionLogs: connectLogs.length,
        relayLogSample: relayLogs.slice(0, 20),
        collectedAt: new Date().toISOString(),
      }, null, 2)
    );

    await saveConsoleLogs('relay-performance-logs');
  });

  test('should measure time to first relay data', async ({ authenticatedPage, saveConsoleLogs }) => {
    const startTime = Date.now();

    await authenticatedPage.goto('/');

    // Wait for any relay data to appear (events loading in feed)
    const dataAppeared = await authenticatedPage.waitForSelector(
      'app-event, app-event-thread, .event-card, .feed-item',
      { timeout: 15000 }
    ).then(() => true).catch(() => false);

    const timeToData = Date.now() - startTime;

    console.log(`=== Time to First Relay Data ===`);
    console.log(`Data appeared: ${dataAppeared}`);
    console.log(`Time: ${timeToData}ms`);

    if (!dataAppeared) {
      console.log('No relay data appeared within 15s (may be expected for test account with no follows)');
    }

    // Save metric
    const metricsDir = path.join(process.cwd(), 'test-results', 'metrics');
    if (!fs.existsSync(metricsDir)) {
      fs.mkdirSync(metricsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(
      path.join(metricsDir, `time-to-data-${timestamp}.json`),
      JSON.stringify({
        dataAppeared,
        timeToDataMs: timeToData,
        collectedAt: new Date().toISOString(),
      }, null, 2)
    );

    await saveConsoleLogs('relay-performance-time-to-data');
  });
});
