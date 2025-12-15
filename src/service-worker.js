importScripts('./ngsw-worker.js');

// Enable debug mode for share target
const DEBUG_SHARE_TARGET = true;

self.addEventListener('fetch', (event) => {
  if (DEBUG_SHARE_TARGET && event.request.url.includes('/share-target')) {
    console.log('[SW ShareTarget] Fetch intercepted:', event.request.method, event.request.url);
  }

  if (event.request.method === 'POST' && event.request.url.includes('/share-target')) {
    if (DEBUG_SHARE_TARGET) {
      console.log('[SW ShareTarget] Handling POST share-target request');
    }
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
    if (DEBUG_SHARE_TARGET) {
      console.log('[SW ShareTarget] handleShareTarget started');
      console.log('[SW ShareTarget] Request URL:', event.request.url);
      console.log('[SW ShareTarget] Request headers:', [...event.request.headers.entries()]);
    }

    // 1. Consume the request body as FormData
    const formData = await event.request.formData();

    if (DEBUG_SHARE_TARGET) {
      console.log('[SW ShareTarget] FormData parsed successfully');
      console.log('[SW ShareTarget] FormData entries:', [...formData.entries()].map(([k, v]) => {
        if (v instanceof File) {
          return [k, `File: ${v.name}, type: ${v.type}, size: ${v.size}`];
        }
        return [k, v];
      }));
    }

    // 2. Generate a unique ID
    const timestamp = Date.now();
    const cacheUrl = `/shared-content/${timestamp}`;

    // 3. Extract data from FormData
    const title = formData.get('title') || '';
    const text = formData.get('text') || '';
    const url = formData.get('url') || '';
    const files = formData.getAll('files');

    if (DEBUG_SHARE_TARGET) {
      console.log('[SW ShareTarget] Extracted data:', { title, text, url, filesCount: files.length });
    }

    // 4. Process files - convert to serializable format
    const filesData = [];
    for (const file of files) {
      if (file instanceof File && file.size > 0) {
        if (DEBUG_SHARE_TARGET) {
          console.log('[SW ShareTarget] Processing file:', file.name, file.type, file.size);
        }
        const arrayBuffer = await file.arrayBuffer();
        filesData.push({
          name: file.name,
          type: file.type,
          size: file.size,
          lastModified: file.lastModified,
          data: Array.from(new Uint8Array(arrayBuffer))
        });
        if (DEBUG_SHARE_TARGET) {
          console.log('[SW ShareTarget] File processed, data length:', filesData[filesData.length - 1].data.length);
        }
      }
    }

    // 5. Create a JSON payload with all the data
    const payload = {
      title: title,
      text: text,
      url: url,
      files: filesData
    };

    if (DEBUG_SHARE_TARGET) {
      console.log('[SW ShareTarget] Payload created, files count:', filesData.length);
    }

    // 6. Open a specific cache for shared content
    const cache = await caches.open('nostria-share-target');

    // 7. Store the data as JSON Response
    await cache.put(cacheUrl, new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json' }
    }));

    if (DEBUG_SHARE_TARGET) {
      console.log('[SW ShareTarget] Data cached at:', cacheUrl);
      console.log('[SW ShareTarget] Redirecting to /share-target?id=' + timestamp);
    }

    // 8. Redirect to the app with the ID
    return Response.redirect('/share-target?id=' + timestamp, 303);
  } catch (error) {
    console.error('[SW ShareTarget] Error handling share target:', error);
    if (DEBUG_SHARE_TARGET) {
      console.error('[SW ShareTarget] Error details:', error.message, error.stack);
    }
    // Redirect to home on error
    return Response.redirect('/', 303);
  }
}
