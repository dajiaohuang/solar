const OWN_PREFIX = 'solar-atlas-'
const SHELL_CACHE = 'solar-atlas-shell-v3'
const EXPECTED_KEYS = new Set([SHELL_CACHE])

self.addEventListener('install', (event) => {
  const shellUrl = new URL('./', self.location.href).href
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.add(shellUrl)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys
      .filter((key) => key.startsWith(OWN_PREFIX) && !EXPECTED_KEYS.has(key))
      .map((key) => caches.delete(key)),
  )).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Immutable MPCORB responses are persisted only by the bounded IndexedDB
  // cache, while the mutable version pointer stays network-only. Keeping the
  // entire data tree out of Cache Storage avoids duplicates and stale pins.
  if (url.pathname.includes('/data/asteroids/')) return

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(SHELL_CACHE)
        await Promise.all([
          cache.put(request, response.clone()),
          cache.put(new URL('./', self.location.href).href, response.clone()),
        ])
      }
      return response
    }).catch(async () => {
      const cache = await caches.open(SHELL_CACHE)
      return (await cache.match(request)) || (await cache.match(new URL('./', self.location.href).href)) || Response.error()
    }))
    return
  }

  event.respondWith(caches.open(SHELL_CACHE).then(async (cache) => {
    const cached = await cache.match(request)
    const network = fetch(request).then((response) => {
      if (response.ok) void cache.put(request, response.clone())
      return response
    }).catch(() => cached)
    return cached || network
  }))
})
