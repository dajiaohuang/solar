import { expect, test } from '@playwright/test'

test('frames close moons at their own scale and preserves zoom, reset and portrait fit', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&lang=en&speed=0')
  await page.getByTestId('preset-mars-spk-moons').click()
  await page.waitForLoadState('networkidle')
  const canvas = page.getByTestId('trajectory-canvas-3d')
  await expect(page.getByTestId('ephemeris-status').locator('summary')).toContainText('3/3')
  await page.screenshot({ path: test.info().outputPath('mars-moons.png'), fullPage: true })
  await expect.poll(async () => Number(await canvas.getAttribute('data-camera-distance'))).toBeLessThan(.01)
  await expect(page).toHaveURL(/[?&]view=3d(?:&|$)/)
  await expect(page).toHaveURL(/[?&]history=1(?:&|$)/)
  await page.locator('.advanced-controls > summary').click()
  const originalDistance = Number(await canvas.getAttribute('data-camera-distance'))
  const originalScale = Number(await canvas.getAttribute('data-marker-scale'))
  expect(originalScale).toBeGreaterThan(0)
  expect(originalScale).toBeLessThan(.001)
  await canvas.hover()
  await page.mouse.wheel(0, -400)
  await expect.poll(async () => Number(await canvas.getAttribute('data-camera-distance'))).toBeLessThan(originalDistance)
  await page.locator('.view-reset').click()
  await expect.poll(async () => Number(await canvas.getAttribute('data-camera-distance')) / originalDistance).toBeCloseTo(1, 2)
  await page.setViewportSize({ width: 390, height: 1000 })
  await expect.poll(async () => Number(await canvas.getAttribute('data-camera-distance'))).toBeGreaterThan(originalDistance)
  await expect.poll(async () => Number(await canvas.getAttribute('data-marker-scale')) / originalScale).toBeCloseTo(1, 5)
  await expect.poll(async () => Number(await canvas.getAttribute('data-camera-distance'))).toBeLessThan(.01)
  expect(errors).toEqual([])
})

test('uses useful moon orbital units and distinguishes the active Earth center', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&lang=en&view=3d&ref=mars&bodies=mars,naif:401,naif:402&focused=naif:401&jd=2461287.5&speed=0&history=1')
  await expect(page.getByTestId('ephemeris-status').locator('summary')).toContainText('3/3')
  await page.locator('.inspector-toggle').click()
  await page.getByRole('tab', { name: 'Orbit', exact: true }).click()
  const inspector = page.locator('.inspector-panel')
  for (const label of ['Semi-major axis', 'Periapsis', 'Apoapsis']) {
    await expect(inspector.locator('.metric').filter({ has: page.getByText(label, { exact: true }) }).locator('strong')).toHaveText(/[1-9].* km$/)
  }
  await expect(inspector.locator('.metric').filter({ has: page.getByText('Orbital period', { exact: true }) }).locator('strong')).toHaveText(/^7\.\d+ h$/)
  await expect(inspector).toContainText('J2000 ecliptic')
  await expect(inspector).toContainText('not physical sizes')
  await page.goto('./?v=4&lang=en&focused=earth&ref=earth&bodies=earth,moon&jd=2461287.5&speed=0')
  await expect(page.getByTestId('ephemeris-status').locator('summary')).toContainText('2/2')
  await page.locator('.inspector-toggle').click()
  await page.getByRole('tab', { name: 'Context', exact: true }).click()
  await expect(inspector).toContainText('Earth geocenter from the active ephemeris')
  await expect(inspector).not.toContainText('Earth geocenter derived from the EMB seed')
  await page.goto('./?v=4&lang=zh&view=3d&ref=mars&bodies=mars,naif:401,naif:402&focused=naif:401&jd=2461287.5&speed=0&history=1')
  await expect(page.getByTestId('ephemeris-status').locator('summary')).toContainText('3/3')
  await page.locator('.inspector-toggle').click()
  await page.getByRole('tab', { name: '轨道', exact: true }).click()
  await expect(inspector).toContainText('近拱点')
  await expect(inspector).toContainText('远拱点')
  await expect(inspector).toContainText('并非真实尺寸')
  await expect(inspector).toContainText('J2000 黄道坐标')
})

test('keeps every moon-system preset in a bounded local 3D frame', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&lang=en&speed=0')
  for (const id of ['jupiter-spk-moons', 'saturn-spk-moons', 'uranus-spk-moons', 'neptune-spk-moons', 'pluto-spk-moons', 'eris-spk-moons', 'haumea-spk-moons', 'quaoar-spk-moons', 'orcus-spk-moons', 'salacia-spk-moons', '1998ww31-spk-moons', '2001qw322-spk-moons', 'earth-moon']) {
    await page.getByTestId(`preset-${id}`).click()
    await page.waitForLoadState('networkidle')
    // A first selection now loads an entire system's split original records.
    // Network-idle can occur between batches; wait for the application loader,
    // then separately bound trajectory computation after all inputs arrive.
    await expect(page.getByTestId('ephemeris-status').locator('summary')).not.toContainText('Loading', { timeout: 60_000 })
    await expect(page.locator('.compute-progress')).toHaveCount(0)
    const canvas = page.getByTestId('trajectory-canvas-3d')
    await expect(canvas).toBeVisible()
    // Irregular moons extend beyond the old close-moon scale. Test a physical
    // radius/FOV fit, not a fixed camera distance that clips larger systems.
    await expect.poll(async () => {
      const radius = Number(await canvas.getAttribute('data-scene-radius'))
      const distance = Number(await canvas.getAttribute('data-camera-distance'))
      const box = await canvas.boundingBox()
      if (!(radius > 0) || !box) return Infinity
      const halfFov = Math.min(21 * Math.PI / 180, Math.atan(Math.tan(21 * Math.PI / 180) * box.width / box.height))
      return distance * Math.sin(halfFov) / radius
    }, { message: `${id} should fit its actual physical radius with bounded padding` }).toBeCloseTo(1.2, 1)
    await expect.poll(async () => Number(await canvas.getAttribute('data-camera-distance'))).toBeGreaterThan(0)
    await expect(page).toHaveURL(/[?&]view=3d(?:&|$)/)
    await page.screenshot({ path: test.info().outputPath(`${id}.png`), fullPage: true })
  }
  expect(errors).toEqual([])
})
