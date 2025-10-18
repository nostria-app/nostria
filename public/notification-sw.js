/**
 * Custom Service Worker for Nostria
 * Handles push notifications and displays them to the user
 */

// Listen for push events
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push received:', event);

  if (!event.data) {
    console.warn('[Service Worker] Push event has no data');
    return;
  }

  try {
    // Try to parse as JSON first, fall back to text
    let data;
    try {
      data = event.data.json();
      console.log('[Service Worker] Push data (JSON):', data);
    } catch (jsonError) {
      // Not JSON, treat as text
      const text = event.data.text();
      console.log('[Service Worker] Push data (text):', text);
      data = {
        title: 'Nostria',
        body: text,
      };
    }

    // Extract notification details
    const title = data.title || data.notification?.title || 'Nostria';
    const options = {
      body: data.body || data.notification?.body || '',
      icon: data.icon || data.notification?.icon || '/icons/icon-192x192.png',
      badge: data.badge || data.notification?.badge || '/icons/icon-96x96.png',
      tag: data.tag || data.notification?.tag || 'nostria-notification',
      data: data.data || data.notification?.data || {},
      requireInteraction: false,
      renotify: true,
      vibrate: [200, 100, 200],
      timestamp: data.timestamp || Date.now(),
    };

    // Add actions if provided
    if (data.actions || data.notification?.actions) {
      options.actions = data.actions || data.notification.actions;
    }

    // Add image if provided
    if (data.image || data.notification?.image) {
      options.image = data.image || data.notification.image;
    }

    // Show the notification
    event.waitUntil(
      self.registration.showNotification(title, options)
        .then(() => {
          console.log('[Service Worker] Notification displayed:', title);
        })
        .catch((error) => {
          console.error('[Service Worker] Failed to show notification:', error);
        })
    );
  } catch (error) {
    console.error('[Service Worker] Error processing push event:', error);
    
    // Fallback: show a basic notification with the text data if available
    let fallbackBody = 'You have a new notification';
    try {
      fallbackBody = event.data.text() || fallbackBody;
    } catch (e) {
      // Ignore error, use default message
    }
    
    event.waitUntil(
      self.registration.showNotification('Nostria', {
        body: fallbackBody,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-96x96.png',
        tag: 'nostria-notification-fallback',
      })
    );
  }
});

// Listen for notification click events
self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Notification clicked:', event.notification);

  event.notification.close();

  // Get the URL to open from notification data
  const urlToOpen = event.notification.data?.url || 
                    event.notification.data?.onActionClick?.default?.url ||
                    '/';

  // Handle action clicks
  if (event.action) {
    console.log('[Service Worker] Notification action clicked:', event.action);
    
    // Check if there's a specific action URL
    const actionUrl = event.notification.data?.onActionClick?.[event.action]?.url;
    if (actionUrl) {
      event.waitUntil(
        clients.openWindow(actionUrl)
      );
      return;
    }
  }

  // Open the app or focus existing window
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if there's already a window open
        for (const client of clientList) {
          if (client.url.includes(urlToOpen) && 'focus' in client) {
            return client.focus();
          }
        }
        
        // If no window is open, open a new one
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
      .catch((error) => {
        console.error('[Service Worker] Error handling notification click:', error);
      })
  );
});

// Listen for notification close events
self.addEventListener('notificationclose', (event) => {
  console.log('[Service Worker] Notification closed:', event.notification);
  
  // Optional: Send analytics or tracking data
  const data = event.notification.data;
  if (data?.trackingId) {
    // Could send a beacon to track notification dismissal
    console.log('[Service Worker] Notification dismissed:', data.trackingId);
  }
});

// Handle messages from the application
self.addEventListener('message', (event) => {
  console.log('[Service Worker] Message received:', event.data);

  if (event.data?.type === 'SHOW_NOTIFICATION') {
    // Application can manually trigger notifications
    const { title, options } = event.data;
    
    event.waitUntil(
      self.registration.showNotification(title, options)
        .then(() => {
          // Send success response back to client
          event.ports[0]?.postMessage({ success: true });
        })
        .catch((error) => {
          console.error('[Service Worker] Failed to show notification:', error);
          event.ports[0]?.postMessage({ success: false, error: error.message });
        })
    );
  }
});

// Log when service worker is activated
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activated');
  event.waitUntil(self.clients.claim());
});

// Log when service worker is installed
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installed');
  event.waitUntil(self.skipWaiting());
});

console.log('[Service Worker] Loaded - Push notifications enabled');
