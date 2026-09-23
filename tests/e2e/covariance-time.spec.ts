import { readFile } from 'node:fs/promises'
import { expect, test } from './fixtures'
import reference from '../fixtures/dynamics-covariance-reference.json' with { type: 'json' }

test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete')) })

test('real worker propagates covariance and exports independently checked conditional results', async ({ page }) => {
  await page.goto('./?v=4&page=about&lang=en')
  const panel = page.getByRole('region', { name: 'Orbit uncertainty', exact: true })
  await panel.getByLabel('SBDB covariance JSON file').setInputFiles('tests/fixtures/sbdb-eros-covariance.json')
  await panel.getByText('Propagate formal covariance in time', { exact: true }).click()
  await panel.getByLabel('Adopt solar 1PN for covariance propagation').check()
  await panel.getByRole('button', { name: 'Adopt conditional DE440 model and propagate' }).click()
  const result = panel.getByTestId('covariance-time-result')
  await expect(result).toContainText('2592000 s')
  await expect(result.getByRole('row')).toHaveCount(7)
  await expect(result.getByRole('img')).toHaveCount(1)
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth+1)).toBe(true)
  await result.screenshot({ path: test.info().outputPath('propagated-covariance.png') })
  const pending = page.waitForEvent('download')
  await result.getByRole('button', { name: 'Export propagated covariance and sources JSON' }).click()
  const receipt = JSON.parse(await readFile((await (await pending).path())!, 'utf8'))
  expect(receipt.sourceFile.sha256).toBe(reference.sourceSha256)
  expect(receipt.experiment.forceModel.solarRelativity.model).toBe('solar-monopole-1pn')
  const target = reference.cases.find(row => row.solar1pn && row.durationSeconds === 2592000)!
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    expect(Math.abs(receipt.finalCoordinates.matrix[i][j]-target.matrix[i][j])/Math.sqrt(target.matrix[i][i]*target.matrix[j][j])).toBeLessThan(2e-9)
  }
  await panel.getByLabel('Covariance duration (TDB days)').fill('-10')
  await expect(result).toHaveCount(0)
  await panel.getByLabel('SBDB covariance JSON file').setInputFiles('tests/fixtures/sbdb-bennu-covariance.json')
  await panel.getByText('Propagate formal covariance in time', { exact: true }).click()
  await expect(panel).toContainText('Extra source parameters have no matched force derivatives')
  await expect(panel.getByRole('button', { name: 'Adopt conditional DE440 model and propagate' })).toHaveCount(0)
})

test('replacing a source while its worker fetch is pending cannot publish stale covariance', async ({ page }) => {
  await page.goto('./?v=4&page=about&lang=zh')
  let release: (() => void) | undefined
  await page.route('**/data/ephemerides/de440s-2000-01-01-2051-01-01.bsp', async route => {
    await new Promise<void>(resolve => { release = resolve })
    await route.abort().catch(() => undefined)
  })
  const panel = page.getByRole('region', { name: '轨道不确定性', exact: true })
  await panel.getByLabel('SBDB 协方差 JSON 文件').setInputFiles('tests/fixtures/sbdb-eros-covariance.json')
  await panel.getByText('随时间传播形式协方差', { exact: true }).click()
  const requested = page.waitForRequest('**/data/ephemerides/de440s-2000-01-01-2051-01-01.bsp')
  await panel.getByRole('button', { name: '采用条件 DE440 模型并传播' }).click()
  await requested
  await panel.getByRole('button', { name: '取消协方差传播' }).click()
  release?.()
  await expect(panel.getByTestId('covariance-time-result')).toHaveCount(0)
  await expect(panel.getByRole('alert')).toHaveCount(0)
  const secondRequest = page.waitForRequest('**/data/ephemerides/de440s-2000-01-01-2051-01-01.bsp')
  await panel.getByRole('button', { name: '采用条件 DE440 模型并传播' }).click()
  await secondRequest
  await panel.getByLabel('SBDB 协方差 JSON 文件').setInputFiles('tests/fixtures/sbdb-bennu-covariance.json')
  release?.()
  await expect(panel).toContainText('101955 / 118')
  await expect(panel.getByTestId('covariance-time-result')).toHaveCount(0)
  await expect(panel.getByRole('alert')).toHaveCount(0)
})
