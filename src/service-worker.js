importScripts('./ngsw-worker.js');

// Enable debug mode for share target
const DEBUG_SHARE_TARGET = true;
const SHARE_DEBUG_STORAGE_KEY = 'nostria-share-debug-logs';
const MAX_DEBUG_LOGS = 50;

// Helper to log to a storage-compatible format (will be read by the app)
function logShareDebug(message, data) {
  if (!DEBUG_SHARE_TARGET) return;

  console.log('[SW ShareTarget] ' + message, data || '');

  // Try to post message to clients for real-time updates
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage({
        type: 'SHARE_DEBUG_LOG',
        payload: {
          timestamp: Date.now(),
          source: 'service-worker',
          message: message,
          data: data
        }
      });
    });
  });
}

self.addEventListener('fetch', (event) => {
  if (DEBUG_SHARE_TARGET && event.request.url.includes('/share-target')) {
    logShareDebug('Fetch intercepted', { method: event.request.method, url: event.request.url });
  }

  if (event.request.method === 'POST' && event.request.url.includes('/share-target')) {
    logShareDebug('Handling POST share-target request');
    event.respondWith(handleShareTarget(event));
  }
});

// Handle push notifications (required for TWA/PWABuilder packaged apps)
self.addEventListener('push', (event) => {
  if (!event.data) {
    console.log('Push event received but no data');
    return;
  }

  let notificationData;
  try {
    notificationData = event.data.json();
  } catch (e) {
    // If not JSON, treat as text
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
      // Check if there's already a window open
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          if (urlToOpen !== '/') {
            client.navigate(urlToOpen);
          }
          return;
        }
      }
      // Open a new window if none exists
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

async function handleShareTarget(event) {
  try {
    logShareDebug('handleShareTarget started', { url: event.request.url });

    // Log request headers
    const headers = {};
    event.request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    logShareDebug('Request headers', headers);

    // 1. Consume the request body as FormData
    const formData = await event.request.formData();

    // Log FormData entries
    const formDataEntries = [];
    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        formDataEntries.push([key, { type: 'File', name: value.name, mimeType: value.type, size: value.size }]);
      } else {
        formDataEntries.push([key, value]);
      }
    }
    logShareDebug('FormData parsed', { entries: formDataEntries });

    // 2. Generate a unique ID
    const timestamp = Date.now();
    const cacheUrl = `/shared-content/${timestamp}`;

    // 3. Extract data from FormData
    const title = formData.get('title') || '';
    const text = formData.get('text') || '';
    const url = formData.get('url') || '';
    const files = formData.getAll('files');

    logShareDebug('Extracted fields', { title, text, url, filesCount: files.length });

    // 4. Process files - convert to serializable format
    const filesData = [];
    for (const file of files) {
      if (file instanceof File && file.size > 0) {
        logShareDebug('Processing file', { name: file.name, type: file.type, size: file.size });
        const arrayBuffer = await file.arrayBuffer();
        filesData.push({
          name: file.name,
          type: file.type,
          size: file.size,
          lastModified: file.lastModified,
          data: Array.from(new Uint8Array(arrayBuffer))
        });
        logShareDebug('File processed', { name: file.name, dataLength: filesData[filesData.length - 1].data.length });
      }
    }

    // 5. Create a JSON payload with all the data
    const payload = {
      title: title,
      text: text,
      url: url,
      files: filesData
    };

    logShareDebug('Payload created', { filesCount: filesData.length, payloadSize: JSON.stringify(payload).length });

    // 6. Open a specific cache for shared content
    const cache = await caches.open('nostria-share-target');

    // 7. Store the data as JSON Response
    await cache.put(cacheUrl, new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json' }
    }));

    logShareDebug('Data cached', { cacheUrl, redirectTo: '/share-target?id=' + timestamp });

    // 8. Redirect to the app with the ID
    return Response.redirect('/share-target?id=' + timestamp, 303);
  } catch (error) {
    logShareDebug('Error handling share target', { error: error.message, stack: error.stack });
    // Redirect to home on error
    return Response.redirect('/', 303);
  }
}
