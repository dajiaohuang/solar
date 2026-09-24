import { expect, it } from 'vitest'
import { createCatalogSourceAppendLookup } from '../../src/lib/catalogSourceAppendLookup'
import { createCatalogEpochStore } from '../../src/lib/catalogEpochStore'
import { prepareCatalogElements } from '../../src/engine/ephemeris/catalogPoints'
import { utcJulianDayToTt } from '../../src/engine/ephemeris/timeScales'
import type { CatalogSourceSelection } from '../../src/lib/catalogStreaming'

const hash = 'a'.repeat(64)
const selection = (...entries: [number, number][]): CatalogSourceSelection => ({
  contentSha256: hash, indexSha256: hash,
  shards: entries.map(([chunk,mask]) => ({ chunk, sha256: hash, metadataSha256: hash, selectedRows: new Uint8Array([mask]) })),
})
const locator = (chunkIndex: number, rowIndex: number) => ({ chunkIndex,rowIndex })

it('keeps original upload ranks when later batches revisit the same shard', () => {
  const lookup = createCatalogSourceAppendLookup(selection([3,4],[1,1]),5)
  const pending = lookup.prepareAppend(selection([3,1],[2,2]),2)
  expect(lookup.count).toBe(2)
  expect(lookup.rows([locator(3,2),locator(1,0),locator(3,0)])).toEqual([0,1,undefined])
  pending.commit(2,2)
  const last = lookup.prepareAppend(selection([3,2]),4)
  last.commit(4,1)
  expect(lookup.rows([locator(3,2),locator(1,0),locator(3,0),locator(2,1),locator(3,1)])).toEqual([0,1,2,3,4])
  expect(() => lookup.prepareAppend(selection([3,8]),5)).toThrow('budget')
  expect(lookup.count).toBe(5)
})

it('rejects duplicate sources and wrong ACKs without publishing staged mappings', () => {
  const lookup = createCatalogSourceAppendLookup(selection([0,1]),4)
  expect(() => lookup.prepareAppend(selection([1,2],[0,1]),1)).toThrow('repeats')
  expect(lookup.row(locator(1,1))).toBeUndefined()
  const old = lookup.prepareAppend(selection([1,2]),1)
  expect(() => old.commit(1,2)).toThrow('acknowledgement')
  const active = lookup.prepareAppend(selection([1,2]),1)
  old.cancel() // A stale ticket must not cancel the current reservation.
  expect(() => lookup.prepareAppend(selection([2,1]),1)).toThrow('awaits')
  expect(() => old.commit(1,1)).toThrow('no longer active')
  active.commit(1,1)
  const changed = selection([1,4])
  changed.shards[0].metadataSha256 = 'b'.repeat(64)
  expect(() => lookup.prepareAppend(changed,2)).toThrow('identity changed')
  const cancelled = lookup.prepareAppend(selection([1,4]),2)
  cancelled.cancel()
  expect(lookup.row(locator(1,2))).toBeUndefined()
  expect(lookup.count).toBe(2)
})

const epoch = 2461287.5
const source = (radius: number) => prepareCatalogElements(new Float64Array([
  utcJulianDayToTt(epoch),radius,0,0,0,0,0,1,
]))
const callbacks = () => ({ signal: new AbortController().signal, superseded: () => false,
  yieldControl: async () => {}, onTile: async (tile: { positions: Float64Array }) => tile.positions })

it('retains separate block epochs across an acknowledged append and reconciles only stale rows', async () => {
  const store = createCatalogEpochStore(2,'2d',2)
  store.append(source(2),0,null)
  store.seal(1,epoch)
  store.appendUploaded(source(3),1,null,epoch+1)
  const plan = store.planEpoch(epoch+1,0)
  expect([...plan.starts]).toEqual([0,1])
  expect([...plan.computedJulianDays]).toEqual([epoch,epoch+1])
  expect([...plan.reuse]).toEqual([0,1])
  const updated: number[] = [], reused: number[] = []
  const result = await store.computeEpoch({ ...callbacks(), julianDay: epoch+1,
    onTile: async tile => { updated.push(tile.startRow); return tile.positions },
    onReuse: async block => { reused.push(block.startRow) } })
  expect(updated).toEqual([0]); expect(reused).toEqual([1])
  expect(result).toMatchObject({ count: 2, recomputedRows: 1, reusedRows: 1, computedEpochRange: [epoch+1,epoch+1] })
  expect([...result!.blockEpochs]).toEqual([0,1,epoch+1,0,1,1,epoch+1,0])
})

it('keeps an interrupted block invalid and permits a fresh epoch after cancellation', async () => {
  const store = createCatalogEpochStore(1,'2d',1)
  store.append(source(2),0,null); store.seal(1,epoch)
  const controller = new AbortController()
  await expect(store.computeEpoch({ ...callbacks(), signal: controller.signal, julianDay: epoch+1,
    onReuse: async () => { throw new Error('Unknown speed cannot reuse a different epoch') },
    onTile: async tile => { controller.abort(); return tile.positions },
  })).rejects.toMatchObject({ name: 'AbortError' })
  expect([...store.planEpoch(epoch,0).reuse]).toEqual([0])
  const result = await store.computeEpoch({ ...callbacks(), julianDay: epoch })
  expect(result).toMatchObject({ recomputedRows: 1, reusedRows: 0, computedEpochRange: [epoch,epoch] })
})

it('rejects a sealed append beyond the block budget without changing existing evidence', () => {
  const store = createCatalogEpochStore(2,'2d',1)
  store.append(source(2),0,null); store.seal(1,epoch)
  expect(() => store.appendUploaded(source(3),1,null,epoch+1)).toThrow('block capacity')
  expect(store.count).toBe(1)
  expect([...store.planEpoch(epoch,0).reuse]).toEqual([1])
})
