#!/usr/bin/env node
// Measure how fast per-event interactions (reactions/replies/reposts/zaps)
// become visible on the feed. Uses the real preview-mode login flow via the
// UI so the app initializes normally (relay discovery, account state, etc.).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const NPUB = process.argv[2] || 'npub1zl3g38a6qypp6py2z07shggg45cu8qex992xpss7d8zrl28mu52s4cjajh';
const BASE = process.argv[3] || 'http://localhost:4200';
const OBSERVE_MS = Number(process.argv[4] || 40000);
const OUT = path.join(process.cwd(), 'test-results', 'perf');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 2200 } });

const { nip19 } = await import('nostr-tools');
const pubkeyHex = nip19.decode(NPUB).data;

const previewUser = {
  pubkey: pubkeyHex,
  name: 'PerfProbe',
  source: 'preview',
  lastUsed: Date.now(),
  hasActivated: true,
  isEncrypted: false,
};

const now = Date.now();
const defaultFeeds = [
  {
    id: 'default-feed-following',
    label: 'Following',
    icon: 'diversity_2',
    type: 'notes',
    kinds: [1, 6],
    source: 'following',
    relayConfig: 'account',
    createdAt: now,
    updatedAt: now,
  },
];
const feedsByAccount = { [pubkeyHex]: defaultFeeds };

await context.addInitScript(({ account, accounts, discovery, search, feeds }) => {
  localStorage.setItem('nostria-account', account);
  localStorage.setItem('nostria-accounts', accounts);
  localStorage.setItem('nostria-discovery-relays', discovery);
  localStorage.setItem('nostria-search-relays', search);
  localStorage.setItem('nostria-feeds', feeds);
  localStorage.setItem('nostria-log-level', 'info');
}, {
  account: JSON.stringify(previewUser),
  accounts: JSON.stringify([previewUser]),
  discovery: JSON.stringify([
    'wss://indexer.coracle.social/',
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
  ]),
  search: JSON.stringify([
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
  ]),
  feeds: JSON.stringify(feedsByAccount),
});

const page = await context.newPage();

const consoleLog = [];
page.on('console', msg => {
  const text = msg.text();
  // Capture all logs that mention interaction-related terms
  if (/(Interact|interact|react|zap|reply|repost|relay|quer|RelayPool|UserRelay|EventService|saturated|fallback)/i.test(text)) {
    consoleLog.push({ t: Date.now(), type: msg.type(), text: text.slice(0, 800) });
  }
});
page.on('pageerror', e => consoleLog.push({ t: Date.now(), type: 'pageerror', text: String(e).slice(0, 500) }));

const t0 = Date.now();
console.log('[perf-reactions] navigating to / ...');
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });

// Wait a moment for the app to bootstrap with the injected account
await page.waitForTimeout(1500);

console.log('[perf-reactions] navigating to /f ...');
await page.goto(BASE + '/f', { waitUntil: 'domcontentloaded', timeout: 60000 });

console.log('[perf-reactions] waiting for events ...');
let tFirstEvent = null;
try {
  // Wait for at least 3 events to reduce flakiness
  await page.waitForFunction(() => document.querySelectorAll('app-event').length >= 3, null, { timeout: 60000 });
  tFirstEvent = Date.now() - t0;
  const count = await page.evaluate(() => document.querySelectorAll('app-event').length);
  console.log('[perf-reactions] >=3 events at', tFirstEvent, 'ms (total:', count, ')');
} catch {
  console.log('[perf-reactions] <3 events rendered in 60s');
  await page.screenshot({ path: path.join(OUT, 'no-events.png'), fullPage: false });
  const url = page.url();
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 2000));
  console.log('[perf-reactions] url:', url);
  console.log('[perf-reactions] body:', bodyText);
}

// Diagnostic: how many events are rendered and what state?
await page.waitForTimeout(1000);
const diag = await page.evaluate(() => {
  const nodes = Array.from(document.querySelectorAll('app-event'));
  const eventIds = nodes.map(n => {
    // Find nearest element with data-event-id or matching attr
    const dataId = n.getAttribute('data-event-id');
    // Fallback: scrape event id from content or nested anchor
    const noteLink = n.querySelector('a[href*="/e/nevent"], a[href*="/e/note"]')?.getAttribute('href') || '';
    return dataId || noteLink;
  });
  const uniqueIds = [...new Set(eventIds.filter(Boolean))];
  return {
    url: location.pathname,
    eventCount: nodes.length,
    uniqueEventIds: uniqueIds.length,
    duplicateCount: nodes.length - uniqueIds.length,
    idSample: eventIds.slice(0, 10),
  };
});
console.log('[perf-reactions] diag:', JSON.stringify(diag, null, 2));

await page.evaluate(() => window.scrollTo(0, 100));
await page.waitForTimeout(250);
await page.evaluate(() => window.scrollTo(0, 0));

const perEvent = new Map();
async function snapshot() {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('app-event'));
    // Read count from an action button wrapper (e.g., .like-action, .comment-action)
    const readActionCount = (root, actionClass) => {
      const wrapper = root.querySelector(`.${actionClass}`);
      if (!wrapper) return null;
      const countEl = wrapper.querySelector('.action-count');
      if (!countEl) return '0';
      const t = (countEl.textContent || '').trim();
      if (!t || t === '00') return '0';
      return t;
    };
    return nodes.map((n, idx) => {
      let id = n.getAttribute('data-event-id') || n.id || null;
      if (!id) {
        const content = (n.textContent || '').trim().slice(0, 80);
        id = `idx-${idx}:${content.slice(0, 50)}`;
      }
      return {
        id,
        idx,
        reply: readActionCount(n, 'comment-action'),
        repost: readActionCount(n, 'share-action'),
        reaction: readActionCount(n, 'like-action'),
        zap: readActionCount(n, 'zap-action'),
      };
    });
  });
}

const pollStart = Date.now();
while (Date.now() - pollStart < OBSERVE_MS) {
  const snap = await snapshot().catch(() => []);
  const now = Date.now() - t0;
  for (const row of snap) {
    const id = row.id || JSON.stringify(row).slice(0, 60);
    let rec = perEvent.get(id);
    if (!rec) {
      rec = { firstSeen: now, firstReply: null, firstRepost: null, firstReaction: null, firstZap: null, final: null };
      perEvent.set(id, rec);
    }
    const parse = (v) => {
      if (!v || v === '0') return 0;
      const num = parseFloat(v);
      if (v.endsWith('k') || v.endsWith('K')) return num * 1000;
      if (v.endsWith('m') || v.endsWith('M')) return num * 1_000_000;
      return num || 0;
    };
    if (!rec.firstReply && parse(row.reply) > 0) rec.firstReply = now;
    if (!rec.firstRepost && parse(row.repost) > 0) rec.firstRepost = now;
    if (!rec.firstReaction && parse(row.reaction) > 0) rec.firstReaction = now;
    if (!rec.firstZap && parse(row.zap) > 0) rec.firstZap = now;
    rec.final = row;
  }
  await page.waitForTimeout(250);
}

const events = Array.from(perEvent.entries()).map(([id, rec]) => ({ id: String(id).slice(0, 16), ...rec }));
const withAny = events.filter(e => e.firstReply || e.firstRepost || e.firstReaction || e.firstZap);
const delays = {
  anyFirst: withAny.map(e => Math.min(...[e.firstReply, e.firstRepost, e.firstReaction, e.firstZap].filter(Boolean)) - e.firstSeen),
  reaction: events.filter(e => e.firstReaction).map(e => e.firstReaction - e.firstSeen),
  reply: events.filter(e => e.firstReply).map(e => e.firstReply - e.firstSeen),
  repost: events.filter(e => e.firstRepost).map(e => e.firstRepost - e.firstSeen),
  zap: events.filter(e => e.firstZap).map(e => e.firstZap - e.firstSeen),
};
function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p / 100))];
}
function stats(arr) {
  if (!arr.length) return { count: 0 };
  return {
    count: arr.length,
    avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
    p50: pct(arr, 50),
    p95: pct(arr, 95),
    max: Math.max(...arr),
  };
}

const summary = {
  npub: NPUB,
  base: BASE,
  tFirstEvent,
  observedMs: OBSERVE_MS,
  eventsSeen: events.length,
  eventsWithAnyInteraction: withAny.length,
  eventsWithNoInteractionAtEnd: events.length - withAny.length,
  delays: {
    anyFirst: stats(delays.anyFirst),
    reaction: stats(delays.reaction),
    reply: stats(delays.reply),
    repost: stats(delays.repost),
    zap: stats(delays.zap),
  },
  perEvent: events.slice(0, 30),
  consoleHead: consoleLog.slice(0, 400),
  consoleCount: consoleLog.length,
};

const outFile = path.join(OUT, 'reactions-' + Date.now() + '.json');
fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
console.log('[perf-reactions] summary:', JSON.stringify({
  tFirstEvent: summary.tFirstEvent,
  eventsSeen: summary.eventsSeen,
  eventsWithAnyInteraction: summary.eventsWithAnyInteraction,
  eventsWithNoInteractionAtEnd: summary.eventsWithNoInteractionAtEnd,
  delays: summary.delays,
}, null, 2));
console.log('[perf-reactions] full report at', outFile);

await browser.close();
