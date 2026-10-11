import { expect, test } from '@playwright/test'

test('real segmented build renders both views, transforms frames, seeks and plays without backend or SPK transfers', async ({ page, context, request }) => {
  expect((await (await request.get('build-info.json')).json()).webExecution).toBe('segmented')
  const requests: string[] = [], failures: string[] = [], errors: string[] = []
  context.on('request', event => requests.push(event.url()))
  context.on('response', response => { if (!response.ok() && response.url().includes('/data/')) failures.push(`${response.status()}: ${response.url()}`) })
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('?v=4&lang=en&view=3d&bodies=sun,earth,moon,mars,naif:401&ref=sun&jd=2461287.5&history=30&speed=30')
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible()
  await expect(page.locator('.ephemeris-status > summary')).toContainText('5/5')
  await page.locator('.inspector-toggle').click()
  await page.getByRole('tab', { name: 'Orbit', exact: true }).click()
  await expect(page.locator('.inspector-panel')).toContainText('Segmented Chebyshev orbit approximation')
  await page.locator('.inspector-toggle').click()
  await page.getByRole('button', { name: '2D', exact: true }).click()
  const canvas = page.locator('canvas.trajectory-canvas')
  await expect(canvas).toHaveAttribute('data-position-count', '5')
  await expect.poll(async () => Number(await canvas.getAttribute('data-trail-count'))).toBeGreaterThan(0)
  await page.locator('.advanced-controls > summary').click()
  await page.locator('[data-story-target="frame"] select').first().selectOption('earth')
  await expect(page.locator('.frame-label').first()).toContainText('Earth')
  await page.getByLabel('Split comparison', { exact: true }).check()
  await expect(page.locator('canvas.trajectory-canvas')).toHaveCount(2)
  await expect(page.locator('canvas.trajectory-canvas').first()).toHaveAttribute('data-position-count', '5')
  await page.locator('.simulation-bar input[type=date]').fill('2049-01-01')
  await expect(page.locator('.ephemeris-status > summary').first()).toContainText('3/5')
  await expect(page.locator('canvas.trajectory-canvas').first()).toHaveAttribute('data-position-count', '3')
  await page.locator('.simulation-bar input[type=date]').fill('2027-01-01')
  await expect(page.locator('.ephemeris-status > summary').first()).toContainText('5/5')
  await page.locator('.rate-field select').selectOption('365')
  const before = await page.locator('.jd-readout').innerText()
  await page.getByRole('button', { name: '▶ Play', exact: true }).click()
  await expect(page.locator('.jd-readout')).not.toHaveText(before)
  await page.getByRole('button', { name: '❚❚ Pause', exact: true }).click()
  await page.locator('.rate-field select').selectOption('-30')
  await page.getByRole('button', { name: '3D', exact: true }).click()
  await expect(page.getByTestId('trajectory-canvas-3d')).toHaveCount(2)
  await page.locator('.simulation-bar input[type=date]').fill('2052-01-01')
  await expect(page.locator('.ephemeris-status > summary').first()).toContainText('1/5')
  expect(requests.filter(url => /\/v1\/|\.bsp(?:\?|$)|horizons\.jpl/.test(url))).toEqual([])
  expect(requests.some(url => url.includes('/data/approximation/chunks/'))).toBe(true)
  expect(failures).toEqual([])
  expect(errors).toEqual([])
})

test('the packaged full catalog supports real name search without a scientific backend', async ({ page, context }) => {
  const backend: string[] = [], errors: string[] = [], urls: string[] = []
  context.on('request', event => { urls.push(event.url()); if (/\/v1\//.test(event.url())) backend.push(event.url()) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('?v=4&page=catalog&lang=en&view=2d')
  await page.getByPlaceholder('Ceres / 433 Eros / 2024 YR4').fill('Bennu')
  await expect(page.locator('.catalog-table')).toContainText('Bennu')
  expect(backend).toEqual([])
  expect(errors).toEqual([])
  expect(urls.some(url => url.includes('catalog-sample-mobile.bin'))).toBe(true)
  expect(urls.some(url => /catalog-index\.bin|catalog-sample-desktop/.test(url))).toBe(false)
})

test('small scene stays below its download budget and reuses coefficients after reload', async ({ page, context }) => {
  const urls: string[] = [], sizes: Promise<number>[] = []
  context.on('request', event => urls.push(event.url()))
  context.on('response', response => {
    if (response.url().includes('/data/approximation/')) sizes.push(response.body().then(bytes => {
      // Playwright exposes decompressed bodies for Content-Encoding: gzip.
      // The HTTP length records the delivered compressed representation.
      const length = Number(response.headers()['content-length'])
      return Number.isFinite(length) && length > 0 ? length : bytes.length
    }))
  })
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('?v=4&lang=en&view=2d&bodies=sun,earth,moon,mars,naif:401&ref=sun&jd=2461287.5&history=30')
  await expect(page.locator('canvas.trajectory-canvas')).toHaveAttribute('data-position-count', '5')
  await expect.poll(async () => Number(await page.locator('canvas.trajectory-canvas').getAttribute('data-trail-count'))).toBeGreaterThan(0)
  const chunkPaths = [...new Set(urls.filter(url => /\/data\/approximation\/(?:chunks|manifests)\//.test(url)).map(url => new URL(url).pathname))]
  await expect.poll(() => page.evaluate(async paths => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('solar-atlas-data-v1')
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    try {
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const request = database.transaction('immutable-responses').objectStore('immutable-responses').getAllKeys()
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
      })
      return paths.every(path => keys.includes(path))
    } finally { database.close() }
  }, chunkPaths)).toBe(true)
  const bytes = (await Promise.all(sizes)).reduce((sum, value) => sum + value, 0)
  console.log(`Five-body, 30-day approximation cold payload: ${bytes} bytes`)
  expect(bytes).toBeLessThan(2 * 1024 * 1024)
  const beforeReload = urls.length
  const beforeReloadSizes = sizes.length
  await page.reload()
  await expect(page.locator('canvas.trajectory-canvas')).toHaveAttribute('data-position-count', '5')
  await expect.poll(async () => Number(await page.locator('canvas.trajectory-canvas').getAttribute('data-trail-count'))).toBeGreaterThan(0)
  expect(urls.slice(beforeReload).filter(url => /\/data\/approximation\/(?:chunks|manifests)\//.test(url))).toEqual([])
  const reloadBytes = (await Promise.all(sizes.slice(beforeReloadSizes))).reduce((sum, value) => sum + value, 0)
  console.log(`Cached approximation reload payload: ${reloadBytes} bytes`)
  expect(reloadBytes).toBeLessThan(1024)
  expect(urls.some(url => /catalog-index\.bin|catalog-sample-.*\.(?:bin|json)/.test(url))).toBe(false)
})
