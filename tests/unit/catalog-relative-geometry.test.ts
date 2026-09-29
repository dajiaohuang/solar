import { expect, it } from 'vitest'
import { BufferAttribute, BufferGeometry } from 'three'
import { prepareCatalogElements, propagatePreparedCatalogPositions } from '../../src/engine/ephemeris/catalogPoints'
import { updateCatalogPointGeometry, updatePointGeometry } from '../../src/lib/pointGeometry3d'
import { buildGeometry } from '../../src/lib/trajectoryGeometry2d'
import { createProjection } from '../../src/lib/viewProjection'
import { EMPTY_CURRENT_POSITIONS } from '../../src/lib/currentPositions'
import type { AsteroidRecord, CelestialBody } from '../../src/types'

const records = [{ isNeo: false, isPha: false }] as AsteroidRecord[]

it('renders packed streamed appearance in both scene dimensions without hydrating record objects', () => {
  const appearance = new Uint8Array([0, 2, 0, 1]), source = new Float64Array([101, 202, 303, 104, 205, 306])
  const geometry = updateCatalogPointGeometry(new BufferGeometry(), source, [], { x: 100, y: 200, z: 300 }, 2, source, appearance)
  expect(geometry.drawRange.count).toBe(2)
  expect([...geometry.getAttribute('position').array].slice(0, 6)).toEqual([1, 3, 2, 4, 6, 5])
  expect([...geometry.getAttribute('color').array].slice(0, 6)).toEqual([255, 89, 77, 255, 158, 128])
  geometry.dispose()
  const planar = buildGeometry(createProjection(10, 800, 600, 40, { x: 0, y: 0 }), { id: 'sun', color: '#fff' } as CelestialBody,
    [], EMPTY_CURRENT_POSITIONS, false, false, [], 1, 1, 1, [], new Float64Array([101, 202, 104, 205]), 2, { x: 100, y: 200 },
    undefined, undefined, undefined, undefined, undefined, appearance)
  expect(planar.pointSizes.length).toBe(3)
  expect(planar.pointSizes[0]).toBeCloseTo(2.8)
  expect(planar.pointSizes[1]).toBeCloseTo(2.2)
})

it('uploads only live point prefixes while preserving unconsumed color changes', () => {
  const key = {}, writePosition = (values: Float32Array, index: number) => values.set([index,2,3],index*3)
  const writeColor = (values: Uint8Array, index: number) => values.set([255,0,0],index*3)
  const geometry = updatePointGeometry(new BufferGeometry(),3,key,writePosition,writeColor)
  const positions = geometry.getAttribute('position') as BufferAttribute
  const colors = geometry.getAttribute('color') as BufferAttribute
  expect(positions.count).toBe(256)
  expect(colors.array).toBeInstanceOf(Uint8Array)
  expect(colors.normalized).toBe(true)
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
  expect(colors.updateRanges).toEqual([])
  const version = positions.version
  updatePointGeometry(geometry,0,key,writePosition,writeColor)
  expect(geometry.drawRange.count).toBe(0)
  expect(positions.version).toBe(version)
  updatePointGeometry(geometry,2,key,writePosition,writeColor)
  expect(positions.updateRanges).toEqual([{ start: 0, count: 6 }])
  expect(colors.updateRanges).toEqual([{ start: 0, count: 6 }])
  geometry.dispose()
})

it('packs only the visible catalog prefix and appends new rows when the budget grows', () => {
  const rows = [{ isNeo: false, isPha: false }, { isNeo: true, isPha: false }, { isNeo: false, isPha: true }] as AsteroidRecord[]
  const source = new Float64Array([10, 20, 30, 40, 50, 60, 70, 80, 90])
  const origin = { x: 1, y: 2, z: 3 }
  const firstKey = { source, origin }
  const geometry = updateCatalogPointGeometry(new BufferGeometry(), source, rows, origin, 1, firstKey)
  const position = geometry.getAttribute('position') as BufferAttribute
  const color = geometry.getAttribute('color') as BufferAttribute
  expect(geometry.drawRange.count).toBe(1)
  expect(Array.from(position.array as Float32Array).slice(0, 6)).toEqual([9, 27, 18, 0, 0, 0])
  expect(Array.from(color.array as Uint8Array).slice(0, 6)).toEqual([158, 179, 194, 0, 0, 0])

  position.clearUpdateRanges(); color.clearUpdateRanges()
  const expanded = updateCatalogPointGeometry(geometry, source, rows, origin, 2, firstKey)
  expect(expanded).toBe(geometry)
  expect(geometry.drawRange.count).toBe(2)
  expect(position.updateRanges).toEqual([{ start: 3, count: 3 }])
  expect(color.updateRanges).toEqual([{ start: 3, count: 3 }])
  expect(Array.from(position.array as Float32Array).slice(0, 6)).toEqual([9, 27, 18, 39, 57, 48])
  expect(Array.from(color.array as Uint8Array).slice(0, 6)).toEqual([158, 179, 194, 255, 158, 128])

  const nextSource = new Float64Array([11, 21, 31, 41, 51, 61, 71, 81, 91])
  updateCatalogPointGeometry(geometry, nextSource, rows, origin, 2, { source: nextSource, origin })
  expect(Array.from(position.array as Float32Array).slice(0, 6)).toEqual([10, 28, 19, 40, 58, 49])
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
