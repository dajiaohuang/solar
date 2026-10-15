import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import type { CelestialBody } from '../../src/types'
import { utcJulianDayToEt } from '../../src/engine/ephemeris/timeScales'
import { encodeApproximationBinary } from '../../src/engine/ephemeris/approximationBinary'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

async function setup(corrupt = false, compressed = false, forecastGm?: number, binary = false, bodyIndex: boolean | 'wrong-identity' = false) {
  vi.resetModules()
  const et = utcJulianDayToEt(2461287.5), sourceHash = 'a'.repeat(64)
  const raw = JSON.stringify({ schemaVersion: 1, id: 'earth', parentId: 'sun', sourceManifestSha256: sourceHash,
    sourceKernelHashes: ['b'.repeat(64)], segments: [{ startEt: et - 86400, endEt: et + 86400,
      coefficients: [[1, ...Array(8).fill(0)], Array(9).fill(0), Array(9).fill(0)], sampledPositionErrorKm: 0, sampledVelocityErrorKmS: 0 }] })
  const data = binary ? Buffer.from(encodeApproximationBinary(JSON.parse(raw))) : Buffer.from(raw)
  const manifest = { schemaVersion: 1, model: 'piecewise-chebyshev-best-sampled-v1', frame: 'ECLIPJ2000', timeScale: 'TDB',
    positionUnit: 'km', velocityUnit: 'km/s', sourceManifestSha256: sourceHash, positionToleranceKm: 5, velocityToleranceKmS: .005,
    bodies: [{ id: 'sun', parentId: 'sun', origin: true, seedModel: false, available: true, chunks: [] },
      { id: 'earth', parentId: 'sun', seedModel: false, available: true, chunks: [{ path: binary ? 'chunks/earth%3A-0.bin.gz' : compressed ? 'chunks/earth%3A-0.json.gz' : 'chunks/earth-0.json', bytes: data.byteLength,
        ...(binary ? { encoding: 'binary-chebyshev-v1' } : {}),
        sha256: createHash('sha256').update(data).digest('hex'), startEt: et - 86400, endEt: et + 86400, segmentCount: 1 }] }] }
  if (forecastGm !== undefined) Object.assign(manifest.bodies[1], { forecasts: [{ model: 'two-body-universal',
    startEt: et - 3 * 86400, endEt: et - 86400, seedEt: et - 86400,
    seed: { position: { x: 1, y: 0, z: 0 }, velocity: { x: 0, y: 1, z: 0 } }, gmKm3S2: forecastGm,
    parameterSource: 'test source-model GM', sourceHashes: [sourceHash], sourceUrls: ['https://example.test/source'], anchorSource: 'source-fit',
    uncertainty: 'unknown-outside-source-coverage', backtest: { samples: 0, maximumPositionErrorKm: null, maximumVelocityErrorKmS: null, maximumOffsetDays: 0 } }] })
  let bodyIndexRaw = ''
  if (bodyIndex) {
    const body = manifest.bodies[1]
    bodyIndexRaw = JSON.stringify({ schemaVersion: 1, id: bodyIndex === 'wrong-identity' ? 'other' : body.id,
      parentId: body.parentId, sourceManifestSha256: sourceHash, chunks: body.chunks })
    const sha256 = createHash('sha256').update(bodyIndexRaw).digest('hex')
    Object.assign(body, { chunks: [], index: { path: `indices/${sha256}.json.gz`, bytes: Buffer.byteLength(bodyIndexRaw), sha256,
      windows: body.chunks.map(chunk => [chunk.startEt, chunk.endEt]) } })
  }
  const manifestRaw = JSON.stringify(manifest), manifestSha256 = createHash('sha256').update(manifestRaw).digest('hex')
  const payload = Buffer.from(data)
  if (corrupt) payload[payload.length - 1] ^= 1
  const fetch = vi.fn(async (url: string) => new Response(url.endsWith('index.json')
    ? JSON.stringify({ path: `manifests/${manifestSha256}.json.gz`, sha256: manifestSha256, bytes: Buffer.byteLength(manifestRaw) })
    : url.includes('/manifests/') ? new Uint8Array(gzipSync(manifestRaw))
      : url.includes('/indices/') ? new Uint8Array(gzipSync(bodyIndexRaw)) : new Uint8Array(compressed ? gzipSync(payload) : payload)))
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
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(store.approximationForBody('earth', 2461290).state).toBeNull()
  expect(store.approximationForBody('earth', 2400000).state).toBeNull()
  expect(store.getApproximationSnapshot().loading).toBe(0)
})

it('rejects changed bytes before publishing positions', async () => {
  const { store, selected } = await setup(true)
  await expect(store.ensureApproximation(selected, 2461287.5)).rejects.toThrow('SHA-256 mismatch')
  expect(store.approximationForBody('earth', 2461287.5).state).toBeNull()
  expect(store.getApproximationSnapshot().loading).toBe(0)
})

it('decodes bounded gzip and escapes literal percent signs in content-addressed filenames', async () => {
  const { store, fetch, selected } = await setup(false, true)
  await store.ensureApproximation(selected, 2461287.5)
  expect(store.approximationForBody('earth', 2461287.5).state?.position.x).toBe(1)
  expect(fetch.mock.calls[2][0]).toContain('earth%253A-0.json.gz')
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

it('uses forecasts only in their declared gaps and keeps source intervals authoritative', async () => {
  const { store, selected } = await setup(false, false, 1)
  await store.ensureApproximation(selected, 2461287.5)
  expect(store.approximationForBody('earth', 2461285.5).forecast?.uncertainty).toBe('unknown-outside-source-coverage')
  expect(Math.hypot(...Object.values(store.approximationForBody('earth', 2461285.5).state!.position))).toBeCloseTo(1, 8)
  expect(store.approximationForBody('earth', 2461287.5).forecast).toBeNull()
  expect(store.approximationForBody('earth', 2461287.5).state!.position.x).toBe(1)
  expect(store.approximationForBody('earth', 2461283.5).state).toBeNull()
})

it('rejects a forecast with invalid dynamical parameters before publishing the manifest', async () => {
  const { store, selected } = await setup(false, false, 0)
  await expect(store.ensureApproximation(selected, 2461285.5)).rejects.toThrow('Invalid forecast')
  expect(store.getApproximationManifest()).toBeNull()
})

it('loads lossless binary coefficients from compressed files or host-decoded payloads', async () => {
  for (const compressed of [true, false]) {
    const { store, selected } = await setup(false, compressed, undefined, true)
    await store.ensureApproximation(selected, 2461287.5)
    expect(store.approximationForBody('earth', 2461287.5).state).toEqual({ position: { x: 1, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } })
  }
})

it('rejects a changed binary payload before publishing or caching a state', async () => {
  const { store, selected } = await setup(true, true, undefined, true)
  await expect(store.ensureApproximation(selected, 2461287.5)).rejects.toThrow('SHA-256 mismatch')
  expect(store.approximationForBody('earth', 2461287.5).state).toBeNull()
})

it('loads selected body descriptors on demand before choosing source or forecast states', async () => {
  const { store, fetch, selected } = await setup(false, true, 1, true, true)
  await store.loadApproximationManifest()
  expect(store.approximationForBody('earth', 2461285.5).forecast).toBeNull()
  const key = store.approximationRequestKey(selected, 2461287.5)
  expect(key).toContain('indices/')
  await store.ensureApproximation(selected, 2461287.5)
  expect(fetch).toHaveBeenCalledTimes(4)
  expect(store.approximationForBody('earth', 2461287.5).state?.position.x).toBe(1)
  expect(store.approximationForBody('earth', 2461285.5).forecast).not.toBeNull()
  expect(store.approximationRequestKey(selected, 2461287.5)).toBe(key)
  await store.ensureApproximation(selected, 2461287.75)
  expect(fetch).toHaveBeenCalledTimes(4)
})

it('rejects a checksum-valid body index belonging to another identity', async () => {
  const { store, selected } = await setup(false, true, undefined, true, 'wrong-identity')
  await expect(store.ensureApproximation(selected, 2461287.5)).rejects.toThrow('Invalid body index identity')
  expect(store.approximationForBody('earth', 2461287.5).state).toBeNull()
})

async function bulkFixture(corruptIdentity = false) {
  vi.resetModules()
  const et = utcJulianDayToEt(2461287.5), source = 'a'.repeat(64)
  const files = new Map<string, string | Uint8Array>()
  const digest = (raw: string | Buffer) => createHash('sha256').update(raw).digest('hex')
  const entries = Array.from({ length: 128 }, (_, number) => {
    const id = `body-${number}`
    const raw = Buffer.from(encodeApproximationBinary({ schemaVersion: 1, id, parentId: 'sun', sourceManifestSha256: source,
      sourceKernelHashes: ['b'.repeat(64)], segments: [{ startEt: et - 86400, endEt: et + 86400,
        coefficients: [[number + 1, ...Array(8).fill(0)], Array(9).fill(0), Array(9).fill(0)], sampledPositionErrorKm: 0, sampledVelocityErrorKmS: 0 }] }))
    const path = `chunks/${id}.bin.gz`
    files.set(path, new Uint8Array(gzipSync(raw)))
    return { id, parentId: 'sun', available: true, seedModel: false, chunks: [{ path, encoding: 'binary-chebyshev-v1',
      bytes: raw.byteLength, sha256: digest(raw), startEt: et - 86400, endEt: et + 86400, segmentCount: 1 }] }
  })
  const origin = { id: 'sun', parentId: 'sun', origin: true, available: true, seedModel: false, chunks: [] }
  const complete = { schemaVersion: 1, model: 'piecewise-chebyshev-best-sampled-v1', frame: 'ECLIPJ2000', timeScale: 'TDB',
    positionUnit: 'km', velocityUnit: 'km/s', sourceManifestSha256: source, positionToleranceKm: 5, velocityToleranceKmS: .005,
    bodies: [origin, ...entries] }
  const bulk = structuredClone(complete)
  if (corruptIdentity) bulk.bodies.at(-1)!.parentId = 'other'
  const rawBulk = JSON.stringify(bulk), bulkHash = digest(rawBulk), bulkPath = `indices/${bulkHash}.json.gz`
  files.set(bulkPath, new Uint8Array(gzipSync(rawBulk)))
  const browser = { ...complete, bulkIndex: { path: bulkPath, sha256: bulkHash, bytes: Buffer.byteLength(rawBulk) },
    bodies: [origin, ...entries.map(body => {
      const raw = JSON.stringify({ schemaVersion: 1, id: body.id, parentId: body.parentId, sourceManifestSha256: source, chunks: body.chunks })
      const sha256 = digest(raw), path = `indices/${sha256}.json.gz`
      files.set(path, new Uint8Array(gzipSync(raw)))
      return { ...body, chunks: [], index: { path, sha256, bytes: Buffer.byteLength(raw), windows: body.chunks.map(chunk => [chunk.startEt, chunk.endEt]) } }
    })] }
  const rootRaw = JSON.stringify(browser), rootHash = digest(rootRaw), rootPath = `manifests/${rootHash}.json.gz`
  files.set(rootPath, new Uint8Array(gzipSync(rootRaw)))
  files.set('index.json', JSON.stringify({ path: rootPath, sha256: rootHash, bytes: Buffer.byteLength(rootRaw) }))
  const fetch = vi.fn(async (url: string) => {
    const value = files.get(url.split('/data/approximation/')[1])
    if (value === undefined) throw new Error(`Unexpected request ${url}`)
    return new Response(value)
  })
  vi.stubGlobal('fetch', fetch)
  return { store: await import('../../src/engine/ephemeris/segmentedStore'), fetch, bulkPath,
    selected: entries.map(body => ({ id: body.id })) as CelestialBody[] }
}

it('amortizes large-scene indices into one verified transfer without changing positions', async () => {
  const { store, fetch, selected, bulkPath } = await bulkFixture()
  await store.ensureApproximation(selected, 2461287.5)
  expect(fetch.mock.calls.filter(([url]) => url.includes('/indices/')).map(([url]) => url.split('/data/approximation/')[1])).toEqual([bulkPath])
  for (let index = 0; index < selected.length; index++) expect(store.approximationForBody(selected[index].id, 2461287.5).state?.position.x).toBe(index + 1)
})

it('retains individual index delivery for small selections', async () => {
  const { store, fetch, selected, bulkPath } = await bulkFixture()
  await store.ensureApproximation(selected.slice(0, 1), 2461287.5)
  expect(fetch.mock.calls).toHaveLength(4)
  expect(fetch.mock.calls.some(([url]) => url.endsWith(bulkPath))).toBe(false)
})

it('rejects a hash-valid bulk index with a changed identity before admitting any body', async () => {
  const { store, selected } = await bulkFixture(true)
  await expect(store.ensureApproximation(selected, 2461287.5)).rejects.toThrow('Invalid bulk index body')
  expect(store.approximationForBody(selected[0].id, 2461287.5).state).toBeNull()
  expect(store.getApproximationSnapshot().loading).toBe(0)
})
