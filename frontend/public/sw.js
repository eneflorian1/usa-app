self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// A simple fetch handler is enough to trigger the "Add to Home Screen" prompt.
self.addEventListener('fetch', (event) => {
  // Pass through all requests
});