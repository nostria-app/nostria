/**
 * Memory Usage Performance E2E Tests @metrics @auth
 *
 * In authenticated mode, navigate through 10 pages sequentially, capture
 * performance.memory.usedJSHeapSize at each step, report if memory grows
 * monotonically (potential leak), save the memory timeline to JSON.
 */
import { test, expect } from '../../fixtures';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Memory Usage @metrics @auth', () => {
  test('should track memory across page navigations', async ({ authenticatedPage, memoryMonitor, waitForNostrReady, saveConsoleLogs }) => {
    const pages = [
      { path: '/', name: 'Home' },
      { path: '/discover', name: 'Discover' },
      { path: '/articles', name: 'Articles' },
      { path: '/music', name: 'Music' },
      { path: '/settings', name: 'Settings' },
      { path: '/relays', name: 'Relays' },
      { path: '/search', name: 'Search' },
      { path: '/notifications', name: 'Notifications' },
      { path: '/accounts', name: 'Accounts' },
      { path: '/', name: 'Home (return)' },
    ];

    const timeline: Array<{ page: string; memoryMB: number | null; timestamp: number }> = [];

    for (const pg of pages) {
      await authenticatedPage.goto(pg.path);
      await authenticatedPage.waitForLoadState('networkidle');
      await authenticatedPage.waitForTimeout(1000);

      // Capture memory snapshot
      const snapshot = await memoryMonitor.capture();
      const memoryMB = snapshot ? snapshot.usedJSHeapSize / (1024 * 1024) : null;

      timeline.push({
        page: pg.name,
        memoryMB,
        timestamp: Date.now(),
      });

      console.log(`${pg.name}: ${memoryMB ? memoryMB.toFixed(1) + 'MB' : 'N/A'}`);
    }

    // Analyze for monotonic growth (potential leak)
    const validSnapshots = timeline.filter(t => t.memoryMB !== null);
    if (validSnapshots.length >= 3) {
      let monotonic = true;
      for (let i = 1; i < validSnapshots.length; i++) {
        if ((validSnapshots[i].memoryMB as number) < (validSnapshots[i - 1].memoryMB as number)) {
          monotonic = false;
          break;
        }
      }

      const firstMB = validSnapshots[0].memoryMB as number;
      const lastMB = validSnapshots[validSnapshots.length - 1].memoryMB as number;
      const growthMB = lastMB - firstMB;

      console.log(`\n=== Memory Analysis ===`);
      console.log(`Start: ${firstMB.toFixed(1)}MB, End: ${lastMB.toFixed(1)}MB`);
      console.log(`Growth: ${growthMB.toFixed(1)}MB`);
      console.log(`Monotonic growth: ${monotonic}`);

      if (monotonic && growthMB > 50) {
        console.log('⚠ Potential memory leak detected: monotonic growth exceeding 50MB');
      }
    }

    // Save timeline
    await memoryMonitor.save('memory-navigation-timeline');

    await saveConsoleLogs('memory-navigation');
  });

  test('should check memory after repeated scrolling', async ({ authenticatedPage, memoryMonitor, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/');
    await waitForNostrReady();
    await authenticatedPage.waitForTimeout(1000);

    // Capture baseline
    const baseline = await memoryMonitor.capture();
    const baselineMB = baseline ? baseline.usedJSHeapSize / (1024 * 1024) : null;
    console.log(`Baseline memory: ${baselineMB ? baselineMB.toFixed(1) + 'MB' : 'N/A'}`);

    // Scroll up and down 10 times
    for (let i = 0; i < 10; i++) {
      await authenticatedPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await authenticatedPage.waitForTimeout(300);
      await authenticatedPage.evaluate(() => window.scrollTo(0, 0));
      await authenticatedPage.waitForTimeout(300);
    }

    // Capture after scrolling
    const afterScroll = await memoryMonitor.capture();
    const afterMB = afterScroll ? afterScroll.usedJSHeapSize / (1024 * 1024) : null;
    console.log(`After scrolling memory: ${afterMB ? afterMB.toFixed(1) + 'MB' : 'N/A'}`);

    if (baselineMB && afterMB) {
      const growth = afterMB - baselineMB;
      console.log(`Growth from scrolling: ${growth.toFixed(1)}MB`);
    }

    await memoryMonitor.save('memory-scrolling');
    await saveConsoleLogs('memory-scrolling');
  });

  test('should report memory delta summary', async ({ authenticatedPage, memoryMonitor, waitForNostrReady, saveConsoleLogs }) => {
    await authenticatedPage.goto('/');
    await waitForNostrReady();
    await authenticatedPage.waitForTimeout(2000);

    // Navigate to a few pages to generate activity
    const pages = ['/', '/articles', '/music', '/'];
    for (const pg of pages) {
      await authenticatedPage.goto(pg);
      await authenticatedPage.waitForTimeout(1000);
      await memoryMonitor.capture();
    }

    // Get delta
    const delta = memoryMonitor.getDelta();
    if (delta) {
      console.log('=== Memory Delta Summary ===');
      console.log(`Start: ${delta.startMB.toFixed(1)}MB`);
      console.log(`End: ${delta.endMB.toFixed(1)}MB`);
      console.log(`Delta: ${delta.deltaMB.toFixed(1)}MB`);
      console.log(`Potential Leak: ${delta.potentialLeak}`);

      if (delta.potentialLeak) {
        console.log('⚠ Memory growth exceeds 50MB threshold');
      }
    } else {
      console.log('Memory monitoring not available (non-Chrome browser?)');
    }

    await memoryMonitor.save('memory-delta-summary');
    await saveConsoleLogs('memory-delta');
  });
});
