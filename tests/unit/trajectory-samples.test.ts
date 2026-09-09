import { Buffer } from 'node:buffer'
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { createTrajectoryAccumulator, trajectoryViews } from '../../src/lib/trajectorySamples'
import { buildTrajectories } from '../../src/lib/trajectory'
import { createBodyPositionResolver } from '../../src/lib/ephemeris'
import { getRelativePositions } from '../../src/lib/referenceFrame'
import { buildGeometry } from '../../src/lib/trajectoryGeometry2d'
import { updateTrajectoryLineGeometry } from '../../src/lib/trajectoryScene3d'
import { createProjection, projectPoint } from '../../src/lib/viewProjection'
import { EMPTY_CURRENT_POSITIONS } from '../../src/lib/currentPositions'
import { buildSpacecraftFrame } from '../../src/engine/ephemeris/spacecraft'
import type { CelestialBody } from '../../src/types'

const body = (id: string): CelestialBody => ({ id, name: id, kind: 'planet', size: 1, color: '#ff0000', source: 'custom' })
const bytes = (values: Float64Array | Float32Array) => Buffer.from(values.buffer, values.byteOffset, values.byteLength)

describe('packed historical trajectory samples', () => {
  it('retains exactly one xyz allocation at the maximum detail/sample budget and shares it after transfer', () => {
    const bodies = Array.from({ length: 320 }, (_, index) => body(`synthetic:${index}`)), count = 600
    const accumulator = createTrajectoryAccumulator(bodies, count)
    const expected = new Float64Array(bodies.length * count * 3)
    for (let epoch = 0; epoch < count; epoch++) {
      const positions = bodies.map((body, index) => {
        const position = { x: epoch ? epoch / 7 : -0, y: index / 13, z: -index / 17 }
        expected.set([position.x, position.y, position.z], (index * count + epoch) * 3)
        return { body, position }
      })
      // Arrival order cannot change the source-identity ordinal.
      accumulator.append(positions.reverse())
    }
    const packed = accumulator.finish()
    expect(packed.coordinates.byteLength).toBe(320 * 600 * 3 * 8)
    expect(Object.keys(packed).sort()).toEqual(['bodyIds', 'coordinates', 'offsets', 'trajectoryUnavailableBodyIds'])
    expect(bytes(packed.coordinates).equals(bytes(expected))).toBe(true)
    const received = structuredClone(packed, { transfer: [packed.offsets.buffer, packed.coordinates.buffer] })
    expect(packed.coordinates.byteLength).toBe(0)
    const views = trajectoryViews(received, new Map(bodies.map(body => [body.id, body])))
    expect(views).toHaveLength(320)
    for (let index = 0; index < views.length; index++) {
      expect(views[index].body).toBe(bodies[index])
      expect(views[index].coordinates.buffer).toBe(received.coordinates.buffer)
      expect(bytes(views[index].coordinates).equals(bytes(expected.subarray(index * count * 3, (index + 1) * count * 3)))).toBe(true)
    }
  })

  it('compacts missing first/middle/last trails without shifting identities or joining across gaps', () => {
    const bodies = Array.from({ length: 5 }, (_, index) => body(String(index)))
    const accumulator = createTrajectoryAccumulator(bodies, 3)
    for (let epoch = 0; epoch < 3; epoch++) accumulator.append(bodies
      .filter((_, index) => index !== epoch * 2)
      .map((body, index) => ({ body, position: { x: Number(body.id), y: epoch, z: index } })))
    const packed = accumulator.finish()
    expect(packed.bodyIds).toEqual(['1', '3'])
    expect(packed.trajectoryUnavailableBodyIds).toEqual(['0', '2', '4'])
    expect(Array.from(packed.offsets)).toEqual([0, 3, 6])
    expect(packed.coordinates.buffer.byteLength).toBe(2 * 3 * 3 * 8)
    const views = trajectoryViews(packed, new Map(bodies.map(body => [body.id, body])))
    expect(Array.from(views[0].coordinates).filter((_, index) => index % 3 === 0)).toEqual([1, 1, 1])
    expect(Array.from(views[1].coordinates).filter((_, index) => index % 3 === 0)).toEqual([3, 3, 3])
    expect(accumulator.finish()).toBe(packed)
  })

  it('preserves every sampled coordinate of the existing local resolver and reference subtraction', () => {
    const sun = body('sun'), planet: CelestialBody = { ...body('test-orbiter'), orbit: {
      model: 'keplerian', epochJd: 2451545, semiMajorAxisAU: 2, eccentricity: .12,
      inclinationDeg: 7, ascendingNodeDeg: 30, argPeriapsisDeg: 40, meanAnomalyDeg: 50, meanMotionDegPerDay: .4,
    } }
    const bodies = [sun, planet], bodiesById = new Map(bodies.map(body => [body.id, body]))
    const sampleCount = 23, centerJulianDay = 2451645, historyDays = 73
    for (const referenceId of ['sun', planet.id]) {
      const expected = bodies.map(() => new Float64Array(sampleCount * 3))
      for (let index = 0; index < sampleCount; index++) {
        const epoch = centerJulianDay - historyDays + index / (sampleCount - 1) * historyDays
        const positions = getRelativePositions(bodies, referenceId, createBodyPositionResolver(bodiesById, epoch, []))
        positions.forEach(({ position }, ordinal) => expected[ordinal].set([position.x, position.y, position.z], index * 3))
      }
      const samples = buildTrajectories({ bodies, bodiesById, referenceId, sampleCount, centerJulianDay, historyDays })
      samples.forEach((sample, index) => expect(bytes(sample.coordinates).equals(bytes(expected[index]))).toBe(true))
    }
  })

  it('derives the identical 2D clip-space segments without changing the Float64 source', () => {
    const coordinates = new Float64Array([-0, 1 / 3, 10, 1 / 7, -9, 20, -3, 5, 30])
    const before = Buffer.from(bytes(coordinates)), projection = createProjection(20, 960, 640, 40, { x: .7, y: -.4 })
    const geometry = buildGeometry(projection, body('sun'), [{ body: body('trail'), coordinates }], EMPTY_CURRENT_POSITIONS,
      true, true, [{ body: body('ellipse'), points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }], 1, 1, 1, [], new Float32Array(), 0, { x: 0, y: 0 })
    const expected = new Float32Array(8)
    for (let index = 1; index < 3; index++) {
      for (let end = 0; end < 2; end++) {
        const offset = (index - 1 + end) * 3
        const point = projectPoint({ x: coordinates[offset], y: coordinates[offset + 1] }, projection)
        expected[(index - 1) * 4 + end * 2] = point.x / projection.width * 2 - 1
        expected[(index - 1) * 4 + end * 2 + 1] = 1 - point.y / projection.height * 2
      }
    }
    // The ellipse follows the two trail segments, after the grid and halo.
    expect(bytes(geometry.linePositions.subarray(-12, -4)).equals(bytes(expected))).toBe(true)
    expect(geometry.lineColors.length).toBe(geometry.linePositions.length * 2)
    expect(bytes(coordinates).equals(before)).toBe(true)
  })

  it('reuses only the 3D derived buffer and disposes it when the sample count changes', () => {
    const source = new Float64Array([1 / 3, -0, 2 / 7, -5, 3, 8]), before = Buffer.from(bytes(source))
    const first = updateTrajectoryLineGeometry(new THREE.BufferGeometry(), source), attribute = first.getAttribute('position')
    expect(bytes(attribute.array as Float32Array).equals(bytes(new Float32Array([1 / 3, 2 / 7, -0, -5, 8, 3])))).toBe(true)
    const second = updateTrajectoryLineGeometry(first, source)
    expect(second).toBe(first)
    expect(second.getAttribute('position')).toBe(attribute)
    const disposed = vi.spyOn(second, 'dispose')
    const resized = updateTrajectoryLineGeometry(second, source.subarray(0, 3))
    expect(disposed).toHaveBeenCalledOnce()
    expect(resized).not.toBe(second)
    expect(resized.getAttribute('position').count).toBe(1)
    expect(bytes(source).equals(before)).toBe(true)
    resized.dispose()
  })

  it('writes schematic spacecraft source points directly without upgrading their model', () => {
    const sun = body('sun'), probe = { ...body('probe'), kind: 'spacecraft' as const,
      trajectoryPoints: [{ jd: 2451544, x: 1, y: 2, z: 3 }, { jd: 2451545, x: 4, y: 5, z: 6 }] }
    const frame = buildSpacecraftFrame([probe], sun.id, new Map([[sun.id, sun]]), 2451545)
    expect(frame.trajectories[0].body).toBe(probe)
    expect(frame.trajectories[0].coordinates).toEqual(new Float64Array([1, 2, 3, 4, 5, 6]))
    expect(frame.trajectoryUnavailableBodyIds).toEqual([])
  })

  it('rejects over-budget jobs and invalid layouts, and never turns nonfinite samples into a trail', () => {
    const target = body('target'), bodiesById = new Map([[target.id, target]])
    for (const count of [-1, .5, NaN, Infinity, 601]) expect(() => createTrajectoryAccumulator([target], count)).toThrow(RangeError)
    expect(() => createTrajectoryAccumulator(Array.from({ length: 321 }, (_, index) => body(String(index))), 1)).toThrow(RangeError)
    expect(() => createTrajectoryAccumulator([target, target], 1)).toThrow(/Duplicate/)
    const unfinished = createTrajectoryAccumulator([target], 1)
    expect(() => unfinished.finish()).toThrow(/Incomplete/)
    unfinished.append([{ body: target, position: { x: NaN, y: 0, z: 0 } }])
    expect(unfinished.finish().trajectoryUnavailableBodyIds).toEqual([target.id])
    expect(() => unfinished.append([])).toThrow(RangeError)
    const empty = createTrajectoryAccumulator([target], 0).finish()
    expect(empty.trajectoryUnavailableBodyIds).toEqual([target.id])
    expect(trajectoryViews(empty, bodiesById)).toEqual([])
    const packed = { bodyIds: [target.id], trajectoryUnavailableBodyIds: [], offsets: new Uint32Array([0, 1]), coordinates: new Float64Array(3) }
    expect(() => trajectoryViews({ ...packed, offsets: new Uint32Array([1, 1]) }, bodiesById)).toThrow(/layout/)
    expect(() => trajectoryViews({ ...packed, offsets: new Uint32Array([0, 2]) }, bodiesById)).toThrow(/layout/)
    expect(() => trajectoryViews(packed, new Map())).toThrow(/identity/)
  })
})
