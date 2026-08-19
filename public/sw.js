const OWN_PREFIX = 'solar-atlas-'
const SHELL_CACHE = 'solar-atlas-shell-__BUILD_SHA__'
const PRECACHE_URLS = ['./'] // __SOLAR_ATLAS_PRECACHE__
const EXPECTED_KEYS = new Set([SHELL_CACHE])

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys
      .filter((key) => key.startsWith(OWN_PREFIX) && !EXPECTED_KEYS.has(key))
      .map((key) => caches.delete(key)),
  )).then(() => self.clients.claim()))
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Immutable MPCORB responses are persisted only by the bounded IndexedDB
  // cache. This avoids duplicating large scientific assets in Cache Storage.
  if (url.pathname.includes('/data/asteroids/')) return

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(async (response) => {
      if (response.ok && url.pathname.endsWith('/solar/')) {
        const cache = await caches.open(SHELL_CACHE)
        await cache.put(new URL('./', self.location.href).href, response.clone())
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
    if (cached) return cached
    const response = await fetch(request)
    if (response.ok) void cache.put(request, response.clone())
    return response
  }))
})
