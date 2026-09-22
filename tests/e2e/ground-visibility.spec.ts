import { readFile } from 'node:fs/promises'
import { expect, test } from './fixtures'
import fixture from '../fixtures/visibility-api-sun.json' with { type: 'json' }

test('visibility windows retain UTC boundaries and provenance on export', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.route('**/solar-test-api/v1/observation/windows', async route => {
    expect(route.request().postDataJSON()).toEqual(fixture.result.request)
    if (process.env.SOLAR_OBSERVER_LIVE_URL) {
      const response = await route.fetch({ url: `${process.env.SOLAR_OBSERVER_LIVE_URL}/v1/observation/windows` })
      await route.fulfill({ response })
    } else await route.fulfill({ json: fixture })
  })
  await page.goto('./?v=4&page=explorer&focused=sun&bodies=sun%2Cearth&ref=sun&speed=0&lang=en')
  await page.getByRole('button', { name: 'Show body details' }).click()
  await page.getByRole('tab', { name: 'Orbit', exact: true }).click()
  await page.locator('.ground-observer > summary').click()
  await page.getByLabel('UTC time', { exact: true }).fill(fixture.result.request.startUtc)
  await page.getByLabel('Longitude ° (east positive)', { exact: true }).fill('103.851959')
  await page.getByLabel('Latitude °', { exact: true }).fill('1.29027')
  await page.locator('.ground-visibility > summary').click()
  await page.getByLabel('End UTC', { exact: true }).fill(fixture.result.request.endUtc)
  await page.getByRole('button', { name: 'Search visibility windows', exact: true }).click()
  const result = page.getByRole('region', { name: 'Visibility window result' })
  await expect(result).toContainText('All sampled points are available')
  await expect(result).toContainText('2026-09-23T10:56:57.304688Z')
  await expect(result).toContainText('tolerance is not physical accuracy')
  await page.screenshot({ path: test.info().outputPath('ground-visibility.png'), fullPage: true })
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export windows and sources JSON', exact: true }).click()
  const download = await downloading
  const data = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(data.result.request).toEqual(fixture.result.request)
  expect(data.result.crossings).toEqual(fixture.result.crossings)
  expect(data.earthOrientation.sha256).toBe(fixture.earthOrientation.sha256)
  await page.getByLabel('Sun altitude limit', { exact: true }).selectOption('-6')
  await expect(result).toHaveCount(0)
})

test('visibility search cancels when its station changes', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  let release: (() => void) | undefined
  await page.route('**/solar-test-api/v1/observation/windows', async route => {
    await new Promise<void>(resolve => { release = resolve })
    await route.fulfill({ json: fixture }).catch(() => undefined)
  })
  await page.goto('./?v=4&page=explorer&focused=sun&bodies=sun%2Cearth&ref=sun&speed=0&lang=en')
  await page.getByRole('button', { name: 'Show body details' }).click()
  await page.getByRole('tab', { name: 'Orbit', exact: true }).click()
  await page.locator('.ground-observer > summary').click()
  await page.getByLabel('UTC time', { exact: true }).fill(fixture.result.request.startUtc)
  await page.locator('.ground-visibility > summary').click()
  const requested = page.waitForRequest('**/solar-test-api/v1/observation/windows')
  await page.getByRole('button', { name: 'Search visibility windows', exact: true }).click()
  await requested
  await page.getByLabel('Latitude °', { exact: true }).fill('45')
  release?.()
  await expect(page.getByRole('region', { name: 'Visibility window result' })).toHaveCount(0)
  await page.locator('.ground-visibility > summary').click()
  await expect(page.getByRole('button', { name: 'Search visibility windows', exact: true })).toBeEnabled()
})
