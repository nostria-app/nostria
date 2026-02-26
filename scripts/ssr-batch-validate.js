const http = require('http');

const PATHS = [
  '/e/nevent1qvzqqqqqqypzqj8fwczhhuk0zvesyq64khfy87xasyl3jvz3689sgsfcjn6x4nzrqqsw338vsklzm40pkqz6mavwftgswusuv3vnr62z82u30zsdan4a8psz79rjr',
  '/a/naddr1qvzqqqr4gupzq9lz3z0m5qgzr5zg5ylapwss3tf3cwpjv225vrppu6wy8750heg4qy88wumn8ghj7mn0wvhxcmmv9uqpxmtfxesh5drnveck7v3swpkkuen0wahs7sg5pu',
  '/a/naddr1qvzqqqr4gupzp5daxvenwv7ucsglpm5f8vuts530cr0zylllgkwejpzvak0x2kqmqy88wumn8ghj7mn0wvhxcmmv9uqzzmn0wd68y6tp95enqttnv4jj67t0w4ez6enjd9jkuern94skwctfdc7pd2hl',
  '/p/nprofile1qyghwumn8ghj7mn0wd68ytnvv9hxgtcqyqewrqnkx4zsaweutf739s0cu7et29zrntqs5elw70vlm8zudr3y2rh9pxh',
  '/e/nevent1qvzqqqqqqypzqvhpsfmr23gwhv795lgjc8uw0v44z3pe4sg2vlh08k0an3wx3cj9qyghwumn8ghj7mn0wd68ytnvv9hxgtcqyqn9vumxqhhg96un8xl638a7d7ah9m0yth2w0lfsnamc9avfphgk5zlx2s4',
  '/p/nprofile1qythwumn8ghj7un9d3shjtnp0faxzmt09ehx2ap0qqst0mtgkp3du662ztj3l4fgts0purksu5fgek5n4vgmg9gt2hkn9lqrg0ssp',
  '/e/nevent1qvzqqqqqqypzpdlddzcx9hntfgfw28749pwpu8sw6rj39rx6jw43rdq4pd276vhuqythwumn8ghj7un9d3shjtnp0faxzmt09ehx2ap0qqsy2k3rdfjgkd4lrc00ln0t49kz4jncuc9j4usmjkvm7vgrxhwlh3g72rsnv',
  '/a/naddr1qvzqqqr4gupzpdlddzcx9hntfgfw28749pwpu8sw6rj39rx6jw43rdq4pd276vhuqythwumn8ghj7un9d3shjtnp0faxzmt09ehx2ap0qqgxgvnpxscrzcnrvd3rgvmrxgmnsm3996d',
];

const BOT_USER_AGENT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const HOST = 'localhost';
const PORT = 4000;
const REQUEST_TIMEOUT_MS = 12000;
const GOOD_TIME_MS = 3500;
const MAX_ACCEPTABLE_TIME_MS = 6000;

const LOW_QUALITY_MARKERS = [
  'loading nostr event content',
  'content not available',
  'no description available',
  'error loading event content',
  'loading...',
  'could not load preview',
];

function extractMetaContent(html, tag) {
  const escapedTag = tag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const byProperty = new RegExp(`<meta\\s+property=["']${escapedTag}["']\\s+content=["']([\\s\\S]*?)["']`, 'i');
  const byName = new RegExp(`<meta\\s+name=["']${escapedTag}["']\\s+content=["']([\\s\\S]*?)["']`, 'i');
  return byProperty.exec(html)?.[1] || byName.exec(html)?.[1] || '';
}

function analyzeHtml(html) {
  const ogTitle = extractMetaContent(html, 'og:title').trim();
  const ogDescription = extractMetaContent(html, 'og:description').trim();
  const ogImage = extractMetaContent(html, 'og:image').trim();
  const twitterTitle = extractMetaContent(html, 'twitter:title').trim();
  const twitterDescription = extractMetaContent(html, 'twitter:description').trim();
  const articlePublished = extractMetaContent(html, 'article:published_time').trim();

  const combined = `${ogTitle} ${ogDescription} ${twitterTitle} ${twitterDescription}`.toLowerCase();
  const genericTitle = ogTitle.toLowerCase() === 'nostr event' || twitterTitle.toLowerCase() === 'nostr event';
  const degraded = genericTitle || LOW_QUALITY_MARKERS.some((marker) => combined.includes(marker));

  return {
    hasOgTitle: !!ogTitle,
    hasOgDescription: !!ogDescription,
    hasOgImage: !!ogImage,
    hasTwitterTitle: !!twitterTitle,
    hasTwitterDescription: !!twitterDescription,
    hasArticlePublished: !!articlePublished,
    degraded,
    ogTitle,
    ogDescription,
  };
}

function requestPath(path) {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: HOST,
        port: PORT,
        path,
        method: 'GET',
        headers: {
          'User-Agent': BOT_USER_AGENT,
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          const elapsedMs = Date.now() - startedAt;
          const analysis = analyzeHtml(body);

          resolve({
            path,
            ok: res.statusCode === 200,
            statusCode: res.statusCode,
            elapsedMs,
            cache: res.headers['x-ssr-cache'] || 'none',
            cacheAge: res.headers['x-ssr-cache-age'] || '0',
            ...analysis,
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('request timeout'));
    });

    req.on('error', (error) => {
      resolve({
        path,
        ok: false,
        statusCode: 0,
        elapsedMs: Date.now() - startedAt,
        cache: 'none',
        cacheAge: '0',
        hasOgTitle: false,
        hasOgDescription: false,
        hasOgImage: false,
        hasTwitterTitle: false,
        hasTwitterDescription: false,
        hasArticlePublished: false,
        degraded: true,
        ogTitle: '',
        ogDescription: '',
        error: error instanceof Error ? error.message : String(error),
      });
    });

    req.end();
  });
}

function classify(result) {
  const completeTags = result.hasOgTitle && result.hasOgDescription && result.hasOgImage;

  if (!result.ok || !completeTags || result.degraded) {
    return 'FAIL';
  }

  if (result.elapsedMs <= GOOD_TIME_MS) {
    return 'PASS';
  }

  if (result.elapsedMs <= MAX_ACCEPTABLE_TIME_MS) {
    return 'WARN';
  }

  return 'FAIL';
}

async function runPass(passName) {
  const results = [];
  for (const path of PATHS) {

    const result = await requestPath(path);
    results.push(result);
  }

  console.log(`\n=== ${passName} ===`);
  for (const result of results) {
    const status = classify(result);
    const tagsSummary = `og:title=${result.hasOgTitle ? 'Y' : 'N'}, og:desc=${result.hasOgDescription ? 'Y' : 'N'}, og:image=${result.hasOgImage ? 'Y' : 'N'}, published=${result.hasArticlePublished ? 'Y' : 'N'}`;
    const quality = result.degraded ? 'degraded' : 'ok';
    const error = result.error ? ` error=${result.error}` : '';

    console.log(
      `${status.padEnd(5)} ${String(result.statusCode).padEnd(3)} ${String(result.elapsedMs).padStart(4)}ms cache=${String(result.cache).padEnd(13)} age=${String(result.cacheAge).padStart(3)} ${quality} ${tagsSummary}${error}`
    );
    if (status !== 'PASS') {
      console.log(`      ${result.path}`);
      if (result.ogTitle) {
        console.log(`      title: ${result.ogTitle.slice(0, 110)}`);
      }
      if (result.ogDescription) {
        console.log(`      desc : ${result.ogDescription.slice(0, 110)}`);
      }
    }
  }

  return results;
}

function summarize(passResults, passName) {
  const counts = { PASS: 0, WARN: 0, FAIL: 0 };
  for (const result of passResults) {
    counts[classify(result)] += 1;
  }

  const avgMs = Math.round(passResults.reduce((sum, result) => sum + result.elapsedMs, 0) / passResults.length);
  const p95Ms = [...passResults].sort((a, b) => a.elapsedMs - b.elapsedMs)[Math.floor(passResults.length * 0.95) - 1] ?? avgMs;

  console.log(`\n${passName} summary: PASS=${counts.PASS}, WARN=${counts.WARN}, FAIL=${counts.FAIL}, avg=${avgMs}ms, p95=${p95Ms.elapsedMs || p95Ms}ms`);

  return counts;
}

(async function main() {
  console.log('SSR Batch Validation (Googlebot UA)');
  console.log(`Target: http://${HOST}:${PORT}`);
  console.log(`URLs: ${PATHS.length}`);

  const cold = await runPass('COLD PASS');
  const warm = await runPass('WARM PASS');

  const coldSummary = summarize(cold, 'Cold');
  const warmSummary = summarize(warm, 'Warm');

  const failed = coldSummary.FAIL + warmSummary.FAIL;
  process.exitCode = failed > 0 ? 1 : 0;
})();
