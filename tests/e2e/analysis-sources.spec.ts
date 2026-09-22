import { readFile } from 'node:fs/promises'
import { expect, test } from './fixtures'

test('strict mission coverage fails explicitly and approximate exports retain source and endpoints', async ({ page }) => {
  await page.route('**/data/ephemerides/**', route => route.abort())
  await page.goto('./?v=4&page=mission&lang=en')
  await page.getByLabel('State source policy').selectOption('require-spk')
  await page.getByRole('button', { name: 'Compute transfer' }).click()
  await expect(page.locator('.error-banner')).toContainText('Strict SPK')
  await expect(page.locator('.metric > span').filter({ hasText: /^C3$/ })).toHaveCount(0)

  await page.getByLabel('State source policy').selectOption('prefer-spk')
  await page.getByRole('button', { name: 'Compute transfer' }).click()
  await expect(page.getByTestId('analysis-source-summary')).toContainText('SPK 0 · Approximate 2')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON' }).click()
  const download = await downloaded
  const payload = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(payload.solution.ephemeris.policy).toBe('prefer-spk')
  expect(payload.solution.ephemeris.bodies.map((body: { model: string }) => body.model)).toEqual(['approximate-fallback', 'approximate-fallback'])
  expect(payload.solution.endpoints).toMatchObject({ departureBodyId: 'earth', arrivalBodyId: 'mars' })
})

test('strict event jobs expose missing coverage without publishing a fallback timeline', async ({ page }) => {
  await page.route('**/data/ephemerides/**', route => route.abort())
  await page.goto('./?v=4&page=events&lang=en')
  await page.getByLabel('State source policy').selectOption('require-spk')
  await page.getByRole('button', { name: 'Run analysis' }).click()
  await expect(page.locator('.event-config .error-banner')).toContainText('Strict SPK')
  await expect(page.locator('.event-timeline button')).toHaveCount(0)
})
