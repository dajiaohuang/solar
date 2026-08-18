import { describe, expect, it } from 'vitest'
import {
  UnsupportedOrbitError,
  createBodyPositionResolver,
  orbitToHeliocentricVector,
  solveKeplerEquation,
} from '../../src/lib/ephemeris'
import { getRelativePositions } from '../../src/lib/referenceFrame'
import type { CelestialBody } from '../../src/types'

const circularOrbit = {
  model: 'keplerian' as const,
  epochJd: 2451545,
  semiMajorAxisAU: 1,
  eccentricity: 0,
  inclinationDeg: 0,
  ascendingNodeDeg: 0,
  argPeriapsisDeg: 0,
  meanAnomalyDeg: 0,
  meanMotionDegPerDay: 1,
}

describe('elliptic propagation', () => {
  it('solves Kepler equation and positions a circular orbit', () => {
    expect(solveKeplerEquation(180, 0.2)).toBeCloseTo(180, 8)
    expect(orbitToHeliocentricVector(circularOrbit, 2451545)).toEqual({ x: 1, y: 0, z: 0 })
  })

  it('explicitly rejects parabolic and hyperbolic elements', () => {
    expect(() => orbitToHeliocentricVector({ ...circularOrbit, eccentricity: 1 }, 2451545))
      .toThrow(UnsupportedOrbitError)
  })

  it('resolves parent bodies once and transforms reference frames', () => {
    const sun: CelestialBody = { id: 'sun', name: 'Sun', kind: 'star', color: '#fff', size: 1, source: 'custom' }
    const earth: CelestialBody = { id: 'earth', name: 'Earth', kind: 'planet', color: '#fff', size: 1, source: 'custom', orbit: circularOrbit }
    const moon: CelestialBody = { id: 'moon', name: 'Moon', kind: 'moon', color: '#fff', size: 1, source: 'custom', parentId: 'earth', orbit: { ...circularOrbit, semiMajorAxisAU: 0.01 } }
    const map = new Map([sun, earth, moon].map((body) => [body.id, body]))
    const resolve = createBodyPositionResolver(map, 2451545)
    const [relativeMoon] = getRelativePositions([moon], 'earth', resolve)
    expect(relativeMoon.position.x).toBeCloseTo(0.01, 10)
    expect(relativeMoon.position.y).toBeCloseTo(0, 10)
  })
})
