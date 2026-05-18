// NoQx Service Worker - Offline support & cache strategy
// IMPORTANT: bump CACHE_NAME on every release that changes JS/CSS so the
// activate handler nukes the previous version's caches. Otherwise users
// keep loading stale UI (e.g. "ACTIVE ORDERS" label that was deleted).
const CACHE_NAME = 'noqx-v3-2026-05-18';

// Only truly static assets are precached. HTML and JS/CSS bundles are
// fetched network-first so new deploys are picked up immediately.
const PRECACHE = [
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  // Activate the new SW immediately on install instead of waiting for the
  // user to close every tab.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept Supabase API calls, payment gateway calls, or our API.
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('phonepe.com') ||
    url.hostname.includes('razorpay.com') ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  // Network-first for navigation (HTML pages) and Next.js build chunks (_next/*).
  // This is the critical path for picking up new deploys immediately. Cache is
  // only consulted when the network fails (offline).
  const isNextBundle = url.pathname.startsWith('/_next/');
  if (event.request.mode === 'navigate' || isNextBundle) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Only cache successful responses to avoid serving 404s next time.
          if (response.ok && (event.request.mode === 'navigate' || isNextBundle)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request).then((r) => r || caches.match('/'))
        )
    );
    return;
  }

  // Cache-first for static assets (icons, manifest, fonts) — these are
  // fingerprinted or rarely change, so cache lookup is safe and fast.
  event.respondWith(
    caches.match(event.request).then(
      (cached) => cached || fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
    )
  );
});
