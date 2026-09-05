import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadBackendTrajectories, TRAJECTORY_DEADLINE_MS } from '../../src/lib/backendTrajectories'
import { digestStateTileRequestIds, encodeStateTile, type StateTileMetadata } from '../../src/lib/stateTiles'
import { utcJulianDayToTdb } from '../../src/engine/ephemeris/timeScales'
import { AU_IN_KM } from '../../src/engine/units'
import type { CelestialBody } from '../../src/types'
import type { BackendTrajectoryWorkerRequest, BackendTrajectoryWorkerResponse } from '../../src/workers/backend-trajectories.protocol'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

const body = (id: string): CelestialBody => ({ id, name: id, kind: 'asteroid', color: '#fff', size: 1, source: 'custom' })
const bodies = ['a', 'b', 'c'].map(body), referenceBody = body('reference')
const hash = 'a'.repeat(64)
const input = { base: 'https://fixture.invalid', bodies, referenceBody, centerUtcJd: 2461287.5, historyDays: 1, sampleCount: 3 }
const json = (data: unknown) => { const text = JSON.stringify(data); return new Response(text, { headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)) } }) }

function fixture(options: { missing?: (epochIndex: number, id: string) => boolean; corruptEpoch?: number; changedManifestEpoch?: number; failEpoch?: number; abortEpoch?: number; controller?: AbortController } = {}) {
  let epochIndex = -1, activeTiles = 0, maxActiveTiles = 0
  const seen: { epochIndex: number; epoch: number; ids: string[]; hash: string }[] = []
  const sourceValues = (epoch: number, id: string) => [1e12 + epoch / 7 + id.charCodeAt(0), -0, 1 / 3 + id.length, epoch / 100, -0, -1 / 7]
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    init?.signal?.throwIfAborted()
    const path = new URL(String(url))
    if (path.pathname.endsWith('/catalog/manifest')) return json({ apiVersion: 'solar.api/v1', catalogVersion: 'fixture', catalogManifestSha256: hash })
    expect(path.searchParams.get('workload')).toBe('trajectory')
    if (path.pathname.endsWith('/state/plan')) {
      epochIndex++
      if (epochIndex === options.failEpoch) return json({ error: 'synthetic failure' })
      if (epochIndex === options.abortEpoch) { options.controller?.abort(); init?.signal?.throwIfAborted() }
      const request = JSON.parse(String(init?.body)) as { ids: string[]; epochJd: number; precision: string; fieldMask: string[] }
      expect(request.precision).toBe('exact'); expect(request.fieldMask).toEqual(['position', 'velocity'])
      const planHash = String(epochIndex + 1).repeat(64)
      seen.push({ epochIndex, epoch: request.epochJd, ids: request.ids, hash: planHash })
      const exactCount = request.ids.filter(id => !options.missing?.(epochIndex, id)).length
      return json({ apiVersion: 'solar.api/v1', catalogVersion: 'fixture', catalogManifestSha256: options.changedManifestEpoch === epochIndex ? 'f'.repeat(64) : hash,
        requestIdsSha256: await digestStateTileRequestIds(request.ids), planId: planHash, epochJd: request.epochJd,
        timeScale: 'TDB', frame: 'ECLIPJ2000', precision: 'exact', stateOriginId: 'naif:0', distanceUnit: 'km', velocityUnit: 'km/s',
        fieldMask: ['position', 'velocity'], stride: 6, tileCount: request.ids.length, bodyCount: request.ids.length,
        exactCount, approximateCount: 0, missingCount: request.ids.length - exactCount,
        tiles: request.ids.map((_, sequence) => ({ sequence, ordinalStart: sequence, ordinalCount: 1 })) })
    }
    const request = JSON.parse(String(init?.body)) as { sequence: number; planId: string }
    const plan = seen.find(plan => plan.hash === request.planId)!
    const id = plan.ids[request.sequence], missing = options.missing?.(plan.epochIndex, id) ?? false
    activeTiles++; maxActiveTiles = Math.max(maxActiveTiles, activeTiles)
    // Deliberately finish odd-numbered tiles first.
    await new Promise(resolve => setTimeout(resolve, request.sequence % 2 ? 0 : 5))
    const metadata: StateTileMetadata = { id, source: 'synthetic-six-vector', datasetVersion: 'fixture', datasetSha256: hash,
      kernelSha256: 'c'.repeat(64), model: 'spk-original', centerId: 'naif:0', validityStartEt: -1e12, validityEndEt: 1e12,
      validityPresent: true, stateEvidence: missing ? '' : 'synthetic-kernel', missingReason: missing ? 'synthetic-window-gap' : '',
      evidenceWindowStartEt: 0, evidenceWindowEndEt: 0, evidenceWindowPresent: false, identityStatus: '', sourceRecord: false }
    const raw = await encodeStateTile({ sequence: request.sequence, tileCount: plan.ids.length, ordinalStart: request.sequence,
      epochJd: plan.epoch, metadata: [metadata], exact: missing ? [] : [0], states: new Float64Array(missing ? 6 : sourceValues(plan.epoch, id)),
      planHash: request.planId, catalogManifestSha256: hash })
    const bytes = new Uint8Array(raw)
    const etag = Buffer.from(bytes.subarray(168, 200)).toString('hex')
    if (options.corruptEpoch === plan.epochIndex) bytes[bytes.length - 1] ^= 1
    activeTiles--
    return new Response(bytes, { headers: { 'content-type': 'application/vnd.solar.state-tile+binary', 'content-length': String(bytes.length), etag: `"${etag}"` } })
  })
  return { fetcher, seen, sourceValues, concurrency: () => maxActiveTiles }
}

describe('backend historical state tiles', () => {
  it('aborts a stalled transport at the whole-job deadline', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
    }))
    const result = loadBackendTrajectories({ ...input, signal: new AbortController().signal, fetcher })
    const rejected = expect(result).rejects.toThrow('Backend trajectory deadline exceeded')
    await vi.advanceTimersByTimeAsync(TRAJECTORY_DEADLINE_MS)
    await rejected
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('deduplicates backend aliases without dropping display identities or duplicating provenance', async () => {
    const runtime = fixture()
    const aliased = [{ ...body('first'), naifId: 100 }, { ...body('second'), naifId: 100 }]
    const result = await loadBackendTrajectories({ ...input, bodies: aliased, signal: new AbortController().signal, fetcher: runtime.fetcher })
    expect(runtime.seen.every(plan => JSON.stringify(plan.ids) === JSON.stringify(['naif:100', 'reference']))).toBe(true)
    expect(result.packed.bodyIds).toEqual(['first', 'second'])
    expect(result.audit.bodyIds).toEqual(['first', 'second', 'reference'])
    expect(result.audit.sources).toHaveLength(2)
    expect(result.audit.sourceOrdinals).toEqual(new Uint32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]))
    expect(result.packed.coordinates.slice(0, 9)).toEqual(result.packed.coordinates.slice(9))
  })

  it('preserves source-order Float64 relative samples, UTC/TDB epochs and complete interned provenance without a local model', async () => {
    const runtime = fixture(), progress: number[] = []
    const result = await loadBackendTrajectories({ ...input, signal: new AbortController().signal, fetcher: runtime.fetcher, onProgress: value => progress.push(value) })
    expect(result.packed.bodyIds).toEqual(['a', 'b', 'c'])
    expect(result.packed.trajectoryUnavailableBodyIds).toEqual([])
    const expected = new Float64Array(3 * 3 * 3)
    for (let epoch = 0; epoch < 3; epoch++) {
      const jd = utcJulianDayToTdb(input.centerUtcJd - 1 + epoch / 2)
      expect(result.audit.epochsTdbJd[epoch]).toBe(jd)
      for (let index = 0; index < bodies.length; index++) for (let axis = 0; axis < 3; axis++) {
        expected[(index * 3 + epoch) * 3 + axis] = runtime.sourceValues(jd, bodies[index].id)[axis] / AU_IN_KM - runtime.sourceValues(jd, referenceBody.id)[axis] / AU_IN_KM
      }
    }
    expect(Buffer.from(result.packed.coordinates.buffer).equals(Buffer.from(expected.buffer))).toBe(true)
    expect(runtime.concurrency()).toBe(2)
    expect(runtime.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/catalog/manifest'))).toHaveLength(1)
    expect(progress).toEqual([1 / 3, 2 / 3, 1])
    expect(result.audit).toMatchObject({ precision: 'exact-samples', referenceId: 'reference', sourceOriginId: 'naif:0', frame: 'ECLIPJ2000', timeScale: 'TDB', coordinateUnit: 'AU', catalogManifestSha256: hash, gaps: [] })
    expect(result.audit.tiles).toHaveLength(12)
    expect(result.audit.sources).toHaveLength(4)
    expect(result.audit.sourceOrdinals).toEqual(new Uint32Array([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]))
    expect(result.audit.sources[2]).toMatchObject({ id: 'c', source: 'synthetic-six-vector', kernelSha256: 'c'.repeat(64), validityPresent: true })
  })

  it.each([0, 1, 2])('drops a whole trail with a missing sample at epoch %s while retaining its first gap and source evidence', async epoch => {
    const runtime = fixture({ missing: (index, id) => index === epoch && id === 'b' })
    const result = await loadBackendTrajectories({ ...input, signal: new AbortController().signal, fetcher: runtime.fetcher })
    expect(result.packed.bodyIds).toEqual(['a', 'c'])
    expect(result.packed.trajectoryUnavailableBodyIds).toEqual(['b'])
    expect(result.audit.gaps).toEqual([{ bodyId: 'b', epochIndex: epoch, reason: 'synthetic-window-gap' }])
    expect(result.audit.sources[result.audit.sourceOrdinals[epoch * 4 + 1]].missingReason).toBe('synthetic-window-gap')
  })

  it('never substitutes a zero origin when the reference is missing at one epoch', async () => {
    const runtime = fixture({ missing: (epoch, id) => epoch === 1 && id === 'reference' })
    const result = await loadBackendTrajectories({ ...input, signal: new AbortController().signal, fetcher: runtime.fetcher })
    expect(result.packed.coordinates).toHaveLength(0)
    expect(result.packed.trajectoryUnavailableBodyIds).toEqual(['a', 'b', 'c'])
    expect(result.audit.gaps.map(gap => gap.reason)).toEqual(Array(3).fill('reference-state-unavailable:synthetic-window-gap'))
  })

  it.each(['corruptEpoch', 'changedManifestEpoch', 'failEpoch', 'abortEpoch'] as const)('rejects %s without returning a partial history or continuing later epochs', async mode => {
    const controller = new AbortController(), runtime = fixture({ [mode]: 1, controller })
    await expect(loadBackendTrajectories({ ...input, signal: controller.signal, fetcher: runtime.fetcher })).rejects.toThrow()
    expect(runtime.fetcher.mock.calls.filter(([url]) => String(url).includes('/state/plan'))).toHaveLength(2)
    expect(runtime.seen.length).toBeLessThanOrEqual(2)
  })

  it('honors cancellation at the final progress yield and rejects invalid budgets before I/O', async () => {
    const controller = new AbortController(), runtime = fixture()
    await expect(loadBackendTrajectories({ ...input, signal: controller.signal, fetcher: runtime.fetcher, onProgress: progress => { if (progress === 1) controller.abort() } })).rejects.toThrow()
    expect(runtime.seen).toHaveLength(3)
    for (const change of [{ sampleCount: 601 }, { historyDays: 0 }, { centerUtcJd: NaN }, { bodies: Array.from({ length: 321 }, (_, index) => body(String(index))) }]) {
      const fetcher = vi.fn()
      await expect(loadBackendTrajectories({ ...input, ...change, signal: new AbortController().signal, fetcher })).rejects.toThrow()
      expect(fetcher).not.toHaveBeenCalled()
    }
  })

  it('binds the history to the already displayed catalog snapshot', async () => {
    const runtime = fixture()
    await expect(loadBackendTrajectories({ ...input, signal: new AbortController().signal, fetcher: runtime.fetcher, expectedCatalogManifestSha256: 'e'.repeat(64) })).rejects.toThrow(/snapshot changed/)
    expect(runtime.fetcher.mock.calls.some(([url]) => String(url).includes('/state/tiles'))).toBe(false)
  })

  it('runs the actual backend worker entry point with validated binary tiles and transfers all four packed numeric buffers', async () => {
    vi.resetModules()
    const runtime = fixture(), messages: BackendTrajectoryWorkerResponse[] = [], transfers: Transferable[][] = []
    const scope = { onmessage: null as ((event: MessageEvent<BackendTrajectoryWorkerRequest>) => void) | null,
      postMessage(message: BackendTrajectoryWorkerResponse, transfer?: Transferable[]) {
        messages.push(structuredClone(message, { transfer })); transfers.push(transfer ?? [])
      } }
    vi.stubGlobal('fetch', runtime.fetcher); vi.stubGlobal('self', scope)
    await import('../../src/workers/backend-trajectories.worker')
    scope.onmessage!({ data: { type: 'compute', job: { ...input, requestId: 1 } } } as MessageEvent<BackendTrajectoryWorkerRequest>)
    await vi.waitFor(() => expect(messages.at(-1)?.type).toBe('result'))
    const last = messages.at(-1)!
    if (last.type !== 'result') throw new Error('Expected real backend result')
    expect(last.result.packed.bodyIds).toEqual(['a', 'b', 'c'])
    expect(last.result.audit.epochsTdbJd).toBeInstanceOf(Float64Array)
    expect(last.result.audit.sourceOrdinals).toBeInstanceOf(Uint32Array)
    expect(transfers.at(-1)).toHaveLength(4)
    expect(transfers.at(-1)!.every(buffer => (buffer as ArrayBuffer).byteLength === 0)).toBe(true)
    scope.onmessage!({ data: { type: 'dispose' } } as MessageEvent<BackendTrajectoryWorkerRequest>)
  })
})
