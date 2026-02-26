const https = require('https');

const paths = [
  '/e/nevent1qvzqqqqqqypzq0mhp4ja8fmy48zuk5p6uy37vtk8tx9dqdwcxm32sy8nsaa8gkeyqydhwumn8ghj7un9d3shjtnwdaehgunsd3jkyuewvdhk6tcqyz8x3mduhgzj4ur67x36ln04x4rskm3k5svy5546kvp6wzk792sc2eahrzr',
  '/e/nevent1qvzqqqqqqypzpjh9kl4rfzh7l3xpq2ahkyjufy50z9rnngnmsa7xhna7tfujsquyqythwumn8ghj7un9d3shjtnswf5k6ctv9ehx2ap0qqsqmccmvfunjuxhchhd9k0rf59369jk76dt4pw842j45s25ltt2aack354dd',
  '/e/nevent1qvzqqqqqqypzqa7w2muf6y3g7llnws7wrtgmy4y90wgqs4j8yl4atg0nzumz7m98qy88wumn8ghj7mn0wvhxcmmv9uqzqmfmpqlgq5gz9yed3gfxk2l68qqwus07s646jl0vwnc24encv6ks4duch4',
];

function extractMeta(html, tag) {
  const escaped = tag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  return new RegExp(`<meta\\s+property=\"${escaped}\"\\s+content=\"([\\s\\S]*?)\"`, 'i').exec(html)?.[1] || '';
}

function requestPath(path) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const req = https.request(
      {
        hostname: 'nostria.app',
        path,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        },
        timeout: 12000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          const title = extractMeta(body, 'og:title');
          const description = extractMeta(body, 'og:description');
          const degraded = /no description available|content not available|loading nostr event content|error loading event content|^nostr event$/i.test(
            `${title} ${description}`
          );
          resolve({
            status: res.statusCode,
            ms: Date.now() - startedAt,
            cache: res.headers['x-ssr-cache'] || 'none',
            degraded,
            title,
          });
        });
      }
    );

    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (error) => {
      resolve({ status: 0, ms: Date.now() - startedAt, cache: 'err', degraded: true, error: error.message });
    });

    req.end();
  });
}

(async () => {
  for (let round = 1; round <= 3; round++) {
    const results = [];
    for (const path of paths) {

      results.push(await requestPath(path));
    }
    console.log(
      `ROUND ${round}:`,
      results.map((result) => `${result.status} ${result.ms}ms cache=${result.cache} degraded=${result.degraded}`).join(' | ')
    );
  }
})();
