import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import datasetPin from '../../.github/asteroid-dataset.json' with { type: 'json' }
import satelliteCatalog from '../../src/data/satelliteCatalog.json' with { type: 'json' }
import { coverageSummaryFixture } from '../fixtures/coverageReport'

type CatalogWorkerEvent = { type: 'start' | 'stop' | 'compute' | 'result'; id: number; mode?: string; bytes?: number; arrays?: number }
type CatalogWorkerAuditWindow = Window & { catalogWorkerAudit: CatalogWorkerEvent[] }

async function auditCatalogWorkers(page: Page) {
  await page.addInitScript(() => {
    const events: CatalogWorkerEvent[] = []
    ;(window as CatalogWorkerAuditWindow).catalogWorkerAudit = events
    const NativeWorker = window.Worker
    let sequence = 0
    window.Worker = class extends NativeWorker {
      private auditId: number
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.auditId = String(url).includes('catalog-points.worker') ? ++sequence : 0
        if (!this.auditId) return
        events.push({ type: 'start', id: this.auditId })
        this.addEventListener('message', event => {
          const result = event.data as { type: string; mode?: string; positions?: Float32Array }
          if (result.type !== 'result') return
          events.push({ type: 'result', id: this.auditId, mode: result.mode, bytes: result.positions?.byteLength,
            arrays: Object.values(result).filter(value => ArrayBuffer.isView(value)).length })
        })
      }
      override postMessage(data: unknown, options?: Transferable[] | StructuredSerializeOptions) {
        const request = data as { type: string; mode?: string }
        if (this.auditId && request.type === 'compute') events.push({ type: 'compute', id: this.auditId, mode: request.mode })
        if (Array.isArray(options)) super.postMessage(data, options)
        else super.postMessage(data, options)
      }
      override terminate() {
        if (this.auditId) events.push({ type: 'stop', id: this.auditId })
        super.terminate()
      }
    }
  })
}

test('all-source audit loads on demand and rejects stale totals on retry', async ({ page }, info) => {
  const errors: string[] = []; const requests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const fixture = coverageSummaryFixture()
  let mismatched = false
  await page.route('**/solar-test-api/v1/catalog/manifest', async route => {
    requests.push('manifest')
    const body = JSON.stringify(fixture)
    await route.fulfill({ body, contentType: 'application/json', headers: { 'content-length': String(Buffer.byteLength(body)) } })
  })
  await page.route('**/solar-test-api/v1/coverage', async route => {
    requests.push('coverage')
    const body = JSON.stringify({ ...fixture, inventoryManifestSha256: mismatched ? '0'.repeat(64) : fixture.inventoryManifestSha256 })
    await route.fulfill({ body, contentType: 'application/json', headers: { 'content-length': String(Buffer.byteLength(body)) } })
  })
  await page.goto('?v=4&page=about&lang=en&view=3d')
  const panel = page.getByTestId('source-coverage-report')
  await expect(panel.getByRole('heading', { name: 'All-source coverage audit' })).toBeVisible()
  expect(requests).toEqual([])
  await panel.getByRole('button', { name: 'Load coverage summary' }).click()
  await expect(panel.locator(':scope > dl dd')).toHaveText(['10', '3', '7', '2', '2', '1', '1'])
  expect(requests).toEqual(['manifest', 'coverage'])
  await expect(panel).toContainText('Whole-window numerical certification has not been established')
  await panel.getByText('Report identity and provenance', { exact: true }).click()
  await expect(panel).toContainText(fixture.inventoryManifestSha256)
  await panel.screenshot({ path: info.outputPath('coverage-summary-en.png') })
  mismatched = true
  await panel.getByRole('button', { name: 'Load coverage summary' }).click()
  await expect(panel.getByRole('status')).toContainText('could not be verified')
  await expect(panel.locator('dl')).toHaveCount(0)
  mismatched = false
  await page.goto('?v=4&page=about&lang=zh&view=3d')
  await panel.getByRole('button', { name: '加载覆盖摘要' }).click()
  await expect(panel.locator(':scope > dl dd')).toHaveText(['10', '3', '7', '2', '2', '1', '1'])
  await expect(panel).toContainText('目前尚未建立整窗数值精度认证')
  await panel.screenshot({ path: info.outputPath('coverage-summary-zh.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  expect(errors).toEqual([])
})

test('all-source audit treats absent reports as unavailable, not zero coverage', async ({ page }) => {
  const fixture = coverageSummaryFixture()
  await page.route('**/solar-test-api/v1/catalog/manifest', async route => {
    const body = JSON.stringify(fixture)
    await route.fulfill({ body, contentType: 'application/json', headers: { 'content-length': String(Buffer.byteLength(body)) } })
  })
  await page.route('**/solar-test-api/v1/coverage', route => route.fulfill({ status: 404, body: '{}' }))
  await page.goto('?v=4&page=about&lang=en&view=3d')
  const panel = page.getByTestId('source-coverage-report')
  await panel.getByRole('button', { name: 'Load coverage summary' }).click()
  await expect(panel.getByRole('status')).toContainText('no coverage report configured')
  await expect(panel.locator('dl')).toHaveCount(0)
})

test('packed historical trails survive switching the active renderer without a second canvas', async ({ page }, info) => {
  const errors: string[] = []
  const workers: string[] = [], historicalRequests: string[] = []
  page.on('worker', worker => workers.push(worker.url()))
  page.on('request', request => { if (request.url().includes('workload=trajectory')) historicalRequests.push(request.url()) })
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('?v=4&lang=en&view=3d&bodies=earth%2Cmars&ref=sun&jd=2461287.5&history=365&samples=180&speed=0')
  const spatial = page.getByTestId('trajectory-canvas-3d'), planar = page.locator('canvas.trajectory-canvas')
  await expect(spatial).toHaveAttribute('data-trail-count', '2', { timeout: 30_000 })
  const audit = page.getByTestId('backend-trajectory-audit')
  await expect(audit).toHaveAttribute('data-samples', '180')
  await expect(audit).toHaveAttribute('data-start-utc-jd', String(2461287.5 - 365))
  await expect(audit).toHaveAttribute('data-end-utc-jd', '2461287.5')
  expect(historicalRequests.length).toBeGreaterThanOrEqual(360)
  expect(workers.some(url => url.includes('backend-trajectories.worker'))).toBe(true)
  expect(workers.some(url => /\/trajectory\.worker[-.]/.test(url))).toBe(false)
  await expect(planar).toHaveCount(0)
  await spatial.screenshot({ path: info.outputPath('packed-trails-3d.png') })
  await page.getByRole('button', { name: '2D', exact: true }).click()
  await expect(planar).toHaveAttribute('data-trail-count', '2', { timeout: 30_000 })
  await expect(spatial).toHaveCount(0)
  await planar.screenshot({ path: info.outputPath('packed-trails-2d.png') })
  await page.getByRole('button', { name: '3D', exact: true }).click()
  await expect(spatial).toHaveAttribute('data-trail-count', '2', { timeout: 30_000 })
  await expect(planar).toHaveCount(0)
  await audit.locator('summary').click()
  await expect(audit).toContainText('Connecting lines are visual interpolation')
  const downloadPromise = page.waitForEvent('download')
  await audit.getByRole('button', { name: 'Download historical source audit' }).click()
  const download = await downloadPromise
  const downloaded = JSON.parse(await readFile((await download.path())!, 'utf8')) as { bodyIds: string[]; epochsTdbJd: number[]; sourceOrdinals: number[]; sources: { source: string }[]; tiles: unknown[] }
  expect(downloaded.bodyIds).toEqual(['earth', 'mars', 'sun'])
  expect(downloaded.epochsTdbJd).toHaveLength(180)
  expect(downloaded.sourceOrdinals).toHaveLength(540)
  expect(downloaded.tiles).toHaveLength(180)
  expect(downloaded.sources.every(source => source.source === 'fixture-state-tiles')).toBe(true)
  expect(errors).toEqual([])
})

test('backend historical failures never invoke browser trajectories or erase verified current states', async ({ page }) => {
  const workers: string[] = [], errors: string[] = []
  page.on('worker', worker => workers.push(worker.url()))
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.route('**/solar-test-api/v1/state/tiles?workload=trajectory', route => route.fulfill({ status: 503, body: 'unavailable' }))
  await page.goto('?v=4&lang=en&view=3d&bodies=earth%2Cmars&ref=sun&jd=2461287.5&history=1&samples=32&speed=0')
  const canvas = page.getByTestId('trajectory-canvas-3d')
  await expect(canvas).toHaveAttribute('data-position-count', '2')
  await expect(page.locator('.canvas-error').filter({ hasText: 'State tile HTTP 503' })).toBeVisible()
  await expect(canvas).toHaveAttribute('data-trail-count', '0')
  await expect(page.getByTestId('backend-trajectory-audit')).toHaveCount(0)
  expect(workers.some(url => /\/trajectory\.worker[-.]/.test(url))).toBe(false)
  expect(errors).toEqual([])
})

test('backend historical source window and boundary are readable in Chinese', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('?v=4&lang=zh&view=2d&bodies=earth%2Cmars&ref=sun&jd=2461287.5&history=1&samples=32&speed=0')
  const audit = page.getByTestId('backend-trajectory-audit')
  await expect(audit).toHaveAttribute('data-trails', '2')
  await expect(audit).toHaveAttribute('data-samples', '32')
  await audit.locator('summary').click()
  await expect(audit).toContainText('连线只是可视化插值')
  await expect(audit.getByRole('button', { name: '下载历史轨迹来源审计' })).toBeVisible()
  await audit.screenshot({ path: info.outputPath('backend-history-audit-zh.png') })
})

test('complete Saturn current positions remain independent of 3D trail budgets', async ({ page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  const ids = ['saturn', ...satelliteCatalog.bodies.filter(body => body.parentId === 'saturn').map(body => body.naifId === 606 ? 'titan' : body.id)]
  const legacyCurrentStateRequests: string[] = []
  const stateTileRequests: Array<{ url: string; body: Record<string, unknown> }> = []
  page.on('request', request => {
    if (request.url().endsWith('/solar-test-api/v1/current-states')) legacyCurrentStateRequests.push(request.url())
    if (request.url().endsWith('/solar-test-api/v1/state/plan') || request.url().endsWith('/solar-test-api/v1/state/tiles')) stateTileRequests.push({ url: request.url(), body: JSON.parse(request.postData() ?? '{}') as Record<string, unknown> })
  })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const query = new URLSearchParams({ v: '4', lang: 'en', speed: '0', view: '3d', ref: 'saturn', bodies: ids.join(','), jd: '2461287.5', history: '1', samples: '24' })
  await page.goto(`?${query}`)
  const canvas = page.getByTestId('trajectory-canvas-3d')
  await expect(canvas).toHaveAttribute('data-position-count', '293', { timeout: 90_000 })
  await expect.poll(() => stateTileRequests.length).toBeGreaterThan(0)
  expect(legacyCurrentStateRequests).toHaveLength(0)
  expect(stateTileRequests.some(request => request.url.endsWith('/state/plan'))).toBe(true)
  expect(stateTileRequests.some(request => request.url.endsWith('/state/tiles'))).toBe(true)
  expect(stateTileRequests.filter(request => request.url.endsWith('/state/plan')).every(request => Array.isArray(request.body.ids) && request.body.ids.length <= 32768 && request.body.precision === 'exact')).toBe(true)
  await expect(page.getByTestId('ephemeris-status').locator(':scope > summary')).toContainText('293/294', { timeout: 90_000 })
  // The paused clock should settle after one exact request even though the
  // parent rebuilds selection arrays while the scene workers publish.
  await expect.poll(() => stateTileRequests.filter(request => request.url.endsWith('/state/tiles')).length).toBe(1)
  await page.waitForTimeout(750)
  expect(legacyCurrentStateRequests).toHaveLength(0)
  await expect(page.getByTestId('focus-layer-budget')).toContainText('160/294')
  expect(new URL(page.url()).searchParams.get('bodies')?.split(',')).toEqual(ids)
  expect(Number(await canvas.getAttribute('data-detail-count'))).toBeLessThanOrEqual(160)
  expect(Number(await canvas.getAttribute('data-state-point-count'))).toBeGreaterThan(130)
  await expect(page.getByTestId('missing-position-notice')).toContainText('1')
  const displayBudget = page.getByTestId('exact-display-budget')
  await expect(displayBudget).toHaveAttribute('data-computed', '293')
  await expect(displayBudget).toHaveAttribute('data-displayed', '293')
  await expect(displayBudget).toHaveAttribute('data-sampling', 'false')
  const verifyMeasuredInteraction = async () => {
    const viewport = page.locator('canvas').first()
    // Hold an actual browser pointer gesture while renderer RAF callbacks run.
    // This small scene is lifecycle evidence, not a target-load benchmark.
    const box = await viewport.boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width * .8, box!.y + box!.height * .8)
    await page.mouse.down()
    try {
      await expect(displayBudget.first()).toHaveAttribute('data-sampling', 'true')
      // Shared CI software rendering can take over 10 seconds for the two
      // warmup frames plus 12 measured intervals. This verifies live sampling,
      // not an FPS floor; keep the full sample requirement on slower hosts.
      await expect.poll(async () => Number(await displayBudget.first().getAttribute('data-samples')), { timeout: 30_000 }).toBeGreaterThanOrEqual(12)
    } finally { await page.mouse.up() }
    await expect(displayBudget.first()).toHaveAttribute('data-sampling', 'false')
    await expect(displayBudget.first()).toHaveAttribute('data-computed', '293')
    await expect(displayBudget.first()).toHaveAttribute('data-displayed', '293')
  }
  await verifyMeasuredInteraction()
  await page.screenshot({ path: test.info().outputPath('saturn-complete-current-positions.png') })
  const accessible = page.locator('.accessible-scene-controls')
  await accessible.locator('summary').click()
  await expect(accessible.locator('ul')).toHaveAttribute('data-total-count', '294')
  await expect(accessible.locator('li')).toHaveCount(80)
  await accessible.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(accessible.locator('.body-list-pagination')).toContainText('81–160 / 294')
  await accessible.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(accessible.locator('.body-list-pagination')).toContainText('161–240 / 294')
  // Promote an originally bulk-only position into the bounded focus layer.
  // Ordinal remapping must not change full coverage or lose its original ID.
  const lateRow = accessible.locator('li').last()
  const lateName = (await lateRow.locator('span').innerText()).trim()
  await lateRow.getByRole('button', { name: 'Focus object', exact: true }).click()
  await expect(page.locator('.inspector-toggle')).toContainText(lateName)
  await expect(canvas).toHaveAttribute('data-position-count', '293')
  expect(Number(await canvas.getAttribute('data-detail-count'))).toBeLessThanOrEqual(160)
  expect(Number(await canvas.getAttribute('data-state-point-count'))).toBeGreaterThan(130)
  await expect(displayBudget).toHaveAttribute('data-computed', '293')
  await accessible.locator('summary').click()
  query.set('compare', '1')
  query.set('compareRef', 'titan')
  await page.goto(`?${query}`)
  await expect(page.getByTestId('trajectory-canvas-3d')).toHaveCount(2)
  for (const frame of await page.getByTestId('trajectory-canvas-3d').all()) {
    await expect(frame).toHaveAttribute('data-position-count', '293', { timeout: 90_000 })
  }
  await page.getByRole('button', { name: '2D', exact: true }).click()
  await expect(page.locator('canvas.trajectory-canvas')).toHaveCount(2)
  for (const frame of await page.locator('canvas.trajectory-canvas').all()) await expect(frame).toHaveAttribute('data-position-count', '293')
  await expect(displayBudget).toHaveCount(2)
  expect(await displayBudget.first().getAttribute('data-limit')).toBe(await displayBudget.nth(1).getAttribute('data-limit'))
  await verifyMeasuredInteraction()
  await page.screenshot({ path: test.info().outputPath('exact-display-budget-2d.png') })
  expect(errors).toEqual([])
})

async function openCatalog(page: Page) {
  const desktop = page.locator('.primary-navigation').getByRole('button', { name: /Catalog|小天体目录/ })
  if (await desktop.isVisible()) await desktop.click()
  else await page.locator('.mobile-navigation').getByRole('button', { name: /Search|搜索/ }).click()
}

async function openElements(page: Page) {
  const desktop = page.locator('.primary-navigation').getByRole('button', { name: /Element Space|轨道元素空间/ })
  if (await desktop.isVisible()) await desktop.click()
  else {
    await page.locator('.mobile-navigation').getByRole('button', { name: /More|更多/ }).click()
    await page.locator('.mobile-more-menu').getByRole('button', { name: /Element Space|轨道元素空间/ }).click()
  }
}

async function openExplorer(page: Page) {
  const desktop = page.locator('.primary-navigation').getByRole('button', { name: 'Observation Deck' })
  if (await desktop.isVisible()) await desktop.click()
  else await page.locator('.mobile-navigation').getByRole('button', { name: 'Observation Deck' }).click()
}

async function installMockCatalog(page: Page, options: {
  precomputed?: boolean
  sampleCount?: number
  profileSamples?: { desktop: number[]; mobile: number[] }
  presetDataset?: boolean
} = {}) {
  const precomputed = options.precomputed ?? false
  const fixtureEntries = [
    { id: 'asteroid:mpc:01001', packedDesignation: '01001', permanentNumber: 1001, label: '1001 Alpha', shortLabel: 'Alpha', searchKey: 'alpha 1001 01001', chunkId: 'chunk-0000', orbitClassCode: 'MBA', orbitClassName: 'Main-belt Asteroid', absoluteMagnitude: 12, isNeo: false, isPha: false },
    { id: 'asteroid:mpc:01002', packedDesignation: '01002', permanentNumber: 1002, label: '1002 Beta', shortLabel: 'Beta', searchKey: 'beta 1002 01002', chunkId: 'chunk-0000', orbitClassCode: 'APO', orbitClassName: 'Apollo', isNeo: true, isPha: false },
    { id: 'asteroid:mpc:01003', packedDesignation: '01003', permanentNumber: 1003, label: '1003 Gamma', shortLabel: 'Gamma', searchKey: 'gamma 1003 01003', chunkId: 'chunk-0000', orbitClassCode: 'TNO', orbitClassName: 'Trans-Neptunian Object', absoluteMagnitude: 18, isNeo: false, isPha: false },
  ]
  const entries = options.presetDataset
    ? Array.from({ length: 8_000 }, (_, index) => {
      const permanentNumber = index + 2
      const packedDesignation = String(permanentNumber).padStart(5, '0')
      return {
        id: `asteroid:mpc:${packedDesignation}`,
        packedDesignation,
        permanentNumber,
        label: `(${permanentNumber}) Belt ${permanentNumber}`,
        shortLabel: `Belt ${permanentNumber}`,
        searchKey: `belt ${permanentNumber} ${packedDesignation}`,
        chunkId: 'chunk-0000',
        orbitClassCode: 'MBA',
        orbitClassName: 'Main-belt Asteroid',
        absoluteMagnitude: 10 + index % 12,
        isNeo: false,
        isPha: false,
      }
    })
    : fixtureEntries
  const numeric = new Float64Array(entries.length * 8)
  entries.forEach((_, index) => numeric.set([2451545, 2.1 + index % 600 / 500, 0.05 + index % 20 / 100, index % 30, 20, 40, 60, 0.25], index * 8))
  const defaultSampleIndexes = entries.slice(0, options.sampleCount ?? entries.length).map((_, index) => index)
  const sampleIndexes = options.profileSamples ?? { desktop: defaultSampleIndexes, mobile: defaultSampleIndexes }
  const manifest = {
    schemaVersion: 2,
    version: options.presetDataset ? datasetPin.version : 'mock-content-lite',
    datasetMode: options.presetDataset ? 'full' : 'lite',
    source: 'fixture', generatedAt: '2026-08-18T00:00:00Z',
    sourceSha256: 'a'.repeat(64), contentSha256: 'b'.repeat(64), parserVersion: 'test', totalCount: entries.length,
    chunkCount: 1, chunkSize: 10_000, format: 'binary-v1', bucketCounts: { 'digit-1': entries.length }, categoryCounts: options.presetDataset ? { MBA: entries.length } : { MBA: 1, APO: 1, TNO: 1 }, featured: [],
    selectionPolicy: { type: 'permanent-number-through-plus-featured', maxPermanentNumber: 30000, requiredFeaturedNames: [] },
  }
  if (precomputed) Object.assign(manifest, {
    schemaVersion: 3,
    capabilities: ['catalog-index-v1', 'catalog-locators-v1', 'precomputed-samples-v1', 'catalog-summary-v1', 'search-prefix-v2'],
    precomputedSamples: {
      desktop: { metadataPath: 'catalog-sample-desktop.json', binaryPath: 'catalog-sample-desktop.bin', count: sampleIndexes.desktop.length },
      mobile: { metadataPath: 'catalog-sample-mobile.json', binaryPath: 'catalog-sample-mobile.bin', count: sampleIndexes.mobile.length },
    },
    summaryPath: 'catalog-summary.json',
    compactIndex: { path: 'catalog-index.bin', format: 'catalog-index-v1', strideBytes: 24, count: entries.length, classCodes: ['MBA', 'APO', 'TNO'] },
  })
  await page.route('**/data/asteroids/dataset-version.json', (route) => route.fulfill({ json: { schemaVersion: 1, activeVersion: manifest.version, mode: manifest.datasetMode, manifestPath: `releases/${manifest.version}/manifest.json`, generatedAt: manifest.generatedAt, sourceSha256: manifest.sourceSha256, contentSha256: manifest.contentSha256 } }))
  await page.route(`**/data/asteroids/releases/${manifest.version}/manifest.json`, (route) => route.fulfill({ json: manifest }))
  await page.route(`**/data/asteroids/releases/${manifest.version}/provenance.json`, (route) => route.fulfill({ json: { datasetVersion: manifest.version, downloadedAt: manifest.generatedAt, mode: manifest.datasetMode, totalObjects: entries.length, orbitModel: 'fixture', precision: 'fixture', parserVersion: 'test', ...manifest } }))
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
  for (const size of ['desktop', 'mobile'] as const) {
    const profileEntries = sampleIndexes[size].map((index) => entries[index])
    const profileNumeric = new Float64Array(profileEntries.length * 8)
    sampleIndexes[size].forEach((entryIndex, profileIndex) => {
      profileNumeric.set(numeric.slice(entryIndex * 8, entryIndex * 8 + 8), profileIndex * 8)
    })
    await page.route(`**/data/asteroids/releases/${manifest.version}/catalog-sample-${size}.json`, (route) => route.fulfill({ json: profileEntries }))
    await page.route(`**/data/asteroids/releases/${manifest.version}/catalog-sample-${size}.bin`, (route) => route.fulfill({ body: Buffer.from(profileNumeric.buffer), contentType: 'application/octet-stream' }))
  }
  await page.route(`**/data/asteroids/releases/${manifest.version}/catalog-summary.json`, (route) => route.fulfill({ json: {
    schemaVersion: 2, datasetMode: manifest.datasetMode, totalCount: entries.length,
    categoryCounts: manifest.categoryCounts, magnitudeKnownCount: entries.length, magnitudeUnknownCount: 0,
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
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./')
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible({ timeout: 15_000 })
  expect(sampleRequests).toEqual([])
  await openCatalog(page)
  await expect.poll(() => sampleRequests.length).toBe(2)
  expect(new Set(sampleRequests).size).toBe(2)
})

test('renders an explicitly enabled reproducible catalog cloud without reloading it across view changes', async ({ page }, testInfo) => {
  await auditCatalogWorkers(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const sampleRequests: string[] = []
  page.on('request', (request) => {
    if (/catalog-sample-(desktop|mobile)\.(json|bin)$/.test(request.url())) sampleRequests.push(request.url())
  })
  await installMockCatalog(page, { precomputed: true, profileSamples: { desktop: [0, 2], mobile: [1] } })
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  const profile = testInfo.project.name.startsWith('mobile') ? 'mobile' : 'desktop'
  const sampleCount = profile === 'mobile' ? 1 : 2
  await page.goto(`./?v=4&catalogCloud=1&quality=max&dataset=mock-content-lite&catalogSample=${profile}&catalogSampleCount=${sampleCount}&lang=en`)

  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => sampleRequests.length).toBe(2)
  expect(new Set(sampleRequests).size).toBe(2)
  await expect(page.locator('.frame-label small')).toContainText(`catalog ${sampleCount.toLocaleString()} / ${sampleCount.toLocaleString()} · Maximum`)
  await expect(page).toHaveURL(/[?&]catalogCloud=1(?:&|$)/)
  await expect(page).toHaveURL(/[?&]quality=max(?:&|$)/)
  const latestResult = () => page.evaluate(() => (window as CatalogWorkerAuditWindow).catalogWorkerAudit.filter(event => event.type === 'result').at(-1))
  await expect.poll(latestResult).toMatchObject({ mode: '3d', bytes: sampleCount * 12, arrays: 1 })
  await page.getByTestId('trajectory-canvas-3d').screenshot({ path: testInfo.outputPath('single-mode-cloud-3d.png') })

  const viewSwitch = page.locator('.simulation-bar .segmented-control')
  await viewSwitch.getByRole('button', { name: '2D' }).click()
  await expect(page.locator('.trajectory-canvas')).toBeVisible()
  await expect.poll(latestResult).toMatchObject({ mode: '2d', bytes: sampleCount * 8, arrays: 1 })
  await expect(page.getByTestId('trajectory-canvas-3d')).toHaveCount(0)
  await expect(page.locator('.frame-label small')).toContainText(`catalog ${sampleCount.toLocaleString()} / ${sampleCount.toLocaleString()}`)
  await page.locator('.trajectory-canvas').screenshot({ path: testInfo.outputPath('single-mode-cloud-2d.png') })
  await viewSwitch.getByRole('button', { name: '3D' }).click()
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible()
  await expect.poll(latestResult).toMatchObject({ mode: '3d', bytes: sampleCount * 12, arrays: 1 })
  await expect(page.locator('.trajectory-canvas')).toHaveCount(0)
  // The dedicated catalog workspace is always planar, independently of the
  // Explorer's last mode. It must retire the Explorer worker on navigation.
  await openCatalog(page)
  await expect(page.locator('canvas.catalog-point-canvas')).toBeVisible()
  await expect.poll(latestResult).toMatchObject({ mode: '2d', arrays: 1 })
  await openExplorer(page)
  await expect.poll(latestResult).toMatchObject({ mode: '3d', arrays: 1 })
  await page.locator('.advanced-controls > summary').click()
  await page.getByRole('checkbox', { name: 'Catalog point cloud', exact: true }).uncheck()
  await expect.poll(() => page.evaluate(() => (window as CatalogWorkerAuditWindow).catalogWorkerAudit
    .reduce((active, event) => active + (event.type === 'start' ? 1 : event.type === 'stop' ? -1 : 0), 0))).toBe(0)
  const audit = await page.evaluate(() => (window as CatalogWorkerAuditWindow).catalogWorkerAudit)
  let active = 0
  for (const event of audit) {
    active += event.type === 'start' ? 1 : event.type === 'stop' ? -1 : 0
    expect(active).toBeGreaterThanOrEqual(0)
    expect(active).toBeLessThanOrEqual(1)
  }
  expect(audit.filter(event => event.type === 'result').every(event => event.arrays === 1)).toBe(true)
  expect(sampleRequests).toHaveLength(2)
  expect(errors).toEqual([])
})

test('fails closed visibly when an enabled catalog cloud has an invalid sample tuple', async ({ page }) => {
  const sampleRequests: string[] = []
  page.on('request', (request) => {
    if (/catalog-sample-(desktop|mobile)\.(json|bin)$/.test(request.url())) sampleRequests.push(request.url())
  })
  await installMockCatalog(page, { precomputed: true })
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&catalogCloud=1&dataset=mock-content-lite&catalogSample=mobile&catalogSampleCount=oops&lang=en')

  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('catalogSampleCount must be a positive integer: oops')).toBeVisible()
  expect(sampleRequests).toEqual([])
  await expect(page.locator('.frame-label small')).toContainText('catalog 0 / 0')
})

test('loads the same pinned catalog sample on desktop and mobile', async ({ page }) => {
  const sampleRequests: string[] = []
  page.on('request', (request) => {
    if (/catalog-sample-(desktop|mobile)\.(json|bin)$/.test(request.url())) sampleRequests.push(request.url())
  })
  await installMockCatalog(page, { precomputed: true, profileSamples: { desktop: [0, 2], mobile: [1] } })
  await page.goto('./?v=4&page=catalog&dataset=mock-content-lite&catalogSample=mobile&catalogSampleCount=1&lang=en')

  await expect(page.locator('.catalog-table')).toContainText('Beta')
  await expect.poll(() => sampleRequests.length).toBe(2)
  await expect(page.locator('.catalog-table')).not.toContainText('Alpha')
  await expect(page.locator('.catalog-table')).not.toContainText('Gamma')
  expect(sampleRequests.every((url) => url.includes('catalog-sample-mobile.'))).toBe(true)
  await expect(page).toHaveURL(/[?&]catalogSample=mobile(?:&|$)/)
  await expect(page).toHaveURL(/[?&]catalogSampleCount=1(?:&|$)/)
})

test('adds the viewport-selected pinned sample to a current catalog URL', async ({ page }, testInfo) => {
  const sampleRequests: string[] = []
  page.on('request', (request) => {
    if (/catalog-sample-(desktop|mobile)\.(json|bin)$/.test(request.url())) sampleRequests.push(request.url())
  })
  await installMockCatalog(page, { precomputed: true, profileSamples: { desktop: [0, 2], mobile: [1] } })
  await page.goto('./?v=4&page=catalog&dataset=mock-content-lite&lang=en')

  const expectedProfile = testInfo.project.name.startsWith('mobile') ? 'mobile' : 'desktop'
  const expectedCount = expectedProfile === 'mobile' ? 1 : 2
  await expect.poll(() => sampleRequests.length).toBe(2)
  expect(sampleRequests.every((url) => url.includes(`catalog-sample-${expectedProfile}.`))).toBe(true)
  await expect(page).toHaveURL(/[?&]v=4(?:&|$)/)
  await expect(page).toHaveURL(new RegExp(`[?&]catalogSample=${expectedProfile}(?:&|$)`))
  await expect(page).toHaveURL(new RegExp(`[?&]catalogSampleCount=${expectedCount}(?:&|$)`))
})

test('keeps a malformed catalog tuple while navigation continues without a responsive fallback', async ({ page }) => {
  const sampleRequests: string[] = []
  page.on('request', (request) => {
    if (/catalog-sample-(desktop|mobile)\.(json|bin)$/.test(request.url())) sampleRequests.push(request.url())
  })
  await installMockCatalog(page, { precomputed: true })
  await page.goto('./?v=4&page=catalog&dataset=mock-content-lite&catalogSample=mobile&catalogSampleCount=oops&lang=en')

  await expect(page.getByText('catalogSampleCount must be a positive integer: oops')).toBeVisible()
  expect(sampleRequests).toEqual([])
  await page.getByRole('button', { name: '切换为中文' }).click()
  await expect(page.getByText('catalogSampleCount 必须是正整数: oops')).toBeVisible()
  await openElements(page)
  await expect(page).toHaveURL(/[?&]page=elements(?:&|$)/)
  await expect(page).toHaveURL(/[?&]catalogSample=mobile(?:&|$)/)
  await expect(page).toHaveURL(/[?&]catalogSampleCount=oops(?:&|$)/)
  await expect(page.getByText('catalogSampleCount 必须是正整数: oops')).toBeVisible()
  expect(sampleRequests).toEqual([])
})

test('loads the deployable catalog through gzip JSON delivery', async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_EXPECT_DATASET !== '1', 'Runs only against the full deployable artifact')
  test.setTimeout(90_000)
  const gzipResponses: string[] = []
  page.on('response', (response) => {
    if (response.ok() && response.url().endsWith('.json.gz')) gzipResponses.push(response.url())
  })
  await page.goto('./?v=4&page=catalog&lang=en')
  await expect(page.getByRole('heading', { name: 'Catalog' })).toBeVisible()
  await expect(page.locator('.catalog-table > li > button').first()).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => gzipResponses.some((url) => /catalog-sample-(desktop|mobile)\.json\.gz$/.test(url))).toBe(true)
  await page.getByRole('searchbox', { name: /Search name/ }).fill('Ceres')
  await expect.poll(() => gzipResponses.some((url) => /\/search\/prefix-ce\.json\.gz$/.test(url))).toBe(true)
})

test('hydrates an exact compact-index match that is absent from the precomputed sample', async ({ page }) => {
  await installMockCatalog(page, { precomputed: true, sampleCount: 2 })
  await page.goto('./?v=4&page=catalog')
  await page.getByLabel(/Orbit class|轨道分类/).selectOption('TNO')
  await expect(page.locator('.catalog-table')).not.toContainText('Gamma')
  await page.getByRole('button', { name: /Scan full catalog|扫描完整目录/ }).click()
  await expect(page.getByText(/Exact filtered total|精确筛选总数/).locator('..')).toContainText('1', { timeout: 30_000 })
  await expect(page.locator('.catalog-table')).toContainText('Gamma')
})

test('navigates through the atlas workspaces without console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./')
  await expect(page.getByText(/Solar Atlas|太阳系图谱/).first()).toBeVisible()
  await expect(page.locator('.trajectory-canvas, [data-testid="trajectory-canvas-3d"]')).toBeVisible({ timeout: 15_000 })
  await openCatalog(page)
  await expect(page.getByRole('heading', { name: /Catalog|小天体目录/ })).toBeVisible()
  const missionButton = page.getByRole('button', { name: /Mission Lab|任务实验室/ }).first()
  if (await missionButton.isVisible()) await missionButton.click()
  else {
    await page.getByRole('button', { name: /More|更多/ }).click()
    await page.getByRole('button', { name: /Mission Lab|任务实验室/ }).click()
  }
  await expect(page.getByRole('heading', { name: /Mission Lab|任务实验室/ })).toBeVisible()
  const evidenceButton = page.getByRole('button', { name: /Evidence|证据与数据/ }).first()
  if (await evidenceButton.isVisible()) await evidenceButton.click()
  else {
    await page.getByRole('button', { name: /More|更多/ }).click()
    await page.getByRole('button', { name: /Evidence|证据与数据/ }).click()
  }
  await expect(page.getByRole('heading', { name: /Evidence|证据与数据/ })).toBeVisible()
  expect(errors).toEqual([])
})

test('degrades cleanly when service worker registration is unavailable', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./')
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible({ timeout: 15_000 })
  expect(errors).toEqual([])
})

test('applies a reproducible story scene with the requested frame and view', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&page=stories&story=retrograde-mars')
  await expect(page.getByRole('heading', { name: /Stories|引导故事/ })).toBeVisible()
  await page.getByRole('button', { name: /Next|下一步/ }).click()
  await page.getByRole('button', { name: /Next|下一步/ }).click()
  await page.getByRole('button', { name: /Open this scene|打开此场景/ }).click()
  await expect(page.locator('.trajectory-canvas, [data-testid="trajectory-canvas-3d"]')).toBeVisible()
  await expect(page.getByRole('dialog', { name: /Why Mars moves backward|为什么火星会逆行/ })).toBeVisible()
  await expect(page).toHaveURL(/[?&]guide=1(?:&|$)/)
  await expect(page).toHaveURL(/view=2d/)
  await expect(page).toHaveURL(/[?&]ref=earth(?:&|$)/)

  await page.getByRole('button', { name: /Stories|引导故事|Learn|学习/ }).first().click()
  await page.locator('.story-index button').last().click()
  await page.getByRole('button', { name: /Open this scene|打开此场景/ }).click()
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveURL(/layers=[^&]*spacecraft/)
  await expect(page.getByLabel(/Trajectory window|轨迹时间窗/)).toHaveValue('7300')
  await expect(page.locator('.measure-ribbon select').nth(0)).toHaveValue('jupiter')
  await expect(page.locator('.measure-ribbon select').nth(1)).toHaveValue('saturn')
})

test('loads resolved TNO primary centers lazily and keeps Makemake coverage explicit', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  const requests: string[] = [], errors: string[] = []
  page.on('request', request => requests.push(request.url()))
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&page=explorer&bodies=earth&ref=sun&lang=en')
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible()
  expect(requests.filter(url => url.includes('/tnosat-'))).toEqual([])
  await page.goto('./?v=4&page=explorer&bodies=eris,haumea,makemake&ref=sun&jd=2461222.5&zoom=0.15&lang=en')
  await page.waitForLoadState('networkidle')
  const status = page.getByTestId('ephemeris-status')
  await expect(status.locator(':scope > summary')).toContainText('2/3', { timeout: 30_000 })
  await status.locator(':scope > summary').click()
  await expect(status).toContainText('makemake')
  await expect(status.getByRole('alert')).toHaveCount(0)
  // The main resolver and trajectory worker each load the same pinned assets.
  const tnoRequests = requests.filter(url => url.includes('/tnosat-'))
  expect(new Set(tnoRequests).size).toBe(2)
  expect(tnoRequests.length).toBeLessThanOrEqual(4)
  expect(requests.filter(url => /catalog-sample-/.test(url))).toEqual([])
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('tno-primary-centers.png'), fullPage: true })
  expect(errors).toEqual([])
})

test('offers a complete reproducible observation deck on desktop and mobile', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&page=explorer&lang=en')
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible({ timeout: 15_000 })

  const presets = page.locator('.preset-list')
  await expect(presets.locator(':scope > button')).toHaveCount(29)
  const marsPreset = page.getByRole('button', { name: 'Load preset: Mars opposition 2027' })
  await marsPreset.click()
  await expect(marsPreset).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveURL(/[?&]bodies=earth%2Cmars%2Cjupiter(?:&|$)/)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Load preset: Mars opposition 2027' })).toHaveAttribute('aria-pressed', 'true')
  await page.locator('.advanced-controls > summary').click()
  await expect(page.getByLabel('Date')).toHaveValue('2027-02-19')
  await expect(page.getByLabel('Reference frame')).toHaveValue('sun')
  await expect(page.getByLabel('Trajectory window')).toHaveValue('180')
  await expect(page.getByLabel('Trajectory samples')).toHaveValue('180')
  await expect(page.getByRole('checkbox', { name: /^Mars Planet$/ })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: /^Mercury Planet$/ })).not.toBeChecked()

  const viewSwitch = page.locator('.simulation-bar .segmented-control')
  await expect(viewSwitch).toBeVisible()
  await viewSwitch.getByRole('button', { name: '2D' }).click()
  await expect(page.locator('.trajectory-canvas, [data-testid="trajectory-canvas-3d"]')).toBeVisible()
  await expect(page).toHaveURL(/[?&]view=2d(?:&|$)/)
  await expect(page.getByRole('button', { name: 'Load preset: Mars opposition 2027' })).toHaveAttribute('aria-pressed', 'false')

  await page.getByLabel('Trajectory samples').selectOption('240')
  await expect(page).toHaveURL(/[?&]samples=240(?:&|$)/)
  await page.getByLabel('Search renderable bodies').fill('Neptune')
  await page.getByRole('checkbox', { name: /^Neptune Planet$/ }).check()
  await expect(page).toHaveURL(/[?&]bodies=[^&]*neptune/)
})

test('keeps the Observation Deck inside the first mobile viewport in portrait and landscape', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))

  for (const viewport of [{ width: 412, height: 839 }, { width: 915, height: 412 }]) {
    await page.setViewportSize(viewport)
    await page.goto('./?v=4&page=explorer&view=3d&lang=en')
    await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible({ timeout: 15_000 })

    const stage = await page.locator('.explorer-stage').boundingBox()
    const drawer = await page.locator('.control-drawer').boundingBox()
    const navigation = await page.locator('.mobile-navigation').boundingBox()
    expect(stage).not.toBeNull()
    expect(drawer).not.toBeNull()
    expect(navigation).not.toBeNull()
    expect(stage!.y).toBeLessThan(drawer!.y)
    expect(stage!.y).toBeLessThan(navigation!.y)
    expect(stage!.y + stage!.height).toBeLessThanOrEqual(navigation!.y + 1)
  }
})

test('prioritizes 3D for internal entries and every built-in preset', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&page=stories&story=retrograde-mars&lang=en')
  await openExplorer(page)
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveURL(/[?&]view=3d(?:&|$)/)

  for (const name of ['Earth–Moon system', 'Jupiter and its modeled Galilean moons', 'Saturn–Titan system']) {
    const preset = page.getByRole('button', { name: `Load preset: ${name}` })
    await preset.click()
    await expect(preset).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveURL(/[?&]view=3d(?:&|$)/)
  }

  await page.goto('./?v=4&page=explorer&view=2d&lang=en')
  await expect(page.locator('.trajectory-canvas')).toBeVisible()
  await expect(page.getByTestId('trajectory-canvas-3d')).toHaveCount(0)
})

test('replays 3D zoom and labels unsupported 2D-only controls truthfully', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  const captures: Buffer[] = []
  const distances: number[] = []

  for (const zoom of [0.15, 2]) {
    await page.goto(`./?v=4&page=explorer&view=3d&zoom=${zoom}&layers=ecliptic,orbits,hill,soi&lang=en`)
    const canvas = page.getByTestId('trajectory-canvas-3d')
    await expect(canvas).toBeVisible({ timeout: 15_000 })
    // Camera fit is derived from the final scene composition. Wait for the
    // ephemeris and trajectory workers to finish before asserting the applied
    // zoom/distance, so this tests readiness rather than a transient fit.
    const status = page.getByTestId('ephemeris-status')
    await expect(status.locator(':scope > summary')).not.toContainText('Loading', { timeout: 15_000 })
    await expect(page.locator('.compute-progress')).toHaveCount(0, { timeout: 15_000 })
    await expect(canvas).toHaveAttribute('data-fit-generation', /[1-9]\d*/, { timeout: 15_000 })
    await expect(canvas).toHaveAttribute('data-applied-zoom', String(zoom), { timeout: 15_000 })
    await expect.poll(async () => Number(await canvas.getAttribute('data-camera-distance'))).toBeGreaterThan(0)
    distances.push(Number(await canvas.getAttribute('data-camera-distance')))
    captures.push(await canvas.screenshot())
  }

  expect(distances[0]).toBeGreaterThan(distances[1])
  expect(Buffer.compare(captures[0], captures[1])).not.toBe(0)

  await page.locator('.advanced-controls > summary').click()
  for (const checkbox of [
    page.getByRole('checkbox', { name: /Osculating orbit ellipses · 2D only/ }),
    page.getByRole('checkbox', { name: /Hill sphere · 2D only/ }),
    page.getByRole('checkbox', { name: /Laplace SOI · 2D only/ }),
  ]) {
    await expect(checkbox).toBeDisabled()
    await expect(checkbox).not.toBeChecked()
  }
  await expect(page.getByText(/Free orbit, pan, wheel, and pinch gestures stay in this session/)).toBeVisible()

  const ecliptic = page.getByRole('checkbox', { name: 'Ecliptic plane' })
  await ecliptic.uncheck()
  const withoutEcliptic = await page.getByTestId('trajectory-canvas-3d').screenshot()
  await ecliptic.check()
  await expect(page).toHaveURL(/[?&]layers=ecliptic(?:&|$)/)
  const withEcliptic = await page.getByTestId('trajectory-canvas-3d').screenshot()
  expect(Buffer.compare(withoutEcliptic, withEcliptic)).not.toBe(0)

  const camera = page.getByTestId('trajectory-canvas-3d')
  const zoomedDistance = Number(await camera.getAttribute('data-camera-distance'))
  const configuredUrl = page.url()
  await camera.hover()
  await page.mouse.wheel(0, -500)
  await expect.poll(async () => Number(await camera.getAttribute('data-camera-distance'))).toBeLessThan(zoomedDistance)
  expect(page.url()).toBe(configuredUrl)
  await page.locator('.view-reset').click()
  await expect(page.getByLabel('3D camera zoom')).toHaveValue('1')
  await expect.poll(async () => Number(await camera.getAttribute('data-camera-distance'))).toBeGreaterThan(zoomedDistance)
})

test('exports rendered scene pixels from both WebGL views', async ({ page }) => {
  await page.addInitScript(() => {
    const originalToBlob = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (this.width === 1600 && this.height > 1012) {
        const context = this.getContext('2d')
        const pixels = context?.getImageData(0, 112, 1600, 900).data
        let renderedPixels = 0
        if (pixels) {
          for (let y = 0; y < 900; y += 10) {
            for (let x = 0; x < 1600; x += 10) {
              const offset = (y * 1600 + x) * 4
              if (pixels[offset] !== 5 || pixels[offset + 1] !== 8 || pixels[offset + 2] !== 12) {
                renderedPixels += 1
              }
            }
          }
        }
        ;(window as Window & { __solarExportRenderedPixels?: number }).__solarExportRenderedPixels = renderedPixels
      }
      return originalToBlob.call(this, callback, type, quality)
    }
  })
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))

  for (const view of ['3d', '2d']) {
    await page.goto(`./?v=4&page=explorer&view=${view}&lang=en`)
    await expect(page.locator(view === '3d' ? '[data-testid="trajectory-canvas-3d"]' : '.trajectory-canvas')).toBeVisible({ timeout: 15_000 })
    await page.locator('.advanced-controls > summary').click()
    await page.getByRole('button', { name: 'Export annotated PNG' }).click()
    await expect.poll(() => page.evaluate(() =>
      (window as Window & { __solarExportRenderedPixels?: number }).__solarExportRenderedPixels ?? 0,
    )).toBeGreaterThan(0)
  }
})

test('loads and replays both pinned main-belt presets on desktop and mobile', async ({ page }) => {
  const sampleRequests: string[] = []
  page.on('request', (request) => {
    if (/catalog-sample-(desktop|mobile)\.(json|bin)$/.test(request.url())) sampleRequests.push(request.url())
  })
  await installMockCatalog(page, { precomputed: true, presetDataset: true })
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&page=explorer&lang=en')

  await page.getByRole('button', { name: 'Load preset: Mars–main belt–Jupiter' }).click()
  await expect(page.locator('.element-scatter')).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveURL(/[?&]page=elements(?:&|$)/)
  await expect.poll(() => new URL(page.url()).searchParams.get('dataset')).toBe(datasetPin.version)
  await expect(page).toHaveURL(/[?&]mode=full(?:&|$)/)
  await expect(page).toHaveURL(/[?&]catalogSample=mobile(?:&|$)/)
  await expect(page).toHaveURL(/[?&]catalogSampleCount=8000(?:&|$)/)
  await expect(page).toHaveURL(/[?&]filter=MBA(?:&|$)/)
  await expect(page).toHaveURL(/[?&]plot=a-e(?:&|$)/)
  await expect(page).toHaveURL(/[?&]bodies=mars%2Cceres%2Cjupiter(?:&|$)/)
  expect(sampleRequests.length).toBeGreaterThanOrEqual(2)
  expect(sampleRequests.every((url) => url.includes('catalog-sample-mobile.'))).toBe(true)

  const replayUrl = page.url()
  await page.reload()
  await expect(page.locator('.element-scatter')).toBeVisible({ timeout: 15_000 })
  expect(page.url()).toBe(replayUrl)

  await page.goto('./?v=4&page=explorer&lang=en')
  await page.getByRole('button', { name: 'Load preset: Main-belt element comparison' }).click()
  await expect(page.locator('.element-scatter')).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveURL(/[?&]plot=a-i(?:&|$)/)
  await expect(page).toHaveURL(/[?&]catalogSampleCount=8000(?:&|$)/)

  await openExplorer(page)
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveURL(/[?&]catalogSample=mobile(?:&|$)/)
  await page.getByRole('button', { name: 'Load preset: Mars opposition 2027' }).click()
  await expect(page).not.toHaveURL(/[?&]catalogSample=/)
  await expect(page).not.toHaveURL(/[?&]catalogSampleCount=/)
  await expect(page).not.toHaveURL(/[?&]filter=MBA(?:&|$)/)
})

test('routes the home entry to the deck and lets visitors reopen the tutorial', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&page=home&lang=en')
  await expect(page.locator('.trajectory-canvas, [data-testid="trajectory-canvas-3d"]')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Start tutorial' }).click()
  await expect(page.getByRole('dialog', { name: 'How would you like to begin?' })).toBeFocused()
})

test('offers a first-run choice and finishes the tutorial on the deck', async ({ page }) => {
  const rendererRequests: string[] = []
  const kernelRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('TrajectoryCanvas3D-')) rendererRequests.push(request.url())
    if (request.url().endsWith('.bsp')) kernelRequests.push(request.url())
  })
  await page.goto('./?v=4&lang=en')
  const choice = page.getByRole('dialog', { name: 'How would you like to begin?' })
  await expect(choice).toBeVisible()
  await expect(choice).toBeFocused()
  await expect(page.locator('.trajectory-3d-placeholder')).toBeVisible()
  await expect(page.getByTestId('trajectory-canvas-3d')).toHaveCount(0)
  expect(rendererRequests).toEqual([])
  expect(kernelRequests).toEqual([])
  await choice.getByRole('button', { name: 'Start tutorial' }).click()
  const onboarding = page.getByRole('dialog', { name: 'Four controls, then you’re free' })
  await expect(onboarding).toBeVisible()
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible({ timeout: 15_000 })
  expect(rendererRequests).toHaveLength(1)
  await onboarding.getByRole('button', { name: /Next tip/ }).click()
  await onboarding.getByRole('button', { name: /Next tip/ }).click()
  await onboarding.getByRole('button', { name: /Next tip/ }).click()
  await expect(onboarding).toContainText('Preset scenes')
  await onboarding.getByRole('button', { name: 'Start exploring' }).click()
  await expect(onboarding).toHaveCount(0)
  await expect(page.locator('.trajectory-canvas, [data-testid="trajectory-canvas-3d"]')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'How would you like to begin?' })).toHaveCount(0)
})

test('starts the 3D renderer after choosing independent exploration', async ({ page }) => {
  await page.goto('./?v=4&lang=en')
  const choice = page.getByRole('dialog', { name: 'How would you like to begin?' })
  await expect(page.locator('.trajectory-3d-placeholder')).toBeVisible()
  await expect(page.getByTestId('trajectory-canvas-3d')).toHaveCount(0)
  await choice.getByRole('button', { name: 'Explore independently' }).click()
  await expect(choice).toHaveCount(0)
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible({ timeout: 15_000 })
})

test('keeps renderer activation while the explorer workspace is still loading', async ({ page }) => {
  let releaseExplorer!: () => void
  const explorerGate = new Promise<void>((resolve) => { releaseExplorer = resolve })
  await page.route('**/assets/ExplorerWorkspace-*.js', async (route) => {
    await explorerGate
    await route.continue()
  })

  await page.goto('./?v=4&lang=en', { waitUntil: 'domcontentloaded' })
  const choice = page.getByRole('dialog', { name: 'How would you like to begin?' })
  await expect(choice).toBeVisible()
  await choice.getByRole('button', { name: 'Start tutorial' }).click()
  await expect(page.getByRole('dialog', { name: 'Four controls, then you’re free' })).toBeVisible()
  releaseExplorer()
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible({ timeout: 15_000 })
})

test('computes the Earth-to-Mars transfer and worker porkchop map', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('./?v=4&page=mission')
  await page.getByRole('button', { name: /Compute transfer|计算转移/ }).click()
  await expect(page.getByText('5.594')).toBeVisible()
  await expect(page.getByText('C3')).toBeVisible()
  await page.getByRole('button', { name: /Build porkchop map|生成 Porkchop 图/ }).click()
  const porkchop = page.getByRole('img', { name: /Porkchop transfer opportunity heatmap/ })
  await expect(porkchop).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/Selected opportunity|已选机会/)).toBeVisible()
  await porkchop.press('ArrowRight')
  await page.getByRole('button', { name: /Use these dates|使用这组日期/ }).click()
  await expect(page.getByText('C3')).toBeVisible()
  expect(errors).toEqual([])
})

test('falls back safely when a shared mission URL has invalid parameters', async ({ page }) => {
  await page.goto('./?v=4&page=mission&from=bogus&to=mars&depart=2026-99-99&arrive=2027-02-30')
  await expect(page.getByRole('heading', { name: /Mission Lab|任务实验室/ })).toBeVisible()
  await expect(page.getByLabel(/Departure body|出发天体/)).toHaveValue('earth')
  await expect(page.getByLabel(/Arrival body|到达天体/)).toHaveValue('mars')
  await expect(page.getByLabel(/Departure date|出发日期/)).toHaveValue('2026-11-15')
  await expect(page.getByLabel(/Arrival date|到达日期/)).toHaveValue('2027-08-01')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('discloses the derived Earth geocenter and out-of-range mission extrapolation bilingually', async ({ page }) => {
  await page.goto('./?v=4&page=mission&from=earth&to=mars&depart=2050-06-01&arrive=2050-12-01&lang=en')
  await expect(page.getByText(/year 2051 is outside the 1800–2050 validity interval/)).toBeVisible()

  await page.goto('./?v=4&page=mission&from=earth&to=mars&depart=2051-01-01&arrive=2051-09-01&lang=en')
  await expect(page.getByText('Mission endpoint model boundary')).toBeVisible()
  await expect(page.getByText(/geocenter derived from the JPL Table 1 EMB seed/)).toBeVisible()
  await expect(page.getByText(/year 2052 is outside the 1800–2050 validity interval/)).toBeVisible()

  await page.goto('./?v=4&page=mission&from=ceres&to=pluto&depart=2051-01-01&arrive=2051-09-01&lang=en')
  await expect(page.locator('.mission-model-boundary')).toHaveCount(0)

  await page.goto('./?v=4&page=mission&from=earth&to=mars&depart=2051-01-01&arrive=2051-09-01&lang=zh')
  await expect(page.getByText('任务端点模型边界')).toBeVisible()
  await expect(page.getByText(/由 JPL 表 1 地月质心种子.*推导的地心/)).toBeVisible()
  await expect(page.getByText(/2052 超出 JPL 行星近似根数的 1800–2050 有效区间/)).toBeVisible()
})

test('publishes the exact planetary model provenance in Evidence and the Earth profile', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  // This regression exercises the explicitly retained fallback provenance.
  await page.route('**/data/ephemerides/**', (route) => route.abort())
  await page.goto('./?v=4&page=about&lang=en')
  await expect(page.getByText('jpl-approx-table-1')).toBeVisible()
  await expect(page.getByText('Fitted Keplerian elements with secular rates', { exact: true })).toBeVisible()
  await expect(page.getByText('Mean ecliptic and equinox of J2000', { exact: true })).toBeVisible()
  await expect(page.getByText('Earth–Moon barycenter', { exact: true })).toBeVisible()
  await expect(page.getByText('Earth geocenter derived from the EMB seed', { exact: true })).toBeVisible()
  await expect(page.getByText('de440-earth-moon-gm-partition-v1')).toBeVisible()

  await page.goto('./?v=4&page=explorer&focused=earth&lang=en')
  await page.getByRole('button', { name: 'Show body details' }).click()
  await page.getByRole('tab', { name: 'Context' }).click()
  await expect(page.getByText('Rendered point')).toBeVisible()
  await expect(page.getByText('Earth geocenter derived from the EMB seed')).toBeVisible()
  await expect(page.getByText('Orbit seed represents')).toBeVisible()
  await expect(page.getByText('Earth–Moon barycenter', { exact: true })).toBeVisible()
})

test('reports only the catalog dataset loaded by the running application', async ({ page }) => {
  await installMockCatalog(page, { precomputed: true })
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&page=about&lang=en')

  await expect(page.locator('.build-identity')).toContainText('mock-content-lite')
})

test('does not present the build-time dataset pin as loaded when the catalog is offline', async ({ page }) => {
  await page.route('**/data/asteroids/**', (route) => route.abort('internetdisconnected'))
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&page=about&lang=en')

  const identity = page.locator('.build-identity')
  await expect(identity.getByText('No dataset', { exact: true })).toBeVisible()
  await expect(identity).not.toContainText(datasetPin.version)
})

test('discloses sourced satellite frames, phases, and fixed-ellipse limits', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&page=explorer&focused=moon&bodies=earth%2Cmoon&lang=en')
  await page.getByRole('button', { name: 'Show body details' }).click()
  await page.getByRole('tab', { name: 'Context' }).click()
  await expect(page.getByText('JPL planet-centered ecliptic', { exact: true })).toBeVisible()
  await expect(page.getByText('Earth geocenter', { exact: true })).toHaveCount(2)
  await expect(page.getByText('DE440 Earth/Moon GM mass partition', { exact: true })).toBeVisible()
  await expect(page.getByText('JPL mean-elements phase', { exact: true })).toBeVisible()
  await expect(page.getByText('Fixed mean ellipse around the derived Earth geocenter; not an ephemeris', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Sources' }).click()
  await expect(page.getByRole('link', { name: /JPL satellite orbit elements/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /NAIF\/JPL DE440 GM/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /JPL approximate positions/ })).toHaveCount(0)

  await page.goto('./?v=4&page=explorer&focused=io&bodies=jupiter%2Cio&lang=zh')
  await page.getByRole('button', { name: '查看天体详情' }).click()
  await page.getByRole('tab', { name: '背景' }).click()
  await expect(page.getByText('JPL 行星中心黄道平面', { exact: true })).toBeVisible()
  await expect(page.getByText('母行星中心', { exact: true })).toBeVisible()
  await expect(page.getByText('JPL Horizons 在 JD 2451545.0 TDB 的几何密切相位', { exact: true })).toBeVisible()
  await expect(page.getByText('来自单个 J2000 历元的固定密切椭圆；不是连续星历', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '来源' }).click()
  await expect(page.getByRole('link', { name: /JPL 卫星轨道根数/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /复现这条 Horizons 历元查询/ })).toHaveAttribute('href', /COMMAND=%27501%27/)

  await page.goto('./?v=4&page=about&lang=zh')
  await expect(page.getByText('satellite-two-body-contract-v2')).toBeVisible()
  await expect(page.getByText('de440-earth-moon-gm-partition-v1')).toBeVisible()
  await expect(page.getByRole('definition').filter({ hasText: /不是连续星历/ }).first()).toBeVisible()
  await expect(page.getByRole('definition').filter({ hasText: /巨行星卫星使用 JPL Horizons/ }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: /NASA\/JPL Horizons geometric/ })).toBeVisible()
  await expect(page.getByText(/DE440 地球\/月球引力参数.*地心来源向量/)).toBeVisible()
  await expect(page.getByRole('link', { name: /NAIF\/JPL DE440 GM/ })).toBeVisible()
})

test('shows Hill and Laplace influence definitions independently', async ({ page }) => {
  await page.goto('./?v=4&view=2d')
  await page.locator('.advanced-controls > summary').click()
  await page.getByLabel(/Hill sphere|希尔球/, { exact: true }).check()
  await page.getByLabel(/Laplace SOI|拉普拉斯影响球/, { exact: true }).check()
  await expect(page.locator('.influence-hill').first()).toHaveAttribute('title', /Hill sphere/i)
  await expect(page.locator('.influence-laplace-soi').first()).toHaveAttribute('title', /Laplace SOI/)
})

test('localizes 2D canvas body labels with the active language', async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.goto('./?v=4&page=explorer&view=2d&lang=en&jd=2461287.5&speed=0')
    const labels = page.locator('.canvas-label-layer .floating-label')
    await expect.poll(async () => labels.allTextContents()).toEqual(expect.arrayContaining(['Sun', 'Earth']))
    await expect.poll(async () => labels.allTextContents()).not.toContain('太阳')
    await page.locator('.language-button').click()
    await expect.poll(async () => labels.allTextContents()).toEqual(expect.arrayContaining(['太阳', '地球']))
    await expect.poll(async () => labels.allTextContents()).not.toContain('Sun')
    await page.locator('.language-button').click()
    await expect.poll(async () => labels.allTextContents()).toEqual(expect.arrayContaining(['Sun', 'Earth']))
  }
})

test('loads and selects the complete filtered catalog separately from focus mode', async ({ page }) => {
  await installMockCatalog(page)
  await page.goto('./?v=4&page=catalog')
  await expect(page.getByRole('img', { name: /GPU catalog view of small bodies|小天体 GPU 目录视图/ })).toBeVisible()
  await page.getByRole('button', { name: /Scan full catalog|扫描完整目录/ }).click()
  await page.getByRole('button', { name: /Select complete filtered catalog|全选完整筛选目录/ }).click()
  await expect(page.getByRole('button', { name: /Clear catalog-wide selection|清除目录级全选/ })).toContainText('3')
  await expect(page.locator('.catalog-results .section-heading small')).toContainText('3')
})

test('reflows Evidence and exposes independent body and catalog actions', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 })
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&page=about&view=3d&lang=en')
  await expect(page.getByRole('heading', { name: 'Evidence' })).toBeVisible()
  const widths = await page.evaluate(() => ({
    documentClient: document.documentElement.clientWidth,
    documentScroll: document.documentElement.scrollWidth,
    bodyClient: document.body.clientWidth,
    bodyScroll: document.body.scrollWidth,
  }))
  expect(widths.documentScroll).toBe(widths.documentClient)
  expect(widths.bodyScroll).toBe(widths.bodyClient)

  await page.goto('./?v=4&page=explorer&view=2d&lang=en&bodies=earth%2Cmars&focused=earth')
  await page.locator('.advanced-controls > summary').click()
  const marsRow = page.locator('.body-check-row').filter({ hasText: 'Mars' })
  const marsCheckbox = marsRow.getByRole('checkbox', { name: 'Mars Planet' })
  const marsFocus = marsRow.getByRole('button', { name: 'Mars' })
  await expect(marsCheckbox).toBeChecked()
  await marsFocus.focus()
  await expect(marsFocus).toBeFocused()
  await marsFocus.press('Enter')
  await expect(page).toHaveURL(/[?&]focused=mars(?:&|$)/)
  await expect(marsCheckbox).toBeChecked()

  await installMockCatalog(page, { precomputed: true })
  await page.goto('./?v=4&page=catalog&lang=en')
  const catalogList = page.locator('.catalog-table')
  await expect(catalogList).toHaveRole('list')
  await expect(catalogList.locator(':scope > li')).toHaveCount(3)
  await expect(catalogList.getByRole('button', { name: /Alpha/ })).toHaveRole('button')
})

test('separates known and unknown absolute-magnitude records', async ({ page }) => {
  await installMockCatalog(page)
  await page.goto('./?v=4&page=catalog')
  const magnitudeStatus = page.getByLabel(/H status|H 状态/)
  await magnitudeStatus.selectOption('known')
  await expect(page.locator('.catalog-results .section-heading span')).toContainText('2')
  await magnitudeStatus.selectOption('unknown')
  await expect(page.locator('.catalog-results .section-heading span')).toContainText('1')
})

test('restores discrete workspace history and updates the page title', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./')
  await expect(page.locator('.trajectory-canvas, [data-testid="trajectory-canvas-3d"]')).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveTitle(/Earth|地球/)
  await openCatalog(page)
  await expect(page.getByRole('heading', { name: /Catalog|小天体目录/ })).toBeVisible()
  const missionButton = page.getByRole('button', { name: /Mission Lab|任务实验室/ }).first()
  if (await missionButton.isVisible()) await missionButton.click()
  else {
    await page.getByRole('button', { name: /More|更多/ }).click()
    await page.getByRole('button', { name: /Mission Lab|任务实验室/ }).click()
  }
  await expect(page.getByRole('heading', { name: /Mission Lab|任务实验室/ })).toBeVisible()
  await expect(page).toHaveTitle(/Earth.*Mars|地球.*火星/)
  await page.goBack()
  await expect(page.getByRole('heading', { name: /Catalog|小天体目录/ })).toBeVisible()
  await page.goBack()
  await expect(page.locator('.trajectory-canvas, [data-testid="trajectory-canvas-3d"]')).toBeVisible({ timeout: 15_000 })
  await page.goForward()
  await expect(page.getByRole('heading', { name: /Catalog|小天体目录/ })).toBeVisible()
})

test('gives every story step and mission setup a reproducible URL', async ({ page }) => {
  await page.goto('./?v=4&page=stories&story=retrograde-mars')
  await page.getByRole('button', { name: /Next|下一步/ }).click()
  await expect(page).toHaveURL(/story=retrograde-mars/)
  await expect(page).toHaveURL(/[?&]step=1(?:&|$)/)
  await page.goBack()
  await expect(page.locator('.story-copy .eyebrow')).toContainText('1/6')

  await page.goto('./?v=4&page=mission')
  await page.getByLabel(/Arrival body|到达天体/).selectOption('jupiter')
  await expect(page).toHaveURL(/[?&]to=jupiter(?:&|$)/)
  await expect(page).toHaveTitle(/Earth.*Jupiter|地球.*木星/)
})

test('keeps a guided story active across workspaces and advances its reproducible scene', async ({ page }) => {
  await page.goto('./?v=4&page=stories&story=retrograde-mars&step=0&lang=en')
  await page.getByRole('button', { name: 'Open this scene' }).click()
  const guide = page.getByRole('dialog', { name: 'Why Mars moves backward' })
  await expect(guide).toBeVisible()
  await expect(page.locator('.trajectory-canvas, [data-testid="trajectory-canvas-3d"]')).toBeVisible()
  await expect(page).toHaveURL(/[?&]guide=1(?:&|$)/)
  await guide.getByRole('button', { name: /Next/ }).click()
  await expect(page).toHaveURL(/[?&]step=1(?:&|$)/)
  await expect(guide.getByText('The faster inner track')).toBeVisible()
  await guide.getByRole('button', { name: /Reveal explanation/ }).click()
  await expect(guide.locator('.story-explanation')).toBeVisible()
  await guide.getByRole('button', { name: /Next/ }).click()
  await guide.getByRole('button', { name: /Next/ }).click()
  await guide.getByRole('button', { name: /Next/ }).click()
  await expect(page).toHaveURL(/[?&]step=4(?:&|$)/)
  await expect(page).toHaveURL(/[?&]compare=1(?:&|$)/)
  await expect(page).toHaveURL(/[?&]compareRef=sun(?:&|$)/)
  await expect(page.locator('.frames-grid.split')).toBeVisible()
})

test('searches workspaces, objects, stories, and terms from the keyboard palette', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&page=home&lang=en')
  await expect(page.locator('.trajectory-canvas, [data-testid="trajectory-canvas-3d"]')).toBeVisible({ timeout: 15_000 })
  if ((page.viewportSize()?.width ?? 1280) > 980) await page.keyboard.press('Control+K')
  else await page.getByRole('button', { name: 'Search Solar Atlas' }).click()
  const dialog = page.getByRole('dialog', { name: 'Search Solar Atlas' })
  await expect(dialog).toBeVisible()
  const searchbox = dialog.getByRole('searchbox')
  await searchbox.fill('Kirkwood')
  await searchbox.press('ArrowDown')
  await expect(dialog.getByRole('option', { name: /The gaps carved by Jupiter/ })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Stories' })).toBeVisible()
  await expect(page).toHaveURL(/[?&]story=kirkwood-gaps(?:&|$)/)

  if ((page.viewportSize()?.width ?? 1280) > 980) await page.keyboard.press('/')
  else await page.getByRole('button', { name: 'Search Solar Atlas' }).click()
  await page.getByRole('dialog', { name: 'Search Solar Atlas' }).getByRole('searchbox').fill('Mars')
  await page.getByRole('option', { name: /Mars Object/ }).click()
  await expect(page.locator('.trajectory-canvas, [data-testid="trajectory-canvas-3d"]')).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveURL(/[?&]focused=mars(?:&|$)/)
})

test('persists a named reproducible scene in the local scene library', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&page=explorer&view=2d&lang=en')
  await page.locator('.advanced-controls > summary').click()
  await page.getByPlaceholder('Scene title').fill('Mars lesson')
  await page.getByRole('button', { name: 'Save scene', exact: true }).click()
  await expect(page.getByRole('button', { name: /Mars lesson/ }).first()).toBeVisible()
  await page.reload()
  await page.locator('.advanced-controls > summary').click()
  await expect(page.getByRole('button', { name: /Mars lesson/ }).first()).toBeVisible()
})

test('falls back to the 2D explorer when the WebGL context is lost', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  await page.goto('./?v=4&page=explorer&view=3d&lang=en')
  const threeDimensional = page.getByTestId('trajectory-canvas-3d')
  await expect(threeDimensional).toBeVisible({ timeout: 15_000 })
  await threeDimensional.locator('canvas').evaluate((canvas) => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })))
  await expect(page.locator('.trajectory-canvas, [data-testid="trajectory-canvas-3d"]')).toBeVisible()
  await expect(page).toHaveURL(/[?&]view=2d(?:&|$)/)
})

test('shows recovery actions when a shared dataset version is unavailable', async ({ page }) => {
  await page.route('**/data/asteroids/releases/missing-version/manifest.json', (route) => route.fulfill({ status: 404 }))
  await page.goto('./?v=4&page=catalog&dataset=missing-version')
  await expect(page.getByText(/requested immutable dataset version is not available|请求的不可变数据集版本当前不可用/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Open current dataset|打开当前数据集/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Retry|重试/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Release metadata|查看发布元数据/ })).toBeVisible()
})
