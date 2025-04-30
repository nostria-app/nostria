import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/**', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */

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
app.use('/**', (req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);


// import {
//   AngularNodeAppEngine,
//   createNodeRequestHandler,
//   isMainModule,
//   writeResponseToNodeResponse,
// } from '@angular/ssr/node';
// import express from 'express';
// import { dirname, resolve } from 'node:path';
// import { fileURLToPath } from 'node:url';

// const serverDistFolder = dirname(fileURLToPath(import.meta.url));
// const browserDistFolder = resolve(serverDistFolder, '../browser');

// const app = express();
// const angularApp = new AngularNodeAppEngine();

// /**
//  * Function to modify meta tags based on URL path
//  */
// const modifyMetaTags = (html: string, path: string): string => {
//   console.log(`Modifying meta tags for path: ${path}`);

//   // Skip modification if not /p/ or /e/ path
//   // if (!path.startsWith('/p/') && !path.startsWith('/e/')) {
//   //   console.log('Path does not match /p/ or /e/, skipping meta tag modification');
//   //   return html;
//   // }

//   // Default replacement content
//   let title = 'Nostria';
//   let description = 'Making the Nostr protocol accessible to everyone';
//   let image = 'https://nostria.com/assets/default-image.jpg';

//   // Path-specific meta content
//   if (path.startsWith('/p/')) {
//     // Extract the ID from the path for profile pages
//     const profileId = path.substring(3); // Remove '/p/'
//     console.log('Applying profile page meta tags', { profileId });
//     title = `Nostria - Profile ${profileId}`;
//     description = `View this Nostr profile on Nostria`;
//     image = 'https://nostria.com/icons/icon-384x384.png';
//   } else if (path.startsWith('/e/')) {
//     // Extract the ID from the path for event pages
//     const eventId = path.substring(3); // Remove '/e/'
//     console.log('Applying event page meta tags', { eventId });
//     title = `Nostria - Event`;
//     description = `View this Nostr event on Nostria`;
//     image = 'https://nostria.com/icons/icon-384x384.png';
//   }

//   // Replace title tag
//   const originalHtml = html;
//   html = html.replace(/<title>.*?<\/title>/i, `<title>${title}</title>`);
//   const titleReplaced = html !== originalHtml;
//   console.log(`Title tag ${titleReplaced ? 'replaced' : 'not found'}`);

//   // Replace or add meta description
//   const originalHtml2 = html;
//   html = html.replace(
//     /<meta name="description".*?>/i,
//     `<meta name="description" content="${description}">`
//   );
//   const descriptionReplaced = html !== originalHtml2;
//   console.log(`Description meta tag ${descriptionReplaced ? 'replaced' : 'not found'}`);

//   // If meta description doesn't exist, add it after the title
//   if (!html.includes('<meta name="description"')) {
//     console.log('Adding missing description meta tag');
//     html = html.replace('</title>', `</title>\n  <meta name="description" content="${description}">`);
//   }

//   // Replace or add Open Graph and Twitter meta tags
//   const ogTags = [
//     `<meta property="og:title" content="${title}">`,
//     `<meta property="og:description" content="${description}">`,
//     `<meta property="og:image" content="${image}">`,
//     `<meta name="twitter:title" content="${title}">`,
//     `<meta name="twitter:description" content="${description}">`,
//     `<meta name="twitter:image" content="${image}">`
//   ].join('\n  ');

//   // Try to find where meta tags are and insert our tags
//   const headEndPos = html.indexOf('</head>');
//   if (headEndPos !== -1) {
//     console.log('Inserting social media meta tags');
//     html = html.slice(0, headEndPos) + '\n  ' + ogTags + '\n  ' + html.slice(headEndPos);
//   } else {
//     console.error('Could not find </head> tag in HTML response');
//   }

//   return html;
// };

// /**
//  * Example Express Rest API endpoints can be defined here.
//  * Uncomment and define endpoints as necessary.
//  *
//  * Example:
//  * ```ts
//  * app.get('/api/**', (req, res) => {
//  *   // Handle API request
//  * });
//  * ```
//  */

// /**
//  * Serve static files from /browser
//  */
// app.use(
//   express.static(browserDistFolder, {
//     maxAge: '1y',
//     index: false,
//     redirect: false,
//   }),
// );

// /**
//  * Handle all other requests by rendering the Angular application.
//  */
// app.use('/**', (req, res, next) => {
//   angularApp
//     .handle(req)
//     .then((response) => {
//       if (response) {
//         const fullPath = req.originalUrl || req.url;

//         // Check if the path starts with /p/ or /e/
//         if (response.body && (fullPath.startsWith('/p/') || fullPath.startsWith('/e/'))) {
//           const body = response.body.toString();
//           console.log(`Original response size: ${body.length} bytes`);

//           // Modify meta tags using fullPath
//           const modifiedBody = modifyMetaTags(body, fullPath);
//           console.log(`Modified response size: ${modifiedBody.length} bytes`);

//           const modifiedResponse = new Response(modifiedBody, {
//             status: response.status,
//             statusText: response.statusText,
//             headers: response.headers
//           });
//           console.log(`Modified response created successfully`);
//           console.log(`Request for ${fullPath} processed in with meta tag modifications`);
//           return writeResponseToNodeResponse(modifiedResponse, res);
//         }

//         return writeResponseToNodeResponse(response, res)
//       } else {
//         return next();
//       }
//     })
//     .catch(next);
// });

// /**
//  * Start the server if this module is the main entry point.
//  * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
//  */
// if (isMainModule(import.meta.url)) {
//   const port = process.env['PORT'] || 4000;
//   app.listen(port, () => {
//     console.log(`Node Express server listening on http://localhost:${port}`);
//   });
// }

// /**
//  * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
//  */
// export const reqHandler = createNodeRequestHandler(app);




// import {
//   AngularNodeAppEngine,
//   createNodeRequestHandler,
//   isMainModule,
//   writeResponseToNodeResponse,
// } from '@angular/ssr/node';
// import express from 'express';
// import { dirname, resolve } from 'node:path';
// import { fileURLToPath } from 'node:url';

// const serverDistFolder = dirname(fileURLToPath(import.meta.url));
// const browserDistFolder = resolve(serverDistFolder, '../browser');

// // Simple debug logger
// const debug = {
//   enabled: process.env['DEBUG_MODE'] === 'true' || process.env['NODE_ENV'] === 'development',
//   log: (message: string, ...args: any[]) => {
//     // if (debug.enabled) {
//     console.log(`[DEBUG] ${message}`, ...args);
//     // }
//   },
//   error: (message: string, error?: any) => {
//     if (debug.enabled) {
//       console.error(`[ERROR] ${message}`, error || '');
//     }
//   }
// };

// debug.log('Server starting with configuration:', {
//   serverDistFolder,
//   browserDistFolder,
//   debugEnabled: debug.enabled,
//   nodeEnv: process.env['NODE_ENV']
// });

// const app = express();
// const angularApp = new AngularNodeAppEngine();

// /**
//  * Example Express Rest API endpoints can be defined here.
//  * Uncomment and define endpoints as necessary.
//  *
//  * Example:
//  * ```ts
//  * app.get('/api/**', (req, res) => {
//  *   // Handle API request
//  * });
//  * ```
//  */


// /**
//  * Function to modify meta tags based on URL path
//  */
// const modifyMetaTags = (html: string, path: string): string => {
//   debug.log(`Modifying meta tags for path: ${path}`);

//   // Skip modification if not /p/ or /e/ path
//   if (!path.startsWith('/p/') && !path.startsWith('/e/')) {
//     debug.log('Path does not match /p/ or /e/, skipping meta tag modification');
//     return html;
//   }

//   // Default replacement content
//   let title = 'Nostria';
//   let description = 'Making the Nostr protocol accessible to everyone';
//   let image = 'https://nostria.com/assets/default-image.jpg';

//   // Path-specific meta content
//   if (path.startsWith('/p/')) {
//     // Extract the ID from the path for profile pages
//     const profileId = path.substring(3); // Remove '/p/'
//     debug.log('Applying profile page meta tags', { profileId });
//     title = `Nostria - Profile ${profileId}`;
//     description = `View this Nostr profile on Nostria`;
//     image = 'https://nostria.com/icons/icon-384x384.png';
//   } else if (path.startsWith('/e/')) {
//     // Extract the ID from the path for event pages
//     const eventId = path.substring(3); // Remove '/e/'
//     debug.log('Applying event page meta tags', { eventId });
//     title = `Nostria - Event`;
//     description = `View this Nostr event on Nostria`;
//     image = 'https://nostria.com/icons/icon-384x384.png';
//   }

//   // Replace title tag
//   const originalHtml = html;
//   html = html.replace(/<title>.*?<\/title>/i, `<title>${title}</title>`);
//   const titleReplaced = html !== originalHtml;
//   debug.log(`Title tag ${titleReplaced ? 'replaced' : 'not found'}`);

//   // Replace or add meta description
//   const originalHtml2 = html;
//   html = html.replace(
//     /<meta name="description".*?>/i,
//     `<meta name="description" content="${description}">`
//   );
//   const descriptionReplaced = html !== originalHtml2;
//   debug.log(`Description meta tag ${descriptionReplaced ? 'replaced' : 'not found'}`);

//   // If meta description doesn't exist, add it after the title
//   if (!html.includes('<meta name="description"')) {
//     debug.log('Adding missing description meta tag');
//     html = html.replace('</title>', `</title>\n  <meta name="description" content="${description}">`);
//   }

//   // Replace or add Open Graph and Twitter meta tags
//   const ogTags = [
//     `<meta property="og:title" content="${title}">`,
//     `<meta property="og:description" content="${description}">`,
//     `<meta property="og:image" content="${image}">`,
//     `<meta name="twitter:title" content="${title}">`,
//     `<meta name="twitter:description" content="${description}">`,
//     `<meta name="twitter:image" content="${image}">`
//   ].join('\n  ');

//   // Try to find where meta tags are and insert our tags
//   const headEndPos = html.indexOf('</head>');
//   if (headEndPos !== -1) {
//     debug.log('Inserting social media meta tags');
//     html = html.slice(0, headEndPos) + '\n  ' + ogTags + '\n  ' + html.slice(headEndPos);
//   } else {
//     debug.error('Could not find </head> tag in HTML response');
//   }

//   return html;
// };

// /**
//  * Serve static files from /browser
//  */
// app.use(
//   express.static(browserDistFolder, {
//     maxAge: '1y',
//     index: false,
//     redirect: false,
//   }),
// );
// /**
//  * Handle all other requests by rendering the Angular application.
//  */
// app.use('/**', (req, res, next) => {
//   const startTime = Date.now();

//   debug.log('baseUrl:' + req.baseUrl);
//   debug.log('route:' + req.route);
//   debug.log('originalUrl:' + req.originalUrl);
//   debug.log('path:' + req.path);
//   debug.log('url:' + req.url);
//   // Get the full URL path
//   const fullPath = req.originalUrl || req.url;
//   debug.log(`Handling request: ${req.method} ${fullPath}`);

//   angularApp
//     .handle(req)
//     .then((response) => {
//       if (response) {

//         debug.log(`Response received from Angular app for ${fullPath} (status: ${response.status})`);

//         // Use fullPath instead of req.path
//         if (response.body && (fullPath.startsWith('/p/') || fullPath.startsWith('/e/'))) {
//           debug.log(`Modifying meta tags for special path: ${fullPath}`);
//           try {
//             // Convert response body to string
//             const body = response.body.toString();
//             debug.log(`Original response size: ${body.length} bytes`);

//             // Modify meta tags using fullPath
//             const modifiedBody = modifyMetaTags(body, fullPath);
//             debug.log(`Modified response size: ${modifiedBody.length} bytes`);

//             // Create new response with modified body as a proper Response object
//             const modifiedResponse = new Response(modifiedBody, {
//               status: response.status,
//               statusText: response.statusText,
//               headers: response.headers
//             });
//             debug.log(`Modified response created successfully`);

//             const processingTime = Date.now() - startTime;
//             debug.log(`Request for ${fullPath} processed in ${processingTime}ms with meta tag modifications`);
//             return writeResponseToNodeResponse(modifiedResponse, res);
//           } catch (err) {
//             debug.error(`Error modifying meta tags for ${fullPath}`, err);
//             return writeResponseToNodeResponse(response, res);
//           }
//         } else {
//           debug.log(`No meta tag modifications needed for ${fullPath}`);
//         }

//         const processingTime = Date.now() - startTime;
//         debug.log(`Request for ${fullPath} processed in ${processingTime}ms`);
//         return writeResponseToNodeResponse(response, res);
//       } else {
//         debug.log(`No response from Angular app for ${fullPath}, calling next()`);
//         return next();
//       }
//     })
//     .catch((err) => {
//       debug.error(`Error handling request for ${fullPath}`, err);
//       next(err);
//     });
// });

// /**
//  * Start the server if this module is the main entry point.
//  * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
//  */
// if (isMainModule(import.meta.url)) {
//   const port = process.env['PORT'] || 4000;
//   app.listen(port, () => {
//     console.log(`Node Express server listening on http://localhost:${port}`);
//   });
// }

// /**
//  * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
//  */
// export const reqHandler = createNodeRequestHandler(app);
