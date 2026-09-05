import { Buffer } from 'node:buffer'
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { CurrentPositions, concatCurrentPositions, currentPositionDetails, EMPTY_CURRENT_POSITIONS, packedCurrentPositions, selectCurrentPositions } from '../../src/lib/currentPositions'
import { selectStateDisplayPositions } from '../../src/lib/stateDisplayBudget'
import { buildGeometry } from '../../src/lib/trajectoryGeometry2d'
import { updateCurrentPointGeometry } from '../../src/lib/pointGeometry3d'
import { createProjection, projectPoint } from '../../src/lib/viewProjection'
import type { CelestialBody } from '../../src/types'

const body = (index: number): CelestialBody => ({ id: `body:${index}`, name: `Body ${index}`, kind: 'asteroid', size: 1, color: index % 2 ? '#00ff00' : '#ff0000', source: 'custom' })

describe('scalar current-position views', () => {
  it('reads a million synthetic positions without constructing detail rows or both display dimensions', () => {
    const count = 1_000_000, bodies = [body(0), body(1)]
    // Synthetic shared styles: this is a storage/access workload, not one
    // million real identities or a physical-device frame-rate claim.
    const coordinates = new Float64Array(count * 3)
    for (let index = 0; index < coordinates.length; index++) coordinates[index] = index / 13
    coordinates[0] = -0
    const before = Buffer.from(new Uint8Array(coordinates.buffer))
    const source = new CurrentPositions(count, index => bodies[index % 2], (index, axis) => coordinates[index * 3 + axis])
    const rows = vi.spyOn(source, 'rowAt')
    const selected = selectCurrentPositions(source, Uint32Array.from([count - 1, 0, count - 2]))
    const joined = concatCurrentPositions(selected, selected)
    expect(joined.length).toBe(6)
    expect(joined.bodyAt(0)).toBe(bodies[1])
    expect(Object.is(joined.coordinateAt(1, 0), -0)).toBe(true)
    let largest = 0
    for (let index = 0; index < source.length; index++) largest = Math.max(largest, source.coordinateAt(index, 0))
    expect(largest).toBe(coordinates[(count - 1) * 3])
    expect(rows).not.toHaveBeenCalled()
    expect(Buffer.from(coordinates.buffer).equals(before)).toBe(true)
    const detail = joined.rowAt(1)
    detail.position3D!.x = 100
    expect(Object.is(joined.coordinateAt(1, 0), -0)).toBe(true)
    expect(concatCurrentPositions(EMPTY_CURRENT_POSITIONS, source)).toBe(source)
    expect(concatCurrentPositions(source, EMPTY_CURRENT_POSITIONS)).toBe(source)
  })

  it('selects late priority identities without full row materialization, then creates only bounded details', () => {
    const count = 32_769, bodies = Array.from({ length: count }, (_, index) => body(index))
    const source = new CurrentPositions(count, index => bodies[index], (index, axis) => index + axis)
    const rows = vi.spyOn(source, 'rowAt')
    const selected = selectStateDisplayPositions(source, 100, ['body:32768', 'body:1000', 'absent'])
    expect(Array.from({ length: 4 }, (_, index) => selected.bodyAt(index).id)).toEqual(['body:1000', 'body:32768', 'body:0', 'body:1'])
    expect(rows).not.toHaveBeenCalled()
    const details = currentPositionDetails(source, ['body:32768', 'body:1000', 'body:4'], 2)
    expect(details.map(item => item.body.id)).toEqual(['body:1000', 'body:32768'])
    expect(rows).toHaveBeenCalledTimes(2)
    expect(source.length).toBe(count)
    expect(selected.coordinateAt(1, 2)).toBe(32770)
  })

  it('writes the real 2D point geometry straight into typed columns without requesting any full rows', () => {
    const count = 32_769, bodies = Array.from({ length: count }, (_, index) => body(index))
    const source = new CurrentPositions(count, index => bodies[index], (index, axis) => (index - 16000) / (axis + 10))
    const rows = vi.spyOn(source, 'rowAt')
    const projection = createProjection(4000, 1280, 720, 40, { x: .25, y: -.75 })
    const geometry = buildGeometry(projection, bodies[0], [], source, false, false, [], 1, 1, 1, [], new Float32Array(), 0, { x: 0, y: 0 })
    expect(geometry.pointPositions).toBeInstanceOf(Float32Array)
    expect(geometry.pointPositions.length).toBe((count + 1) * 2)
    expect(geometry.pointColors.length).toBe((count + 1) * 4)
    expect(geometry.pointSizes.length).toBe(count + 1)
    const expected = new Float32Array((count + 1) * 2)
    for (let index = 0; index <= count; index++) {
      const point = index ? { x: source.coordinateAt(index - 1, 0), y: source.coordinateAt(index - 1, 1) } : { x: 0, y: 0 }
      const projected = projectPoint(point, projection)
      expected[index * 2] = projected.x / projection.width * 2 - 1
      expected[index * 2 + 1] = 1 - projected.y / projection.height * 2
    }
    expect(Buffer.from(geometry.pointPositions.buffer).equals(Buffer.from(expected.buffer))).toBe(true)
    expect(rows).not.toHaveBeenCalled()
  })

  it('writes 3D axes and colors directly and refreshes colors when equal-sized ordinal selections change', () => {
    const bodies = [body(0), body(1), body(2)], coordinates = new Float64Array([1, 2, 3, 4, 5, 6, 7, 8, 9])
    const source = packedCurrentPositions(bodies, coordinates), rows = vi.spyOn(source, 'rowAt')
    const first = updateCurrentPointGeometry(new THREE.BufferGeometry(), source, Uint32Array.from([0, 1]))
    const positions = first.getAttribute('position'), colors = first.getAttribute('color')
    expect(Array.from(positions.array).slice(0, 6)).toEqual([1, 3, 2, 4, 6, 5])
    expect(Array.from(colors.array).slice(0, 6)).toEqual([1, 0, 0, 0, 1, 0])
    const second = updateCurrentPointGeometry(first, source, Uint32Array.from([1, 2]))
    expect(second).toBe(first)
    expect(second.getAttribute('position')).toBe(positions)
    expect(Array.from(colors.array).slice(0, 6)).toEqual([0, 1, 0, 1, 0, 0])
    expect(Array.from(positions.array).slice(0, 6)).toEqual([4, 6, 5, 7, 9, 8])
    expect(rows).not.toHaveBeenCalled()
    expect(updateCurrentPointGeometry(second, source, new Uint32Array()).drawRange.count).toBe(0)
    second.dispose()
  })

  it('rejects malformed counts, axes and ordinal selections', () => {
    const source = packedCurrentPositions([body(0)], new Float64Array([1, 2, 3]))
    for (const index of [-1, 1, .5, NaN, Infinity]) {
      expect(() => source.bodyAt(index)).toThrow(RangeError)
      expect(() => source.coordinateAt(index, 0)).toThrow(RangeError)
      expect(() => source.rowAt(index)).toThrow(RangeError)
    }
    for (const axis of [-1, 3, .5, NaN]) expect(() => source.coordinateAt(0, axis)).toThrow(RangeError)
    expect(() => new CurrentPositions(-1, () => body(0), () => 0)).toThrow(RangeError)
    expect(() => packedCurrentPositions([body(0)], new Float64Array(2))).toThrow(/columns/)
    expect(() => selectCurrentPositions(source, Uint32Array.from([1]))).toThrow(RangeError)
    expect(() => currentPositionDetails(source, [], -1)).toThrow(RangeError)
    expect(source.indexOf('absent')).toBe(-1)
    expect(source.indexOf(undefined)).toBe(-1)
    const ordinals = Uint32Array.from([0]), selected = selectCurrentPositions(source, ordinals)
    ordinals[0] = 50
    expect(selected.coordinateAt(0, 0)).toBe(1)
  })
})
