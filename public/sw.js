const CACHE_NAME = 'solar-atlas-shell-v2'
const IMMUTABLE_DATA_CACHE = 'solar-atlas-data-v2'

self.addEventListener('install', (event) => {
  const shellUrl = new URL('./', self.location.href).href
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.add(shellUrl)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => ![CACHE_NAME, IMMUTABLE_DATA_CACHE].includes(key)).map((key) => caches.delete(key)),
  )).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (url.pathname.includes('/data/asteroids/releases/')) {
    event.respondWith(caches.open(IMMUTABLE_DATA_CACHE).then(async (cache) => {
      const cached = await cache.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok) await cache.put(request, response.clone())
      return response
    }))
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME)
        await Promise.all([
          cache.put(request, response.clone()),
          cache.put(new URL('./', self.location.href).href, response.clone()),
        ])
      }
      return response
    }).catch(async () => {
      const cache = await caches.open(CACHE_NAME)
      return (await cache.match(request)) || (await cache.match(new URL('./', self.location.href).href)) || Response.error()
    }))
    return
  }

  event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
    const cached = await cache.match(request)
    const network = fetch(request).then((response) => {
      if (response.ok) cache.put(request, response.clone())
      return response
    }).catch(() => cached)
    return cached || network
  }))
})
