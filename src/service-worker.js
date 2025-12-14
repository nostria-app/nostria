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
  // 1. Consume the request body as FormData
  const formData = await event.request.formData();

  // 2. Generate a unique ID
  const timestamp = Date.now();
  const cacheUrl = `/shared-content/${timestamp}`;

  // 3. Open a specific cache for shared content
  const cache = await caches.open('nostria-share-target');

  // 4. Store the FormData as a synthetic Response
  // We create a new Response containing the same FormData
  await cache.put(cacheUrl, new Response(formData));

  // 5. Redirect to the app with the ID
  return Response.redirect('/share-target?id=' + timestamp, 303);
}
