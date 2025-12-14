importScripts('./ngsw-worker.js');

self.addEventListener('fetch', (event) => {
  if (event.request.method === 'POST' && event.request.url.includes('/share-target')) {
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
    // 1. Consume the request body as FormData
    const formData = await event.request.formData();

    // 2. Generate a unique ID
    const timestamp = Date.now();
    const cacheUrl = `/shared-content/${timestamp}`;

    // 3. Extract data from FormData
    const title = formData.get('title') || '';
    const text = formData.get('text') || '';
    const url = formData.get('url') || '';
    const files = formData.getAll('files');

    // 4. Process files - convert to serializable format
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

    // 5. Create a JSON payload with all the data
    const payload = {
      title: title,
      text: text,
      url: url,
      files: filesData
    };

    // 6. Open a specific cache for shared content
    const cache = await caches.open('nostria-share-target');

    // 7. Store the data as JSON Response
    await cache.put(cacheUrl, new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json' }
    }));

    // 8. Redirect to the app with the ID
    return Response.redirect('/share-target?id=' + timestamp, 303);
  } catch (error) {
    console.error('Error handling share target:', error);
    // Redirect to home on error
    return Response.redirect('/', 303);
  }
}
