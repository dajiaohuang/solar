import { expect, it } from 'vitest'
import { selectCatalogAllPoints } from '../../src/lib/catalogSpatialSelection'

const noYield = async () => {}

it('selects a deterministic, evenly spaced upload-order subset under the draw budget', async () => {
  const selected = await selectCatalogAllPoints(12, 4, undefined, undefined, () => false, noYield)
  expect(selected?.indices).toEqual(new Uint32Array([1, 4, 7, 10]))
  expect(selected?.visible).toBe(12)
  expect(selected?.edgeCandidates).toBe(0)
})

it('keeps every row when it fits and prioritizes focus before located selections', async () => {
  const all = await selectCatalogAllPoints(4, 8, undefined, undefined, () => false, noYield)
  expect(all?.indices).toEqual(new Uint32Array([0, 1, 2, 3]))
  const prioritized = await selectCatalogAllPoints(10, 4, 9, [2, 8], () => false, noYield)
  expect(prioritized?.indices).toEqual(new Uint32Array([2, 4, 8, 9]))
})

it('returns no partial selection after cancellation', async () => {
  const selected = await selectCatalogAllPoints(10_000, 100, undefined, undefined, () => true, noYield)
  expect(selected).toBeNull()
})
