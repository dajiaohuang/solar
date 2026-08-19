import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function installMockCatalog(page: Page, options: { precomputed?: boolean; sampleCount?: number } = {}) {
  const precomputed = options.precomputed ?? false
  const entries = [
    { id: 'asteroid:mpc:01001', packedDesignation: '01001', permanentNumber: 1001, label: '1001 Alpha', shortLabel: 'Alpha', searchKey: 'alpha 1001 01001', chunkId: 'chunk-0000', orbitClassCode: 'MBA', orbitClassName: 'Main-belt Asteroid', absoluteMagnitude: 12, isNeo: false, isPha: false },
    { id: 'asteroid:mpc:01002', packedDesignation: '01002', permanentNumber: 1002, label: '1002 Beta', shortLabel: 'Beta', searchKey: 'beta 1002 01002', chunkId: 'chunk-0000', orbitClassCode: 'APO', orbitClassName: 'Apollo', isNeo: true, isPha: false },
    { id: 'asteroid:mpc:01003', packedDesignation: '01003', permanentNumber: 1003, label: '1003 Gamma', shortLabel: 'Gamma', searchKey: 'gamma 1003 01003', chunkId: 'chunk-0000', orbitClassCode: 'TNO', orbitClassName: 'Trans-Neptunian Object', absoluteMagnitude: 18, isNeo: false, isPha: false },
  ]
  const numeric = new Float64Array(entries.length * 8)
  entries.forEach((_, index) => numeric.set([2451545, 2.1 + index * 0.2, 0.08 + index * 0.03, 4 + index, 20, 40, 60, 0.25], index * 8))
  const manifest = {
    schemaVersion: 2, version: 'mock-content-lite', datasetMode: 'lite', source: 'fixture', generatedAt: '2026-08-18T00:00:00Z',
    sourceSha256: 'a'.repeat(64), contentSha256: 'b'.repeat(64), parserVersion: 'test', totalCount: 3,
    chunkCount: 1, chunkSize: 5000, format: 'binary-v1', bucketCounts: { 'digit-1': 3 }, categoryCounts: { MBA: 1, APO: 1, TNO: 1 }, featured: [],
    selectionPolicy: { type: 'permanent-number-through-plus-featured', maxPermanentNumber: 30000, requiredFeaturedNames: [] },
  }
  if (precomputed) Object.assign(manifest, {
    schemaVersion: 3,
    capabilities: ['catalog-index-v1', 'catalog-locators-v1', 'precomputed-samples-v1', 'catalog-summary-v1', 'search-prefix-v2'],
    precomputedSamples: {
      desktop: { metadataPath: 'catalog-sample-desktop.json', binaryPath: 'catalog-sample-desktop.bin', count: options.sampleCount ?? entries.length },
      mobile: { metadataPath: 'catalog-sample-mobile.json', binaryPath: 'catalog-sample-mobile.bin', count: options.sampleCount ?? entries.length },
    },
    summaryPath: 'catalog-summary.json',
    compactIndex: { path: 'catalog-index.bin', format: 'catalog-index-v1', strideBytes: 24, count: entries.length, classCodes: ['MBA', 'APO', 'TNO'] },
  })
  await page.route('**/data/asteroids/dataset-version.json', (route) => route.fulfill({ json: { schemaVersion: 1, activeVersion: manifest.version, mode: 'lite', manifestPath: `releases/${manifest.version}/manifest.json`, generatedAt: manifest.generatedAt, sourceSha256: manifest.sourceSha256, contentSha256: manifest.contentSha256 } }))
  await page.route(`**/data/asteroids/releases/${manifest.version}/manifest.json`, (route) => route.fulfill({ json: manifest }))
  await page.route(`**/data/asteroids/releases/${manifest.version}/provenance.json`, (route) => route.fulfill({ json: { datasetVersion: manifest.version, downloadedAt: manifest.generatedAt, mode: 'lite', totalObjects: 3, orbitModel: 'fixture', precision: 'fixture', parserVersion: 'test', ...manifest } }))
  await page.route(`**/data/asteroids/releases/${manifest.version}/meta/chunk-0000.json`, (route) => route.fulfill({ json: entries }))
  await page.route(`**/data/asteroids/releases/${manifest.version}/binary/chunk-0000.bin`, (route) => route.fulfill({ body: Buffer.from(numeric.buffer), contentType: 'application/octet-stream' }))
  const compact = Buffer.alloc(entries.length * 24)
  entries.forEach((entry, index) => {
    const offset = index * 24
    compact.writeDoubleLE(numeric[index * 8 + 1], offset)
    compact.writeUInt32LE(Math.round(numeric[index * 8 + 2] * 1_000_000_000), offset + 8)
    compact.writeUInt32LE(Math.round(numeric[index * 8 + 3] * 1_000_000), offset + 12)
    compact.writeInt16LE(entry.absoluteMagnitude === undefined ? 0x7fff : Math.round(entry.absoluteMagnitude * 100), offset + 16)
    compact.writeUInt8(['MBA', 'APO', 'TNO'].indexOf(entry.orbitClassCode), offset + 18)
    compact.writeUInt16LE(0, offset + 20)
    compact.writeUInt16LE(index, offset + 22)
  })
  await page.route(`**/data/asteroids/releases/${manifest.version}/catalog-index.bin`, (route) => route.fulfill({ body: compact, contentType: 'application/octet-stream' }))
  const sampleCount = options.sampleCount ?? entries.length
  const sampleEntries = entries.slice(0, sampleCount)
  const sampleBinary = Buffer.from(numeric.buffer.slice(0, sampleCount * 8 * Float64Array.BYTES_PER_ELEMENT))
  for (const size of ['desktop', 'mobile']) {
    await page.route(`**/data/asteroids/releases/${manifest.version}/catalog-sample-${size}.json`, (route) => route.fulfill({ json: sampleEntries }))
    await page.route(`**/data/asteroids/releases/${manifest.version}/catalog-sample-${size}.bin`, (route) => route.fulfill({ body: sampleBinary, contentType: 'application/octet-stream' }))
  }
  await page.route(`**/data/asteroids/releases/${manifest.version}/catalog-summary.json`, (route) => route.fulfill({ json: {
    schemaVersion: 2, datasetMode: 'lite', totalCount: entries.length,
    categoryCounts: { MBA: 1, APO: 1, TNO: 1 }, magnitudeKnownCount: 2, magnitudeUnknownCount: 1,
    numericRanges: { semiMajorAxisAU: [2.1, 2.5], eccentricity: [0.08, 0.14], inclinationDeg: [4, 6], epochJd: [2451545, 2451545] },
    sourceSha256: manifest.sourceSha256,
  } }))
}

test('lazy-loads catalog samples only inside catalog workspaces and only once', async ({ page }) => {
  const sampleRequests: string[] = []
  page.on('request', (request) => {
    if (/catalog-sample-(desktop|mobile)\.(json|bin)$/.test(request.url())) sampleRequests.push(request.url())
  })
  await installMockCatalog(page, { precomputed: true })
  await page.goto('./')
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible()
  expect(sampleRequests).toEqual([])
  await page.getByRole('button', { name: /Catalog|小天体目录/ }).first().click()
  await expect.poll(() => sampleRequests.length).toBe(2)
  expect(new Set(sampleRequests).size).toBe(2)
})

test('hydrates an exact compact-index match that is absent from the precomputed sample', async ({ page }) => {
  await installMockCatalog(page, { precomputed: true, sampleCount: 2 })
  await page.goto('./')
  await page.getByRole('button', { name: /Catalog|小天体目录/ }).first().click()
  await page.getByLabel(/Orbit class|轨道分类/).selectOption('TNO')
  await expect(page.locator('.catalog-table')).not.toContainText('Gamma')
  await page.getByRole('button', { name: /Scan full catalog|扫描完整目录/ }).click()
  await expect(page.getByText(/Exact filtered total|精确筛选总数/).locator('..')).toContainText('1')
  await expect(page.locator('.catalog-table')).toContainText('Gamma')
})

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
  await page.getByRole('button', { name: /Scan full catalog|扫描完整目录/ }).click()
  await page.getByRole('button', { name: /Select complete filtered catalog|全选完整筛选目录/ }).click()
  await expect(page.getByRole('button', { name: /Clear catalog-wide selection|清除目录级全选/ })).toContainText('3')
  await expect(page.locator('.catalog-results .section-heading small')).toContainText('3')
})

test('separates known and unknown absolute-magnitude records', async ({ page }) => {
  await installMockCatalog(page)
  await page.goto('./')
  await page.getByRole('button', { name: /Catalog|小天体目录/ }).first().click()
  const magnitudeStatus = page.getByLabel(/H status|H 状态/)
  await magnitudeStatus.selectOption('known')
  await expect(page.locator('.catalog-results .section-heading span')).toContainText('2')
  await magnitudeStatus.selectOption('unknown')
  await expect(page.locator('.catalog-results .section-heading span')).toContainText('1')
})

test('shows recovery actions when a shared dataset version is unavailable', async ({ page }) => {
  await page.route('**/data/asteroids/releases/missing-version/manifest.json', (route) => route.fulfill({ status: 404 }))
  await page.goto('./?v=2&page=catalog&dataset=missing-version')
  await expect(page.getByText(/requested immutable dataset version is not available|请求的不可变数据集版本当前不可用/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Open current dataset|打开当前数据集/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Retry|重试/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Release metadata|查看发布元数据/ })).toBeVisible()
})
