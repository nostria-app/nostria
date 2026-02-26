import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import cors from 'cors';
import { join } from 'node:path';
import multer from 'multer';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

// ============================================
// Bot Detection for Social Sharing Previews
// ============================================

/**
 * List of known social media and search engine bot user agents
 * These bots fetch pages to generate link previews
 */
const BOT_USER_AGENTS = [
  // Social media crawlers
  'facebookexternalhit',
  'Facebot',
  'Twitterbot',
  'LinkedInBot',
  'WhatsApp',
  'TelegramBot',
  'Slackbot',
  'Discordbot',
  'Pinterest',
  'Embedly',
  // Search engine bots
  'Googlebot',
  'bingbot',
  'DuckDuckBot',
  'Baiduspider',
  'YandexBot',
  // Other preview generators
  'Applebot',
  'developers.google.com/+/web/snippet',
  'redditbot',
  'Quora Link Preview',
  'Rogerbot',
  'Screaming Frog',
  'vkShare',
  'W3C_Validator',
  'Iframely',
];

/**
 * Check if the request is from a known bot/crawler
 */
function isBot(userAgent: string | undefined): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return BOT_USER_AGENTS.some(bot => ua.includes(bot.toLowerCase()));
}

// ============================================
// SSR Response Cache for Bot Requests
// ============================================

interface CachedResponse {
  html: string;
  headers: Record<string, string>;
  timestamp: number;
}

function extractMetaContent(html: string, tag: string): string {
  const escapedTag = tag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const byProperty = new RegExp(`<meta\\s+property=["']${escapedTag}["']\\s+content=["']([\\s\\S]*?)["']`, 'i');
  const byName = new RegExp(`<meta\\s+name=["']${escapedTag}["']\\s+content=["']([\\s\\S]*?)["']`, 'i');
  return byProperty.exec(html)?.[1] || byName.exec(html)?.[1] || '';
}

function isCacheableSsrPreviewHtml(html: string): boolean {
  const ogTitle = extractMetaContent(html, 'og:title').trim();
  const ogDescription = extractMetaContent(html, 'og:description').trim();
  const twitterTitle = extractMetaContent(html, 'twitter:title').trim();
  const twitterDescription = extractMetaContent(html, 'twitter:description').trim();

  const hasSocialTags = !!(ogTitle || ogDescription || twitterTitle || twitterDescription);
  if (!hasSocialTags) {
    return false;
  }

  const lowQualityMarkers = [
    'loading nostr event content',
    'content not available',
    'no description available',
    'error loading event content',
    'could not load preview',
    'loading...',
  ];

  const combined = `${ogTitle} ${ogDescription} ${twitterTitle} ${twitterDescription}`.toLowerCase();
  const genericTitle = ogTitle.toLowerCase() === 'nostr event' || twitterTitle.toLowerCase() === 'nostr event';
  return !genericTitle && !lowQualityMarkers.some(marker => combined.includes(marker));
}

// Cache for SSR responses (keyed by URL path)
const ssrCache = new Map<string, CachedResponse>();

// Cache configuration
const SSR_CACHE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes for cache entries
const SSR_CACHE_MAX_ENTRIES = 1000; // Maximum number of cached entries
const SSR_CACHE_CLEANUP_INTERVAL_MS = 60 * 1000; // Cleanup every minute

// SSR-able route patterns (routes that should be server-rendered)
const SSR_ROUTE_PATTERNS = [
  /^\/e\/.+/,      // Event pages
  /^\/p\/.+/,      // Profile pages
  /^\/u\/.+/,      // Username pages
  /^\/a\/.+/,      // Article pages
  /^\/stream\/.+/, // Stream pages
  /^\/music\/artist\/.+/, // Music artist pages
  /^\/music\/song\/.+/,   // Music song pages
  /^\/music\/playlist\/.+/, // Music playlist pages
];

/**
 * Check if a URL path should be server-rendered
 */
function isSSRRoute(path: string): boolean {
  return SSR_ROUTE_PATTERNS.some(pattern => pattern.test(path));
}

/**
 * Cleanup expired cache entries
 */
function cleanupSSRCache(): void {
  const now = Date.now();
  let removed = 0;

  for (const [key, value] of ssrCache.entries()) {
    if (now - value.timestamp > SSR_CACHE_MAX_AGE_MS) {
      ssrCache.delete(key);
      removed++;
    }
  }

  // If still over limit, remove oldest entries
  if (ssrCache.size > SSR_CACHE_MAX_ENTRIES) {
    const entries = Array.from(ssrCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    const toRemove = entries.slice(0, ssrCache.size - SSR_CACHE_MAX_ENTRIES);
    for (const [key] of toRemove) {
      ssrCache.delete(key);
      removed++;
    }
  }

  if (removed > 0) {
    console.log(`[SSR Cache] Cleaned up ${removed} expired entries. Current size: ${ssrCache.size}`);
  }
}

// Start cache cleanup interval
setInterval(cleanupSSRCache, SSR_CACHE_CLEANUP_INTERVAL_MS);

// Configure multer for handling multipart/form-data (file uploads)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

/**
 * Configure CORS to allow web clients to make API requests
 */
app.use(
  cors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  })
);

// In-memory storage for shared files (with expiration)
const sharedFilesCache = new Map<string, { files: { name: string; type: string; data: string }[]; title?: string; text?: string; url?: string; timestamp: number }>();

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  const expiry = 5 * 60 * 1000; // 5 minutes
  for (const [key, value] of sharedFilesCache.entries()) {
    if (now - value.timestamp > expiry) {
      sharedFilesCache.delete(key);
    }
  }
}, 60 * 1000);

/**
 * Web Share Target API - Handle POST requests with shared files/data
 * This handles the case where the service worker doesn't intercept the POST
 */
app.post('/share-target', upload.array('media', 10), (req, res) => {
  try {
    const id = Date.now().toString();
    const files = req.files as Express.Multer.File[] | undefined;

    // Store the data in memory cache
    const cacheEntry = {
      title: req.body?.title || '',
      text: req.body?.text || '',
      url: req.body?.url || '',
      files: files?.map(f => ({
        name: f.originalname,
        type: f.mimetype,
        data: f.buffer.toString('base64')
      })) || [],
      timestamp: Date.now()
    };

    sharedFilesCache.set(id, cacheEntry);

    // Redirect to the share-target page with the ID
    res.redirect(303, `/share-target?id=${id}`);
  } catch (error) {
    console.error('[Share Target] Error:', error);
    res.redirect(303, '/');
  }
});

/**
 * Web Share Target API - Get cached shared data
 */
app.get('/api/share-target/:id', (req, res) => {
  const id = req.params.id;
  const data = sharedFilesCache.get(id);

  if (!data) {
    res.status(404).json({ error: 'Not found or expired' });
    return;
  }

  // Return the data and optionally delete it
  res.json(data);

  // Delete after retrieval (one-time use)
  sharedFilesCache.delete(id);
});

/**
 * NIP-05 Nostr identifier endpoint
 * Handles requests to /.well-known/nostr.json?name=<username>
 */
app.get('/.well-known/nostr.json', async (req, res) => {
  // Set CORS headers as required by NIP-05 specification
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const username = req.query['name'] as string;

  if (!username) {
    return res.status(400).json({
      error: 'name parameter is required',
    });
  }

  // Handle hard-coded values
  const hardCodedUsers: Record<string, string> = {
    support: 'd884f41487d7e4b596a2fc5b064fe211632fc9c4459a238539729ff1b06d7fc7',
    premium: '54f4adbd1d2b1b25b0cb690fbea35d2e0a62f38e77ca0fcd2907fb22f4a7fdbb',
    curator: '929dd94e6cc8a6665665a1e1fc043952c014c16c1735578e3436cd4510b1e829',
    payment: '3e5b8d197f4a9279278fd61d9d033058e13d62f6652e3f868dcab54fac8c9658',
    _: 'd1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b',
  };

  if (hardCodedUsers[username]) {
    return res.json({
      names: {
        [username]: hardCodedUsers[username],
      },
    });
  }

  try {
    // Call the Nostria API to get user data
    const apiResponse = await fetch(`https://api.nostria.app/api/account/${username}`);

    if (!apiResponse.ok) {
      if (apiResponse.status === 404) {
        return res.status(404).json({});
      }

      throw new Error(`API request failed with status ${apiResponse.status}`);
    }

    const userData = await apiResponse.json();

    if (!userData.success || !userData.result) {
      return res.status(404).json({});
    }

    const { pubkey } = userData.result;

    if (!pubkey) {
      return res.status(404).json({});
    }

    // Return NIP-05 compliant response
    return res.json({
      names: {
        [username]: pubkey,
      },
    });
  } catch (error) {
    console.error('Error handling NIP-05 request:', error);
    return res.status(500).json({
      error: 'Internal server error',
    });
  }
});

app.use(
  '/.well-known',
  express.static(join(browserDistFolder, '.well-known'), {
    dotfiles: 'allow',
  })
);

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  })
);

/**
 * Handle all other requests by rendering the Angular application.
 * For bot requests, responses are cached to improve performance.
 */
app.use(async (req, res, next) => {
  const userAgent = req.headers['user-agent'];
  const isBotRequest = isBot(userAgent);
  const path = req.path;
  const isSSR = isSSRRoute(path);

  // Check cache for bot requests on SSR routes
  if (isBotRequest && isSSR) {
    const cached = ssrCache.get(path);
    if (cached && (Date.now() - cached.timestamp) < SSR_CACHE_MAX_AGE_MS) {
      // Set cached headers
      for (const [key, value] of Object.entries(cached.headers)) {
        res.setHeader(key, value);
      }

      // Add cache status header
      res.setHeader('X-SSR-Cache', 'HIT');
      res.setHeader('X-SSR-Cache-Age', Math.floor((Date.now() - cached.timestamp) / 1000).toString());

      res.send(cached.html);
      return;
    }
  }

  try {
    const response = await angularApp.handle(req);

    if (response) {
      // For bot requests on SSR routes, cache the response
      if (isBotRequest && isSSR) {
        // Read the response body
        const html = await response.text();

        // Prepare headers for caching (convert Headers to object)
        const headersToCache: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headersToCache[key] = value;
        });

        const isCacheableHtml = isCacheableSsrPreviewHtml(html);
        if (isCacheableHtml) {
          // Cache healthy SSR response for bots
          ssrCache.set(path, {
            html,
            headers: headersToCache,
            timestamp: Date.now(),
          });
        } else {
          // Ensure degraded responses don't poison cache for retries
          ssrCache.delete(path);
          console.warn(`[SSR Cache] Skipping cache for degraded preview on ${path}`);
        }

        // Set Cache-Control headers for bots
        res.setHeader(
          'Cache-Control',
          isCacheableHtml
            ? 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400'
            : 'no-store, max-age=0'
        );
        res.setHeader('X-SSR-Cache', isCacheableHtml ? 'MISS' : 'SKIP_DEGRADED');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');

        // Copy other headers from the original response
        response.headers.forEach((value, key) => {
          if (key.toLowerCase() !== 'cache-control' && key.toLowerCase() !== 'content-type') {
            res.setHeader(key, value);
          }
        });

        res.send(html);
        return;
      }

      // For non-bot requests, set shorter cache time
      if (isSSR) {
        res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=3600');
      }

      return writeResponseToNodeResponse(response, res);
    }
    return next();
  } catch (err) {
    console.error(`[SSR] Error rendering ${req.url}:`, err);

    // For bot requests, try to serve a basic fallback with meta tags
    if (isBotRequest && isSSR) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.status(200).send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Nostria - Decentralized Social Network</title>
  <link rel="icon" type="image/x-icon" href="https://nostria.app/favicon.ico">
  <link rel="shortcut icon" type="image/x-icon" href="https://nostria.app/favicon.ico">
  <meta name="description" content="View this content on Nostria, your decentralized social network">
  <meta property="og:site_name" content="Nostria">
  <meta property="og:title" content="Nostria - Decentralized Social Network">
  <meta property="og:description" content="View this content on Nostria, your decentralized social network">
  <meta property="og:image" content="https://nostria.app/assets/nostria-social.jpg">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Nostria - Decentralized Social Network">
  <meta name="twitter:description" content="View this content on Nostria, your decentralized social network">
  <meta name="twitter:image" content="https://nostria.app/assets/nostria-social.jpg">
</head>
<body>
  <h1>Loading...</h1>
  <script>window.location.reload();</script>
</body>
</html>`);
      return;
    }

    next(err);
  }
});

// Global error handler for uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('[SSR] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[SSR] Unhandled Rejection at:', promise, 'reason:', reason);
});

/**
 * Start the server if this module is the main entry point.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error: Error | undefined) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build).
 */
export const reqHandler = createNodeRequestHandler(app);
