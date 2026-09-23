import { expect, it } from 'vitest'
import { selectCatalogSpatialPoints } from '../../src/lib/catalogSpatialSelection'

const noYield = async () => {}
const view = { radius: 1, aspect: 1, maximumPoints: 4 }

it('represents each occupied screen region instead of taking a source prefix', async () => {
  const positions = new Float32Array(8000)
  for (let region = 0; region < 4; region++) for (let row = 0; row < 1000; row++) positions.set([region & 1 ? .5 : -.5, region & 2 ? .5 : -.5], (region * 1000 + row) * 2)
  const original = positions.slice()
  const selected = await selectCatalogSpatialPoints(positions, 4000, view, () => false, noYield)
  expect(selected?.visible).toBe(4000)
  expect(selected?.indices).toHaveLength(4)
  expect(Array.from(selected!.indices, index => Math.floor(index / 1000))).toEqual([0, 1, 2, 3])
  expect(await selectCatalogSpatialPoints(positions, 4000, view, () => false, noYield)).toEqual(selected)
  expect(positions).toEqual(original)
})

it('tracks view radius, aspect, clipping and boundaries while respecting the count prefix', async () => {
  const positions = new Float32Array([-1, -1, 1, 1, 2, .2, .2, 2, 10, 10, NaN, NaN])
  const first = await selectCatalogSpatialPoints(positions, 5, { ...view, maximumPoints: 100 }, () => false, noYield)
  expect(first?.indices).toEqual(new Uint32Array([0, 1])); expect(first?.visible).toBe(2)
  const wider = await selectCatalogSpatialPoints(positions, 5, { ...view, aspect: 2, maximumPoints: 100 }, () => false, noYield)
  expect(wider?.indices).toEqual(new Uint32Array([0, 1, 2]))
  const empty = await selectCatalogSpatialPoints(positions, 5, { ...view, radius: .1 }, () => false, noYield)
  expect(empty?.indices).toHaveLength(0); expect(empty?.visible).toBe(0)
  expect((await selectCatalogSpatialPoints(positions, 0, view, () => false, noYield))?.indices).toHaveLength(0)
})

it('cancels at a cooperative boundary without publishing a partial result', async () => {
  const positions = new Float32Array(100_000)
  let cancelled = false, yields = 0
  const selected = await selectCatalogSpatialPoints(positions, 50_000, view, () => cancelled, async () => { yields++; cancelled = true })
  expect(selected).toBeNull(); expect(yields).toBe(1)
})

it('rejects nonfinite source positions and invalid view or row contracts', async () => {
  const positions = new Float32Array([0, 0, Infinity, 0])
  await expect(selectCatalogSpatialPoints(positions, 2, view, () => false, noYield)).rejects.toThrow('position')
  for (const count of [-1, .5, 3, NaN]) await expect(selectCatalogSpatialPoints(positions, count, view, () => false, noYield)).rejects.toThrow('view')
  for (const invalid of [{ ...view, radius: 0 }, { ...view, aspect: Infinity }, { ...view, maximumPoints: 0 }, { ...view, maximumPoints: 500001 }]) {
    await expect(selectCatalogSpatialPoints(positions, 1, invalid, () => false, noYield)).rejects.toThrow('view')
  }
})
