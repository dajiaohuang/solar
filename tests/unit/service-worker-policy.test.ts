import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

async function worker() {
  const handlers = new Map<string, (event: unknown) => void>()
  const cache = { match: vi.fn(async () => undefined), put: vi.fn(async () => {}) }
  const fetcher = vi.fn(async () => new Response('network'))
  const source = (await readFile('public/sw.js', 'utf8')).replace("const PRECACHE_URLS = ['./']", "const PRECACHE_URLS = ['./', './assets/app.js']")
  runInNewContext(source, { URL, Response, caches: { open: vi.fn(async () => cache) }, fetch: fetcher,
    self: { location: new URL('https://solar.test/solar/sw.js'), addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler) } })
  return { handlers, cache, fetcher }
}

describe('service worker shell isolation', () => {
  it('never intercepts APIs, changing manifests, or large scientific data downloads', async () => {
    const { handlers, cache } = await worker()
    for (const path of ['v1/catalog/manifest', 'health.json', 'data/ephemerides/kernel.bsp', 'data/asteroids/releases/a/chunk.json']) {
      const respondWith = vi.fn()
      handlers.get('fetch')!({ request: { method: 'GET', url: `https://solar.test/solar/${path}` }, respondWith })
      expect(respondWith).not.toHaveBeenCalled()
    }
    expect(cache.match).not.toHaveBeenCalled()
  })

  it('serves precached assets and never writes new online HTML into an old shell generation', async () => {
    const { handlers, cache, fetcher } = await worker()
    let response!: Promise<Response>
    const respondWith = (value: Promise<Response>) => { response = value }
    const waitUntil = vi.fn()
    handlers.get('fetch')!({ request: { method: 'GET', url: 'https://solar.test/solar/assets/app.js' }, respondWith, waitUntil })
    expect(await (await response).text()).toBe('network')
    expect(cache.put).toHaveBeenCalledTimes(1)
    cache.put.mockClear()
    handlers.get('fetch')!({ request: { method: 'GET', mode: 'navigate', url: 'https://solar.test/solar/' }, respondWith, waitUntil })
    expect(await (await response).text()).toBe('network')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(cache.put).not.toHaveBeenCalled()
  })
})
