import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function installMockCatalog(page: Page) {
  const entries = [
    { id: 'asteroid:mpc:01001', packedDesignation: '01001', permanentNumber: 1001, label: '1001 Alpha', shortLabel: 'Alpha', searchKey: 'alpha 1001 01001', chunkId: 'chunk-0000', orbitClassCode: 'MBA', orbitClassName: 'Main-belt Asteroid', isNeo: false, isPha: false },
    { id: 'asteroid:mpc:01002', packedDesignation: '01002', permanentNumber: 1002, label: '1002 Beta', shortLabel: 'Beta', searchKey: 'beta 1002 01002', chunkId: 'chunk-0000', orbitClassCode: 'APO', orbitClassName: 'Apollo', isNeo: true, isPha: false },
    { id: 'asteroid:mpc:01003', packedDesignation: '01003', permanentNumber: 1003, label: '1003 Gamma', shortLabel: 'Gamma', searchKey: 'gamma 1003 01003', chunkId: 'chunk-0000', orbitClassCode: 'ATE', orbitClassName: 'Aten', isNeo: true, isPha: true },
  ]
  const numeric = new Float64Array(entries.length * 8)
  entries.forEach((_, index) => numeric.set([2451545, 2.1 + index * 0.2, 0.08 + index * 0.03, 4 + index, 20, 40, 60, 0.25], index * 8))
  const manifest = {
    schemaVersion: 2, version: 'mock-content-lite', datasetMode: 'lite', source: 'fixture', generatedAt: '2026-08-18T00:00:00Z',
    sourceSha256: 'a'.repeat(64), contentSha256: 'b'.repeat(64), parserVersion: 'test', totalCount: 3,
    chunkCount: 1, chunkSize: 5000, format: 'binary-v1', bucketCounts: { 'digit-1': 3 }, categoryCounts: { MBA: 1, APO: 1, ATE: 1 }, featured: [],
    selectionPolicy: { type: 'permanent-number-through-plus-featured', maxPermanentNumber: 30000, requiredFeaturedNames: [] },
  }
  await page.route('**/data/asteroids/dataset-version.json', (route) => route.fulfill({ json: { schemaVersion: 1, activeVersion: manifest.version, mode: 'lite', manifestPath: `releases/${manifest.version}/manifest.json`, generatedAt: manifest.generatedAt, sourceSha256: manifest.sourceSha256, contentSha256: manifest.contentSha256 } }))
  await page.route(`**/data/asteroids/releases/${manifest.version}/manifest.json`, (route) => route.fulfill({ json: manifest }))
  await page.route(`**/data/asteroids/releases/${manifest.version}/provenance.json`, (route) => route.fulfill({ json: { datasetVersion: manifest.version, downloadedAt: manifest.generatedAt, mode: 'lite', totalObjects: 3, orbitModel: 'fixture', precision: 'fixture', parserVersion: 'test', ...manifest } }))
  await page.route(`**/data/asteroids/releases/${manifest.version}/meta/chunk-0000.json`, (route) => route.fulfill({ json: entries }))
  await page.route(`**/data/asteroids/releases/${manifest.version}/binary/chunk-0000.bin`, (route) => route.fulfill({ body: Buffer.from(numeric.buffer), contentType: 'application/octet-stream' }))
}

test('navigates through the atlas workspaces without console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('./')
  await expect(page.getByText(/Solar Atlas|太阳系图谱/).first()).toBeVisible()
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible()
  await page.getByRole('button', { name: /Catalog|小天体目录/ }).first().click()
  await expect(page.getByRole('heading', { name: /Catalog|小天体目录/ })).toBeVisible()
  await page.getByRole('button', { name: /Mission Lab|任务实验室/ }).first().click()
  await expect(page.getByRole('heading', { name: /Mission Lab|任务实验室/ })).toBeVisible()
  await page.getByRole('button', { name: /Evidence|证据与数据/ }).first().click()
  await expect(page.getByRole('heading', { name: /Evidence|证据与数据/ })).toBeVisible()
  expect(errors).toEqual([])
})

test('applies a reproducible story scene with the requested frame and view', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: /Stories|引导故事/ }).first().click()
  await expect(page.getByRole('heading', { name: /Stories|引导故事/ })).toBeVisible()
  await page.getByRole('button', { name: /Next|下一步/ }).click()
  await page.getByRole('button', { name: /Open this scene|打开此场景/ }).click()
  await expect(page.locator('.trajectory-canvas')).toBeVisible()
  await expect(page).toHaveURL(/view=2d/)
  await expect(page).toHaveURL(/[?&]ref=earth(?:&|$)/)

  await page.getByRole('button', { name: /Stories|引导故事/ }).first().click()
  await page.locator('.story-index button').last().click()
  await page.getByRole('button', { name: /Open this scene|打开此场景/ }).click()
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible()
  await expect(page).toHaveURL(/layers=[^&]*spacecraft/)
  await expect(page.getByLabel(/Trajectory window|轨迹时间窗/)).toHaveValue('7300')
  await expect(page.locator('.measure-ribbon select').nth(0)).toHaveValue('jupiter')
  await expect(page.locator('.measure-ribbon select').nth(1)).toHaveValue('saturn')
})

test('computes the Earth-to-Mars transfer and worker porkchop map', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('./')
  await page.getByRole('button', { name: /Mission Lab|任务实验室/ }).first().click()
  await page.getByRole('button', { name: /Compute transfer|计算转移/ }).click()
  await expect(page.getByText('5.594')).toBeVisible()
  await expect(page.getByText('C3')).toBeVisible()
  await page.getByRole('button', { name: /Build porkchop map|生成 Porkchop 图/ }).click()
  await expect(page.getByRole('img', { name: /Porkchop transfer opportunity heatmap/ })).toBeVisible({ timeout: 15_000 })
  expect(errors).toEqual([])
})

test('shows Hill and Laplace influence definitions independently', async ({ page }) => {
  await page.goto('./?v=2&view=2d')
  await page.getByLabel(/Hill sphere|希尔球/, { exact: true }).check()
  await page.getByLabel(/Laplace SOI|拉普拉斯影响球/, { exact: true }).check()
  await expect(page.locator('.influence-hill').first()).toHaveAttribute('title', /Hill Sphere/)
  await expect(page.locator('.influence-laplace-soi').first()).toHaveAttribute('title', /Laplace SOI/)
})

test('loads and selects the complete filtered catalog separately from focus mode', async ({ page }) => {
  await installMockCatalog(page)
  await page.goto('./')
  await page.getByRole('button', { name: /Catalog|小天体目录/ }).first().click()
  await expect(page.getByRole('img', { name: /GPU catalog view with 3 small bodies/ })).toBeVisible()
  await page.getByRole('button', { name: /Load complete filtered catalog|加载完整筛选目录/ }).click()
  await expect(page.getByRole('button', { name: /Clear catalog-wide selection|清除目录级全选/ })).toContainText('3')
  await expect(page.locator('.catalog-results .section-heading small')).toContainText('3')
})
