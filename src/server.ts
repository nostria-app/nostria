import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import cors from 'cors';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

/**
 * Configure CORS to allow web clients to make API requests
 */
app.use(
  cors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  }),
);

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
  }),
);

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
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
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
