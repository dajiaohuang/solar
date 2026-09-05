import { expect, test } from '@playwright/test'

// Exercise the real shell network, not the state-tile page.route fixture.
// With service workers enabled the intercepted backend traffic reproducibly
// stalled SKIP_WAITING activation. Scientific backend behavior is covered
// separately with service workers blocked.

test.use({ serviceWorkers: 'allow' })

test('first install can reload the application shell offline', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright WebKit cannot reliably reload while its context is forced offline')
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./')
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.reload()
  await expect(page.getByTestId('ephemeris-status')).toBeVisible({ timeout: 15_000 })
  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('ephemeris-status')).toBeVisible({ timeout: 15_000 })
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
      const deadline = Date.now() + 20_000
      const transitions: string[] = []
      const checkActivation = () => {
        const status = JSON.stringify({ installing: [registration.installing?.state, registration.installing?.scriptURL], waiting: [registration.waiting?.state, registration.waiting?.scriptURL], active: [registration.active?.state, registration.active?.scriptURL] })
        if (transitions.at(-1) !== status) transitions.push(status)
        if (registration.active?.state === 'activated' && registration.active.scriptURL === scriptUrl) {
          resolve()
          return
        }
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for service worker activation: ${transitions.join(' -> ')}`))
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
