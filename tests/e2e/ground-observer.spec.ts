import { readFile } from 'node:fs/promises'
import { expect, test } from './fixtures'
import fixture from '../fixtures/observer-api-sun.json' with { type: 'json' }

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
})

test('ground observation form keeps source evidence and exports the completed snapshot', async ({ page }) => {
  // The UI contract uses a recorded real Go/SPK/IERS response. Numerical
  // agreement with ERFA and Horizons is tested separately in Go.
  await page.route('**/solar-test-api/v1/observation', async route => {
    expect(route.request().postDataJSON()).toEqual(fixture.result.request)
    if (process.env.SOLAR_OBSERVER_LIVE_URL) {
      const response = await route.fetch({ url: `${process.env.SOLAR_OBSERVER_LIVE_URL}/v1/observation` })
      await route.fulfill({ response })
    } else await route.fulfill({ json: fixture })
  })
  await page.goto('./?v=4&page=explorer&focused=sun&bodies=sun%2Cearth&ref=sun&speed=0&lang=en')
  await page.getByRole('button', { name: 'Show body details' }).click()
  await page.getByRole('tab', { name: 'Orbit', exact: true }).click()
  await page.locator('.ground-observer > summary').click()
  await page.getByLabel('UTC time', { exact: true }).fill(fixture.result.request.utc)
  await page.getByLabel('Longitude ° (east positive)', { exact: true }).fill('103.851959')
  await page.getByLabel('Latitude °', { exact: true }).fill('1.29027')
  await page.getByRole('button', { name: 'Calculate ground observation', exact: true }).click()
  const result = page.getByRole('region', { name: 'Ground observation result' })
  await expect(result).toContainText('75.66593')
  await expect(result).toContainText('IERS includes predictions')
  await page.screenshot({ path: test.info().outputPath('ground-observer.png'), fullPage: true })
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export result and sources JSON', exact: true }).click()
  const download = await downloaded
  const data = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(data.result.request).toEqual(fixture.result.request)
  expect(data.earthOrientation.sha256).toBe(fixture.earthOrientation.sha256)
  await page.getByLabel('Latitude °', { exact: true }).fill('0')
  await expect(result).toHaveCount(0)
})

test('ground observation exposes unavailable EOP and cancels stale requests', async ({ page }) => {
  let hold = false, resolveHeld: (() => void) | undefined
  await page.route('**/solar-test-api/v1/observation', async route => {
    if (hold) await new Promise<void>(resolve => { resolveHeld = resolve })
    await route.fulfill({ status: 503, json: { apiVersion: 'solar.api/v1', error: { code: 'earth_orientation_unavailable', message: 'No IERS snapshot' } } }).catch(() => undefined)
  })
  await page.goto('./?v=4&page=explorer&focused=sun&bodies=sun%2Cearth&ref=sun&speed=0&lang=en')
  await page.getByRole('button', { name: 'Show body details' }).click()
  await page.getByRole('tab', { name: 'Orbit', exact: true }).click()
  await page.locator('.ground-observer > summary').click()
  await page.getByRole('button', { name: 'Calculate ground observation', exact: true }).click()
  await expect(page.locator('.ground-observer [role=alert]')).toContainText('no IERS Earth orientation snapshot')
  hold = true
  const pending = page.waitForRequest('**/solar-test-api/v1/observation')
  await page.getByRole('button', { name: 'Calculate ground observation', exact: true }).click()
  await pending
  await page.locator('.ground-observer').getByRole('button', { name: 'Cancel', exact: true }).click()
  resolveHeld?.()
  await expect(page.getByRole('button', { name: 'Calculate ground observation', exact: true })).toBeEnabled()
  await expect(page.locator('.ground-observer [role=alert]')).toHaveCount(0)
})
