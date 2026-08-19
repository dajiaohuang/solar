import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'allow' })

test('first install can reload the application shell offline', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright WebKit cannot reliably reload while its context is forced offline')
  await page.goto('./')
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.reload()
  await expect(page.getByRole('heading', { name: /See the Solar System|把太阳系看成/ })).toBeVisible()
  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /See the Solar System|把太阳系看成/ })).toBeVisible()
  await context.setOffline(false)
})

test('service worker preserves unrelated same-origin caches', async ({ page }) => {
  await page.goto('./')
  const cacheKeys = await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    const unrelated = await caches.open('other-pages-project-cache')
    await unrelated.put('./other-project-response', new Response('keep'))
    const staleOwnCache = await caches.open('solar-atlas-shell-v0')
    await staleOwnCache.put('./stale-response', new Response('remove'))

    const scriptUrl = new URL(`./sw.js?cache-regression=${Date.now()}`, window.location.href).href
    const registration = await navigator.serviceWorker.register(scriptUrl, { scope: './' })
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 30_000
      const checkActivation = () => {
        if (registration.active?.state === 'activated' && registration.active.scriptURL === scriptUrl) {
          resolve()
          return
        }
        if (Date.now() >= deadline) {
          reject(new Error('Timed out waiting for service worker activation'))
          return
        }
        if (registration.waiting?.scriptURL === scriptUrl) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' })
        }
        window.setTimeout(checkActivation, 100)
      }
      checkActivation()
    })
    return caches.keys()
  })

  expect(cacheKeys).toContain('other-pages-project-cache')
  expect(cacheKeys).not.toContain('solar-atlas-shell-v0')
})
