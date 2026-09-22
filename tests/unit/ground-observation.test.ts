import { describe, expect, it, vi } from 'vitest'
import fixture from '../fixtures/observer-api-sun.json'
import { GroundObservationError, loadGroundObservation, validateGroundObservation } from '../../src/lib/groundObservation'

const request = fixture.result.request
const response = (body: unknown, status = 200) => {
  const bytes = JSON.stringify(body)
  return new Response(bytes, { status, headers: { 'Content-Type': 'application/json', 'Content-Length': String(new TextEncoder().encode(bytes).length) } })
}

describe('ground observation transport and evidence', () => {
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
