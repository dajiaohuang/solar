import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

test('3D camera survives cold coefficient loading and playback updates positions without restarting histories every tick', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('solar-atlas-first-run-v1', 'complete')
    const original = Worker.prototype.postMessage
    const tracking = window as Window & { trajectoryRequests?: number }
    tracking.trajectoryRequests = 0
    Worker.prototype.postMessage = function (...args: Parameters<Worker['postMessage']>) {
      const message = args[0] as { type?: string; centerJulianDay?: number }
      if (message?.type === 'compute' && typeof message.centerJulianDay === 'number') tracking.trajectoryRequests!++
      return original.apply(this, args)
    }
  })
  await page.route('**/data/approximation/chunks/**', async route => {
    await new Promise(resolve => setTimeout(resolve, 1200))
    await route.continue()
  })
  await page.goto('?v=4&lang=en&view=3d&bodies=sun,earth,moon,mars,naif:401&ref=sun&jd=2461287.5&history=30&speed=30')
  const canvas = page.getByTestId('trajectory-canvas-3d')
  await expect(canvas).toBeVisible()
  await expect(canvas).toHaveAttribute('data-fit-generation', /[1-9]\d*/)
  const fit = await canvas.getAttribute('data-fit-generation')
  const before = await canvas.getAttribute('data-camera-position')
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * .75, box.y + box.height * .65, { steps: 12 })
  await page.mouse.up()
  await expect(canvas).not.toHaveAttribute('data-camera-position', before!)
  const dragged = await canvas.getAttribute('data-camera-position')
  await expect(page.locator('.ephemeris-status > summary')).toContainText('5/5')
  await expect(page.locator('.compute-progress')).toHaveCount(0)
  await expect(canvas).toHaveAttribute('data-fit-generation', fit!)
  await expect(canvas).toHaveAttribute('data-camera-position', dragged!)
  const requests = await page.evaluate(() => (window as Window & { trajectoryRequests: number }).trajectoryRequests)
  await page.getByRole('button', { name: '▶ Play', exact: true }).click()
  await expect.poll(async () => Number(await canvas.getAttribute('data-live-frame-count'))).toBeGreaterThan(60)
  await expect(page.getByTestId('history-sampled-window')).toBeVisible()
  await expect(canvas).toHaveAttribute('data-fit-generation', fit!)
  await expect(canvas).toHaveAttribute('data-camera-position', dragged!)
  const after = await page.evaluate(() => (window as Window & { trajectoryRequests: number }).trajectoryRequests)
  expect(after - requests).toBeLessThanOrEqual(6)
  await page.getByRole('button', { name: '❚❚ Pause', exact: true }).click()
  await page.locator('.simulation-bar input[type=date]').fill('2052-01-01')
  await expect(page.locator('.ephemeris-status > summary')).toContainText('1/5')
  await expect(canvas).toHaveAttribute('data-position-count', '1')
})

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
  await expect(page.locator('.ephemeris-status > summary').first()).toContainText('5/5')
  await expect(page.locator('canvas.trajectory-canvas').first()).toHaveAttribute('data-position-count', '5')
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

test('forecast scenes preserve rendering and reference changes with explicit provenance and unknown uncertainty', async ({ page }) => {
  const missing = 'sat:planet:saturn:provisional:S/2009 S1'
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto(`?v=4&lang=en&view=2d&bodies=${encodeURIComponent(`sun,eris,makemake,naif:-61,${missing}`)}&ref=sun&jd=2469442.5&history=30`)
  await expect(page.locator('.ephemeris-status > summary')).toContainText('4/5')
  await expect(page.locator('.ephemeris-status > summary')).toContainText('Forecast 3')
  await expect(page.locator('canvas.trajectory-canvas')).toHaveAttribute('data-position-count', '4')
  await page.locator('.ephemeris-status > summary').click()
  await expect(page.locator('.ephemeris-status')).toContainText('do not bound errors outside that window')
  await expect(page.locator('.ephemeris-status')).toContainText('Maximum local backtest errors')
  await expect(page.locator('.ephemeris-status')).toContainText('unresolved system-orbit proxy')
  await expect(page.locator('.ephemeris-status a[href*="horizons.api"]')).toHaveCount(1)
  await page.locator('.advanced-controls > summary').click()
  await page.locator('[data-story-target="frame"] select').first().selectOption('makemake')
  await expect(page.locator('canvas.trajectory-canvas')).toHaveAttribute('data-position-count', '4')
  await page.getByRole('button', { name: '3D', exact: true }).click()
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible()
  await page.locator('.simulation-bar input[type=date]').fill('2052-01-01')
  await expect(page.locator('.ephemeris-status > summary')).toContainText('1/5')
})

test('the complete audited non-small population renders at the far end of the window', async ({ page }) => {
  const audit = JSON.parse(readFileSync('docs/benchmarks/non-small-coverage-20261012/report.json', 'utf8')) as { rows: { id: string }[] }
  const ids = audit.rows.map(body => body.id), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto(`?v=4&lang=en&view=2d&bodies=${encodeURIComponent(ids.join(','))}&ref=sun&jd=2469442.5&history=30`)
  await page.locator('.ephemeris-status > summary').click()
  await expect(page.locator('.ephemeris-status [role=alert]')).toHaveCount(0)
  try {
    await expect(page.locator('.ephemeris-status > summary')).toContainText('492/493', { timeout: 45_000 })
  } catch (error) {
    console.log('Full-scene load errors:', await page.locator('.ephemeris-status [role=alert]').allTextContents(), errors)
    throw error
  }
  await expect(page.locator('canvas.trajectory-canvas')).toHaveAttribute('data-position-count', '492')
  await page.getByRole('button', { name: '3D', exact: true }).click()
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible()
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
  const chunkPaths = [...new Set(urls.filter(url => /\/data\/approximation\/(?:chunks|manifests|indices)\//.test(url)).map(url => new URL(url).pathname))]
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
  const accounting = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('solar-atlas-data-v1')
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    try {
      const records = await new Promise<Array<{ buffer?: ArrayBuffer; kind?: string; totalBytes?: number }>>((resolve, reject) => {
        const request = database.transaction('immutable-responses').objectStore('immutable-responses').getAll()
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
      })
      return { actual: records.reduce((sum, record) => sum + (record.buffer?.byteLength ?? 0), 0),
        recorded: records.find(record => record.kind === 'cache-total-v1')?.totalBytes }
    } finally { database.close() }
  })
  expect(accounting.recorded).toBe(accounting.actual)
  expect(accounting.actual).toBeLessThanOrEqual(256 * 1024 * 1024)
  const bytes = (await Promise.all(sizes)).reduce((sum, value) => sum + value, 0)
  console.log(`Five-body, 30-day approximation cold payload: ${bytes} bytes`)
  expect(bytes).toBeLessThan(2 * 1024 * 1024)
  const beforeReload = urls.length
  const beforeReloadSizes = sizes.length
  await page.reload()
  await expect(page.locator('canvas.trajectory-canvas')).toHaveAttribute('data-position-count', '5')
  await expect.poll(async () => Number(await page.locator('canvas.trajectory-canvas').getAttribute('data-trail-count'))).toBeGreaterThan(0)
  expect(urls.slice(beforeReload).filter(url => /\/data\/approximation\/(?:chunks|manifests|indices)\//.test(url))).toEqual([])
  const reloadBytes = (await Promise.all(sizes.slice(beforeReloadSizes))).reduce((sum, value) => sum + value, 0)
  console.log(`Cached approximation reload payload: ${reloadBytes} bytes`)
  expect(reloadBytes).toBeLessThan(1024)
  expect(urls.some(url => /catalog-index\.bin|catalog-sample-.*\.(?:bin|json)/.test(url))).toBe(false)
})
