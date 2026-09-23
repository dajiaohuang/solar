import { readFile } from 'node:fs/promises'
import { expect, test } from './fixtures'
import reference from '../fixtures/pck-orientation-reference.json' with { type: 'json' }

test('exports the original PCK orientation with source identity and clears stale results', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&page=about&lang=en')
  const panel = page.getByRole('region', { name: 'Body orientation', exact: true })
  await panel.getByLabel('Exact PCK body ID', { exact: true }).fill('401')
  await panel.getByLabel('TDB seconds past J2000', { exact: true }).fill('843523200')
  await panel.getByRole('button', { name: 'Evaluate source orientation', exact: true }).click()
  const result = panel.getByTestId('pck-orientation-result')
  await expect(result).toContainText('Source models: 75')
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  const pending = page.waitForEvent('download')
  await panel.getByRole('button', { name: 'Export orientation and source' }).click()
  const receipt = JSON.parse(await readFile((await (await pending).path())!, 'utf8'))
  expect(receipt.source.sha256).toBe(reference.sourceSha256)
  expect(receipt.orientation.naifPckId).toBe(401)
  expect(receipt.orientation.physicalOrientationUncertaintyRadians).toBeNull()
  expect(receipt.orientation.layout).toContain('body-fixed vector = matrix * J2000 vector')
  const expected = reference.cases.find(row => row.naifPckId === 401 && row.secondsPastJ2000Tdb === 843523200)!
  for (let i = 0; i < 9; i++) expect(Math.abs(receipt.orientation.j2000ToBodyFixed[i] - expected.j2000ToBodyFixed[i])).toBeLessThan(2e-10)
  await panel.screenshot({ path: test.info().outputPath('pck-orientation.png') })
  await panel.getByLabel('Exact PCK body ID', { exact: true }).fill('123456')
  await expect(result).toHaveCount(0)
  await panel.getByRole('button', { name: 'Evaluate source orientation', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('No orientation model')
  await panel.getByLabel('TDB seconds past J2000', { exact: true }).fill('')
  await panel.getByRole('button', { name: 'Evaluate source orientation', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('Enter the source ID')
})
