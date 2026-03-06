import express from 'express';
import cors from 'cors';
import { join } from 'node:path';
import multer from 'multer';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();

const SSR_ALLOWED_HOST_PATTERNS = [
  'nostria.app',
  'www.nostria.app',
  'beta.nostria.app',
  'nostria-beta.azurewebsites.net',
  '*.azurewebsites.net',
  '*.nostria.app',
  'localhost',
  '127.0.0.1',
];

const deploymentHosts = [
  process.env['WEBSITE_HOSTNAME'],
  process.env['HOSTNAME'],
]
  .map(host => host?.trim().toLowerCase())
  .filter((host): host is string => !!host);

const envAllowedHosts = (process.env['NG_ALLOWED_HOSTS'] ?? '')
  .split(',')
  .map(host => host.trim().toLowerCase())
  .filter(Boolean);

const angularAllowedHosts = Array.from(new Set([
  ...SSR_ALLOWED_HOST_PATTERNS,
  ...deploymentHosts,
  ...envAllowedHosts,
]));

process.env['NG_ALLOWED_HOSTS'] = angularAllowedHosts.join(',');

const {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} = await import('@angular/ssr/node');

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

const SSR_TRUSTED_HOSTS = new Set(
  angularAllowedHosts.filter(host => !host.includes('*')),
);

function extractHostnamesFromHeader(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map(host => host.trim())
    .filter(Boolean)
    .map((host) => {
      const withoutPort = host.includes(':') ? host.split(':')[0] : host;
      return withoutPort.toLowerCase();
    });
}

function normalizeAbsoluteRequestUrl(req: express.Request): { normalized: boolean; hostname?: string } {
  const requestUrl = req.url;

  if (!/^https?:\/\//i.test(requestUrl)) {
    return { normalized: false };
  }

  try {
    const parsed = new URL(requestUrl);
    const hostname = parsed.hostname.toLowerCase();

    const dynamicAllowedHosts = new Set<string>([
      ...extractHostnamesFromHeader(req.headers.host),
      ...extractHostnamesFromHeader(req.headers['x-forwarded-host'] as string | undefined),
    ]);

    const isTrustedHost = SSR_TRUSTED_HOSTS.has(hostname) || dynamicAllowedHosts.has(hostname);
    if (!isTrustedHost) {
      return { normalized: false, hostname };
    }

    const normalizedPathAndQuery = `${parsed.pathname}${parsed.search}`;
    req.url = normalizedPathAndQuery;
    const reqWithOriginalUrl = req as express.Request & { originalUrl?: string };
    if (typeof reqWithOriginalUrl.originalUrl === 'string') {
      reqWithOriginalUrl.originalUrl = normalizedPathAndQuery;
    }
    return { normalized: true, hostname };
  } catch {
    return { normalized: false };
  }
}

// ============================================
// SSR Response Cache for Bot Requests
// ============================================

interface CachedResponse {
  html: string;
  headers: Record<string, string>;
  timestamp: number;
}

interface PreviewCacheabilityAnalysis {
  isCacheable: boolean;
  reason:
  | 'ok'
  | 'no_social_tags'
  | 'generic_title'
  | 'generic_route_fallback'
  | 'generic_home'
  | 'low_quality_marker';
  ogTitle: string;
  ogDescription: string;
  twitterTitle: string;
  twitterDescription: string;
}

function setNoStoreHeaders(res: express.Response): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, max-age=0, s-maxage=0, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
}

function setPreviewDebugHeaders(
  res: express.Response,
  analysis: PreviewCacheabilityAnalysis,
  renderMs: number,
): void {
  res.setHeader('X-SSR-Preview-Quality', analysis.isCacheable ? 'healthy' : 'degraded');
  res.setHeader('X-SSR-Preview-Reason', analysis.reason);
  res.setHeader('X-SSR-Render-Ms', renderMs.toString());
}

function extractMetaContent(html: string, tag: string): string {
  const escapedTag = tag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const byProperty = new RegExp(`<meta\\s+property=["']${escapedTag}["']\\s+content=["']([\\s\\S]*?)["']`, 'i');
  const byName = new RegExp(`<meta\\s+name=["']${escapedTag}["']\\s+content=["']([\\s\\S]*?)["']`, 'i');
  return byProperty.exec(html)?.[1] || byName.exec(html)?.[1] || '';
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function upsertMetaTag(html: string, attr: 'property' | 'name', key: string, content: string): string {
  const escapedKey = key.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const escapedContent = escapeHtmlAttribute(content);

  const attrFirst = new RegExp(`(<meta\\s+${attr}=["']${escapedKey}["']\\s+content=["'])[^"']*(["'][^>]*>)`, 'i');
  if (attrFirst.test(html)) {
    return html.replace(attrFirst, `$1${escapedContent}$2`);
  }

  const contentFirst = new RegExp(`(<meta\\s+content=["'])[^"']*(["']\\s+${attr}=["']${escapedKey}["'][^>]*>)`, 'i');
  if (contentFirst.test(html)) {
    return html.replace(contentFirst, `$1${escapedContent}$2`);
  }

  return html.replace('</head>', `  <meta ${attr}="${key}" content="${escapedContent}">\n</head>`);
}

function upsertTitleTag(html: string, title: string): string {
  const escapedTitle = escapeHtmlAttribute(title);
  if (/<title>[\s\S]*?<\/title>/i.test(html)) {
    return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapedTitle}</title>`);
  }
  return html.replace('</head>', `  <title>${escapedTitle}</title>\n</head>`);
}

function buildRouteFallbackPreview(path: string): { title: string; description: string; url: string } | null {
  if (path.startsWith('/e/')) {
    return {
      title: 'Nostr Note on Nostria',
      description: 'Open this Nostr note on Nostria, the decentralized social app.',
      url: `https://nostria.app${path}`,
    };
  }

  if (path.startsWith('/a/')) {
    return {
      title: 'Nostr Article on Nostria',
      description: 'Open this Nostr article on Nostria, the decentralized social app.',
      url: `https://nostria.app${path}`,
    };
  }

  if (path.startsWith('/p/') || path.startsWith('/u/')) {
    return {
      title: 'Nostr Profile on Nostria',
      description: 'View this Nostr profile on Nostria, the decentralized social app.',
      url: `https://nostria.app${path}`,
    };
  }

  if (path.startsWith('/stream/')) {
    return {
      title: 'Nostr Live Stream on Nostria',
      description: 'Watch this live stream on Nostria, the decentralized social app.',
      url: `https://nostria.app${path}`,
    };
  }

  if (path.startsWith('/music/song/')) {
    return {
      title: 'Nostr Song on Nostria',
      description: 'Listen to this song on Nostria, the decentralized social app.',
      url: `https://nostria.app${path}`,
    };
  }

  if (path.startsWith('/music/artist/')) {
    return {
      title: 'Nostr Artist on Nostria',
      description: 'Discover this artist on Nostria, the decentralized social app.',
      url: `https://nostria.app${path}`,
    };
  }

  if (path.startsWith('/music/playlist/')) {
    return {
      title: 'Nostr Playlist on Nostria',
      description: 'Open this playlist on Nostria, the decentralized social app.',
      url: `https://nostria.app${path}`,
    };
  }

  return null;
}

function applyRouteFallbackPreviewHtml(html: string, path: string): string {
  const fallback = buildRouteFallbackPreview(path);
  if (!fallback) {
    return html;
  }

  let result = html;
  result = upsertTitleTag(result, `Nostria – ${fallback.title}`);
  result = upsertMetaTag(result, 'name', 'description', fallback.description);
  result = upsertMetaTag(result, 'property', 'og:title', fallback.title);
  result = upsertMetaTag(result, 'property', 'og:description', fallback.description);
  result = upsertMetaTag(result, 'property', 'og:image', 'https://nostria.app/assets/nostria-social.jpg');
  result = upsertMetaTag(result, 'property', 'og:url', fallback.url);
  result = upsertMetaTag(result, 'name', 'twitter:card', 'summary_large_image');
  result = upsertMetaTag(result, 'name', 'twitter:title', fallback.title);
  result = upsertMetaTag(result, 'name', 'twitter:description', fallback.description);
  result = upsertMetaTag(result, 'name', 'twitter:image', 'https://nostria.app/assets/nostria-social.jpg');
  return result;
}

function analyzeSsrPreviewHtml(html: string): PreviewCacheabilityAnalysis {
  const ogTitle = extractMetaContent(html, 'og:title').trim();
  const ogDescription = extractMetaContent(html, 'og:description').trim();
  const twitterTitle = extractMetaContent(html, 'twitter:title').trim();
  const twitterDescription = extractMetaContent(html, 'twitter:description').trim();

  const hasSocialTags = !!(ogTitle || ogDescription || twitterTitle || twitterDescription);
  if (!hasSocialTags) {
    return {
      isCacheable: false,
      reason: 'no_social_tags',
      ogTitle,
      ogDescription,
      twitterTitle,
      twitterDescription,
    };
  }

  const lowQualityMarkers = [
    'loading nostr event content',
    'content not available',
    'no description available',
    'error loading event content',
    'could not load preview',
    'loading...',
  ];

  const genericRouteFallbackTitles = [
    'nostr note on nostria',
    'nostr article on nostria',
    'nostr profile on nostria',
    'nostr post on nostria',
    'nostr song on nostria',
    'nostr playlist on nostria',
    'nostr artist on nostria',
    'nostr live stream on nostria',
  ];

  const genericRouteFallbackMarkers = [
    'open this nostr note on nostria',
    'open this nostr article on nostria',
    'view this nostr profile on nostria',
    'open this content on nostria',
    'listen to this song on nostria',
    'open this playlist on nostria',
    'discover this artist on nostria',
    'watch this live stream on nostria',
  ];

  const genericHomeTitles = ['nostria - your social network', 'nostria'];
  const genericHomeDescriptionMarkers = [
    'nostria puts control back where it belongs',
    'nostria: built for human connections',
    'nostria is social without the noise',
  ];

  const combined = `${ogTitle} ${ogDescription} ${twitterTitle} ${twitterDescription}`.toLowerCase();
  const genericTitle = ogTitle.toLowerCase() === 'nostr event' || twitterTitle.toLowerCase() === 'nostr event';
  const genericRouteFallbackPreview =
    genericRouteFallbackTitles.includes(ogTitle.toLowerCase()) ||
    genericRouteFallbackTitles.includes(twitterTitle.toLowerCase()) ||
    genericRouteFallbackMarkers.some(marker => combined.includes(marker));
  const genericHomePreview =
    genericHomeTitles.includes(ogTitle.toLowerCase()) ||
    genericHomeTitles.includes(twitterTitle.toLowerCase()) ||
    genericHomeDescriptionMarkers.some(marker => combined.includes(marker));

  if (genericTitle) {
    return {
      isCacheable: false,
      reason: 'generic_title',
      ogTitle,
      ogDescription,
      twitterTitle,
      twitterDescription,
    };
  }

  if (genericRouteFallbackPreview) {
    return {
      isCacheable: false,
      reason: 'generic_route_fallback',
      ogTitle,
      ogDescription,
      twitterTitle,
      twitterDescription,
    };
  }

  if (genericHomePreview) {
    return {
      isCacheable: false,
      reason: 'generic_home',
      ogTitle,
      ogDescription,
      twitterTitle,
      twitterDescription,
    };
  }

  if (lowQualityMarkers.some(marker => combined.includes(marker))) {
    return {
      isCacheable: false,
      reason: 'low_quality_marker',
      ogTitle,
      ogDescription,
      twitterTitle,
      twitterDescription,
    };
  }

  return {
    isCacheable: true,
    reason: 'ok',
    ogTitle,
    ogDescription,
    twitterTitle,
    twitterDescription,
  };
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
  const requestStartedAt = Date.now();
  normalizeAbsoluteRequestUrl(req);

  const userAgent = req.headers['user-agent'];
  const isBotRequest = isBot(userAgent);
  const path = req.path;
  const isSSR = isSSRRoute(path);

  // Check cache for bot requests on SSR routes
  if (isBotRequest && isSSR) {
    res.setHeader('Vary', 'User-Agent');
    const cached = ssrCache.get(path);
    if (cached && (Date.now() - cached.timestamp) < SSR_CACHE_MAX_AGE_MS) {
      const cachedAnalysis = analyzeSsrPreviewHtml(cached.html);
      setPreviewDebugHeaders(res, cachedAnalysis, Date.now() - requestStartedAt);
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

        const analysis = analyzeSsrPreviewHtml(html);
        const isCacheableHtml = analysis.isCacheable;
        const finalHtml = isCacheableHtml ? html : applyRouteFallbackPreviewHtml(html, path);
        if (isCacheableHtml) {
          // Cache healthy SSR response for bots
          ssrCache.set(path, {
            html: finalHtml,
            headers: headersToCache,
            timestamp: Date.now(),
          });
        } else {
          // Ensure degraded responses don't poison cache for retries
          ssrCache.delete(path);
        }

        // Set Cache-Control headers for bots
        if (isCacheableHtml) {
          res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400');
        } else {
          setNoStoreHeaders(res);
          res.setHeader('X-SSR-Retryable', 'true');
        }
        setPreviewDebugHeaders(res, analysis, Date.now() - requestStartedAt);
        res.setHeader('X-SSR-Cache', isCacheableHtml ? 'MISS' : 'SKIP_DEGRADED_FALLBACK');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');

        // Copy other headers from the original response
        response.headers.forEach((value, key) => {
          if (key.toLowerCase() !== 'cache-control' && key.toLowerCase() !== 'content-type') {
            res.setHeader(key, value);
          }
        });

        res.send(finalHtml);
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
      ssrCache.delete(path);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      setNoStoreHeaders(res);
      res.setHeader('Vary', 'User-Agent');
      res.setHeader('X-SSR-Preview-Quality', 'degraded');
      res.setHeader('X-SSR-Preview-Reason', 'error_fallback');
      res.setHeader('X-SSR-Render-Ms', (Date.now() - requestStartedAt).toString());
      res.setHeader('X-SSR-Cache', 'SKIP_ERROR_FALLBACK');
      res.setHeader('X-SSR-Retryable', 'true');

      const fallbackHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Nostria - Decentralized Social Network</title>
  <link rel="icon" type="image/x-icon" href="https://nostria.app/favicon.ico">
  <link rel="shortcut icon" type="image/x-icon" href="https://nostria.app/favicon.ico">
  <meta name="description" content="View this content on Nostria, your decentralized social network">
  <meta property="og:site_name" content="Nostria">
  <meta property="og:type" content="article">
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
</html>`;

      res.status(200).send(applyRouteFallbackPreviewHtml(fallbackHtml, path));
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
