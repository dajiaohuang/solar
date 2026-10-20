import { readFile } from 'node:fs/promises'
import { expect, test } from './fixtures'
import reference from '../fixtures/spk-limb-reference.json' with { type: 'json' }

test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete')) })

test('real worker exports source-SPK limb with emission orientation and clears changed inputs', async ({ page }) => {
  await page.goto('./?v=4&page=about&lang=en')
  const panel = page.getByRole('region', { name: 'SPK ellipsoid limb', exact: true })
  await panel.getByRole('button', { name: 'Evaluate SPK limb', exact: true }).click()
  const result = panel.getByTestId('spk-limb-result')
  await expect(result).toContainText('CN · 301 ← 399')
  const pending = page.waitForEvent('download')
  await panel.getByRole('button', { name: 'Export SPK limb and sources' }).click()
  const receipt = JSON.parse(await readFile((await (await pending).path())!, 'utf8'))
  const sample = reference.cases.find(row => row.input.targetId === 301 && row.input.referenceEpochTdb === 2461287.5 && row.input.aberration === 'CN')!
  expect(receipt.kernel.sha256).toBe(reference.sources[0].sha256)
  expect(receipt.source.sha256).toBe(reference.sources[1].sha256)
  expect(receipt.reception.lightTimeSeconds).toBeGreaterThan(1)
  expect(Math.abs(receipt.orientation.secondsPastJ2000Tdb-sample.orientationEt)).toBeLessThan(3e-7)
  for (let i = 0; i < 3; i++) expect(Math.abs(receipt.observerJ2000Km[i]-sample.observerJ2000Km[i])).toBeLessThan(2e-6)
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth+1)).toBe(true)
  await panel.screenshot({ path: test.info().outputPath('spk-limb.png') })
  await panel.getByLabel('Limb light-time model', { exact: true }).selectOption('NONE')
  await expect(result).toHaveCount(0)
  await panel.getByRole('button', { name: 'Evaluate SPK limb', exact: true }).click()
  await expect(result).toContainText('NONE · 301 ← 399')
  await panel.getByLabel('Target NAIF ID', { exact: true }).fill('3')
  await expect(result).toHaveCount(0)
  await panel.getByRole('button', { name: 'Evaluate SPK limb', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('barycenters are not body centers')
})

test('cancels a pending SPK limb source and reports unavailable data without stale results', async ({ page }) => {
  await page.goto('./?v=4&page=about&lang=en')
  const releases: (() => void)[] = []
  const pattern = '**/data/ephemerides/de440s-2000-01-01-2051-01-01.bsp'
  await page.route(pattern, async route => {
    // Other source consumers may request the same URL. Keep every request
    // pending, rather than assuming the first belongs to this worker.
    await new Promise<void>(resolve => { releases.push(resolve) })
    await route.fulfill({ status: 503, body: 'source unavailable' }).catch(() => undefined)
  })
  const panel = page.getByRole('region', { name: 'SPK ellipsoid limb', exact: true })
  const requested = page.waitForRequest('**/data/ephemerides/de440s-2000-01-01-2051-01-01.bsp')
  await panel.getByRole('button', { name: 'Evaluate SPK limb', exact: true }).click()
  await requested
  await expect.poll(() => releases.length).toBeGreaterThan(0)
  await panel.getByRole('button', { name: 'Cancel limb calculation' }).click()
  await page.unroute(pattern)
  for (const release of releases) release()
  await expect(panel.getByTestId('spk-limb-result')).toHaveCount(0)
  await expect(panel.getByRole('alert')).toHaveCount(0)
  await page.route(pattern, route => route.fulfill({ status: 503, body: 'source unavailable' }))
  const second = page.waitForRequest('**/data/ephemerides/de440s-2000-01-01-2051-01-01.bsp')
  await panel.getByRole('button', { name: 'Evaluate SPK limb', exact: true }).click()
  await second
  await expect(panel.getByRole('alert')).toContainText('HTTP 503')
  await expect(panel.getByTestId('spk-limb-result')).toHaveCount(0)
})
