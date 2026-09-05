import { expect, test, type Locator, type Page } from '@playwright/test'

test('preview evidence never requests full-backend coverage', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => { if (/\/v1\/(coverage|catalog\/manifest)/.test(request.url())) requests.push(request.url()) })
  await page.goto('?v=4&page=about&lang=en&view=3d')
  const panel = page.getByTestId('source-coverage-report')
  await expect(panel).toContainText('This preview does not request the full-backend audit')
  await expect(panel.getByRole('button')).toHaveCount(0)
  expect(requests).toEqual([])
})

test.beforeEach(async ({ request }) => {
  const response = await request.get('build-info.json')
  expect(response.ok(), 'Preview tests require a completed production artifact').toBe(true)
  expect((await response.json()).productProfile, 'Do not test while another profile is being built into dist').toBe('preview')
})

// aria-disabled controls deliberately remain interactive for explanations.
// Playwright's click/tap waits for enabled; use a real keyboard or touch event.
async function askWhy(page: Page, control: Locator, touch: boolean) {
  await expect(control).toBeVisible()
  await expect(control).toHaveAttribute('aria-disabled', 'true')
  if (touch) {
    await control.scrollIntoViewIfNeeded()
    const box = await control.boundingBox()
    if (!box) throw new Error('Restricted control has no touch target')
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
  } else {
    await control.focus()
    await control.press('Enter')
  }
}

test('retains a denied URL through dismiss/review and explicitly returns to the preview', async ({ page }, info) => {
  const errors: string[] = [], requests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => requests.push(request.url()))
  await page.goto('?v=4&lang=en&page=mission&bodies=earth,naif%3A65297&view=3d&history=12053#original-intent', { waitUntil: 'domcontentloaded' })
  const original = page.url()
  const dialog = page.locator('dialog.preview-availability')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('textarea')).toHaveValue(original)
  await expect(page.locator('.mission-workspace')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(page.url()).toBe(original)
  await page.locator('.preview-profile-button').click()
  await expect(dialog.locator('textarea')).toHaveValue(original)
  await page.screenshot({ path: info.outputPath('retained-scene.png') })
  await dialog.locator('.primary-button').click()
  await expect.poll(() => new URL(page.url()).searchParams.get('page')).not.toBe('mission')
  await expect(page.locator('.explorer-workspace')).toBeVisible()
  expect(requests.filter(url => /\/(chunks|lookup|search)\/|sbdb\.api|\.bsp(?:\?|$)/.test(url))).toEqual([])
  expect(errors).toEqual([])
})

test('keyboard and touch explain a restricted preset without changing the scene', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('?v=4&lang=en', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.first-run-choice')).toBeVisible()
  // Finish the real first-visit choice before touching the preset below it.
  // On small screens the fixed guide can otherwise cover the touch target.
  await page.getByRole('button', { name: 'Explore independently', exact: true }).click()
  await expect(page.locator('.first-run-choice')).toHaveCount(0)
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible()
  const preset = page.locator('.preset-list button[aria-disabled="true"]').first()
  const before = await page.locator('.frame-label').innerText()
  await askWhy(page, preset, info.project.name.includes('mobile'))
  const dialog = page.locator('dialog.preview-availability')
  await expect(dialog).toBeVisible()
  await expect(page.locator('.frame-label')).toHaveText(before, { useInnerText: true })
  await expect(preset).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.advanced-controls')).not.toHaveAttribute('open', '')
  await page.screenshot({ path: info.outputPath('preset-restriction.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  expect(errors).toEqual([])
})

test('back and forward preserve denied intent until explicit preview reconciliation', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => requests.push(request.url()))
  await page.goto('?v=4&lang=en&page=mission&view=3d#retained-history', { waitUntil: 'domcontentloaded' })
  const denied = page.url()
  const dialog = page.locator('dialog.preview-availability')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Dismiss', exact: true }).click()
  // Add a permitted same-document entry, then use real browser history to
  // revisit the denied entry. No store or availability implementation mocks.
  await page.evaluate(() => {
    history.pushState({}, '', '?v=4&lang=en&page=about&view=3d')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page.locator('.evidence-workspace')).toBeVisible()
  await expect(page.locator('.dataset-card')).toContainText('Source catalog objects')
  await expect(page.locator('.dataset-card')).toContainText('8,000')
  await expect(page.locator('.dataset-card .preview-source-boundary')).toContainText('not this preview')
  await page.goBack()
  await expect(dialog.locator('textarea')).toHaveValue(denied)
  await expect(page.locator('.evidence-workspace')).toBeVisible()
  await expect(page.locator('.mission-workspace')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await page.goForward()
  await expect(dialog).not.toBeVisible()
  await expect(page).toHaveURL(/page=about/)
  await page.goBack()
  await expect(dialog.locator('textarea')).toHaveValue(denied)
  await dialog.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await page.getByRole('button', { name: '切换为中文', exact: true }).click()
  await expect(page.locator('.dataset-card')).toContainText('源目录天体数')
  await expect(page.locator('.dataset-card .preview-source-boundary')).toContainText('不代表此预览')
  // Wait beyond the intentional 500 ms continuous-state URL debounce.
  await page.waitForTimeout(700)
  expect(page.url()).toBe(denied)
  const historyLength = await page.evaluate(() => history.length)
  await page.locator('.preview-profile-button').click()
  await expect(dialog.locator('textarea')).toHaveValue(denied)
  await dialog.locator('.primary-button').click()
  await expect(page).toHaveURL(/page=about/)
  await expect(page).toHaveURL(/lang=zh/)
  expect(await page.evaluate(() => history.length)).toBe(historyLength)
  expect(requests.filter(url => /\/(chunks|lookup|search)\/|sbdb\.api/.test(url))).toEqual([])
})

test('global body search refuses selection atomically and keeps full-only results visible', async ({ page }, info) => {
  await page.goto('?v=4&lang=en', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.first-run-choice')).toBeVisible()
  await page.locator('.command-button').click()
  const palette = page.locator('.command-palette')
  await palette.locator('input').fill('Dysnomia')
  const result = palette.getByRole('option').filter({ hasText: 'Dysnomia' }).first()
  await expect(result).toContainText('Full version')
  const before = await page.locator('.frame-label').innerText()
  await askWhy(page, result, info.project.name.includes('mobile'))
  await expect(page.locator('dialog.preview-availability')).toBeVisible()
  await expect(palette).toHaveCount(0)
  await expect(page.locator('.frame-label')).toHaveText(before, { useInnerText: true })
  await expect(page.locator('.inspector-toggle')).toContainText('Earth')
})

test('real preview artifacts support curated 3D and the pinned belt sample without full downloads', async ({ page }, info) => {
  const requests: string[] = [], errors: string[] = [], failed: string[] = []
  page.on('request', request => requests.push(request.url()))
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => { if (!response.ok() && response.url().includes('/data/')) failed.push(`${response.status()} ${response.url()}`) })
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('?v=4&lang=en', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible()
  await expect(page.locator('.ephemeris-status > summary')).toContainText('7/7', { timeout: 25_000 })
  expect(requests.filter(url => /catalog-sample-/.test(url))).toEqual([])
  await page.getByTestId('preset-mars-main-belt-jupiter').click()
  await expect(page.locator('.element-scatter')).toBeVisible()
  await expect.poll(() => requests.filter(url => /catalog-sample-mobile\.(?:bin|json\.gz)$/.test(url)).length).toBe(2)
  const sampleCaption = page.locator('.sample-caption')
  await expect(sampleCaption).not.toContainText(' 0 /')
  await expect(page).toHaveURL(/catalogSampleCount=8000/)
  const replay = page.url()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('.element-scatter')).toBeVisible()
  await expect(page).toHaveURL(replay)
  expect(requests.filter(url => /\/(chunks|lookup|search|binary)\/|catalog-index\.bin|catalog-sample-desktop|sbdb\.api/.test(url))).toEqual([])
  expect(requests.filter(url => url.includes('/data/asteroids/')).every(url => url.includes('/preview/'))).toBe(true)
  expect(failed).toEqual([])
  expect(errors).toEqual([])
  await page.screenshot({ path: info.outputPath('real-curated-belt.png') })
})
