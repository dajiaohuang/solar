import { describe, expect, it } from 'vitest'
import { AU_IN_KM } from '../../src/engine/units'
import { utcJulianDayToTdb } from '../../src/engine/ephemeris/timeScales'
import {
  backendBodyId,
  buildBackendFrame,
  createBackendPositionResolver,
  kmToAu,
  splitCurrentStateBatches,
  validateCapabilities,
  validateCurrentStates,
} from '../../src/lib/currentStates'
import { createLatestOnlyGate, currentStateRequestToken, fetchCurrentStates, loadAndPublishCurrentStateFrames, resetCurrentStatesCaches, sampleCurrentStateEpoch, shouldStartCurrentStateSample } from '../../src/hooks/useCurrentStates'
import { bodyPositionOrNull } from '../../src/lib/ephemeris'
import type { CelestialBody } from '../../src/types'

const hash = 'a'.repeat(64)
const inventoryHash = 'b'.repeat(64)
const epochUtc = 2461287.5
const epochTdb = utcJulianDayToTdb(epochUtc)
const capabilities = validateCapabilities({
  apiVersion: 'solar.api/v1', catalogVersion: 'full-1', manifestSha256: hash,
  coverage: { sourceInventory: { manifestSha256: inventoryHash } },
  contract: { timeScale: 'TDB', frame: 'ECLIPJ2000', distanceUnit: 'km', velocityUnit: 'km/s', precisionModes: ['exact', 'approximate-opt-in'], currentStates: { precision: 'exact-only', stateOriginId: 'naif:0' }, nBody: false, auditIdentities: [{ source: 'jpl-spk-operational', datasetVersion: 'full-1', model: 'spk-original' }, { source: 'jpl-spk-a', datasetVersion: 'full-1', model: 'spk-original' }, { source: 'jpl-spk-b', datasetVersion: 'full-1', model: 'spk-original' }] },
  limits: { currentStateIDsMax: 512 },
})

function response(ids: string[], overrides: Partial<Record<string, unknown>> = {}) {
  const n = ids.length
  return {
    apiVersion: 'solar.api/v1', catalogVersion: 'full-1', catalogManifestSha256: hash, inventoryManifestSha256: inventoryHash,
    epochJd: epochTdb, timeScale: 'TDB', frame: 'ECLIPJ2000', distanceUnit: 'km', velocityUnit: 'km/s',
    stateLayout: 'row-major-[x,y,z,vx,vy,vz]', stateStride: 6, stateOriginId: 'naif:0', ids,
    availability: Array(n).fill('operational'), precision: Array(n).fill('exact'), source: Array(n).fill('jpl-spk-operational'),
    datasetVersion: Array(n).fill('full-1'), model: Array(n).fill('spk-original'), centerIds: Array(n).fill('sun'),
    validityStartEt: Array(n).fill(0), validityEndEt: Array(n).fill(1), validityPresent: Array(n).fill(true),
    stateEvidence: Array(n).fill('catalog-kernel'), evidenceWindowStartEt: Array(n).fill(0), evidenceWindowEndEt: Array(n).fill(1), evidenceWindowPresent: Array(n).fill(true),
    missingReason: Array(n).fill(''), identityStatus: Array(n).fill(''), sourceRecord: Array(n).fill(false), statePresent: Array(n).fill(true),
    stateValues: ids.flatMap((_, index) => [index * 1000, 0, 0, 0, 0, 0]), ...overrides,
  }
}

const earth: CelestialBody = { id: 'earth', name: 'Earth', kind: 'planet', color: '#fff', size: 1, source: 'jpl-approx', naifId: 399 }
const mars: CelestialBody = { id: 'mars', name: 'Mars', kind: 'planet', color: '#fff', size: 1, source: 'jpl-approx', naifId: 499 }

describe('current-state adapter', () => {
  it('maps catalog targets and caps batches at 510', () => {
    expect(backendBodyId({ id: 'asteroid:2' })).toBe('naif:2000002')
    expect(backendBodyId({ id: 'moon', naifId: 301 })).toBe('naif:301')
    expect(backendBodyId({ id: 'ceres', naifId: 2000001 })).toBe('naif:2000001')
    expect(backendBodyId({ id: 'io', naifId: 501 })).toBe('naif:501')
    expect(backendBodyId({ id: 'eris', naifId: 920136199 })).toBe('naif:920136199')
    expect(backendBodyId({ id: 'earth', naifId: 399 })).toBe('earth')
    expect(splitCurrentStateBatches(Array.from({ length: 1021 }, (_, i) => `naif:${i}`)).map(batch => batch.length)).toEqual([510, 510, 1])
    expect(splitCurrentStateBatches(['earth', 'earth', 'mars'], 510)).toEqual([['earth', 'mars']])
  })

  it('converts only at the km/AU boundary', () => {
    expect(kmToAu(AU_IN_KM)).toBe(1)
    expect(sampleCurrentStateEpoch(epochUtc + 0.000001, true)).toBe(epochUtc + 0.000001)
    expect(sampleCurrentStateEpoch(epochUtc, false)).toBe(epochUtc)
  })

  it('uses wall-clock cadence tokens instead of simulation-JD buckets', () => {
    const playing = { isPlaying: true, sample: 4, epochUtcJd: epochUtc, seekRevision: 2 }
    expect(currentStateRequestToken(playing)).toBe(currentStateRequestToken({ ...playing, epochUtcJd: epochUtc + 30 / 86400 }))
    expect(currentStateRequestToken(playing)).not.toBe(currentStateRequestToken({ ...playing, sample: 5 }))
    expect(currentStateRequestToken(playing)).not.toBe(currentStateRequestToken({ ...playing, seekRevision: 3 }))
    const paused = { isPlaying: false, sample: 4, epochUtcJd: epochUtc, seekRevision: 2 }
    expect(currentStateRequestToken(paused)).not.toBe(currentStateRequestToken({ ...paused, epochUtcJd: epochUtc + 0.25 }))
  })

  it('does not restart a playing request for every 500ms sample while it is active', () => {
    // At 30 simulation days/second a 125ms render tick changes JD many times,
    // but the wall-clock sampler records those ticks until the large request
    // completes. Completion releases one request for the newest sample.
    expect(shouldStartCurrentStateSample({ isPlaying: true, requestActive: true, latestSample: 4, requestedSample: 0 })).toBe(false)
    expect(shouldStartCurrentStateSample({ isPlaying: true, requestActive: false, latestSample: 4, requestedSample: 0 })).toBe(true)
    expect(shouldStartCurrentStateSample({ isPlaying: true, requestActive: false, latestSample: 4, requestedSample: 4 })).toBe(false)
    expect(shouldStartCurrentStateSample({ isPlaying: false, requestActive: false, latestSample: 5, requestedSample: 4 })).toBe(false)
  })

  it('fails closed on unknown API, audit, units, source and column mismatches', () => {
    expect(() => validateCapabilities({ ...capabilities, apiVersion: 'solar.api/v2' })).toThrow()
    expect(() => validateCapabilities({ ...capabilities, contract: { ...capabilities.contract, currentStates: { precision: 'approximate-opt-in', stateOriginId: 'naif:0' } } })).toThrow()
    expect(() => validateCapabilities({ ...capabilities, contract: { ...capabilities.contract, precisionModes: ['exact', 'future-mode'] } })).toThrow()
    expect(() => validateCapabilities({ ...capabilities, manifestSha256: 'c'.repeat(64) })).not.toThrow()
    expect(() => validateCurrentStates(response(['earth'], { source: ['unknown'] }), capabilities, epochTdb)).toThrow()
    expect(() => validateCurrentStates(response(['earth'], { model: ['source-elements-two-body'] }), capabilities, epochTdb)).toThrow()
    expect(() => validateCurrentStates(response(['earth'], { availability: ['fallback'] }), capabilities, epochTdb)).toThrow()
    expect(() => validateCurrentStates(response(['earth'], { availability: ['operational'], statePresent: [false] }), capabilities, epochTdb)).toThrow()
    expect(() => validateCurrentStates(response(['earth'], { availability: ['missing'], statePresent: [true] }), capabilities, epochTdb)).toThrow()
    expect(() => validateCurrentStates(response(['earth'], { availability: ['snapshot'], statePresent: [false] }), capabilities, epochTdb)).toThrow()
    expect(() => validateCurrentStates(response(['earth'], { model: ['exact-only'] }), capabilities, epochTdb)).toThrow()
    expect(() => validateCurrentStates(response(['earth'], { availability: ['snapshot'], model: ['spk-original'] }), capabilities, epochTdb)).toThrow()
    expect(() => validateCurrentStates(response(['earth'], { apiVersion: 'solar.api/v2' }), capabilities, epochTdb)).toThrow()
    expect(() => validateCurrentStates(response(['earth'], { stateValues: [1] }), capabilities, epochTdb)).toThrow()
    expect(() => validateCurrentStates(response(['earth'], { distanceUnit: 'AU' }), capabilities, epochTdb)).toThrow()
    expect(() => validateCurrentStates(response(['earth'], { inventoryManifestSha256: 'not-a-hash' }), capabilities, epochTdb)).toThrow()
    expect(() => validateCurrentStates(response(['earth'], { centerIds: [1] }), capabilities, epochTdb)).toThrow()
    expect(() => validateCurrentStates(response(['earth'], { validityPresent: ['yes'] }), capabilities, epochTdb)).toThrow()
    expect(() => validateCurrentStates(response(['earth'], { sourceRecord: ['yes'] }), capabilities, epochTdb)).toThrow()
    expect(() => validateCurrentStates(response(['earth'], { evidenceWindowStartEt: ['bad'] }), capabilities, epochTdb)).toThrow()
    expect(validateCurrentStates(response(['earth'], { availability: ['missing'], source: ['jpl-spk-operational'], datasetVersion: ['full-1'], model: ['spk-original'], statePresent: [false], stateValues: [0, 0, 0, 0, 0, 0] }), capabilities, epochTdb).statePresent[0]).toBe(false)
    expect(() => validateCurrentStates(response(['earth'], { availability: ['missing'], source: ['untrusted'], datasetVersion: ['untrusted-v1'], model: ['unavailable-no-kernel'], statePresent: [false], stateValues: [0, 0, 0, 0, 0, 0] }), capabilities, epochTdb)).toThrow()
  })

  it('converts km to AU and subtracts a same-frame reference atomically', () => {
    const responses = [response(['earth', 'mars'], { centerIds: ['earth', 'earth'] })]
    const requested = new Map([['earth', 'earth'], ['mars', 'mars']])
    const frame = buildBackendFrame({ bodies: [earth, mars], referenceId: 'earth', requestedIds: requested, responses: [validateCurrentStates(responses[0], capabilities, epochTdb, ['earth', 'mars'])] })
    expect(frame.currentPositions).toHaveLength(2)
    expect(frame.currentPositions[0].distance).toBe(0)
    expect(frame.currentPositions[1].position3D?.x).toBeCloseTo(1000 / AU_IN_KM)
  })

  it('preserves provenance centers without requiring their source rows', () => {
    const requested = new Map([['earth', 'earth'], ['mars', 'mars']])
    const missing = buildBackendFrame({ bodies: [earth, mars], referenceId: 'earth', requestedIds: requested, responses: [validateCurrentStates(response(['earth', 'mars'], { centerIds: ['sun', 'missing-center'] }), capabilities, epochTdb)] })
    expect(missing.currentPositions).toHaveLength(2)
    const mismatched = buildBackendFrame({ bodies: [earth, mars], referenceId: 'earth', requestedIds: requested, responses: [validateCurrentStates(response(['earth', 'mars'], { source: ['jpl-spk-a', 'jpl-spk-b'] }), capabilities, epochTdb)] })
    expect(mismatched.currentPositions).toHaveLength(2)
  })

  it('treats an empty full-Web backend resolver as an ordinary missing state', () => {
    const empty = buildBackendFrame({ bodies: [earth], referenceId: 'earth', requestedIds: new Map([['earth', 'earth']]), responses: [] })
    expect(empty.currentPositions).toHaveLength(0)
    expect(bodyPositionOrNull(createBackendPositionResolver(new Map()), 'earth')).toBeNull()
  })

  it('coalesces same-epoch requests and exercises 160/294/510 payload batches', async () => {
    for (const count of [160, 294, 510]) {
      resetCurrentStatesCaches()
      const startedAt = performance.now()
      const ids = Array.from({ length: count }, (_, index) => `body:${index}`)
      let calls = 0
      const posts: Array<{ ids: string[]; requestBytes: number; responseBytes: number }> = []
      const fetcher = (async (url: string) => {
        calls += 1
        if (url.endsWith('/capabilities')) return new Response(JSON.stringify({ apiVersion: 'solar.api/v1', catalogVersion: 'full-1', manifestSha256: hash, contract: { timeScale: 'TDB', frame: 'ECLIPJ2000', distanceUnit: 'km', velocityUnit: 'km/s', precisionModes: ['exact', 'approximate-opt-in'], currentStates: { precision: 'exact-only', stateOriginId: 'naif:0' }, nBody: false, auditIdentities: [{ source: 'jpl-spk-operational', datasetVersion: 'full-1', model: 'spk-original' }] }, limits: { currentStateIDsMax: 512 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        const body = ids
        const encoded = JSON.stringify({ ids: body, epochJd: epochTdb, frame: 'ECLIPJ2000', precision: 'exact' })
        const payload = JSON.stringify(response(ids))
        posts.push({ ids: body, requestBytes: new TextEncoder().encode(encoded).byteLength, responseBytes: new TextEncoder().encode(payload).byteLength })
        return new Response(payload, { status: 200 })
      }) as typeof fetch
      const signal = new AbortController().signal
      let completedPublications = 0
      const [first, second] = await Promise.all([
        loadAndPublishCurrentStateFrames({ base: 'https://backend.test', ids, epochTdbJd: epochTdb, epochUtcJd: epochUtc, bodies: [earth], requestedIds: new Map([['earth', 'earth']]), referenceIds: ['earth'], signal, fetcher, publish: () => { completedPublications += 1 } }),
        fetchCurrentStates({ base: 'https://backend.test', ids, epochTdbJd: epochTdb, signal, fetcher }),
      ])
      expect(first.responses[0].ids).toHaveLength(count)
      expect(second.responses[0].ids).toHaveLength(count)
      expect(calls).toBe(2)
      expect(posts).toHaveLength(1)
      expect(posts[0].ids).toEqual(ids)
      expect(posts[0].requestBytes).toBeGreaterThan(0)
      expect(posts[0].responseBytes).toBeGreaterThan(0)
      const clientElapsedMs = performance.now() - startedAt
      console.info(JSON.stringify({ count, requestCount: posts.length, requestBytes: posts[0].requestBytes, responseBytes: posts[0].responseBytes, clientElapsedMs, completedPublications, failedBatchPublications: 0 }))
      expect(completedPublications).toBe(1)
    }
  })

  it('aborts the underlying POST when the last consumer leaves', async () => {
    resetCurrentStatesCaches()
    let postSignal: AbortSignal | undefined
    const fetcher = (async (url: string, init?: RequestInit) => {
      if (url.endsWith('/capabilities')) return new Response(JSON.stringify({ apiVersion: 'solar.api/v1', catalogVersion: 'full-1', manifestSha256: hash, contract: { timeScale: 'TDB', frame: 'ECLIPJ2000', distanceUnit: 'km', velocityUnit: 'km/s', precisionModes: ['exact', 'approximate-opt-in'], currentStates: { precision: 'exact-only', stateOriginId: 'naif:0' }, nBody: false, auditIdentities: [{ source: 'jpl-spk-operational', datasetVersion: 'full-1', model: 'spk-original' }] }, limits: { currentStateIDsMax: 512 } }), { status: 200 })
      postSignal = init?.signal as AbortSignal
      return new Promise<Response>((_, reject) => postSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
    }) as typeof fetch
    const controller = new AbortController()
    const pending = fetchCurrentStates({ base: 'https://backend.test', ids: ['earth'], epochTdbJd: epochTdb, signal: controller.signal, fetcher })
    await new Promise(resolve => setTimeout(resolve, 0))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(postSignal?.aborted).toBe(true)
  })

  it('rejects stale generations and publishes only a complete batch set', async () => {
    const gate = createLatestOnlyGate()
    const first = gate.begin()
    const second = gate.begin()
    expect(first.controller.signal.aborted).toBe(true)
    expect(gate.isCurrent(first)).toBe(false)
    expect(gate.isCurrent(second)).toBe(true)
    gate.cancel(second)
    expect(gate.isCurrent(second)).toBe(false)

    resetCurrentStatesCaches()
    const ids = Array.from({ length: 1020 }, (_, index) => `body:${index}`)
    let post = 0
    let completedPublications = 0
    const fetcher = (async (url: string, init?: RequestInit) => {
      if (url.endsWith('/capabilities')) return new Response(JSON.stringify({ apiVersion: 'solar.api/v1', catalogVersion: 'full-1', manifestSha256: hash, contract: { timeScale: 'TDB', frame: 'ECLIPJ2000', distanceUnit: 'km', velocityUnit: 'km/s', precisionModes: ['exact', 'approximate-opt-in'], currentStates: { precision: 'exact-only', stateOriginId: 'naif:0' }, nBody: false, auditIdentities: [{ source: 'jpl-spk-operational', datasetVersion: 'full-1', model: 'spk-original' }] }, limits: { currentStateIDsMax: 512 } }), { status: 200 })
      post += 1
      if (post === 1) return new Response(JSON.stringify(response(JSON.parse(String(init?.body)).ids)), { status: 200 })
      return new Response(JSON.stringify({ error: 'second batch failed' }), { status: 500 })
    }) as typeof fetch
    await expect(loadAndPublishCurrentStateFrames({ base: 'https://backend.test', ids, epochTdbJd: epochTdb, epochUtcJd: epochUtc, bodies: [earth], requestedIds: new Map([['earth', 'earth']]), referenceIds: ['earth'], signal: new AbortController().signal, fetcher, publish: () => { completedPublications += 1 } })).rejects.toThrow('HTTP 500')
    expect(post).toBe(2)
    expect(completedPublications).toBe(0)
  })

  it('refreshes capabilities and keys response reuse by catalog identity', async () => {
    resetCurrentStatesCaches()
    let capabilityCalls = 0
    let postCalls = 0
    const nextHash = 'c'.repeat(64)
    let backendVersion = 'full-1'
    const fetcher = (async (url: string) => {
      if (url.endsWith('/capabilities')) {
        capabilityCalls += 1
        const version = capabilityCalls === 1 ? 'full-1' : backendVersion
        const manifest = capabilityCalls === 1 ? hash : nextHash
        return new Response(JSON.stringify({ apiVersion: 'solar.api/v1', catalogVersion: version, manifestSha256: manifest, contract: { timeScale: 'TDB', frame: 'ECLIPJ2000', distanceUnit: 'km', velocityUnit: 'km/s', precisionModes: ['exact', 'approximate-opt-in'], currentStates: { precision: 'exact-only', stateOriginId: 'naif:0' }, nBody: false, auditIdentities: [{ source: 'jpl-spk-operational', datasetVersion: version, model: 'spk-original' }] }, limits: { currentStateIDsMax: 512 } }), { status: 200 })
      }
      postCalls += 1
      const second = backendVersion === 'full-2'
      return new Response(JSON.stringify(response(['earth'], second ? { catalogVersion: 'full-2', catalogManifestSha256: nextHash, datasetVersion: ['full-2'] } : {})), { status: 200 })
    }) as typeof fetch
    const signal = new AbortController().signal
    const first = await fetchCurrentStates({ base: 'https://backend.test', ids: ['earth'], epochTdbJd: epochTdb, signal, fetcher })
    backendVersion = 'full-2'
    const second = await fetchCurrentStates({ base: 'https://backend.test', ids: ['earth'], epochTdbJd: epochTdb, signal, fetcher })
    expect(first.capabilities.catalogVersion).toBe('full-1')
    expect(second.capabilities.catalogVersion).toBe('full-2')
    expect(capabilityCalls).toBe(2)
    expect(postCalls).toBe(3)
  })

  it('surfaces overload Retry-After without retrying or queuing', async () => {
    resetCurrentStatesCaches()
    let posts = 0
    const fetcher = (async (url: string) => {
      if (url.endsWith('/capabilities')) return new Response(JSON.stringify({ apiVersion: 'solar.api/v1', catalogVersion: 'full-1', manifestSha256: hash, contract: { timeScale: 'TDB', frame: 'ECLIPJ2000', distanceUnit: 'km', velocityUnit: 'km/s', precisionModes: ['exact', 'approximate-opt-in'], currentStates: { precision: 'exact-only', stateOriginId: 'naif:0' }, nBody: false, auditIdentities: [{ source: 'jpl-spk-operational', datasetVersion: 'full-1', model: 'spk-original' }] }, limits: { currentStateIDsMax: 512 } }), { status: 200 })
      posts += 1
      return new Response(JSON.stringify({ error: { code: 'overloaded', message: 'busy' } }), { status: 429, headers: { 'Retry-After': '1' } })
    }) as typeof fetch
    await expect(fetchCurrentStates({ base: 'https://backend.test', ids: ['earth'], epochTdbJd: epochTdb, signal: new AbortController().signal, fetcher })).rejects.toThrow('retry after 1s')
    expect(posts).toBe(1)
  })
})
