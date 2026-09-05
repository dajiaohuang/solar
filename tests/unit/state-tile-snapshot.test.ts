import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { StateTileSnapshot, buildBackendFrame, decodeStateTile, digestStateTileRequestIds, encodeStateTile, type StateTileMetadata } from '../../src/lib/stateTiles'
import { coveragePage, summarizeBackendCoverage } from '../../src/lib/backendCoverage'
import { createBackendPositionResolver } from '../../src/lib/backendFrames'
import { loadAndPublishStateTileFrames } from '../../src/hooks/useStateTiles'
import { AU_IN_KM } from '../../src/engine/units'
import type { CelestialBody } from '../../src/types'

const catalogManifestSha256 = 'a'.repeat(64), planHash = 'b'.repeat(64), epochJd = 2451545
const body = (id: string): CelestialBody => ({ id, name: id, kind: 'asteroid', color: '#ffffff', size: 1, source: 'custom' })
function metadata(id: string, exact: boolean): StateTileMetadata {
  return { id, source: 'synthetic-snapshot', datasetVersion: 'fixture', datasetSha256: catalogManifestSha256,
    kernelSha256: 'c'.repeat(64), model: 'spk-original', centerId: 'naif:0',
    validityStartEt: -100, validityEndEt: 100, validityPresent: true, stateEvidence: 'kernel',
    evidenceWindowStartEt: -100, evidenceWindowEndEt: 100, evidenceWindowPresent: true,
    missingReason: exact ? '' : 'synthetic-gap', identityStatus: '', sourceRecord: false }
}
async function tile(start: number, count: number) {
  const records = [], exact: number[] = [], states = new Float64Array(count * 6)
  for (let row = 0; row < count; row++) {
    const id = start + row, available = id % 7 !== 0
    records.push(metadata(`source:${id}`, available))
    if (available) {
      exact.push(row)
      for (let axis = 0; axis < 6; axis++) states[row * 6 + axis] = (id * 6 + axis) / 13
    }
  }
  if (start === 0 && count > 1) states[6] = -0
  const encoded = await encodeStateTile({ sequence: 0, tileCount: 1, ordinalStart: 0, epochJd,
    metadata: records, exact, states, planHash, catalogManifestSha256 })
  return { decoded: await decodeStateTile(encoded, { planHash, catalogManifestSha256 }), states, encoded }
}

describe('shared column-backed scientific snapshots', () => {
  it('retains 32,768+1 source rows across plans, binds aliases once and pages evidence without full audit objects', async () => {
    const count = 32_769
    const first = await tile(0, 32_768), last = await tile(32_768, 1)
    const firstRows = vi.spyOn(first.decoded.metadata, 'rowAt'), lastRows = vi.spyOn(last.decoded.metadata, 'rowAt')
    const requested = new Map(Array.from({ length: count }, (_, index) => [`body:${index}`, `source:${index}`]))
    requested.set('alias', 'source:1'); requested.set('unreceived', 'source:absent')
    // Storage order does not set requested display/audit order.
    const snapshot = new StateTileSnapshot([last.decoded, first.decoded], requested)
    expect(snapshot.length).toBe(count + 1)
    expect(snapshot.bindingByteLength).toBe((count + 1) * 8)
    expect(snapshot.bodyIdAt(count - 1)).toBe(`body:${count - 1}`)
    expect(snapshot.backendIdAt(count)).toBe('source:1')
    expect(snapshot.positionAu('alias')).toEqual(snapshot.positionAu('body:1'))
    expect(Object.is(snapshot.stateValueAt(1, 0), -0)).toBe(true)
    const actual = new Float64Array(count * 6)
    for (let index = 0; index < count; index++) for (let axis = 0; axis < 6; axis++) actual[index * 6 + axis] = snapshot.stateValueAt(index, axis)
    const expected = new Float64Array(count * 6)
    expected.set(first.states); expected.set(last.states, first.states.length)
    expect(Buffer.from(actual.buffer).equals(Buffer.from(expected.buffer))).toBe(true)
    expect(firstRows).not.toHaveBeenCalled(); expect(lastRows).not.toHaveBeenCalled()

    const selected = [...requested.keys()]
    // This case intentionally projects none: missing reference does not erase
    // received exact states, aliases, original provenance or explicit gaps.
    const frame = buildBackendFrame({ bodies: selected.map(body), referenceId: 'body:0', evidence: snapshot })
    const coverage = summarizeBackendCoverage(selected, frame)
    const gaps = Math.ceil(count / 7)
    expect(coverage).toMatchObject({ selectedCount: count + 2, receivedCount: count + 1, uniqueRequestIdentities: count,
      exactCount: count - gaps + 1, missingCount: gaps, pendingCount: 1, projectedCount: 0,
      missingReasons: [['synthetic-gap', gaps]] })
    expect(firstRows).not.toHaveBeenCalled(); expect(lastRows).not.toHaveBeenCalled()
    expect(coveragePage(coverage.rows, 13).rows.map(row => row.bodyId)).toEqual(selected.slice(260, 280))
    expect(firstRows).toHaveBeenCalledTimes(20); expect(lastRows).not.toHaveBeenCalled()
    const page = coveragePage(coverage.rows, Number.MAX_SAFE_INTEGER)
    expect(page.rows.at(-1)).toMatchObject({ bodyId: 'alias', backendId: 'source:1', precision: 'exact' })
    expect(firstRows.mock.calls.length + lastRows.mock.calls.length).toBe(30)
    firstRows.mockRestore(); lastRows.mockRestore()
  })

  it('shares a single snapshot between references and resolves only requested absolute positions', async () => {
    const { decoded, states } = await tile(0, 8)
    const requested = new Map(Array.from({ length: 8 }, (_, index) => [`body:${index}`, `source:${index}`]))
    requested.set('alias', 'source:2')
    const snapshot = new StateTileSnapshot([decoded], requested)
    const read = vi.spyOn(decoded.metadata, 'rowAt')
    const bodies = ['body:1', 'body:2', 'body:0', 'alias'].map(body)
    const first = buildBackendFrame({ bodies, referenceId: 'body:1', evidence: snapshot })
    const second = buildBackendFrame({ bodies, referenceId: 'body:2', evidence: snapshot })
    expect(first.evidence).toBe(second.evidence)
    expect(first.missingBodyIds).toEqual(['body:0'])
    expect(first.currentPositions.map(item => item.body.id)).toEqual(['body:1', 'body:2', 'alias'])
    const relative = first.currentPositions[1].position3D!
    expect(relative).toEqual({ x: states[12] / AU_IN_KM - states[6] / AU_IN_KM,
      y: states[13] / AU_IN_KM - states[7] / AU_IN_KM, z: states[14] / AU_IN_KM - states[8] / AU_IN_KM })
    expect(first.currentPositions[1].distance).toBe(Math.hypot(relative.x, relative.y, relative.z))
    expect(second.currentPositions[1].distance).toBe(0)
    const resolve = createBackendPositionResolver(id => snapshot.positionAu(id), epochJd)
    expect(resolve('alias')).toEqual(resolve('body:2'))
    expect(() => resolve('body:0')).toThrow(/No position model/)
    expect(() => resolve('unreceived')).toThrow(/No position model/)
    expect(read).not.toHaveBeenCalled()
    expect(Buffer.from(decoded.states.buffer).equals(Buffer.from(states.buffer))).toBe(true)
    const row = snapshot.rowAt(1)
    row.source = 'changed inspection copy'
    expect(snapshot.rowAt(1).source).toBe('synthetic-snapshot')
    read.mockRestore()
  })

  it('rejects duplicate identities, incoherent source snapshots and invalid ordinal/component reads', async () => {
    const { decoded } = await tile(1, 1)
    const requested = new Map([['body', 'source:1']])
    expect(() => new StateTileSnapshot([decoded, decoded], requested)).toThrow(/duplicate resolved identity/)
    for (const change of [{ epochJd: epochJd + 1 }, { catalogManifestSha256: 'd'.repeat(64) }, { inventoryManifestSha256: 'e'.repeat(64) }]) {
      expect(() => new StateTileSnapshot([decoded, { ...decoded, ...change }], requested)).toThrow(/snapshot identity or epoch mismatch/)
    }
    const snapshot = new StateTileSnapshot([decoded], requested)
    for (const index of [-1, 1, 0.5, Infinity, NaN]) {
      expect(() => snapshot.rowAt(index)).toThrow(RangeError)
      expect(() => snapshot.statusAt(index)).toThrow(RangeError)
      expect(() => snapshot.missingReasonAt(index)).toThrow(RangeError)
      expect(() => snapshot.stateValueAt(index, 0)).toThrow(RangeError)
    }
    for (const axis of [-1, 6, 1.5, NaN]) expect(() => snapshot.stateValueAt(0, axis)).toThrow(RangeError)
    const empty = new StateTileSnapshot([], requested)
    expect(empty.length).toBe(0)
    expect(empty.positionAu('body')).toBeUndefined()
    expect(empty.hasPosition('body')).toBe(false)
  })

  it('loads both 32K-bounded plans before publishing one shared multi-reference snapshot and never publishes partial failures', async () => {
    const source = [await tile(0, 32_768), await tile(32_768, 1)]
    const bodyIds = Array.from({ length: 32_769 }, (_, index) => `source:${index}`)
    const requestedIds = new Map(bodyIds.map((id, index) => [`body:${index}`, id]))
    const bodies = [...requestedIds.keys()].map(body)
    let planIndex = -1, failSecond = false, cancelSecond = false
    let controller = new AbortController()
    const json = (value: unknown) => {
      const text = JSON.stringify(value)
      return new Response(text, { headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)) } })
    }
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const url = String(input)
      if (url.endsWith('/catalog/manifest')) return json({ apiVersion: 'solar.api/v1', catalogVersion: 'fixture', catalogManifestSha256 })
      if (url.endsWith('/state/plan')) {
        planIndex++
        if (planIndex === 1 && failSecond) throw new Error('second plan unavailable')
        if (planIndex === 1 && cancelSecond) { controller.abort(); throw new DOMException('Aborted', 'AbortError') }
        const request = JSON.parse(String(init?.body)) as { ids: string[] }
        const firstId = planIndex === 0 ? 0 : 32_768
        expect(request.ids).toEqual(bodyIds.slice(firstId, firstId + source[planIndex].decoded.recordCount))
        const tile = source[planIndex].decoded
        let exactCount = 0
        for (let row = 0; row < tile.recordCount; row++) if (tile.exactBitmap[row >> 3] & (1 << (row & 7))) exactCount++
        return json({ apiVersion: 'solar.api/v1', catalogVersion: 'fixture', catalogManifestSha256, planId: planHash,
          requestIdsSha256: await digestStateTileRequestIds(request.ids), epochJd, timeScale: 'TDB', frame: 'ECLIPJ2000',
          precision: 'exact', stateOriginId: 'naif:0', distanceUnit: 'km', velocityUnit: 'km/s', stride: 6,
          fieldMask: ['position', 'velocity'], bodyCount: tile.recordCount, exactCount, approximateCount: 0,
          missingCount: tile.recordCount - exactCount, tileCount: 1,
          tiles: [{ sequence: 0, ordinalStart: 0, ordinalCount: tile.recordCount }] })
      }
      if (url.endsWith('/state/tiles')) {
        const item = source[planIndex]
        return new Response(item.encoded, { headers: { 'content-type': 'application/vnd.solar.state-tile+binary',
          'content-length': String(item.encoded.byteLength), etag: `"${item.decoded.payloadSha256}"` } })
      }
      throw new Error(`Unexpected test request: ${url}`)
    }) as typeof fetch & ReturnType<typeof vi.fn>
    const publish = vi.fn()
    const load = () => loadAndPublishStateTileFrames({ base: 'https://synthetic.example', bodyIds, epochTdbJd: epochJd,
      epochUtcJd: epochJd - 0.001, bodies, requestedIds, referenceIds: ['body:1', 'body:2'], signal: controller.signal, fetcher, publish })
    const loaded = await load()
    expect(loaded.plans.map(plan => plan.recordCount)).toEqual([32_768, 1])
    expect(fetcher).toHaveBeenCalledTimes(5)
    expect(publish).toHaveBeenCalledTimes(1)
    const first = loaded.frames.get('body:1')!, second = loaded.frames.get('body:2')!
    expect(first.evidence).toBe(second.evidence)
    expect(first.evidence.length).toBe(bodyIds.length)
    expect(first.currentPositions.length).toBe(bodyIds.length - Math.ceil(bodyIds.length / 7))
    expect(publish.mock.calls[0][0].publishedEpochUtcJd).toBe(epochJd - 0.001)
    // Failure/cancellation after a complete first plan cannot publish that plan.
    planIndex = -1; failSecond = true; publish.mockClear()
    await expect(load()).rejects.toThrow('second plan unavailable')
    expect(publish).not.toHaveBeenCalled()
    planIndex = -1; failSecond = false; cancelSecond = true; controller = new AbortController()
    await expect(load()).rejects.toMatchObject({ name: 'AbortError' })
    expect(publish).not.toHaveBeenCalled()
  })
})
