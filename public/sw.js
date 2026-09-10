const OWN_PREFIX = 'solar-atlas-'
const SHELL_CACHE = 'solar-atlas-shell-__BUILD_SHA__'
const PRECACHE_URLS = ['./'] // __SOLAR_ATLAS_PRECACHE__
const SHELL_URLS = new Set(PRECACHE_URLS.map(path => new URL(path, self.location.href).href))
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
    // Keep the installed HTML and its precached asset generation together.
    // New online HTML must not overwrite the old build's offline entry point.
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(SHELL_CACHE)
      return (await cache.match(request)) || (await cache.match(new URL('./', self.location.href).href)) || Response.error()
    }))
    return
  }

  // Dynamic API responses, manifests and scientific downloads are not shell
  // assets. Never replay them from this cache, even when served on this origin.
  if (!SHELL_URLS.has(url.href)) return

  event.respondWith(caches.open(SHELL_CACHE).catch(() => null).then(async (cache) => {
    if (!cache) return fetch(request)
    const cached = await cache.match(request)
    if (cached) return cached
    const response = await fetch(request)
    if (response.ok && !/\bno-store\b/i.test(response.headers.get('Cache-Control') || '')) {
      event.waitUntil(cache.put(request, response.clone()).catch(() => {}))
    }
    return response
  }))
})
