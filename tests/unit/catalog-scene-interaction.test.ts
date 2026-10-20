import { expect, it, vi } from 'vitest'
import { CooperativeScreenPicker } from '../../src/lib/cooperativeScreenPicker'
import { catalogFramingRadius, placeSceneLabels } from '../../src/lib/catalogScenePresentation'
import { catalogSnapshotForMode } from '../../src/hooks/useExplorerCatalog'
import type { ExplorerCatalogSnapshot } from '../../src/lib/explorerCatalogSession'
import { selectionActions, selectionStore } from '../../src/state/selection-store'
import type { CelestialBody } from '../../src/types'

it('reports successful catalog admission so a picked body can receive focus', () => {
  const previous = selectionStore.getState()
  const body = { id: 'asteroid:1', name: 'Ceres', kind: 'asteroid' } as CelestialBody
  try {
    expect(selectionActions.addCatalogBodies([body], true)).toBe(true)
    selectionActions.focus(body.id)
    expect(selectionStore.getState().focusedId).toBe(body.id)
    expect(selectionStore.getState().selectedIds).toContain(body.id)
    expect(selectionStore.getState().catalogBodies[body.id]).toBe(body)
  } finally { selectionStore.setState(previous) }
})

it('reuses one spatial snapshot and planar projection without changing ordinals or epochs', () => {
  const snapshot = { positions: new Float64Array([1, 2, 30, 4, 5, 60]), count: 2, julianDay: 2460000.5,
    appearance: new Uint8Array([0, 1, 0, 2]), revision: 1, result: {} } as ExplorerCatalogSnapshot
  const planar = catalogSnapshotForMode(snapshot, '2d')!
  expect([...planar.positions]).toEqual([1, 2, 4, 5])
  expect(planar.appearance).toBe(snapshot.appearance)
  expect(planar.julianDay).toBe(snapshot.julianDay)
  expect(catalogSnapshotForMode(snapshot, '3d')).toBe(snapshot)
  expect(catalogSnapshotForMode(snapshot, '2d')).toBe(planar)
  expect(catalogSnapshotForMode({ ...snapshot, revision: 2 }, '2d')).not.toBe(planar)
})

it('yields large picking builds, preserves tie order, and reuses the screen index', async () => {
  const picker = new CooperativeScreenPicker(), source = {}, read = vi.fn(() => ({ x: 50, y: 50 })), yieldBatch = vi.fn(async () => {})
  expect(await picker.nearest(source, 'a', 100, 100, 5000, read, () => true, 50, 50, yieldBatch)).toBe(0)
  expect(yieldBatch).toHaveBeenCalledTimes(2)
  expect(read).toHaveBeenCalledTimes(5000)
  expect(await picker.nearest(source, 'a', 100, 100, 5000, read, () => true, 51, 50, yieldBatch)).toBe(0)
  expect(read).toHaveBeenCalledTimes(5000)
  expect(await picker.nearest(source, 'b', 100, 100, 1, read, () => true, 80, 80)).toBe(-1)
  expect(read).toHaveBeenCalledTimes(5001)
})

it.each(['camera', 'epoch', 'new-click'] as const)('cancels a pending pick after %s changes', async reason => {
  const picker = new CooperativeScreenPicker()
  let valid = true
  const read = vi.fn(() => ({ x: 50, y: 50 }))
  const result = await picker.nearest({}, 'old', 100, 100, 5000, read, () => valid, 50, 50, async () => {
    if (reason === 'camera') valid = false
    else if (reason === 'epoch') picker.cancel()
    else picker.supersede()
  })
  expect(result).toBe(-1)
  expect(read).toHaveBeenCalledTimes(2048)
})

it('frames the main population relative to the origin while keeping distant points in the source', () => {
  const positions = new Float64Array(300)
  for (let row = 0; row < 100; row++) positions.set([13, 20, 30], row * 3)
  positions[297] = 10000
  expect(catalogFramingRadius(positions, 3, 100, { x: 10, y: 20, z: 30 })).toBeCloseTo(3.24)
  expect(positions[297]).toBe(10000)
  expect(catalogFramingRadius(new Float64Array(), 2, 0, { x: 0, y: 0 })).toBe(0)
})

it('prioritizes the reference label, avoids overlap, and hides offscreen labels', () => {
  const labels = placeSceneLabels([
    { id: 'reference', x: 50, y: 50, width: 35 }, { id: 'nearby', x: 50, y: 50, width: 35 },
    { id: 'far', x: 1000, y: 1000, width: 35 },
  ], 200, 100)
  expect(labels.map(label => label.id)).toEqual(['reference', 'nearby'])
  expect(Math.abs(labels[0].y - labels[1].y)).toBeGreaterThanOrEqual(18)
})
