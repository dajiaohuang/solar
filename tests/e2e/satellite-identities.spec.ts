import { expect, test } from './fixtures'

test('keeps source-backed fallback identities selectable with an explicit diagnostic model', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  // Outside the shipped satellite window: the explicit fallback seed remains a
  // diagnostic two-body position, while the source coverage boundary is shown
  // in the body evidence rather than being presented as a precise SPK state.
  await page.goto('?v=4&lang=en&ref=jupiter&bodies=jupiter,naif:55501&focused=naif:55501&jd=2466154.5&history=1')
  await expect(page.locator('.segmented-control').getByRole('button', { name: '3D', exact: true })).toHaveClass(/active/)
  await page.getByRole('button', { name: /Show body details/ }).click()
  await expect(page.getByTestId('satellite-identity')).toContainText('NAIF 55501')
  await expect(page.getByTestId('body-model')).toContainText('Elliptic two-body Kepler propagation')
  await page.getByRole('tab', { name: 'Sources', exact: true }).click()
  await expect(page.locator('.inspector-panel a[href="https://ssd.jpl.nasa.gov/sats/discovery.html"]')).toBeVisible()
  expect(errors).toEqual([])
})

test('does not draw a misleading origin when a fallback satellite is used as reference', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('?v=4&lang=en&ref=naif:55501&bodies=jupiter,naif:55501&jd=2466154.5&history=1')
  await expect(page.locator('.frame-overlays .canvas-error[role="status"]')).toContainText('reference')
  await expect(page.locator('.frame-view canvas')).toHaveCount(0)
  expect(errors).toEqual([])
})
