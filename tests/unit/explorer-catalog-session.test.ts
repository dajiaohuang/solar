import { expect, it, vi } from 'vitest'
import { createExplorerCatalogSession, planExplorerCatalog, type ExplorerCatalogSnapshot } from '../../src/lib/explorerCatalogSession'
import { catalogSourceLocator, catalogUploadedRow } from '../../src/lib/catalogSourceRow'
import { planCatalogStream, type CatalogStreamResult } from '../../src/lib/catalogStreaming'
import type { AsteroidManifest } from '../../src/types'
import type { CatalogStreamResponse } from '../../src/workers/catalog-stream.protocol'

const epoch = 2460000.5
const result = { drawnRows: 2, sourceRows: 2, complete: true } as CatalogStreamResult
function initial(session: ReturnType<typeof createExplorerCatalogSession>) {
  session.handle({ type: 'tile', tileId: 1, sourceChunk: 0, sourceRowMask: new Uint8Array([3]), sourceRows: 2, drawnRows: 2,
    positions: new Float64Array([1, 2, 3, 4]), appearance: new Uint8Array([0, 0, 0, 2]) })
  session.handle({ type: 'done', retainedEpochs: true, ...result })
}
function completion(requestId: number, julianDay: number): CatalogStreamResponse {
  return { type: 'epoch-done', requestId, julianDay, count: 2, recomputedRows: 2, reusedRows: 0, maximumDisplacementAU: 0,
    maximumDriftAU: 0, computedEpochRange: [julianDay, julianDay], blockEpochs: new Float64Array([0, 2, julianDay, 0]),
    workerTimingMs: { computeAndYield: 1, propagation: 1, cooperativeYield: 0, tileOwnershipWait: 0, reuseAckWait: 0, tileRows: 16384, maxUnacknowledgedTiles: 2, peakUnacknowledgedTiles: 1, total: 1 } }
}

it('publishes complete epochs atomically, coalesces requests, and returns transferred buffers', () => {
  const snapshots: ExplorerCatalogSnapshot[] = [], send = vi.fn()
  const session = createExplorerCatalogSession(2, '2d', epoch, send, snapshot => snapshots.push(snapshot))
  initial(session)
  expect(snapshots).toHaveLength(1)
  expect([...snapshots[0].positions]).toEqual([1, 2, 3, 4])
  expect(send.mock.calls[0][0].type).toBe('ack')
  session.request(epoch + 1); session.request(epoch + 2)
  expect(send.mock.calls.filter(call => call[0].type === 'epoch')).toHaveLength(1)
  session.handle({ type: 'epoch-start', requestId: 1, julianDay: epoch + 1, count: 2 })
  session.handle({ type: 'epoch-tile', requestId: 1, julianDay: epoch + 1, startRow: 0, count: 1, positions: new Float64Array([5, 6]) })
  expect(snapshots).toHaveLength(1)
  expect([...snapshots[0].positions]).toEqual([1, 2, 3, 4])
  session.handle({ type: 'epoch-tile', requestId: 1, julianDay: epoch + 1, startRow: 1, count: 1, positions: new Float64Array([7, 8]) })
  session.handle(completion(1, epoch + 1))
  expect([...snapshots[1].positions]).toEqual([5, 6, 7, 8])
  expect(snapshots[1].julianDay).toBe(epoch + 1)
  session.request(epoch + 2)
  expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'epoch', requestId: 2, julianDay: epoch + 2 })
  session.dispose()
  session.handle({ type: 'error', error: 'late old worker failure' })
  session.handle(completion(2, epoch + 2))
  expect(snapshots).toHaveLength(2)
})

it.each(['partial', 'wrong-epoch', 'out-of-order', 'nonfinite', 'drift'] as const)('rejects %s epoch publication', failure => {
  const publish = vi.fn(), session = createExplorerCatalogSession(2, '2d', epoch, vi.fn(), publish)
  initial(session); session.request(epoch + 1)
  session.handle({ type: 'epoch-start', requestId: 1, julianDay: epoch + 1, count: 2 })
  if (failure === 'partial') expect(() => session.handle(completion(1, epoch + 1))).toThrow('Incomplete')
  if (failure === 'wrong-epoch') expect(() => session.handle(completion(1, epoch + 2))).toThrow('identity')
  if (failure === 'out-of-order' || failure === 'nonfinite') expect(() => session.handle({ type: 'epoch-tile', requestId: 1, julianDay: epoch + 1,
    startRow: failure === 'out-of-order' ? 1 : 0, count: 1, positions: new Float64Array([NaN, 0]) })).toThrow()
  if (failure === 'drift') expect(() => session.handle({ type: 'epoch-reuse', requestId: 1, julianDay: epoch + 1, startRow: 0, count: 2, computedJulianDay: epoch, displacementAU: .1 })).toThrow('reuse')
  expect(publish).toHaveBeenCalledTimes(1)
})

it('maps picked upload ordinals back to immutable source rows across sparse shards', () => {
  const selection = { contentSha256: '', indexSha256: '', shards: [
    { chunk: 7, sha256: '', metadataSha256: '', selectedRows: new Uint8Array([0b10000001, 0b10]) },
    { chunk: 2, sha256: '', metadataSha256: '', selectedRows: new Uint8Array([0b100]) },
  ] }
  const expected = [{ chunkIndex: 7, rowIndex: 0 }, { chunkIndex: 7, rowIndex: 7 }, { chunkIndex: 7, rowIndex: 9 }, { chunkIndex: 2, rowIndex: 2 }]
  expected.forEach((locator, ordinal) => { expect(catalogSourceLocator(selection, ordinal)).toEqual(locator); expect(catalogUploadedRow(selection, locator)).toBe(ordinal) })
  for (const ordinal of [-1, 4, Infinity, .5]) expect(catalogSourceLocator(selection, ordinal)).toBeNull()
})

it('charges scene buffers beside retained propagation and admits the full pinned population at an explicit larger budget', () => {
  const manifest = { version: 'fixture', totalCount: 1_561_171, chunkSize: 5000, chunkCount: 313, format: 'binary-v1', releasePath: '/fixture',
    compactIndex: { path: 'catalog-index.bin', format: 'catalog-index-v1', strideBytes: 24, count: 1_561_171, classCodes: ['MBA'] } } as AsteroidManifest
  for (const mode of ['2d', '3d'] as const) {
    const budget = 1024 * 1024 * 1024
    const plan = planExplorerCatalog(manifest, manifest.totalCount, budget, mode)
    expect(plan.capacity).toBe(manifest.totalCount)
    expect(plan.workerBudget + plan.capacity * 208).toBeLessThanOrEqual(budget)
    expect(planCatalogStream(manifest, plan.capacity, plan.workerBudget, mode, true).capacity).toBe(plan.capacity)
    expect(planExplorerCatalog(manifest, manifest.totalCount, 256 * 1024 * 1024, mode).capacity).toBeLessThan(manifest.totalCount)
  }
})
