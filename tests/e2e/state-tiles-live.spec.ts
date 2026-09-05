import { expect, test } from '@playwright/test'

const backend = process.env.SOLAR_TEST_BACKEND_URL?.replace(/\/+$/, '')

test('renders a real Go exact-state response in both Web views', async ({ page }) => {
  test.skip(!backend, 'Requires a running loopback Go backend with the staged full SPK profile')
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(backend!).hostname)
  const errors: string[] = []
  const requests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => requests.push(request.url()))
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  // Only transport routing is adapted. Every response body and header is
  // produced by the real Go process, never by the synthetic browser fixture.
  await page.route('**/solar-test-api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.split('/solar-test-api')[1]
    const upstream = await route.fetch({ url: `${backend}${path}` })
    await route.fulfill({ response: upstream })
  })
  await page.goto('./?v=4&lang=en&view=3d&speed=0&jd=2461287.5&ref=earth&bodies=earth,moon,mars')
  const viewport = page.getByTestId('trajectory-canvas-3d')
  await expect(viewport).toHaveAttribute('data-position-count', '3', { timeout: 30_000 })
  await expect.poll(() => requests.filter(url => url.endsWith('/v1/state/tiles')).length).toBeGreaterThan(0)
  await expect(page.getByTestId('ephemeris-status').locator('summary')).toContainText('3/3')
  await page.getByRole('button', { name: '2D', exact: true }).click()
  await expect(page.locator('canvas.trajectory-canvas')).toHaveAttribute('data-position-count', '3')
  expect(requests.filter(url => url.endsWith('/v1/current-states'))).toEqual([])
  expect(errors).toEqual([])
  await page.screenshot({ path: test.info().outputPath('real-go-state-tiles-2d.png') })
})
