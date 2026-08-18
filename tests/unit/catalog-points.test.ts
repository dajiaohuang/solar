import { describe, expect, it } from 'vitest'
import { propagateCatalogElements } from '../../src/engine/ephemeris/catalogPoints'
import { orbitToHeliocentricVector } from '../../src/lib/ephemeris'

describe('catalog point propagation', () => {
  it('matches the focus-mode elliptic propagator', () => {
    const orbit = {
      model: 'keplerian' as const, epochJd: 2451545, semiMajorAxisAU: 2.4, eccentricity: 0.31,
      inclinationDeg: 12, ascendingNodeDeg: 82, argPeriapsisDeg: 44,
      meanAnomalyDeg: 20, meanMotionDegPerDay: 0.264,
    }
    const jd = 2460000.5
    const points = propagateCatalogElements(new Float64Array([
      orbit.epochJd, orbit.semiMajorAxisAU, orbit.eccentricity, orbit.inclinationDeg,
      orbit.ascendingNodeDeg, orbit.argPeriapsisDeg, orbit.meanAnomalyDeg, orbit.meanMotionDegPerDay,
    ]), jd)
    const expected = orbitToHeliocentricVector(orbit, jd)
    expect(points[0]).toBeCloseTo(expected.x, 5)
    expect(points[1]).toBeCloseTo(expected.y, 5)
  })
})
