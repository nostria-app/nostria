#!/usr/bin/env node
// Performance profiler: launches the dev app in preview mode, captures
// console logs, Web Vitals, memory snapshots, long tasks, WebSocket traffic,
// and a CDP performance trace. Results are saved to test-results/perf/.

import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const NPUB = process.argv[2] || 'npub1zl3g38a6qypp6py2z07shggg45cu8qex992xpss7d8zrl28mu52s4cjajh';
const BASE = process.argv[3] || 'http://localhost:4200';
const OUT = path.join(process.cwd(), 'test-results', 'perf');
fs.mkdirSync(OUT, { recursive: true });

// Convert npub to hex
function npubToHex(npub) {
  // Lazy import to keep script light
  const { nip19 } = require('nostr-tools');
  const d = nip19.decode(npub);
  return d.data;
}

const { nip19 } = await import('nostr-tools');
const pubkeyHex = nip19.decode(NPUB).data;
console.log('Pubkey:', pubkeyHex);

const previewUser = {
  pubkey: pubkeyHex,
  name: '...',
  source: 'preview',
  lastUsed: Date.now(),
  hasActivated: true,
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
});

await context.addInitScript((user) => {
  localStorage.setItem('nostria-account', JSON.stringify(user));
  localStorage.setItem('nostria-accounts', JSON.stringify([user]));
  // Install perf hooks
  window.__perfLongTasks = [];
  window.__perfMemory = [];
  window.__perfMarks = [];
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__perfLongTasks.push({
          name: e.name,
          startTime: e.startTime,
          duration: e.duration,
          attribution: (e.attribution || []).map((a) => ({ name: a.name, containerType: a.containerType, containerSrc: a.containerSrc })),
        });
      }
    });
    po.observe({ entryTypes: ['longtask'] });
  } catch {}
}, previewUser);

const page = await context.newPage();

const consoleLogs = [];
page.on('console', (msg) => {
  const entry = { t: Date.now(), type: msg.type(), text: msg.text() };
  consoleLogs.push(entry);
});
page.on('pageerror', (err) => {
  consoleLogs.push({ t: Date.now(), type: 'pageerror', text: String(err) });
});

const wsEvents = [];
page.on('websocket', (ws) => {
  const url = ws.url();
  const openedAt = Date.now();
  let sent = 0, received = 0;
  let sentBytes = 0, recvBytes = 0;
  ws.on('framesent', (f) => { sent++; sentBytes += (f.payload?.length || 0); });
  ws.on('framereceived', (f) => { received++; recvBytes += (f.payload?.length || 0); });
  ws.on('close', () => {
    wsEvents.push({ url, openedAt, closedAt: Date.now(), sent, received, sentBytes, recvBytes });
  });
});

// Start CDP trace
const client = await page.context().newCDPSession(page);
await client.send('Performance.enable');

const traceFile = path.join(OUT, 'trace.json');
await client.send('Tracing.start', {
  transferMode: 'ReturnAsStream',
  categories: [
    'devtools.timeline',
    'v8.execute',
    'disabled-by-default-devtools.timeline',
    'disabled-by-default-devtools.timeline.frame',
    'disabled-by-default-v8.cpu_profiler',
    'loading',
    'blink.user_timing',
  ].join(','),
});

async function snapshotMemory(label) {
  const m = await page.evaluate(() => {
    const perf = performance;
    const mem = perf.memory || {};
    return {
      ts: Date.now(),
      usedJSHeap: mem.usedJSHeapSize || 0,
      totalJSHeap: mem.totalJSHeapSize || 0,
      heapLimit: mem.jsHeapSizeLimit || 0,
    };
  });
  return { label, ...m };
}

const memory = [];
const navStart = Date.now();
console.log('[perf] navigating to', BASE);
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
memory.push(await snapshotMemory('domcontentloaded'));

try {
  await page.waitForLoadState('networkidle', { timeout: 20000 });
} catch {}
memory.push(await snapshotMemory('networkidle'));

// Wait a bit for idle preloads
await page.waitForTimeout(5000);
memory.push(await snapshotMemory('after-5s'));

// Try to visit key routes and capture memory/long-task stats
const routes = ['/', '/f', '/b', '/notifications', '/p/' + pubkeyHex];
for (const r of routes) {
  try {
    console.log('[perf] visiting', r);
    await page.goto(BASE + r, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    memory.push(await snapshotMemory('route:' + r));
  } catch (e) {
    console.log('[perf] route failed', r, e.message);
  }
}

// Capture Web Vitals + nav timings
const vitals = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const paints = performance.getEntriesByType('paint') || [];
  const fcp = paints.find((p) => p.name === 'first-contentful-paint');
  const lcpEntries = performance.getEntriesByType('largest-contentful-paint') || [];
  const lcp = lcpEntries.length ? lcpEntries[lcpEntries.length - 1].startTime : null;
  return {
    navigation: {
      domInteractive: nav.domInteractive,
      domContentLoadedEventEnd: nav.domContentLoadedEventEnd,
      loadEventEnd: nav.loadEventEnd,
      transferSize: nav.transferSize,
      decodedBodySize: nav.decodedBodySize,
    },
    fcp: fcp?.startTime || null,
    lcp,
    longTasks: window.__perfLongTasks || [],
  };
});

// Capture resource timing summary
const resources = await page.evaluate(() => {
  const entries = performance.getEntriesByType('resource');
  return entries.map((r) => ({
    name: r.name,
    initiatorType: r.initiatorType,
    duration: r.duration,
    transferSize: r.transferSize,
    decodedBodySize: r.decodedBodySize,
  }));
});

// Stop trace
const traceResult = await client.send('Tracing.end').catch(() => null);
// Receive stream
let traceData = null;
if (traceResult === null) {
  // Trace stops by stream handle event; use a different approach
}
// Simpler: just emit tracingComplete handler
client.on('Tracing.tracingComplete', async (e) => {
  if (e.stream) {
    let buf = '';
    while (true) {
      const { data, eof } = await client.send('IO.read', { handle: e.stream });
      buf += data;
      if (eof) break;
    }
    fs.writeFileSync(traceFile, buf);
    console.log('[perf] trace saved', traceFile, buf.length, 'bytes');
  }
});
// give time for complete
await page.waitForTimeout(2000);

fs.writeFileSync(path.join(OUT, 'console.json'), JSON.stringify(consoleLogs, null, 2));
fs.writeFileSync(path.join(OUT, 'memory.json'), JSON.stringify(memory, null, 2));
fs.writeFileSync(path.join(OUT, 'websockets.json'), JSON.stringify(wsEvents, null, 2));
fs.writeFileSync(path.join(OUT, 'vitals.json'), JSON.stringify(vitals, null, 2));
fs.writeFileSync(path.join(OUT, 'resources.json'), JSON.stringify(resources, null, 2));

// Summary
const errorLogs = consoleLogs.filter((l) => l.type === 'error' || l.type === 'pageerror');
const warnLogs = consoleLogs.filter((l) => l.type === 'warning' || l.type === 'warn');
const summary = {
  navStart,
  elapsedMs: Date.now() - navStart,
  consoleCounts: {
    total: consoleLogs.length,
    error: errorLogs.length,
    warn: warnLogs.length,
  },
  memoryMB: memory.map((m) => ({ label: m.label, usedMB: (m.usedJSHeap / 1048576).toFixed(1), totalMB: (m.totalJSHeap / 1048576).toFixed(1) })),
  longTasksCount: vitals.longTasks.length,
  longTaskTotalMs: vitals.longTasks.reduce((a, b) => a + b.duration, 0).toFixed(0),
  longTaskMaxMs: vitals.longTasks.reduce((m, b) => Math.max(m, b.duration), 0).toFixed(0),
  fcpMs: vitals.fcp,
  lcpMs: vitals.lcp,
  webSockets: wsEvents.length,
  wsMessages: wsEvents.reduce((a, b) => a + b.sent + b.received, 0),
  topErrors: errorLogs.slice(0, 10).map((e) => e.text.slice(0, 250)),
};
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

await browser.close();
