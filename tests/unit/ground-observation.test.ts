import { describe, expect, it, vi } from 'vitest'
import fixture from '../fixtures/observer-api-sun.json'
import vectors from '../fixtures/ground-vectors-reference.json'
import { GroundObservationError, loadGroundObservation, validateGroundObservation } from '../../src/lib/groundObservation'

const request = fixture.result.request
const response = (body: unknown, status = 200) => {
  const bytes = JSON.stringify(body)
  return new Response(bytes, { status, headers: { 'Content-Type': 'application/json', 'Content-Length': String(new TextEncoder().encode(bytes).length) } })
}

describe('ground observation transport and evidence', () => {
  it('retains validated vector extensions and rejects partial or wrong-frame bundles', () => {
    // Transport-only composition from two independently checked references.
    // This is not represented as a captured backend response.
    const row = vectors.cases.find(row => row.bodyId === 'naif:10' && row.utc === request.utc)!
    const value = structuredClone(fixture)
    const enriched = { ...value, result: { ...value.result,
      observerState: { frame: 'J2000', origin: 'solar-system-barycenter', positionKm: row.positionKm,
        velocityKmPerSecond: row.velocityKmPerSecond, epochJdTdbParts: row.epochJdTdbParts },
      contract: { ...value.result.contract, vectorFrame: 'J2000', vectorUnit: 'km', vectorOrigin: 'observer-at-reception' },
      bodies: value.result.bodies.map(body => ({ ...body, geometricPositionKm: row.geometricPositionKm,
        receptionPositionKm: row.receptionPositionKm, lightTimeResidualSeconds: 0.00001 })),
    } }
    expect(validateGroundObservation(enriched, request).result.observerState?.positionKm).toEqual(row.positionKm)
    for (const mutate of [
      (v: typeof enriched) => { v.result.observerState.frame = 'ECLIPJ2000' },
      (v: typeof enriched) => { v.result.observerState.epochJdTdbParts = [0, 0] },
      (v: typeof enriched) => { v.result.bodies[0].receptionPositionKm = [1, 2] },
      (v: typeof enriched) => { v.result.bodies[0].lightTimeResidualSeconds = 1 },
      (v: typeof enriched) => { v.result.contract.vectorUnit = 'au' },
    ]) {
      const changed = structuredClone(enriched); mutate(changed)
      expect(() => validateGroundObservation(changed, request)).toThrow()
    }
  })
  it('accepts a captured real backend result with the original UTC, station and source hashes', () => {
    expect(validateGroundObservation(fixture, request).result.bodies[0].apparentAirless?.altitudeDeg).toBeCloseTo(75.6659293555, 8)
  })
  it('rejects mismatched request, missing source, wrong units and fabricated missing values', () => {
    for (const mutate of [
      (v: typeof fixture) => { v.result.request.utc = '2027-01-01T00:00:00Z' },
      (v: typeof fixture) => { v.result.request.station.latitudeDeg = 0 },
      (v: typeof fixture) => { v.result.bodies[0].bodyId = 'earth' },
      (v: typeof fixture) => { v.result.earthOrientation.sourceSha256 = 'b'.repeat(64) },
      (v: typeof fixture) => { v.result.sources = [] },
      (v: typeof fixture) => { v.result.contract.angleUnit = 'rad' },
      (v: typeof fixture) => { v.result.bodies[0].apparentAirless.altitudeDeg = Infinity },
      (v: typeof fixture) => { v.result.bodies[0].status = 'missing' },
    ]) {
      const value = structuredClone(fixture); mutate(value)
      expect(() => validateGroundObservation(value, request)).toThrow()
    }
  })
  it('blocks preview and unconfigured clients before fetching', async () => {
    const fetcher = vi.fn()
    await expect(loadGroundObservation('https://example.test', 'preview', request, new AbortController().signal, fetcher)).rejects.toThrow(GroundObservationError)
    await expect(loadGroundObservation(null, 'full', request, new AbortController().signal, fetcher)).rejects.toThrow(GroundObservationError)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('passes cancellation and preserves explicit IERS errors', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      controller.abort()
      expect(init?.signal?.aborted).toBe(true)
      return response(fixture)
    })
    await expect(loadGroundObservation('/api', 'full', request, controller.signal, fetcher)).rejects.toBeDefined()
    await expect(loadGroundObservation('/api', 'full', request, new AbortController().signal,
      vi.fn(async () => response({ error: { code: 'earth_orientation_unavailable', message: 'No IERS snapshot' } }, 503))))
      .rejects.toMatchObject({ code: 'earth_orientation_unavailable' })
  })
  it('bounds response bytes and validates a successful fetch', async () => {
    await expect(loadGroundObservation('/api/', 'full', request, new AbortController().signal, vi.fn(async () => response(fixture))))
      .resolves.toMatchObject({ catalogManifestSha256: fixture.catalogManifestSha256 })
    const tooLarge = new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': String(2 * 1024 * 1024) } })
    await expect(loadGroundObservation('/api', 'full', request, new AbortController().signal, vi.fn(async () => tooLarge))).rejects.toThrow('length')
  })
})
