import { describe, expect, it } from 'vitest'
import { bodyPositionOrNull, createBodyPositionResolver, createBodyVelocityResolver, MissingBodyStateError } from '../../src/lib/ephemeris'
import { getRelativePositions } from '../../src/lib/referenceFrame'
import { buildCurrentPositions, buildTrajectories } from '../../src/lib/trajectory'
import { createTrajectoryAccumulator } from '../../src/lib/trajectorySamples'
import { kernelCoverage } from '../../src/engine/ephemeris/kernelStore'
import { computeOrbitEllipses } from '../../src/lib/orbitEllipse'
import { buildSpacecraftFrame } from '../../src/engine/ephemeris/spacecraft'
import type { CelestialBody } from '../../src/types'

const sun: CelestialBody = { id: 'sun', name: 'Sun', kind: 'star', color: '#fff', size: 1, source: 'custom' }
const missing: CelestialBody = { ...sun, id: 'no-state', name: 'No state', kind: 'moon', parentId: 'sun' }
const moving: CelestialBody = { ...missing, id: 'moving', orbit: { model: 'keplerian', epochJd: 2451545, semiMajorAxisAU: 1, eccentricity: 0, inclinationDeg: 0, ascendingNodeDeg: 0, argPeriapsisDeg: 0, meanAnomalyDeg: 0, meanMotionDegPerDay: 1 } }
const dependent: CelestialBody = { ...moving, id: 'dependent', parentId: missing.id }
const bodies = [sun, missing, moving, dependent]
const bodiesById = new Map(bodies.map(body => [body.id, body]))
const params = { bodies, bodiesById, referenceId: 'sun', centerJulianDay: 2451545, historyDays: 1, sampleCount: 3 }

describe('unavailable body states', () => {
  it('reserves heliocentric zero for the Sun, propagating missing parent state to children and velocities', () => {
    const resolve = createBodyPositionResolver(bodiesById, 2451545, [])
    expect(resolve('sun')).toEqual({ x: 0, y: 0, z: 0 })
    expect(() => resolve(missing.id)).toThrow(MissingBodyStateError)
    expect(() => resolve(dependent.id)).toThrow(MissingBodyStateError)
    expect(() => createBodyVelocityResolver(bodiesById, 2451545, 0.01, [])(missing.id)).toThrow(MissingBodyStateError)
    expect(bodyPositionOrNull(resolve, missing.id)).toBeNull()
    expect(() => bodyPositionOrNull(resolve, 'unknown')).toThrow('Unknown body')
    expect(() => bodyPositionOrNull(() => { throw new RangeError('bad model') }, moving.id)).toThrow('bad model')
    expect(kernelCoverage(missing, 2451545).model).toBe('unavailable')
    expect(kernelCoverage(moving, 2451545).model).toBe('approximate-fallback')
  })
  it('does not move later body positions into a missing earlier body slot', () => {
    const current = buildCurrentPositions({ ...params, julianDay: 2451545 })
    expect(current.currentPositions.map(item => item.body.id)).toEqual(['sun', 'moving'])
    expect(current.currentPositions[1].position3D).toEqual({ x: 1, y: 0, z: 0 })
    expect(current.missingBodyIds).toEqual(['no-state', 'dependent'])
    expect(buildTrajectories(params).map(sample => [sample.body.id, sample.points.length])).toEqual([['sun', 3], ['moving', 3]])
  })
  it('hides the entire frame and trails when the reference is unavailable', () => {
    expect(getRelativePositions(bodies, missing.id, createBodyPositionResolver(bodiesById, 2451545, []))).toEqual([])
    expect(buildTrajectories({ ...params, referenceId: missing.id })).toEqual([])
    expect(computeOrbitEllipses([moving], bodiesById, missing.id, 2451545)).toEqual([])
  })
  it('drops an incomplete trail instead of joining points across a gap, on both shared sampling paths', () => {
    const samples = createTrajectoryAccumulator([missing, moving])
    const position = { x: 1, y: 2, z: 3 }
    samples.append([{ body: missing, position }, { body: moving, position }])
    samples.append([{ body: moving, position }])
    samples.append([{ body: moving, position }, { body: missing, position }])
    expect(samples.complete(3).map(sample => sample.body.id)).toEqual(['moving'])
    expect(samples.complete(3)[0].points3D).toEqual([position, position, position])
  })
  it('reports spacecraft trails whose historical reference state is unavailable', () => {
    const spacecraft = [{
      ...moving, id: 'probe', kind: 'spacecraft' as const,
      trajectoryPoints: [{ jd: 2451544, x: 1, y: 0, z: 0 }, { jd: 2451545, x: 2, y: 0, z: 0 }],
    }]
    const frame = buildSpacecraftFrame(spacecraft, missing.id, bodiesById, 2451545)
    expect(frame.currentPositions).toEqual([])
    expect(frame.trajectories).toEqual([])
    expect(frame.trajectoryUnavailableBodyIds).toEqual(['probe'])
  })
})
