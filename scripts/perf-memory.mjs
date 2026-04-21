#!/usr/bin/env node
// Second profiler: uses CDP Runtime.getHeapUsage for actual JS heap + DOM counters.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const NPUB = process.argv[2] || 'npub1zl3g38a6qypp6py2z07shggg45cu8qex992xpss7d8zrl28mu52s4cjajh';
const BASE = process.argv[3] || 'http://localhost:4200';
const OUT = path.join(process.cwd(), 'test-results', 'perf');
fs.mkdirSync(OUT, { recursive: true });

const { nip19 } = await import('nostr-tools');
const pubkeyHex = nip19.decode(NPUB).data;

const previewUser = {
  pubkey: pubkeyHex,
  name: '...',
  source: 'preview',
  lastUsed: Date.now(),
  hasActivated: true,
};

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'],
});
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await context.addInitScript((user) => {
  localStorage.setItem('nostria-account', JSON.stringify(user));
  localStorage.setItem('nostria-accounts', JSON.stringify([user]));
}, previewUser);

const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');
await cdp.send('HeapProfiler.enable');

const memSamples = [];
async function sample(label) {
  const heap = await cdp.send('Runtime.getHeapUsage').catch(() => null);
  const perf = await cdp.send('Performance.getMetrics').catch(() => null);
  const dom = await cdp.send('DOM.getDocument', { depth: 0 }).catch(() => null);
  const metrics = {};
  if (perf) {
    for (const m of perf.metrics) metrics[m.name] = m.value;
  }
  memSamples.push({
    label,
    t: Date.now(),
    usedSizeMB: heap ? +(heap.usedSize / 1048576).toFixed(2) : null,
    totalSizeMB: heap ? +(heap.totalSize / 1048576).toFixed(2) : null,
    nodes: metrics['Nodes'],
    jsHeapTotalMB: metrics['JSHeapTotalSize'] ? +(metrics['JSHeapTotalSize'] / 1048576).toFixed(2) : null,
    jsHeapUsedMB: metrics['JSHeapUsedSize'] ? +(metrics['JSHeapUsedSize'] / 1048576).toFixed(2) : null,
    scriptDurationMs: metrics['ScriptDuration'] ? +(metrics['ScriptDuration'] * 1000).toFixed(0) : null,
    taskDurationMs: metrics['TaskDuration'] ? +(metrics['TaskDuration'] * 1000).toFixed(0) : null,
    layoutCount: metrics['LayoutCount'],
    recalcStyleCount: metrics['RecalcStyleCount'],
    listeners: metrics['JSEventListeners'],
    documents: metrics['Documents'],
  });
}

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sample('dcl');
try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
await sample('networkidle');
await page.waitForTimeout(3000);
await sample('idle-3s');

const routes = ['/f', '/b', '/notifications', '/bookmarks', '/people'];
for (const r of routes) {
  try {
    await page.goto(BASE + r, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    await sample('route:' + r);
  } catch (e) {
    console.log('[perf] fail', r, e.message);
  }
}

// Go back to home, wait, force GC to see steady-state
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);
await sample('home-again');
await page.evaluate(() => { if (typeof globalThis.gc === 'function') globalThis.gc(); });
await sample('post-gc');

const out = path.join(OUT, 'memory-detailed.json');
fs.writeFileSync(out, JSON.stringify(memSamples, null, 2));
console.log(JSON.stringify(memSamples, null, 2));
await browser.close();
