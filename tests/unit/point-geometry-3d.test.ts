import { expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { updatePointGeometry } from '../../src/lib/pointGeometry3d'
import { updateTrajectoryLineGeometry } from '../../src/lib/trajectoryScene3d'

it('reuses buffers and static colors across epochs, resizes only when needed', () => {
  const empty = new THREE.BufferGeometry()
  const disposed = vi.fn()
  empty.addEventListener('dispose', disposed)
  const color = vi.fn((a: Uint8Array, i: number) => { a[i * 3] = 128 })
  const first = updatePointGeometry(empty, 294, 'same IDs', (a, i) => { a[i * 3] = i }, color)
  const attribute = first.getAttribute('position')
  expect(attribute.count).toBe(512)
  expect(first.getAttribute('color').array).toBeInstanceOf(Uint8Array)
  expect(first.getAttribute('color').normalized).toBe(true)
  expect(disposed).toHaveBeenCalledOnce()
  expect(color).toHaveBeenCalledTimes(294)
  const second = updatePointGeometry(first, 294, 'same IDs', (a, i) => { a[i * 3] = i + 1 }, color)
  expect(second).toBe(first)
  expect(second.getAttribute('position')).toBe(attribute)
  expect(attribute.getX(293)).toBe(294)
  expect(color).toHaveBeenCalledTimes(294)
  expect(second.drawRange.count).toBe(294)
  updatePointGeometry(second, 294, 'different IDs', () => {}, color)
  expect(color).toHaveBeenCalledTimes(588)
  const shrunk = updatePointGeometry(second, 0, 'empty', () => {}, color)
  expect(shrunk.getAttribute('position').count).toBe(0)
  expect(shrunk.drawRange.count).toBe(0)
})

it('keeps an immutable sampled trail on the GPU during current-position ticks, then updates a new sample', () => {
  const coordinates = new Float64Array([1, 2, 3, 4, 5, 6, 7, 8, 9])
  const geometry = updateTrajectoryLineGeometry(new THREE.BufferGeometry(), coordinates)
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const version = position.version
  const edgesVersion = geometry.getIndex()!.version
  expect(updateTrajectoryLineGeometry(geometry, coordinates)).toBe(geometry)
  expect(position.version).toBe(version)
  expect(geometry.getIndex()!.version).toBe(edgesVersion)
  const changed = coordinates.slice(); changed[0] = 20
  const next = updateTrajectoryLineGeometry(geometry, changed, new Uint8Array([0, 0, 1]))
  expect(next.getAttribute('position')).toBe(position)
  expect(position.getX(0)).toBe(20)
  expect(position.version).toBeGreaterThan(version)
  expect(next.drawRange.count).toBe(2)
})
