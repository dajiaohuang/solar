import { expect, test } from './fixtures'

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

test('loads the declared SAT415 center pool for Janus in 3D', async ({ page }) => {
  const kernels: string[] = []
  page.on('request', request => { if (request.url().endsWith('.bsp')) kernels.push(request.url()) })
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&lang=en&view=3d&ref=saturn&bodies=saturn,naif:610&focused=naif:610&jd=2461287.5&speed=0&history=1')
  await expect(page.getByTestId('ephemeris-status').locator('summary')).toContainText('2/2', { timeout: 30_000 })
  expect(kernels.some(url => url.includes('de437-sat415-satellite-2020-2031.bsp'))).toBe(true)
  expect(kernels.some(url => url.includes('satellite-naif-sat415-610-'))).toBe(true)
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible()
})

test('does not borrow a different core when the SAT415 dependency fails', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.route('**/de437-sat415-satellite-2020-2031.bsp', route => route.fulfill({ status: 503, body: 'unavailable' }))
  await page.goto('./?v=4&lang=en&view=3d&ref=saturn&bodies=saturn,naif:610&focused=naif:610&jd=2461287.5&speed=0&history=1')
  const status = page.getByTestId('ephemeris-status')
  await expect(status.locator('summary')).not.toContainText('Loading', { timeout: 30_000 })
  await expect(status.locator('summary')).toContainText('1/2')
  await status.locator('summary').click()
  await expect(status.getByRole('alert')).toContainText('HTTP 503')
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible()
})

test('renders the original Daphnis Type 17 state with its historical center pool', async ({ page }) => {
  const errors: string[] = []
  const kernels: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().endsWith('.bsp')) kernels.push(request.url()) })
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&lang=en&view=3d&ref=saturn&bodies=saturn,naif:635&focused=naif:635&jd=2461287.5&speed=0&history=1')
  await expect(page.getByTestId('ephemeris-status').locator('summary')).toContainText('2/2', { timeout: 30_000 })
  expect(kernels.some(url => url.includes('sat393-embedded-satellite-2020-2031.bsp'))).toBe(true)
  expect(kernels.some(url => url.includes('satellite-daphnis-sat393-635-2020-2031.bsp'))).toBe(true)
  await expect(page.locator('.compute-progress')).toHaveCount(0)
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible()
  expect(errors).toEqual([])
})

test('loads all TNO companion roots with their original primary/system dependencies', async ({ page }) => {
  const errors: string[] = []
  const kernels: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().endsWith('.bsp')) kernels.push(request.url()) })
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&lang=en&view=3d&speed=0')
  for (const [parent, count] of [['eris', 2], ['haumea', 3]] as const) {
    await page.getByTestId(`preset-${parent}-spk-moons`).click()
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('ephemeris-status').locator('summary')).toContainText(`${count}/${count}`, { timeout: 30_000 })
    await expect(page.locator('.compute-progress')).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`[?&]ref=${parent}(?:&|$)`))
    await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible()
    expect(kernels.some(url => url.includes(`tnosat-${parent}-`))).toBe(true)
    expect(kernels.some(url => url.includes(`satellite-${parent}-`))).toBe(true)
  }
  expect(errors).toEqual([])
})

test('does not substitute a system center when a TNO primary dependency is missing', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.route('**/tnosat-haumea-v001b-2020-01-01-2030-01-02.bsp', route => route.fulfill({ status: 503, body: 'unavailable' }))
  await page.goto('./?v=4&lang=en&view=3d&ref=haumea&bodies=haumea,naif:120136108,naif:220136108&focused=naif:120136108&jd=2461287.5&speed=0')
  const status = page.getByTestId('ephemeris-status')
  await expect(status.locator('summary')).not.toContainText('Loading', { timeout: 30_000 })
  await expect(status.locator('summary')).toContainText('0/3')
  await status.locator('summary').click()
  await expect(status.getByRole('alert')).toContainText('HTTP 503')
})

test('loads eight original binary systems and omits their positions outside the Pages interval', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&lang=en&view=3d&speed=0')
  for (const parent of ['quaoar', 'orcus', 'salacia', '1998ww31', '2001qw322', 'kagara', '1999oj4', '2003un284']) {
    await page.getByTestId(`preset-${parent}-spk-moons`).click()
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('ephemeris-status').locator('summary')).toContainText('2/2', { timeout: 30_000 })
    await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`[?&]ref=${parent}(?:&|$)`))
  }
  await page.goto('./?v=4&lang=en&view=3d&ref=quaoar&bodies=quaoar,naif:120050000&focused=naif:120050000&jd=2460000.5&speed=0')
  await expect(page.getByTestId('ephemeris-status').locator('summary')).not.toContainText('Loading', { timeout: 30_000 })
  await expect(page.getByTestId('ephemeris-status').locator('summary')).toContainText('0/2')
  await expect(page.locator('.frame-overlays .canvas-error[role="status"]')).toContainText('reference')
  await expect(page.locator('.frame-view canvas')).toHaveCount(0)
  expect(errors).toEqual([])
})
