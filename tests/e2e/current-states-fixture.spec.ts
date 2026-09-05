import { expect, test } from './fixtures'
import satelliteCatalog from '../../src/data/satelliteCatalog.json' with { type: 'json' }

test.describe('mismatched precision totals', () => {
  test.use({ mismatchedStateTileCounts: true })
  test('rejects an otherwise valid tile set when its plan claims different coverage', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
    await page.goto('./?v=4&lang=en&view=3d&speed=0&ref=earth&bodies=earth,moon,mars&jd=2461287.5')
    const status = page.getByTestId('ephemeris-status')
    await status.locator('summary').click()
    await expect(status.getByRole('alert')).toContainText('plan precision count mismatch')
    await expect(page.locator('.frame-view canvas[data-position-count]:not([data-position-count="0"])')).toHaveCount(0)
  })
})

test('full-Web fixture preflights manifest/plan and preserves unknown identities in binary tiles', async ({ page }) => {
  await page.goto('./?v=4&lang=en')
  const result = await page.evaluate(async () => {
    const planFor = async (ids: string[], epochJd = 2461287.5) => {
      const manifest = await fetch('/solar-test-api/v1/catalog/manifest')
      const plan = await fetch('/solar-test-api/v1/state/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids, epochJd, timeScale: 'TDB', frame: 'ECLIPJ2000', precision: 'exact', fieldMask: ['position', 'velocity'] }) })
      return { manifestStatus: manifest.status, planStatus: plan.status, plan: plan.ok ? await plan.json() : await plan.json() }
    }
    const tileFor = async (planId: string) => {
      const response = await fetch('/solar-test-api/v1/state/tiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planId, sequence: 0 }) })
      if (!response.ok) return { status: response.status, metadata: [], statuses: [] as string[] }
      const bytes = new Uint8Array(await response.arrayBuffer()); const view = new DataView(bytes.buffer); const metadataOffset = view.getUint32(40, true); const metadataLength = view.getUint32(44, true); const exactOffset = view.getUint32(48, true); const bitmapLength = view.getUint32(52, true); const missingOffset = view.getUint32(60, true); const metadata = new TextDecoder().decode(bytes.slice(metadataOffset, metadataOffset + metadataLength)).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as { id: string; missingReason?: string }); const statuses = metadata.map((_, index) => { const exact = (bytes[exactOffset + (index >> 3)] & (1 << (index & 7))) !== 0; const missing = (bytes[missingOffset + (index >> 3)] & (1 << (index & 7))) !== 0; return exact ? 'exact' : missing ? 'missing' : 'other' }); return { status: response.status, metadata, statuses, bitmapLength }
    }
    const duplicate = await planFor(['sun', 'sun'])
    const unknownPlan = await planFor(['naif:999999999']); const unknownTile = await tileFor(unknownPlan.plan.planId)
    const stalePlan = await planFor(['quaoar']); const staleTile = await tileFor(stalePlan.plan.planId)
    const knownPlan = await planFor(['naif:920050000']); const knownTile = await tileFor(knownPlan.plan.planId)
    const coveragePlan = await planFor(['naif:920050000', 'naif:120050000'], 2460000.5); const coverageTile = await tileFor(coveragePlan.plan.planId)
    const noInventoryPlan = await planFor(['sat:planet:saturn:provisional:S/2009 S1']); const noInventoryTile = await tileFor(noInventoryPlan.plan.planId)
    return { duplicate, unknownPlan, unknownTile, stalePlan, staleTile, knownPlan, knownTile, coveragePlan, coverageTile, noInventoryPlan, noInventoryTile }
  })

  expect(result.duplicate.planStatus).toBe(400)
  expect(result.unknownPlan.manifestStatus).toBe(200); expect(result.unknownPlan.plan.tileCount).toBe(1); expect(result.unknownTile.status).toBe(200); expect(result.unknownTile.metadata[0].id).toBe('naif:999999999'); expect(result.unknownTile.statuses).toEqual(['missing'])
  expect(result.staleTile.metadata[0].id).toBe('quaoar'); expect(result.staleTile.statuses).toEqual(['missing'])
  expect(result.knownTile.metadata[0].id).toBe('naif:920050000'); expect(result.knownTile.statuses).toEqual(['exact'])
  expect(result.coverageTile.statuses).toEqual(['missing', 'missing']); expect(result.coverageTile.metadata.map(row => row.missingReason)).toEqual(['kernel-coverage-gap', 'kernel-coverage-gap'])
  expect(result.noInventoryTile.metadata[0].id).toBe('sat:planet:saturn:provisional:S/2009 S1'); expect(result.noInventoryTile.statuses).toEqual(['missing'])
})

test('keeps a slow 294-body playing tile request alive, coalesces samples, and never calls the legacy endpoint', async ({ page }) => {
  test.setTimeout(30_000)
  await page.addInitScript(() => localStorage.setItem('solar-atlas-first-run-v1', 'complete'))
  const ids = ['saturn', ...satelliteCatalog.bodies.filter(body => body.parentId === 'saturn').map(body => body.naifId === 606 ? 'titan' : body.id)]
  const legacyRequests: string[] = []; const planRequests: number[] = []; const tileRequests: number[] = []; let completedTiles = 0; const requestTimes: number[] = []; const responseTimes: number[] = []
  page.on('request', request => { if (request.url().endsWith('/solar-test-api/v1/current-states')) legacyRequests.push(request.url()); if (request.url().endsWith('/solar-test-api/v1/state/plan')) planRequests.push(Date.now()); if (request.url().endsWith('/solar-test-api/v1/state/tiles')) { tileRequests.push(Date.now()); requestTimes.push(Date.now()) } })
  page.on('response', response => { if (response.url().endsWith('/solar-test-api/v1/state/tiles') && response.ok() && response.headers()['x-solar-fixture-state-tile'] === 'complete') { completedTiles += 1; responseTimes.push(Date.now()) } })
  const query = new URLSearchParams({ v: '4', lang: 'en', speed: '30', view: '3d', ref: 'saturn', bodies: ids.join(','), jd: '2461287.5', history: '1', samples: '24', 'slow-state-tiles': '1' })
  await page.goto(`?${query}`)
  const summary = page.getByTestId('ephemeris-status').locator('summary')
  await expect.poll(() => completedTiles, { timeout: 15_000 }).toBeGreaterThan(0); await expect.poll(() => tileRequests.length - completedTiles).toBe(0); expect(legacyRequests).toHaveLength(0); expect(planRequests.length).toBeGreaterThan(0)
  await expect(summary).not.toContainText('Loading audited full-Web current states')
  const baselineTiles = tileRequests.length; const baselineCompleted = completedTiles; expect(responseTimes[0] - requestTimes[0]).toBeGreaterThanOrEqual(1_000)
  await page.locator('.simulation-bar .primary-button').click()
  await expect.poll(() => completedTiles, { timeout: 5_000 }).toBeGreaterThan(baselineCompleted)
  await expect.poll(() => tileRequests.length, { timeout: 3_000 }).toBeLessThanOrEqual(baselineTiles + 3)
  expect(legacyRequests).toHaveLength(0); expect(responseTimes.length).toBe(completedTiles)
  await page.locator('.simulation-bar .primary-button').click(); await expect(summary).not.toContainText('Loading audited full-Web current states', { timeout: 10_000 })
})
