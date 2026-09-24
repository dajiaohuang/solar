import { expect, it } from 'vitest'
import { selectCatalogSpatialPoints } from '../../src/lib/catalogSpatialSelection'
import { createCatalogSpatialIndex } from '../../src/lib/catalogSpatialIndex'

const noYield = async () => {}
const view = { radius: 1, aspect: 1, maximumPoints: 4 }

it('preserves direct selection across indexed clipping, partial blocks, rotation and invalidation', async () => {
  const count = 2051, positions = new Float32Array(count*3)
  for (let row=0; row<count; row++) positions.set(row<1024 ? [30,30,30] : [Math.sin(row),Math.cos(row),.25],row*3)
  const index = createCatalogSpatialIndex(positions,3)
  for (const tiltDegrees of [0,45,90]) {
    const camera = { ...view, maximumPoints: 100, rotation: { azimuthDegrees: 17, tiltDegrees } }
    const direct = await selectCatalogSpatialPoints(positions,count,camera,() => false,noYield)
    const indexed = await selectCatalogSpatialPoints(positions,count,camera,() => false,noYield,index)
    expect(indexed?.indices).toEqual(direct?.indices)
    expect(indexed?.visible).toBe(direct?.visible)
    expect(indexed?.skippedRows).toBeGreaterThanOrEqual(1024)
  }
  positions.set([0,0,0],0); index.invalidate(0,1)
  const camera = { ...view, maximumPoints: count, rotation: { azimuthDegrees: 0, tiltDegrees: 0 } }
  const after = await selectCatalogSpatialPoints(positions,count,camera,() => false,noYield,index)
  expect(after?.indices[0]).toBe(0)
  expect(after?.indices).toEqual((await selectCatalogSpatialPoints(positions,count,camera,() => false,noYield))?.indices)
})

it('keeps all visible collocated bodies when the uploaded count fits the display budget', async () => {
  const positions = new Float32Array([0,0, 0,0, 0,0, 3,3])
  const selected = await selectCatalogSpatialPoints(positions,4,{ ...view, focusedRow: 1 },() => false,noYield)
  expect(selected?.indices).toEqual(new Uint32Array([0,1,2]))
  expect(selected?.visible).toBe(3)
  const bounded = await selectCatalogSpatialPoints(positions,4,{ ...view, maximumPoints: 1 },() => false,noYield)
  expect(bounded?.indices).toHaveLength(1)
  expect(bounded?.visible).toBe(3)
})

it('uses the same 3D display rotation for culling, including actual z coordinates', async () => {
  const positions = new Float32Array([-.5,0,4, 0,4,0, .5,0,.5]), original = positions.slice()
  const face = await selectCatalogSpatialPoints(positions,3,{...view,maximumPoints: 100,rotation: {azimuthDegrees: 0,tiltDegrees: 0}},() => false,noYield)
  expect([...face!.indices]).toEqual([0,2])
  const edge = await selectCatalogSpatialPoints(positions,3,{...view,maximumPoints: 100,rotation: {azimuthDegrees: 0,tiltDegrees: 90}},() => false,noYield)
  expect([...edge!.indices]).toEqual([1,2])
  expect(positions).toEqual(original)
  await expect(selectCatalogSpatialPoints(positions,3,{...view,rotation: {azimuthDegrees: NaN,tiltDegrees: 0}},() => false,noYield)).rejects.toThrow('rotation')
})

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
