// Custom service worker that wraps Angular's ngsw-worker.js
// Handles share-target POST requests and push notifications

// Register fetch handler BEFORE importing ngsw to intercept share-target POST
self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  const method = event.request.method;

  // Handle share-target POST requests (fallback if server doesn't catch it)
  if (method === 'POST' && url.includes('/share-target')) {
    event.respondWith(handleShareTarget(event));
    return;
  }
});

// Service worker lifecycle
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Import Angular's service worker for all other requests
importScripts('./ngsw-worker.js');

// Handle push notifications (required for TWA/PWABuilder packaged apps)
self.addEventListener('push', (event) => {
  if (!event.data) {
    return;
  }

  let notificationData;
  try {
    notificationData = event.data.json();
  } catch (e) {
    notificationData = {
      notification: {
        title: 'Nostria',
        body: event.data.text(),
      }
    };
  }

  const notification = notificationData.notification || notificationData;
  const title = notification.title || 'Nostria';
  const options = {
    body: notification.body || '',
    icon: notification.icon || '/icons/icon-128x128.png',
    badge: notification.badge || '/icons/icon-72x72.png',
    tag: notification.tag || 'nostria-notification',
    data: notification.data || notificationData.data || {},
    actions: notification.actions || [],
    requireInteraction: notification.requireInteraction || false,
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url ||
    event.notification.data?.onActionClick?.default?.url ||
    '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          if (urlToOpen !== '/') {
            client.navigate(urlToOpen);
          }
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

/**
 * Handle Web Share Target POST requests
 * Stores shared files in cache and redirects to the app with an ID
 */
async function handleShareTarget(event) {
  try {
    const formData = await event.request.formData();
    const timestamp = Date.now();
    const cacheUrl = `/shared-content/${timestamp}`;

    // Extract data from FormData
    const title = formData.get('title') || '';
    const text = formData.get('text') || '';
    const url = formData.get('url') || '';

    // Get files (try 'media' from manifest, then 'files' as fallback)
    let files = formData.getAll('media');
    if (!files || files.length === 0) {
      files = formData.getAll('files');
    }

    // Process files - convert to serializable format
    const filesData = [];
    for (const file of files) {
      if (file instanceof File && file.size > 0) {
        const arrayBuffer = await file.arrayBuffer();
        filesData.push({
          name: file.name,
          type: file.type,
          size: file.size,
          lastModified: file.lastModified,
          data: Array.from(new Uint8Array(arrayBuffer))
        });
      }
    }

    // Store in cache
    const payload = { title, text, url, files: filesData };
    const cache = await caches.open('nostria-share-target');
    await cache.put(cacheUrl, new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json' }
    }));

    // Redirect to the app with the cache ID
    return Response.redirect('/share-target?id=' + timestamp, 303);
  } catch (error) {
    console.error('[SW] Share target error:', error);
    return Response.redirect('/', 303);
  }
}
