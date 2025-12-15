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
  console.log('[Share Target] POST received');
  console.log('[Share Target] Body:', req.body);
  console.log('[Share Target] Files:', req.files ? (req.files as Express.Multer.File[]).map(f => ({ name: f.originalname, type: f.mimetype, size: f.size })) : 'none');

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
    console.log('[Share Target] Cached with ID:', id, 'Files count:', cacheEntry.files.length);

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
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then(response => {
      if (response) {
        console.log(`[SSR] Rendered: ${req.url}`);
        return writeResponseToNodeResponse(response, res);
      }
      return next();
    })
    .catch(err => {
      console.error(`[SSR] Error:`, err.message);
      next(err);
    });
});/**
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
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
