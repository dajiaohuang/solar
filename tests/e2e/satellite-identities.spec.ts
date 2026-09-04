import { expect, test } from './fixtures'

test('keeps ephemeris-only identities selectable and their missing-state notices separate', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  // Outside the shipped satellite window: a catalog identity is not an orbit.
  await page.goto('?v=4&lang=en&ref=jupiter&bodies=jupiter,naif:506&focused=naif:506&jd=2466154.5&history=1')
  const position = page.getByTestId('missing-position-notice')
  const trail = page.getByTestId('missing-trajectory-notice')
  await expect(position).toBeVisible()
  await expect(trail).toBeVisible()
  await expect(page.locator('.segmented-control').getByRole('button', { name: '3D', exact: true })).toHaveClass(/active/)
  const boxes = await Promise.all([position.boundingBox(), trail.boundingBox()])
  expect(boxes[1]!.y).toBeGreaterThanOrEqual(boxes[0]!.y + boxes[0]!.height)
  await position.locator('summary').click()
  await expect(position.locator('p')).toHaveText('Himalia')
  await page.getByRole('button', { name: /Show body details/ }).click()
  await expect(page.getByTestId('satellite-identity')).toContainText('NAIF 506')
  await expect(page.getByTestId('body-model')).toContainText('No orbital propagation model')
  await page.getByRole('tab', { name: 'Sources', exact: true }).click()
  await expect(page.locator('.inspector-panel a[href="https://ssd.jpl.nasa.gov/sats/discovery.html"]')).toBeVisible()
  expect(errors).toEqual([])
})

test('does not draw a misleading origin when an ephemeris-only reference is outside coverage', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('?v=4&lang=en&ref=naif:506&bodies=jupiter,naif:506&jd=2466154.5&history=1')
  await expect(page.locator('.frame-overlays .canvas-error[role="status"]')).toContainText('reference')
  await expect(page.locator('.frame-view canvas')).toHaveCount(0)
  expect(errors).toEqual([])
})
