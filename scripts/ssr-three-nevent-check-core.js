function extractMeta(html, tag) {
  const escaped = tag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  return new RegExp(`<meta\\s+property=\"${escaped}\"\\s+content=\"([\\s\\S]*?)\"`, 'i').exec(html)?.[1] || '';
}

function requestPath(transport, options, path) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const req = transport.request(
      {
        hostname: options.hostname,
        port: options.port,
        path,
        method: 'GET',
        headers: {
          'User-Agent': options.userAgent,
        },
        timeout: options.timeoutMs,
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

async function runNeventCheck({ transport, options, paths, rounds }) {
  for (let round = 1; round <= rounds; round++) {
    const results = [];
    for (const path of paths) {

      results.push(await requestPath(transport, options, path));
    }

    console.log(
      `ROUND ${round}:`,
      results.map((result) => `${result.status} ${result.ms}ms cache=${result.cache} degraded=${result.degraded}`).join(' | ')
    );
  }
}

module.exports = {
  runNeventCheck,
};
