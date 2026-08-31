import { describe, expect, it } from 'vitest'
import { propagateCatalogElementPositions, propagateCatalogElements } from '../../src/engine/ephemeris/catalogPoints'
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
    const both = propagateCatalogElementPositions(new Float64Array([
      orbit.epochJd, orbit.semiMajorAxisAU, orbit.eccentricity, orbit.inclinationDeg,
      orbit.ascendingNodeDeg, orbit.argPeriapsisDeg, orbit.meanAnomalyDeg, orbit.meanMotionDegPerDay,
    ]), jd)
    expect(both.positions).toEqual(points)
    expect(both.positions3D[0]).toBeCloseTo(expected.x, 5)
    expect(both.positions3D[1]).toBeCloseTo(expected.y, 5)
    expect(both.positions3D[2]).toBeCloseTo(expected.z, 5)
  })

  it('converges at perihelion for an MPCORB-width high-eccentricity record', () => {
    const orbit = {
      model: 'keplerian' as const, epochJd: 2451545, semiMajorAxisAU: 1, eccentricity: 0.9999999,
      inclinationDeg: 0, ascendingNodeDeg: 0, argPeriapsisDeg: 0,
      meanAnomalyDeg: 0, meanMotionDegPerDay: 1,
    }
    const both = propagateCatalogElementPositions(new Float64Array([
      orbit.epochJd, orbit.semiMajorAxisAU, orbit.eccentricity, orbit.inclinationDeg,
      orbit.ascendingNodeDeg, orbit.argPeriapsisDeg, orbit.meanAnomalyDeg, orbit.meanMotionDegPerDay,
    ]), orbit.epochJd)
    const expected = orbitToHeliocentricVector(orbit, orbit.epochJd)

    expect(both.positions[0]).toBeCloseTo(1e-7, 12)
    expect(both.positions[1]).toBe(0)
    expect(both.positions3D[0]).toBeCloseTo(expected.x, 12)
    expect(both.positions3D[1]).toBeCloseTo(expected.y, 12)
    expect(both.positions3D[2]).toBeCloseTo(expected.z, 12)
  })

  it('keeps million-row propagation bounded', () => {
    const count = 1_000_000
    const elements = new Float64Array(count * 8)
    for (let index = 0; index < count; index += 1) {
      const offset = index * 8
      elements[offset] = 2451545
      elements[offset + 1] = 2.4
      elements[offset + 2] = index === 0 ? 0.9999999 : 0.31
      elements[offset + 6] = index % 360
      elements[offset + 7] = 0.264
    }

    const result = propagateCatalogElementPositions(elements, 2451545)
    expect(result.positions).toHaveLength(count * 2)
    expect(result.positions3D).toHaveLength(count * 3)
    expect(result.positions[0]).toBeCloseTo(2.4e-7, 12)
    expect(Number.isFinite(result.positions3D.at(-1))).toBe(true)
  }, 10_000)
})
