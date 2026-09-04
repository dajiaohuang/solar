import { expect, test } from '@playwright/test'

test('defers SPK downloads until the first-visit choice', async ({ page }) => {
  const kernels: string[] = []
  page.on('request', (request) => { if (request.url().endsWith('.bsp')) kernels.push(request.url()) })
  await page.goto('./?v=4&lang=en')
  const choice = page.getByRole('dialog', { name: 'How would you like to begin?' })
  await expect(choice).toBeVisible()
  expect(kernels).toEqual([])
  await choice.getByRole('button', { name: 'Explore independently' }).click()
  await expect(page.getByTestId('ephemeris-status').locator('summary')).toContainText('7/7', { timeout: 30_000 })
  expect(kernels.length).toBeGreaterThan(0)
})

test('loads moon-center SPK and distinct osculating/observation diagnostics', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&lang=en&view=3d&ref=mars&bodies=mars,naif:401,naif:402&focused=naif:401&jd=2461287.5&speed=0&history=30')
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible()
  await expect(page.getByTestId('ephemeris-status').locator('summary')).toContainText('3/3', { timeout: 30_000 })
  await page.locator('.inspector-toggle').click()
  await expect(page.getByTestId('body-model')).toContainText('JPL')
  await page.getByRole('tab', { name: 'Orbit', exact: true }).click()
  await expect(page.locator('.inspector-panel')).toContainText('osculating')
  const observation = page.locator('.inspector-panel details')
  await observation.locator('summary').click()
  await expect(observation).toContainText('Light-time correction:')
  await observation.getByRole('combobox').selectOption('geometric')
  await expect(observation).toContainText('Not applied')
  await expect(observation).not.toContainText('NaN')
  expect(errors).toEqual([])
  await page.screenshot({ path: test.info().outputPath('moon-spk-inspector.png'), fullPage: true })
})

test('loads precise states for unselected inspector and mission endpoints', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&lang=en&focused=naif:401&jd=2461287.5&speed=0')
  await page.locator('.inspector-toggle').click()
  await expect(page.getByTestId('body-model')).toContainText('JPL physical ephemerides', { timeout: 15_000 })
  const ceres = page.waitForResponse((response) => response.url().includes('sb441-n16-2000001-') && response.ok())
  await page.goto('./?v=4&page=mission&from=ceres&to=mars&depart=2026-11-15&arrive=2027-08-01&lang=en')
  await ceres
})

test('exposes failed SPK downloads as approximate fallback without breaking 3D', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.route('**/*.bsp', (route) => route.fulfill({ status: 503, body: 'unavailable' }))
  await page.goto('./?v=4&lang=en&view=3d')
  const status = page.getByTestId('ephemeris-status')
  await expect(status.locator('summary')).toContainText('0/7')
  await status.locator('summary').click()
  await expect(status.getByRole('alert')).toContainText('HTTP 503')
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible()
})
