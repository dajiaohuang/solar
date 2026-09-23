import { readFile } from 'node:fs/promises'
import { expect, test } from './fixtures'
import reference from '../fixtures/de440-dynamics-reference.json' with { type: 'json' }
import relativistic from '../fixtures/de440-solar-1pn-reference.json' with { type: 'json' }
import conics from '../fixtures/conic-diagnostics-reference.json' with { type: 'json' }

test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete')) })

test('real worker integrates pinned Eros sources and exports the shared numerical result', async ({ page }) => {
  await page.goto('./?v=4&page=about&lang=en')
  const panel = page.getByRole('region', { name: 'Dynamics laboratory', exact: true })
  await panel.getByRole('button', { name: 'Load source-backed Eros example' }).click()
  await expect(panel).toContainText(`JD ${reference.referenceEpochTdb} TDB`)
  await panel.getByLabel('Compare finer numerical settings (one additional integration)').check()
  await panel.getByRole('button', { name: 'Adopt DE440 point masses and run' }).click()
  const result = panel.getByTestId('dynamics-result')
  await expect(result.getByRole('row')).toHaveCount(7)
  await expect(result).toContainText('191 m')
  await expect(result.getByRole('img')).toHaveCount(3)
  await expect(result.getByTestId('dynamics-refinement')).toContainText('not a global error bound')
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await panel.screenshot({ path: test.info().outputPath('dynamics-laboratory.png') })
  const pending = page.waitForEvent('download')
  await result.getByRole('button', { name: 'Export experiment and sources JSON' }).click()
  const receipt = JSON.parse(await readFile((await (await pending).path())!, 'utf8'))
  expect(receipt.forceModel.masses).toHaveLength(11)
  expect(receipt.forceModel.masses.map((mass: {naifId: number}) => mass.naifId)).not.toContain(3)
  expect(receipt.initialFile.payload.sourceFiles).toEqual(reference.sources)
  expect(receipt.transitionMatrix.values).toHaveLength(36)
  expect(receipt.trajectory.samples.at(-1).stateKmKmPerSecond).toEqual(receipt.finalStateKmKmPerSecond)
  expect(receipt.refinement.endpointPositionDifferenceKm).toBeLessThan(1e-4)
  const expected = reference.cases.find(row => row.duration === 2592000)!
  expect(Math.hypot(...receipt.finalStateKmKmPerSecond.slice(0, 3).map((value: number, i: number) => value-expected.result[i]))).toBeLessThan(1e-4)
  await panel.getByLabel('Duration (TDB days)').fill('-10')
  await expect(result).toHaveCount(0)
  await panel.getByLabel('Initial condition JSON file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
  await expect(panel.getByRole('alert')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Adopt DE440 point masses and run' })).toBeDisabled()
})

test('cancelling a held ephemeris request cannot publish a stale result', async ({ page }) => {
  await page.goto('./?v=4&page=about&lang=en')
  let release: (() => void) | undefined
  await page.route('**/data/ephemerides/de440s-2000-01-01-2051-01-01.bsp', async route => {
    await new Promise<void>(resolve => { release = resolve })
    await route.abort().catch(() => undefined)
  })
  const panel = page.getByRole('region', { name: 'Dynamics laboratory', exact: true })
  await panel.getByRole('button', { name: 'Load source-backed Eros example' }).click()
  const requested = page.waitForRequest('**/data/ephemerides/de440s-2000-01-01-2051-01-01.bsp')
  await panel.getByRole('button', { name: 'Adopt DE440 point masses and run' }).click()
  await requested
  await panel.getByRole('button', { name: 'Cancel experiment' }).click()
  release?.()
  await expect(panel.getByTestId('dynamics-result')).toHaveCount(0)
  await expect(panel.getByRole('alert')).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Adopt DE440 point masses and run' })).toBeEnabled()
})

test('solar 1PN is explicitly adopted and exports its independently checked trajectory', async ({ page }) => {
  await page.goto('./?v=4&page=about&lang=en')
  const panel = page.getByRole('region', { name: 'Dynamics laboratory', exact: true })
  await panel.getByRole('button', { name: 'Load source-backed Eros example' }).click()
  const adoption = panel.getByLabel('Adopt solar first post-Newtonian correction (1PN)')
  await expect(adoption).not.toBeChecked()
  await adoption.check()
  await expect(panel).toContainText('not full barycentric EIH')
  await panel.getByRole('button', { name: 'Adopt DE440 point masses and run' }).click()
  const result = panel.getByTestId('dynamics-result')
  await expect(result).toContainText('Solar 1PN adopted')
  await result.getByText('Inspect instantaneous orbit diagnostics', { exact: true }).click()
  await expect(result.getByRole('table', { name: 'Initial and final osculating orbit' }).getByRole('row')).toHaveCount(7)
  await expect(result).toContainText('J2000 equatorial plane')
  expect(await result.locator('.dynamics-diagnostics .uncertainty-table').evaluate(element => element.scrollWidth <= element.clientWidth+1)).toBe(true)
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth+1)).toBe(true)
  await result.locator('.dynamics-diagnostics').screenshot({ path: test.info().outputPath('orbit-diagnostics.png') })
  const pending = page.waitForEvent('download')
  await result.getByRole('button', { name: 'Export experiment and sources JSON' }).click()
  const receipt = JSON.parse(await readFile((await (await pending).path())!, 'utf8'))
  expect(receipt.calculation).toBe('restricted-de440-solar-1pn-experiment')
  expect(receipt.forceModel.solarRelativity.model).toBe('solar-monopole-1pn')
  const finalConic = conics.cases.find(row => row.name === 'Eros integrated 2592000 seconds')!
  expect(receipt.trajectory.samples.at(-1).osculating.eccentricity).toBeCloseTo(finalConic.eccentricity, 11)
  expect(receipt.trajectory.samples.at(-1).osculating.inclinationDeg).toBeCloseTo(finalConic.inclinationDeg, 9)
  expect(receipt.diagnostics.limitation).toContain('not conserved')
  const target = relativistic.cases.find(row => row.duration === 2592000)!
  expect(Math.hypot(...receipt.finalStateKmKmPerSecond.slice(0, 3).map((value: number, i: number) => value-target.result[i]))).toBeLessThan(1e-4)
  await adoption.uncheck()
  await expect(result).toHaveCount(0)
})

test('Chinese import keeps unit and frame validation explicit', async ({ page }) => {
  await page.goto('./?v=4&page=about&lang=zh')
  const panel = page.getByRole('region', { name: '动力学实验室', exact: true })
  await panel.getByLabel('初始条件 JSON 文件').setInputFiles('src/data/dynamics-eros-example.json')
  await expect(panel).toContainText('Eros')
  await panel.getByLabel('积分时长（TDB 天）').fill('366')
  await panel.getByRole('button', { name: '采用 DE440 点质量模型并运行' }).click()
  await expect(panel.getByRole('alert')).toContainText('±365')
  await expect(panel.getByTestId('dynamics-result')).toHaveCount(0)
})

test('initial conditions round-trip and corrupted source never produces a trajectory', async ({ page }) => {
  await page.goto('./?v=4&page=about&lang=en')
  const panel = page.getByRole('region', { name: 'Dynamics laboratory', exact: true })
  await panel.getByRole('button', { name: 'Load source-backed Eros example' }).click()
  await panel.getByText('Inspect initial coordinates and velocity', { exact: true }).click()
  await expect(panel.locator('details table tr')).toHaveCount(6)
  const pending = page.waitForEvent('download')
  await panel.getByRole('button', { name: 'Export initial conditions JSON' }).click()
  const path = (await (await pending).path())!
  const initial = JSON.parse(await readFile(path, 'utf8'))
  expect(initial.initial).toEqual(reference.initial)
  await panel.getByLabel('Initial condition JSON file').setInputFiles(path)
  await page.route('**/data/ephemerides/de440s-2000-01-01-2051-01-01.bsp', route => route.fulfill({ body: Buffer.alloc(5558272), contentType: 'application/octet-stream' }))
  await panel.getByRole('button', { name: 'Adopt DE440 point masses and run' }).click()
  await expect(panel.getByRole('alert')).toContainText('checksum mismatch')
  await expect(panel.getByTestId('dynamics-result')).toHaveCount(0)
})
