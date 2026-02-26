/**
 * SSR Meta Tag Inspector
 * 
 * A simple script to test if meta tags are being properly rendered server-side
 * 
 * Usage:
 *   node inspect-ssr.js <path>
 *   node inspect-ssr.js /e/nevent1...
 *   node inspect-ssr.js /e/nevent1... --bot discord
 *   node inspect-ssr.js /e/nevent1... --bot twitter
 *   node inspect-ssr.js /e/nevent1... --bot googlebot
 * 
 * Bot options:
 *   --bot discord   - Simulate Discord's crawler (Discordbot)
 *   --bot twitter   - Simulate Twitter's crawler (Twitterbot)
 *   --bot facebook  - Simulate Facebook's crawler (facebookexternalhit)
 *   --bot telegram  - Simulate Telegram's crawler (TelegramBot)
 *   --bot slack     - Simulate Slack's crawler (Slackbot)
 *   --bot googlebot - Simulate Google's crawler (Googlebot) [default]
 */

const http = require('http');

// Bot user agent strings
const BOT_USER_AGENTS = {
  discord: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  twitter: 'Twitterbot/1.0',
  facebook: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  telegram: 'TelegramBot (like TwitterBot)',
  slack: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  linkedin: 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
  whatsapp: 'WhatsApp/2.0',
};

// Parse command line arguments
const args = process.argv.slice(2);
let path = null;
let botType = 'googlebot'; // Default bot

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--bot' && args[i + 1]) {
    botType = args[i + 1].toLowerCase();
    i++; // Skip next arg
  } else if (!args[i].startsWith('--')) {
    path = args[i];
  }
}

if (!path) {
  console.error('Usage: node inspect-ssr.js <path> [--bot <type>]');
  console.error('Example: node inspect-ssr.js /e/nevent1...');
  console.error('         node inspect-ssr.js /e/nevent1... --bot discord');
  console.error('         node inspect-ssr.js /e/nevent1... --bot twitter');
  console.error('\nAvailable bots:', Object.keys(BOT_USER_AGENTS).join(', '));
  process.exit(1);
}

const userAgent = BOT_USER_AGENTS[botType];
if (!userAgent) {
  console.error(`Unknown bot type: ${botType}`);
  console.error('Available bots:', Object.keys(BOT_USER_AGENTS).join(', '));
  process.exit(1);
}

const options = {
  hostname: 'localhost',
  port: 4000,
  path: path,
  method: 'GET',
  headers: {
    'User-Agent': userAgent
  }
};

console.log('\n========================================');
console.log('SSR Meta Tag Inspector');
console.log('========================================\n');
console.log(`Testing: http://${options.hostname}:${options.port}${path}`);
console.log(`Bot type: ${botType}`);
console.log(`User-Agent: ${userAgent}\n`);

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);

    // Show cache-related headers
    const cacheHeaders = {
      'X-SSR-Cache': res.headers['x-ssr-cache'],
      'X-SSR-Cache-Age': res.headers['x-ssr-cache-age'],
      'Cache-Control': res.headers['cache-control'],
    };

    console.log('\nResponse Headers:');
    console.log('=================\n');
    for (const [header, value] of Object.entries(cacheHeaders)) {
      if (value) {
        console.log(`  ${header}: ${value}`);
      }
    }
    console.log('');

    // Extract and display meta tags
    // Note: Using [\s\S]*? instead of .*? to match content that may contain newlines
    const metaTags = {
      title: /<title>([\s\S]*?)<\/title>/i.exec(data)?.[1],
      favicon: /<link rel="icon"[^>]*href="([\s\S]*?)"/i.exec(data)?.[1],
      'shortcut icon': /<link rel="shortcut icon"[^>]*href="([\s\S]*?)"/i.exec(data)?.[1],
      'og:site_name': /<meta property="og:site_name" content="([\s\S]*?)"/.exec(data)?.[1],
      'og:title': /<meta property="og:title" content="([\s\S]*?)"/.exec(data)?.[1],
      'og:description': /<meta property="og:description" content="([\s\S]*?)"/.exec(data)?.[1],
      'og:image': /<meta property="og:image" content="([\s\S]*?)"/.exec(data)?.[1],
      'og:url': /<meta property="og:url" content="([\s\S]*?)"/.exec(data)?.[1],
      'article:published_time': /<meta property="article:published_time" content="([\s\S]*?)"/.exec(data)?.[1],
      'article:modified_time': /<meta property="article:modified_time" content="([\s\S]*?)"/.exec(data)?.[1],
      'twitter:card': /<meta name="twitter:card" content="([\s\S]*?)"/.exec(data)?.[1],
      'twitter:title': /<meta name="twitter:title" content="([\s\S]*?)"/.exec(data)?.[1],
      'twitter:description': /<meta name="twitter:description" content="([\s\S]*?)"/.exec(data)?.[1],
      'twitter:image': /<meta name="twitter:image" content="([\s\S]*?)"/.exec(data)?.[1],
      'twitter:label1': /<meta name="twitter:label1" content="([\s\S]*?)"/.exec(data)?.[1],
      'twitter:data1': /<meta name="twitter:data1" content="([\s\S]*?)"/.exec(data)?.[1],
    };

    console.log('Meta Tags Found:');
    console.log('================\n');

    let foundCount = 0;
    let missingCount = 0;
    let hasDescription = false;

    for (const [tag, value] of Object.entries(metaTags)) {
      if (value) {
        // Truncate long values for display
        const displayValue = value.length > 100 ? value.substring(0, 100) + '...' : value;
        console.log(`✓ ${tag}:`);
        console.log(`  ${displayValue}\n`);
        foundCount++;
        if (tag.includes('description') && value && value !== 'Loading Nostr event content...') {
          hasDescription = true;
        }
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

      // Try to parse and show content preview
      try {
        const decoded = JSON.parse(decodeURIComponent(transferState));
        const eventData = decoded['large-json-data'];
        if (eventData?.event?.content) {
          const contentPreview = eventData.event.content.substring(0, 150);
          console.log('  Content preview:');
          console.log(`  "${contentPreview}${eventData.event.content.length > 150 ? '...' : ''}"\n`);
        }
      } catch (e) {
        // Ignore parse errors
      }
    } else {
      console.log('✗ Not found or empty\n');
    }

    console.log('========================================');
    console.log('Summary');
    console.log('========================================\n');
    console.log(`Found: ${foundCount} tags`);
    console.log(`Missing: ${missingCount} tags`);
    console.log(`Has real description: ${hasDescription ? 'YES' : 'NO'}\n`);

    if (foundCount >= 7 && hasDescription) {
      console.log('✓ SSR appears to be working correctly!\n');
    } else if (foundCount >= 7) {
      console.log('⚠ Tags found but description may be missing/default.\n');
      console.log('This could indicate:');
      console.log('- Metadata API timeout (4s)');
      console.log('- Event not found on relays');
      console.log('- Missing relay hints in the nevent/naddr\n');
    } else if (foundCount > 0) {
      console.log('⚠ SSR is partially working, but some tags are missing.\n');
    } else {
      console.log('✗ SSR may not be working. Check server logs.\n');
    }

    // Bot-specific tips
    console.log('Bot-Specific Notes:');
    console.log('===================\n');

    if (botType === 'discord') {
      console.log('Discord embeds use og:title, og:description, og:image');
      console.log('Discord has a strict timeout - make sure SSR responds quickly');
      console.log('Test your URL: https://discord.com/developers/docs/resources/message#embed-object\n');
    } else if (botType === 'twitter') {
      console.log('Twitter uses twitter:* tags (falls back to og:*)');
      console.log('Twitter Card Validator: https://cards-dev.twitter.com/validator');
      console.log('Note: Validator requires deployed URL, not localhost\n');
    } else if (botType === 'facebook') {
      console.log('Facebook uses og:* tags primarily');
      console.log('Facebook Debugger: https://developers.facebook.com/tools/debug/');
      console.log('Note: Debugger requires deployed URL, not localhost\n');
    } else if (botType === 'telegram') {
      console.log('Telegram uses og:title, og:description, og:image');
      console.log('Send URL to @WebpageBot to test previews\n');
    }

    console.log('Debugging Tips:');
    console.log('===============\n');
    console.log('1. Check server console for [SSR] and [DataResolver] logs');
    console.log('2. Verify the route has a resolver configured');
    console.log('3. Check that the metadata API is accessible');
    console.log('4. If content is empty, check if relay hints are in the nevent/naddr');
    console.log('5. Test with: npm run serve:ssr\n');
  });
});

req.on('error', (e) => {
  console.error(`\n✗ Error: ${e.message}\n`);
  console.log('Make sure the SSR server is running:');
  console.log('  npm run build');
  console.log('  node dist/app/server/server.mjs\n');
});

req.end();
