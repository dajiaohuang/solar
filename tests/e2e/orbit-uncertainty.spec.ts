import { readFile } from 'node:fs/promises'
import { expect, test } from './fixtures'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
})

test('imports joint Bennu uncertainty and exports source-preserving coordinates', async ({ page }) => {
  await page.goto('./?v=4&page=about&lang=en')
  const panel = page.getByRole('region', { name: 'Orbit uncertainty', exact: true })
  const result = panel.getByTestId('orbit-uncertainty-result')
  await panel.getByLabel('SBDB covariance JSON file').setInputFiles('tests/fixtures/sbdb-bennu-covariance.json')
  await expect(panel).toContainText('101955 / 118')
  await expect(panel).toContainText('JD 2455562.5 TDB')
  await expect(panel).toContainText('e, q, tp, node, peri, i, RHO, AMRAT')
  await expect(result).toHaveCount(0)
  await panel.getByRole('button', { name: 'Adopt DE440 GM and calculate' }).click()
  await expect(result.getByRole('row')).toHaveCount(9)
  await expect(result.getByRole('img')).toHaveCount(4)
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  for (const ellipse of await result.locator('ellipse').all()) {
    expect(Number(await ellipse.getAttribute('rx'))).toBeGreaterThan(0)
    expect(Number(await ellipse.getAttribute('ry'))).toBeGreaterThan(0)
  }
  const volume = result.getByRole('img', { name: 'Rotatable 3D covariance ellipsoid' })
  await expect(volume.locator('polyline')).toHaveCount(17)
  await expect(result).toContainText('19.87% 3D Gaussian probability mass')
  const original = await volume.locator('polyline').first().getAttribute('points')
  await result.getByLabel('Ellipsoid azimuth', { exact: false }).press('ArrowRight')
  await expect(volume.locator('polyline').first()).not.toHaveAttribute('points', original!)
  await result.getByLabel('Ellipsoid contour', { exact: true }).selectOption('2')
  await expect(result).toContainText('97.07% 3D Gaussian probability mass')
  await result.getByRole('button', { name: 'Reset ellipsoid view' }).click()
  await expect(volume.locator('polyline').first()).toHaveAttribute('points', original!)
  await result.locator('.covariance-ellipsoid').screenshot({ path: test.info().outputPath('covariance-ellipsoid.png') })
  await panel.screenshot({ path: test.info().outputPath('orbit-uncertainty.png') })
  const pending = page.waitForEvent('download')
  await panel.getByRole('button', { name: 'Export covariance and source JSON' }).click()
  const download = await pending
  const data = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(data.sourceSha256).toBe('8cc7ff03d7fec9e15016d7ab0e78edc7a0e4d69227a322cde7190518a24ccb90')
  expect(data.source.solutionEpochTdb).toBe(2455562.5)
  expect(data.result.matrix).toHaveLength(8)
  expect(data.result.matrix.every((row: number[]) => row.length === 8)).toBe(true)
  expect(data.result.labels.slice(6)).toEqual(['RHO', 'AMRAT'])
  expect(data.positionEllipsoid.rank).toBe(3)
  expect(data.positionEllipsoid.units).toBe('km')
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const value = data.positionEllipsoid.factor[i].reduce((sum: number, factor: number, k: number) => sum+factor*data.positionEllipsoid.factor[j][k], 0)
    expect(Math.abs(value/(data.result.matrix[i][j]*149597870.7**2)-1)).toBeLessThan(1e-12)
  }
  await panel.getByLabel('SBDB covariance JSON file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
  await expect(panel.getByRole('alert')).toBeVisible()
  await expect(result).toHaveCount(0)
  await expect(panel).not.toContainText('101955 / 118')
  await panel.getByRole('button', { name: 'Clear uncertainty data' }).click()
  await expect(panel.getByRole('alert')).toHaveCount(0)
})

test('Chinese import rejects oversized source files before calculation', async ({ page }) => {
  await page.goto('./?v=4&page=about&lang=zh')
  const panel = page.getByRole('region', { name: '轨道不确定性', exact: true })
  await panel.getByLabel('SBDB 协方差 JSON 文件').setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 32) })
  await expect(panel.getByRole('alert')).toContainText('文件超过 2 MiB 上限')
  await expect(panel.getByTestId('orbit-uncertainty-result')).toHaveCount(0)
})
