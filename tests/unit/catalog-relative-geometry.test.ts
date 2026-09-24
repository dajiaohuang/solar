import { expect, it } from 'vitest'
import { BufferAttribute, BufferGeometry } from 'three'
import { prepareCatalogElements, propagatePreparedCatalogPositions } from '../../src/engine/ephemeris/catalogPoints'
import { updateCatalogPointGeometry, updatePointGeometry } from '../../src/lib/pointGeometry3d'
import { buildGeometry } from '../../src/lib/trajectoryGeometry2d'
import { createProjection } from '../../src/lib/viewProjection'
import { EMPTY_CURRENT_POSITIONS } from '../../src/lib/currentPositions'
import type { AsteroidRecord, CelestialBody } from '../../src/types'

const records = [{ isNeo: false, isPha: false }] as AsteroidRecord[]

it('uploads only live point prefixes while preserving unconsumed color changes', () => {
  const key = {}, writePosition = (values: Float32Array, index: number) => values.set([index,2,3],index*3)
  const writeColor = (values: Float32Array, index: number) => values.set([1,0,0],index*3)
  const geometry = updatePointGeometry(new BufferGeometry(),3,key,writePosition,writeColor)
  const positions = geometry.getAttribute('position') as BufferAttribute
  const colors = geometry.getAttribute('color') as BufferAttribute
  expect(positions.count).toBe(256)
  expect(positions.updateRanges).toEqual([{ start: 0, count: 9 }])
  const colorVersion = colors.version
  updatePointGeometry(geometry,3,key,writePosition,writeColor)
  expect(colors.version).toBe(colorVersion)
  expect(colors.updateRanges).toEqual([{ start: 0, count: 9 }])
  // Simulate the renderer consuming the queued ranges, then another frame.
  positions.clearUpdateRanges(); colors.clearUpdateRanges()
  updatePointGeometry(geometry,3,key,writePosition,writeColor)
  expect(positions.updateRanges).toEqual([{ start: 0, count: 9 }])
  expect(colors.updateRanges).toEqual([])
  updatePointGeometry(geometry,1,key,writePosition,writeColor)
  expect(geometry.getAttribute('position')).toBe(positions)
  expect(geometry.drawRange.count).toBe(1)
  expect(positions.updateRanges).toEqual([{ start: 0, count: 3 }])
  expect(colors.updateRanges).toEqual([{ start: 0, count: 3 }])
  const version = positions.version
  updatePointGeometry(geometry,0,key,writePosition,writeColor)
  expect(geometry.drawRange.count).toBe(0)
  expect(positions.version).toBe(version)
  updatePointGeometry(geometry,2,key,writePosition,writeColor)
  expect(positions.updateRanges).toEqual([{ start: 0, count: 6 }])
  expect(colors.updateRanges).toEqual([{ start: 0, count: 6 }])
  geometry.dispose()
})

it('preserves a small orbital separation at 100 AU through propagation and independent 3D reference panes', () => {
  const radius = 100 + 1e-7
  const prepared = prepareCatalogElements(new Float64Array([2451545, radius, 0, 0, 0, 0, 0, 1]))
  const source = new Float64Array(3)
  expect(propagatePreparedCatalogPositions(prepared, 2451545, '3d', source)).toBe(source)
  expect(source[0]).toBe(radius)
  // The former absolute-Float32 path loses this separation completely.
  expect(Math.fround(source[0]) - 100).toBe(0)
  const first = updateCatalogPointGeometry(new BufferGeometry(), source, records, { x: 100, y: 0, z: 0 })
  const second = updateCatalogPointGeometry(new BufferGeometry(), source, records, { x: 100 + 2e-7, y: 0, z: 0 })
  expect(first.getAttribute('position').getX(0)).toBe(Math.fround(radius - 100))
  expect(second.getAttribute('position').getX(0)).toBe(Math.fround(radius - (100 + 2e-7)))
  expect(first.getAttribute('position').getX(0)).toBeGreaterThan(0)
  expect(second.getAttribute('position').getX(0)).toBeLessThan(0)
  const attribute = first.getAttribute('position')
  const colors = (first.getAttribute('color') as BufferAttribute).version
  expect(updateCatalogPointGeometry(first, source, records, { x: 99, y: -2, z: 3 })).toBe(first)
  expect(first.getAttribute('position')).toBe(attribute)
  expect((first.getAttribute('color') as BufferAttribute).version).toBe(colors)
  expect(Array.from(attribute.array).slice(0, 3)).toEqual([Math.fround(radius - 99), -3, 2])
  expect(source[0]).toBe(radius)
  first.dispose(); second.dispose()
})

it('subtracts the Float64 catalog origin before 2D projection and clip-space rounding', () => {
  const origin = { x: 100, y: -200 }, source = new Float64Array([100 + 1e-7, -200 - 2e-7])
  const projection = createProjection(1e-6, 800, 600, 40, { x: 0, y: 0 })
  const reference = { id: 'reference', kind: 'planet', color: '#ffffff', size: 1 } as CelestialBody
  const geometry = buildGeometry(projection, reference, [], EMPTY_CURRENT_POSITIONS, false, false, [], 1, 1, 1,
    records, source, 1, origin)
  const expectedX = Math.fround((source[0] - origin.x) * projection.scale / projection.width * 2)
  const expectedY = Math.fround((source[1] - origin.y) * projection.scale / projection.height * 2)
  expect(geometry.pointPositions[0]).toBeCloseTo(expectedX, 7)
  expect(geometry.pointPositions[1]).toBeCloseTo(expectedY, 7)
  expect(geometry.pointPositions[0]).not.toBe(0)
  expect(geometry.pointPositions[1]).not.toBe(0)
})
