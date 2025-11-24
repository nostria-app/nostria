importScripts('./ngsw-worker.js');

self.addEventListener('fetch', (event) => {
  if (event.request.method === 'POST' && event.request.url.includes('/share-target')) {
    event.respondWith(handleShareTarget(event));
  }
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
