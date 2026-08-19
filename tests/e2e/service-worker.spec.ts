import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'allow' })

test('service worker preserves unrelated same-origin caches', async ({ page }) => {
  await page.goto('./')
  const cacheKeys = await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    const unrelated = await caches.open('other-pages-project-cache')
    await unrelated.put('./other-project-response', new Response('keep'))
    const staleOwnCache = await caches.open('solar-atlas-shell-v0')
    await staleOwnCache.put('./stale-response', new Response('remove'))

    const currentRegistrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(currentRegistrations.map((registration) => registration.unregister()))
    const registration = await navigator.serviceWorker.register(`./sw.js?cache-regression=${Date.now()}`, { scope: './' })
    const worker = registration.installing ?? registration.waiting ?? registration.active
    if (worker?.state !== 'activated') {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Timed out waiting for service worker activation')), 10_000)
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'activated') {
            window.clearTimeout(timeout)
            resolve()
          }
        })
      })
    }
    return caches.keys()
  })

  expect(cacheKeys).toContain('other-pages-project-cache')
  expect(cacheKeys).not.toContain('solar-atlas-shell-v0')
})
