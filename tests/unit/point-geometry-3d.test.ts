import { expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { updatePointGeometry } from '../../src/lib/pointGeometry3d'

it('reuses buffers and static colors across epochs, resizes only when needed', () => {
  const empty = new THREE.BufferGeometry()
  const disposed = vi.fn()
  empty.addEventListener('dispose', disposed)
  const color = vi.fn((a: Float32Array, i: number) => { a[i * 3] = 0.5 })
  const first = updatePointGeometry(empty, 294, 'same IDs', (a, i) => { a[i * 3] = i }, color)
  const attribute = first.getAttribute('position')
  expect(attribute.count).toBe(512)
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
