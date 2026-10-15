import { expect, it } from 'vitest'
import * as THREE from 'three'
import { updateTrailBatch } from '../../src/lib/trailBatches3d'
import type { CelestialBody, TrajectorySample } from '../../src/types'

it('preserves body colors, opacity groups, edge gaps and precise camera-relative coordinates', () => {
  const body = (id: string, kind: CelestialBody['kind'], color: string) => ({ id, kind, color }) as CelestialBody
  const sources = [
    { body: body('moon', 'moon', '#ff8000'), coordinates: new Float64Array([1e9 + .125, 2, 3, 1e9 + .25, 4, 5, 1e9 + .375, 6, 7]), breakBefore: new Uint8Array([0, 0, 1]) },
    { body: body('planet', 'planet', '#00ff00'), coordinates: new Float64Array([1e9 + .5, 2, 3, 1e9 + .75, 4, 5]) },
    { body: body('asteroid', 'asteroid', '#ffffff'), coordinates: new Float64Array([0, 0, 0, 1, 1, 1]) },
  ] as TrajectorySample[]
  const line = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ opacity: .68 }))
  const origin = new THREE.Vector3(1e9, 0, 0)
  updateTrailBatch(line, sources, false, origin)
  const positions = line.geometry.getAttribute('position') as THREE.BufferAttribute
  expect(positions.getX(0)).toBe(.125)
  expect(positions.getY(0)).toBe(3)
  expect(line.geometry.drawRange.count).toBe(4)
  expect([...line.geometry.getIndex()!.array].slice(0, 4)).toEqual([0, 1, 3, 4])
  const expected = new THREE.Color('#ff8000')
  expect(line.geometry.getAttribute('color').getX(0)).toBeCloseTo(expected.r)
  const version = positions.version
  updateTrailBatch(line, sources, false, origin)
  expect(positions.version).toBe(version)
  updateTrailBatch(line, sources, false, new THREE.Vector3(1e9 + .125, 0, 0))
  expect(positions.getX(0)).toBe(0)
  expect(line.geometry.drawRange.count).toBe(4)
  updateTrailBatch(line, sources, true, new THREE.Vector3())
  expect(line.geometry.drawRange.count).toBe(2)
  expect(positions.getX(1)).toBe(1)
  updateTrailBatch(line, [], true, origin)
  expect(line.visible).toBe(false)
  expect(line.geometry.drawRange.count).toBe(0)
})
