/**
 * SSR Meta Tag Inspector
 * 
 * A simple script to test if meta tags are being properly rendered server-side
 * 
 * Usage:
 *   node inspect-ssr.js <path>
 *   node inspect-ssr.js /e/nevent1...
 */

const http = require('http');

const path = process.argv[2];
if (!path) {
  console.error('Usage: node inspect-ssr.js <path>');
  console.error('Example: node inspect-ssr.js /e/nevent1...');
  process.exit(1);
}

const options = {
  hostname: 'localhost',
  port: 4000,
  path: path,
  method: 'GET',
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
  }
};

console.log('\n========================================');
console.log('SSR Meta Tag Inspector');
console.log('========================================\n');
console.log(`Testing: http://${options.hostname}:${options.port}${path}\n`);

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log(`Status: ${res.statusCode}\n`);

    // Extract and display meta tags
    const metaTags = {
      title: /<title>(.*?)<\/title>/i.exec(data)?.[1],
      'og:title': /<meta property="og:title" content="(.*?)"/.exec(data)?.[1],
      'og:description': /<meta property="og:description" content="(.*?)"/.exec(data)?.[1],
      'og:image': /<meta property="og:image" content="(.*?)"/.exec(data)?.[1],
      'og:url': /<meta property="og:url" content="(.*?)"/.exec(data)?.[1],
      'twitter:card': /<meta name="twitter:card" content="(.*?)"/.exec(data)?.[1],
      'twitter:title': /<meta name="twitter:title" content="(.*?)"/.exec(data)?.[1],
      'twitter:description': /<meta name="twitter:description" content="(.*?)"/.exec(data)?.[1],
      'twitter:image': /<meta name="twitter:image" content="(.*?)"/.exec(data)?.[1],
    };

    console.log('Meta Tags Found:');
    console.log('================\n');

    let foundCount = 0;
    let missingCount = 0;

    for (const [tag, value] of Object.entries(metaTags)) {
      if (value) {
        console.log(`✓ ${tag}:`);
        console.log(`  ${value}\n`);
        foundCount++;
      } else {
        console.log(`✗ ${tag}: NOT FOUND\n`);
        missingCount++;
      }
    }

    // Check transfer state
    const transferState = /<script[^>]*id="transfer-state"[^>]*>(.*?)<\/script>/i.exec(data)?.[1];
    console.log('Transfer State:');
    console.log('===============\n');
    if (transferState && transferState.length > 0) {
      console.log(`✓ Found (${transferState.length} bytes)\n`);
    } else {
      console.log('✗ Not found or empty\n');
    }

    console.log('========================================');
    console.log('Summary');
    console.log('========================================\n');
    console.log(`Found: ${foundCount} tags`);
    console.log(`Missing: ${missingCount} tags\n`);

    if (foundCount >= 7) {
      console.log('✓ SSR appears to be working correctly!\n');
    } else if (foundCount > 0) {
      console.log('⚠ SSR is partially working, but some tags are missing.\n');
    } else {
      console.log('✗ SSR may not be working. Check server logs.\n');
    }

    console.log('Debugging Tips:');
    console.log('===============\n');
    console.log('1. Check server console for [SSR] and [DataResolver] logs');
    console.log('2. Verify the route has a resolver configured');
    console.log('3. Check that the metadata API is accessible');
    console.log('4. Test with: npm run serve:ssr\n');
  });
});

req.on('error', (e) => {
  console.error(`\n✗ Error: ${e.message}\n`);
  console.log('Make sure the SSR server is running:');
  console.log('  npm run build');
  console.log('  node dist/app/server/server.mjs\n');
});

req.end();
