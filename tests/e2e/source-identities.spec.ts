import { expect, test } from './fixtures'

test('source directory is explicit, bounded, cursor-driven and clears stale evidence', async ({ page }) => {
  const hash = 'b'.repeat(64)
  let requests = 0, invalid = false
  await page.route('**/solar-test-api/v1/catalog/manifest', route => route.fulfill({ json: {
    apiVersion: 'solar.api/v1', catalogVersion: 'fixture-v1', catalogManifestSha256: 'a'.repeat(64), inventoryManifestSha256: hash,
  } }))
  await page.route('**/solar-test-api/v1/identities?*', route => {
    const next = new URL(route.request().url()).searchParams.get('pageToken')
    requests++
    return route.fulfill({ json: { apiVersion: 'solar.api/v1', catalogVersion: 'fixture-v1', inventoryManifestSha256: invalid ? 'c'.repeat(64) : hash,
      sourceRecords: true, identityAssertions: true, uniqueBodySemantics: 'not-deduplicated', totalRecords: 1_567_193, limit: 50,
      items: Array.from({ length: 50 }, (_, i) => ({ id: `source:${(next ? 50 : 0) + i}`, name: `Source ${(next ? 50 : 0) + i}`, category: 'comet', source: 'synthetic-identity-test', sourceRow: i, identityStatus: 'source-designation', ephemerisStatus: 'unmapped' })),
      nextPageToken: next ? '' : 'page-two' } })
  })
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('./?v=4&page=catalog&lang=en')
  const browser = page.getByTestId('source-identity-browser')
  await expect(browser).not.toHaveAttribute('open')
  await browser.locator(':scope > summary').click()
  expect(requests).toBe(0)
  await browser.getByRole('button', { name: 'Browse from first page' }).click()
  await expect(browser.locator('li')).toHaveCount(50)
  await expect(browser.getByTestId('source-identity-counts')).toContainText('1,567,193')
  await expect(browser.locator('li').first()).toContainText('source:0')
  await browser.getByRole('button', { name: 'Next source page' }).click()
  await expect(browser.locator('li').first()).toContainText('source:50')
  expect(requests).toBe(2)
  await expect(browser.getByRole('button', { name: 'Next source page' })).toHaveCount(0)
  invalid = true
  await browser.getByRole('button', { name: 'Browse from first page' }).click()
  await expect(browser.getByRole('status')).toContainText('Results were cleared')
  await expect(browser.locator('li')).toHaveCount(0)
  await expect(browser.getByTestId('source-identity-counts')).toHaveCount(0)
  await page.getByRole('button', { name: '切换为中文' }).click()
  await expect(browser.locator(':scope > summary')).toHaveText('全来源目录与状态检查')
  await expect(browser.getByRole('status')).toContainText('结果已清空')
  expect(errors).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('source-identities-error-zh.png') })
})

test('collapsing a source directory cancels and prevents a late page publication', async ({ page }) => {
  let finishResponse!: () => void
  const responseFinished = new Promise<void>(resolve => { finishResponse = resolve })
  await page.route('**/solar-test-api/v1/catalog/manifest', async route => {
    await new Promise(resolve => setTimeout(resolve, 800))
    await route.fulfill({ json: { apiVersion: 'solar.api/v1', catalogVersion: 'fixture-v1', catalogManifestSha256: 'a'.repeat(64), inventoryManifestSha256: 'b'.repeat(64) } }).catch(() => {})
    finishResponse()
  })
  await page.goto('./?v=4&page=catalog&lang=en')
  const browser = page.getByTestId('source-identity-browser')
  await browser.locator(':scope > summary').click()
  const requestStarted = page.waitForRequest('**/solar-test-api/v1/catalog/manifest')
  await browser.getByRole('button', { name: 'Browse from first page' }).click()
  await requestStarted
  await expect(browser.getByRole('button', { name: 'Cancel request' })).toBeVisible()
  await browser.locator(':scope > summary').click()
  await browser.locator(':scope > summary').click()
  await responseFinished
  await expect(browser.getByRole('button', { name: 'Browse from first page' })).toBeEnabled()
  await expect(browser.locator('li')).toHaveCount(0)
})
