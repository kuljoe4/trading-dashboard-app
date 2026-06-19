const CACHE_NAME = 'momentum-v2';
const ASSETS = [
  '/manifest.json',
  '/icons/icon.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => Promise.all(
        clients.map((client) => client.navigate(client.url))
      ))
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      fetch(request).then((response) => {
        const contentType = response.headers.get('content-type') || '';
        const isValidAsset =
          response.ok &&
          ((request.destination === 'script' && contentType.includes('javascript')) ||
            (request.destination === 'style' && contentType.includes('css')) ||
            (!['script', 'style'].includes(request.destination)));

        if (isValidAsset) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }

        if (!isValidAsset && (request.destination === 'script' || request.destination === 'style')) {
          throw new Error(`Invalid asset response for ${url.pathname}`);
        }

        return response;
      }).catch(() => caches.match(request).then((response) => response || Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((response) => response || fetch(request))
  );
});
