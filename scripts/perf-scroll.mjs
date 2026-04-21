#!/usr/bin/env node
// Scroll-aware perf probe. Counts iframes on home feed before/during/after scroll
// to validate the lazy-iframe mount/unmount behavior.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const NPUB = process.argv[2] || 'npub1zl3g38a6qypp6py2z07shggg45cu8qex992xpss7d8zrl28mu52s4cjajh';
const BASE = process.argv[3] || 'http://localhost:4200';
const OUT = path.join(process.cwd(), 'test-results', 'perf');
fs.mkdirSync(OUT, { recursive: true });

const { nip19 } = await import('nostr-tools');
const pubkeyHex = nip19.decode(NPUB).data;
const user = {
  pubkey: pubkeyHex,
  name: '...',
  source: 'preview',
  lastUsed: Date.now(),
  hasActivated: true,
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await context.addInitScript((u) => {
  localStorage.setItem('nostria-account', JSON.stringify(u));
  localStorage.setItem('nostria-accounts', JSON.stringify([u]));
}, user);

const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');

async function counts(label) {
  const m = await cdp.send('Performance.getMetrics');
  const o = {};
  for (const x of m.metrics) o[x.name] = x.value;
  const { iframes, appLazy, mounted } = await page.evaluate(() => ({
    iframes: document.querySelectorAll('iframe').length,
    appLazy: document.querySelectorAll('app-lazy-iframe').length,
    mounted: document.querySelectorAll('app-lazy-iframe iframe').length,
  })).catch(() => ({ iframes: 0, appLazy: 0, mounted: 0 }));
  return {
    label,
    nodes: o['Nodes'],
    listeners: o['JSEventListeners'],
    documents: o['Documents'],
    heapMB: +(o['JSHeapUsedSize'] / 1048576).toFixed(1),
    iframes,
    appLazy,
    mountedLazy: mounted,
  };
}

const samples = [];
await page.goto(BASE + '/f', { waitUntil: 'domcontentloaded', timeout: 60000 });
try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch { }
await page.waitForTimeout(4000);
samples.push(await counts('f-initial'));

// Find the scroll container (feed column)
const scrollInfo = await page.evaluate(() => {
  // Prefer the feed column scroll element, fall back to document.
  const candidates = Array.from(document.querySelectorAll('*')).filter((el) => {
    const s = getComputedStyle(el);
    return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 200;
  });
  candidates.sort((a, b) => b.scrollHeight - a.scrollHeight);
  const best = candidates[0];
  return best
    ? { tag: best.tagName, cls: best.className, scrollHeight: best.scrollHeight, clientHeight: best.clientHeight }
    : null;
});
console.log('scroll container:', scrollInfo);

// Scroll down in large steps to trigger mounts/unmounts
for (let i = 1; i <= 10; i++) {
  await page.evaluate((idx) => {
    const cands = Array.from(document.querySelectorAll('*')).filter((el) => {
      const s = getComputedStyle(el);
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 200;
    });
    cands.sort((a, b) => b.scrollHeight - a.scrollHeight);
    const best = cands[0];
    if (best) best.scrollTop = idx * 2000;
    else window.scrollTo(0, idx * 2000);
  }, i);
  await page.waitForTimeout(800);
  samples.push(await counts('scroll-' + i));
}

// Scroll back to top and wait for unmount delay
await page.evaluate(() => {
  const cands = Array.from(document.querySelectorAll('*')).filter((el) => {
    const s = getComputedStyle(el);
    return s.overflowY === 'auto' || s.overflowY === 'scroll';
  });
  cands.sort((a, b) => b.scrollHeight - a.scrollHeight);
  const best = cands[0];
  if (best) best.scrollTop = 0;
  else window.scrollTo(0, 0);
});
await page.waitForTimeout(3000);
samples.push(await counts('scroll-back-top'));

fs.writeFileSync(path.join(OUT, 'scroll-trace.json'), JSON.stringify(samples, null, 2));
console.log(JSON.stringify(samples, null, 2));
await browser.close();
