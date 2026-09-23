import { readFile } from 'node:fs/promises'
import { expect, test } from './fixtures'
import fixture from '../fixtures/ground-contacts-api-dallas.json' with { type: 'json' }

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&page=explorer&focused=sun&bodies=sun%2Cearth&ref=sun&speed=0&lang=en')
  await page.getByRole('button', { name: 'Show body details' }).click()
  await page.getByRole('tab', { name: 'Orbit', exact: true }).click()
  await page.locator('.ground-observer > summary').click()
  await page.getByLabel('UTC time', { exact: true }).fill(fixture.result.request.startUtc)
  await page.getByLabel('Longitude ° (east positive)', { exact: true }).fill('-96.797')
  await page.getByLabel('Latitude °', { exact: true }).fill('32.7767')
  await page.getByLabel('Ellipsoidal height m', { exact: true }).fill('130')
  await page.locator('.ground-contacts > summary').click()
  await page.getByLabel('Contact search end UTC').fill(fixture.result.request.endUtc)
})

test('ground contact form renders and exports the captured real source result', async ({ page }) => {
  await page.route('**/solar-test-api/v1/observation/contacts', async route => {
    expect(route.request().postDataJSON()).toEqual(fixture.result.request)
    if (process.env.SOLAR_OBSERVER_LIVE_URL) {
      const response = await route.fetch({ url: `${process.env.SOLAR_OBSERVER_LIVE_URL}/v1/observation/contacts` })
      await route.fulfill({ response })
    } else await route.fulfill({ json: fixture })
  })
  await page.getByRole('button', { name: 'Search ground contacts', exact: true }).click()
  const result = page.getByRole('region', { name: 'Ground contact result' })
  await expect(result).toContainText('2024-04-08T17:23:20.434570Z')
  await expect(result).toContainText('tolerance is not physical accuracy')
  await expect(result).toContainText('9559.248 s')
  await expect(result).toContainText('236.074 s')
  await expect(result).toContainText('unsampled gaps may split these spans')
  expect(await result.evaluate(e => e.scrollWidth <= e.clientWidth+1)).toBe(true)
  await result.screenshot({ path: test.info().outputPath('ground-contacts.png') })
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export ground contacts and sources JSON' }).click()
  const payload = JSON.parse(await readFile((await (await pending).path())!, 'utf8'))
  expect(payload.result.contacts).toEqual(fixture.result.contacts)
  expect(payload.result.sampledOverlapWindows).toEqual(fixture.result.sampledOverlapWindows)
  expect(payload.result.earthOrientation.sha256).toBe(fixture.result.earthOrientation.sha256)
  expect(payload.result.radiusSourceSha256).toBe(fixture.result.radiusSourceSha256)
  await page.getByLabel('Foreground NAIF ID (Moon 301, Venus 299)').fill('299')
  await expect(result).toHaveCount(0)
})

test('station edits cancel contact requests and reject late results', async ({ page }) => {
  let release: (() => void) | undefined
  await page.route('**/solar-test-api/v1/observation/contacts', async route => {
    await new Promise<void>(resolve => { release = resolve })
    await route.fulfill({ json: fixture }).catch(() => undefined)
  })
  const requested = page.waitForRequest('**/solar-test-api/v1/observation/contacts')
  await page.getByRole('button', { name: 'Search ground contacts', exact: true }).click()
  await requested
  await page.getByLabel('Latitude °', { exact: true }).fill('33')
  release?.()
  await expect(page.getByRole('region', { name: 'Ground contact result' })).toHaveCount(0)
  await page.locator('.ground-contacts > summary').click()
  await expect(page.getByRole('button', { name: 'Search ground contacts', exact: true })).toBeEnabled()
})

test('missing source configuration remains an error without fabricated contacts', async ({ page }) => {
  await page.route('**/solar-test-api/v1/observation/contacts', route => route.fulfill({ status: 503, json: { error: { code: 'body_radii_unavailable', message: 'No pinned PCK radii configured' } } }))
  await page.getByRole('button', { name: 'Search ground contacts', exact: true }).click()
  await expect(page.locator('.ground-contacts').getByRole('alert')).toContainText('No pinned PCK')
  await expect(page.getByRole('region', { name: 'Ground contact result' })).toHaveCount(0)
})
