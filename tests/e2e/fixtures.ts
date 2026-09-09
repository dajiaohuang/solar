import { test as base, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import type { Page } from '@playwright/test'
import ephemerisBodies from '../../src/data/ephemerisBodies.json' with { type: 'json' }
import satelliteCatalog from '../../src/data/satelliteCatalog.json' with { type: 'json' }
import { BODY_NAIF_IDS } from '../../src/data/ephemerisTargets'
import { backendBodyId } from '../../src/lib/currentStateIdentity'
import { digestStateTileRequestIds, encodeStateTile, type StateTileMetadata } from '../../src/lib/stateTiles'

const catalogHash = 'a'.repeat(64)
const source = 'fixture-state-tiles'
const datasetVersion = 'fixture-v1'
const knownBackendIds = new Set([
  ...Object.entries(BODY_NAIF_IDS).map(([id, naifId]) => backendBodyId({ id, naifId })),
  ...ephemerisBodies.bodies.map(body => backendBodyId(body)),
  ...satelliteCatalog.primaries.map(body => backendBodyId(body)),
  ...satelliteCatalog.bodies.filter(body => body.naifId !== undefined).map(body => backendBodyId(body)),
])

function fixtureState(id: string) {
  let hash = 17
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  const x = (hash % 100_000) + 1
  return [x, x + 1, x + 2, 0, 0, 0]
}

function unavailableIdsAt(epochJd: number) {
  return Math.abs(epochJd - 2466154.5) < 0.01
    ? new Set(['naif:506'])
    : Math.abs(epochJd - 2460000.5) < 0.01 ? new Set(['naif:920050000', 'naif:120050000']) : new Set<string>()
}

type StateTileActivity = { active: number; peak: number; completed: number }

async function installStateTilesBackend(page: Page, mismatchedStateTileCounts: boolean, missingStateTileIds: string[], stateTileRowsPerTile: number, activity: StateTileActivity) {
  if (!Number.isInteger(stateTileRowsPerTile) || stateTileRowsPerTile < 1 || stateTileRowsPerTile > 32768) throw new Error('Invalid fixture tile size')
  let slowStateTiles = false
  const plans = new Map<string, { bodyIds: string[]; epochJd: number }>()
  await page.route('**/solar-test-api/v1/catalog/manifest', route => route.fulfill({
    json: { apiVersion: 'solar.api/v1', catalogVersion: datasetVersion, catalogManifestSha256: catalogHash },
  }))
  await page.route('**/solar-test-api/v1/state/plan*', async route => {
    const request = route.request()
    if (request.method() !== 'POST') return route.fulfill({ status: 405 })
    const body = JSON.parse(request.postData() ?? '{}') as { ids?: string[]; epochJd?: number; frame?: string; timeScale?: string; fieldMask?: string[]; precision?: string }
    const ids = body.ids ?? []
    if (ids.length < 1 || ids.length > 32768 || new Set(ids).size !== ids.length || body.frame !== 'ECLIPJ2000' || body.timeScale !== 'TDB' || JSON.stringify(body.fieldMask) !== JSON.stringify(['position', 'velocity']) || body.precision !== 'exact') return route.fulfill({ status: 400, json: { error: 'strict state-tile fixture contract' } })
    const epochJd = body.epochJd ?? NaN
    if (!Number.isFinite(epochJd)) return route.fulfill({ status: 400, json: { error: 'invalid epoch' } })
    // Concurrent current/history plans can have equal row counts but different
    // identities or sub-millisecond epochs. Bind the complete request tuple.
    const planId = createHash('sha256').update(JSON.stringify([epochJd, ids])).digest('hex')
    plans.set(planId, { bodyIds: ids, epochJd })
    const unavailable = new Set([...unavailableIdsAt(epochJd), ...missingStateTileIds])
    const exactCount = ids.filter(id => knownBackendIds.has(id) && !unavailable.has(id)).length
    // Keep the plan internally well formed but deliberately disagree with the
    // valid tile bits in the explicit protocol-rejection scenario only.
    const declaredExactCount = mismatchedStateTileCounts ? (exactCount > 0 ? exactCount - 1 : 1) : exactCount
    const tiles = Array.from({ length: Math.ceil(ids.length / stateTileRowsPerTile) }, (_, sequence) => ({ sequence, ordinalStart: sequence * stateTileRowsPerTile, ordinalCount: Math.min(stateTileRowsPerTile, ids.length - sequence * stateTileRowsPerTile) }))
    return route.fulfill({ json: { apiVersion: 'solar.api/v1', catalogVersion: datasetVersion, planId, requestIdsSha256: await digestStateTileRequestIds(ids), catalogManifestSha256: catalogHash, epochJd, timeScale: 'TDB', frame: 'ECLIPJ2000', precision: 'exact', stateOriginId: 'naif:0', distanceUnit: 'km', velocityUnit: 'km/s', stride: 6, fieldMask: ['position', 'velocity'], tileCount: tiles.length, bodyCount: ids.length, exactCount: declaredExactCount, approximateCount: 0, missingCount: ids.length - declaredExactCount, tiles } })
  })
  await page.route('**/solar-test-api/v1/state/tiles*', async route => {
    const request = route.request()
    if (request.method() !== 'POST') return route.fulfill({ status: 405 })
    const body = JSON.parse(request.postData() ?? '{}') as { planId?: string; sequence?: number }
    const plan = body.planId ? plans.get(body.planId) : undefined
    if (!plan || !Number.isInteger(body.sequence) || body.sequence! < 0 || body.sequence! >= Math.ceil(plan.bodyIds.length / stateTileRowsPerTile)) return route.fulfill({ status: 400, json: { error: 'invalid state tile request' } })
    const sequence = body.sequence!, ordinalStart = sequence * stateTileRowsPerTile
    const tileIds = plan.bodyIds.slice(ordinalStart, ordinalStart + stateTileRowsPerTile)
    // The app canonicalizes its URL after boot and may remove test-only query
    // parameters. Capture the opt-in on the first request so every later
    // response in this page keeps the intended slow-backend behavior.
    slowStateTiles ||= page.url().includes('slow-state-tiles=1')
    activity.active++; activity.peak = Math.max(activity.peak, activity.active)
    try {
      if (slowStateTiles) await new Promise(resolve => setTimeout(resolve, 1_200))
      const unavailableByEpoch = new Set([...unavailableIdsAt(plan.epochJd), ...missingStateTileIds])
      const present = tileIds.map(id => knownBackendIds.has(id) && !unavailableByEpoch.has(id))
      const metadata: StateTileMetadata[] = tileIds.map((id, index) => ({ id, availability: present[index] ? 'operational' : 'missing', precision: 'exact', source: knownBackendIds.has(id) ? source : '', datasetVersion: knownBackendIds.has(id) ? datasetVersion : '', datasetSha256: catalogHash, kernelSha256: 'b'.repeat(64), model: present[index] || unavailableByEpoch.has(id) ? 'spk-original' : '', centerId: knownBackendIds.has(id) ? 'naif:0' : '', validityStartEt: -1e12, validityEndEt: 1e12, validityPresent: true, stateEvidence: present[index] ? 'fixture-kernel' : '', evidenceWindowStartEt: -1e12, evidenceWindowEndEt: 1e12, evidenceWindowPresent: false, missingReason: present[index] ? '' : unavailableByEpoch.has(id) ? 'kernel-coverage-gap' : 'unknown-identity', identityStatus: '', sourceRecord: false }))
      const states = new Float64Array(tileIds.length * 6); tileIds.forEach((id, index) => { if (present[index]) states.set(fixtureState(id), index * 6) })
      const tile = await encodeStateTile({ sequence, tileCount: Math.ceil(plan.bodyIds.length / stateTileRowsPerTile), ordinalStart, epochJd: plan.epochJd, metadata, exact: present.flatMap((value, index) => value ? [index] : []), states, planHash: body.planId!, catalogManifestSha256: catalogHash })
      const tileBytes = Buffer.from(tile); const payloadHash = tileBytes.subarray(168, 200).toString('hex')
      activity.completed++
      // Measure backend work on this one event loop. Cross-worker browser
      // requestfinished callbacks can arrive after a later worker's request.
      // Body consumption/integrity lifetime is separately tested at the loader.
      return route.fulfill({ headers: { 'content-type': 'application/vnd.solar.state-tile+binary', 'content-length': String(tileBytes.length), etag: `"${payloadHash}"`, 'x-solar-fixture-state-tile': 'complete' }, body: tileBytes })
    } finally { activity.active-- }
  })
}

export const test = base.extend<{ stateTilesBackend: void; stateTileActivity: StateTileActivity; mismatchedStateTileCounts: boolean; missingStateTileIds: string[]; stateTileRowsPerTile: number }>({
  mismatchedStateTileCounts: [false, { option: true }],
  missingStateTileIds: [[], { option: true }],
  stateTileRowsPerTile: [32768, { option: true }],
  stateTileActivity: async ({ page }, provide) => { void page; await provide({ active: 0, peak: 0, completed: 0 }) },
  stateTilesBackend: [async ({ page, mismatchedStateTileCounts, missingStateTileIds, stateTileRowsPerTile, stateTileActivity }, use) => {
    await installStateTilesBackend(page, mismatchedStateTileCounts, missingStateTileIds, stateTileRowsPerTile, stateTileActivity)
    await use()
  }, { auto: true }],
})

export { expect }
