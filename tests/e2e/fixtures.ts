import { test as base, expect } from '@playwright/test'
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

async function installStateTilesBackend(page: Page) {
  let slowStateTiles = false
  const plans = new Map<string, { bodyIds: string[]; epochJd: number }>()
  await page.route('**/solar-test-api/v1/catalog/manifest', route => route.fulfill({
    json: { apiVersion: 'solar.api/v1', catalogVersion: datasetVersion, catalogManifestSha256: catalogHash },
  }))
  await page.route('**/solar-test-api/v1/state/plan', async route => {
    const request = route.request()
    if (request.method() !== 'POST') return route.fulfill({ status: 405 })
    const body = JSON.parse(request.postData() ?? '{}') as { ids?: string[]; epochJd?: number; frame?: string; timeScale?: string; fieldMask?: string[]; precision?: string }
    const ids = body.ids ?? []
    if (ids.length < 1 || ids.length > 32768 || new Set(ids).size !== ids.length || body.frame !== 'ECLIPJ2000' || body.timeScale !== 'TDB' || JSON.stringify(body.fieldMask) !== JSON.stringify(['position', 'velocity']) || body.precision !== 'exact') return route.fulfill({ status: 400, json: { error: 'strict state-tile fixture contract' } })
    const epochJd = body.epochJd ?? NaN
    if (!Number.isFinite(epochJd)) return route.fulfill({ status: 400, json: { error: 'invalid epoch' } })
    const planId = `${Math.abs(Math.round(epochJd * 1000)).toString(16)}${ids.length.toString(16)}`.padEnd(64, 'b').slice(0, 64)
    plans.set(planId, { bodyIds: ids, epochJd })
    const unavailable = unavailableIdsAt(epochJd)
    const exactCount = ids.filter(id => knownBackendIds.has(id) && !unavailable.has(id)).length
    return route.fulfill({ json: { apiVersion: 'solar.api/v1', catalogVersion: datasetVersion, planId, requestIdsSha256: await digestStateTileRequestIds(ids), catalogManifestSha256: catalogHash, epochJd, timeScale: 'TDB', frame: 'ECLIPJ2000', precision: 'exact', stateOriginId: 'naif:0', distanceUnit: 'km', velocityUnit: 'km/s', stride: 6, fieldMask: ['position', 'velocity'], tileCount: 1, bodyCount: ids.length, exactCount, approximateCount: 0, missingCount: ids.length - exactCount, tiles: [{ sequence: 0, ordinalStart: 0, ordinalCount: ids.length }] } })
  })
  await page.route('**/solar-test-api/v1/state/tiles', async route => {
    const request = route.request()
    if (request.method() !== 'POST') return route.fulfill({ status: 405 })
    const body = JSON.parse(request.postData() ?? '{}') as { planId?: string; sequence?: number }
    const plan = body.planId ? plans.get(body.planId) : undefined
    if (!plan || body.sequence !== 0) return route.fulfill({ status: 400, json: { error: 'invalid state tile request' } })
    // The app canonicalizes its URL after boot and may remove test-only query
    // parameters. Capture the opt-in on the first request so every later
    // response in this page keeps the intended slow-backend behavior.
    slowStateTiles ||= page.url().includes('slow-state-tiles=1')
    if (slowStateTiles) await new Promise(resolve => setTimeout(resolve, 1_200))
    const unavailableByEpoch = unavailableIdsAt(plan.epochJd)
    const present = plan.bodyIds.map(id => knownBackendIds.has(id) && !unavailableByEpoch.has(id))
    const metadata: StateTileMetadata[] = plan.bodyIds.map((id, index) => ({ id, availability: present[index] ? 'operational' : 'missing', precision: 'exact', source: knownBackendIds.has(id) ? source : '', datasetVersion: knownBackendIds.has(id) ? datasetVersion : '', datasetSha256: catalogHash, kernelSha256: 'b'.repeat(64), model: present[index] || unavailableByEpoch.has(id) ? 'spk-original' : '', centerId: knownBackendIds.has(id) ? 'naif:0' : '', validityStartEt: -1e12, validityEndEt: 1e12, validityPresent: true, stateEvidence: present[index] ? 'fixture-kernel' : '', evidenceWindowStartEt: -1e12, evidenceWindowEndEt: 1e12, evidenceWindowPresent: false, missingReason: present[index] ? '' : unavailableByEpoch.has(id) ? 'kernel-coverage-gap' : 'unknown-identity', identityStatus: '', sourceRecord: false }))
    const states = new Float64Array(plan.bodyIds.length * 6); plan.bodyIds.forEach((id, index) => { if (present[index]) states.set(fixtureState(id), index * 6) })
    const tile = await encodeStateTile({ sequence: 0, tileCount: 1, ordinalStart: 0, epochJd: plan.epochJd, metadata, exact: present.flatMap((value, index) => value ? [index] : []), states, planHash: body.planId!, catalogManifestSha256: catalogHash })
    const tileBytes = Buffer.from(tile); const payloadHash = tileBytes.subarray(168, 200).toString('hex')
    await route.fulfill({ headers: { 'content-type': 'application/vnd.solar.state-tile+binary', 'content-length': String(tileBytes.length), etag: `"${payloadHash}"`, 'x-solar-fixture-state-tile': 'complete' }, body: tileBytes })
  })
}

export const test = base.extend<{ stateTilesBackend: void }>({
  stateTilesBackend: [async ({ page }, use) => {
    await installStateTilesBackend(page)
    await use()
  }, { auto: true }],
})

export { expect }
