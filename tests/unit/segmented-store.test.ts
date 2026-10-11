import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import type { CelestialBody } from '../../src/types'
import { utcJulianDayToEt } from '../../src/engine/ephemeris/timeScales'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

async function setup(corrupt = false, compressed = false) {
  vi.resetModules()
  const et = utcJulianDayToEt(2461287.5), sourceHash = 'a'.repeat(64)
  const raw = JSON.stringify({ schemaVersion: 1, id: 'earth', parentId: 'sun', sourceManifestSha256: sourceHash,
    sourceKernelHashes: ['b'.repeat(64)], segments: [{ startEt: et - 86400, endEt: et + 86400,
      coefficients: [[1, ...Array(8).fill(0)], Array(9).fill(0), Array(9).fill(0)], sampledPositionErrorKm: 0, sampledVelocityErrorKmS: 0 }] })
  const manifest = { schemaVersion: 1, model: 'piecewise-chebyshev-best-sampled-v1', frame: 'ECLIPJ2000', timeScale: 'TDB',
    positionUnit: 'km', velocityUnit: 'km/s', sourceManifestSha256: sourceHash, positionToleranceKm: 5, velocityToleranceKmS: .005,
    bodies: [{ id: 'sun', parentId: 'sun', origin: true, seedModel: false, available: true, chunks: [] },
      { id: 'earth', parentId: 'sun', seedModel: false, available: true, chunks: [{ path: compressed ? 'chunks/earth%3A-0.json.gz' : 'chunks/earth-0.json', bytes: Buffer.byteLength(raw),
        sha256: createHash('sha256').update(raw).digest('hex'), startEt: et - 86400, endEt: et + 86400, segmentCount: 1 }] }] }
  const fetch = vi.fn(async (url: string) => new Response(url.endsWith('manifest.json') ? JSON.stringify(manifest) : compressed ? new Uint8Array(gzipSync(raw)) : corrupt ? raw.replace('"earth"', '"other"') : raw))
  vi.stubGlobal('fetch', fetch)
  const store = await import('../../src/engine/ephemeris/segmentedStore')
  return { store, fetch, selected: [{ id: 'earth' }] as CelestialBody[] }
}

it('loads only the selected epoch, shares verified chunks, and has no state outside coverage', async () => {
  const { store, fetch, selected } = await setup()
  await store.ensureApproximation(selected, 2461287.5)
  expect(store.approximationForBody('earth', 2461287.5).state?.position.x).toBe(1)
  const custom = [{ id: 'custom', parentId: 'earth' }] as CelestialBody[]
  expect(store.approximationRequestKey(custom, 2461287.5)).toContain('earth-0.json')
  expect(store.approximationRequestKey(custom, 2461290)).toBe('[]')
  await store.ensureApproximation(selected, 2461287.75)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(store.approximationForBody('earth', 2461290).state).toBeNull()
  expect(store.approximationForBody('earth', 2400000).state).toBeNull()
  expect(store.getApproximationSnapshot().loading).toBe(0)
})

it('rejects changed bytes before publishing positions', async () => {
  const { store, selected } = await setup(true)
  await expect(store.ensureApproximation(selected, 2461287.5)).rejects.toThrow('hash mismatch')
  expect(store.approximationForBody('earth', 2461287.5).state).toBeNull()
  expect(store.getApproximationSnapshot().loading).toBe(0)
})

it('decodes bounded gzip and escapes literal percent signs in content-addressed filenames', async () => {
  const { store, fetch, selected } = await setup(false, true)
  await store.ensureApproximation(selected, 2461287.5)
  expect(store.approximationForBody('earth', 2461287.5).state?.position.x).toBe(1)
  expect(fetch.mock.calls[1][0]).toContain('earth%253A-0.json.gz')
})

it('cancels a waiting consumer without waiting for a shared manifest transfer', async () => {
  const { store, fetch, selected } = await setup()
  fetch.mockImplementationOnce(() => new Promise<Response>(() => undefined))
  const controller = new AbortController()
  const operation = store.ensureApproximation(selected, 2461287.5, 2461287.5, controller.signal)
  controller.abort()
  await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
})

it('preserves user-added SBDB orbit models while built-ins remain missing before coverage loads', async () => {
  vi.resetModules()
  vi.stubGlobal('__SOLAR_WEB_EXECUTION__', 'segmented')
  const { createBodyPositionResolver, MissingBodyStateError } = await import('../../src/lib/ephemeris')
  const orbit = { model: 'keplerian' as const, epochJd: 2461287.5, epochTimeScale: 'TDB' as const,
    semiMajorAxisAU: 1, eccentricity: 0, inclinationDeg: 0, ascendingNodeDeg: 0, argPeriapsisDeg: 0, meanAnomalyDeg: 0, meanMotionDegPerDay: 1 }
  const selected = [{ id: 'sun', source: 'jpl-approx' }, { id: 'sbdb:example', source: 'jpl-sbdb', isCatalogBody: true, orbit },
    { id: 'earth', source: 'jpl-approx', orbit }] as CelestialBody[]
  const resolve = createBodyPositionResolver(new Map(selected.map(body => [body.id, body])), 2461287.5)
  const state = resolve('sbdb:example')
  expect(Math.hypot(state.x, state.y, state.z)).toBeCloseTo(1, 12)
  expect(() => resolve('earth')).toThrow(MissingBodyStateError)
})
