import { test as base, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import ephemerisBodies from '../../src/data/ephemerisBodies.json' with { type: 'json' }
import satelliteCatalog from '../../src/data/satelliteCatalog.json' with { type: 'json' }
import { BODY_NAIF_IDS } from '../../src/data/ephemerisTargets'
import { backendBodyId } from '../../src/lib/currentStateIdentity'

const catalogHash = 'a'.repeat(64)
const source = 'fixture-current-states'
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

async function installCurrentStatesBackend(page: Page) {
  await page.route('**/solar-test-api/v1/capabilities', route => route.fulfill({
    json: {
      apiVersion: 'solar.api/v1', catalogVersion: datasetVersion, manifestSha256: catalogHash,
      contract: {
        timeScale: 'TDB', frame: 'ECLIPJ2000', distanceUnit: 'km', velocityUnit: 'km/s',
        precisionModes: ['exact', 'approximate-opt-in'],
        currentStates: { precision: 'exact-only', stateOriginId: 'naif:0' }, nBody: false,
        auditIdentities: [{ source, datasetVersion, model: 'spk-original' }],
      },
      limits: { currentStateIDsMax: 512 },
    },
  }))
  await page.route('**/solar-test-api/v1/current-states', async route => {
    const request = route.request()
    if (request.method() !== 'POST') return route.fulfill({ status: 405 })
    const body = JSON.parse(request.postData() ?? '{}') as { ids?: string[]; epochJd?: number; frame?: string; precision?: string }
    const ids = body.ids ?? []
    if (ids.length < 1 || ids.length > 510 || new Set(ids).size !== ids.length || body.frame !== 'ECLIPJ2000' || body.precision !== 'exact') return route.fulfill({ status: 400, json: { error: 'strict current-states fixture contract' } })
    const unavailableByEpoch = typeof body.epochJd === 'number' && Math.abs(body.epochJd - 2466154.5) < 0.01
      ? new Set(['naif:506'])
      : typeof body.epochJd === 'number' && Math.abs(body.epochJd - 2460000.5) < 0.01 ? new Set(['naif:920050000', 'naif:120050000']) : new Set<string>()
    const present = ids.map(id => knownBackendIds.has(id) && !unavailableByEpoch.has(id))
    const coverageGap = ids.map(id => knownBackendIds.has(id) && unavailableByEpoch.has(id))
    await route.fulfill({
      json: {
        apiVersion: 'solar.api/v1', catalogVersion: datasetVersion, catalogManifestSha256: catalogHash,
        epochJd: body.epochJd, timeScale: 'TDB', frame: 'ECLIPJ2000', distanceUnit: 'km', velocityUnit: 'km/s',
        stateLayout: 'row-major-[x,y,z,vx,vy,vz]', stateStride: 6, stateOriginId: 'naif:0', ids,
        availability: present.map(value => value ? 'operational' : 'missing'), precision: ids.map(() => 'exact'),
        source: ids.map(id => knownBackendIds.has(id) ? source : ''), datasetVersion: ids.map(id => knownBackendIds.has(id) ? datasetVersion : ''),
        model: ids.map((id, index) => present[index] || coverageGap[index] ? 'spk-original' : ''),
        centerIds: ids.map((id, index) => (knownBackendIds.has(id) && (present[index] || coverageGap[index])) ? 'naif:0' : ''),
        validityStartEt: ids.map(() => -1e12), validityEndEt: ids.map(() => 1e12), validityPresent: ids.map((id, index) => knownBackendIds.has(id) && (present[index] || coverageGap[index])),
        stateEvidence: present.map(value => value ? 'fixture-kernel' : ''), evidenceWindowStartEt: ids.map(() => -1e12), evidenceWindowEndEt: ids.map(() => 1e12), evidenceWindowPresent: present,
        missingReason: ids.map((id, index) => present[index] ? '' : coverageGap[index] ? 'kernel-coverage-gap' : 'unknown-identity'), identityStatus: ids.map(() => ''), sourceRecord: ids.map(() => false), statePresent: present,
        stateValues: ids.flatMap((id, index) => present[index] ? fixtureState(id) : [0, 0, 0, 0, 0, 0]),
      },
    })
  })
}

export const test = base.extend<{ currentStatesBackend: void }>({
  currentStatesBackend: [async ({ page }, use) => {
    await installCurrentStatesBackend(page)
    await use()
  }, { auto: true }],
})

export { expect }
